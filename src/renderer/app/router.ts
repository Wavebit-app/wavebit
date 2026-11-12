import { useSyncExternalStore } from 'react';
import type { RefreshScope } from '../../shared/schemas/refresh';

/** The overview (links and shelves) or one full collection. */
export type LibraryTab =
  | 'overview'
  | 'downloads'
  | 'songs'
  | 'albums'
  | 'artists'
  | 'playlists';
export type SettingsSection =
  | 'appearance'
  | 'party'
  | 'spotify'
  | 'youtube'
  | 'library'
  | 'playback'
  | 'content'
  | 'downloads'
  | 'about';

export type Route =
  | { name: 'home' }
  | { name: 'explore' }
  | { name: 'exploreCategory'; params: string; title: string }
  | { name: 'library'; tab: LibraryTab }
  | { name: 'album'; key: string }
  | { name: 'artist'; artist: string }
  | { name: 'playlist'; id: string }
  | { name: 'spotifyAlbum'; id: string }
  | { name: 'spotifyArtist'; id: string }
  | { name: 'spotifySong'; id: string }
  | { name: 'ytPage'; id: string }
  | { name: 'ytArtist'; id: string }
  | { name: 'search'; query: string }
  | { name: 'settings'; section: SettingsSection };

/** What pulling a page to refresh it should ask the services again for. */
export function refreshScope(route: Route): RefreshScope {
  if (route.name === 'home') return 'home';
  if (route.name === 'explore') return 'explore';
  return route.name === 'library' ? 'library' : 'page';
}

/**
 * A small history stack, enough for Back and Forward in the title bar.
 * shortcut: state-based, not URL-based; switch to TanStack Router if pages
 * ever need deep links.
 */
let back: Route[] = [];
let current: Route = { name: 'home' };
let forward: Route[] = [];
const listeners = new Set<() => void>();
let snapshot: { route: Route; canBack: boolean; canForward: boolean } = {
  route: current,
  canBack: false,
  canForward: false,
};

function publish(): void {
  snapshot = {
    route: current,
    canBack: back.length > 0,
    canForward: forward.length > 0,
  };
  for (const l of listeners) l();
}

export const nav = {
  /** The page showing now, for code that isn't drawing it. */
  current: (): Route => current,
  go(route: Route): void {
    if (JSON.stringify(route) === JSON.stringify(current)) return;
    back = [...back.slice(-49), current];
    forward = [];
    current = route;
    publish();
  },
  back(): void {
    const prev = back.at(-1);
    if (!prev) return;
    back = back.slice(0, -1);
    forward = [current, ...forward];
    current = prev;
    publish();
  },
  forward(): void {
    const next = forward[0];
    if (!next) return;
    forward = forward.slice(1);
    back = [...back, current];
    current = next;
    publish();
  },
  /** The last page that wasn't Settings, for Settings' back arrow. */
  leaveSettings(): void {
    const target = [...back].reverse().find((r) => r.name !== 'settings');
    nav.go(target ?? { name: 'home' });
  },
};

export function useNav() {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => snapshot,
  );
}
