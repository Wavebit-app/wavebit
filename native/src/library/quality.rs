//! A library file's audio format, read from its header for Discord's quality
//! line. Only the file's own properties are read (no tags, no pictures), and
//! the path comes from the library, never from the caller.

use std::fs::File;
use std::io::BufReader;
use std::path::Path;

use lofty::config::ParseOptions;
use lofty::file::{AudioFile, FileType};
use lofty::mp4::{Mp4Codec, Mp4File};
use lofty::probe::Probe;
use napi::{Env, Result, Task};
use napi_derive::napi;
use rusqlite::{Connection, OptionalExtension, params};

use crate::db_err;

/** What a file's header says about its audio. */
#[napi(object)]
#[derive(Clone, Debug, PartialEq)]
pub struct AudioQuality {
    /// Short codec name: FLAC, ALAC, WAV, AIFF, APE, WavPack, MP3, AAC, Opus, Vorbis…
    pub codec: String,
    /// True for FLAC, ALAC, WAV, AIFF, APE and WavPack.
    pub lossless: bool,
    pub sample_rate_hz: Option<u32>,
    pub bit_depth: Option<u32>,
    pub bitrate_kbps: Option<u32>,
    pub channels: Option<u32>,
}

fn options() -> ParseOptions {
    ParseOptions::new().read_tags(false).read_cover_art(false)
}

/// The codec label and whether it is lossless, for a file type (and an MP4's codec).
fn codec_of(kind: FileType, mp4: Option<Mp4Codec>) -> Option<(&'static str, bool)> {
    Some(match kind {
        FileType::Flac => ("FLAC", true),
        FileType::Wav => ("WAV", true),
        FileType::Aiff => ("AIFF", true),
        FileType::Ape => ("APE", true),
        FileType::WavPack => ("WavPack", true),
        FileType::Mpeg => ("MP3", false),
        FileType::Aac => ("AAC", false),
        FileType::Opus => ("Opus", false),
        FileType::Vorbis => ("Vorbis", false),
        FileType::Speex => ("Speex", false),
        FileType::Mpc => ("Musepack", false),
        FileType::Mp4 => match mp4 {
            Some(Mp4Codec::ALAC) => ("ALAC", true),
            Some(Mp4Codec::FLAC) => ("FLAC", true),
            Some(Mp4Codec::MP3) => ("MP3", false),
            _ => ("AAC", false),
        },
        _ => return None,
    })
}

pub(crate) fn read_quality(path: &Path) -> Option<AudioQuality> {
    use lofty::prelude::TaggedFileExt;
    let file = Probe::open(path).ok()?.options(options()).read().ok()?;
    let kind = file.file_type();
    let mp4 = if kind == FileType::Mp4 {
        let mut reader = BufReader::new(File::open(path).ok()?);
        Mp4File::read_from(&mut reader, options())
            .ok()
            .and_then(|f| f.properties().codec())
    } else {
        None
    };
    let (codec, lossless) = codec_of(kind, mp4)?;
    let props = file.properties();
    Some(AudioQuality {
        codec: codec.to_string(),
        lossless,
        sample_rate_hz: props.sample_rate().filter(|&v| v > 0),
        bit_depth: props.bit_depth().map(u32::from).filter(|&v| v > 0),
        bitrate_kbps: props.audio_bitrate().filter(|&v| v > 0),
        channels: props.channels().map(u32::from).filter(|&v| v > 0),
    })
}

pub struct AudioQualityTask {
    db_path: String,
    id: String,
}

impl AudioQualityTask {
    pub(crate) fn new(db_path: String, id: String) -> Self {
        Self { db_path, id }
    }
}

fn run(db_path: &str, id: &str) -> rusqlite::Result<Option<AudioQuality>> {
    let conn = Connection::open(db_path)?;
    conn.busy_timeout(std::time::Duration::from_secs(5))?;
    let path: Option<String> = conn
        .query_row("SELECT path FROM tracks WHERE id = ?1", params![id], |r| {
            r.get(0)
        })
        .optional()?;
    Ok(path.and_then(|p| read_quality(Path::new(&p))))
}

impl Task for AudioQualityTask {
    type Output = Option<AudioQuality>;
    type JsValue = Option<AudioQuality>;

    fn compute(&mut self) -> Result<Self::Output> {
        run(&self.db_path, &self.id).map_err(db_err)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codecs_map_to_labels_and_losslessness() {
        assert_eq!(codec_of(FileType::Flac, None), Some(("FLAC", true)));
        assert_eq!(codec_of(FileType::Mpeg, None), Some(("MP3", false)));
        assert_eq!(
            codec_of(FileType::Mp4, Some(Mp4Codec::ALAC)),
            Some(("ALAC", true))
        );
        assert_eq!(codec_of(FileType::Mp4, None), Some(("AAC", false)));
    }

    #[test]
    fn a_wav_header_gives_its_rate_depth_and_channels() {
        let dir = std::env::temp_dir().join(format!("wavebit-quality-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("tone.wav");
        // 0.1 s of 24-bit stereo silence at 96 kHz.
        let (rate, depth, channels) = (96_000u32, 24u16, 2u16);
        let block = channels * depth / 8;
        let data = vec![0u8; (rate / 10) as usize * block as usize];
        let mut wav = Vec::new();
        wav.extend_from_slice(b"RIFF");
        wav.extend_from_slice(&(36 + data.len() as u32).to_le_bytes());
        wav.extend_from_slice(b"WAVEfmt ");
        wav.extend_from_slice(&16u32.to_le_bytes());
        wav.extend_from_slice(&1u16.to_le_bytes());
        wav.extend_from_slice(&channels.to_le_bytes());
        wav.extend_from_slice(&rate.to_le_bytes());
        wav.extend_from_slice(&(rate * block as u32).to_le_bytes());
        wav.extend_from_slice(&block.to_le_bytes());
        wav.extend_from_slice(&depth.to_le_bytes());
        wav.extend_from_slice(b"data");
        wav.extend_from_slice(&(data.len() as u32).to_le_bytes());
        wav.extend_from_slice(&data);
        std::fs::write(&path, wav).unwrap();

        let quality = read_quality(&path).unwrap();
        assert_eq!(quality.codec, "WAV");
        assert!(quality.lossless);
        assert_eq!(quality.sample_rate_hz, Some(96_000));
        assert_eq!(quality.bit_depth, Some(24));
        assert_eq!(quality.channels, Some(2));
        let _ = std::fs::remove_dir_all(dir);
    }
}
