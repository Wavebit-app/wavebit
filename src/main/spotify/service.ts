import type { RefreshScope } from '../../shared/schemas/refresh';
import type { BrowserWindow } from 'electron';
import { errorCode } from '../../shared/errors';
import { Events } from '../../shared/ipc/channels';
import {
  LIKED_ID,
  type SpotifyAlbum,
  type SpotifyArtist,
  type SpotifyArtistPage,
  type SpotifyHome,
  type SpotifyRecent,
  type SpotifyRecentPage,
  type SpotifyPlaylist,
  type SpotifyProfile,
  type SpotifySong,
  type SpotifyStatus,
  type SpotifyTrack,
  type SpotifyTrackPage,
} from '../../shared/schemas/spotify';
import { emit } from '../ipc/handle';
import { lib } from '../library/library';
import { cached, responseCache, store } from '../services/cache';
import { readSettings, writeSettings } from '../services/settings';
import { forgetClientToken } from './clientToken';
import { cancelLogin, loginOpen, openLogin } from './loginWindow';
import {
  fetchCanvas,
  fetchLikedCount,
  fetchPlaylistPage,
  fetchPlaylists,
  fetchProfile,
  fetchAlbumPage,
  fetchArtist,
  fetchSearch,
  fetchSong,
  fetchRecent,
  fetchTop,
  fetchFollowedArtists,
  fetchSaved,
  fetchSavedAlbums,
  saveToLibrary,
  type RawPage,
} from './pathfinder';
import { clearSpotifySession, sessionFingerprint, spotify } from './session';
import { forgetToken } from './token';
import {
  webAlbumPage,
  webFollowedArtists,
  webLikedCount,
  webPlaylistPage,
  webPlaylists,
  webProfile,
  webSave,
  webSaved,
  webSavedAlbums,
  webSong,
  webRecent,
  webTop,
} from './webapi';

const PROFILE_TTL_S = 60 * 60;
const PLAYLISTS_TTL_S = 10 * 60;
const PAGE_TTL_S = 30 * 60;
const CANVAS_TTL_S = 6 * 60 * 60;
const RECENT_TTL_S = 2 * 60;
const TOP_TTL_S = 60 * 60;

type Profile = SpotifyProfile & { accountId: string | null };

/** Tries the public Web API first and BitChord's Pathfinder query when it is refused. */
async function either<T>(
  what: string,
  web: () => Promise<T>,
  pathfinder: () => Promise<T>,
): Promise<T> {
  try {
    return await web();
  } catch (error) {
    // The code only (never a URL or token), to see which path answers.
    console.info(
      `spotify: Web API refused ${what} (${errorCode(error) ?? 'error'}); using the web player's query`,
    );
    return pathfinder();
  }
}

/** The profile, cached against this session's cookie so a new sign-in never sees the old one. */
async function profile(): Promise<Profile | null> {
  const fingerprint = await sessionFingerprint();
  if (!fingerprint) return null;
  const k = `spotify:session:${fingerprint.slice(0, 16)}:profile:v2`;
  const hit = cached<Profile>(k);
  if (hit) return hit;
  try {
    const fresh = await either('profile', webProfile, fetchProfile);
    store(k, fresh, PROFILE_TTL_S);
    return fresh;
  } catch {
    // Signed in but both profile calls failed: still connected, just nameless.
    return null;
  }
}

const VIEW_CACHES: Record<RefreshScope, string[]> = {
  home: ['playlist:home:'],
  explore: [],
  library: ['playlists', 'playlist:albums', 'playlist:artists'],
  page: [
    'playlist:v3:',
    'playlist:album:',
    'playlist:artist:',
    'playlist:song:',
    'playlist:search:',
  ],
};

/** Forgets what a page shows, so a pull really asks Spotify again. */
export async function forgetViews(scope: RefreshScope): Promise<void> {
  for (const name of VIEW_CACHES[scope])
    responseCache().deletePrefix(await key(name));
}

/**
 * Cache keys carry the Spotify `account_id` (Spotify's stable key for an
 * account), so a second account never sees the first one's rows.
 */
async function key(name: string): Promise<string> {
  const p = await profile();
  const account =
    p?.accountId ?? (await sessionFingerprint())?.slice(0, 16) ?? 'none';
  return `spotify:${account}:${name}`;
}

export async function status(): Promise<SpotifyStatus> {
  const storage = spotify().storage;
  if (loginOpen()) return { state: 'signing_in', storage };
  if (!(await sessionFingerprint())) return { state: 'signed_out', storage };
  const p = await profile();
  return {
    state: 'signed_in',
    storage,
    profile: p && {
      name: p.name,
      displayName: p.displayName ?? null,
      imageUrl: p.imageUrl,
    },
  };
}

async function announce(): Promise<SpotifyStatus> {
  const next = await status();
  emit(Events.spotifyStatus, next);
  return next;
}

export async function signIn(
  parent: BrowserWindow | null,
): Promise<SpotifyStatus> {
  // Nothing to do when this profile is already signed in.
  if (await sessionFingerprint()) return announce();
  const done = openLogin(parent);
  emit(Events.spotifyStatus, {
    state: 'signing_in',
    storage: spotify().storage,
  });
  try {
    await done;
  } finally {
    forgetToken();
    forgetClientToken();
    void announce();
  }
  return status();
}

export function cancelSignIn(): void {
  cancelLogin();
}

/** Deletes the session cookie and every cached Spotify row. Spotify has no revoke call. */
export async function signOut(): Promise<SpotifyStatus> {
  forgetToken();
  forgetClientToken();
  responseCache().deletePrefix('spotify:');
  await clearSpotifySession();
  return announce();
}

/**
 * Runs a Spotify read. When it fails as signed out, the UI is told the
 * session's state again, so it offers Connect instead of a stale "signed in".
 * Nothing is deleted here: when Spotify ends a session it removes the
 * cookie itself, and the status follows the cookie.
 */
async function signedIn<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (errorCode(error) === 'signed_out') {
      forgetToken();
      void announce();
    }
    throw error;
  }
}

/** Every playlist, with Liked Songs first: a row wavebit adds, with its own cover. */
export function playlists(): Promise<SpotifyPlaylist[]> {
  return signedIn(async () => {
    const own = await readPlaylists();
    const ids = new Set(own.map((p) => p.id));
    return [
      ...own,
      ...readSettings()
        .importedPlaylists.filter((p) => !ids.has(p.id))
        .map((p) => ({ ...p, imported: true })),
    ];
  });
}

/**
 * Adds a playlist to wavebit from its link (BitChord's "Import"): reads it
 * the normal way, GET /playlists/{id} and /items else fetchPlaylist, so a
 * playlist Spotify won't open is refused here. Only its name, owner and cover
 * are kept; the songs stay Spotify's, read fresh each time.
 */
export function importPlaylist(id: string): Promise<SpotifyPlaylist> {
  return signedIn(async () => {
    const page = await readPlaylistPage(id, 0);
    const own = (await readPlaylists()).find((p) => p.id === id);
    if (own) return own;
    const entry = {
      id,
      name: page.name.slice(0, 300) || 'Playlist',
      owner: page.owner?.slice(0, 300) ?? null,
      imageUrl: page.imageUrl,
      trackCount: page.total,
    };
    const rest = readSettings().importedPlaylists.filter((p) => p.id !== id);
    writeSettings({ importedPlaylists: [entry, ...rest].slice(0, 200) });
    return { ...entry, imported: true };
  });
}

/** Takes an imported playlist off the list. Nothing changes on Spotify. */
export function removeImport(id: string): void {
  writeSettings({
    importedPlaylists: readSettings().importedPlaylists.filter(
      (p) => p.id !== id,
    ),
  });
}

async function readPlaylists(): Promise<SpotifyPlaylist[]> {
  const k = await key('playlists');
  const hit = cached<SpotifyPlaylist[]>(k);
  if (hit) return hit;
  const [owned, liked] = await Promise.all([
    either('playlists', webPlaylists, fetchPlaylists),
    either('liked count', webLikedCount, fetchLikedCount).catch(() => null),
  ]);
  const fresh: SpotifyPlaylist[] = [
    {
      id: LIKED_ID,
      name: 'Liked Songs',
      owner: null,
      imageUrl: null,
      trackCount: liked,
    },
    ...owned,
  ];
  store(k, fresh, PLAYLISTS_TTL_S);
  return fresh;
}

/** Drops this account's cached playlists and pages, so the next read asks Spotify. */
export async function refresh(): Promise<void> {
  const account = (await key('')).replace(/:$/, '');
  responseCache().deletePrefix(`${account}:playlist`);
}

function toPage({ raw, ...page }: RawPage, offset: number): SpotifyTrackPage {
  const end = offset + raw;
  return {
    ...page,
    items: page.items.map((t) => ({
      ...t,
      localId: null,
      localAlbumKey: null,
    })),
    offset,
    next: raw > 0 && end < page.total ? end : null,
  };
}

/**
 * A page of a playlist, each song matched against the local library. The
 * Web API answers first (GET /playlists/{id} and /items); the web player's
 * fetchPlaylist query answers when it is refused or returns no rows.
 */
export function playlistPage(
  id: string,
  offset: number,
): Promise<SpotifyTrackPage> {
  return signedIn(() => readPlaylistPage(id, offset));
}

async function readPlaylistPage(
  id: string,
  offset: number,
): Promise<SpotifyTrackPage> {
  const k = await key(`playlist:v3:${id}:${offset}`);
  let page = cached<SpotifyTrackPage>(k);
  if (!page) {
    page = toPage(
      await either(
        'a playlist page',
        () => webPlaylistPage(id, offset),
        () => fetchPlaylistPage(id, offset),
      ),
      offset,
    );
    store(k, page, PAGE_TTL_S);
  }
  return matched(page);
}

/** Each row matched against the local library. Runs every time: files change while pages are cached. */
function matched(page: SpotifyTrackPage): SpotifyTrackPage {
  return { ...page, items: matchRows(page.items) };
}

function matchRows<T extends SpotifyTrack>(items: T[]): T[] {
  const matches = lib().matchTracks(
    items.map((t) => ({
      title: t.title,
      artists: t.artists,
      durationMs: t.durationMs,
    })),
  );
  return items.map((t, i) => ({
    ...t,
    localId: matches[i]?.id ?? null,
    localAlbumKey: matches[i]?.albumKey ?? null,
  }));
}

const unmatched = <T extends object>(t: T) => ({
  ...t,
  localId: null,
  localAlbumKey: null,
});

const recentPage = async (before?: number): Promise<SpotifyRecentPage> => {
  const { items, before: next } = await webRecent(before);
  return {
    items: items.map((r) => ({ ...r, track: unmatched(r.track) })),
    before: next,
  };
};

async function readRecent(): Promise<SpotifyRecentPage> {
  const k = await key('playlist:home:recent:v2');
  const hit = cached<SpotifyRecentPage>(k);
  if (hit) return hit;
  const fresh = await either<SpotifyRecentPage>(
    'recent plays',
    () => recentPage(),
    async () => {
      const username = (await profile())?.accountId;
      return {
        items: username ? await fetchRecent(username) : [],
        before: null,
      };
    },
  );
  if (fresh.items.length > 0) store(k, fresh, RECENT_TTL_S);
  return fresh;
}

function matchRecent(items: SpotifyRecent[]): SpotifyRecent[] {
  const plays = matchRows(items.flatMap((r) => r.track ?? []));
  let next = 0;
  return items.map((r) => (r.track ? { ...r, track: plays[next++]! } : r));
}

/** Older plays, from a page's `before` cursor. Only the Web API can page. */
export function recentMore(before: number): Promise<SpotifyRecentPage> {
  return signedIn(async () => {
    const page = await recentPage(before);
    return { ...page, items: matchRecent(page.items) };
  });
}

type Top = Pick<SpotifyHome, 'topRange' | 'topTracks' | 'topArtists'>;

const TOP_RANGES = [
  { range: 'month', web: 'short_term', player: 'SHORT_TERM' },
  { range: 'halfYear', web: 'medium_term', player: 'MID_TERM' },
  { range: 'year', web: 'long_term', player: 'LONG_TERM' },
] as const;

/** Top songs and artists for the shortest period Spotify has any for, cached an hour. */
async function readTop(): Promise<Top> {
  const k = await key('playlist:home:top');
  const hit = cached<Top>(k);
  if (hit) return hit;
  let fresh: Top = { topRange: 'month', topTracks: [], topArtists: [] };
  for (const { range, web, player } of TOP_RANGES) {
    const { tracks, artists } = await either(
      'top items',
      () => webTop(web),
      () => fetchTop(player),
    );
    if (tracks.length + artists.length === 0) continue;
    fresh = {
      topRange: range,
      topTracks: tracks.map(unmatched),
      topArtists: artists,
    };
    break;
  }
  store(k, fresh, TOP_TTL_S);
  return fresh;
}

/**
 * Home's Spotify rows. Each is read on its own, so one Spotify refuses only
 * empties that row, and songs are matched to local files every time.
 */
export function home(): Promise<SpotifyHome> {
  return signedIn(async () => {
    const [recent, top] = await Promise.all([
      readRecent().catch(() => ({ items: [], before: null })),
      readTop().catch(() => ({
        topRange: 'month' as const,
        topTracks: [],
        topArtists: [],
      })),
    ]);
    return {
      recent: matchRecent(recent.items),
      recentBefore: recent.before,
      topRange: top.topRange,
      topTracks: matchRows(top.topTracks),
      topArtists: top.topArtists,
    };
  });
}

/** One song's details (GET /tracks/{id}, else getTrack), cached 30 minutes. */
export function song(id: string): Promise<SpotifySong> {
  return signedIn(async () => {
    const k = await key(`playlist:song:${id}`);
    let fresh = cached<SpotifySong>(k);
    if (!fresh) {
      const raw = await either(
        'a song',
        () => webSong(id),
        () => fetchSong(id),
      );
      fresh = { ...raw, localId: null, localAlbumKey: null };
      store(k, fresh, PAGE_TTL_S);
    }
    return matchRows([fresh])[0]!;
  });
}

/** A track's Canvas clip. A miss is cached too, so a song without one is asked once. */
export async function canvas(uri: string): Promise<string | null> {
  const k = await key(`canvas:${uri}`);
  const hit = cached<{ url: string | null }>(k);
  if (hit) return hit.url;
  const url = await fetchCanvas(uri).catch(() => null);
  store(k, { url }, CANVAS_TTL_S);
  return url;
}

/** Saved albums (GET /me/albums, else libraryV3 "Albums"), cached 10 minutes. */
export function albums(): Promise<SpotifyAlbum[]> {
  return signedIn(async () => {
    const k = await key('playlist:albums');
    const hit = cached<SpotifyAlbum[]>(k);
    if (hit) return hit;
    const fresh = await either(
      'saved albums',
      webSavedAlbums,
      fetchSavedAlbums,
    );
    store(k, fresh, PLAYLISTS_TTL_S);
    return fresh;
  });
}

/** Followed artists (GET /me/following?type=artist, else libraryV3 "Artists"), cached 10 minutes. */
export function artists(): Promise<SpotifyArtist[]> {
  return signedIn(async () => {
    const k = await key('playlist:artists');
    const hit = cached<SpotifyArtist[]>(k);
    if (hit) return hit;
    const fresh = await either(
      'followed artists',
      webFollowedArtists,
      fetchFollowedArtists,
    );
    store(k, fresh, PLAYLISTS_TTL_S);
    return fresh;
  });
}

/** An album's rows, 50 at a time, matched to local files like a playlist's. */
export function albumPage(
  id: string,
  offset: number,
): Promise<SpotifyTrackPage> {
  return signedIn(async () => {
    const k = await key(`playlist:album:v2:${id}:${offset}`);
    let page = cached<SpotifyTrackPage>(k);
    if (!page) {
      page = toPage(
        await either(
          'an album page',
          () => webAlbumPage(id, offset),
          () => fetchAlbumPage(id, offset),
        ),
        offset,
      );
      store(k, page, PAGE_TTL_S);
    }
    return matched(page);
  });
}

/**
 * Which of up to 40 URIs are in the library, in one call: the hearts for
 * the rows on screen. Not cached, so a change made in Spotify shows.
 */
export function saved(uris: string[]): Promise<boolean[]> {
  return signedIn(() =>
    either(
      'the saved check',
      () => webSaved(uris),
      () => fetchSaved(uris),
    ),
  );
}

/** Saves or removes up to 40 items, then drops the cached lists they appear in. */
export async function save(uris: string[], value: boolean): Promise<void> {
  await signedIn(() =>
    either(
      value ? 'a save' : 'a removal',
      () => webSave(uris, value),
      () => saveToLibrary(uris, value),
    ),
  );
  const account = (await key('')).replace(/:$/, '');
  responseCache().deletePrefix(`${account}:playlist`);
}

/** An artist page, cached 30 minutes; its popular songs matched to local files every time. */
export function artistPage(id: string): Promise<SpotifyArtistPage> {
  return signedIn(async () => {
    const k = await key(`playlist:artist:v2:${id}`);
    let page = cached<SpotifyArtistPage>(k);
    if (!page) {
      const raw = await fetchArtist(id);
      page = {
        ...raw,
        topTracks: raw.topTracks.map((t) => ({
          ...t,
          localId: null,
          localAlbumKey: null,
        })),
      };
      store(k, page, PAGE_TTL_S);
    }
    return { ...page, topTracks: matchRows(page.topTracks) };
  });
}

/**
 * Spotify's songs for a search, 20 at a time (the web player's searchTracks;
 * the public /search refuses its token), matched to local files. Cached 30 minutes.
 */
export function search(
  query: string,
  offset: number,
): Promise<SpotifyTrackPage> {
  return signedIn(async () => {
    const k = await key(`playlist:search:v2:${query.toLowerCase()}:${offset}`);
    let page = cached<SpotifyTrackPage>(k);
    if (!page) {
      const items = await fetchSearch(query, offset);
      page = {
        name: query,
        description: null,
        imageUrl: null,
        owner: null,
        followers: null,
        items: items.map((t) => ({ ...t, localId: null, localAlbumKey: null })),
        total: items.length,
        offset,
        next: items.length === 20 && offset < 180 ? offset + 20 : null,
      };
      store(k, page, PAGE_TTL_S);
    }
    return matched(page);
  });
}
