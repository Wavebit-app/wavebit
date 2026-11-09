/**
 * Counts a listen as BitChord's ListeningRecorder does: wall-clock time while
 * sound plays, capped per tick so a pause or a seek can't add to it. A song
 * counts once, after half its length or 4 minutes, and never under 30 seconds.
 */
export const MAX_STEP_MS = 8_000;
export const PLAY_FLOOR_MS = 30_000;
export const PLAY_CEILING_MS = 4 * 60 * 1000;
/** How much time builds up before it is written down. */
export const REPORT_MS = 30_000;

export interface Listen {
  id: string;
  last: number;
  heard: number;
  counted: boolean;
  /** Not reported yet. */
  pendingMs: number;
  pendingPlays: number;
}

export const newListen = (id: string, now: number): Listen => ({
  id,
  last: now,
  heard: 0,
  counted: false,
  pendingMs: 0,
  pendingPlays: 0,
});

/** Adds one tick of the player's clock. True on the tick the song counts as played. */
export function tick(
  listen: Listen,
  now: number,
  playing: boolean,
  lengthMs: number,
): boolean {
  const step = Math.min(Math.max(now - listen.last, 0), MAX_STEP_MS);
  listen.last = now;
  if (!playing) return false;
  listen.heard += step;
  listen.pendingMs += step;
  if (listen.counted) return false;
  const needed = Math.max(
    PLAY_FLOOR_MS,
    Math.min(lengthMs / 2, PLAY_CEILING_MS),
  );
  if (listen.heard < needed) return false;
  listen.counted = true;
  listen.pendingPlays = 1;
  return true;
}
