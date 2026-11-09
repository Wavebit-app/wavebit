use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::UNIX_EPOCH;

use lofty::prelude::*;
use napi::{Env, Error, Result, Status, Task};
use napi_derive::napi;
use rusqlite::{Connection, params};
use walkdir::WalkDir;

use super::{Progress, is_audio, short_hash};
use crate::{db_err, now_secs};

/// Embedded covers larger than this are skipped rather than stored.
const MAX_ART_BYTES: usize = 1_500_000;

#[napi(object)]
pub struct ScanResult {
    pub seen: u32,
    pub added: u32,
    pub updated: u32,
    pub removed: u32,
}

pub struct ScanTask {
    db_path: String,
    folders: Vec<String>,
    progress: Arc<Progress>,
}

impl ScanTask {
    pub(crate) fn new(db_path: String, folders: Vec<String>, progress: Arc<Progress>) -> Self {
        Self {
            db_path,
            folders,
            progress,
        }
    }
}

struct FileInfo {
    path: PathBuf,
    mtime: i64,
    size: i64,
}

struct Tags {
    title: String,
    artist: String,
    album: String,
    album_artist: String,
    track_no: Option<u32>,
    disc_no: Option<u32>,
    year: Option<u32>,
    duration_ms: u32,
    art: Option<(String, Vec<u8>)>,
    /// Integrated loudness from a ReplayGain tag, when the file has one.
    lufs: Option<f64>,
    peak: Option<f64>,
}

/// ReplayGain 2 gains are relative to -18 LUFS, so loudness = -18 - gain.
fn replaygain(tag: Option<&lofty::tag::Tag>) -> (Option<f64>, Option<f64>) {
    let number = |key: ItemKey| {
        tag.and_then(|t| t.get_string(key))
            .and_then(|s| s.split_whitespace().next()?.parse::<f64>().ok())
            .filter(|v| v.is_finite())
    };
    (
        number(ItemKey::ReplayGainTrackGain).map(|gain| -18.0 - gain),
        number(ItemKey::ReplayGainTrackPeak).filter(|p| *p > 0.0),
    )
}

fn read_tags(path: &Path) -> Tags {
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Untitled")
        .to_string();
    let Ok(file) = lofty::read_from_path(path) else {
        // Unreadable tags still leave a playable file, named after itself.
        return Tags {
            title: stem,
            artist: "Unknown artist".into(),
            album: String::new(),
            album_artist: "Unknown artist".into(),
            track_no: None,
            disc_no: None,
            year: None,
            duration_ms: 0,
            art: None,
            lufs: None,
            peak: None,
        };
    };
    let duration_ms = file
        .properties()
        .duration()
        .as_millis()
        .min(u32::MAX as u128) as u32;
    let tag = file.primary_tag().or_else(|| file.first_tag());
    let text = |v: Option<std::borrow::Cow<'_, str>>| {
        v.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
    };
    let artist = tag
        .and_then(|t| text(t.artist()))
        .unwrap_or_else(|| "Unknown artist".into());
    let album_artist = tag
        .and_then(|t| t.get_string(ItemKey::AlbumArtist))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| artist.clone());
    let art = tag.and_then(|t| t.pictures().first()).and_then(|p| {
        let data = p.data();
        (data.len() <= MAX_ART_BYTES).then(|| {
            let mime = p
                .mime_type()
                .map(|m| m.as_str().to_string())
                .unwrap_or_else(|| "image/jpeg".into());
            (mime, data.to_vec())
        })
    });
    let (lufs, peak) = replaygain(tag);
    Tags {
        title: tag.and_then(|t| text(t.title())).unwrap_or(stem),
        artist,
        album: tag.and_then(|t| text(t.album())).unwrap_or_default(),
        album_artist,
        track_no: tag.and_then(|t| t.track()),
        disc_no: tag.and_then(|t| t.disk()),
        year: tag.and_then(|t| t.date()).map(|d| u32::from(d.year)),
        duration_ms,
        art,
        lufs,
        peak,
    }
}

fn walk(folders: &[String]) -> Vec<FileInfo> {
    let mut files = Vec::new();
    for folder in folders {
        // follow_links(false): a symlink loop can't make the walk endless.
        for entry in WalkDir::new(folder)
            .follow_links(false)
            .into_iter()
            .flatten()
        {
            if !entry.file_type().is_file() || !is_audio(entry.path()) {
                continue;
            }
            let Ok(meta) = entry.metadata() else { continue };
            let mtime = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);
            files.push(FileInfo {
                path: entry.into_path(),
                mtime,
                size: meta.len() as i64,
            });
        }
    }
    files
}

fn run(db_path: &str, folders: &[String], progress: &Progress) -> rusqlite::Result<ScanResult> {
    let files = walk(folders);
    progress.total.store(files.len() as u32, Ordering::SeqCst);
    progress.seen.store(0, Ordering::SeqCst);

    let mut conn = Connection::open(db_path)?;
    conn.busy_timeout(std::time::Duration::from_secs(5))?;
    let known: HashMap<String, (i64, i64)> = conn
        .prepare("SELECT path, mtime, size FROM tracks")?
        .query_map([], |r| Ok((r.get(0)?, (r.get(1)?, r.get(2)?))))?
        .collect::<rusqlite::Result<_>>()?;

    let (mut added, mut updated) = (0, 0);
    let mut found = HashSet::with_capacity(files.len());
    let tx = conn.transaction()?;
    {
        let mut upsert = tx.prepare(
            "INSERT INTO tracks (id, path, mtime, size, title, artist, album, album_artist, album_key,
               track_no, disc_no, year, duration_ms, format, has_art, added_at, loudness_lufs, peak)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)
             ON CONFLICT(id) DO UPDATE SET mtime = excluded.mtime, size = excluded.size,
               title = excluded.title, artist = excluded.artist, album = excluded.album,
               album_artist = excluded.album_artist, album_key = excluded.album_key,
               track_no = excluded.track_no, disc_no = excluded.disc_no, year = excluded.year,
               duration_ms = excluded.duration_ms, format = excluded.format, has_art = excluded.has_art,
               loudness_lufs = excluded.loudness_lufs, peak = excluded.peak",
        )?;
        let mut put_art = tx.prepare(
            "INSERT INTO art (album_key, mime, data) VALUES (?1, ?2, ?3)
             ON CONFLICT(album_key) DO UPDATE SET mime = excluded.mime, data = excluded.data",
        )?;
        let now = now_secs();
        for file in &files {
            progress.seen.fetch_add(1, Ordering::SeqCst);
            let Some(path) = file.path.to_str() else {
                continue;
            };
            found.insert(path.to_string());
            match known.get(path) {
                Some(&(mtime, size)) if mtime == file.mtime && size == file.size => continue,
                Some(_) => updated += 1,
                None => added += 1,
            }
            let tags = read_tags(&file.path);
            let id = short_hash(path);
            let album_key = if tags.album.is_empty() {
                id.clone()
            } else {
                short_hash(&format!(
                    "{}\u{1f}{}",
                    tags.album_artist.to_lowercase(),
                    tags.album.to_lowercase()
                ))
            };
            if let Some((mime, data)) = &tags.art {
                put_art.execute(params![album_key, mime, data])?;
            }
            let format = file
                .path
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_ascii_uppercase();
            upsert.execute(params![
                id,
                path,
                file.mtime,
                file.size,
                tags.title,
                tags.artist,
                tags.album,
                tags.album_artist,
                album_key,
                tags.track_no,
                tags.disc_no,
                tags.year,
                tags.duration_ms,
                format,
                tags.art.is_some(),
                now,
                tags.lufs,
                tags.peak,
            ])?;
        }
    }
    let gone: Vec<&String> = known.keys().filter(|p| !found.contains(*p)).collect();
    {
        let mut delete = tx.prepare("DELETE FROM tracks WHERE path = ?1")?;
        for path in &gone {
            delete.execute(params![path])?;
        }
    }
    // Albums whose files all went keep no artwork.
    tx.execute(
        "DELETE FROM art WHERE album_key NOT IN (SELECT album_key FROM tracks)",
        [],
    )?;
    // An album with art on one file shows it on all of them.
    tx.execute(
        "UPDATE tracks SET has_art = 1 WHERE has_art = 0 AND album_key IN (SELECT album_key FROM art)",
        [],
    )?;
    tx.commit()?;

    Ok(ScanResult {
        seen: files.len() as u32,
        added,
        updated,
        removed: gone.len() as u32,
    })
}

impl Task for ScanTask {
    type Output = ScanResult;
    type JsValue = ScanResult;

    fn compute(&mut self) -> Result<Self::Output> {
        let result = run(&self.db_path, &self.folders, &self.progress).map_err(db_err);
        self.progress.running.store(false, Ordering::SeqCst);
        result
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }

    fn reject(&mut self, _env: Env, err: Error) -> Result<Self::JsValue> {
        Err(Error::new(Status::GenericFailure, err.reason))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library::Library;
    use std::fs;

    /// A one-second silent 8 kHz mono WAV.
    fn wav() -> Vec<u8> {
        let data_len: u32 = 8000 * 2;
        let mut b = Vec::new();
        b.extend_from_slice(b"RIFF");
        b.extend_from_slice(&(36 + data_len).to_le_bytes());
        b.extend_from_slice(b"WAVEfmt ");
        b.extend_from_slice(&16u32.to_le_bytes());
        b.extend_from_slice(&1u16.to_le_bytes());
        b.extend_from_slice(&1u16.to_le_bytes());
        b.extend_from_slice(&8000u32.to_le_bytes());
        b.extend_from_slice(&16000u32.to_le_bytes());
        b.extend_from_slice(&2u16.to_le_bytes());
        b.extend_from_slice(&16u16.to_le_bytes());
        b.extend_from_slice(b"data");
        b.extend_from_slice(&data_len.to_le_bytes());
        b.resize(b.len() + data_len as usize, 0);
        b
    }

    #[test]
    fn scan_is_incremental_and_drops_missing_files() {
        let dir = std::env::temp_dir().join(format!("wavebit-scan-{}", std::process::id()));
        let music = dir.join("music");
        fs::create_dir_all(music.join("sub")).unwrap();
        fs::write(music.join("one.wav"), wav()).unwrap();
        fs::write(music.join("sub/two.wav"), wav()).unwrap();
        fs::write(music.join("notes.txt"), b"not audio").unwrap();
        let db = dir.join("library.db").to_string_lossy().to_string();
        let folders = vec![music.to_string_lossy().to_string()];
        let library = Library::new(db.clone()).unwrap();
        let progress = Progress::default();

        let first = run(&db, &folders, &progress).unwrap();
        assert_eq!((first.seen, first.added, first.removed), (2, 2, 0));
        let again = run(&db, &folders, &progress).unwrap();
        assert_eq!((again.added, again.updated), (0, 0));

        let page = library.tracks("tw".into(), "title".into(), 0, 50).unwrap();
        assert_eq!(page.total, 1);
        assert_eq!(page.items[0].title, "two");
        assert_eq!(page.items[0].duration_ms, 1000);

        fs::remove_file(music.join("one.wav")).unwrap();
        let after = run(&db, &folders, &progress).unwrap();
        assert_eq!(after.removed, 1);
        assert_eq!(library.stats().unwrap().track_count, 1);
        // A `%` in the query is literal, not a wildcard.
        assert_eq!(
            library
                .tracks("%".into(), "title".into(), 0, 50)
                .unwrap()
                .total,
            0
        );
        fs::remove_dir_all(dir).ok();
    }
}
