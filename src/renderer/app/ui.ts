import { useSyncExternalStore } from 'react';

/** What the column at the right of the workspace shows; one at a time. */
export type Panel = 'now' | 'queue' | 'lyrics';

/** App-wide overlay state: the full-screen player, the right panel and search. */
interface UiState {
  fullPlayer: boolean;
  /** The full-screen player shows the words beside the artwork or video. */
  fullLyrics: boolean;
  panel: Panel | null;
  search: string;
  /** The Downloads sheet is open. */
  downloads: boolean;
  /** A setting chosen in Settings' search, to scroll to and tint. */
  settingsFocus: string | null;
}

let state: UiState = {
  fullPlayer: false,
  fullLyrics: false,
  panel: null,
  search: '',
  downloads: false,
  settingsFocus: null,
};
const listeners = new Set<() => void>();

export function setUi(patch: Partial<UiState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

/** The state right now, for code that isn't drawing it. */
export const currentUi = (): UiState => state;

export function useUi<T>(select: (s: UiState) => T): T {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => select(state),
  );
}

export const searchInputId = 'wavebit-search';
export const filterInputId = 'wavebit-filter';
