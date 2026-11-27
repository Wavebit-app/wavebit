//! The party server's wire format (BitChord's `backend/README.md`), and what
//! wavebit does to it before trusting it: every frame comes from a server and
//! from other people's devices, so strings are clipped, addresses must be
//! https, lists are capped and numbers can't be negative.

use serde::{Deserialize, Deserializer, Serialize};

const MAX_MEMBERS: usize = 16;
const MAX_QUEUE: usize = 200;
/// A day: longer than any song, and the bound on every position and length.
pub const MAX_POSITION_MS: i64 = 86_400_000;
/// Sequence numbers stay where JavaScript can still count them exactly.
const MAX_SEQ: i64 = 1 << 53;

/// The reactions a member may send. The ids are all that travel; the app
/// draws each one itself. Must match the server's `protocol/reactions.json`.
pub const REACTIONS: [&str; 8] = [
    "heart", "fire", "laugh", "wow", "sad", "clap", "party", "dance",
];

/// What wavebit's server adds to BitChord's protocol; BitChord's sends none.
pub const FEATURE_REACTIONS: &str = "reactions";

/// Go sends `null` for an empty list; read it as empty.
fn nullable<'de, D, T>(deserializer: D) -> Result<T, D::Error>
where
    D: Deserializer<'de>,
    T: Default + Deserialize<'de>,
{
    Ok(Option::<T>::deserialize(deserializer)?.unwrap_or_default())
}

/// Characters that change how the text around them reads without showing:
/// direction overrides and isolates, zero-width spaces and marks, word
/// joiners, the byte-order mark, interlinear annotation. A name made of them
/// could pass for someone else's. The zero-width joiner stays, since emoji
/// sequences are built with it.
fn invisible(c: char) -> bool {
    matches!(c,
        '\u{00AD}' | '\u{061C}' | '\u{180E}' | '\u{200B}' | '\u{200C}' | '\u{200E}' | '\u{200F}'
        | '\u{202A}'..='\u{202E}' | '\u{2060}'..='\u{2064}' | '\u{2066}'..='\u{206F}'
        | '\u{FEFF}' | '\u{FFF9}'..='\u{FFFB}')
}

/// At most `max` characters, without control or invisible characters, with
/// every run of white space (line separators included) folded to one space.
pub fn clip(text: &str, max: usize) -> String {
    let mut out = String::new();
    let mut count = 0;
    let mut space = false;
    for c in text.chars() {
        if c.is_whitespace() {
            space = count > 0;
            continue;
        }
        if c.is_control() || invisible(c) {
            continue;
        }
        if space {
            if count + 1 >= max {
                break;
            }
            out.push(' ');
            count += 1;
            space = false;
        }
        if count >= max {
            break;
        }
        out.push(c);
        count += 1;
    }
    out
}

/// The picture hosts the app's page loads from (its CSP `img-src`); a
/// picture anywhere else is dropped here rather than left to the CSP.
const IMAGE_HOSTS: [&str; 5] = [
    "googleusercontent.com",
    "ggpht.com",
    "ytimg.com",
    "scdn.co",
    "spotifycdn.com",
];

fn https(url: Option<String>) -> Option<String> {
    let url = url?;
    if url.len() > 1000 || url.contains(char::is_whitespace) {
        return None;
    }
    let rest = url.strip_prefix("https://")?;
    let host = rest.split(['/', '?', '#']).next()?.to_ascii_lowercase();
    if host.contains(['@', ':']) {
        return None;
    }
    IMAGE_HOSTS
        .iter()
        .any(|allowed| host == *allowed || host.ends_with(&format!(".{allowed}")))
        .then_some(url)
}

/// A song as the party knows it: enough to name and show it.
#[derive(Serialize, Deserialize, Clone, PartialEq, Default, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct Track {
    pub video_id: String,
    pub title: String,
    pub artist: String,
    pub thumbnail_url: Option<String>,
    pub duration_ms: Option<i64>,
    pub from_autoplay: bool,
}

impl Track {
    /// None for a track with no usable id.
    fn clean(self) -> Option<Self> {
        let id_ok = !self.video_id.is_empty()
            && self.video_id.len() <= 64
            && self
                .video_id
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
        id_ok.then(|| Self {
            title: clip(&self.title, 300),
            artist: clip(&self.artist, 300),
            thumbnail_url: https(self.thumbnail_url),
            duration_ms: self.duration_ms.filter(|d| *d > 0 && *d <= MAX_POSITION_MS),
            ..self
        })
    }
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Default, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct Member {
    pub member_id: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
    pub is_host: bool,
    /// Holding a socket right now, not whether they are still in.
    pub connected: bool,
    pub joined_at_ms: i64,
}

impl Member {
    pub fn clean(self) -> Self {
        Self {
            member_id: clip(&self.member_id, 64),
            display_name: clip(&self.display_name, 80),
            avatar_url: https(self.avatar_url),
            ..self
        }
    }
}

/// Where the party is, as of a server timestamp: `position_ms` at `anchor_ms`.
#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct Playback {
    /// Only climbs; a state older than the one applied is dropped.
    pub seq: i64,
    pub track: Option<Track>,
    pub queue_seq: i64,
    pub queue_index: i64,
    pub is_playing: bool,
    pub position_ms: i64,
    pub anchor_ms: i64,
    /// The server's own reading at the instant it sent the frame.
    pub effective_position_ms: i64,
    pub started_by: Option<String>,
    pub started_by_name: Option<String>,
    pub autoplay_enabled: bool,
}

impl Default for Playback {
    fn default() -> Self {
        Self {
            seq: 0,
            track: None,
            queue_seq: 0,
            queue_index: -1,
            is_playing: false,
            position_ms: 0,
            anchor_ms: 0,
            effective_position_ms: 0,
            started_by: None,
            started_by_name: None,
            autoplay_enabled: false,
        }
    }
}

impl Playback {
    pub fn clean(self) -> Self {
        Self {
            seq: self.seq.clamp(0, MAX_SEQ),
            queue_seq: self.queue_seq.clamp(0, MAX_SEQ),
            queue_index: self.queue_index.clamp(-1, MAX_QUEUE as i64),
            track: self.track.and_then(Track::clean),
            position_ms: self.position_ms.clamp(0, MAX_POSITION_MS),
            effective_position_ms: self.effective_position_ms.clamp(0, MAX_POSITION_MS),
            started_by: self.started_by.map(|s| clip(&s, 64)),
            started_by_name: self.started_by_name.map(|s| clip(&s, 80)),
            ..self
        }
    }

    /// Where the party is at `server_now_ms`, as the server itself counts it.
    pub fn position_at(&self, server_now_ms: i64) -> i64 {
        if !self.is_playing {
            return self.position_ms;
        }
        let position = self
            .position_ms
            .saturating_add(server_now_ms.saturating_sub(self.anchor_ms).max(0));
        match self.track.as_ref().and_then(|t| t.duration_ms) {
            Some(duration) => position.min(duration),
            None => position.min(MAX_POSITION_MS),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct Queue {
    pub seq: i64,
    pub index: i64,
    #[serde(deserialize_with = "nullable")]
    pub items: Vec<Track>,
}

impl Default for Queue {
    fn default() -> Self {
        Self {
            seq: 0,
            index: -1,
            items: Vec::new(),
        }
    }
}

impl Queue {
    pub fn clean(self) -> Self {
        // A dropped track would shift every index after it, so a list holding one is not kept.
        let wanted = self.items.len().min(MAX_QUEUE);
        let items: Vec<Track> = self
            .items
            .into_iter()
            .take(MAX_QUEUE)
            .filter_map(Track::clean)
            .collect();
        let seq = self.seq.clamp(0, MAX_SEQ);
        if items.len() != wanted {
            return Self {
                seq,
                ..Self::default()
            };
        }
        Self {
            items,
            seq,
            index: self.index.clamp(-1, MAX_QUEUE as i64),
        }
    }
}

/// The whole party, as `welcome`, create and join carry it.
#[derive(Deserialize, Default, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct Snapshot {
    pub code: String,
    pub max_members: i64,
    pub host_only_control: bool,
    #[serde(deserialize_with = "nullable")]
    pub members: Vec<Member>,
    pub playback: Playback,
    pub queue: Queue,
}

pub fn clean_members(members: Vec<Member>) -> Vec<Member> {
    members
        .into_iter()
        .take(MAX_MEMBERS)
        .map(Member::clean)
        .collect()
}

/// What create and join answer.
#[derive(Deserialize, Default, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct Membership {
    pub code: String,
    pub token: String,
    pub you: Member,
    pub party: Snapshot,
}

/// Who is in a party, as anyone holding its code may ask before joining.
#[derive(Deserialize, Default, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct Preview {
    pub host_name: String,
    pub max_members: i64,
    pub is_full: bool,
    #[serde(deserialize_with = "nullable")]
    pub members: Vec<Member>,
}

/// An error body, from REST or the socket.
#[derive(Deserialize, Default, Debug)]
#[serde(default)]
pub struct Refusal {
    pub error: String,
    pub message: String,
}

/// A reaction, as the server passes it on. Who sent it is checked against the
/// member list by the caller; the name shown comes from that list.
#[derive(Deserialize, Default, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct Reaction {
    pub id: i64,
    pub member_id: String,
    pub reaction: String,
    pub at_ms: i64,
}

impl Reaction {
    pub fn clean(self) -> Option<Self> {
        (self.id > 0 && self.id <= MAX_SEQ && REACTIONS.contains(&self.reaction.as_str())).then(
            || Self {
                member_id: clip(&self.member_id, 64),
                ..self
            },
        )
    }
}

/// Whether a server's `features` list (from `GET /` or `welcome`) offers
/// reactions. A short list of short names; anything else reads as none.
pub fn offers_reactions(features: &serde_json::Value) -> bool {
    features.as_array().is_some_and(|list| {
        list.len() <= 16
            && list.iter().any(|f| {
                f.as_str()
                    .is_some_and(|f| f.len() <= 32 && f == FEATURE_REACTIONS)
            })
    })
}

/// The fields a control may carry. Anything else the page put in is dropped
/// before it goes to the server.
pub const CONTROL_FIELDS: [&str; 15] = [
    "action",
    "positionMs",
    "track",
    "isPlaying",
    "queue",
    "queueIndex",
    "memberId",
    "enabled",
    "maxMembers",
    "tracks",
    "playNext",
    "videoId",
    "fromIndex",
    "toIndex",
    "index",
];

/// The controls a member may send; anything else from the page is dropped.
pub const ACTIONS: [&str; 15] = [
    "play",
    "pause",
    "seek",
    "setTrack",
    "setQueue",
    "queueAdd",
    "queueRemove",
    "queueClear",
    "queueMove",
    "next",
    "previous",
    "kick",
    "setHostOnlyControl",
    "setAutoplay",
    "setMaxMembers",
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_state_frame_reads_with_gaps_filled() {
        let playback: Playback = serde_json::from_str(
            r#"{"seq":7,"track":{"videoId":"dQw4w9WgXcQ","title":"Song","durationMs":200000},
                "isPlaying":true,"positionMs":42000,"anchorMs":1000,"updatedBy":null}"#,
        )
        .unwrap();
        let playback = playback.clean();
        assert_eq!(playback.seq, 7);
        assert_eq!(playback.queue_index, -1);
        assert_eq!(playback.track.as_ref().unwrap().artist, "");
    }

    #[test]
    fn the_playhead_is_arithmetic() {
        let mut playback = Playback {
            is_playing: true,
            position_ms: 42_000,
            anchor_ms: 1_000,
            track: Some(Track {
                video_id: "abc".into(),
                duration_ms: Some(43_000),
                ..Track::default()
            }),
            ..Playback::default()
        };
        assert_eq!(playback.position_at(1_300), 42_300);
        // Before a scheduled start it holds; it never runs backwards.
        assert_eq!(playback.position_at(700), 42_000);
        // And it stops at the song's end.
        assert_eq!(playback.position_at(9_000), 43_000);
        playback.is_playing = false;
        assert_eq!(playback.position_at(5_000), 42_000);
    }

    #[test]
    fn strangers_strings_are_cut_down() {
        let member = Member {
            display_name: "x".repeat(500) + "\n",
            avatar_url: Some("http://tracker.example/a.png".into()),
            ..Member::default()
        }
        .clean();
        assert_eq!(member.display_name.len(), 80);
        assert_eq!(member.avatar_url, None);
        // https alone isn't enough: only the hosts the app loads pictures from.
        let tracked = Member {
            avatar_url: Some("https://tracker.example/a.png".into()),
            ..Member::default()
        };
        assert_eq!(tracked.clean().avatar_url, None);
        let google = Member {
            avatar_url: Some("https://lh3.googleusercontent.com/a/x=s96".into()),
            ..Member::default()
        };
        assert!(google.clean().avatar_url.is_some());
        for sneaky in [
            "https://googleusercontent.com.evil.example/a",
            "https://user@lh3.googleusercontent.com/a",
            "https://evilytimg.com/a",
        ] {
            let m = Member {
                avatar_url: Some(sneaky.into()),
                ..Member::default()
            };
            assert_eq!(m.clean().avatar_url, None, "{sneaky}");
        }

        let track = Track {
            video_id: "ok_id-1".into(),
            thumbnail_url: Some("javascript:alert(1)".into()),
            duration_ms: Some(-5),
            ..Track::default()
        }
        .clean()
        .unwrap();
        assert_eq!(track.thumbnail_url, None);
        assert_eq!(track.duration_ms, None);
        assert!(
            Track {
                video_id: "../../x".into(),
                ..Track::default()
            }
            .clean()
            .is_none()
        );
    }

    #[test]
    fn a_queue_with_a_bad_track_is_not_kept() {
        let queue: Queue =
            serde_json::from_str(r#"{"seq":3,"index":1,"items":[{"videoId":"a"},{"videoId":""}]}"#)
                .unwrap();
        let queue = queue.clean();
        assert_eq!(queue.seq, 3);
        assert!(queue.items.is_empty());
        let empty: Queue = serde_json::from_str(r#"{"seq":4,"items":null}"#).unwrap();
        assert!(empty.clean().items.is_empty());
    }
}

#[cfg(test)]
mod more_tests {
    use super::*;

    #[test]
    fn names_lose_what_changes_how_they_read() {
        assert_eq!(clip("Ma\u{202E}ya", 80), "Maya");
        assert_eq!(clip("Ma\u{200B}ya", 80), "Maya");
        assert_eq!(
            clip("  Host\u{2028}rejoin  at evil ", 80),
            "Host rejoin at evil"
        );
        assert_eq!(
            clip("👨\u{200D}👩\u{200D}👧 family", 80),
            "👨\u{200D}👩\u{200D}👧 family"
        );
        assert_eq!(clip("ab cd", 3), "ab");
        assert_eq!(clip("ééééé", 3), "ééé");
    }

    #[test]
    fn numbers_from_a_server_are_held_to_a_range() {
        let playback: Playback = serde_json::from_str(
            r#"{"seq":9223372036854775807,"queueSeq":-4,"queueIndex":99999,
                "positionMs":99999999999,"effectivePositionMs":-1,"isPlaying":true,"anchorMs":0,
                "track":{"videoId":"abc","durationMs":999999999999}}"#,
        )
        .unwrap();
        let p = playback.clean();
        assert_eq!(p.seq, MAX_SEQ);
        assert_eq!(p.queue_seq, 0);
        assert_eq!(p.queue_index, MAX_QUEUE as i64);
        assert_eq!(p.position_ms, MAX_POSITION_MS);
        assert_eq!(p.effective_position_ms, 0);
        assert_eq!(p.track.as_ref().unwrap().duration_ms, None);
        // Far in the future, and the playhead still stops at a day.
        assert_eq!(p.position_at(i64::MAX), MAX_POSITION_MS);
        assert_eq!(p.position_at(i64::MIN), MAX_POSITION_MS);
    }

    #[test]
    fn reactions_are_one_of_the_eight() {
        let ok: Reaction =
            serde_json::from_str(r#"{"id":3,"memberId":"m1","reaction":"fire","atMs":5}"#).unwrap();
        assert!(ok.clean().is_some());
        for bad in [
            r#"{"id":3,"memberId":"m1","reaction":"🔥"}"#,
            r#"{"id":3,"memberId":"m1","reaction":"<b>hi</b>"}"#,
            r#"{"id":0,"memberId":"m1","reaction":"fire"}"#,
            r#"{"id":-2,"memberId":"m1","reaction":"fire"}"#,
        ] {
            let r: Reaction = serde_json::from_str(bad).unwrap();
            assert!(r.clean().is_none(), "{bad}");
        }
    }

    #[test]
    fn the_reaction_list_is_the_servers() {
        let server: Vec<String> =
            serde_json::from_str(include_str!("../../../server/protocol/reactions.json")).unwrap();
        assert_eq!(server, REACTIONS);
    }

    #[test]
    fn a_server_offers_reactions_only_by_saying_so() {
        assert!(offers_reactions(&serde_json::json!(["reactions"])));
        assert!(!offers_reactions(&serde_json::json!(null)));
        assert!(!offers_reactions(&serde_json::json!("reactions")));
        assert!(!offers_reactions(&serde_json::json!(["other"])));
        let long: Vec<String> = (0..20)
            .map(|i| format!("f{i}"))
            .chain(["reactions".into()])
            .collect();
        assert!(!offers_reactions(&serde_json::json!(long)));
    }
}
