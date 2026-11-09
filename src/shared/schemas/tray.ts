import { z } from 'zod';

/** What the tray shows: the renderer owns the player, so it reports this. */
export const TrayStateSchema = z
  .object({
    title: z.string().max(500).nullable(),
    artist: z.string().max(500),
    playing: z.boolean(),
    shuffle: z.boolean(),
    repeat: z.enum(['off', 'all', 'one']),
  })
  .strict();
export type TrayState = z.infer<typeof TrayStateSchema>;

/** What a tray menu item asks the renderer to do. */
export type TrayCommand =
  | 'toggle'
  | 'previous'
  | 'next'
  | 'shuffle'
  | 'repeat:off'
  | 'repeat:all'
  | 'repeat:one'
  | 'nowPlaying'
  | 'lyrics'
  | 'queue'
  | 'home'
  | 'library'
  | 'search'
  | 'settings'
  | 'closeToTray';
