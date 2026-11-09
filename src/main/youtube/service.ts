import { shell } from 'electron';
import { errorCode } from '../../shared/errors';
import { Events } from '../../shared/ipc/channels';
import type { RefreshScope } from '../../shared/schemas/refresh';
import type { RadioSong } from './parse';
import type {
  YtAccount,
  YtArtist,
  YtExplore,
  YtMatch,
  YtMatchQuery,
  YtHomePage,
  YtLibrary,
  YtPage,
  YtShelf,
  YtStatus,
} from '../../shared/schemas/youtube';
import { AppError } from '../../shared/errors';
import { createHash } from 'node:crypto';
import { lib } from '../library/library';
import { native } from '../services/native';
import { emit } from '../ipc/handle';
import { cached, responseCache, store } from '../services/cache';
import { innertube, sessionScope } from './innertube';
import {
  continuation,
  pageTracks,
  parseAccount,
  parseArtist,
  parseLibraryItems,
  parseMoods,
  parseRadio,
  parseSearch,
  parseSearchSongs,
  parsePage,
  parseShelves,
} from './parse';
import { MUSIC_ORIGIN, sapisid, sessionFingerprint, youtube } from './session';

const HOME_TTL_S = 10 * 60;
const ACCOUNT_TTL_S = 60 * 60;

/** Cache keys carry the account (a hash of its signing cookie), or "guest". */
async function key(name: string): Promise<string> {
  return `youtube:${(await sessionFingerprint()) ?? 'guest'}:${name}`;
}

const VIEW_CACHES: Record<RefreshScope, string[]> = {
  home: ['home'],
  explore: ['explore:'],
  library: ['library', 'page:'],
  page: ['page:', 'artist:', 'category:', 'search:'],
};

/** Forgets what a page shows, so a pull really asks YouTube Music again. */
export async function forgetViews(scope: RefreshScope): Promise<void> {
  for (const name of VIEW_CACHES[scope])
    responseCache().deletePrefix(await key(name));
}

async function account(): Promise<YtAccount | null> {
  const k = await key('account');
  const hit = cached<YtAccount>(k);
  if (hit) return hit;
  try {
    const fresh = parseAccount(await innertube('account/account_menu', {}));
    if (fresh) store(k, fresh, ACCOUNT_TTL_S);
    return fresh;
  } catch {
    return null;
  }
}

export async function status(): Promise<YtStatus> {
  const storage = youtube().storage;
  if (!(await sapisid())) return { state: 'signed_out', storage };
  // The cookie alone isn't proof: the page must say it is signed in.
  const scope = await sessionScope().catch(() => null);
  if (scope && !scope.loggedIn) return { state: 'signed_out', storage };
  return { state: 'signed_in', storage, account: await account() };
}

async function announce(): Promise<YtStatus> {
  const next = await status();
  emit(Events.youtubeStatus, next);
  return next;
}

/**
 * YouTube Music's home feed (FEmusic_home), as BitChord's Home shows it: the
 * account's own feed when signed in, YouTube's public one when not. The first
 * page is cached 10 minutes per account; `next` pages through the rest.
 */
export async function home(next: string | null): Promise<YtHomePage> {
  const k = next ? null : await key('home');
  const hit = k ? cached<YtHomePage>(k) : null;
  if (hit) return hit;
  try {
    const root = next
      ? await innertube(
          'browse',
          { continuation: next },
          { ctoken: next, continuation: next, type: 'next' },
        )
      : await innertube('browse', { browseId: 'FEmusic_home' });
    const page: YtHomePage = {
      shelves: parseShelves(root),
      next: continuation(root),
    };
    if (k) store(k, page, HOME_TTL_S);
    return page;
  } catch (error) {
    if (errorCode(error) === 'signed_out') void announce();
    throw error;
  }
}

/** Under the page's 2-minute refresh, so each of those really asks YouTube. */
const EXPLORE_TTL_S = 90;
const CATEGORY_TTL_S = 30 * 60;
/** Cards load their covers as they scroll in; at most this many asks at a time. */
const MAX_CATEGORY_CALLS = 3;

/**
 * Explore: YouTube Music's own feed (new releases, trending, new videos), its
 * charts and its moods and genres, for this account or the region if signed
 * out. Charts are extra: losing them doesn't lose the page.
 */
export async function explore(): Promise<YtExplore> {
  const k = await key('explore:v1');
  const hit = cached<YtExplore>(k);
  if (hit) return hit;
  try {
    const [feed, moods, charts] = await Promise.all([
      innertube('browse', { browseId: 'FEmusic_explore' }),
      innertube('browse', { browseId: 'FEmusic_moods_and_genres' }),
      innertube('browse', { browseId: 'FEmusic_charts' }).catch(() => null),
    ]);
    const seen = new Set<string>();
    const shelves = [
      ...parseShelves(feed),
      ...(charts ? parseShelves(charts) : []),
    ].filter((shelf) => {
      const title = shelf.title.toLowerCase();
      if (seen.has(title)) return false;
      seen.add(title);
      return true;
    });
    const page: YtExplore = {
      shelves,
      moods: parseMoods(moods),
      fetchedAt: Date.now(),
    };
    if (shelves.length || page.moods.length) store(k, page, EXPLORE_TTL_S);
    return page;
  } catch (error) {
    if (errorCode(error) === 'signed_out') void announce();
    throw error;
  }
}

let categoryCalls = 0;
const categoryQueue: (() => void)[] = [];

async function oneCategoryCall<T>(job: () => Promise<T>): Promise<T> {
  if (categoryCalls >= MAX_CATEGORY_CALLS)
    await new Promise<void>((go) => categoryQueue.push(go));
  categoryCalls += 1;
  try {
    return await job();
  } finally {
    categoryCalls -= 1;
    categoryQueue.shift()?.();
  }
}

/** One mood or genre's shelves. The browse id is fixed here; the page sends only `params`. */
export async function category(params: string): Promise<YtShelf[]> {
  const k = await key(`category:${params}`);
  const hit = cached<YtShelf[]>(k);
  if (hit) return hit;
  return oneCategoryCall(async () => {
    const shelves = parseShelves(
      await innertube('browse', {
        browseId: 'FEmusic_moods_and_genres_category',
        params,
      }),
    );
    if (shelves.length) store(k, shelves, CATEGORY_TTL_S);
    return shelves;
  });
}

/** Opens a card in YouTube Music in the browser, until wavebit plays YouTube itself. */
export function open(videoId: string | null, browseId: string | null): void {
  const url = videoId
    ? `${MUSIC_ORIGIN}/watch?v=${videoId}`
    : browseId
      ? `${MUSIC_ORIGIN}/browse/${browseId}`
      : null;
  if (url) void shell.openExternal(url);
}

const LIBRARY_TTL_S = 10 * 60;
const PAGE_TTL_S = 30 * 60;

/** A browse call that only makes sense signed in: the library feeds and saves. */
async function requireSignedIn(): Promise<void> {
  const scope = await sessionScope();
  if (!scope.loggedIn) throw new AppError('signed_out');
}

/**
 * The account's saved playlists, albums and artists, as BitChord's library()
 * reads them: one browse feed each, fetched together, an empty or failing
 * one left empty rather than failing the rest. Cached 10 minutes.
 */
export async function library(): Promise<YtLibrary> {
  await requireSignedIn();
  const k = await key('library');
  const hit = cached<YtLibrary>(k);
  if (hit) return hit;
  const feed = (browseId: string) =>
    innertube('browse', { browseId })
      .then(parseLibraryItems)
      .catch(() => []);
  const [playlists, albums, artists] = await Promise.all([
    feed('FEmusic_liked_playlists'),
    feed('FEmusic_liked_albums'),
    feed('FEmusic_library_corpus_track_artists'),
  ]);
  const fresh: YtLibrary = {
    // The "New playlist" tile has no browse id and never makes it this far.
    playlists: playlists.filter((p) => p.kind === 'playlist'),
    albums: albums.filter((a) => a.kind === 'album'),
    artists: artists.filter((a) => a.kind === 'artist'),
  };
  store(k, fresh, LIBRARY_TTL_S);
  return fresh;
}

/**
 * An album (MPRE…) or playlist (VL…) page, with each row matched to a local
 * file the way Spotify rows are. `next` continues a long playlist.
 */
export async function page(
  browseId: string,
  next: string | null,
): Promise<YtPage> {
  const k = await key(`page:${browseId}:${next ?? 0}`);
  let fresh = cached<YtPage>(k);
  if (!fresh) {
    const root = next
      ? await innertube(
          'browse',
          { continuation: next },
          { ctoken: next, continuation: next, type: 'next' },
        )
      : await innertube('browse', { browseId });
    const { rows, ...header } = parsePage(root, browseId);
    const fallback = {
      artists: header.byline,
      album: header.kind === 'album' ? header.title : null,
      imageUrl: header.kind === 'album' ? header.imageUrl : null,
    };
    fresh = {
      ...header,
      items: pageTracks(rows, fallback),
      next: continuation(root),
    };
    store(k, fresh, PAGE_TTL_S);
  }
  const matches = lib().matchTracks(
    fresh.items.map((t) => ({
      title: t.title,
      artists: t.artists.split(/,\s*|\s+&\s+/).filter(Boolean),
      durationMs: t.durationMs,
    })),
  );
  return {
    ...fresh,
    items: fresh.items.map((t, i) => ({
      ...t,
      localId: matches[i]?.id ?? null,
      localAlbumKey: matches[i]?.albumKey ?? null,
    })),
  };
}

/**
 * Saves an album or playlist to the library, or takes it out: YouTube's
 * like/like and like/removelike aimed at the list (Innertube.ratePlaylist).
 * YouTube answers a refusal with 200 and an `error` in the body.
 */
export async function save(playlistId: string, saved: boolean): Promise<void> {
  await requireSignedIn();
  const body = await innertube(saved ? 'like/like' : 'like/removelike', {
    target: { playlistId },
  });
  if (body.error) throw new AppError('failed');
  responseCache().deletePrefix(await key('library'));
  responseCache().deletePrefix(await key('page:'));
}

/** An artist page (browse UC…), cached 30 minutes per account. */
export async function artist(browseId: string): Promise<YtArtist> {
  const k = await key(`artist:${browseId}`);
  const hit = cached<YtArtist>(k);
  if (hit) return hit;
  const fresh = parseArtist(await innertube('browse', { browseId }));
  store(k, fresh, PAGE_TTL_S);
  return fresh;
}

/** YouTube Music's Songs search filter (BitChord's SearchFilter.SONGS). */
const SONGS = 'EgWKAQIIAWoKEAkQChAFEAMQBA==';
const MATCH_TTL_S = 30 * 24 * 60 * 60;

/**
 * The YouTube Music song that is the same recording as a Spotify one, as
 * BitChord's SpotifyImporter.matchTrack finds it: a Songs search for
 * "title artist", the TrackMatcher's best (the Rust port), else the first
 * hit. Cached 30 days for everyone on this computer: a song matches once.
 */
export async function match(song: YtMatchQuery): Promise<YtMatch | null> {
  const id = createHash('sha256')
    .update(`${song.title}\n${song.artists.join(',')}\n${song.durationMs}`)
    .digest('hex')
    .slice(0, 24);
  const k = `youtube:any:match:${id}`;
  const hit = cached<{ match: YtMatch | null }>(k);
  if (hit) return hit.match;
  const query = [song.title, song.artists[0]].filter(Boolean).join(' ');
  const found = parseSearchSongs(
    await innertube('search', { query, params: SONGS }),
  );
  const best = native().bestMatch(
    { title: song.title, artists: song.artists, durationMs: song.durationMs },
    found.map((f) => ({
      id: f.videoId,
      title: f.title,
      artists: f.artists.replace(/ & /g, ', '),
      durationMs: f.durationMs,
    })),
  );
  const chosen = found.find((f) => f.videoId === best) ?? found[0] ?? null;
  store(k, { match: chosen }, MATCH_TTL_S);
  return chosen;
}

const RADIO_TTL_S = 6 * 60 * 60;

/** Normalised for "same recording": lower case, no brackets or version words. */
const core = (title: string) =>
  title
    .toLowerCase()
    .replace(/[([].*?[)\]]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/**
 * AutoPlay's next songs, after BitChord's extendStation: YouTube Music's
 * radio for the seed (`next` on RDAMVM<id>), at most 10, one per recording,
 * no more than 2 from any artist (4 from the seed's own), the catalogue
 * song preferred over its video. Cached 6 hours per seed.
 */
export async function radio(videoId: string): Promise<RadioSong[]> {
  const k = await key(`radio:${videoId}`);
  const hit = cached<RadioSong[]>(k);
  if (hit) return hit;
  const all = parseRadio(
    await innertube('next', {
      videoId,
      playlistId: `RDAMVM${videoId}`,
      isAudioOnly: true,
      enablePersistentPlaylistPanel: true,
    }),
  );
  const seed = all.find((s) => s.videoId === videoId);
  const seedArtist = seed?.artists.split(/,| & /)[0]?.trim().toLowerCase();
  const songsFirst = all.some((s) => !s.isVideo)
    ? all.filter((s) => !s.isVideo)
    : all;
  const seen = new Set<string>([
    seed ? `${core(seed.title)}|${seedArtist}` : '',
  ]);
  const perArtist = new Map<string, number>();
  const out: RadioSong[] = [];
  for (const song of songsFirst) {
    if (song.videoId === videoId || out.length >= 10) continue;
    const artist = song.artists.split(/,| & /)[0]?.trim().toLowerCase() ?? '';
    const id = `${core(song.title)}|${artist}`;
    const cap = artist === seedArtist ? 4 : 2;
    if (seen.has(id) || (perArtist.get(artist) ?? 0) >= cap) continue;
    seen.add(id);
    perArtist.set(artist, (perArtist.get(artist) ?? 0) + 1);
    out.push(song);
  }
  store(k, out, RADIO_TTL_S);
  return out;
}

/** YouTube Music's search, every section (Songs, Videos, Albums, Artists, Playlists), cached 30 minutes. */
export async function search(query: string): Promise<YtShelf[]> {
  const k = await key(`search:${query.toLowerCase()}`);
  const hit = cached<YtShelf[]>(k);
  if (hit) return hit;
  const shelves = parseSearch(await innertube('search', { query }));
  // An empty answer isn't kept: it may be YouTube changing its layout.
  if (shelves.length) store(k, shelves, PAGE_TTL_S);
  return shelves;
}
