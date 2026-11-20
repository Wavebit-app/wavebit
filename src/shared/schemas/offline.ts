import { z } from 'zod';

const VideoId = z.string().regex(/^[A-Za-z0-9_-]{11}$/);

/** The page names a video, never a path or an address. */
export const OfflineKeepSchema = z.object({ videoId: VideoId }).strict();
export const OfflineHasSchema = z
  .object({ videoIds: z.array(VideoId).max(500) })
  .strict();

/** A song now has a copy that plays without a connection. */
export interface OfflineSaved {
  videoId: string;
}
