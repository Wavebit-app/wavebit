import { z } from 'zod';
import type { LyricsSourceId } from '../lyricsSources';

/** What the lyric sources are asked about: every song, whatever it plays from, has these. */
export const LyricsQuerySchema = z
  .object({
    title: z.string().min(1).max(500),
    artist: z.string().max(500),
    album: z.string().max(500),
    durationMs: z
      .number()
      .int()
      .min(0)
      .max(24 * 60 * 60 * 1000),
    /** The YouTube video being played, when it is one. */
    videoId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{11}$/)
      .optional(),
  })
  .strict();
export type LyricsQuery = z.infer<typeof LyricsQuerySchema>;

export interface LyricLine {
  timeMs: number;
  /** Empty for an instrumental break. */
  text: string;
}

export type Lyrics =
  /** Lines with times, followed as the song plays. */
  | { kind: 'synced'; lines: LyricLine[] }
  /** The words with no times, shown as a still page. */
  | { kind: 'plain'; lines: LyricLine[] }
  | { kind: 'instrumental'; lines: [] };

/** Lyrics and the source that had them, for the credit under the words. */
export type FoundLyrics = Lyrics & { source: LyricsSourceId };
