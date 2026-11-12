/**
 * Where a song stopped when it was left before its end, so choosing it again
 * carries on from there. Pure, so it can be tested.
 */

/** Seconds into each unfinished song, the one left longest ago first. */
export type ResumePoints = Map<string, number>;

/** A song that had barely started begins again. */
export const RESUME_AFTER_S = 5;
/** This close to its end, a song has been heard. */
export const RESUME_BEFORE_END_S = 10;
export const MAX_POINTS = 200;

const SONG_ID =
  /^(?:[0-9a-f]{16}|youtube:[\w-]{11}|spotify:track:[A-Za-z0-9]{22})$/;

/** Notes where a song is now, or forgets it when there is nothing to go back to. */
export function notePoint(
  points: ResumePoints,
  id: string,
  position: number,
  duration: number,
): void {
  points.delete(id);
  if (
    !(position >= RESUME_AFTER_S) ||
    !(duration > 0) ||
    position > duration - RESUME_BEFORE_END_S
  )
    return;
  points.set(id, position);
  for (const oldest of points.keys()) {
    if (points.size <= MAX_POINTS) break;
    points.delete(oldest);
  }
}

/** Reads what was saved. Storage is untrusted: anything unexpected is dropped. */
export function parsePoints(raw: string | null): ResumePoints {
  const points: ResumePoints = new Map();
  let saved: unknown;
  try {
    saved = JSON.parse(raw ?? '[]');
  } catch {
    return points;
  }
  if (!Array.isArray(saved)) return points;
  for (const entry of saved.slice(-MAX_POINTS)) {
    if (!Array.isArray(entry)) continue;
    const [id, at] = entry as unknown[];
    if (
      typeof id === 'string' &&
      SONG_ID.test(id) &&
      typeof at === 'number' &&
      Number.isFinite(at) &&
      at >= RESUME_AFTER_S
    )
      points.set(id, at);
  }
  return points;
}
