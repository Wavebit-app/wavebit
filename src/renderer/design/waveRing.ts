/** The geometry of a wavy progress ring, in a 100 by 100 box. */
export const RING_RADIUS = 42;
const MAX_AMPLITUDE = 3.4;
const STEPS = 240;

/** The wave lies flat near the two ends, so a start and a finish read as a plain ring. */
export function waveAmplitude(value: number): number {
  const v = Math.max(0, Math.min(1, value));
  return (
    Math.round(MAX_AMPLITUDE * Math.min(1, Math.min(v, 1 - v) / 0.12) * 10) / 10
  );
}

/** A closed ring with `waves` whole waves, so turning it looks like the wave travelling. */
export function wavePath(waves: number, amplitude: number): string {
  let d = '';
  for (let i = 0; i < STEPS; i++) {
    const t = (i / STEPS) * Math.PI * 2;
    const r = RING_RADIUS + amplitude * Math.sin(waves * t);
    const x = (50 + r * Math.cos(t)).toFixed(2);
    const y = (50 + r * Math.sin(t)).toFixed(2);
    d += `${i ? 'L' : 'M'}${x} ${y}`;
  }
  return `${d}Z`;
}

/** A sliver from the very start: a ring pinned at nothing reads as stalled. */
export const shownProgress = (value: number, live: boolean): number => {
  const v = Math.max(0, Math.min(1, value));
  return live ? Math.max(v, 0.02) : v;
};
