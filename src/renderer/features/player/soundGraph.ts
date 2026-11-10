import {
  BAND_HZ,
  bandKind,
  type SoundTargets,
  type StereoMatrix,
} from './audioEffects';

/** The sound stages every deck shares, after its fader. */
export interface Sound {
  /** Where the decks connect. */
  preamp: GainNode;
  filters: BiquadFilterNode[];
  matrix: Record<keyof StereoMatrix, GainNode>;
}

/**
 * Preamp, seven bands, then a left and right matrix into `output`. Takes any
 * context, so an offline render goes through the same chain as playback.
 */
export function buildSound(
  context: BaseAudioContext,
  output: AudioNode,
): Sound {
  const preamp = context.createGain();
  // Without this a mono file would reach the splitter with its right side empty.
  preamp.channelCount = 2;
  preamp.channelCountMode = 'explicit';
  preamp.channelInterpretation = 'speakers';
  const filters = BAND_HZ.map((hz, i) => {
    const filter = context.createBiquadFilter();
    filter.type = bandKind(i);
    filter.frequency.value = hz;
    filter.Q.value = 1;
    return filter;
  });
  const split = context.createChannelSplitter(2);
  const merge = context.createChannelMerger(2);
  const stage = () => context.createGain();
  const matrix = { ll: stage(), rl: stage(), lr: stage(), rr: stage() };
  preamp.connect(filters[0]!);
  filters.forEach(
    (filter, i) => filters[i + 1] && filter.connect(filters[i + 1]!),
  );
  filters.at(-1)!.connect(split);
  split.connect(matrix.ll, 0).connect(merge, 0, 0);
  split.connect(matrix.rl, 1).connect(merge, 0, 0);
  split.connect(matrix.lr, 0).connect(merge, 0, 1);
  split.connect(matrix.rr, 1).connect(merge, 0, 1);
  merge.connect(output);
  return { preamp, filters, matrix };
}

/** Glides every stage to its target in about 20ms, so a slider never clicks. */
export function setSound(sound: Sound, to: SoundTargets, now: number): void {
  sound.preamp.gain.setTargetAtTime(to.preamp, now, 0.02);
  sound.filters.forEach((filter, i) =>
    filter.gain.setTargetAtTime(to.gains[i] ?? 0, now, 0.02),
  );
  for (const key of Object.keys(to.matrix) as (keyof StereoMatrix)[])
    sound.matrix[key].gain.setTargetAtTime(to.matrix[key], now, 0.02);
}
