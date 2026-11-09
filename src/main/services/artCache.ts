import { app, net } from 'electron';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { imageMime, overBudget } from './artRules';

/** Enough for thousands of covers; the least recently used go first. */
const BUDGET_BYTES = 256 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const PRUNE_EVERY_WRITES = 25;

export interface CachedImage {
  mime: string;
  data: Buffer;
}

const folder = () => path.join(app.getPath('userData'), 'art-cache');
const pending = new Map<string, Promise<CachedImage | null>>();
let writes = 0;

async function prune(): Promise<void> {
  const dir = folder();
  const names = (await fs.readdir(dir)).filter((n) => !n.endsWith('.tmp'));
  const files = await Promise.all(
    names.map(async (name) => {
      const { size, mtimeMs } = await fs.stat(path.join(dir, name));
      return { name, size, mtimeMs };
    }),
  );
  await Promise.all(
    overBudget(files, BUDGET_BYTES).map((name) =>
      fs.rm(path.join(dir, name), { force: true }),
    ),
  );
}

/** The bytes, or null when it fails, is too big or isn't an image. */
async function download(url: string): Promise<CachedImage | null> {
  const response = await net.fetch(url, {
    redirect: 'error',
    credentials: 'omit',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok || !response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_IMAGE_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const data = Buffer.concat(chunks);
  const mime = imageMime(data);
  return mime ? { mime, data } : null;
}

async function fetchAndKeep(
  url: string,
  file: string,
): Promise<CachedImage | null> {
  const image = await download(url);
  if (!image) return null;
  await fs.mkdir(folder(), { recursive: true });
  // Whole files only: a crash mid-write leaves a .tmp that is never served.
  await fs.writeFile(`${file}.tmp`, image.data, { mode: 0o600 });
  await fs.rename(`${file}.tmp`, file);
  if (++writes % PRUNE_EVERY_WRITES === 1) void prune().catch(() => {});
  return image;
}

/**
 * An album cover from disk, fetched once and kept. `url` has already been
 * checked against the artwork hosts (urls.ts › artUrlFromPath).
 */
export async function cachedImage(url: string): Promise<CachedImage | null> {
  const key = createHash('sha256').update(url).digest('hex');
  const file = path.join(folder(), key);
  try {
    const data = await fs.readFile(file);
    const mime = imageMime(data);
    if (mime) {
      // The file's time is its place in the queue to be dropped.
      const now = new Date();
      void fs.utimes(file, now, now).catch(() => {});
      return { mime, data };
    }
  } catch {
    // Not cached yet.
  }
  const running = pending.get(key);
  if (running) return running;
  const job = fetchAndKeep(url, file)
    .catch(() => null)
    .finally(() => pending.delete(key));
  pending.set(key, job);
  return job;
}
