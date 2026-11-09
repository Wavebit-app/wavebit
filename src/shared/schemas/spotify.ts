import { z } from 'zod';

/** A Spotify playlist id (22 base62 characters) or the Liked Songs collection. */
export const LIKED_ID = 'liked';
export const PlaylistIdSchema = z.string().regex(/^(?:[A-Za-z0-9]{22}|liked)$/);

/** A Spotify track URI, for its Canvas. */
export const TrackUriSchema = z
  .object({ uri: z.string().regex(/^spotify:track:[A-Za-z0-9]{22}$/) })
  .strict();

export const PlaylistQuerySchema = z
  .object({
    id: PlaylistIdSchema,
    offset: z.number().int().min(0).max(100_000),
  })
  .strict();

/** A Spotify album id. */
export const AlbumQuerySchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9]{22}$/),
    offset: z.number().int().min(0).max(100_000),
  })
  .strict();

/** Up to 40 track, album, artist or playlist URIs: one library call's worth. */
const LibraryUris = z
  .array(
    z
      .string()
      .regex(/^spotify:(?:track|album|artist|playlist):[A-Za-z0-9]{22}$/),
  )
  .min(1)
  .max(40);
export const SavedQuerySchema = z.object({ uris: LibraryUris }).strict();
export const SaveSchema = z
  .object({ uris: LibraryUris, saved: z.boolean() })
  .strict();

export interface SpotifyAlbum {
  id: string;
  name: string;
  artists: string[];
  imageUrl: string | null;
  year: number | null;
}

export interface SpotifyArtist {
  id: string;
  name: string;
  imageUrl: string | null;
}

/** A search: the words, and where the page starts. */
export const SearchQuerySchema = z
  .object({
    query: z.string().trim().min(1).max(200),
    offset: z.number().int().min(0).max(200),
  })
  .strict();

/** A Spotify artist id. */
export const ArtistQuerySchema = z
  .object({ id: z.string().regex(/^[A-Za-z0-9]{22}$/) })
  .strict();

/** A Spotify track id, for its details page. */
export const SongQuerySchema = ArtistQuerySchema;

/** The next page of recent plays: a Unix-millisecond cursor from the page before. */
export const RecentMoreSchema = z
  .object({ before: z.number().int().positive() })
  .strict();

/** A playlist to import or forget. Liked Songs is always yours, so it never qualifies. */
export const ImportQuerySchema = z
  .object({ id: z.string().regex(/^[A-Za-z0-9]{22}$/) })
  .strict();

/** An artist page: who they are, their popular songs, releases and similar artists. */
export interface SpotifyArtistPage {
  id: string;
  name: string;
  imageUrl: string | null;
  biography: string | null;
  followers: number | null;
  monthlyListeners: number | null;
  /** Popular songs, matched against local files. */
  topTracks: SpotifyTrack[];
  albums: SpotifyAlbum[];
  singles: SpotifyAlbum[];
  compilations: SpotifyAlbum[];
  /** Other artists' releases this artist is on. */
  appearsOn: SpotifyAlbum[];
  related: SpotifyArtist[];
}

/** An artist's name and, when Spotify gave one, the id of their page. */
export interface SpotifyArtistRef {
  id: string | null;
  name: string;
}

export type SpotifyAlbumKind = 'album' | 'single' | 'ep' | 'compilation';

/** What an album page shows beyond its rows: the header and BitChord's footer. */
export interface SpotifyAlbumDetails {
  kind: SpotifyAlbumKind;
  artists: SpotifyArtistRef[];
  year: number | null;
  /** The full release date (ISO), only when Spotify knows the day. */
  released: string | null;
  label: string | null;
  copyright: string | null;
  /** More releases by the same artist. */
  more: SpotifyAlbum[];
}

/** Where the Spotify session lives: the OS keyring, or memory until quit. */
export type SpotifyStorage = 'keyring' | 'session';

export interface SpotifyProfile {
  /** What to show: the display name, else the account's user id. */
  name: string;
  /** The display name the person chose, or null when the account has none. */
  displayName: string | null;
  imageUrl: string | null;
}

export type SpotifyStatus =
  | { state: 'signed_out'; storage: SpotifyStorage }
  | { state: 'signing_in'; storage: SpotifyStorage }
  | {
      state: 'signed_in';
      storage: SpotifyStorage;
      profile: SpotifyProfile | null;
    };

export interface SpotifyPlaylist {
  id: string;
  name: string;
  owner: string | null;
  imageUrl: string | null;
  /** Songs in it; null when Spotify didn't say. */
  trackCount: number | null;
  /** Added to wavebit from a link; it isn't in the Spotify account. */
  imported?: boolean;
}

export interface SpotifyTrack {
  uri: string;
  title: string;
  artists: string[];
  album: string | null;
  /** The album's Spotify id, for a link to its page. */
  albumId: string | null;
  /** One entry per name in `artists`: that artist's Spotify id, when known. */
  artistIds: (string | null)[];
  durationMs: number;
  imageUrl: string | null;
  /** When it was added to the playlist (epoch ms); null when Spotify didn't say. */
  addedAt: number | null;
  /** The matching local file, if the library has one. */
  localId: string | null;
  /** That file's album in the local library, for the Album column link. */
  localAlbumKey: string | null;
}

export interface SpotifyTrackPage {
  name: string;
  /** Plain text: Spotify's HTML is stripped in the main process. */
  description: string | null;
  imageUrl: string | null;
  owner: string | null;
  followers: number | null;
  items: SpotifyTrack[];
  total: number;
  offset: number;
  /** The offset of the next page, or null on the last one. */
  next: number | null;
  /** Album pages only. */
  album?: SpotifyAlbumDetails;
}

/** One song's details page: a row, plus what a page has room for. */
export interface SpotifySong extends SpotifyTrack {
  id: string;
  /** The large cover; `imageUrl` is the row-sized one. */
  coverUrl: string | null;
  year: number | null;
  explicit: boolean;
  /** Times played on Spotify; null when Spotify didn't say. */
  playCount: number | null;
}

/** One thing played lately: a song (with its play time), or the album, playlist or artist it was played from. */
export interface SpotifyRecent {
  kind: 'track' | 'album' | 'playlist' | 'artist';
  id: string;
  name: string;
  subtitle: string | null;
  imageUrl: string | null;
  /** Epoch ms; null when Spotify didn't say. */
  playedAt: number | null;
  /** The row to play, for `kind: 'track'`. */
  track: SpotifyTrack | null;
}

/** The period Spotify's top items cover: about 4 weeks, 6 months or a year. */
export type SpotifyTopRange = 'month' | 'halfYear' | 'year';

export interface SpotifyRecentPage {
  items: SpotifyRecent[];
  before: number | null;
}

/** Home's Spotify rows: recent plays, and top songs and artists for the shortest period that has any. */
export interface SpotifyHome {
  recent: SpotifyRecent[];
  /** Where the next page of `recent` starts, or null when there is none. */
  recentBefore: number | null;
  topRange: SpotifyTopRange;
  topTracks: SpotifyTrack[];
  topArtists: SpotifyArtist[];
}

/** Why a call failed. Thrown across IPC as `wavebit:<code>`. */
export type ErrorCode =
  | 'signed_out'
  | 'cancelled'
  | 'closed'
  | 'timed_out'
  | 'rate_limited'
  | 'changed'
  | 'network'
  /** Anything unexpected; the details stay in the main process's log. */
  | 'failed';
