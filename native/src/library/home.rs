//! Home's shelves and Top Picks, after BitChord's Home (HomeScreen.kt,
//! TopPicksShelf.kt), built from the local library and the play history
//! wavebit keeps in it. Nothing here touches the network.

use napi::Result;
use napi_derive::napi;
use rusqlite::{Connection, OptionalExtension, params};

use super::{
    ALBUM_SELECT, ARTIST_SELECT, AlbumSummary, ArtistSummary, Library, LocalTrack, TRACK_COLUMNS,
    album_from_row, artist_from_row, track_from_row,
};
use crate::{db_err, now_secs};

const SHELF: u32 = 20;
const CARDS: u32 = 12;
/// A song not played for this long counts as forgotten (Rediscover).
const FORGOTTEN_AFTER_S: i64 = 60 * 24 * 60 * 60;
/// How many of the most played artists a "New from" release may come from.
const TOP_ARTISTS_FOR_RELEASE: u32 = 5;

#[napi(object)]
pub struct TopPicks {
    /// Songs played at least once.
    pub played: u32,
    /// Songs never played.
    pub unplayed: u32,
    /// Songs last played over 60 days ago. Plays from before wavebit kept
    /// the date don't count: there is no knowing when they were.
    pub forgotten: u32,
    /// The newest album, from one of the most played artists when there are plays.
    pub latest_release: Option<AlbumSummary>,
    /// True when `latest_release` is by one of the most played artists.
    pub latest_from_top: bool,
    /// The most played artist (the biggest one before anything is played).
    pub featured_artist: Option<ArtistSummary>,
}

#[napi(object)]
pub struct HomeFeed {
    /// Newest first, one row per song.
    pub recently_played: Vec<LocalTrack>,
    /// Played twice or more, most played first.
    pub on_repeat: Vec<LocalTrack>,
    pub recent_albums: Vec<AlbumSummary>,
    /// Most played first; by song count before anything is played.
    pub top_artists: Vec<ArtistSummary>,
    /// Albums with no song played yet, in a new order each day.
    pub unplayed_albums: Vec<AlbumSummary>,
    pub picks: TopPicks,
}

fn tracks(conn: &Connection, sql: &str, limit: u32) -> rusqlite::Result<Vec<LocalTrack>> {
    conn.prepare_cached(sql)?
        .query_map(params![limit], track_from_row)?
        .collect()
}

fn albums(conn: &Connection, sql: &str, limit: u32) -> rusqlite::Result<Vec<AlbumSummary>> {
    conn.prepare_cached(sql)?
        .query_map(params![limit], album_from_row)?
        .collect()
}

fn feed(conn: &Connection) -> rusqlite::Result<HomeFeed> {
    let now = now_secs();
    let recently_played = tracks(
        conn,
        &format!(
            "SELECT {TRACK_COLUMNS} FROM tracks WHERE last_played IS NOT NULL
             ORDER BY last_played DESC LIMIT ?1"
        ),
        SHELF,
    )?;
    let on_repeat = tracks(
        conn,
        &format!(
            "SELECT {TRACK_COLUMNS} FROM tracks WHERE plays >= 2
             ORDER BY plays DESC, last_played DESC LIMIT ?1"
        ),
        SHELF,
    )?;
    let recent_albums = albums(
        conn,
        &format!("{ALBUM_SELECT} GROUP BY album_key ORDER BY MAX(added_at) DESC LIMIT ?1"),
        CARDS,
    )?;
    // Home is read again after every play, so this can't shuffle on each read.
    let day_offset = now / 86_400 % 10 + 1;
    let unplayed_albums = albums(
        conn,
        &format!(
            "{ALBUM_SELECT} GROUP BY album_key HAVING SUM(plays) = 0
             ORDER BY substr(album_key, {day_offset}, 6) LIMIT ?1"
        ),
        CARDS,
    )?;
    let top_artists: Vec<ArtistSummary> = conn
        .prepare_cached(&format!(
            "{ARTIST_SELECT} WHERE album_artist <> '' GROUP BY album_artist
             ORDER BY SUM(plays) DESC, COUNT(*) DESC, album_artist COLLATE NOCASE LIMIT ?1"
        ))?
        .query_map(params![CARDS], artist_from_row)?
        .collect::<rusqlite::Result<_>>()?;

    let (played, unplayed, forgotten): (u32, u32, u32) = conn.query_row(
        "SELECT COALESCE(SUM(plays > 0), 0), COALESCE(SUM(plays = 0), 0),
           COALESCE(SUM(plays > 0 AND last_played < ?1), 0) FROM tracks",
        params![now - FORGOTTEN_AFTER_S],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;

    // BitChord's "New from …": the newest release by an artist the listener plays.
    let from_top = conn
        .query_row(
            &format!(
                "{ALBUM_SELECT} AND album_artist IN (
                   SELECT album_artist FROM tracks WHERE album_artist <> '' GROUP BY album_artist
                   HAVING SUM(plays) > 0 ORDER BY SUM(plays) DESC LIMIT ?1)
                 GROUP BY album_key ORDER BY MAX(added_at) DESC LIMIT 1"
            ),
            params![TOP_ARTISTS_FOR_RELEASE],
            album_from_row,
        )
        .optional()?;
    let latest_from_top = from_top.is_some();
    let latest_release = match from_top {
        Some(album) => Some(album),
        None => recent_albums.first().map(|a| AlbumSummary {
            key: a.key.clone(),
            title: a.title.clone(),
            artist: a.artist.clone(),
            year: a.year,
            track_count: a.track_count,
            duration_ms: a.duration_ms,
            has_art: a.has_art,
        }),
    };
    // A different face from the release card when there is one.
    let release_artist = latest_release.as_ref().map(|a| a.artist.as_str());
    let featured_artist = top_artists
        .iter()
        .position(|a| Some(a.name.as_str()) != release_artist)
        .or((!top_artists.is_empty()).then_some(0))
        .map(|i| {
            let a = &top_artists[i];
            ArtistSummary {
                name: a.name.clone(),
                album_count: a.album_count,
                track_count: a.track_count,
                art_key: a.art_key.clone(),
            }
        });

    Ok(HomeFeed {
        recently_played,
        on_repeat,
        recent_albums,
        top_artists,
        unplayed_albums,
        picks: TopPicks {
            played,
            unplayed,
            forgotten,
            latest_release,
            latest_from_top,
            featured_artist,
        },
    })
}

/// Efraimidis–Spirakis weighted order: a song played n times is n + 1 times
/// as likely to come early, and a song never played can still turn up.
fn weighted(mut rows: Vec<(LocalTrack, f64)>, limit: usize) -> Vec<LocalTrack> {
    for (track, key) in &mut rows {
        // `key` arrives as a uniform draw in (0, 1).
        *key = key.powf(1.0 / (f64::from(track.plays) + 1.0));
    }
    rows.sort_by(|a, b| b.1.total_cmp(&a.1));
    rows.into_iter().take(limit).map(|(t, _)| t).collect()
}

#[napi]
impl Library {
    /// Everything Home shows, in one read.
    #[napi]
    pub fn home(&self) -> Result<HomeFeed> {
        feed(&*self.conn()?).map_err(db_err)
    }

    /// A Top Picks station's queue: "personal" (weighted by plays),
    /// "discovery" (never played), "rediscover" (not played in 60 days) or
    /// "artist" (one artist's songs), shuffled.
    #[napi]
    pub fn station(
        &self,
        kind: String,
        artist: Option<String>,
        limit: u32,
    ) -> Result<Vec<LocalTrack>> {
        let conn = self.conn()?;
        let limit = limit.clamp(1, 500);
        let run = || -> rusqlite::Result<Vec<LocalTrack>> {
            match kind.as_str() {
                "personal" => {
                    let rows = conn
                        .prepare_cached(&format!("SELECT {TRACK_COLUMNS}, random() FROM tracks"))?
                        .query_map([], |r| {
                            let draw: i64 = r.get(11)?;
                            // i64 → (0, 1), never exactly 0 or 1.
                            let u = ((draw as u64) as f64 + 1.0) / (u64::MAX as f64 + 2.0);
                            Ok((track_from_row(r)?, u))
                        })?
                        .collect::<rusqlite::Result<Vec<_>>>()?;
                    Ok(weighted(rows, limit as usize))
                }
                "discovery" => tracks(
                    &conn,
                    &format!("SELECT {TRACK_COLUMNS} FROM tracks WHERE plays = 0 ORDER BY random() LIMIT ?1"),
                    limit,
                ),
                "rediscover" => conn
                    .prepare_cached(&format!(
                        "SELECT {TRACK_COLUMNS} FROM tracks WHERE plays > 0
                         AND last_played < ?2 ORDER BY random() LIMIT ?1"
                    ))?
                    .query_map(params![limit, now_secs() - FORGOTTEN_AFTER_S], track_from_row)?
                    .collect(),
                "artist" => conn
                    .prepare_cached(&format!(
                        "SELECT {TRACK_COLUMNS} FROM tracks WHERE album_artist = ?2
                         ORDER BY random() LIMIT ?1"
                    ))?
                    .query_map(params![limit, artist.clone().unwrap_or_default()], track_from_row)?
                    .collect(),
                _ => Ok(vec![]),
            }
        };
        run().map_err(db_err)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn track(id: &str, plays: u32) -> LocalTrack {
        LocalTrack {
            id: id.into(),
            title: id.into(),
            artist: String::new(),
            album: String::new(),
            album_key: String::new(),
            duration_ms: 1000,
            track_no: None,
            disc_no: None,
            has_art: false,
            added_at: 0,
            plays,
        }
    }

    #[test]
    fn weighted_order_favours_plays() {
        // Same draw for both: the played song's key is larger.
        let out = weighted(vec![(track("new", 0), 0.5), (track("loved", 40), 0.5)], 2);
        assert_eq!(out[0].id, "loved");
        assert_eq!(out.len(), 2);
    }

    #[test]
    fn feed_and_stations_on_a_small_library() {
        let dir = std::env::temp_dir().join(format!("wavebit-home-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let lib = Library::new(dir.join("lib.db").to_string_lossy().into_owned()).unwrap();
        {
            let conn = lib.conn().unwrap();
            for (i, (artist, album, plays)) in [
                ("Kesi", "Night Shift", 5),
                ("Kesi", "Night Shift", 3),
                ("Mara Vell", "Glasshouse", 0),
                ("Mara Vell", "Glasshouse", 0),
            ]
            .iter()
            .enumerate()
            {
                conn.execute(
                    "INSERT INTO tracks (id, path, mtime, size, title, artist, album, album_artist,
                       album_key, duration_ms, format, has_art, added_at, plays, last_played)
                     VALUES (?1, ?2, 0, 0, ?1, ?3, ?4, ?3, ?5, 1000, 'mp3', 0, ?6, ?7, ?8)",
                    params![
                        format!("{i:016x}"),
                        format!("/m/{i}.mp3"),
                        artist,
                        album,
                        super::super::short_hash(album),
                        i as i64,
                        plays,
                        (*plays > 0).then_some(now_secs() - i as i64),
                    ],
                )
                .unwrap();
            }
        }
        let feed = lib.home().unwrap();
        assert_eq!(feed.recently_played.len(), 2);
        assert_eq!(feed.on_repeat[0].plays, 5);
        assert_eq!(feed.top_artists[0].name, "Kesi");
        assert_eq!(feed.unplayed_albums.len(), 1);
        assert_eq!(feed.picks.played, 2);
        assert_eq!(feed.picks.unplayed, 2);
        assert!(feed.picks.latest_from_top);
        assert_eq!(feed.picks.featured_artist.unwrap().name, "Mara Vell");
        assert_eq!(lib.station("discovery".into(), None, 10).unwrap().len(), 2);
        assert_eq!(lib.station("personal".into(), None, 3).unwrap().len(), 3);
        assert_eq!(
            lib.station("artist".into(), Some("Kesi".into()), 10).unwrap().len(),
            2
        );
        assert!(lib.station("rediscover".into(), None, 10).unwrap().is_empty());
        drop(lib);
        let _ = std::fs::remove_dir_all(dir);
    }
}
