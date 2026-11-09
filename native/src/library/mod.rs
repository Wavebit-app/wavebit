//! The local music library: one SQLite file with a row per audio file and
//! one artwork blob per album. Scans run on the libuv pool (`scan.rs`).

mod home;
mod loudness;
mod scan;

use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use napi::bindgen_prelude::{AsyncTask, Buffer};
use napi::{Error, Result, Status};
use napi_derive::napi;
use rusqlite::{Connection, OptionalExtension, Row, params};
use sha2::{Digest, Sha256};

use crate::db_err;
use crate::matcher::{Candidate, Matcher};
pub use loudness::LoudnessTask;
pub use scan::ScanTask;

const SCHEMA: &str = "
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS tracks (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  mtime INTEGER NOT NULL,
  size INTEGER NOT NULL,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  album TEXT NOT NULL,
  album_artist TEXT NOT NULL,
  album_key TEXT NOT NULL,
  track_no INTEGER,
  disc_no INTEGER,
  year INTEGER,
  duration_ms INTEGER NOT NULL,
  format TEXT NOT NULL,
  has_art INTEGER NOT NULL,
  added_at INTEGER NOT NULL,
  plays INTEGER NOT NULL DEFAULT 0,
  loudness_lufs REAL,
  peak REAL
);
CREATE INDEX IF NOT EXISTS tracks_album ON tracks(album_key);
CREATE INDEX IF NOT EXISTS tracks_album_artist ON tracks(album_artist);
CREATE INDEX IF NOT EXISTS tracks_added ON tracks(added_at);
CREATE TABLE IF NOT EXISTS art (
  album_key TEXT PRIMARY KEY,
  mime TEXT NOT NULL,
  data BLOB NOT NULL
);";

/// 16 hex characters of SHA-256: stable ids for paths and albums that never
/// reveal the path itself to the renderer.
pub(crate) fn short_hash(input: &str) -> String {
    Sha256::digest(input.as_bytes())[..8]
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

#[napi(object)]
#[derive(Clone)]
pub struct LocalTrack {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub album_key: String,
    pub duration_ms: u32,
    pub track_no: Option<u32>,
    pub disc_no: Option<u32>,
    pub has_art: bool,
    pub added_at: i64,
    /// How many times it has been played in wavebit.
    pub plays: u32,
}

#[napi(object)]
pub struct TrackPage {
    pub items: Vec<LocalTrack>,
    pub total: u32,
    pub offset: u32,
}

#[napi(object)]
pub struct AlbumSummary {
    pub key: String,
    pub title: String,
    pub artist: String,
    pub year: Option<u32>,
    pub track_count: u32,
    pub duration_ms: f64,
    pub has_art: bool,
}

#[napi(object)]
pub struct AlbumDetail {
    pub album: AlbumSummary,
    pub format: String,
    pub tracks: Vec<LocalTrack>,
    pub more_by_artist: Vec<AlbumSummary>,
}

#[napi(object)]
pub struct ArtistSummary {
    pub name: String,
    pub album_count: u32,
    pub track_count: u32,
    /// The album key of the artist's newest album, for artwork.
    pub art_key: Option<String>,
}

#[napi(object)]
pub struct ArtistDetail {
    pub artist: ArtistSummary,
    pub top_tracks: Vec<LocalTrack>,
    pub albums: Vec<AlbumSummary>,
}

#[napi(object)]
pub struct SearchResults {
    pub tracks: Vec<LocalTrack>,
    pub albums: Vec<AlbumSummary>,
    pub artists: Vec<ArtistSummary>,
}

#[napi(object)]
pub struct LibraryStats {
    pub track_count: u32,
    pub duration_ms: f64,
    pub album_count: u32,
    pub artist_count: u32,
}

#[napi(object)]
pub struct ScanProgress {
    pub running: bool,
    pub seen: u32,
    pub total: u32,
}

#[napi(object)]
pub struct Artwork {
    pub mime: String,
    pub data: Buffer,
}

#[napi(object)]
pub struct TrackMatch {
    pub id: String,
    /// The local album, when the file has one.
    pub album_key: Option<String>,
    pub has_art: bool,
}

#[napi(object)]
pub struct MatchInput {
    pub title: String,
    pub artists: Vec<String>,
    pub duration_ms: u32,
}

/// Shared between a running scan and the library that reports its progress.
#[derive(Default)]
pub(crate) struct Progress {
    pub running: AtomicBool,
    pub seen: AtomicU32,
    pub total: AtomicU32,
}

const TRACK_COLUMNS: &str =
    "id, title, artist, album, album_key, duration_ms, track_no, disc_no, has_art, added_at, plays";

fn track_from_row(row: &Row<'_>) -> rusqlite::Result<LocalTrack> {
    Ok(LocalTrack {
        id: row.get(0)?,
        title: row.get(1)?,
        artist: row.get(2)?,
        album: row.get(3)?,
        album_key: row.get(4)?,
        duration_ms: row.get(5)?,
        track_no: row.get(6)?,
        disc_no: row.get(7)?,
        has_art: row.get(8)?,
        added_at: row.get(9)?,
        plays: row.get(10)?,
    })
}

const ALBUM_SELECT: &str = "SELECT album_key, album, album_artist, MAX(year), COUNT(*),
  SUM(duration_ms), MAX(has_art) FROM tracks WHERE album <> ''";

fn album_from_row(row: &Row<'_>) -> rusqlite::Result<AlbumSummary> {
    Ok(AlbumSummary {
        key: row.get(0)?,
        title: row.get(1)?,
        artist: row.get(2)?,
        year: row.get(3)?,
        track_count: row.get(4)?,
        duration_ms: row.get::<_, i64>(5)? as f64,
        has_art: row.get(6)?,
    })
}

const ARTIST_SELECT: &str =
    "SELECT album_artist, COUNT(DISTINCT CASE WHEN album <> '' THEN album_key END),
  COUNT(*), (SELECT t2.album_key FROM tracks t2 WHERE t2.album_artist = tracks.album_artist
  AND t2.has_art = 1 ORDER BY t2.year DESC LIMIT 1) FROM tracks";

fn artist_from_row(row: &Row<'_>) -> rusqlite::Result<ArtistSummary> {
    Ok(ArtistSummary {
        name: row.get(0)?,
        album_count: row.get(1)?,
        track_count: row.get(2)?,
        art_key: row.get(3)?,
    })
}

/// `%query%` for LIKE with its wildcards escaped.
fn like_pattern(query: &str) -> String {
    let escaped = query
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    format!("%{escaped}%")
}

/// Adds columns that later versions introduced to a library made by an earlier one.
fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    let columns: Vec<String> = conn
        .prepare("SELECT name FROM pragma_table_info('tracks')")?
        .query_map([], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    for (name, kind) in [
        ("loudness_lufs", "REAL"),
        ("peak", "REAL"),
        ("last_played", "INTEGER"),
    ] {
        if !columns.iter().any(|c| c == name) {
            conn.execute_batch(&format!("ALTER TABLE tracks ADD COLUMN {name} {kind}"))?;
        }
    }
    conn.execute_batch("CREATE INDEX IF NOT EXISTS tracks_played ON tracks(last_played)")?;
    Ok(())
}

#[napi]
pub struct Library {
    path: String,
    conn: Mutex<Connection>,
    progress: Arc<Progress>,
}

#[napi]
impl Library {
    #[napi(constructor)]
    pub fn new(path: String) -> Result<Self> {
        let conn = Connection::open(&path).map_err(db_err)?;
        conn.busy_timeout(std::time::Duration::from_secs(5))
            .map_err(db_err)?;
        conn.execute_batch(SCHEMA).map_err(db_err)?;
        migrate(&conn).map_err(db_err)?;
        Ok(Self {
            path,
            conn: Mutex::new(conn),
            progress: Arc::default(),
        })
    }

    fn conn(&self) -> Result<MutexGuard<'_, Connection>> {
        self.conn
            .lock()
            .map_err(|_| Error::new(Status::GenericFailure, "library: lock poisoned"))
    }

    /// Reads every audio file under `folders`, skipping files whose size and
    /// modification time are unchanged, and drops rows for files that are gone.
    #[napi]
    pub fn scan(&self, folders: Vec<String>) -> Result<AsyncTask<ScanTask>> {
        if self.progress.running.swap(true, Ordering::SeqCst) {
            return Err(Error::new(
                Status::GenericFailure,
                "library: scan already running",
            ));
        }
        Ok(AsyncTask::new(ScanTask::new(
            self.path.clone(),
            folders,
            self.progress.clone(),
        )))
    }

    #[napi]
    pub fn scan_progress(&self) -> ScanProgress {
        ScanProgress {
            running: self.progress.running.load(Ordering::SeqCst),
            seen: self.progress.seen.load(Ordering::SeqCst),
            total: self.progress.total.load(Ordering::SeqCst),
        }
    }

    #[napi]
    pub fn stats(&self) -> Result<LibraryStats> {
        self.conn()?
            .query_row(
                "SELECT COUNT(*), COALESCE(SUM(duration_ms), 0),
                   COUNT(DISTINCT CASE WHEN album <> '' THEN album_key END),
                   COUNT(DISTINCT album_artist) FROM tracks",
                [],
                |row| {
                    Ok(LibraryStats {
                        track_count: row.get(0)?,
                        duration_ms: row.get::<_, i64>(1)? as f64,
                        album_count: row.get(2)?,
                        artist_count: row.get(3)?,
                    })
                },
            )
            .map_err(db_err)
    }

    /// One page of songs. `sort` is "title", "artist", "album" or "recent".
    #[napi]
    pub fn tracks(
        &self,
        query: String,
        sort: String,
        offset: u32,
        limit: u32,
    ) -> Result<TrackPage> {
        let order = match sort.as_str() {
            "recent" => "added_at DESC, title COLLATE NOCASE",
            "artist" => "artist COLLATE NOCASE, album COLLATE NOCASE, disc_no, track_no",
            "album" => "album COLLATE NOCASE, disc_no, track_no",
            _ => "title COLLATE NOCASE, artist COLLATE NOCASE",
        };
        let filter = "(?1 = '' OR title LIKE ?2 ESCAPE '\\' OR artist LIKE ?2 ESCAPE '\\' OR album LIKE ?2 ESCAPE '\\')";
        let pattern = like_pattern(&query);
        let conn = self.conn()?;
        let total: u32 = conn
            .query_row(
                &format!("SELECT COUNT(*) FROM tracks WHERE {filter}"),
                params![query, pattern],
                |row| row.get(0),
            )
            .map_err(db_err)?;
        let mut stmt = conn
            .prepare_cached(&format!(
                "SELECT {TRACK_COLUMNS} FROM tracks WHERE {filter} ORDER BY {order} LIMIT ?3 OFFSET ?4"
            ))
            .map_err(db_err)?;
        let items = stmt
            .query_map(params![query, pattern, limit, offset], track_from_row)
            .map_err(db_err)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(db_err)?;
        Ok(TrackPage {
            items,
            total,
            offset,
        })
    }

    #[napi]
    pub fn albums(&self, query: String, offset: u32, limit: u32) -> Result<Vec<AlbumSummary>> {
        let conn = self.conn()?;
        let mut stmt = conn
            .prepare_cached(&format!(
                "{ALBUM_SELECT} AND (?1 = '' OR album LIKE ?2 ESCAPE '\\' OR album_artist LIKE ?2 ESCAPE '\\')
                 GROUP BY album_key ORDER BY album_artist COLLATE NOCASE, MAX(year), album COLLATE NOCASE
                 LIMIT ?3 OFFSET ?4"
            ))
            .map_err(db_err)?;
        stmt.query_map(
            params![query, like_pattern(&query), limit, offset],
            album_from_row,
        )
        .map_err(db_err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(db_err)
    }

    #[napi]
    pub fn album(&self, key: String) -> Result<Option<AlbumDetail>> {
        let conn = self.conn()?;
        let Some(album) = conn
            .query_row(
                &format!("{ALBUM_SELECT} AND album_key = ?1 GROUP BY album_key"),
                params![key],
                album_from_row,
            )
            .optional()
            .map_err(db_err)?
        else {
            return Ok(None);
        };
        let format: String = conn
            .query_row(
                "SELECT format FROM tracks WHERE album_key = ?1 LIMIT 1",
                params![key],
                |row| row.get(0),
            )
            .map_err(db_err)?;
        let tracks = conn
            .prepare_cached(&format!(
                "SELECT {TRACK_COLUMNS} FROM tracks WHERE album_key = ?1
                 ORDER BY disc_no, track_no, title COLLATE NOCASE"
            ))
            .map_err(db_err)?
            .query_map(params![key], track_from_row)
            .map_err(db_err)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(db_err)?;
        let more_by_artist = conn
            .prepare_cached(&format!(
                "{ALBUM_SELECT} AND album_artist = ?1 AND album_key <> ?2
                 GROUP BY album_key ORDER BY MAX(year) DESC LIMIT 12"
            ))
            .map_err(db_err)?
            .query_map(params![album.artist, key], album_from_row)
            .map_err(db_err)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(db_err)?;
        Ok(Some(AlbumDetail {
            album,
            format,
            tracks,
            more_by_artist,
        }))
    }

    #[napi]
    pub fn artists(&self, query: String, offset: u32, limit: u32) -> Result<Vec<ArtistSummary>> {
        let conn = self.conn()?;
        let mut stmt = conn
            .prepare_cached(&format!(
                "{ARTIST_SELECT} WHERE (?1 = '' OR album_artist LIKE ?2 ESCAPE '\\')
                 GROUP BY album_artist ORDER BY album_artist COLLATE NOCASE LIMIT ?3 OFFSET ?4"
            ))
            .map_err(db_err)?;
        stmt.query_map(
            params![query, like_pattern(&query), limit, offset],
            artist_from_row,
        )
        .map_err(db_err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(db_err)
    }

    #[napi]
    pub fn artist(&self, name: String) -> Result<Option<ArtistDetail>> {
        let conn = self.conn()?;
        let Some(artist) = conn
            .query_row(
                &format!("{ARTIST_SELECT} WHERE album_artist = ?1 GROUP BY album_artist"),
                params![name],
                artist_from_row,
            )
            .optional()
            .map_err(db_err)?
        else {
            return Ok(None);
        };
        let top_tracks = conn
            .prepare_cached(&format!(
                "SELECT {TRACK_COLUMNS} FROM tracks WHERE album_artist = ?1
                 ORDER BY plays DESC, added_at DESC LIMIT 6"
            ))
            .map_err(db_err)?
            .query_map(params![name], track_from_row)
            .map_err(db_err)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(db_err)?;
        let albums = conn
            .prepare_cached(&format!(
                "{ALBUM_SELECT} AND album_artist = ?1 GROUP BY album_key ORDER BY MAX(year) DESC"
            ))
            .map_err(db_err)?
            .query_map(params![name], album_from_row)
            .map_err(db_err)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(db_err)?;
        Ok(Some(ArtistDetail {
            artist,
            top_tracks,
            albums,
        }))
    }

    /// The title-bar search: a few songs, albums and artists.
    #[napi]
    pub fn search(&self, query: String) -> Result<SearchResults> {
        if query.trim().is_empty() {
            return Ok(SearchResults {
                tracks: vec![],
                albums: vec![],
                artists: vec![],
            });
        }
        let tracks = self.tracks(query.clone(), "title".into(), 0, 5)?.items;
        let albums = self.albums(query.clone(), 0, 3)?;
        let artists = self.artists(query, 0, 3)?;
        Ok(SearchResults {
            tracks,
            albums,
            artists,
        })
    }

    /// The file behind a track id, for the main process's media protocol only.
    #[napi]
    pub fn track_path(&self, id: String) -> Result<Option<String>> {
        self.conn()?
            .query_row(
                "SELECT path FROM tracks WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .optional()
            .map_err(db_err)
    }

    /// The tracks for these files, in the order given; a file no scan has read is skipped.
    #[napi]
    pub fn tracks_by_paths(&self, paths: Vec<String>) -> Result<Vec<LocalTrack>> {
        let conn = self.conn()?;
        let mut stmt = conn
            .prepare_cached(&format!("SELECT {TRACK_COLUMNS} FROM tracks WHERE path = ?1"))
            .map_err(db_err)?;
        let mut tracks = Vec::with_capacity(paths.len());
        for path in &paths {
            if let Some(track) = stmt
                .query_row(params![path], track_from_row)
                .optional()
                .map_err(db_err)?
            {
                tracks.push(track);
            }
        }
        Ok(tracks)
    }

    /// A saved file's track and album, once a scan has read it.
    #[napi]
    pub fn track_by_path(&self, path: String) -> Result<Option<TrackMatch>> {
        self.conn()?
            .query_row(
                "SELECT id, album, album_key, has_art FROM tracks WHERE path = ?1",
                params![path],
                |row| {
                    let album: String = row.get(1)?;
                    let album_key: String = row.get(2)?;
                    Ok(TrackMatch {
                        id: row.get(0)?,
                        album_key: (!album.is_empty()).then_some(album_key),
                        has_art: row.get(3)?,
                    })
                },
            )
            .optional()
            .map_err(db_err)
    }

    #[napi]
    pub fn artwork(&self, album_key: String) -> Result<Option<Artwork>> {
        self.conn()?
            .query_row(
                "SELECT mime, data FROM art WHERE album_key = ?1",
                params![album_key],
                |row| {
                    Ok(Artwork {
                        mime: row.get(0)?,
                        data: row.get::<_, Vec<u8>>(1)?.into(),
                    })
                },
            )
            .optional()
            .map_err(db_err)
    }

    /// The song's integrated loudness and sample peak: from the database, a
    /// ReplayGain tag, or, once, by decoding the file (EBU R128). Runs off the
    /// main thread; the result is stored so a file is never measured twice.
    #[napi]
    pub fn loudness(&self, id: String) -> AsyncTask<LoudnessTask> {
        AsyncTask::new(LoudnessTask::new(self.path.clone(), id))
    }

    #[napi]
    pub fn record_play(&self, id: String) -> Result<()> {
        self.conn()?
            .execute(
                "UPDATE tracks SET plays = plays + 1, last_played = ?2 WHERE id = ?1",
                params![id, crate::now_secs()],
            )
            .map(|_| ())
            .map_err(db_err)
    }

    /// For each Spotify song, the local file that is the same recording (and
    /// its album, so the playlist can link to it), or null.
    #[napi]
    pub fn match_tracks(&self, songs: Vec<MatchInput>) -> Result<Vec<Option<TrackMatch>>> {
        let conn = self.conn()?;
        let mut stmt = conn
            .prepare_cached(
                "SELECT id, title, artist, album_artist, duration_ms, album, album_key, has_art FROM tracks",
            )
            .map_err(db_err)?;
        let mut albums = std::collections::HashMap::new();
        let rows = stmt
            .query_map([], |row| {
                let id: String = row.get(0)?;
                let album: String = row.get(5)?;
                let album_key: String = row.get(6)?;
                let has_art: bool = row.get(7)?;
                Ok((
                    Candidate {
                        id: id.clone(),
                        title: row.get(1)?,
                        artists: format!(
                            "{}, {}",
                            row.get::<_, String>(2)?,
                            row.get::<_, String>(3)?
                        ),
                        duration_ms: row.get(4)?,
                    },
                    (id, (!album.is_empty()).then_some(album_key), has_art),
                ))
            })
            .map_err(db_err)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(db_err)?;
        let candidates = rows
            .into_iter()
            .map(|(candidate, (id, album_key, has_art))| {
                albums.insert(id, (album_key, has_art));
                candidate
            })
            .collect();
        let matcher = Matcher::new(candidates);
        Ok(songs
            .iter()
            .map(|s| {
                let id = matcher.find(&s.title, &s.artists.join(", "), s.duration_ms)?;
                let (album_key, has_art) = albums.get(&id).cloned().unwrap_or((None, false));
                Some(TrackMatch {
                    id,
                    album_key,
                    has_art,
                })
            })
            .collect())
    }

    /// Deletes every row and artwork. Used when the last folder is removed.
    #[napi]
    pub fn clear(&self) -> Result<()> {
        self.conn()?
            .execute_batch("DELETE FROM tracks; DELETE FROM art;")
            .map_err(db_err)
    }
}

/// True when `path` has an extension Chromium's media stack plays.
pub(crate) fn is_audio(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|e| e.to_str())
            .map(str::to_ascii_lowercase)
            .as_deref(),
        Some("mp3" | "flac" | "m4a" | "aac" | "ogg" | "oga" | "opus" | "wav" | "webm")
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tracks_by_paths_keeps_the_order_and_skips_unread_files() {
        let dir = std::env::temp_dir().join(format!("wavebit-paths-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let lib = Library::new(dir.join("lib.db").to_string_lossy().into_owned()).unwrap();
        for name in ["a", "b"] {
            lib.conn()
                .unwrap()
                .execute(
                    "INSERT INTO tracks (id, path, mtime, size, title, artist, album, album_artist,
                       album_key, duration_ms, format, has_art, added_at)
                     VALUES (?1, ?2, 0, 0, ?1, 'x', 'y', 'x', 'k', 1000, 'm4a', 0, 0)",
                    params![name, format!("/m/{name}.m4a")],
                )
                .unwrap();
        }
        let found = lib
            .tracks_by_paths(vec![
                "/m/b.m4a".into(),
                "/m/missing.m4a".into(),
                "/m/a.m4a".into(),
            ])
            .unwrap();
        assert_eq!(
            found.iter().map(|t| t.id.as_str()).collect::<Vec<_>>(),
            ["b", "a"]
        );
        std::fs::remove_dir_all(&dir).ok();
    }
}
