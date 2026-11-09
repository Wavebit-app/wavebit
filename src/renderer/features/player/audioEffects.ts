/** The equaliser's seven bands: a shelf at each end, bells between. */
export const BAND_HZ = [60, 150, 400, 1_000, 2_500, 6_000, 14_000] as const;
export const BAND_LIMIT_DB = 12;
export const FLAT_BANDS: readonly number[] = BAND_HZ.map(() => 0);

export interface EqPreset {
  id: string;
  name: string;
  bands: readonly number[];
}

/** Starting points, kept modest because every decibel of boost costs headroom. */
export const EQ_PRESETS: readonly EqPreset[] = [
  { id: 'flat', name: 'Flat', bands: FLAT_BANDS },
  { id: 'acoustic', name: 'Acoustic', bands: [2.5, 1, 0, 1, 2, 2.5, 1.5] },
  { id: 'bass-boost', name: 'Bass boost', bands: [5.5, 3.5, 1, 0, 0, 0, 0] },
  { id: 'bass-cut', name: 'Bass cut', bands: [-5.5, -3.5, -1, 0, 0, 0, 0] },
  { id: 'vocal', name: 'Vocal', bands: [-2.5, -1, 1.5, 3, 2.5, 1.5, -0.5] },
  { id: 'treble-boost', name: 'Treble boost', bands: [0, 0, 0, 0, 1, 3, 5.5] },
  { id: 'treble-cut', name: 'Treble cut', bands: [0, 0, 0, 0, -1, -3, -5.5] },
  { id: 'loudness', name: 'Loudness', bands: [5, 3, 0, -1, -0.5, 2.5, 4.5] },
  { id: 'spoken', name: 'Spoken word', bands: [-4, -2, 1, 3.5, 3, 1, -1.5] },
  {
    id: 'electronic',
    name: 'Electronic',
    bands: [4.5, 2.5, -0.5, 0.5, 1, 3.5, 3.5],
  },
  { id: 'rock', name: 'Rock', bands: [3.5, 2, -1.5, -1, 1.5, 3, 3] },
  { id: 'hip-hop', name: 'Hip-hop', bands: [5.5, 3.5, 1, -0.5, 0, 1.5, 2] },
  { id: 'jazz', name: 'Jazz', bands: [2.5, 1, 0.5, 1, 1, 2, 2] },
  { id: 'classical', name: 'Classical', bands: [2.5, 1.5, 0, 0, 0.5, 2, 2.5] },
  {
    id: 'small-speakers',
    name: 'Small speakers',
    bands: [4.5, 3.5, 1.5, 0, 0, -0.5, -1.5],
  },
  {
    id: 'late-night',
    name: 'Late night',
    bands: [2.5, 1, 0, 1, 0.5, -1.5, -2.5],
  },
];

/** The preset these bands are, or null once a slider has made them your own. */
export function presetFor(bands: readonly number[]): EqPreset | null {
  return (
    EQ_PRESETS.find((preset) =>
      preset.bands.every((db, i) => Math.abs(db - (bands[i] ?? 0)) < 0.05),
    ) ?? null
  );
}

/** Linear gain before the bands, taking back the largest boost so they can't clip. */
export function preampGain(bands: readonly number[]): number {
  return 10 ** (-Math.max(0, ...bands) / 20);
}

/** How much the difference between the channels is raised when widening. */
const STEREO_WIDTH = 1.6;

export interface StereoMatrix {
  /** Left input to left output, and so on. */
  ll: number;
  rl: number;
  lr: number;
  rr: number;
}

/**
 * Widening raises what differs between the channels and leaves what they
 * share; balance quietens one side. Off and centred, the sound passes untouched.
 */
export function stereoMatrix(widen: boolean, balance: number): StereoMatrix {
  const width = widen ? STEREO_WIDTH : 1;
  const trim = widen ? 1 / Math.sqrt(width) : 1;
  const same = ((1 + width) / 2) * trim;
  const cross = ((1 - width) / 2) * trim;
  const left = balance > 0 ? 1 - balance : 1;
  const right = balance < 0 ? 1 + balance : 1;
  return {
    ll: same * left,
    rl: cross * left,
    lr: cross * right,
    rr: same * right,
  };
}

/** Below this peak (about -50 dB) a stretch of a song counts as silence. */
const SILENCE_PEAK = 0.003;

export function isSilent(samples: ArrayLike<number>): boolean {
  for (let i = 0; i < samples.length; i++)
    if (Math.abs(samples[i]!) > SILENCE_PEAK) return false;
  return true;
}
