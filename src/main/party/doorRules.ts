/**
 * A party this device was removed from stays shut to it for a day, as
 * BitChord's apps do. The party server holds no grudge and would let it
 * straight back in, so the door is this device's own. Apart from Electron so
 * it can be tested.
 */

export const SHUT_MS = 24 * 60 * 60 * 1000;

/** Party code to when its door opens again. */
export type Doors = Record<string, number>;

/** The doors still shut at `now`. Read from disk, so anything malformed is dropped. */
export function stillShut(doors: unknown, now: number): Doors {
  if (!doors || typeof doors !== 'object') return {};
  return Object.fromEntries(
    Object.entries(doors).filter(
      ([code, until]) =>
        /^[A-Z0-9]{6}$/.test(code) &&
        typeof until === 'number' &&
        until > now &&
        // A clock set back can't keep a door shut for longer than a day.
        until <= now + SHUT_MS,
    ),
  );
}

export const shut = (doors: unknown, code: string, now: number): Doors => ({
  ...stillShut(doors, now),
  [code]: now + SHUT_MS,
});
