import { AppError } from '../../shared/errors';
import {
  LIKED_ID,
  type SpotifyAlbum,
  type SpotifyAlbumDetails,
  type SpotifyAlbumKind,
  type SpotifyArtist,
  type SpotifyArtistPage,
  type SpotifyArtistRef,
  type SpotifySong,
  type SpotifyPlaylist,
  type SpotifyProfile,
  type SpotifyRecent,
  type SpotifyTrack,
  type SpotifyTrackPage,
} from '../../shared/schemas/spotify';
import { clientToken } from './clientToken';
import {
  arr,
  at,
  cdnUrl,
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
import { spotify } from './session';
import { accessToken, forgetToken } from './token';
import { webPlayer, type Operation } from './webPlayer';

const PATHFINDER = 'https://api-partner.spotify.com/pathfinder/v2/query';

let blockedUntil = 0;

/**
 * One persisted query. A 401 renews the token once; a retired hash rereads
 * the bundle once; a 429 holds every call until Retry-After has passed.
 */
async function gql(
  operation: Operation,
  variables: Json,
  retried = false,
): Promise<Json> {
  if (Date.now() < blockedUntil) throw new AppError('rate_limited');
  const bearer = await accessToken();
  const hash = (await webPlayer(retried)).hashes[operation];
  const client = await clientToken();
  let response: Response;
  try {
    response = await spotify().session.fetch(PATHFINDER, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bearer}`,
        Accept: 'application/json',
        'Content-Type': 'application/json;charset=UTF-8',
        'App-Platform': 'WebPlayer',
        ...(client && { 'Client-Token': client }),
      },
      body: JSON.stringify({
        variables,
        operationName: operation,
        extensions: { persistedQuery: { version: 1, sha256Hash: hash } },
      }),
    });
  } catch {
    throw new AppError('network');
  }
  if (response.status === 401 && !retried) {
    forgetToken();
    return gql(operation, variables, true);
  }
  if (response.status === 429) {
    const wait = Number(response.headers.get('Retry-After'));
    blockedUntil =
      Date.now() + (Number.isFinite(wait) && wait > 0 ? wait : 30) * 1000;
    throw new AppError('rate_limited');
  }
  const body = await readJson(response);
  const errors = arr(body?.errors).map((e) => str(at(e, 'message')) ?? '');
  if (errors.some((m) => /PersistedQueryNotFound/i.test(m))) {
    if (!retried) return gql(operation, variables, true);
    throw new AppError('changed');
  }
  if (!response.ok)
    throw new AppError(response.status === 401 ? 'signed_out' : 'network');
  if (!body?.data) throw new AppError('changed');
  return body;
}

/** A row before it is matched against the local library. */
export type RawTrack = Omit<SpotifyTrack, 'localId' | 'localAlbumKey'>;
/** A page before matching; `raw` counts every row Spotify sent, episodes included. */
export type RawPage = Omit<SpotifyTrackPage, 'items' | 'offset' | 'next'> & {
  items: RawTrack[];
  raw: number;
};

function artistRefs(items: unknown): SpotifyArtistRef[] {
  return arr(items).flatMap((a) => {
    const name = str(at(a, 'profile', 'name'))?.trim();
    return name ? [{ name, id: spotifyId(at(a, 'uri')) }] : [];
  });
}

function trackOf(
  data: unknown,
  uri: string | null,
  addedAt: unknown,
): RawTrack | null {
  const title = str(at(data, 'name'))?.trim();
  if (!title || !uri) return null;
  const album = obj(at(data, 'albumOfTrack'));
  const artists = artistRefs(at(data, 'artists', 'items'));
  return {
    uri,
    title,
    artists: artists.map((a) => a.name),
    artistIds: artists.map((a) => a.id),
    album: str(album?.name),
    albumId: spotifyId(album?.uri),
    durationMs:
      num(at(data, 'trackDuration', 'totalMilliseconds')) ??
      num(at(data, 'duration', 'totalMilliseconds')) ??
      0,
    imageUrl: sized(at(album, 'coverArt', 'sources'), 64),
    addedAt: time(addedAt),
  };
}

export function parsePlaylists(root: Json): {
  items: SpotifyPlaylist[];
  total: number;
  raw: number;
} {
  const library = obj(at(root, 'data', 'me', 'libraryV3'));
  if (!library) throw new AppError('changed');
  const raw = arr(library.items);
  const items = raw.flatMap((entry): SpotifyPlaylist[] => {
    const wrapper = obj(at(entry, 'item'));
    const data = obj(wrapper?.data);
    const uri = str(wrapper?._uri);
    const name = str(data?.name)?.trim();
    if (str(data?.__typename) !== 'Playlist' || !uri || !name) return [];
    return [
      {
        id: uri.split(':').pop()!,
        name,
        owner: str(at(data, 'ownerV2', 'data', 'name')),
        imageUrl: sized(at(arr(at(data, 'images', 'items'))[0], 'sources')),
        trackCount: num(at(data, 'content', 'totalCount')),
      },
    ];
  });
  return {
    items,
    total: num(library.totalCount) ?? raw.length,
    raw: raw.length,
  };
}

export function parsePlaylistPage(root: Json): RawPage {
  const playlist = obj(at(root, 'data', 'playlistV2'));
  const content = obj(playlist?.content);
  if (!content) throw new AppError('changed');
  const raw = arr(content.items);
  return {
    name: str(playlist?.name) ?? 'Playlist',
    description: plainText(playlist?.description),
    followers: num(playlist?.followers),
    owner: str(at(playlist, 'ownerV2', 'data', 'name')),
    imageUrl: sized(
      at(arr(at(playlist, 'images', 'items'))[0], 'sources'),
      600,
    ),
    items: raw.flatMap((entry) => {
      const data = at(entry, 'itemV2', 'data');
      const track = trackOf(
        data,
        str(at(data, 'uri')) ?? str(at(data, '_uri')),
        at(entry, 'addedAt', 'isoString'),
      );
      return track ? [track] : [];
    }),
    total: num(content.totalCount) ?? raw.length,
    raw: raw.length,
  };
}

export function parseLikedPage(root: Json): RawPage {
  const tracks = obj(at(root, 'data', 'me', 'library', 'tracks'));
  if (!tracks) throw new AppError('changed');
  const raw = arr(tracks.items);
  return {
    name: 'Liked Songs',
    description: null,
    followers: null,
    owner: null,
    // wavebit draws Liked Songs' cover itself (DESIGN.md › Spotify).
    imageUrl: null,
    items: raw.flatMap((entry) => {
      const wrapper = at(entry, 'track');
      const data = at(wrapper, 'data');
      const track = trackOf(
        data,
        str(at(wrapper, '_uri')) ?? str(at(data, 'uri')),
        at(entry, 'addedAt', 'isoString'),
      );
      return track ? [track] : [];
    }),
    total: num(tracks.totalCount) ?? raw.length,
    raw: raw.length,
  };
}

/** The fallback when /v1/me is refused; `username` is the account's user id. */
export async function fetchProfile(): Promise<
  SpotifyProfile & { accountId: string | null }
> {
  const profile = obj(
    at(await gql('profileAttributes', {}), 'data', 'me', 'profile'),
  );
  const username = str(profile?.username);
  const displayName = str(profile?.name)?.trim() || null;
  return {
    name: displayName ?? username ?? 'Spotify',
    displayName: displayName === username ? null : displayName,
    imageUrl: sized(at(profile, 'avatar', 'sources'), 64),
    accountId: str(profile?.username),
  };
}

/** Liked Songs' total, from a one-row page. */
export async function fetchLikedCount(): Promise<number | null> {
  return parseLikedPage(
    await gql('fetchLibraryTracks', { offset: 0, limit: 1 }),
  ).total;
}

/** A track's Canvas (SpotifyCanvasQuery.parse): a playable https `.mp4`, or null. */
export async function fetchCanvas(trackUri: string): Promise<string | null> {
  const url = str(
    at(
      await gql('canvas', { trackUri }),
      'data',
      'trackUnion',
      'canvas',
      'url',
    ),
  );
  return url && cdnUrl(url) && /\.mp4(?:[?#]|$)/i.test(url) ? url : null;
}

/** Every playlist in the library (the fallback when /v1/me/playlists is refused). */
export async function fetchPlaylists(): Promise<SpotifyPlaylist[]> {
  const all: SpotifyPlaylist[] = [];
  for (let offset = 0; offset < 2_000; ) {
    const page = parsePlaylists(
      await gql('libraryV3', {
        filters: ['Playlists'],
        order: null,
        textFilter: '',
        features: ['LIKED_SONGS', 'YOUR_EPISODES_V2', 'PRERELEASES', 'EVENTS'],
        limit: 50,
        offset,
        flatten: true,
        expandedFolders: [],
        folderUri: null,
        includeFoldersWhenFlattening: false,
      }),
    );
    all.push(...page.items);
    offset += page.raw;
    if (page.raw === 0 || offset >= page.total) break;
  }
  return all;
}

/** A page of up to 100 rows through the web player's own queries. */
export async function fetchPlaylistPage(
  id: string,
  offset: number,
): Promise<RawPage> {
  return id === LIKED_ID
    ? parseLikedPage(await gql('fetchLibraryTracks', { offset, limit: 100 }))
    : parsePlaylistPage(
        await gql('fetchPlaylist', {
          uri: `spotify:playlist:${id}`,
          offset,
          limit: 100,
          enableWatchFeedEntrypoint: false,
        }),
      );
}

/** One `libraryV3` page of a filter ("Albums", "Artists"): the wrapper's uri and data. */
async function libraryItems(
  filter: 'Albums' | 'Artists',
): Promise<{ uri: string; data: Json }[]> {
  const all: { uri: string; data: Json }[] = [];
  for (let offset = 0; offset < 2_000; ) {
    const root = await gql('libraryV3', {
      filters: [filter],
      order: null,
      textFilter: '',
      features: ['LIKED_SONGS', 'YOUR_EPISODES_V2', 'PRERELEASES', 'EVENTS'],
      limit: 50,
      offset,
      flatten: true,
      expandedFolders: [],
      folderUri: null,
      includeFoldersWhenFlattening: false,
    });
    const library = obj(at(root, 'data', 'me', 'libraryV3'));
    if (!library) throw new AppError('changed');
    const raw = arr(library.items);
    for (const entry of raw) {
      const wrapper = obj(at(entry, 'item'));
      const uri = str(wrapper?._uri);
      const data = obj(wrapper?.data);
      if (uri && data) all.push({ uri, data });
    }
    offset += raw.length;
    if (raw.length === 0 || offset >= (num(library.totalCount) ?? 0)) break;
  }
  return all;
}

const idOf = (uri: string) => uri.split(':').pop() ?? '';

/** Saved albums, newest first (the fallback for GET /me/albums). */
export async function fetchSavedAlbums(): Promise<SpotifyAlbum[]> {
  return (await libraryItems('Albums')).flatMap(({ uri, data }) => {
    const name = str(data.name)?.trim();
    if (str(data.__typename) !== 'Album' || !name) return [];
    return [
      {
        id: idOf(uri),
        name,
        artists: arr(at(data, 'artists', 'items'))
          .map((a) => str(at(a, 'profile', 'name')))
          .filter((n): n is string => !!n),
        imageUrl: sized(at(data, 'coverArt', 'sources'), 300),
        year: num(at(data, 'date', 'year')),
      },
    ];
  });
}

/** Followed artists (the fallback for GET /me/following?type=artist). */
export async function fetchFollowedArtists(): Promise<SpotifyArtist[]> {
  return (await libraryItems('Artists')).flatMap(({ uri, data }) => {
    const name = str(at(data, 'profile', 'name'))?.trim();
    if (str(data.__typename) !== 'Artist' || !name) return [];
    return [
      {
        id: idOf(uri),
        name,
        imageUrl: sized(at(data, 'visuals', 'avatarImage', 'sources'), 300),
      },
    ];
  });
}

const KINDS: Record<string, SpotifyAlbumKind> = {
  ALBUM: 'album',
  SINGLE: 'single',
  EP: 'ep',
  COMPILATION: 'compilation',
};

function albumDetails(
  album: Json,
  artists: SpotifyArtistRef[],
  id: string,
): SpotifyAlbumDetails {
  const iso = str(at(album, 'date', 'isoString'));
  const year =
    num(at(album, 'date', 'year')) ?? (Number(iso?.slice(0, 4)) || null);
  const more = arr(at(album, 'moreAlbumsByArtist', 'items'))[0];
  return {
    kind: KINDS[str(album.type) ?? ''] ?? 'album',
    artists,
    year,
    released: str(at(album, 'date', 'precision')) === 'DAY' ? iso : null,
    label: str(album.label),
    copyright: str(at(arr(at(album, 'copyright', 'items'))[0], 'text')),
    more: releasesOf(at(more, 'discography', 'popularReleasesAlbums')).filter(
      (r) => r.id !== id,
    ),
  };
}

/** An album as a page of rows (the fallback for GET /albums/{id}): `getAlbum`. */
export async function fetchAlbumPage(
  id: string,
  offset: number,
): Promise<RawPage> {
  const album = obj(
    at(
      await gql('getAlbum', {
        uri: `spotify:album:${id}`,
        locale: '',
        offset,
        limit: 50,
      }),
      'data',
      'albumUnion',
    ),
  );
  if (!album) throw new AppError('changed');
  const tracks = obj(album.tracksV2) ?? obj(album.tracks);
  const raw = arr(tracks?.items);
  const artists = artistRefs(at(album, 'artists', 'items'));
  const cover = sized(at(album, 'coverArt', 'sources'), 64);
  return {
    name: str(album.name) ?? 'Album',
    description: null,
    owner: artists.map((a) => a.name).join(', ') || null,
    followers: null,
    imageUrl: sized(at(album, 'coverArt', 'sources'), 600),
    album: albumDetails(album, artists, id),
    items: raw.flatMap((entry) => {
      const data = at(entry, 'track');
      const track = trackOf(data, str(at(data, 'uri')), null);
      // Album rows carry no album or cover of their own: they are the album's.
      return track
        ? [
            {
              ...track,
              album: str(album.name),
              albumId: id,
              imageUrl: track.imageUrl ?? cover,
            },
          ]
        : [];
    }),
    total: num(tracks?.totalCount) ?? raw.length,
    raw: raw.length,
  };
}

/** Which of `uris` are in the library: one `areEntitiesInLibrary` call for up to 40. */
export async function fetchSaved(uris: string[]): Promise<boolean[]> {
  const root = await gql('areEntitiesInLibrary', { uris });
  const lookup = arr(at(root, 'data', 'lookup'));
  return uris.map((_, i) => at(lookup[i], 'data', 'saved') === true);
}

/** Saves or removes items: the web player's own `addToLibrary` / `removeFromLibrary`. */
export async function saveToLibrary(
  uris: string[],
  saved: boolean,
): Promise<void> {
  await gql(
    saved ? 'addToLibrary' : 'removeFromLibrary',
    saved
      ? { libraryItemUris: uris, interactionId: null }
      : { libraryItemUris: uris },
  );
}

function releasesOf(group: unknown): SpotifyAlbum[] {
  return arr(at(group, 'items')).flatMap((entry) => {
    const release =
      obj(at(arr(at(entry, 'releases', 'items'))[0])) ?? obj(entry);
    const uri = str(release?.uri);
    const name = str(release?.name)?.trim();
    if (!uri?.startsWith('spotify:album:') || !name) return [];
    return [
      {
        id: idOf(uri),
        name,
        artists: [],
        imageUrl: sized(at(release, 'coverArt', 'sources'), 300),
        year: num(at(release, 'date', 'year')),
      },
    ];
  });
}

/**
 * An artist page (the web player's `queryArtistOverview`): profile, stats,
 * popular songs, albums, singles and "Fans also like". Rows come back
 * unmatched; the service matches them to local files.
 */
export async function fetchArtist(
  id: string,
): Promise<Omit<SpotifyArtistPage, 'topTracks'> & { topTracks: RawTrack[] }> {
  const artist = obj(
    at(
      await gql('queryArtistOverview', {
        uri: `spotify:artist:${id}`,
        locale: '',
        includePrerelease: true,
      }),
      'data',
      'artistUnion',
    ),
  );
  if (!artist) throw new AppError('changed');
  const name = str(at(artist, 'profile', 'name')) ?? 'Artist';
  const discography = obj(artist.discography);
  return {
    id,
    name,
    imageUrl: sized(at(artist, 'visuals', 'avatarImage', 'sources'), 600),
    biography: plainText(at(artist, 'profile', 'biography', 'text'), 800),
    followers: num(at(artist, 'stats', 'followers')),
    monthlyListeners: num(at(artist, 'stats', 'monthlyListeners')),
    topTracks: arr(at(discography, 'topTracks', 'items')).flatMap((entry) => {
      const track = obj(at(entry, 'track'));
      const row = trackOf(track, str(track?.uri), null);
      if (!row) return [];
      return [
        {
          ...row,
          imageUrl:
            row.imageUrl ??
            sized(at(track, 'albumOfTrack', 'coverArt', 'sources'), 64),
        },
      ];
    }),
    albums: releasesOf(at(discography, 'albums')),
    singles: releasesOf(at(discography, 'singles')),
    compilations: releasesOf(at(discography, 'compilations')),
    appearsOn: releasesOf(at(artist, 'relatedContent', 'appearsOn')),
    related: arr(
      at(artist, 'relatedContent', 'relatedArtists', 'items'),
    ).flatMap((a) => {
      const uri = str(at(a, 'uri'));
      const related = str(at(a, 'profile', 'name'));
      if (!uri?.startsWith('spotify:artist:') || !related) return [];
      return [
        {
          id: idOf(uri),
          name: related,
          imageUrl: sized(at(a, 'visuals', 'avatarImage', 'sources'), 300),
        },
      ];
    }),
  };
}

/** The fallback for GET /me/top/tracks and /me/top/artists: the web player's `userTopContent`. */
export async function fetchTop(
  timeRange: 'SHORT_TERM' | 'MID_TERM' | 'LONG_TERM',
): Promise<{
  tracks: RawTrack[];
  artists: SpotifyArtist[];
}> {
  const input = {
    offset: 0,
    limit: 20,
    sortBy: 'AFFINITY',
    timeRange,
  };
  const profile = at(
    await gql('userTopContent', {
      includeTopArtists: true,
      topArtistsInput: input,
      includeTopTracks: true,
      topTracksInput: input,
    }),
    'data',
    'me',
    'profile',
  );
  return {
    tracks: arr(at(profile, 'topTracks', 'items')).flatMap((entry) => {
      const data = at(entry, 'data');
      const track = trackOf(data, str(at(data, 'uri')), null);
      return track ? [track] : [];
    }),
    artists: arr(at(profile, 'topArtists', 'items')).flatMap((entry) => {
      const data = at(entry, 'data');
      const artistId = spotifyId(at(data, 'uri'));
      const name = str(at(data, 'profile', 'name'))?.trim();
      if (!artistId || !name) return [];
      return [
        {
          id: artistId,
          name,
          imageUrl: sized(at(data, 'visuals', 'avatarImage', 'sources'), 300),
        },
      ];
    }),
  };
}

const RECENTS = 'https://spclient.wg.spotify.com/recently-played/v3/user';

/** The albums, playlists and artists played lately, newest first, as the web player reads them. */
export async function fetchRecent(username: string): Promise<SpotifyRecent[]> {
  if (Date.now() < blockedUntil) throw new AppError('rate_limited');
  const client = await clientToken();
  let response: Response;
  try {
    response = await spotify().session.fetch(
      `${RECENTS}/${encodeURIComponent(username)}/recently-played?format=json&offset=0&limit=50&filter=default,collection-new-episodes`,
      {
        headers: {
          Authorization: `Bearer ${await accessToken()}`,
          Accept: 'application/json',
          'App-Platform': 'WebPlayer',
          ...(client && { 'Client-Token': client }),
        },
        redirect: 'error',
      },
    );
  } catch {
    throw new AppError('network');
  }
  if (response.status === 429) throw new AppError('rate_limited');
  // An account with no listening history has no feed at all.
  if (response.status === 404) return [];
  if (!response.ok) throw new AppError('changed');
  const plays = arr((await readJson(response))?.playContexts);
  const when = new Map(
    plays.map((p) => [str(at(p, 'uri')), num(at(p, 'lastPlayedTime'))]),
  );
  const uris = [...when.keys()].filter((u): u is string => !!u).slice(0, 30);
  if (uris.length === 0) return [];
  const root = await gql('fetchEntitiesForRecentlyPlayed', { uris });
  return arr(at(root, 'data', 'lookup')).flatMap((entry): SpotifyRecent[] => {
    const uri = str(at(entry, '_uri'));
    const data = obj(at(entry, 'data'));
    const playedAt = when.get(uri) ?? null;
    if (!uri || !data) return [];
    if (/collection/.test(uri))
      return [
        {
          kind: 'playlist',
          id: LIKED_ID,
          name: 'Liked Songs',
          subtitle: 'Playlist',
          imageUrl: null,
          playedAt,
          track: null,
        },
      ];
    const entryId = spotifyId(uri);
    if (!entryId) return [];
    switch (str(data.__typename)) {
      case 'Album': {
        const by = artistRefs(at(data, 'artists', 'items'))
          .map((a) => a.name)
          .join(', ');
        return [
          {
            kind: 'album',
            id: entryId,
            name: str(data.name) ?? 'Album',
            subtitle: by ? `Album · ${by}` : 'Album',
            imageUrl: sized(at(data, 'coverArt', 'sources'), 300),
            playedAt,
            track: null,
          },
        ];
      }
      case 'Playlist': {
        const owner = str(at(data, 'ownerV2', 'data', 'name'));
        return [
          {
            kind: 'playlist',
            id: entryId,
            name: str(data.name) ?? 'Playlist',
            subtitle: owner ? `Playlist · ${owner}` : 'Playlist',
            imageUrl: sized(
              at(arr(at(data, 'images', 'items'))[0], 'sources'),
              300,
            ),
            playedAt,
            track: null,
          },
        ];
      }
      case 'Artist':
        return [
          {
            kind: 'artist',
            id: entryId,
            name: str(at(data, 'profile', 'name')) ?? 'Artist',
            subtitle: 'Artist',
            imageUrl: sized(at(data, 'visuals', 'avatarImage', 'sources'), 300),
            playedAt,
            track: null,
          },
        ];
      default:
        return [];
    }
  });
}

/** One song's details (the fallback for GET /tracks/{id}): the web player's `getTrack`. */
export async function fetchSong(
  id: string,
): Promise<Omit<SpotifySong, 'localId' | 'localAlbumKey'>> {
  const data = obj(
    at(
      await gql('getTrack', { uri: `spotify:track:${id}` }),
      'data',
      'trackUnion',
    ),
  );
  const title = str(data?.name)?.trim();
  if (!data || !title) throw new AppError('changed');
  const album = obj(data.albumOfTrack);
  const artists = [
    ...artistRefs(at(data, 'firstArtist', 'items')),
    ...artistRefs(at(data, 'otherArtists', 'items')),
  ];
  const iso = str(at(album, 'date', 'isoString'));
  return {
    id,
    uri: `spotify:track:${id}`,
    title,
    artists: artists.map((a) => a.name),
    artistIds: artists.map((a) => a.id),
    album: str(album?.name),
    albumId: spotifyId(album?.uri),
    durationMs: num(at(data, 'duration', 'totalMilliseconds')) ?? 0,
    imageUrl: sized(at(album, 'coverArt', 'sources'), 64),
    coverUrl: sized(at(album, 'coverArt', 'sources'), 600),
    addedAt: null,
    year: num(at(album, 'date', 'year')) ?? (Number(iso?.slice(0, 4)) || null),
    explicit: str(at(data, 'contentRating', 'label')) === 'EXPLICIT',
    playCount: Number(data.playcount) || null,
  };
}

/** One page of the web player's own song search (BitChord's searchTracks), 20 at a time. */
export async function fetchSearch(
  query: string,
  offset: number,
): Promise<RawTrack[]> {
  return arr(
    at(
      await gql('searchTracks', {
        searchTerm: query,
        offset,
        limit: 20,
        numberOfTopResults: 5,
        includeAudiobooks: false,
        includePreReleases: false,
        includeAuthors: false,
      }),
      'data',
      'searchV2',
      'tracksV2',
      'items',
    ),
  ).flatMap((entry) => {
    const data = at(entry, 'item', 'data');
    const track = trackOf(data, str(at(data, 'uri')), null);
    return track ? [track] : [];
  });
}
