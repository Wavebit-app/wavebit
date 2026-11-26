import { z } from 'zod';
import { DiscordActivityTypeSchema } from './settings.ts';

export { DiscordActivityTypeSchema };

/** A YouTube video id and a Spotify track id: ids only, the main process builds links. */
export const YouTubeIdSchema = z.string().regex(/^[A-Za-z0-9_-]{11}$/);
export const SpotifyTrackIdSchema = z.string().regex(/^[A-Za-z0-9]{22}$/);

/** Display data only. It never contains a Discord credential, a URL to open or a path. */
export const DiscordPlaybackSchema = z
  .object({
    id: z.string().min(1).max(160),
    title: z.string().max(512),
    artist: z.string().max(512),
    album: z.string().max(512),
    artworkUrl: z.string().max(2048).nullable(),
    playing: z.boolean(),
    position: z.number().finite().min(0).max(604800),
    duration: z.number().finite().min(0).max(604800),
    speed: z.number().finite().min(0.5).max(2),
    /** Where the song came from, for the badge and the files setting. */
    source: z.enum(['file', 'youtube', 'spotify']),
    youtubeId: YouTubeIdSchema.nullable(),
    spotifyId: SpotifyTrackIdSchema.nullable(),
  })
  .strict();

export const DiscordStatusSchema = z.enum([
  'disabled',
  'not_configured',
  'connecting',
  'connected',
  'waiting',
]);

export const DiscordUserSchema = z
  .object({
    id: z.string().regex(/^\d{17,20}$/),
    name: z.string().min(1).max(32),
    username: z.string().min(1).max(32),
    avatarUrl: z
      .string()
      .regex(
        /^https:\/\/cdn\.discordapp\.com\/avatars\/\d{17,20}\/(a_)?[0-9a-f]{32}\.png\?size=128$/,
      )
      .nullable(),
  })
  .strict();

/** What the Rust module reports; checked again here before it is used. */
export const DiscordReportSchema = z
  .object({
    status: DiscordStatusSchema,
    user: DiscordUserSchema.nullable(),
    client: z.string().max(40).nullable(),
    problem: z.literal('rejected').nullable(),
    showing: z.boolean(),
    sentAt: z.number().int().nonnegative().nullable(),
  })
  .strict();

/** The activity as sent to Discord's local RPC. */
export interface DiscordActivity {
  type: number;
  status_display_type?: 0 | 1 | 2;
  details: string;
  details_url?: string;
  state?: string;
  timestamps?: { start: number; end: number };
  assets?: {
    large_image?: string;
    large_text?: string;
    small_image?: string;
    small_text?: string;
  };
  buttons?: { label: string; url: string }[];
}

/** Why no card is showing, when none is. */
export type DiscordHidden = 'off' | 'private' | 'nothing' | 'files' | 'paused';

export type DiscordActivityType = z.infer<typeof DiscordActivityTypeSchema>;
export type DiscordPlayback = z.infer<typeof DiscordPlaybackSchema>;
export type DiscordStatus = z.infer<typeof DiscordStatusSchema>;
export type DiscordUser = z.infer<typeof DiscordUserSchema>;
export type DiscordReport = z.infer<typeof DiscordReportSchema>;

/** Everything Settings, the title bar and the tray show about Discord. */
export interface DiscordState extends DiscordReport {
  /** Hides the card until turned off or wavebit quits. Never saved. */
  private: boolean;
  /** The card for what is playing, exactly as it is (or would be) sent. */
  card: DiscordActivity | null;
  hidden: DiscordHidden | null;
  /** The song the card is for, for the title bar's hover card. */
  song: { title: string; artist: string } | null;
}
