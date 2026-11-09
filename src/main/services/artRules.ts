/** The album art cache's rules, apart from Electron so they can be tested. */

/** What a file really is, from its first bytes; null for anything but these images. */
export function imageMime(bytes: Uint8Array): string | null {
  const at = (i: number) => bytes[i];
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg';
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47)
    return 'image/png';
  if (at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x38)
    return 'image/gif';
  const ascii = (from: number, to: number) =>
    String.fromCharCode(...bytes.subarray(from, to));
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export interface CachedFile {
  name: string;
  size: number;
  /** Last read or written. */
  mtimeMs: number;
}

/** The least recently used files that must go to bring the cache under `budget`. */
export function overBudget(files: CachedFile[], budget: number): string[] {
  let total = 0;
  return [...files]
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .filter((f) => (total += f.size) > budget)
    .map((f) => f.name);
}
