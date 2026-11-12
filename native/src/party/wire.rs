//! The party server's wire format (BitChord's `backend/README.md`), and what
//! wavebit does to it before trusting it: every frame comes from a server and
//! from other people's devices, so strings are clipped, addresses must be
//! https, lists are capped and numbers can't be negative.

use serde::{Deserialize, Deserializer, Serialize};

const MAX_MEMBERS: usize = 16;
const MAX_QUEUE: usize = 64;

/// Go sends `null` for an empty list; read it as empty.
fn nullable<'de, D, T>(deserializer: D) -> Result<T, D::Error>
where
    D: Deserializer<'de>,
    T: Default + Deserialize<'de>,
{
    Ok(Option::<T>::deserialize(deserializer)?.unwrap_or_default())
}

fn clip(text: &str, max: usize) -> String {
    text.chars().filter(|c| !c.is_control()).take(max).collect()
}

fn https(url: Option<String>) -> Option<String> {
    url.filter(|u| u.starts_with("https://") && u.len() <= 1000 && !u.contains(char::is_whitespace))
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
            duration_ms: self.duration_ms.filter(|d| *d > 0),
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
            track: self.track.and_then(Track::clean),
            position_ms: self.position_ms.max(0),
            effective_position_ms: self.effective_position_ms.max(0),
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
        let position = self.position_ms + (server_now_ms - self.anchor_ms).max(0);
        match self.track.as_ref().and_then(|t| t.duration_ms) {
            Some(duration) => position.min(duration),
            None => position,
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
        if items.len() != wanted {
            return Self {
                seq: self.seq,
                ..Self::default()
            };
        }
        Self { items, ..self }
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
