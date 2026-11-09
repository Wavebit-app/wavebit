import { AppError } from '../../shared/errors';
import {
  LIKED_ID,
  type SpotifyAlbum,
  type SpotifyArtist,
  type SpotifyAlbumDetails,
  type SpotifyPlaylist,
  type SpotifyProfile,
  type SpotifySong,
} from '../../shared/schemas/spotify';
import { clientToken } from './clientToken';
import {
  arr,
  at,
  num,
  obj,
  plainText,
  readJson,
  sized,
  spotifyId,
  str,
  time,
  type Json,
} from './json';
import type { RawPage, RawTrack } from './pathfinder';
import {
  namedArtists,
  parseRecentPlays,
  recentPlaysUrl,
  rowTrack,
  type RecentPlays,
} from './webRows';
import { spotify } from './session';
import { accessToken, forgetToken } from './token';

const API = 'https://api.spotify.com';
const MAX_PAGES = 40;

/** After a 429, every Web API call waits out Retry-After (30 s when unsaid). */
let blockedUntil = 0;

/** Only the columns a playlist page shows, so responses stay small. */
const HEADER_FIELDS =
  'name,description,owner(display_name),images(url,width),followers(total)';
const ROW_FIELDS =
  'total,next,items(added_at,item(type,uri,name,duration_ms,artists(id,name),album(id,name,images(url,width))))';

/**
 * One Web API GET with the web player's bearer. A 401 renews the token once;
 * anything else that isn't 200 throws, and the caller falls back to Pathfinder
 * (BitChord saw the web player's token refused with 429 on some endpoints).
 */
async function get(
  url: string,
  retried = false,
  method: 'GET' | 'PUT' | 'DELETE' = 'GET',
): Promise<Json> {
  // Only Spotify's own API is ever fetched, including `next` links it returns.
  const parsed = URL.parse(url);
  if (
    parsed?.origin !== API ||
    !parsed.pathname.startsWith('/v1/') ||
    parsed.username ||
    parsed.password
  )
    throw new AppError('changed');
  if (Date.now() < blockedUntil) throw new AppError('rate_limited');
  const bearer = await accessToken();
  const client = await clientToken();
  let response: Response;
  try {
    response = await spotify().session.fetch(parsed.href, {
      method,
      headers: {
        Authorization: `Bearer ${bearer}`,
        Accept: 'application/json',
        'App-Platform': 'WebPlayer',
        ...(client && { 'Client-Token': client }),
      },
      redirect: 'error',
    });
  } catch {
    throw new AppError('network');
  }
  if (response.status === 401 && !retried) {
    forgetToken();
    return get(url, true, method);
  }
  if (response.status === 429) {
    const wait = Number(response.headers.get('Retry-After'));
    blockedUntil =
      Date.now() + (Number.isFinite(wait) && wait > 0 ? wait : 30) * 1000;
    throw new AppError('rate_limited');
  }
  if (!response.ok)
    throw new AppError(response.status === 401 ? 'signed_out' : 'network');
  // PUT and DELETE /me/library answer 200 with an empty body.
  if (method !== 'GET') return {};
  const body = await readJson(response);
  if (!body) throw new AppError('changed');
  return body;
}

/**
 * GET /me: display_name, images, id, and since May 2026 `account_id`, which
 * Spotify says to use as the account's stable key (falling back to `id`).
 */
export async function webProfile(): Promise<
  SpotifyProfile & { accountId: string | null }
> {
  const me = await get(`${API}/v1/me`);
  const id = str(me.id);
  // Accounts without a display name report their user id in its place.
  const displayName = str(me.display_name)?.trim() || null;
  return {
    name: displayName ?? id ?? 'Spotify',
    displayName: displayName === id ? null : displayName,
    imageUrl: sized(me.images, 64),
    accountId: str(me.account_id) ?? str(me.id),
  };
}

/** GET /me/playlists, 50 at a time, following `next` until it is null. */
export async function webPlaylists(): Promise<SpotifyPlaylist[]> {
  const all: SpotifyPlaylist[] = [];
  let next: string | null = `${API}/v1/me/playlists?limit=50&offset=0`;
  for (let page = 0; next && page < MAX_PAGES; page++) {
    const body: Json = await get(next);
    for (const item of arr(body.items)) {
      const id = str(at(item, 'id'));
      const name = str(at(item, 'name'))?.trim();
      if (!id || !/^[A-Za-z0-9]{22}$/.test(id) || !name) continue;
      all.push({
        id,
        name,
        owner: str(at(item, 'owner', 'display_name')),
        imageUrl: sized(at(item, 'images'), 300),
        // Spotify renamed the playlist's `tracks` object to `items` in 2026; read either.
        trackCount:
          num(at(item, 'items', 'total')) ?? num(at(item, 'tracks', 'total')),
      });
    }
    next = str(body.next);
  }
  return all;
}

/** GET /me/tracks?limit=1, read only for Liked Songs' total. */
export async function webLikedCount(): Promise<number | null> {
  return num((await get(`${API}/v1/me/tracks?limit=1`)).total);
}

/**
 * One playlist row. Since February 2026 the song sits under `item` (it was
 * `track`, which Liked Songs still uses); podcast episodes are left out.
 */

/**
 * A playlist page from the Web API: the header from GET /playlists/{id} (only
 * on the first page) and up to 100 rows from GET /playlists/{id}/items.
 * Liked Songs reads GET /me/tracks, 50 at a time.
 *
 * Spotify's Development Mode returns no rows for a playlist the user neither
 * owns nor collaborates on. That shows up as an empty page with a non-zero
 * total, and is thrown so the caller reads the page through Pathfinder.
 */
export async function webPlaylistPage(
  id: string,
  offset: number,
): Promise<RawPage> {
  const liked = id === LIKED_ID;
  const rows = await get(
    liked
      ? `${API}/v1/me/tracks?limit=50&offset=${offset}`
      : `${API}/v1/playlists/${id}/items?limit=100&offset=${offset}&fields=${encodeURIComponent(ROW_FIELDS)}`,
  );
  const raw = arr(rows.items);
  const total = num(rows.total) ?? raw.length;
  if (raw.length === 0 && offset < total) throw new AppError('changed');
  const header =
    liked || offset > 0
      ? null
      : await get(
          `${API}/v1/playlists/${id}?fields=${encodeURIComponent(HEADER_FIELDS)}`,
        );
  return {
    name: liked ? 'Liked Songs' : (str(header?.name) ?? 'Playlist'),
    description: plainText(header?.description),
    owner: str(at(header, 'owner', 'display_name')),
    followers: num(at(header, 'followers', 'total')),
    // Liked Songs' cover is drawn by the app (DESIGN.md › Spotify).
    imageUrl: liked ? null : sized(header?.images, 600),
    items: raw.flatMap((row) => rowTrack(row) ?? []),
    total,
    raw: raw.length,
  };
}

/** GET /me/albums: saved albums, newest first, 50 a page until `next` is null. */
export async function webSavedAlbums(): Promise<SpotifyAlbum[]> {
  const all: SpotifyAlbum[] = [];
  let next: string | null = `${API}/v1/me/albums?limit=50&offset=0`;
  for (let page = 0; next && page < MAX_PAGES; page++) {
    const body: Json = await get(next);
    for (const row of arr(body.items)) {
      const album = obj(at(row, 'album'));
      const id = str(album?.id);
      const name = str(album?.name)?.trim();
      if (!id || !/^[A-Za-z0-9]{22}$/.test(id) || !name) continue;
      all.push({
        id,
        name,
        artists: arr(album?.artists)
          .map((a) => str(at(a, 'name')))
          .filter((n): n is string => !!n),
        imageUrl: sized(album?.images, 300),
        year: Number(str(album?.release_date)?.slice(0, 4)) || null,
      });
    }
    next = str(body.next);
  }
  return all;
}

/** GET /me/following?type=artist: followed artists, paged by cursor. */
export async function webFollowedArtists(): Promise<SpotifyArtist[]> {
  const all: SpotifyArtist[] = [];
  let next: string | null = `${API}/v1/me/following?type=artist&limit=50`;
  for (let page = 0; next && page < MAX_PAGES; page++) {
    const artists = obj((await get(next)).artists);
    for (const a of arr(artists?.items)) {
      const id = str(at(a, 'id'));
      const name = str(at(a, 'name'))?.trim();
      if (!id || !/^[A-Za-z0-9]{22}$/.test(id) || !name) continue;
      all.push({ id, name, imageUrl: sized(at(a, 'images'), 300) });
    }
    next = str(artists?.next);
  }
  return all;
}

/** An album: GET /albums/{id} for the header, /albums/{id}/tracks for 50 rows at a time. */
export async function webAlbumPage(
  id: string,
  offset: number,
): Promise<RawPage> {
  const [album, tracks] = await Promise.all([
    get(`${API}/v1/albums/${id}`),
    get(`${API}/v1/albums/${id}/tracks?limit=50&offset=${offset}`),
  ]);
  const raw = arr(tracks.items);
  const cover = sized(album.images, 64);
  const name = str(album.name) ?? 'Album';
  const artists = namedArtists(album.artists);
  const date = str(album.release_date);
  const kind = str(album.album_type);
  const details: SpotifyAlbumDetails = {
    kind: kind === 'single' || kind === 'compilation' ? kind : 'album',
    artists,
    year: Number(date?.slice(0, 4)) || null,
    released: str(album.release_date_precision) === 'day' ? date : null,
    label: str(album.label),
    copyright: str(at(arr(album.copyrights)[0], 'text')),
    more: [],
  };
  return {
    name,
    description: null,
    owner: artists.map((a) => a.name).join(', ') || null,
    followers: null,
    imageUrl: sized(album.images, 600),
    album: details,
    items: raw.flatMap((t) => {
      const track = rowTrack({ item: t });
      return track
        ? [{ ...track, album: name, albumId: id, imageUrl: cover }]
        : [];
    }),
    total: num(tracks.total) ?? raw.length,
    raw: raw.length,
  };
}

/** One page of GET /me/player/recently-played; `before` continues further back. */
export async function webRecent(before?: number): Promise<RecentPlays> {
  return parseRecentPlays(await get(recentPlaysUrl(API, before)));
}

/** GET /me/top/tracks and /me/top/artists for one `time_range`. */
export async function webTop(
  range: 'short_term' | 'medium_term' | 'long_term',
): Promise<{
  tracks: RawTrack[];
  artists: SpotifyArtist[];
}> {
  const [tracks, artists] = await Promise.all([
    get(`${API}/v1/me/top/tracks?time_range=${range}&limit=20`),
    get(`${API}/v1/me/top/artists?time_range=${range}&limit=20`),
  ]);
  return {
    tracks: arr(tracks.items).flatMap((t) => rowTrack({ item: t }) ?? []),
    artists: arr(artists.items).flatMap((a) => {
      const id = spotifyId(at(a, 'id'));
      const name = str(at(a, 'name'))?.trim();
      return id && name
        ? [{ id, name, imageUrl: sized(at(a, 'images'), 300) }]
        : [];
    }),
  };
}

/** One song's details: GET /tracks/{id}. */
export async function webSong(
  id: string,
): Promise<Omit<SpotifySong, 'localId' | 'localAlbumKey'>> {
  const body = await get(`${API}/v1/tracks/${id}`);
  const track = rowTrack({ item: body });
  if (!track) throw new AppError('changed');
  return {
    ...track,
    id,
    coverUrl: sized(at(body, 'album', 'images'), 600),
    year: Number(str(at(body, 'album', 'release_date'))?.slice(0, 4)) || null,
    explicit: at(body, 'explicit') === true,
    playCount: null,
  };
}

/** GET /me/library/contains: one true/false per URI, up to 40 in one call. */
export async function webSaved(uris: string[]): Promise<boolean[]> {
  const body = await get(
    `${API}/v1/me/library/contains?uris=${encodeURIComponent(uris.join(','))}`,
  );
  // Answered as a bare JSON array, which readJson hands back as `{ values }`.
  const list = arr(body.values);
  if (list.length !== uris.length) throw new AppError('changed');
  return list.map((v) => v === true);
}

/** PUT or DELETE /me/library?uris=…: saves or removes up to 40 items (February 2026). */
export async function webSave(uris: string[], saved: boolean): Promise<void> {
  await get(
    `${API}/v1/me/library?uris=${encodeURIComponent(uris.join(','))}`,
    false,
    saved ? 'PUT' : 'DELETE',
  );
}
