import { useSyncExternalStore } from 'react';
import { Events } from '../../../shared/ipc/channels';
import type {
  PartyReaction,
  PartyReactionId,
} from '../../../shared/schemas/party';
import {
  admit,
  BADGE_MS,
  current,
  FLOAT_MS,
  type Float,
  shouldAnnounce,
  spoken,
} from './reactionRules';

/**
 * Reactions as they arrive: what floats over the banner, the badge on each
 * person's picture in the title bar, and the line a screen reader hears.
 * They are moments, not state, so they live here and not in the party store.
 */
interface ReactionState {
  floats: Float[];
  /** memberId → the reaction on their picture right now. */
  badges: Record<string, { reaction: PartyReactionId; key: number }>;
  /** The latest line for screen readers. */
  said: string;
}

let state: ReactionState = { floats: [], badges: {}, said: '' };
const listeners = new Set<() => void>();
let lastSaid: number | null = null;

function set(next: ReactionState): void {
  state = next;
  for (const listener of listeners) listener();
}

export function useReactions<T>(select: (s: ReactionState) => T): T {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => select(state),
  );
}

function arrive(reaction: PartyReaction): void {
  const now = Date.now();
  const floats = admit(current(state.floats, now), reaction, now, reaction.id);
  const badges = {
    ...state.badges,
    [reaction.memberId]: { reaction: reaction.reaction, key: reaction.id },
  };
  let said = state.said;
  if (shouldAnnounce(lastSaid, now)) {
    lastSaid = now;
    said = spoken(
      reaction.mine ? 'You' : reaction.displayName,
      reaction.reaction,
    );
  }
  set({ floats, badges, said });
  // Each float and badge goes on its own; a newer one on the same picture stays.
  setTimeout(
    () => set({ ...state, floats: current(state.floats, Date.now()) }),
    FLOAT_MS + 50,
  );
  setTimeout(() => {
    if (state.badges[reaction.memberId]?.key !== reaction.id) return;
    const { [reaction.memberId]: _gone, ...rest } = state.badges;
    set({ ...state, badges: rest });
  }, BADGE_MS);
}

/** Starts listening. Returns the way to stop. */
export function connectReactions(): () => void {
  const off = window.wavebit.on(Events.partyReaction, arrive);
  return () => {
    off();
    set({ floats: [], badges: {}, said: '' });
  };
}

/** Sends one, through the main process and the Rust module, which limit it. */
export const react = (reaction: PartyReactionId) =>
  void window.wavebit.party.react(reaction);
