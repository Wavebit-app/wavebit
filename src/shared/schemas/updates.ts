import { z } from 'zod';

export const NotesQuerySchema = z
  .object({ target: z.enum(['installed', 'pending']) })
  .strict();
export type NotesTarget = z.infer<typeof NotesQuerySchema>['target'];

/** Pages the page may ask for by name; their addresses stay in the main process. */
export const UpdatePageSchema = z
  .object({ page: z.enum(['repo', 'releases', 'release']) })
  .strict();
export type UpdatePage = z.infer<typeof UpdatePageSchema>['page'];

export type UpdateState =
  | 'unavailable'
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  /** macOS won't apply an update to an unsigned app; it comes from the Releases page. */
  | 'manual'
  | 'error';

export interface UpdateStatus {
  state: UpdateState;
  currentVersion: string;
  /** The version on its way, once one has been found. */
  version?: string;
  /** 0 to 100, while downloading. */
  progress?: number;
  transferred?: number;
  total?: number;
  checkedAt?: number;
  error?: 'network' | 'failed' | 'install';
  /** Opened on a newer version than last time, and What's new not pressed yet. */
  justUpdated: boolean;
}

export interface ReleaseNotesSection {
  title: string;
  items: string[];
}

export interface ReleaseNotes {
  version: string;
  /** ISO date from the release. */
  date: string | null;
  sections: ReleaseNotesSection[];
  /** Fetched just now, the copy saved on this computer, or neither. */
  source: 'live' | 'saved' | 'failed';
}
