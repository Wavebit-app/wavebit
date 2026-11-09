import { z } from 'zod';
import type { LocalTrack } from './library.ts';
import { YtMatchSchema } from './youtube.ts';

/** How many songs one call may queue; a bigger list is sent in several. */
export const MAX_BATCH = 200;

/**
 * A song to save. Display details only: the page names a video or what to
 * find on YouTube Music, never an address or a path.
 */
export const DownloadSongSchema = z
  .object({
    videoId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{11}$/)
      .nullable(),
    match: YtMatchSchema.nullable(),
    title: z.string().trim().min(1).max(300),
    artist: z.string().max(400),
    album: z.string().max(300),
    artwork: z.string().max(4096).nullable(),
    durationMs: z
      .number()
      .int()
      .min(0)
      .max(24 * 60 * 60 * 1000),
  })
  .strict()
  .refine((song) => song.videoId || song.match);
export type DownloadSong = z.infer<typeof DownloadSongSchema>;

/** An album or playlist downloaded whole, so it can be checked for new songs. */
export const DownloadListSchema = z
  .object({
    kind: z.enum(['spotifyPlaylist', 'spotifyAlbum', 'ytPage']),
    id: z.string().regex(/^[A-Za-z0-9_-]{2,64}$/),
    title: z.string().trim().min(1).max(300),
  })
  .strict();
export type DownloadList = z.infer<typeof DownloadListSchema>;

export const DownloadAddSchema = z
  .object({
    songs: z.array(DownloadSongSchema).min(1).max(MAX_BATCH),
    list: DownloadListSchema.nullable(),
  })
  .strict();

export const DownloadIdSchema = z.object({ id: z.uuid() }).strict();

/** What identifies a song before and after it has a YouTube video. */
export function downloadKey(song: {
  videoId: string | null;
  match?: { title: string; artists: string[] } | null;
}): string {
  return (
    song.videoId ??
    `match:${song.match?.title ?? ''}\n${song.match?.artists.join(',') ?? ''}`
  );
}

/** Why a song didn't save. `blocked` pauses the queue instead of failing the song. */
export type DownloadFailure =
  | 'age_restricted'
  | 'restricted'
  | 'unavailable'
  | 'no_format'
  | 'no_match'
  | 'network'
  | 'outdated'
  | 'missing_tools'
  | 'library_full'
  | 'blocked'
  | 'failed';

export interface DownloadJob {
  id: string;
  key: string;
  videoId: string | null;
  title: string;
  artist: string;
  album: string;
  artwork: string | null;
  durationMs: number;
  /** The album or playlist it was downloaded from. */
  from: string | null;
  /** The file's name only: full paths stay in the main process. */
  fileName: string;
  state: 'queued' | 'running' | 'done' | 'failed';
  /** 0 to 1, or null until the size is known. */
  fraction: number | null;
  reason: DownloadFailure | null;
  /** Lower goes first. */
  order: number;
}

export interface DownloadsSummary {
  folder: string;
  total: number;
  done: number;
  failed: number;
  active: number;
  /** The whole batch, 0 to 1. */
  fraction: number;
  /** Nothing new starts: the user paused, or YouTube is limiting requests. */
  pause: 'user' | 'blocked' | null;
  /** The hourly limit is reached; when the next song can start, in ms. */
  waitingUntil: number | null;
}

export interface DownloadsState {
  summary: DownloadsSummary;
  jobs: DownloadJob[];
  /** Keys of every song saved by wavebit whose file is still there. */
  saved: string[];
  lists: DownloadList[];
}

/** What changed since the last event; a big queue is too much to resend. */
export interface DownloadsDelta {
  summary: DownloadsSummary;
  jobs: DownloadJob[];
  removed: string[];
  savedAdded: string[];
  savedRemoved: string[];
}

/** Library › Downloads: the files wavebit saved, newest first. */
export interface DownloadedLibrary {
  tracks: LocalTrack[];
  lists: DownloadList[];
}

export interface DownloadAddResult {
  added: number;
  /** Already in the library, or already queued. */
  skipped: number;
}

export interface DownloadLocation {
  id: string;
  albumKey: string | null;
}

export type ChooseDownloadFolderResult =
  | { ok: true }
  | { ok: false; reason: 'cancelled' | 'root' | 'home' | 'limit' };
