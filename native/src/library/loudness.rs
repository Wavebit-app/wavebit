//! EBU R128 integrated loudness and sample peak for one file, measured on the
//! libuv pool the first time a song is about to play. BitChord levels each
//! player for its own track; wavebit does the same, with a figure per file.

use std::fs::File;
use std::path::Path;

use ebur128::{EbuR128, Mode};
use napi::{Env, Result, Task};
use napi_derive::napi;
use rusqlite::{Connection, OptionalExtension, params};
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::errors::Error as DecodeError;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

use crate::db_err;

#[napi(object)]
#[derive(Clone, Copy, Debug)]
pub struct Loudness {
    /// Integrated loudness in LUFS; null when the file can't be decoded.
    pub lufs: Option<f64>,
    /// Sample peak, 1.0 = full scale.
    pub peak: Option<f64>,
}

/// Decodes the whole file once. shortcut: Opus has no decoder in symphonia,
/// so Opus files without a ReplayGain tag stay un-normalised.
pub(crate) fn measure(path: &Path) -> Option<Loudness> {
    let file = File::open(path).ok()?;
    let stream = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }
    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            stream,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .ok()?;
    let mut format = probed.format;
    let track = format.default_track()?;
    let track_id = track.id;
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .ok()?;

    let mut meter: Option<EbuR128> = None;
    let mut samples: Option<SampleBuffer<f32>> = None;
    // Ends at end of stream, or at a reset this measurement doesn't need to follow.
    while let Ok(packet) = format.next_packet() {
        if packet.track_id() != track_id {
            continue;
        }
        let decoded = match decoder.decode(&packet) {
            Ok(decoded) => decoded,
            Err(DecodeError::DecodeError(_)) => continue,
            Err(_) => break,
        };
        let spec = *decoded.spec();
        if meter.is_none() {
            meter = EbuR128::new(
                spec.channels.count() as u32,
                spec.rate,
                Mode::I | Mode::SAMPLE_PEAK,
            )
            .ok();
        }
        if samples
            .as_ref()
            .is_none_or(|b| b.capacity() < decoded.capacity())
        {
            samples = Some(SampleBuffer::new(decoded.capacity() as u64, spec));
        }
        let buffer = samples.as_mut()?;
        buffer.copy_interleaved_ref(decoded);
        meter.as_mut()?.add_frames_f32(buffer.samples()).ok()?;
    }

    let meter = meter?;
    let lufs = meter.loudness_global().ok().filter(|v| v.is_finite());
    let channels = meter.channels();
    let peak = (0..channels)
        .filter_map(|c| meter.sample_peak(c).ok())
        .fold(0.0_f64, f64::max);
    Some(Loudness {
        lufs,
        peak: (peak > 0.0).then_some(peak),
    })
}

pub struct LoudnessTask {
    db_path: String,
    id: String,
}

impl LoudnessTask {
    pub(crate) fn new(db_path: String, id: String) -> Self {
        Self { db_path, id }
    }
}

fn run(db_path: &str, id: &str) -> rusqlite::Result<Loudness> {
    let conn = Connection::open(db_path)?;
    conn.busy_timeout(std::time::Duration::from_secs(5))?;
    let row: Option<(String, Option<f64>, Option<f64>)> = conn
        .query_row(
            "SELECT path, loudness_lufs, peak FROM tracks WHERE id = ?1",
            params![id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?;
    let Some((path, lufs, peak)) = row else {
        return Ok(Loudness {
            lufs: None,
            peak: None,
        });
    };
    if lufs.is_some() {
        return Ok(Loudness { lufs, peak });
    }
    let measured = measure(Path::new(&path)).unwrap_or(Loudness {
        lufs: None,
        peak: None,
    });
    if measured.lufs.is_some() {
        conn.execute(
            "UPDATE tracks SET loudness_lufs = ?2, peak = ?3 WHERE id = ?1",
            params![id, measured.lufs, measured.peak],
        )?;
    }
    Ok(measured)
}

impl Task for LoudnessTask {
    type Output = Loudness;
    type JsValue = Loudness;

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

    /// A sine at -6 dBFS (amplitude 0.5) measures about -9 LUFS mono with a 0.5 peak.
    #[test]
    fn measures_a_sine() {
        let rate = 44_100u32;
        let n = rate as usize * 3;
        let mut data = Vec::with_capacity(n * 2);
        for i in 0..n {
            let v = (0.5
                * (2.0 * std::f64::consts::PI * 1000.0 * i as f64 / rate as f64).sin()
                * 32767.0) as i16;
            data.extend_from_slice(&v.to_le_bytes());
        }
        let mut wav = Vec::new();
        wav.extend_from_slice(b"RIFF");
        wav.extend_from_slice(&(36 + data.len() as u32).to_le_bytes());
        wav.extend_from_slice(b"WAVEfmt ");
        wav.extend_from_slice(&16u32.to_le_bytes());
        wav.extend_from_slice(&1u16.to_le_bytes());
        wav.extend_from_slice(&1u16.to_le_bytes());
        wav.extend_from_slice(&rate.to_le_bytes());
        wav.extend_from_slice(&(rate * 2).to_le_bytes());
        wav.extend_from_slice(&2u16.to_le_bytes());
        wav.extend_from_slice(&16u16.to_le_bytes());
        wav.extend_from_slice(b"data");
        wav.extend_from_slice(&(data.len() as u32).to_le_bytes());
        wav.extend_from_slice(&data);
        let path = std::env::temp_dir().join(format!("wavebit-loud-{}.wav", std::process::id()));
        std::fs::write(&path, wav).unwrap();

        let loud = measure(&path).unwrap();
        std::fs::remove_file(&path).ok();
        let lufs = loud.lufs.unwrap();
        assert!((lufs - -9.0).abs() < 1.0, "lufs {lufs}");
        assert!((loud.peak.unwrap() - 0.5).abs() < 0.01);
    }
}
