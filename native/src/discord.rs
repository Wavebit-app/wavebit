//! Discord Rich Presence over Discord's per-user local IPC socket.
//!
//! wavebit sends display data to the Discord app already running and signed in
//! on this computer. It never talks to Discord's servers, never asks for or
//! holds a Discord credential, and cannot change the account's online status.
//! BitChord does this with the account's own token over Discord's gateway;
//! wavebit deliberately doesn't (docs/discord-presence.md).
//!
//! One worker thread owns the connection and all protocol state. Everything
//! that goes out is rebuilt from a checked [`Activity`], never passed through.

use std::collections::{HashSet, VecDeque};
use std::io::{Read, Write};
#[cfg(not(windows))]
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use interprocess::TryClone;
use interprocess::local_socket::prelude::*;
use interprocess::local_socket::{GenericFilePath, Stream};
use napi::bindgen_prelude::Unknown;
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi::{Error, Result, Status};
use napi_derive::napi;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(3);
const MIN_BACKOFF: Duration = Duration::from_secs(1);
const MAX_BACKOFF: Duration = Duration::from_secs(30);
const MAX_FRAME_BYTES: usize = 64 * 1024;
/// Discord's text fields hold 2 to 128 characters.
const MAX_TEXT: usize = 128;
const MAX_LABEL: usize = 32;
const MAX_IMAGE_URL: usize = 256;
/// How far from now a timestamp may be: longer than any song at 0.5×.
const TIMESTAMP_WINDOW_MS: i64 = 8 * 24 * 60 * 60 * 1000;
static NEXT_NONCE: AtomicU64 = AtomicU64::new(1);

const ART_DOMAINS: [&str; 5] = [
    "scdn.co",
    "spotifycdn.com",
    "googleusercontent.com",
    "ggpht.com",
    "ytimg.com",
];
/// Pictures uploaded to wavebit's Discord application, named, never addressed.
const BADGE_ASSETS: [&str; 3] = ["youtube-music", "spotify", "file"];
const WAVEBIT_PAGE: &str = "https://github.com/Wavebit-app/wavebit";
/// arRPC (Vesktop's local RPC) answers READY with this made-up user.
const ARRPC_USER_ID: &str = "1045800378228281345";

// ---- What goes to Discord -----------------------------------------------------

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum PresenceStatus {
    Disabled,
    NotConfigured,
    Connecting,
    Connected,
    Waiting,
}

impl PresenceStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::Disabled => "disabled",
            Self::NotConfigured => "not_configured",
            Self::Connecting => "connecting",
            Self::Connected => "connected",
            Self::Waiting => "waiting",
        }
    }
}

#[derive(Deserialize, Serialize, Clone, PartialEq, Debug)]
#[serde(deny_unknown_fields)]
struct Activity {
    #[serde(rename = "type")]
    kind: u8,
    details: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    details_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    state: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    status_display_type: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    timestamps: Option<Timestamps>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    assets: Option<Assets>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    buttons: Option<Vec<Button>>,
}

#[derive(Deserialize, Serialize, Clone, PartialEq, Debug)]
#[serde(deny_unknown_fields)]
struct Timestamps {
    start: i64,
    end: i64,
}

#[derive(Deserialize, Serialize, Clone, PartialEq, Debug)]
#[serde(deny_unknown_fields)]
struct Assets {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    large_image: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    large_text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    small_image: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    small_text: Option<String>,
}

#[derive(Deserialize, Serialize, Clone, PartialEq, Debug)]
#[serde(deny_unknown_fields)]
struct Button {
    label: String,
    url: String,
}

/// Characters that hide or reorder text: controls, bidi overrides and
/// isolates, zero-width marks and the byte-order mark.
fn hidden_char(ch: char) -> bool {
    ch.is_control()
        || matches!(ch, '\u{200B}'..='\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2066}'..='\u{2069}' | '\u{FEFF}')
}

fn valid_text(value: &str, min: usize, max: usize) -> bool {
    let count = value.chars().count();
    (min..=max).contains(&count) && !value.chars().any(hidden_char) && !value.trim().is_empty()
}

fn all(value: &str, ok: impl Fn(u8) -> bool) -> bool {
    value.bytes().all(ok)
}

/// The only links that leave: a YouTube Music song, a Spotify track, wavebit's page.
fn allowed_link(url: &str) -> bool {
    if url == WAVEBIT_PAGE {
        return true;
    }
    if let Some(id) = url.strip_prefix("https://music.youtube.com/watch?v=") {
        return id.len() == 11 && all(id, |b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
    }
    if let Some(id) = url.strip_prefix("https://open.spotify.com/track/") {
        return id.len() == 22 && all(id, |b| b.is_ascii_alphanumeric());
    }
    false
}

/// A public HTTPS cover on one of the artwork CDNs, with no user info or port.
fn allowed_image(url: &str) -> bool {
    if url.len() > MAX_IMAGE_URL || !url.is_ascii() || url.chars().any(|c| c.is_whitespace()) {
        return false;
    }
    let Some(rest) = url.strip_prefix("https://") else {
        return false;
    };
    let host = rest.split(['/', '?', '#']).next().unwrap_or_default();
    if host.is_empty()
        || !all(host, |b| {
            b.is_ascii_alphanumeric() || b == b'.' || b == b'-'
        })
    {
        return false;
    }
    let host = host.to_ascii_lowercase();
    ART_DOMAINS
        .iter()
        .any(|d| host == *d || host.ends_with(&format!(".{d}")))
}

impl Activity {
    fn validate(&self, now_ms: i64) -> bool {
        let text = |v: &Option<String>| v.as_ref().is_none_or(|v| valid_text(v, 2, MAX_TEXT));
        [0, 2, 3, 5].contains(&self.kind)
            && valid_text(&self.details, 2, MAX_TEXT)
            && text(&self.state)
            && self.status_display_type.is_none_or(|v| v <= 2)
            && self.details_url.as_deref().is_none_or(allowed_link)
            && self.timestamps.as_ref().is_none_or(|t| {
                t.start >= 0
                    && t.end >= t.start
                    && (t.start - now_ms).abs() <= TIMESTAMP_WINDOW_MS
                    && (t.end - now_ms).abs() <= TIMESTAMP_WINDOW_MS
            })
            && self.assets.as_ref().is_none_or(|a| {
                a.large_image.as_deref().is_none_or(allowed_image)
                    && text(&a.large_text)
                    && a.small_image
                        .as_deref()
                        .is_none_or(|key| BADGE_ASSETS.contains(&key))
                    && text(&a.small_text)
                    && (a.large_image.is_some()
                        || a.small_image.is_some()
                        || a.large_text.is_none())
            })
            && self.buttons.as_ref().is_none_or(|buttons| {
                buttons.len() <= 2
                    && buttons
                        .iter()
                        .all(|b| valid_text(&b.label, 1, MAX_LABEL) && allowed_link(&b.url))
            })
    }
}

/// Parses and checks an activity from the main process. None if anything is off.
fn checked_activity(json_text: &str, now_ms: i64) -> Option<Activity> {
    if json_text.len() > MAX_FRAME_BYTES {
        return None;
    }
    let activity: Activity = serde_json::from_str(json_text).ok()?;
    activity.validate(now_ms).then_some(activity)
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

// ---- Who Discord says is signed in ---------------------------------------------

#[derive(Clone, PartialEq, Debug)]
struct DiscordUser {
    id: String,
    name: String,
    username: String,
    avatar_url: Option<String>,
}

fn clean_name(value: &str) -> Option<String> {
    let cleaned: String = value.chars().filter(|c| !hidden_char(*c)).collect();
    let cleaned = cleaned.trim();
    (!cleaned.is_empty()).then(|| cleaned.chars().take(MAX_LABEL).collect())
}

/// The user in a READY frame, checked piece by piece before an address is built from it.
fn ready_user(frame: &Value) -> Option<DiscordUser> {
    let user = frame.get("data")?.get("user")?;
    let id = user.get("id")?.as_str()?;
    if !(17..=20).contains(&id.len()) || !all(id, |b| b.is_ascii_digit()) || id == ARRPC_USER_ID {
        return None;
    }
    let username = clean_name(user.get("username")?.as_str()?)?;
    if username == "arrpc" {
        return None;
    }
    let name = user
        .get("global_name")
        .and_then(Value::as_str)
        .and_then(clean_name)
        .unwrap_or_else(|| username.clone());
    let avatar_url = user.get("avatar").and_then(Value::as_str).and_then(|hash| {
        let bare = hash.strip_prefix("a_").unwrap_or(hash);
        (bare.len() == 32 && all(bare, |b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)))
            .then(|| format!("https://cdn.discordapp.com/avatars/{id}/{hash}.png?size=128"))
    });
    Some(DiscordUser {
        id: id.to_string(),
        name,
        username,
        avatar_url,
    })
}

// ---- Rate limit -------------------------------------------------------------------

/// At least a second between updates and no more than five in twenty seconds.
#[derive(Default)]
struct Throttle {
    sent: VecDeque<Instant>,
}

impl Throttle {
    const GAP: Duration = Duration::from_secs(1);
    const WINDOW: Duration = Duration::from_secs(20);
    const BURST: usize = 5;

    /// How long to wait before the next send; zero when it may go now.
    fn wait(&mut self, now: Instant) -> Duration {
        while self
            .sent
            .front()
            .is_some_and(|t| now.duration_since(*t) >= Self::WINDOW)
        {
            self.sent.pop_front();
        }
        let gap = self
            .sent
            .back()
            .map(|last| Self::GAP.saturating_sub(now.duration_since(*last)))
            .unwrap_or_default();
        let burst = if self.sent.len() >= Self::BURST {
            Self::WINDOW.saturating_sub(now.duration_since(self.sent[0]))
        } else {
            Duration::ZERO
        };
        gap.max(burst)
    }

    fn record(&mut self, now: Instant) {
        self.sent.push_back(now);
    }
}

// ---- Finding the socket ---------------------------------------------------------

struct Endpoint {
    name: String,
    /// Which client lives there, when its place says so ("Vesktop · Flatpak").
    client: Option<&'static str>,
}

fn endpoints() -> Vec<Endpoint> {
    #[cfg(windows)]
    {
        (0..10)
            .map(|i| Endpoint {
                name: format!(r"\\.\pipe\discord-ipc-{i}"),
                client: None,
            })
            .collect()
    }
    #[cfg(not(windows))]
    {
        let mut roots = Vec::new();
        for key in ["XDG_RUNTIME_DIR", "TMPDIR", "TMP", "TEMP"] {
            if let Some(value) = std::env::var_os(key) {
                if !value.is_empty() {
                    let root = PathBuf::from(value);
                    if key == "XDG_RUNTIME_DIR" {
                        roots.extend(flatpak_runtime_roots(&root));
                    }
                    roots.push(root);
                }
            }
        }
        roots.push(PathBuf::from("/tmp"));
        endpoint_names_from_roots(roots)
            .into_iter()
            .filter(|name| owned_socket(Path::new(name)))
            .map(|name| Endpoint {
                client: client_label(&name),
                name,
            })
            .collect()
    }
}

/// Flatpak clients keep their runtime sockets in `app/<application-id>` or
/// `.flatpak/<application-id>/xdg-run`. Only direct application directories
/// under this user's runtime root are listed; nothing else is searched.
#[cfg(not(windows))]
fn flatpak_runtime_roots(runtime: &Path) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    for parent in [runtime.join("app"), runtime.join(".flatpak")] {
        let Ok(entries) = std::fs::read_dir(parent) else {
            continue;
        };
        for entry in entries.flatten() {
            let app_dir = entry.path();
            // A link could point anywhere; only real directories count.
            if !entry.file_type().is_ok_and(|t| t.is_dir()) {
                continue;
            }
            roots.push(app_dir.clone());
            if app_dir
                .parent()
                .and_then(Path::file_name)
                .is_some_and(|name| name == ".flatpak")
            {
                let xdg_run = app_dir.join("xdg-run");
                if std::fs::symlink_metadata(&xdg_run).is_ok_and(|m| m.is_dir()) {
                    roots.push(xdg_run);
                }
            }
        }
    }
    roots
}

#[cfg(not(windows))]
fn endpoint_names_from_roots(roots: Vec<PathBuf>) -> Vec<String> {
    let mut seen = HashSet::new();
    roots
        .into_iter()
        .flat_map(|root| (0..10).map(move |i| root.join(format!("discord-ipc-{i}"))))
        .filter_map(|path| {
            let text = path.to_string_lossy().into_owned();
            seen.insert(text.clone()).then_some(text)
        })
        .collect()
}

/// A Discord socket is used only if it is a real socket, not a link, and is
/// owned by this user. Another account on the computer could otherwise plant
/// `/tmp/discord-ipc-0` and read what is playing.
#[cfg(unix)]
fn owned_socket(path: &Path) -> bool {
    use std::os::unix::fs::{FileTypeExt, MetadataExt};
    let Ok(meta) = std::fs::symlink_metadata(path) else {
        return false;
    };
    // SAFETY: geteuid has no preconditions and cannot fail.
    let me = unsafe { libc::geteuid() };
    meta.file_type().is_socket() && meta.uid() == me
}

#[cfg(all(not(unix), not(windows)))]
fn owned_socket(_path: &Path) -> bool {
    false
}

/// The client a Flatpak socket belongs to, from its application id.
#[cfg(not(windows))]
fn client_label(path: &str) -> Option<&'static str> {
    const KNOWN: [(&str, &str); 6] = [
        ("com.discordapp.DiscordCanary", "Discord Canary · Flatpak"),
        ("com.discordapp.DiscordPTB", "Discord PTB · Flatpak"),
        ("com.discordapp.Discord", "Discord · Flatpak"),
        ("dev.vencord.Vesktop", "Vesktop · Flatpak"),
        ("app.legcord.Legcord", "Legcord · Flatpak"),
        ("xyz.armcord.ArmCord", "ArmCord · Flatpak"),
    ];
    let app = path
        .split('/')
        .collect::<Vec<_>>()
        .windows(2)
        .find(|w| w[0] == "app" || w[0] == ".flatpak")
        .map(|w| w[1])?;
    Some(
        KNOWN
            .iter()
            .find(|(id, _)| *id == app)
            .map(|(_, label)| *label)
            .unwrap_or("Flatpak"),
    )
}

// ---- Framing ----------------------------------------------------------------------

fn write_packet(stream: &mut impl Write, opcode: u32, body: &[u8]) -> std::io::Result<()> {
    if body.len() > MAX_FRAME_BYTES {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "Discord RPC frame too large",
        ));
    }
    let mut packet = Vec::with_capacity(8 + body.len());
    packet.extend_from_slice(&opcode.to_le_bytes());
    packet.extend_from_slice(&(body.len() as u32).to_le_bytes());
    packet.extend_from_slice(body);
    stream.write_all(&packet)
}

fn read_packet(stream: &mut impl Read) -> std::io::Result<(u32, Vec<u8>)> {
    let mut header = [0u8; 8];
    stream.read_exact(&mut header)?;
    let opcode = u32::from_le_bytes([header[0], header[1], header[2], header[3]]);
    let size = u32::from_le_bytes([header[4], header[5], header[6], header[7]]) as usize;
    if size > MAX_FRAME_BYTES {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "Discord RPC frame too large",
        ));
    }
    let mut body = vec![0u8; size];
    stream.read_exact(&mut body)?;
    Ok((opcode, body))
}

// ---- The worker -------------------------------------------------------------------

enum Command {
    Enable(bool),
    Activity(Option<Activity>),
    Retry,
    Shutdown(Sender<()>),
}

enum Msg {
    Command(Command),
    /// A frame from connection `n`; frames from an older connection are ignored.
    Frame(u64, Value),
    Closed(u64),
    /// The client sent CLOSE. Before READY that means it refused the application id.
    Refused(u64),
}

struct Connection {
    id: u64,
    writer: Arc<Mutex<Stream>>,
    client: Option<&'static str>,
}

static NEXT_CONNECTION: AtomicU64 = AtomicU64::new(1);

fn read_loop(id: u64, mut reader: Stream, writer: Arc<Mutex<Stream>>, send: Sender<Msg>) {
    loop {
        let Ok((opcode, body)) = read_packet(&mut reader) else {
            let _ = send.send(Msg::Closed(id));
            return;
        };
        match opcode {
            1 => match serde_json::from_slice::<Value>(&body) {
                Ok(value) if value.is_object() => {
                    if send.send(Msg::Frame(id, value)).is_err() {
                        return;
                    }
                }
                _ => {
                    let _ = send.send(Msg::Closed(id));
                    return;
                }
            },
            2 => {
                let _ = send.send(Msg::Refused(id));
                return;
            }
            // PING: answered with PONG and the same body.
            3 => {
                let ok = writer
                    .lock()
                    .map(|mut stream| write_packet(&mut *stream, 4, &body).is_ok())
                    .unwrap_or(false);
                if !ok {
                    let _ = send.send(Msg::Closed(id));
                    return;
                }
            }
            _ => {}
        }
    }
}

fn connect(client_id: &str, inbox: &Sender<Msg>) -> std::io::Result<Connection> {
    let mut last_error = None;
    for endpoint in endpoints() {
        let name = match endpoint.name.as_str().to_fs_name::<GenericFilePath>() {
            Ok(name) => name,
            Err(error) => {
                last_error = Some(error);
                continue;
            }
        };
        let mut stream = match Stream::connect(name) {
            Ok(stream) => stream,
            Err(error) => {
                last_error = Some(error);
                continue;
            }
        };
        let body = serde_json::to_vec(&json!({ "v": 1, "client_id": client_id }))
            .map_err(std::io::Error::other)?;
        if let Err(error) = write_packet(&mut stream, 0, &body) {
            last_error = Some(error);
            continue;
        }
        let reader = stream.try_clone()?;
        let writer = Arc::new(Mutex::new(stream));
        let id = NEXT_CONNECTION.fetch_add(1, Ordering::Relaxed);
        let reader_writer = Arc::clone(&writer);
        let send = inbox.clone();
        thread::Builder::new()
            .name("wavebit-discord-reader".into())
            .spawn(move || read_loop(id, reader, reader_writer, send))?;
        return Ok(Connection {
            id,
            writer,
            client: endpoint.client,
        });
    }
    Err(last_error.unwrap_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::NotFound, "Discord IPC not found")
    }))
}

fn send_frame(writer: &Arc<Mutex<Stream>>, opcode: u32, payload: &Value) -> std::io::Result<()> {
    let body = serde_json::to_vec(payload).map_err(std::io::Error::other)?;
    let mut stream = writer
        .lock()
        .map_err(|_| std::io::Error::other("Discord RPC writer failed"))?;
    write_packet(&mut *stream, opcode, &body)
}

fn set_activity_frame(activity: Option<&Activity>, nonce: &str) -> Value {
    json!({
        "cmd": "SET_ACTIVITY",
        "args": { "pid": std::process::id(), "activity": activity },
        "nonce": nonce,
    })
}

fn close_connection(connection: &Connection) {
    let nonce = format!("wavebit-{}", NEXT_NONCE.fetch_add(1, Ordering::Relaxed));
    let _ = send_frame(&connection.writer, 1, &set_activity_frame(None, &nonce));
    if let Ok(mut writer) = connection.writer.lock() {
        let _ = write_packet(&mut *writer, 2, b"{}");
    }
}

/// What the main process is told: no credential, no path, nothing from Discord unchecked.
#[derive(Clone, PartialEq, Debug)]
struct Report {
    status: PresenceStatus,
    user: Option<DiscordUser>,
    client: Option<&'static str>,
    rejected: bool,
    /// The client closed the handshake: Discord doesn't know this application id.
    refused_id: bool,
    showing: bool,
    sent_at: Option<i64>,
}

impl Report {
    fn json(&self) -> String {
        json!({
            "status": self.status.as_str(),
            "user": self.user.as_ref().map(|u| json!({
                "id": u.id,
                "name": u.name,
                "username": u.username,
                "avatarUrl": u.avatar_url,
            })),
            "client": self.client,
            "problem": if self.refused_id {
                Some("app_id")
            } else if self.rejected {
                Some("rejected")
            } else {
                None
            },
            "showing": self.showing,
            "sentAt": self.sent_at,
        })
        .to_string()
    }
}

struct Worker {
    client_id: String,
    inbox: Receiver<Msg>,
    outbox: Sender<Msg>,
    report: Box<dyn Fn(String) + Send>,
    last_report: Option<Report>,
    state: Report,
    enabled: bool,
    desired: Option<Activity>,
    connection: Option<Connection>,
    /// What this connection was last sent; None before the first send.
    delivered: Option<Option<Activity>>,
    /// The nonce of the last SET_ACTIVITY and whether it carried an activity.
    pending: Option<(String, bool)>,
    throttle: Throttle,
    backoff: Duration,
}

impl Worker {
    fn publish(&mut self) {
        if self.last_report.as_ref() != Some(&self.state) {
            self.last_report = Some(self.state.clone());
            (self.report)(self.state.json());
        }
    }

    fn set_status(&mut self, status: PresenceStatus) {
        self.state.status = status;
        if status != PresenceStatus::Connected {
            self.state.user = None;
            self.state.client = None;
            self.state.rejected = false;
            self.state.showing = false;
        }
        self.publish();
    }

    fn drop_connection(&mut self, polite: bool) {
        if let Some(connection) = self.connection.take() {
            if polite {
                close_connection(&connection);
            }
        }
        self.delivered = None;
        self.pending = None;
    }

    /// Handles one command; false means stop.
    fn command(&mut self, command: Command) -> bool {
        match command {
            Command::Enable(enabled) => {
                if enabled && !valid_client_id(&self.client_id) {
                    self.enabled = false;
                    self.set_status(PresenceStatus::NotConfigured);
                    return true;
                }
                self.enabled = enabled;
                if !enabled {
                    self.state.refused_id = false;
                    self.drop_connection(true);
                    self.set_status(PresenceStatus::Disabled);
                } else if self.connection.is_none() {
                    self.backoff = MIN_BACKOFF;
                    self.set_status(PresenceStatus::Connecting);
                }
            }
            Command::Activity(activity) => self.desired = activity,
            Command::Retry => {
                self.drop_connection(true);
                self.backoff = MIN_BACKOFF;
                if self.enabled {
                    self.set_status(PresenceStatus::Connecting);
                }
            }
            Command::Shutdown(done) => {
                self.drop_connection(true);
                self.set_status(PresenceStatus::Disabled);
                let _ = done.send(());
                return false;
            }
        }
        true
    }

    fn frame(&mut self, frame: Value) {
        let evt = frame.get("evt").and_then(Value::as_str);
        let nonce = frame.get("nonce").and_then(Value::as_str);
        let Some((pending, carried)) = self.pending.clone() else {
            return;
        };
        if nonce != Some(pending.as_str()) {
            return;
        }
        self.pending = None;
        if evt == Some("ERROR") {
            // Discord's message is never passed on; only that it refused.
            self.state.rejected = true;
        } else if frame.get("cmd").and_then(Value::as_str) == Some("SET_ACTIVITY") {
            self.state.rejected = false;
            self.state.showing = carried;
            if carried {
                self.state.sent_at = Some(now_ms());
            }
        }
        self.publish();
    }

    /// Sends the desired activity when it differs from what this connection has.
    fn deliver(&mut self) -> Option<Duration> {
        let connection = self.connection.as_ref()?;
        if self.delivered.as_ref() == Some(&self.desired) {
            return None;
        }
        // A fresh connection shows nothing, so a clear needn't be sent to it.
        if self.delivered.is_none() && self.desired.is_none() {
            self.delivered = Some(None);
            return None;
        }
        let now = Instant::now();
        let wait = self.throttle.wait(now);
        if !wait.is_zero() {
            return Some(wait);
        }
        let nonce = format!("wavebit-{}", NEXT_NONCE.fetch_add(1, Ordering::Relaxed));
        let frame = set_activity_frame(self.desired.as_ref(), &nonce);
        if send_frame(&connection.writer, 1, &frame).is_err() {
            self.drop_connection(false);
            self.set_status(PresenceStatus::Waiting);
            return None;
        }
        self.throttle.record(now);
        self.pending = Some((nonce, self.desired.is_some()));
        self.delivered = Some(self.desired.clone());
        None
    }

    /// Opens a connection and waits for READY, still answering commands.
    fn open(&mut self) -> bool {
        self.set_status(PresenceStatus::Connecting);
        let Ok(connection) = connect(&self.client_id, &self.outbox) else {
            return true;
        };
        let deadline = Instant::now() + HANDSHAKE_TIMEOUT;
        loop {
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                close_connection(&connection);
                return true;
            }
            match self.inbox.recv_timeout(left) {
                Ok(Msg::Command(command)) => {
                    if !self.command(command) {
                        close_connection(&connection);
                        return false;
                    }
                    if !self.enabled || self.state.status != PresenceStatus::Connecting {
                        close_connection(&connection);
                        return true;
                    }
                }
                Ok(Msg::Frame(id, frame)) if id == connection.id => {
                    if frame.get("evt").and_then(Value::as_str) == Some("READY") {
                        self.state.user = ready_user(&frame);
                        self.state.client = connection.client;
                        self.state.rejected = false;
                        self.state.refused_id = false;
                        self.state.showing = false;
                        self.connection = Some(connection);
                        self.delivered = None;
                        self.pending = None;
                        self.backoff = MIN_BACKOFF;
                        self.set_status(PresenceStatus::Connected);
                        return true;
                    }
                }
                Ok(Msg::Closed(id)) if id == connection.id => return true,
                Ok(Msg::Refused(id)) if id == connection.id => {
                    self.state.refused_id = true;
                    return true;
                }
                Ok(_) => {}
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => return false,
            }
        }
    }

    fn run(mut self) {
        self.set_status(if valid_client_id(&self.client_id) {
            PresenceStatus::Disabled
        } else {
            PresenceStatus::NotConfigured
        });
        loop {
            let wait = if !self.enabled {
                None
            } else if self.connection.is_none() {
                if !self.open() {
                    break;
                }
                if self.connection.is_none() {
                    if !self.enabled {
                        continue;
                    }
                    if self.state.status == PresenceStatus::Connecting {
                        self.set_status(PresenceStatus::Waiting);
                    }
                    let wait = self.backoff;
                    self.backoff = (self.backoff * 2).min(MAX_BACKOFF);
                    Some(wait)
                } else {
                    Some(Duration::ZERO)
                }
            } else {
                self.deliver()
            };
            let message = match wait {
                None => self
                    .inbox
                    .recv()
                    .map_err(|_| RecvTimeoutError::Disconnected),
                Some(wait) if wait.is_zero() => continue,
                Some(wait) => self.inbox.recv_timeout(wait),
            };
            match message {
                Ok(Msg::Command(command)) => {
                    if !self.command(command) {
                        break;
                    }
                }
                Ok(Msg::Frame(id, frame)) => {
                    if self.connection.as_ref().is_some_and(|c| c.id == id) {
                        self.frame(frame);
                    }
                }
                Ok(Msg::Closed(id) | Msg::Refused(id)) => {
                    if self.connection.as_ref().is_some_and(|c| c.id == id) {
                        self.drop_connection(false);
                        self.set_status(PresenceStatus::Waiting);
                    }
                }
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => break,
            }
        }
        self.drop_connection(true);
    }
}

fn valid_client_id(value: &str) -> bool {
    (17..=20).contains(&value.len()) && all(value, |b| b.is_ascii_digit())
}

/// One Discord local RPC connection. It receives only checked display data
/// from the main process, never a credential or a path, and reports only
/// checked status: who is signed in, which client, and whether a card shows.
#[napi]
pub struct DiscordPresence {
    commands: Sender<Msg>,
    worker: Option<JoinHandle<()>>,
}

#[napi]
impl DiscordPresence {
    #[napi(constructor)]
    pub fn new(
        client_id: String,
        on_status: ThreadsafeFunction<String, Unknown<'static>, String, Status, false>,
    ) -> Result<Self> {
        let (commands, inbox) = mpsc::channel();
        let outbox = commands.clone();
        let report = Box::new(move |json: String| {
            on_status.call(json, ThreadsafeFunctionCallMode::NonBlocking);
        });
        let worker = thread::Builder::new()
            .name("wavebit-discord-presence".into())
            .spawn(move || {
                Worker {
                    client_id,
                    inbox,
                    outbox,
                    report,
                    last_report: None,
                    state: Report {
                        status: PresenceStatus::Disabled,
                        user: None,
                        client: None,
                        rejected: false,
                        refused_id: false,
                        showing: false,
                        sent_at: None,
                    },
                    enabled: false,
                    desired: None,
                    connection: None,
                    delivered: None,
                    pending: None,
                    throttle: Throttle::default(),
                    backoff: MIN_BACKOFF,
                }
                .run()
            })
            .map_err(|e| Error::new(Status::GenericFailure, format!("discord: {e}")))?;
        Ok(Self {
            commands,
            worker: Some(worker),
        })
    }

    #[napi]
    pub fn enable(&self, enabled: bool) {
        let _ = self.commands.send(Msg::Command(Command::Enable(enabled)));
    }

    /// Sets the card. Returns false, and changes nothing, if the activity
    /// fails any check.
    #[napi]
    pub fn set_activity(&self, json_text: String) -> bool {
        let Some(activity) = checked_activity(&json_text, now_ms()) else {
            return false;
        };
        let _ = self
            .commands
            .send(Msg::Command(Command::Activity(Some(activity))));
        true
    }

    #[napi]
    pub fn clear(&self) {
        let _ = self.commands.send(Msg::Command(Command::Activity(None)));
    }

    #[napi]
    pub fn retry(&self) {
        let _ = self.commands.send(Msg::Command(Command::Retry));
    }

    #[napi]
    pub fn shutdown(&mut self, wait_ms: u32) {
        let Some(worker) = self.worker.take() else {
            return;
        };
        let (done, wait) = mpsc::channel();
        let _ = self.commands.send(Msg::Command(Command::Shutdown(done)));
        if wait
            .recv_timeout(Duration::from_millis(wait_ms.min(3000) as u64))
            .is_ok()
        {
            let _ = worker.join();
        }
    }
}

impl Drop for DiscordPresence {
    fn drop(&mut self) {
        if self.worker.is_some() {
            let (done, _wait) = mpsc::channel();
            let _ = self.commands.send(Msg::Command(Command::Shutdown(done)));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_795_680_000_000;

    fn activity(json: &str) -> Option<Activity> {
        checked_activity(json, NOW)
    }

    #[test]
    fn client_ids_are_public_numeric_application_ids() {
        assert!(valid_client_id("12345678901234567"));
        assert!(!valid_client_id(""));
        assert!(!valid_client_id("not-an-id"));
        assert!(!valid_client_id("123"));
    }

    #[test]
    fn a_full_card_passes_and_is_rebuilt_from_its_fields() {
        let json = format!(
            r#"{{"type":2,"status_display_type":1,"details":"Night Drive [1.25×]",
            "details_url":"https://music.youtube.com/watch?v=MV_3Dpw-BRY","state":"Kavinsky · OutRun",
            "timestamps":{{"start":{},"end":{}}},
            "assets":{{"large_image":"https://lh3.googleusercontent.com/abc=w544-h544","large_text":"OutRun",
            "small_image":"youtube-music","small_text":"From YouTube Music"}},
            "buttons":[{{"label":"Listen on YouTube Music","url":"https://music.youtube.com/watch?v=MV_3Dpw-BRY"}},
            {{"label":"Get wavebit","url":"https://github.com/Wavebit-app/wavebit"}}]}}"#,
            NOW - 51_000,
            NOW + 108_000
        );
        let parsed = activity(&json).expect("valid");
        let out = serde_json::to_value(&parsed).unwrap();
        assert_eq!(out["buttons"][1]["label"], "Get wavebit");
        assert!(out.get("name").is_none());
    }

    #[test]
    fn unknown_fields_and_bad_types_are_refused() {
        assert!(activity(r#"{"type":2,"details":"Song","state":"Artist"}"#).is_some());
        assert!(activity(r#"{"type":1,"details":"Song"}"#).is_none());
        assert!(activity(r#"{"type":2,"details":"Song","token":"secret"}"#).is_none());
        assert!(activity(r#"{"type":2,"details":"Song","status_display_type":3}"#).is_none());
        assert!(activity(r#"{"type":2,"details":"S"}"#).is_none());
    }

    #[test]
    fn hidden_characters_and_long_text_are_refused() {
        assert!(activity("{\"type\":2,\"details\":\"Song\\u202e\"}").is_none());
        assert!(activity("{\"type\":2,\"details\":\"So\\u200bng\"}").is_none());
        assert!(activity("{\"type\":2,\"details\":\"Song\\n\"}").is_none());
        let long = "a".repeat(129);
        assert!(activity(&format!(r#"{{"type":2,"details":"{long}"}}"#)).is_none());
    }

    #[test]
    fn buttons_are_capped_checked_and_limited_to_three_links() {
        let card = |buttons: &str| {
            activity(&format!(
                r#"{{"type":2,"details":"Song","buttons":[{buttons}]}}"#
            ))
        };
        let ok = r#"{"label":"Get wavebit","url":"https://github.com/Wavebit-app/wavebit"}"#;
        assert!(card(ok).is_some());
        assert!(card(&[ok, ok, ok].join(",")).is_none());
        assert!(card(r#"{"label":"Get wavebit","url":"https://evil.example/"}"#).is_none());
        assert!(
            card(r#"{"label":"x","url":"https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC"}"#)
                .is_some()
        );
        assert!(card(r#"{"label":"x","url":"https://open.spotify.com/track/4uLU6hMC"}"#).is_none());
        assert!(
            card(r#"{"label":"x","url":"https://music.youtube.com/watch?v=MV_3Dpw-BRY&x=1"}"#)
                .is_none()
        );
        let long = "a".repeat(33);
        assert!(
            card(&format!(
                r#"{{"label":"{long}","url":"https://github.com/Wavebit-app/wavebit"}}"#
            ))
            .is_none()
        );
    }

    #[test]
    fn images_must_be_public_covers_and_badges_named_assets() {
        assert!(allowed_image("https://i.scdn.co/image/ab67616d0000b273"));
        assert!(allowed_image(
            "https://i.ytimg.com/vi/MV_3Dpw-BRY/hqdefault.jpg"
        ));
        assert!(!allowed_image("http://i.ytimg.com/vi/x/hq.jpg"));
        assert!(!allowed_image("https://user@i.ytimg.com/x"));
        assert!(!allowed_image("https://i.ytimg.com:8443/x"));
        assert!(!allowed_image("https://evil.com/i.ytimg.com"));
        assert!(!allowed_image("https://notytimg.com/x"));
        assert!(!allowed_image(&format!(
            "https://i.ytimg.com/{}",
            "a".repeat(260)
        )));
        let badge = |key: &str| {
            activity(&format!(
                r#"{{"type":2,"details":"Song","assets":{{"small_image":"{key}"}}}}"#
            ))
        };
        assert!(badge("spotify").is_some());
        assert!(badge("https://i.ytimg.com/x").is_none());
    }

    #[test]
    fn timestamps_stay_near_now() {
        let card = |s: i64, e: i64| {
            activity(&format!(
                r#"{{"type":2,"details":"Song","timestamps":{{"start":{s},"end":{e}}}}}"#
            ))
        };
        assert!(card(NOW - 60_000, NOW + 120_000).is_some());
        assert!(card(NOW, NOW - 1).is_none());
        assert!(card(NOW - 9 * 24 * 3_600_000, NOW).is_none());
        // Seconds instead of milliseconds are far from now and refused.
        assert!(card(NOW / 1000, NOW / 1000 + 60).is_none());
    }

    #[test]
    fn ready_user_is_checked_before_an_address_is_built() {
        let frame = |id: &str, avatar: &str| {
            json!({ "evt": "READY", "data": { "user": {
                "id": id, "username": "maya.k", "global_name": "Maya\u{202e}", "avatar": avatar } } })
        };
        let user = ready_user(&frame(
            "123456789012345678",
            "0123456789abcdef0123456789abcdef",
        ))
        .unwrap();
        assert_eq!(user.name, "Maya");
        assert_eq!(
            user.avatar_url.as_deref(),
            Some(
                "https://cdn.discordapp.com/avatars/123456789012345678/0123456789abcdef0123456789abcdef.png?size=128"
            )
        );
        let odd = ready_user(&frame("123456789012345678", "../../x")).unwrap();
        assert!(odd.avatar_url.is_none());
        assert!(ready_user(&frame("12/../345678901234", "")).is_none());
        assert!(ready_user(&frame(ARRPC_USER_ID, "")).is_none());
    }

    #[test]
    fn throttle_spaces_updates_and_caps_bursts() {
        let mut throttle = Throttle::default();
        let start = Instant::now();
        assert!(throttle.wait(start).is_zero());
        throttle.record(start);
        assert_eq!(throttle.wait(start), Duration::from_secs(1));
        let mut t = start;
        for _ in 0..4 {
            t += Duration::from_secs(1);
            assert!(throttle.wait(t).is_zero());
            throttle.record(t);
        }
        // Five in the window: the sixth waits until the first is 20 s old.
        assert_eq!(
            throttle.wait(t + Duration::from_secs(1)),
            Duration::from_secs(15)
        );
        assert!(throttle.wait(start + Duration::from_secs(20)).is_zero());
    }

    #[test]
    fn status_report_carries_no_secret_and_maps_problems() {
        let report = Report {
            status: PresenceStatus::Connected,
            user: None,
            client: Some("Vesktop · Flatpak"),
            rejected: true,
            refused_id: false,
            showing: false,
            sent_at: None,
        };
        let value: Value = serde_json::from_str(&report.json()).unwrap();
        assert_eq!(value["problem"], "rejected");
        let refused = Report {
            refused_id: true,
            ..report.clone()
        };
        let value: Value = serde_json::from_str(&refused.json()).unwrap();
        assert_eq!(value["problem"], "app_id");
        assert_eq!(value["client"], "Vesktop · Flatpak");
        assert_eq!(value.as_object().unwrap().len(), 6);
    }

    #[cfg(not(windows))]
    #[test]
    fn flatpak_clients_are_named_from_their_application_id() {
        assert_eq!(
            client_label("/run/user/1000/.flatpak/dev.vencord.Vesktop/xdg-run/discord-ipc-0"),
            Some("Vesktop · Flatpak")
        );
        assert_eq!(
            client_label("/run/user/1000/app/com.discordapp.Discord/discord-ipc-0"),
            Some("Discord · Flatpak")
        );
        assert_eq!(
            client_label("/run/user/1000/app/org.example.Chat/discord-ipc-0"),
            Some("Flatpak")
        );
        assert_eq!(client_label("/run/user/1000/discord-ipc-0"), None);
    }

    #[cfg(not(windows))]
    #[test]
    fn endpoint_discovery_includes_vesktop_flatpak_runtime_socket() {
        let endpoints = endpoint_names_from_roots(vec![
            PathBuf::from("/run/user/1000/.flatpak/dev.vencord.Vesktop/xdg-run"),
            PathBuf::from("/run/user/1000"),
        ]);
        assert!(endpoints.iter().any(|endpoint| {
            endpoint == "/run/user/1000/.flatpak/dev.vencord.Vesktop/xdg-run/discord-ipc-0"
        }));
        assert!(
            endpoints
                .iter()
                .any(|endpoint| endpoint == "/run/user/1000/discord-ipc-0")
        );
    }

    #[cfg(not(windows))]
    #[test]
    fn flatpak_runtime_discovery_covers_unknown_clients_without_recursive_scanning() {
        let root = std::env::temp_dir().join(format!(
            "wavebit-discord-runtime-test-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("app/com.discordapp.Discord")).unwrap();
        std::fs::create_dir_all(root.join(".flatpak/dev.vencord.Vesktop/xdg-run")).unwrap();
        std::fs::create_dir_all(root.join("nested/not-a-client")).unwrap();

        let discovered = flatpak_runtime_roots(&root);
        assert!(discovered.contains(&root.join("app/com.discordapp.Discord")));
        assert!(discovered.contains(&root.join(".flatpak/dev.vencord.Vesktop")));
        assert!(discovered.contains(&root.join(".flatpak/dev.vencord.Vesktop/xdg-run")));
        assert!(
            !discovered
                .iter()
                .any(|path| path.ends_with("nested/not-a-client"))
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn only_real_sockets_owned_by_this_user_are_used() {
        use std::os::unix::net::UnixListener;
        let dir =
            std::env::temp_dir().join(format!("wavebit-discord-owner-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let socket = dir.join("discord-ipc-0");
        let _listener = UnixListener::bind(&socket).unwrap();
        assert!(owned_socket(&socket));

        let link = dir.join("discord-ipc-1");
        std::os::unix::fs::symlink(&socket, &link).unwrap();
        assert!(!owned_socket(&link));

        let file = dir.join("discord-ipc-2");
        std::fs::write(&file, b"").unwrap();
        assert!(!owned_socket(&file));
        assert!(!owned_socket(&dir.join("discord-ipc-3")));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn packet_framing_round_trips_and_rejects_oversized_frames() {
        let mut bytes = Vec::new();
        write_packet(&mut bytes, 1, b"{} ").unwrap();
        let (opcode, body) = read_packet(&mut bytes.as_slice()).unwrap();
        assert_eq!(opcode, 1);
        assert_eq!(body, b"{} ");

        let mut oversized = Vec::new();
        oversized.extend_from_slice(&1u32.to_le_bytes());
        oversized.extend_from_slice(&((MAX_FRAME_BYTES as u32) + 1).to_le_bytes());
        assert!(read_packet(&mut oversized.as_slice()).is_err());
    }
}
