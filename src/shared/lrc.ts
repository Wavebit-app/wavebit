import type { LyricLine } from './schemas/lyrics';

/** A break shorter than this isn't worth interrupting the lines for (BitChord's MIN_GAP_MS). */
const MIN_GAP_MS = 4_000;
const MAX_LINES = 2_000;
const MAX_TEXT = 500;
const STAMPS = /^(?:\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\])+/;
const STAMP = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

function stampMs(minutes: string, seconds: string, fraction = ''): number {
  // Two digits are hundredths, three are thousandths.
  const ms = Number(fraction.padEnd(3, '0').slice(0, 3));
  return Number(minutes) * 60_000 + Number(seconds) * 1_000 + ms;
}

/**
 * LRC's `[mm:ss.xx] words`, after BitChord's LrcLib.parseLrc. Metadata tags
 * have no time and fall out. A stamp with no words is a break, kept only when
 * long enough to show; the last one closes the song, so it always stays. A
 * long run-up before the first line gets a break of its own.
 */
export function parseLrc(lrc: string): LyricLine[] {
  const all: LyricLine[] = [];
  for (const raw of lrc.split(/\r?\n/).slice(0, MAX_LINES)) {
    const stamps = STAMPS.exec(raw.trim())?.[0];
    if (!stamps) continue;
    const text = raw.trim().slice(stamps.length).trim().slice(0, MAX_TEXT);
    for (const [, m, s, f] of stamps.matchAll(STAMP))
      all.push({ timeMs: stampMs(m!, s!, f), text });
  }
  return withBreaks(all);
}

/**
 * Timed lines in order, with a break kept only when it is long enough to
 * show. A list's last break always stays, and a long run-up before the first
 * line gets a break of its own.
 */
export function withBreaks(lines: LyricLine[]): LyricLine[] {
  const all = [...lines].sort((a, b) => a.timeMs - b.timeMs);
  const kept = all.filter(
    (line, i) =>
      line.text !== '' ||
      i === all.length - 1 ||
      all[i + 1]!.timeMs - line.timeMs >= MIN_GAP_MS,
  );
  const first = kept[0];
  return first && first.text !== '' && first.timeMs >= MIN_GAP_MS
    ? [{ timeMs: 0, text: '' }, ...kept]
    : kept;
}

/** Unstamped words, one line each, keeping blank lines out. */
export function parsePlain(text: string): LyricLine[] {
  return text
    .split(/\r?\n/)
    .slice(0, MAX_LINES)
    .map((line) => line.trim().slice(0, MAX_TEXT))
    .filter(Boolean)
    .map((line) => ({ timeMs: 0, text: line }));
}

const CREDITS = [
  /\s*[([]\s*(feat|ft|featuring|with)\b[^)\]]*[)\]]/gi,
  /\s+(feat|ft|featuring)\.?\s+.*$/i,
  /\s*[([]\s*(official\s*)?(music\s*)?(video|audio|visuali[sz]er|lyrics?\s*video|lyrics?|m\/?v|hd|hq|4k|full\s*song)\s*[)\]]/gi,
  /\s*[([]\s*official\s*[)\]]/gi,
];

/**
 * A title as a lyrics database files it (BitChord's forLyricsSearch). Credits
 * and upload labels go. "(Remix)", "(Live)" and the like stay: they name a
 * different recording, and wrong words in time are worse than none.
 */
export function forLyricsSearch(title: string): string {
  let name = title;
  for (const pattern of CREDITS) name = name.replace(pattern, ' ');
  const clean = name
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[,\-–—\s]+$/, '')
    .trim();
  return clean || title.trim();
}

/** The first credited artist, which is how LRCLIB files a song. */
export function primaryArtist(artist: string): string {
  const name = artist.replace(/ - Topic$/, '').trim();
  return name.split(/,| & /)[0]?.trim() || name;
}

export interface LrcLibHit {
  duration: number;
  syncedLyrics: string | null;
  plainLyrics: string | null;
}

/** How far a search hit's length may be from the song's before its words would drift. */
const MAX_DRIFT_S = 15;

/** The hit closest in length with `field`, within the drift limit when the length is known. */
export function closest(
  hits: LrcLibHit[],
  seconds: number,
  field: 'syncedLyrics' | 'plainLyrics',
): string | null {
  let best: { text: string; off: number } | null = null;
  for (const hit of hits) {
    const text = hit[field];
    if (!text?.trim()) continue;
    const off = seconds > 0 ? Math.abs(hit.duration - seconds) : 0;
    if (seconds > 0 && off > MAX_DRIFT_S) continue;
    if (!best || off < best.off) best = { text, off };
  }
  return best?.text ?? null;
}

/** The line being sung at `ms`: the last one whose time has passed, or -1 before the first. */
export function activeLine(lines: LyricLine[], ms: number): number {
  let low = 0;
  let high = lines.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (lines[mid]!.timeMs <= ms) {
      found = mid;
      low = mid + 1;
    } else high = mid - 1;
  }
  return found;
}
