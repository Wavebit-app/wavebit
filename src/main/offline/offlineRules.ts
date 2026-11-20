/**
 * The rules behind offlineSongs.ts, apart from Electron so they can be tested:
 * what the index on disk may hold, and which copies go when the cache is full.
 */
import { VIDEO_ID } from '../downloads/downloadRules.ts';

/** The most the copies may take on disk. */
export const MAX_CACHE_BYTES = 1024 * 1024 * 1024;
/** A copy bigger than this isn't a song (yt-dlp is also held to 200 MB). */
const MAX_COPY_BYTES = 200 * 1024 * 1024;
const MAX_ENTRIES = 5_000;

export interface OfflineEntry {
  bytes: number;
  /** When it was last saved or played, for removing the oldest first. */
  usedAt: number;
}

export type OfflineIndex = Map<string, OfflineEntry>;

/** The index as read from disk, treated as untrusted: anything odd is dropped. */
export function parseIndex(raw: unknown): OfflineIndex {
  const index: OfflineIndex = new Map();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return index;
  for (const [id, value] of Object.entries(raw)) {
    if (index.size >= MAX_ENTRIES) break;
    if (!VIDEO_ID.test(id) || !value || typeof value !== 'object') continue;
    const { bytes, usedAt } = value as Record<string, unknown>;
    if (
      typeof bytes !== 'number' ||
      !Number.isInteger(bytes) ||
      bytes <= 0 ||
      bytes > MAX_COPY_BYTES ||
      typeof usedAt !== 'number' ||
      !Number.isFinite(usedAt)
    )
      continue;
    index.set(id, { bytes, usedAt });
  }
  return index;
}

export const indexToJson = (index: OfflineIndex) =>
  Object.fromEntries(index.entries());

/** The copies to remove, oldest used first, until the rest fit. `keep` never goes. */
export function overBudget(
  index: OfflineIndex,
  maxBytes = MAX_CACHE_BYTES,
  keep: string | null = null,
): string[] {
  let total = 0;
  for (const entry of index.values()) total += entry.bytes;
  const out: string[] = [];
  const oldest = [...index.entries()].sort((a, b) => a[1].usedAt - b[1].usedAt);
  for (const [id, entry] of oldest) {
    if (total <= maxBytes) break;
    if (id === keep) continue;
    out.push(id);
    total -= entry.bytes;
  }
  return out;
}

/** The file name of a copy. Only a checked video id ever becomes a path. */
export function copyName(videoId: string): string {
  if (!VIDEO_ID.test(videoId)) throw new Error('Bad video id');
  return `${videoId}.m4a`;
}
