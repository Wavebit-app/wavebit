//! Listen together: wavebit's client for BitChord's party server
//! (`backend/README.md` in BitChord is the contract).
//!
//! Nothing acts on "play now". The server holds a position and the server
//! time it was true at; [`clock`] measures this device's offset from that
//! clock, and where to be is arithmetic. One thread owns the socket, so a
//! ping's send and receive times are read where the bytes move and a busy
//! JavaScript loop can't stretch the round trip.
//!
//! The party token lives here and nowhere else: it is never in an event, a
//! log or a file.

mod clock;
mod invite;
mod wire;

use std::io::ErrorKind;
use std::net::{TcpStream, ToSocketAddrs};
use std::sync::mpsc::{self, Receiver, Sender, TryRecvError};
use std::thread;
use std::time::{Duration, Instant};

use napi::bindgen_prelude::{AsyncTask, Unknown};
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi::{Env, Error, Result, Status, Task};
use napi_derive::napi;
use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use tungstenite::client::IntoClientRequest;
use tungstenite::stream::MaybeTlsStream;
use tungstenite::{HandshakeError, Message, WebSocket};

use clock::{Mono, ServerClock, wall_ms};
use invite::{clean_code, clean_server, parse_invite};
use wire::{
    ACTIONS, Member, Membership, Playback, Preview, Queue, Refusal, Snapshot, clean_members,
};

const PING_EVERY: Duration = Duration::from_secs(15);
/// A burst on arrival makes the first seconds accurate.
const PING_BURST: u8 = 4;
const PING_BURST_GAP: Duration = Duration::from_millis(300);
const REPORT_EVERY: Duration = Duration::from_secs(10);
/// How long a read waits before the loop looks at its commands again.
const READ_SLICE: Duration = Duration::from_millis(20);
const NET_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_BACKOFF: Duration = Duration::from_secs(30);

type Socket = WebSocket<MaybeTlsStream<TcpStream>>;

/// Who this device joins as. The server can't check it; the token it mints is what counts.
#[napi(object)]
pub struct PartyIdentity {
    pub user_id: String,
    pub device_id: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
}

#[napi(object)]
pub struct PartyInvite {
    pub code: String,
    /// Null means whichever server this device already uses.
    pub server: Option<String>,
}

/// Reads a code or an invite link; null for anything else.
#[napi]
pub fn party_parse_invite(text: String) -> Option<PartyInvite> {
    parse_invite(&text).map(|i| PartyInvite {
        code: i.code,
        server: i.server,
    })
}

/// `https://host[:port]`, or null when the text isn't a server wavebit will talk to.
#[napi]
pub fn party_clean_server(text: String) -> Option<String> {
    clean_server(&text)
}

#[derive(Serialize, Clone, PartialEq, Debug)]
struct Fault {
    code: String,
    message: String,
}

impl Fault {
    fn new(code: &str) -> Self {
        Self {
            code: code.to_string(),
            message: String::new(),
        }
    }
}

/// Everything the app is told, whole, each time any of it changes.
#[derive(Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
struct View {
    code: Option<String>,
    server: Option<String>,
    you: Option<Member>,
    members: Vec<Member>,
    max_members: i64,
    host_only_control: bool,
    playback: Playback,
    queue: Queue,
    connection: &'static str,
    /// False until the first round trip; the playhead is a guess until then.
    clock_synced: bool,
    round_trip_ms: i64,
    /// Server time minus this computer's wall clock.
    offset_ms: i64,
    /// A create or join is on its way.
    busy: bool,
    error: Option<Fault>,
}

fn idle() -> View {
    View {
        code: None,
        server: None,
        you: None,
        members: Vec::new(),
        max_members: 5,
        host_only_control: false,
        playback: Playback::default(),
        queue: Queue::default(),
        connection: "offline",
        clock_synced: false,
        round_trip_ms: 0,
        offset_ms: 0,
        busy: false,
        error: None,
    }
}

enum Cmd {
    Create {
        server: String,
        who: PartyIdentity,
        autoplay: bool,
    },
    Join {
        server: String,
        code: String,
        who: PartyIdentity,
    },
    Leave(Option<Sender<()>>),
    Control(String),
    Sync,
}

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_global(Some(NET_TIMEOUT))
        .http_status_as_error(false)
        .build()
        .into()
}

fn fault_of(status: u16, refusal: Refusal) -> Fault {
    Fault {
        code: if refusal.error.is_empty() {
            format!("http_{status}")
        } else {
            refusal.error.chars().take(40).collect()
        },
        message: refusal
            .message
            .chars()
            .filter(|c| !c.is_control())
            .take(200)
            .collect(),
    }
}

fn post<T: DeserializeOwned>(
    agent: &ureq::Agent,
    url: &str,
    body: &Value,
) -> std::result::Result<T, Fault> {
    let unreachable = |_| Fault::new("unreachable");
    let mut response = agent.post(url).send_json(body).map_err(unreachable)?;
    let status = response.status().as_u16();
    if !(200..300).contains(&status) {
        let refusal = response.body_mut().read_json().unwrap_or_default();
        return Err(fault_of(status, refusal));
    }
    response
        .body_mut()
        .read_json()
        .map_err(|_| Fault::new("failed"))
}

fn tcp_of(socket: &Socket) -> Option<&TcpStream> {
    match socket.get_ref() {
        MaybeTlsStream::Plain(tcp) => Some(tcp),
        MaybeTlsStream::Rustls(tls) => Some(tls.get_ref()),
        _ => None,
    }
}

/// The socket, or the HTTP status the server refused the handshake with.
fn open(server: &str, code: &str, token: &str) -> std::result::Result<Socket, Option<u16>> {
    let url = format!("{}/ws/parties/{code}", server.replacen("http", "ws", 1));
    let mut request = url.into_client_request().map_err(|_| None)?;
    // The header, never the address: tokens in URLs end up in access logs.
    let bearer = format!("Bearer {token}").parse().map_err(|_| None)?;
    request.headers_mut().insert("Authorization", bearer);
    let host = request.uri().host().ok_or(None)?.to_string();
    let port = request
        .uri()
        .port_u16()
        .unwrap_or(if server.starts_with("https") { 443 } else { 80 });
    let tcp = (host.as_str(), port)
        .to_socket_addrs()
        .map_err(|_| None)?
        .find_map(|addr| TcpStream::connect_timeout(&addr, NET_TIMEOUT).ok())
        .ok_or(None)?;
    let _ = tcp.set_nodelay(true);
    let _ = tcp.set_read_timeout(Some(NET_TIMEOUT));
    let _ = tcp.set_write_timeout(Some(NET_TIMEOUT));
    let (socket, _) =
        tungstenite::client_tls_with_config(request, tcp, None, None).map_err(|e| match e {
            HandshakeError::Failure(tungstenite::Error::Http(response)) => {
                Some(response.status().as_u16())
            }
            _ => None,
        })?;
    if let Some(tcp) = tcp_of(&socket) {
        let _ = tcp.set_read_timeout(Some(READ_SLICE));
    }
    Ok(socket)
}

struct Worker {
    emit: Box<dyn Fn(String) + Send>,
    agent: ureq::Agent,
    mono: Mono,
    clock: ServerClock,
    view: View,
    /// The last view sent, so nothing is sent twice.
    sent: String,
    token: Option<String>,
    socket: Option<Socket>,
    retry_at: Instant,
    backoff: Duration,
    next_ping: Instant,
    burst: u8,
    next_report: Instant,
}

impl Worker {
    fn new(emit: Box<dyn Fn(String) + Send>) -> Self {
        let now = Instant::now();
        Self {
            emit,
            agent: agent(),
            mono: Mono::new(),
            clock: ServerClock::default(),
            view: idle(),
            sent: String::new(),
            token: None,
            socket: None,
            retry_at: now,
            backoff: Duration::from_secs(1),
            next_ping: now,
            burst: 0,
            next_report: now,
        }
    }

    fn run(mut self, commands: Receiver<Cmd>) {
        loop {
            // Outside a party there is nothing to do but wait to be asked.
            let command = if self.token.is_none() {
                match commands.recv() {
                    Ok(command) => Some(command),
                    Err(_) => return,
                }
            } else {
                match commands.try_recv() {
                    Ok(command) => Some(command),
                    Err(TryRecvError::Empty) => None,
                    Err(TryRecvError::Disconnected) => {
                        self.leave();
                        return;
                    }
                }
            };
            match command {
                Some(command) => self.handle(command),
                None if self.socket.is_some() => self.pump(),
                None if Instant::now() >= self.retry_at => self.connect(),
                None => thread::sleep(READ_SLICE),
            }
            self.publish();
        }
    }

    fn publish(&mut self) {
        let Ok(json) = serde_json::to_string(&self.view) else {
            return;
        };
        if json != self.sent {
            (self.emit)(json.clone());
            self.sent = json;
        }
    }

    fn handle(&mut self, command: Cmd) {
        match command {
            Cmd::Create {
                server,
                who,
                autoplay,
            } => {
                let mut body = identity(&who);
                body["autoplayEnabled"] = json!(autoplay);
                self.enter(&server, "/api/parties".to_string(), body);
            }
            Cmd::Join { server, code, who } => match clean_code(&code) {
                // Already there: a link pressed twice changes nothing.
                Some(code)
                    if self.view.code.as_ref() == Some(&code)
                        && self.view.server == clean_server(&server) => {}
                Some(code) => {
                    self.enter(&server, format!("/api/parties/{code}/join"), identity(&who))
                }
                None => self.view.error = Some(Fault::new("bad_code")),
            },
            Cmd::Leave(done) => {
                self.leave();
                if let Some(done) = done {
                    let _ = done.send(());
                }
            }
            Cmd::Control(frame) => self.control(&frame),
            Cmd::Sync => {
                // Measures the clock afresh and asks for the truth again.
                self.burst = PING_BURST;
                self.next_ping = Instant::now();
                self.send(json!({ "type": "sync" }));
                self.send(json!({ "type": "syncQueue" }));
            }
        }
    }

    /// Creates or joins. The party this device is already in is only given up
    /// once the new one has said yes.
    fn enter(&mut self, server: &str, path: String, body: Value) {
        let Some(server) = clean_server(server) else {
            self.view.error = Some(Fault::new("bad_server"));
            return;
        };
        self.view.busy = true;
        self.view.error = None;
        self.publish();
        let answer = post::<Membership>(&self.agent, &format!("{server}{path}"), &body);
        self.view.busy = false;
        let membership = match answer {
            Ok(m) if !m.token.is_empty() && clean_code(&m.code).is_some() => m,
            Ok(_) => {
                self.view.error = Some(Fault::new("failed"));
                return;
            }
            Err(fault) => {
                self.view.error = Some(fault);
                return;
            }
        };
        self.release();
        self.clock.reset();
        self.token = Some(membership.token);
        self.view = idle();
        self.view.code = Some(membership.code);
        self.view.server = Some(server);
        self.view.you = Some(membership.you.clean());
        self.view.connection = "connecting";
        self.take_snapshot(membership.party);
        self.backoff = Duration::from_secs(1);
        self.retry_at = Instant::now();
    }

    fn take_snapshot(&mut self, party: Snapshot) {
        self.view.members = clean_members(party.members);
        if party.max_members > 0 {
            self.view.max_members = party.max_members.min(16);
        }
        self.view.host_only_control = party.host_only_control;
        self.view.playback = party.playback.clean();
        self.view.queue = party.queue.clean();
    }

    /// Closes the socket and gives the slot back, if there is one.
    fn release(&mut self) {
        if let Some(mut socket) = self.socket.take() {
            let _ = socket.close(None);
            let _ = socket.flush();
        }
        let held = (
            self.view.server.take(),
            self.view.code.take(),
            self.token.take(),
        );
        if let (Some(server), Some(code), Some(token)) = held {
            let _ = self
                .agent
                .post(&format!("{server}/api/parties/{code}/leave"))
                .header("Authorization", &format!("Bearer {token}"))
                .send_empty();
        }
    }

    fn leave(&mut self) {
        // The app hears first: giving the slot back takes as long as the network does.
        let held = (self.view.server.take(), self.view.code.take());
        self.clock.reset();
        self.view = idle();
        self.publish();
        (self.view.server, self.view.code) = held;
        self.release();
    }

    /// The party is over for this device, and the app is told why.
    fn end(&mut self, code: &str) {
        self.socket = None;
        self.token = None;
        self.clock.reset();
        self.view = idle();
        self.view.error = Some(Fault::new(code));
    }

    fn connect(&mut self) {
        let (Some(server), Some(code), Some(token)) =
            (&self.view.server, &self.view.code, &self.token)
        else {
            return;
        };
        match open(server, code, token) {
            Ok(socket) => {
                let now = Instant::now();
                self.socket = Some(socket);
                self.view.connection = "live";
                self.view.error = None;
                self.backoff = Duration::from_secs(1);
                self.burst = PING_BURST;
                self.next_ping = now;
                self.next_report = now + REPORT_EVERY;
            }
            // The server has forgotten this party or this device: a restart, a sweep.
            Err(Some(401 | 404)) => self.end("ended"),
            Err(_) => self.lost(),
        }
    }

    /// The socket went. Back off with jitter and go round again.
    fn lost(&mut self) {
        self.socket = None;
        self.clock.reset();
        self.view.connection = "connecting";
        self.view.clock_synced = false;
        let backoff = self.backoff.as_millis() as u64;
        let jitter = self.mono.now_ms().unsigned_abs() % (backoff + 1);
        self.retry_at = Instant::now() + Duration::from_millis(backoff / 2 + jitter);
        self.backoff = (self.backoff * 2).min(MAX_BACKOFF);
    }

    fn send(&mut self, frame: Value) {
        let Some(socket) = self.socket.as_mut() else {
            return;
        };
        if socket.send(Message::text(frame.to_string())).is_err() {
            self.lost();
        }
    }

    fn control(&mut self, frame: &str) {
        let Ok(mut frame) = serde_json::from_str::<Value>(frame) else {
            return;
        };
        let known = frame
            .get("action")
            .and_then(Value::as_str)
            .is_some_and(|action| ACTIONS.contains(&action));
        if !known || !frame.is_object() {
            return;
        }
        frame["type"] = json!("control");
        self.view.error = None;
        self.send(frame);
    }

    fn pump(&mut self) {
        let now = Instant::now();
        if now >= self.next_ping {
            self.burst = self.burst.saturating_sub(1);
            self.next_ping = now
                + if self.burst > 0 {
                    PING_BURST_GAP
                } else {
                    PING_EVERY
                };
            self.send(json!({ "type": "ping", "clientMs": self.mono.now_ms() }));
        }
        if now >= self.next_report {
            self.next_report = now + REPORT_EVERY;
            // Only logged by the server; a party is never averaged towards a straggler.
            if let (Some(offset), Some(_)) = (self.clock.offset_ms(), &self.view.playback.track) {
                let position = self.view.playback.position_at(self.mono.now_ms() + offset);
                let playing = self.view.playback.is_playing;
                self.send(
                    json!({ "type": "report", "positionMs": position, "isPlaying": playing }),
                );
            }
        }
        let Some(socket) = self.socket.as_mut() else {
            return;
        };
        let read = socket.read();
        let received_ms = self.mono.now_ms();
        match read {
            Ok(Message::Text(text)) => self.on_frame(text.as_str(), received_ms),
            Ok(Message::Close(_)) => self.lost(),
            Ok(_) => {}
            // Nothing arrived in this slice.
            Err(tungstenite::Error::Io(e))
                if matches!(e.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {}
            Err(_) => self.lost(),
        }
    }

    fn on_frame(&mut self, text: &str, received_ms: i64) {
        let Ok(mut frame) = serde_json::from_str::<Value>(text) else {
            return;
        };
        if !frame.is_object() {
            return;
        }
        let kind = frame["type"].as_str().unwrap_or_default().to_string();
        match kind.as_str() {
            "welcome" => {
                let Ok(party) = serde_json::from_value::<Snapshot>(frame["party"].take()) else {
                    return;
                };
                if let Ok(you) = serde_json::from_value::<Member>(frame["you"].take()) {
                    self.view.you = Some(you.clean());
                }
                self.take_snapshot(party);
            }
            "pong" => {
                let (Some(sent), Some(server)) =
                    (frame["clientMs"].as_i64(), frame["serverMs"].as_i64())
                else {
                    return;
                };
                self.clock.record(sent, server, received_ms);
                self.view.clock_synced = true;
                self.view.round_trip_ms = self.clock.round_trip_ms();
                // The page counts from the wall clock, so it gets the offset from that.
                let mono_ahead = self.mono.now_ms() - wall_ms();
                self.view.offset_ms = self.clock.offset_ms().unwrap_or(0) + mono_ahead;
            }
            "state" => {
                let Ok(playback) = serde_json::from_value::<Playback>(frame["playback"].take())
                else {
                    return;
                };
                // Older than what's applied: two people pressing at once settle instead of fighting.
                if playback.seq < self.view.playback.seq {
                    return;
                }
                let queue_is_stale = playback.queue_seq != self.view.queue.seq;
                // The party has moved on, so a refusal about the last thing tried is old news.
                if playback.seq > self.view.playback.seq {
                    self.view.error = None;
                }
                self.view.playback = playback.clean();
                // A missed queue frame is healed on the next heartbeat.
                if queue_is_stale {
                    self.send(json!({ "type": "syncQueue" }));
                }
            }
            "queue" => {
                let Ok(queue) = serde_json::from_value::<Queue>(frame["queue"].take()) else {
                    return;
                };
                if queue.seq >= self.view.queue.seq {
                    self.view.queue = queue.clean();
                }
            }
            "members" => {
                let Ok(members) = serde_json::from_value::<Vec<Member>>(frame["members"].take())
                else {
                    return;
                };
                self.view.members = clean_members(members);
                if let Some(max) = frame["maxMembers"].as_i64().filter(|m| *m > 0) {
                    self.view.max_members = max.min(16);
                }
                if let Some(locked) = frame["hostOnlyControl"].as_bool() {
                    if locked != self.view.host_only_control {
                        self.view.error = None;
                    }
                    self.view.host_only_control = locked;
                }
                // The only place a promotion to host is announced.
                let me = self.view.you.as_ref().map(|you| you.member_id.clone());
                if let Some(now) = self
                    .view
                    .members
                    .iter()
                    .find(|m| Some(&m.member_id) == me.as_ref())
                {
                    self.view.you = Some(now.clone());
                }
            }
            "error" => {
                let refusal: Refusal = serde_json::from_value(frame).unwrap_or_default();
                if refusal.error == "bad_token" || refusal.error == "no_such_party" {
                    self.end("ended");
                } else {
                    self.view.error = Some(fault_of(0, refusal));
                }
            }
            "bye" => {
                let kicked = frame["reason"].as_str() == Some("kicked");
                self.end(if kicked { "kicked" } else { "ended" });
            }
            _ => {}
        }
    }
}

fn identity(who: &PartyIdentity) -> Value {
    json!({
        "userId": who.user_id,
        "deviceId": who.device_id,
        "displayName": who.display_name,
        "avatarUrl": who.avatar_url,
    })
}

/// One party at a time, on its own thread. `on_change` gets the whole state as
/// JSON each time any of it changes.
#[napi]
pub struct Party {
    commands: Sender<Cmd>,
}

#[napi]
impl Party {
    #[napi(constructor)]
    pub fn new(
        on_change: ThreadsafeFunction<String, Unknown<'static>, String, Status, false>,
    ) -> Result<Self> {
        // Already installed is fine; one provider for the socket and for REST.
        let _ = rustls::crypto::ring::default_provider().install_default();
        let (commands, inbox) = mpsc::channel();
        let emit = Box::new(move |json: String| {
            on_change.call(json, ThreadsafeFunctionCallMode::NonBlocking);
        });
        thread::Builder::new()
            .name("wavebit-party".into())
            .spawn(move || Worker::new(emit).run(inbox))
            .map_err(|e| Error::new(Status::GenericFailure, format!("party: {e}")))?;
        Ok(Self { commands })
    }

    /// Starts a party on `server` and joins it as host.
    #[napi]
    pub fn create(&self, server: String, who: PartyIdentity, autoplay: bool) {
        let _ = self.commands.send(Cmd::Create {
            server,
            who,
            autoplay,
        });
    }

    #[napi]
    pub fn join(&self, server: String, code: String, who: PartyIdentity) {
        let _ = self.commands.send(Cmd::Join { server, code, who });
    }

    /// Gives the slot back. `wait_ms` above zero waits that long for it to be
    /// done, for when the app is about to quit.
    #[napi]
    pub fn leave(&self, wait_ms: u32) {
        if wait_ms == 0 {
            let _ = self.commands.send(Cmd::Leave(None));
            return;
        }
        let (done, wait) = mpsc::channel();
        if self.commands.send(Cmd::Leave(Some(done))).is_ok() {
            let _ = wait.recv_timeout(Duration::from_millis(wait_ms.into()));
        }
    }

    /// Sends one control, as JSON with an `action`. Unknown actions are dropped.
    #[napi]
    pub fn control(&self, frame: String) {
        let _ = self.commands.send(Cmd::Control(frame));
    }

    /// Measures the clock again and asks the server to restate where the party is.
    #[napi]
    pub fn sync(&self) {
        let _ = self.commands.send(Cmd::Sync);
    }
}

#[napi(object)]
pub struct PartyPreviewMember {
    pub display_name: String,
    pub avatar_url: Option<String>,
    pub is_host: bool,
}

/// Who is in a party, for someone invited to it.
#[napi(object)]
pub struct PartyPreview {
    pub host_name: String,
    pub max_members: u32,
    pub is_full: bool,
    pub members: Vec<PartyPreviewMember>,
}

pub struct PreviewTask {
    server: String,
    code: String,
}

impl Task for PreviewTask {
    type Output = Option<PartyPreview>;
    type JsValue = Option<PartyPreview>;

    fn compute(&mut self) -> Result<Self::Output> {
        let (Some(server), Some(code)) = (clean_server(&self.server), clean_code(&self.code))
        else {
            return Ok(None);
        };
        let url = format!("{server}/api/parties/{code}/preview");
        let Ok(mut response) = agent().get(&url).call() else {
            return Ok(None);
        };
        if response.status().as_u16() != 200 {
            return Ok(None);
        }
        let Ok(preview) = response.body_mut().read_json::<Preview>() else {
            return Ok(None);
        };
        Ok(Some(PartyPreview {
            host_name: preview
                .host_name
                .chars()
                .filter(|c| !c.is_control())
                .take(80)
                .collect(),
            max_members: preview.max_members.clamp(0, 16) as u32,
            is_full: preview.is_full,
            members: clean_members(preview.members)
                .into_iter()
                .map(|m| PartyPreviewMember {
                    display_name: m.display_name,
                    avatar_url: m.avatar_url,
                    is_host: m.is_host,
                })
                .collect(),
        }))
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

/// Asks `server` who is in party `code`, off the main thread. Null when it can't say.
#[napi]
pub fn party_preview(server: String, code: String) -> AsyncTask<PreviewTask> {
    AsyncTask::new(PreviewTask { server, code })
}

/// Whether a party server answers, and how fast.
#[napi(object)]
pub struct PartyProbe {
    pub ok: bool,
    pub round_trip_ms: u32,
    pub parties: Option<u32>,
    pub members: Option<u32>,
}

pub struct ProbeTask(String);

impl Task for ProbeTask {
    type Output = PartyProbe;
    type JsValue = PartyProbe;

    fn compute(&mut self) -> Result<PartyProbe> {
        let down = PartyProbe {
            ok: false,
            round_trip_ms: 0,
            parties: None,
            members: None,
        };
        let Some(server) = clean_server(&self.0) else {
            return Ok(down);
        };
        let agent = agent();
        let get = |path: &str| -> Option<Value> {
            let mut response = agent.get(&format!("{server}{path}")).call().ok()?;
            (response.status().as_u16() == 200)
                .then(|| response.body_mut().read_json().ok())
                .flatten()
        };
        // The first call pays for the TLS handshake; the second is the round trip.
        let Some(root) = get("/") else {
            return Ok(down);
        };
        let started = Instant::now();
        let ok = get("/api/time").is_some_and(|time| time["serverMs"].is_i64());
        let count = |key: &str| root[key].as_u64().and_then(|n| u32::try_from(n).ok());
        Ok(PartyProbe {
            ok,
            round_trip_ms: started.elapsed().as_millis().min(60_000) as u32,
            parties: count("parties"),
            members: count("members"),
        })
    }

    fn resolve(&mut self, _env: Env, output: PartyProbe) -> Result<PartyProbe> {
        Ok(output)
    }
}

/// Asks `server` whether it is a party server, off the main thread.
#[napi]
pub fn party_probe(server: String) -> AsyncTask<ProbeTask> {
    AsyncTask::new(ProbeTask(server))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    fn worker() -> (Worker, Arc<Mutex<Vec<String>>>) {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let sink = seen.clone();
        let mut worker = Worker::new(Box::new(move |json| sink.lock().unwrap().push(json)));
        worker.token = Some("secret-token".into());
        worker.view.code = Some("K7M2QX".into());
        worker.view.you = Some(Member {
            member_id: "me".into(),
            ..Member::default()
        });
        (worker, seen)
    }

    #[test]
    fn an_older_state_is_dropped() {
        let (mut w, _) = worker();
        w.on_frame(
            r#"{"type":"state","playback":{"seq":5,"positionMs":9000}}"#,
            0,
        );
        w.on_frame(r#"{"type":"state","playback":{"seq":4,"positionMs":1}}"#, 0);
        assert_eq!(w.view.playback.position_ms, 9_000);
        // The same seq again is the heartbeat, and is taken.
        w.on_frame(
            r#"{"type":"state","playback":{"seq":5,"positionMs":9500}}"#,
            0,
        );
        assert_eq!(w.view.playback.position_ms, 9_500);
    }

    #[test]
    fn a_members_frame_can_make_this_device_the_host() {
        let (mut w, _) = worker();
        w.on_frame(
            r#"{"type":"members","maxMembers":8,"hostOnlyControl":true,
                "members":[{"memberId":"me","displayName":"Shikki","isHost":true,"connected":true}]}"#,
            0,
        );
        assert!(w.view.you.as_ref().unwrap().is_host);
        assert_eq!(w.view.max_members, 8);
        assert!(w.view.host_only_control);
    }

    #[test]
    fn a_pong_sets_the_clock() {
        let (mut w, _) = worker();
        let sent = w.mono.now_ms();
        w.on_frame(
            &format!(
                r#"{{"type":"pong","clientMs":{sent},"serverMs":{}}}"#,
                sent + 5_000
            ),
            sent + 40,
        );
        assert!(w.view.clock_synced);
        assert_eq!(w.view.round_trip_ms, 40);
        assert_eq!(w.clock.offset_ms(), Some(4_980));
    }

    #[test]
    fn being_removed_ends_the_party_and_says_why() {
        let (mut w, _) = worker();
        w.on_frame(r#"{"type":"bye","reason":"kicked"}"#, 0);
        assert_eq!(w.view.code, None);
        assert_eq!(w.token, None);
        assert_eq!(w.view.error, Some(Fault::new("kicked")));
    }

    #[test]
    fn junk_frames_change_nothing() {
        let (mut w, _) = worker();
        let before = serde_json::to_string(&w.view).unwrap();
        for junk in [
            "",
            "[]",
            "42",
            r#""state""#,
            r#"{"type":"state"}"#,
            r#"{"type":"state","playback":7}"#,
            r#"{"type":"members","members":"x"}"#,
            r#"{"type":"pong","clientMs":"a"}"#,
        ] {
            w.on_frame(junk, 0);
        }
        assert_eq!(serde_json::to_string(&w.view).unwrap(), before);
    }

    #[test]
    fn the_token_is_never_in_what_the_app_is_told() {
        let (mut w, seen) = worker();
        w.on_frame(r#"{"type":"state","playback":{"seq":1}}"#, 0);
        w.publish();
        let sent = seen.lock().unwrap();
        assert_eq!(sent.len(), 1);
        assert!(!sent[0].contains("secret-token"));
        assert!(sent[0].contains(r#""code":"K7M2QX""#));
    }

    #[test]
    fn only_known_controls_are_sent() {
        let (mut w, _) = worker();
        w.view.error = Some(Fault::new("host_only"));
        // No socket, so nothing can go out; an unknown action must not even clear the error.
        w.control(r#"{"action":"explode","maxMembers":99}"#);
        assert!(w.view.error.is_some());
        w.control(r#"{"action":"pause"}"#);
        assert!(w.view.error.is_none());
    }
}
