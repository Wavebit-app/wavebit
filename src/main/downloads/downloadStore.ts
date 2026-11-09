/**
 * What survives a restart: finished songs, the unfinished queue, the lists
 * downloaded whole and the hour's song starts. Apart from Electron so it can
 * be tested. The file is read as untrusted: entries that don't check out are
 * dropped one by one, so one bad entry doesn't lose the rest.
 */
import {
  promises as fs,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import {
  DownloadListSchema,
  DownloadSongSchema,
} from '../../shared/schemas/downloads.ts';
import { VIDEO_ID } from './downloadRules.ts';

const RecordSchema = z
  .object({
    file: z
      .string()
      .min(1)
      .max(4096)
      .refine((f) => path.isAbsolute(f) && f.endsWith('.m4a')),
    title: z.string().max(300),
    artist: z.string().max(400),
    addedAt: z.number().int().min(0),
    /** Other keys this song was asked for under, like a Spotify match. */
    keys: z.array(z.string().max(2000)).max(50),
  })
  .strict();
export type DownloadRecord = z.infer<typeof RecordSchema>;

const QueuedSchema = z
  .object({
    song: DownloadSongSchema,
    list: DownloadListSchema.nullable(),
  })
  .strict();
export type QueuedSong = z.infer<typeof QueuedSchema>;

export interface StoredDownloads {
  records: Record<string, DownloadRecord>;
  queue: QueuedSong[];
  lists: z.infer<typeof DownloadListSchema>[];
  starts: number[];
}

const empty = (): StoredDownloads => ({
  records: {},
  queue: [],
  lists: [],
  starts: [],
});

const asArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];

function goodOnes<T>(schema: z.ZodType<T>, items: unknown[]): T[] {
  return items.flatMap((item) => {
    const parsed = schema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

export function parseStored(raw: unknown): StoredDownloads {
  if (!raw || typeof raw !== 'object') return empty();
  const source = raw as Record<string, unknown>;
  const records: StoredDownloads['records'] = Object.create(null);
  if (source.records && typeof source.records === 'object')
    for (const [videoId, value] of Object.entries(source.records)) {
      const parsed = RecordSchema.safeParse(value);
      if (VIDEO_ID.test(videoId) && parsed.success)
        records[videoId] = parsed.data;
    }
  return {
    records,
    queue: goodOnes(QueuedSchema, asArray(source.queue)),
    lists: goodOnes(DownloadListSchema, asArray(source.lists)),
    starts: asArray(source.starts).filter(
      (n): n is number => typeof n === 'number' && Number.isFinite(n),
    ),
  };
}

export function loadStored(file: string): StoredDownloads {
  try {
    return parseStored(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    return empty();
  }
}

/** Written beside the real file and renamed, so a crash can't leave half of one. */
export async function saveStored(
  file: string,
  data: StoredDownloads,
): Promise<void> {
  const temp = `${file}.tmp`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(temp, JSON.stringify(data));
  await fs.rename(temp, file);
}

/** For the moment the app quits, when nothing asynchronous can finish. */
export function saveStoredNow(file: string, data: StoredDownloads): void {
  const temp = `${file}.tmp`;
  writeFileSync(temp, JSON.stringify(data));
  renameSync(temp, file);
}
