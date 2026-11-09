import type { Loudness } from '../../../shared/schemas/library';
import type { LoudnessLevel } from '../../../shared/schemas/settings';

/** Spotify's normalisation levels (Quiet, Normal, Loud) in LUFS. */
export const TARGET_LUFS: Record<LoudnessLevel, number> = {
  quiet: -23,
  normal: -14,
  loud: -11,
};

/**
 * Linear gain that brings a song to the target level. Cuts are taken in full;
 * a boost stops where the song's peak would pass full scale, so normalisation
 * never clips and needs no limiter.
 */
export function gainFor(
  l: Pick<Loudness, 'lufs' | 'peak'>,
  level: LoudnessLevel,
): number {
  if (l.lufs === undefined || l.lufs === null) return 1;
  const db = Math.max(-15, Math.min(12, TARGET_LUFS[level] - l.lufs));
  let gain = 10 ** (db / 20);
  if (gain > 1 && l.peak) gain = Math.min(gain, Math.max(1, 0.99 / l.peak));
  return gain;
}
