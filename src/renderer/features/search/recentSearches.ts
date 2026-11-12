import { useSyncExternalStore } from 'react';
import { parseSearches, withSearch } from './recentRules';

/**
 * DESIGN.md › Search: the searches the pill offers again. They stay in
 * wavebit's own storage on this computer, and are never sent anywhere.
 */
const KEY = 'wavebit.searches';

function stored(): string[] {
  try {
    return parseSearches(localStorage.getItem(KEY));
  } catch {
    return [];
  }
}

let list = stored();
const listeners = new Set<() => void>();

function save(next: string[]): void {
  if (next === list) return;
  list = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage full or blocked: they last until wavebit closes.
  }
  for (const l of listeners) l();
}

export const recentSearches = {
  add: (query: string) => save(withSearch(list, query)),
  remove: (query: string) => save(list.filter((s) => s !== query)),
  clear: () => save([]),
};

export function useRecentSearches(): string[] {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => list,
  );
}
