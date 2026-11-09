import { z } from 'zod';
import { YtMatchSchema } from './youtube';

export type {
  AlbumDetail,
  AlbumSummary,
  ArtistDetail,
  ArtistSummary,
  HomeFeed,
  LocalTrack,
  ScanProgress,
  Loudness,
  ScanResult,
  SearchResults,
  TopPicks,
  TrackPage,
} from '../../../native/index';

/** Track and album ids are 16 hex characters derived in Rust. */
export const HexIdSchema = z.string().regex(/^[0-9a-f]{16}$/);

const Offset = z.number().int().min(0).max(100_000);
const Query = z.string().max(200);

export const TracksQuerySchema = z
  .object({
    query: Query,
    sort: z.enum(['title', 'artist', 'album', 'recent']),
    offset: Offset,
    limit: z.number().int().min(1).max(200),
  })
  .strict();

export const ListQuerySchema = z
  .object({
    query: Query,
    offset: Offset,
    limit: z.number().int().min(1).max(200),
  })
  .strict();

export const AlbumKeySchema = z.object({ key: HexIdSchema }).strict();
export const ArtistNameSchema = z
  .object({ name: z.string().min(1).max(500) })
  .strict();
export const SearchSchema = z.object({ query: Query }).strict();
/** A Top Picks station: the artist one names its artist. */
export const StationQuerySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.enum(['personal', 'discovery', 'rediscover']) }).strict(),
  z
    .object({ kind: z.literal('artist'), artist: z.string().min(1).max(500) })
    .strict(),
]);
export type StationQuery = z.infer<typeof StationQuerySchema>;

export const TrackIdSchema = z.object({ id: HexIdSchema }).strict();

/**
 * A song listened to in wavebit: enough to show and play it again. A stream's
 * plays reach neither the library nor Spotify, so wavebit keeps its own list.
 */
export const PlayedSongSchema = z
  .object({
    id: z
      .string()
      .regex(
        /^(?:[0-9a-f]{16}|youtube:[\w-]{11}|spotify:track:[A-Za-z0-9]{22})$/,
      ),
    title: z.string().min(1).max(500),
    artist: z.string().max(500),
    album: z.string().max(500),
    albumKey: z
      .string()
      .regex(/^[0-9a-f]{16}$/)
      .nullable(),
    artwork: z
      .string()
      .max(2048)
      .regex(/^(?:https:\/\/|media:\/\/art\/)/)
      .nullable(),
    durationMs: z
      .number()
      .int()
      .min(0)
      .max(24 * 60 * 60 * 1000),
    spotifyUri: z
      .string()
      .regex(/^spotify:track:[A-Za-z0-9]{22}$/)
      .nullable(),
    videoId: z
      .string()
      .regex(/^[\w-]{11}$/)
      .nullable(),
    match: YtMatchSchema.nullable(),
  })
  .strict();
export type PlayedSong = z.infer<typeof PlayedSongSchema>;
export type HistoryEntry = PlayedSong & { playedAt: number };

/** Time heard since the last report; a play is counted once, at half the song. */
export const ListenedSchema = z
  .object({
    song: PlayedSongSchema,
    ms: z
      .number()
      .int()
      .min(0)
      .max(10 * 60 * 1000),
    plays: z.number().int().min(0).max(1),
  })
  .strict();
export type Listened = z.infer<typeof ListenedSchema>;

/** One song's all-time listening. Stays on this computer. */
export type ListenRow = HistoryEntry & { ms: number; plays: number };

/** What Library's listening cards show. A category with no plays is null. */
export interface ListeningSummary {
  totalMs: number;
  totalPlays: number;
  topSong: ListenRow | null;
  topArtist: {
    name: string;
    /** The credit on a file, for its page; null when only streams were heard. */
    localName: string | null;
    artwork: string | null;
    ms: number;
    plays: number;
  } | null;
  topAlbum: {
    title: string;
    artist: string;
    albumKey: string | null;
    artwork: string | null;
    ms: number;
    plays: number;
  } | null;
}
export const RemoveFolderSchema = z
  .object({ path: z.string().min(1).max(4096) })
  .strict();

export type TracksQuery = z.infer<typeof TracksQuerySchema>;
export type ListQuery = z.infer<typeof ListQuerySchema>;
export type SongSort = TracksQuery['sort'];

/** What Show details reads from a file on disk; never its path. */
export interface FileInfo {
  format: string;
  sizeBytes: number;
  modifiedMs: number;
}

export interface LibraryState {
  folders: string[];
  trackCount: number;
  durationMs: number;
  albumCount: number;
  artistCount: number;
  scanning: boolean;
}

/** Why adding a folder was refused, shown under the folder list. */
export type AddFolderResult =
  | { ok: true; state: LibraryState }
  | {
      ok: false;
      reason: 'cancelled' | 'root' | 'home' | 'duplicate' | 'limit';
    };
