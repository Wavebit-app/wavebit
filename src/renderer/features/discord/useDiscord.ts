import { useSyncExternalStore } from 'react';
import { Events } from '../../../shared/ipc/channels';
import type { DiscordState } from '../../../shared/schemas/discord';

/**
 * Discord as the main process reports it: one subscription for the whole page,
 * shared by Settings › Discord, the title bar and the Playback menu.
 */
let current: DiscordState | null = null;
let started = false;
const listeners = new Set<() => void>();

function set(next: DiscordState): void {
  current = next;
  for (const listener of listeners) listener();
}

function start(): void {
  if (started) return;
  started = true;
  window.wavebit.on(Events.discordStatus, set);
  void window.wavebit.discord
    .status()
    .then(set)
    .catch(() => {});
}

function subscribe(listener: () => void): () => void {
  start();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useDiscord(): DiscordState | null {
  return useSyncExternalStore(subscribe, () => current);
}

export const setDiscordPrivate = (on: boolean) =>
  void window.wavebit.discord.setPrivate(on).catch(() => {});
