//! Decides whether a Spotify song and a local file are the same recording.
//! A port of the rules in BitChord's `TrackMatcher.kt`, reduced to what a
//! local library needs:
//!
//! - The title proper (outside brackets and after-dash packaging) must agree.
//! - Version words (remix, live, acoustic…) must agree both ways, so a live
//!   take never stands in for the studio one.
//! - When both sides name artists, at least one must be shared.
//! - Runtimes more than 30 s apart rule a file out; within 3 s scores best.
//!
//! shortcut: no Unicode normalisation (NFKD), so "Beyoncé" and "Beyonce"
//! differ; add the `unicode-normalization` crate if real libraries need it.

use std::collections::{BTreeSet, HashMap};

const VERSION_WORDS: &[&str] = &[
    "remix",
    "remixes",
    "rmx",
    "bootleg",
    "mashup",
    "live",
    "concert",
    "unplugged",
    "acoustic",
    "instrumental",
    "karaoke",
    "acapella",
    "cover",
    "demo",
    "reprise",
    "remake",
    "rework",
    "extended",
    "edit",
    "dub",
    "vip",
    "sped",
    "slowed",
    "nightcore",
    "lofi",
    "orchestral",
];
const DURATION_LIMIT_MS: u32 = 30_000;
const DURATION_TIGHT_MS: u32 = 3_000;

pub struct Candidate {
    pub id: String,
    pub title: String,
    /// Every credited name, comma separated.
    pub artists: String,
    pub duration_ms: u32,
}

struct Entry {
    id: String,
    versions: BTreeSet<String>,
    artists: Vec<String>,
    duration_ms: u32,
}

pub struct Matcher {
    by_title: HashMap<String, Vec<Entry>>,
}

fn words(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .map(str::to_string)
        .collect()
}

/// The title proper and its version words.
fn parse_title(raw: &str) -> (String, BTreeSet<String>) {
    let mut core = String::new();
    let mut packaging = String::new();
    let mut depth = 0;
    for c in raw.chars() {
        match c {
            '(' | '[' => depth += 1,
            ')' | ']' => depth = (depth - 1).max(0),
            _ if depth > 0 => packaging.push(c),
            _ => core.push(c),
        }
    }
    // "Song - Live at Wembley" and "Song - 2011 Remaster" are packaging too.
    if let Some(at) = core.find(" - ") {
        packaging.push(' ');
        packaging.push_str(&core[at + 3..]);
        core.truncate(at);
    }
    let mut title_words = words(&core);
    if let Some(at) = title_words
        .iter()
        .position(|w| matches!(w.as_str(), "feat" | "ft" | "featuring"))
    {
        title_words.truncate(at);
    }
    let versions = words(&packaging)
        .into_iter()
        .filter(|w| VERSION_WORDS.contains(&w.as_str()))
        .collect();
    (title_words.join(" "), versions)
}

fn artist_names(raw: &str) -> Vec<String> {
    let lowered = format!(" {} ", raw.to_lowercase());
    let mut text = lowered;
    for sep in [
        " feat. ",
        " feat ",
        " ft. ",
        " ft ",
        " featuring ",
        " with ",
        " x ",
        " and ",
        " & ",
    ] {
        text = text.replace(sep, ",");
    }
    text.split([',', ';', '/'])
        .map(|name| words(name).join(" "))
        .filter(|name| !name.is_empty() && name != "unknown artist")
        .collect()
}

impl Matcher {
    pub fn new(candidates: Vec<Candidate>) -> Self {
        let mut by_title: HashMap<String, Vec<Entry>> = HashMap::new();
        for c in candidates {
            let (core, versions) = parse_title(&c.title);
            if core.is_empty() {
                continue;
            }
            by_title.entry(core).or_default().push(Entry {
                id: c.id,
                versions,
                artists: artist_names(&c.artists),
                duration_ms: c.duration_ms,
            });
        }
        Self { by_title }
    }

    /// The best local file for this song, or None.
    pub fn find(&self, title: &str, artists: &str, duration_ms: u32) -> Option<String> {
        let (core, versions) = parse_title(title);
        let wanted = artist_names(artists);
        self.by_title
            .get(&core)?
            .iter()
            .filter(|e| e.versions == versions)
            .filter_map(|e| {
                let shared = wanted.iter().any(|w| e.artists.contains(w));
                if !wanted.is_empty() && !e.artists.is_empty() && !shared {
                    return None;
                }
                let mut score = 100 + if shared { 25 } else { 0 };
                if duration_ms > 0 && e.duration_ms > 0 {
                    let diff = duration_ms.abs_diff(e.duration_ms);
                    if diff > DURATION_LIMIT_MS {
                        return None;
                    }
                    score += if diff <= DURATION_TIGHT_MS { 40 } else { 15 };
                }
                Some((score, &e.id))
            })
            .max_by_key(|(score, _)| *score)
            .map(|(_, id)| id.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lib() -> Matcher {
        let c = |id: &str, title: &str, artists: &str, ms: u32| Candidate {
            id: id.into(),
            title: title.into(),
            artists: artists.into(),
            duration_ms: ms,
        };
        Matcher::new(vec![
            c("studio", "Harbour Lights", "The Low Tides", 231_000),
            c("live", "Harbour Lights (Live)", "The Low Tides", 260_000),
            c("cover", "Harbour Lights", "Someone Else", 230_000),
            c("paniyon", "Paniyon Sa", "Atif Aslam, Tulsi Kumar", 245_000),
        ])
    }

    #[test]
    fn exact_recording_wins_over_live_and_cover() {
        assert_eq!(
            lib()
                .find("Harbour Lights", "The Low Tides", 232_000)
                .as_deref(),
            Some("studio")
        );
        assert_eq!(
            lib()
                .find("Harbour Lights - Live", "The Low Tides", 259_000)
                .as_deref(),
            Some("live")
        );
    }

    #[test]
    fn packaging_and_extra_credits_do_not_block_a_match() {
        // BitChord's own regression: the film name in the title, one singer credited.
        assert_eq!(
            lib()
                .find(
                    "Paniyon Sa (From \"Satyamev Jayate\")",
                    "Atif Aslam",
                    244_000
                )
                .as_deref(),
            Some("paniyon")
        );
        assert_eq!(
            lib()
                .find("Harbour Lights - 2026 Remaster", "The Low Tides", 231_000)
                .as_deref(),
            Some("studio")
        );
    }

    #[test]
    fn wrong_artist_or_runtime_is_no_match() {
        assert_eq!(lib().find("Paniyon Sa", "Someone Else", 245_000), None);
        assert_eq!(lib().find("Paniyon Sa", "Atif Aslam", 600_000), None);
        assert_eq!(lib().find("Unknown Song", "The Low Tides", 200_000), None);
    }
}
