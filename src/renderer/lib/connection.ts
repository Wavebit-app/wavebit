import { useSyncExternalStore } from 'react';

/**
 * Whether wavebit has an internet connection, for the whole page: the title
 * bar's Offline label and the player (Keep playing offline) read the same
 * answer. The system's own online and offline events and the player noticing
 * a stuck stream mark it down; while down, YouTube is asked every few seconds
 * (offline.online(), a HEAD from the main process) until it answers. While up
 * nothing is sent, so a listener who never streams isn't checked on.
 */

const CHECK_MS = 5_000;

let down = !navigator.onLine;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const whenBack = new Set<() => void>();

function setDown(next: boolean): void {
  if (next === down) return;
  down = next;
  for (const l of listeners) l();
  if (!down) for (const back of whenBack) back();
}

function checkSoon(): void {
  clearTimeout(timer);
  if (down) timer = setTimeout(() => void checkNow(), CHECK_MS);
}

/** Asks now whether YouTube can be reached, and notes the answer. */
export async function checkNow(): Promise<boolean> {
  const reachable = await window.wavebit.offline.online().catch(() => false);
  setDown(!reachable);
  checkSoon();
  return reachable;
}

/** Something just failed for want of a connection. */
export function markDown(): void {
  setDown(true);
  checkSoon();
}

export const isDown = (): boolean => down;

/** Runs `back` each time the connection returns; returns a function that stops it. */
export function onBack(back: () => void): () => void {
  whenBack.add(back);
  return () => whenBack.delete(back);
}

export function useOffline(): boolean {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => down,
  );
}

window.addEventListener('offline', markDown);
window.addEventListener('online', () => void checkNow());
checkSoon();
