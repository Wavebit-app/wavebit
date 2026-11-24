import { z } from 'zod';

export const DiscordActivityTypeSchema = z.enum([
  'playing',
  'listening',
  'watching',
  'competing',
]);

/** Display data only. It never contains a Discord credential or socket path. */
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
  })
  .strict();

export const DiscordStatusSchema = z.enum([
  'disabled',
  'not_configured',
  'connecting',
  'connected',
  'waiting',
  'error',
]);

export type DiscordActivityType = z.infer<typeof DiscordActivityTypeSchema>;
export type DiscordPlayback = z.infer<typeof DiscordPlaybackSchema>;
export type DiscordStatus = z.infer<typeof DiscordStatusSchema>;
