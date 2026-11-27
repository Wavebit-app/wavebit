import type { PartyReactionId } from '../../../shared/schemas/party.ts';

/**
 * Party reactions, apart from React so they can be tested. Only the ids
 * travel; what each looks like and is called is decided here.
 */

export const REACTIONS: Record<
  PartyReactionId,
  { emoji: string; name: string }
> = {
  heart: { emoji: '❤️', name: 'Love it' },
  fire: { emoji: '🔥', name: 'Fire' },
  laugh: { emoji: '😂', name: 'Laughing' },
  wow: { emoji: '😮', name: 'Wow' },
  sad: { emoji: '😢', name: 'Sad' },
  clap: { emoji: '👏', name: 'Applause' },
  party: { emoji: '🎉', name: 'Celebrate' },
  dance: { emoji: '💃', name: 'Dancing' },
};

/** At most this many on the banner at once. */
export const MAX_FLOATS = 8;
/** The same person sending the same reaction this soon after shows a count. */
export const MERGE_MS = 400;
/** How long one stays: it rises and fades in this time, once. */
export const FLOAT_MS = 1_600;
/** How long a badge stays on a picture in the title bar. */
export const BADGE_MS = 1_400;
/** Screen readers hear at most one reaction in this long. */
export const ANNOUNCE_GAP_MS = 3_000;

export interface Float {
  key: number;
  memberId: string;
  reaction: PartyReactionId;
  count: number;
  /** When it last appeared or was added to. */
  at: number;
  /** Where across the banner, in percent: the same key, the same place. */
  lane: number;
}

/** A spread across the banner that doesn't depend on randomness. */
export const lane = (key: number): number => 8 + ((key * 37) % 70);

/**
 * The floats after a reaction arrives at `now`: a repeat from the same person
 * within MERGE_MS adds to its count and starts it again; anything else is a
 * new float, and the oldest goes when there are too many.
 */
export function admit(
  floats: readonly Float[],
  incoming: { memberId: string; reaction: PartyReactionId },
  now: number,
  key: number,
): Float[] {
  const index = floats.findIndex(
    (f) =>
      f.memberId === incoming.memberId &&
      f.reaction === incoming.reaction &&
      now - f.at < MERGE_MS,
  );
  if (index >= 0)
    return floats.map((f, i) =>
      i === index ? { ...f, count: f.count + 1, at: now } : f,
    );
  const next = [
    ...floats,
    {
      key,
      memberId: incoming.memberId,
      reaction: incoming.reaction,
      count: 1,
      at: now,
      lane: lane(key),
    },
  ];
  return next.slice(Math.max(0, next.length - MAX_FLOATS));
}

/** The floats still on screen at `now`. */
export const current = (floats: readonly Float[], now: number): Float[] =>
  floats.filter((f) => now - f.at < FLOAT_MS);

/** Whether a screen reader should hear this one. */
export const shouldAnnounce = (lastAt: number | null, now: number) =>
  lastAt === null || now - lastAt >= ANNOUNCE_GAP_MS;

/** What a screen reader hears. */
export const spoken = (name: string, reaction: PartyReactionId) =>
  `${name}: ${REACTIONS[reaction].name}`;
