//! Discord Rich Presence over Discord's per-user local IPC endpoint.
//!
//! This client sends display-only activity data to the signed-in Discord
//! desktop client. It never authenticates to Discord's HTTP API or handles a
//! user credential. One worker owns the connection and protocol state.

use std::collections::HashSet;
use std::io::{Read, Write};
#[cfg(not(windows))]
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use interprocess::local_socket::prelude::*;
use interprocess::local_socket::{GenericFilePath, Stream};
use interprocess::TryClone;
use napi::bindgen_prelude::Unknown;
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi::{Error, Result, Status};
use napi_derive::napi;
use serde::Deserialize;
use serde_json::{json, Value};

const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(3);
const MIN_BACKOFF: Duration = Duration::from_secs(1);
const MAX_BACKOFF: Duration = Duration::from_secs(30);
const MAX_FRAME_BYTES: usize = 1024 * 1024;
static NEXT_NONCE: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Copy, PartialEq, Eq)]
enum PresenceStatus {
    Disabled,
    NotConfigured,
    Connecting,
    Connected,
    Waiting,
    Error,
}

impl PresenceStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::Disabled => "disabled",
            Self::NotConfigured => "not_configured",
            Self::Connecting => "connecting",
            Self::Connected => "connected",
            Self::Waiting => "waiting",
            Self::Error => "error",
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Activity {
    #[serde(rename = "type")]
    kind: u8,
    details: String,
    #[serde(default)]
    state: Option<String>,
    #[serde(default)]
    timestamps: Option<Timestamps>,
    #[serde(default)]
    assets: Option<Assets>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Timestamps {
    start: i64,
    end: i64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Assets {
    large_image: String,
    #[serde(default)]
    large_text: Option<String>,
}

impl Activity {
    fn validate(&self) -> bool {
        [0, 2, 3, 5].contains(&self.kind)
            && valid_text(&self.details, 128)
            && self.state.as_ref().is_none_or(|v| valid_text(v, 128))
            && self
                .timestamps
                .as_ref()
                .is_none_or(|t| t.start >= 0 && t.end >= t.start && t.end <= i64::MAX / 2)
            && self.assets.as_ref().is_none_or(|a| {
                a.large_image.len() <= 2048
                    && a.large_image.starts_with("https://")
                    && a.large_text.as_ref().is_none_or(|v| valid_text(v, 128))
            })
    }
}

fn valid_text(value: &str, max_chars: usize) -> bool {
    value.chars().count() <= max_chars && !value.chars().any(|ch| ch.is_control())
}

enum Command {
    Enable(bool),
    Activity(Option<Value>),
    Retry,
    Shutdown(Sender<()>),
}

enum ReaderEvent {
    Frame(Value),
    Closed,
}

struct Connection {
    writer: Arc<Mutex<Stream>>,
    events: Receiver<ReaderEvent>,
}

fn endpoint_names() -> Vec<String> {
    #[cfg(windows)]
    {
        (0..10)
            .map(|i| format!(r"\\.\pipe\discord-ipc-{i}"))
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
    }
}

/// Flatpak clients commonly put their runtime sockets in one of two places:
/// `app/<application-id>` or `.flatpak/<application-id>/xdg-run`. Enumerate
/// only direct application directories under this user's runtime root. This
/// covers Discord variants without hard-coding a client brand or scanning the
/// rest of the filesystem.
#[cfg(not(windows))]
fn flatpak_runtime_roots(runtime: &Path) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    for parent in [runtime.join("app"), runtime.join(".flatpak")] {
        let Ok(entries) = std::fs::read_dir(parent) else {
            continue;
        };
        for entry in entries.flatten() {
            let app_dir = entry.path();
            if !app_dir.is_dir() {
                continue;
            }
            roots.push(app_dir.clone());
            if app_dir
                .parent()
                .and_then(Path::file_name)
                .is_some_and(|name| name == ".flatpak")
            {
                let xdg_run = app_dir.join("xdg-run");
                if xdg_run.is_dir() {
                    roots.push(xdg_run);
                }
            }
        }
    }
    roots
}

#[cfg(not(windows))]
fn endpoint_names_from_roots(roots: Vec<std::path::PathBuf>) -> Vec<String> {
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

fn write_packet(stream: &mut impl Write, opcode: u32, body: &[u8]) -> std::io::Result<()> {
    if body.len() > MAX_FRAME_BYTES {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "Discord RPC frame too large",
        ));
    }
    stream.write_all(&opcode.to_le_bytes())?;
    stream.write_all(&(body.len() as u32).to_le_bytes())?;
    stream.write_all(body)
}

fn read_packet(stream: &mut impl Read) -> std::io::Result<(u32, Vec<u8>)> {
    let mut header = [0u8; 8];
    stream.read_exact(&mut header)?;
    let opcode = u32::from_le_bytes(header[0..4].try_into().unwrap());
    let size = u32::from_le_bytes(header[4..8].try_into().unwrap()) as usize;
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

fn connect_endpoint(client_id: &str) -> std::io::Result<Connection> {
    let mut last_error = None;
    for endpoint in endpoint_names() {
        let name = match endpoint.to_fs_name::<GenericFilePath>() {
            Ok(name) => name,
            Err(error) => {
                last_error = Some(std::io::Error::other(error));
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
        write_packet(&mut stream, 0, &body)?;

        let reader = stream.try_clone().map_err(std::io::Error::other)?;
        let writer = Arc::new(Mutex::new(stream));
        let reader_writer = Arc::clone(&writer);
        let (send, events) = mpsc::channel();
        thread::Builder::new()
            .name("wavebit-discord-reader".into())
            .spawn(move || read_loop(reader, reader_writer, send))
            .map_err(std::io::Error::other)?;
        return Ok(Connection { writer, events });
    }
    Err(last_error.unwrap_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::NotFound, "Discord IPC not found")
    }))
}

fn read_loop(mut reader: Stream, writer: Arc<Mutex<Stream>>, send: Sender<ReaderEvent>) {
    loop {
        let Ok((opcode, body)) = read_packet(&mut reader) else {
            let _ = send.send(ReaderEvent::Closed);
            return;
        };
        match opcode {
            1 => match serde_json::from_slice::<Value>(&body) {
                Ok(value) => {
                    if send.send(ReaderEvent::Frame(value)).is_err() {
                        return;
                    }
                }
                Err(_) => {
                    let _ = send.send(ReaderEvent::Closed);
                    return;
                }
            },
            2 => {
                let _ = send.send(ReaderEvent::Closed);
                return;
            }
            3 => {
                let Ok(mut stream) = writer.lock() else {
                    return;
                };
                if write_packet(&mut *stream, 4, &body).is_err() {
                    let _ = send.send(ReaderEvent::Closed);
                    return;
                }
            }
            _ => {}
        }
    }
}

fn send_command(writer: &Arc<Mutex<Stream>>, payload: &Value) -> std::io::Result<()> {
    let body = serde_json::to_vec(payload).map_err(std::io::Error::other)?;
    let mut stream = writer
        .lock()
        .map_err(|_| std::io::Error::other("Discord RPC writer failed"))?;
    write_packet(&mut *stream, 1, &body)
}

fn set_activity(writer: &Arc<Mutex<Stream>>, activity: Option<&Value>) -> std::io::Result<()> {
    send_command(
        writer,
        &json!({
            "cmd": "SET_ACTIVITY",
            "args": { "pid": std::process::id(), "activity": activity },
            "nonce": format!("wavebit-{}", NEXT_NONCE.fetch_add(1, Ordering::Relaxed))
        }),
    )
}

fn close_connection(connection: Connection) {
    let _ = set_activity(&connection.writer, None);
    let mut writer = match connection.writer.lock() {
        Ok(writer) => writer,
        Err(_) => return,
    };
    let _ = write_packet(&mut *writer, 2, &[]);
}

struct Worker {
    client_id: String,
    commands: Receiver<Command>,
    report: Box<dyn Fn(PresenceStatus) + Send>,
    status: PresenceStatus,
    enabled: bool,
    activity: Option<Value>,
    connection: Option<Connection>,
    backoff: Duration,
}

impl Worker {
    fn status(&mut self, next: PresenceStatus) {
        if self.status != next {
            self.status = next;
            (self.report)(next);
        }
    }

    fn handle(&mut self, command: Command) -> bool {
        match command {
            Command::Enable(enabled) => {
                if enabled && !valid_client_id(&self.client_id) {
                    self.enabled = false;
                    self.status(PresenceStatus::NotConfigured);
                    return true;
                }
                self.enabled = enabled;
                if !enabled {
                    if let Some(connection) = self.connection.take() {
                        close_connection(connection);
                    }
                    self.status(PresenceStatus::Disabled);
                } else {
                    self.status(PresenceStatus::Connecting);
                }
                true
            }
            Command::Activity(activity) => {
                self.activity = activity;
                if let Some(connection) = &self.connection {
                    if set_activity(&connection.writer, self.activity.as_ref()).is_err() {
                        if let Some(connection) = self.connection.take() {
                            close_connection(connection);
                        }
                        self.status(PresenceStatus::Waiting);
                    }
                }
                true
            }
            Command::Retry => {
                if let Some(connection) = self.connection.take() {
                    close_connection(connection);
                }
                self.backoff = MIN_BACKOFF;
                if self.enabled {
                    self.status(PresenceStatus::Connecting);
                }
                true
            }
            Command::Shutdown(done) => {
                if let Some(connection) = self.connection.take() {
                    close_connection(connection);
                }
                self.status(PresenceStatus::Disabled);
                let _ = done.send(());
                false
            }
        }
    }

    fn drain_commands(&mut self) -> bool {
        loop {
            match self.commands.try_recv() {
                Ok(command) => {
                    if !self.handle(command) {
                        return false;
                    }
                }
                Err(mpsc::TryRecvError::Empty) => return true,
                Err(mpsc::TryRecvError::Disconnected) => return false,
            }
        }
    }

    fn run(mut self) {
        self.status(if valid_client_id(&self.client_id) {
            PresenceStatus::Disabled
        } else {
            PresenceStatus::NotConfigured
        });
        loop {
            if !self.enabled {
                match self.commands.recv() {
                    Ok(command) => {
                        if self.handle(command) {
                            continue;
                        }
                        break;
                    }
                    Err(_) => break,
                }
            }

            if self.connection.is_none() {
                self.status(PresenceStatus::Connecting);
                match connect_endpoint(&self.client_id) {
                    Ok(connection) => match connection.events.recv_timeout(HANDSHAKE_TIMEOUT) {
                        Ok(ReaderEvent::Frame(frame))
                            if frame.get("evt").and_then(Value::as_str) == Some("READY") =>
                        {
                            self.connection = Some(connection);
                            self.backoff = MIN_BACKOFF;
                            self.status(PresenceStatus::Connected);
                            if let Some(connected) = &self.connection {
                                if set_activity(&connected.writer, self.activity.as_ref()).is_err()
                                {
                                    if let Some(connection) = self.connection.take() {
                                        close_connection(connection);
                                    }
                                }
                            }
                        }
                        _ => {
                            self.status(PresenceStatus::Waiting);
                            close_connection(connection);
                        }
                    },
                    Err(_) => self.status(PresenceStatus::Waiting),
                }
                if self.connection.is_none() {
                    let wait = self.backoff;
                    self.backoff = (self.backoff * 2).min(MAX_BACKOFF);
                    match self.commands.recv_timeout(wait) {
                        Ok(command) => {
                            if !self.handle(command) {
                                break;
                            }
                        }
                        Err(RecvTimeoutError::Timeout) => {}
                        Err(RecvTimeoutError::Disconnected) => break,
                    }
                    continue;
                }
            }

            if let Some(connection) = &self.connection {
                match connection.events.try_recv() {
                    Ok(ReaderEvent::Frame(frame))
                        if frame.get("evt").and_then(Value::as_str) == Some("ERROR") =>
                    {
                        self.status(PresenceStatus::Error);
                    }
                    Ok(ReaderEvent::Frame(_)) => {}
                    Ok(ReaderEvent::Closed) | Err(mpsc::TryRecvError::Disconnected) => {
                        self.connection = None;
                        self.status(PresenceStatus::Waiting);
                    }
                    Err(mpsc::TryRecvError::Empty) => {}
                }
            }
            if !self.drain_commands() {
                break;
            }
            if self.connection.is_some() {
                match self.commands.recv_timeout(Duration::from_millis(100)) {
                    Ok(command) => {
                        if !self.handle(command) {
                            break;
                        }
                    }
                    Err(RecvTimeoutError::Timeout) => {}
                    Err(RecvTimeoutError::Disconnected) => break,
                }
            }
        }
    }
}

fn valid_client_id(value: &str) -> bool {
    (17..=20).contains(&value.len()) && value.bytes().all(|byte| byte.is_ascii_digit())
}

/// One Discord local RPC connection. It receives only settings and playback
/// display data from the main process, never a credential or arbitrary path.
#[napi]
pub struct DiscordPresence {
    commands: Sender<Command>,
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
        let report = Box::new(move |state: PresenceStatus| {
            let json = serde_json::to_string(state.as_str()).unwrap_or_default();
            on_status.call(json, ThreadsafeFunctionCallMode::NonBlocking);
        });
        let worker = thread::Builder::new()
            .name("wavebit-discord-presence".into())
            .spawn(move || {
                Worker {
                    client_id,
                    commands: inbox,
                    report,
                    status: PresenceStatus::Error,
                    enabled: false,
                    activity: None,
                    connection: None,
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
        let _ = self.commands.send(Command::Enable(enabled));
    }

    #[napi]
    pub fn set_activity(&self, json_text: String) {
        if json_text.len() > MAX_FRAME_BYTES {
            return;
        }
        let Ok(activity) = serde_json::from_str::<Activity>(&json_text) else {
            return;
        };
        if !activity.validate() {
            return;
        }
        if let Ok(value) = serde_json::from_str(&json_text) {
            let _ = self.commands.send(Command::Activity(Some(value)));
        }
    }

    #[napi]
    pub fn clear(&self) {
        let _ = self.commands.send(Command::Activity(None));
    }

    #[napi]
    pub fn retry(&self) {
        let _ = self.commands.send(Command::Retry);
    }

    #[napi]
    pub fn shutdown(&mut self, wait_ms: u32) {
        let Some(worker) = self.worker.take() else {
            return;
        };
        let (done, wait) = mpsc::channel();
        let _ = self.commands.send(Command::Shutdown(done));
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
            let _ = self.commands.send(Command::Shutdown(done));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn client_ids_are_public_numeric_application_ids() {
        assert!(valid_client_id("12345678901234567"));
        assert!(!valid_client_id(""));
        assert!(!valid_client_id("not-an-id"));
        assert!(!valid_client_id("123"));
    }

    #[cfg(not(windows))]
    #[test]
    fn endpoint_discovery_includes_vesktop_flatpak_runtime_socket() {
        let endpoints = endpoint_names_from_roots(vec![
            std::path::PathBuf::from("/run/user/1000/.flatpak/dev.vencord.Vesktop/xdg-run"),
            std::path::PathBuf::from("/run/user/1000"),
        ]);

        assert!(endpoints.iter().any(|endpoint| {
            endpoint == "/run/user/1000/.flatpak/dev.vencord.Vesktop/xdg-run/discord-ipc-0"
        }));
        assert!(endpoints
            .iter()
            .any(|endpoint| { endpoint == "/run/user/1000/discord-ipc-0" }));
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
        assert!(!discovered
            .iter()
            .any(|path| path.ends_with("nested/not-a-client")));
        let endpoints = endpoint_names_from_roots(discovered);
        assert!(endpoints.iter().any(|path| {
            path == root
                .join("app/com.discordapp.Discord/discord-ipc-0")
                .to_string_lossy()
                .as_ref()
        }));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn activity_validation_rejects_unknown_fields_and_invalid_types() {
        let good = r#"{"type":2,"details":"Song","state":"Artist"}"#;
        let activity: Activity = serde_json::from_str(good).unwrap();
        assert!(activity.validate());

        let invalid = r#"{"type":1,"details":"Song"}"#;
        let activity: Activity = serde_json::from_str(invalid).unwrap();
        assert!(!activity.validate());

        let extra = r#"{"type":2,"details":"Song","token":"secret"}"#;
        assert!(serde_json::from_str::<Activity>(extra).is_err());
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
        assert!(MAX_FRAME_BYTES < u32::MAX as usize);
    }
}
