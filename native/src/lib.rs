//! Native side of wavebit, loaded only by the Electron main process.
//! The renderer never reaches this module directly; it goes through IPC.

mod cache;
mod library;
mod matcher;
mod party;
mod tags;

use napi::{Error, Status};
use napi_derive::napi;

pub use cache::Cache;
pub use library::Library;

#[napi]
pub fn native_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

pub(crate) fn db_err(e: rusqlite::Error) -> Error {
    Error::new(Status::GenericFailure, format!("sqlite: {e}"))
}

pub(crate) fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/** A song another service offers, for [`best_match`]. */
#[napi(object)]
pub struct MatchCandidate {
    pub id: String,
    pub title: String,
    /// Every credited name, comma separated.
    pub artists: String,
    pub duration_ms: u32,
}

/// The candidate that is the same recording as `song` (BitChord's
/// TrackMatcher.best), or null when none is close enough. Used to find a
/// Spotify song on YouTube Music.
#[napi]
pub fn best_match(song: library::MatchInput, candidates: Vec<MatchCandidate>) -> Option<String> {
    let matcher = matcher::Matcher::new(
        candidates
            .into_iter()
            .map(|c| matcher::Candidate {
                id: c.id,
                title: c.title,
                artists: c.artists,
                duration_ms: c.duration_ms,
            })
            .collect(),
    );
    matcher.find(&song.title, &song.artists.join(", "), song.duration_ms)
}
