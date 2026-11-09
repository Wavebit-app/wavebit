import { parseLrc, withBreaks } from './lrc.ts';
import type { LyricLine, Lyrics } from './schemas/lyrics';

const MAX_LINES = 2_000;
const MAX_TEXT = 500;
/** Roles in a TTML file that aren't the main vocal's words. */
const SKIPPED_ROLES = new Set(['x-translation', 'x-roman', 'x-bg']);
const TAG =
  /<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
const ATTRIBUTE = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

export function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  const fromCode = (whole: string, code: number) =>
    code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  return text
    .replace(/&#x([0-9a-f]+);/gi, (w, hex: string) =>
      fromCode(w, Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (w, dec: string) => fromCode(w, Number(dec)))
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** A TTML clock: "27.395", "1:05.20", "1:02:03.4", or a number ending s or ms. */
export function ttmlTime(value: string | undefined): number | null {
  const raw = value?.trim();
  if (!raw) return null;
  if (raw.endsWith('ms')) {
    const ms = Number(raw.slice(0, -2));
    return Number.isFinite(ms) ? Math.trunc(ms) : null;
  }
  const parts = raw.replace(/s$/, '').split(':').map(Number);
  if (parts.length > 3 || parts.some((p) => !Number.isFinite(p))) return null;
  return Math.trunc(parts.reduce((sum, p) => sum * 60 + p, 0) * 1000);
}

function attributes(text: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const [, name, double, single] of text.matchAll(ATTRIBUTE))
    found[name!] = double ?? single ?? '';
  return found;
}

const timedLyrics = (lines: LyricLine[]): Lyrics | null =>
  lines.some((l) => l.text)
    ? { kind: 'synced', lines: withBreaks(lines) }
    : null;

const plainLyrics = (lines: LyricLine[]): Lyrics | null =>
  lines.length > 0 ? { kind: 'plain', lines } : null;

/**
 * TTML's paragraphs as whole lines. Word and syllable spans join up: space in
 * the file, not the end of a span, is what separates words. Translations,
 * romanisation and background vocals are left out.
 */
export function parseTtml(xml: string): Lyrics | null {
  const lines: LyricLine[] = [];
  let timed = false;
  let open: { begin: number | null; end: number | null; text: string } | null =
    null;
  // How deep inside a skipped span; a span within one is skipped with it.
  let skipping = 0;

  for (const [, close, name, attrs, selfClosed, text] of xml.matchAll(TAG)) {
    if (text !== undefined) {
      if (open && !skipping) open.text += text;
      continue;
    }
    const tag = name!.split(':').pop();
    if (tag === 'p' && !close) {
      const a = attributes(attrs!);
      open = { begin: ttmlTime(a.begin), end: ttmlTime(a.end), text: '' };
      skipping = 0;
      if (selfClosed) open = null;
    } else if (tag === 'p' && open) {
      const words = decodeEntities(open.text)
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MAX_TEXT);
      if (words && lines.length < MAX_LINES) {
        timed ||= open.begin !== null;
        lines.push({ timeMs: open.begin ?? 0, text: words });
        if (open.end !== null) lines.push({ timeMs: open.end, text: '' });
      }
      open = null;
    } else if (tag === 'span' && open && !selfClosed) {
      if (close) skipping = Math.max(0, skipping - 1);
      else if (skipping || SKIPPED_ROLES.has(attributes(attrs!)['ttm:role']!))
        skipping += 1;
    }
  }
  return timed ? timedLyrics(lines) : plainLyrics(lines.filter((l) => l.text));
}

interface LyricsPlusLine {
  time?: unknown;
  duration?: unknown;
  text?: unknown;
  syllabus?: { text?: unknown }[];
}

/** LyricsPlus's JSON: each entry has a time and either a line of text or its syllables. */
export function parseLyricsPlus(entries: LyricsPlusLine[]): Lyrics | null {
  const lines: LyricLine[] = [];
  let timed = false;
  for (const entry of entries.slice(0, MAX_LINES)) {
    if (typeof entry.time !== 'number') continue;
    const joined = (entry.syllabus ?? [])
      .map((s) => (typeof s.text === 'string' ? s.text : ''))
      .join('');
    const text = (
      typeof entry.text === 'string' && entry.text.trim() ? entry.text : joined
    )
      .trim()
      .slice(0, MAX_TEXT);
    if (!text) continue;
    timed ||= entry.time > 0;
    lines.push({ timeMs: entry.time, text });
    if (typeof entry.duration === 'number' && entry.duration > 0)
      lines.push({ timeMs: entry.time + entry.duration, text: '' });
  }
  return timed ? timedLyrics(lines) : plainLyrics(lines.filter((l) => l.text));
}

/** How far into each end of a file credit lines ("作词: …") can be. */
const CREDIT_REACH = 30;
const CREDIT = /[:：]/;

function withoutCredits(lines: LyricLine[]): LyricLine[] {
  // Each end looks at no more than its own half, so a short file's closing credit can't eat it.
  const half = Math.ceil(lines.length / 2);
  let start = 0;
  for (let i = Math.min(CREDIT_REACH, half) - 1; i >= 0; i--)
    if (CREDIT.test(lines[i]!.text)) {
      start = i + 1;
      break;
    }
  let end = lines.length;
  for (
    let i = lines.length - 1;
    i >= lines.length - Math.min(CREDIT_REACH, half);
    i--
  ) {
    if (i < start) break;
    if (CREDIT.test(lines[i]!.text)) {
      end = i;
      break;
    }
  }
  const body = lines.slice(start, end);
  // Many open with "Song - Artist", stamped at the very start.
  return body[0]?.timeMs === 0 && body[0].text.includes(' - ')
    ? body.slice(1)
    : body;
}

/** A KuGou LRC: its credits go, and a "pure music" notice means no lyrics. */
export function parseKugou(lrc: string): Lyrics | null {
  const lines = withoutCredits(parseLrc(lrc).filter((l) => l.text));
  if (lines.every((l) => /纯音乐.*欣赏/.test(l.text))) return null;
  return timedLyrics(lines);
}

/** QQ Music's karaoke format, as BetterLyrics Portato relays it: `[start,length]Wo(0,10)rds(10,20)`. */
export function parseQrc(raw: string): Lyrics | null {
  const lines: LyricLine[] = [];
  for (const [, start, length, body] of raw.matchAll(
    /^\[(\d+),(\d+)\](.*)$/gm,
  )) {
    const text = decodeEntities(
      body!.replace(/"\s*\/?>.*$/, '').replace(/\(\d+,\d+\)/g, ''),
    )
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_TEXT);
    if (text) lines.push({ timeMs: Number(start), text });
    if (text && lines.length < MAX_LINES)
      lines.push({ timeMs: Number(start) + Number(length), text: '' });
  }
  const sung = withoutCredits(lines.filter((l) => l.text));
  const kept = new Set(sung.map((l) => l.timeMs));
  // A line's closing break stays only if the line it closes does.
  return timedLyrics(
    lines.filter(
      (l, i) =>
        kept.has(l.timeMs) || (!l.text && kept.has(lines[i - 1]!.timeMs)),
    ),
  );
}

const VERSION_WORDS = new Set([
  'live',
  'remix',
  'remixed',
  'mix',
  'acoustic',
  'unplugged',
  'instrumental',
  'karaoke',
  'demo',
  'edit',
  'version',
  'cover',
  'sped',
  'slowed',
  'reverb',
  'nightcore',
  'lofi',
  'orchestral',
  'extended',
]);
const BRACKETS = /[([][^)\]]*[)\]]/g;

const plainWords = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{Mn}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

const mainTitle = (title: string) =>
  plainWords(title.replace(BRACKETS, ' ').split(' - ')[0]!) ||
  plainWords(title);

/** The words in a title that name a particular version of a song, sorted. */
const versionWords = (title: string) => {
  const extra = title.includes(' - ')
    ? title.slice(title.indexOf(' - ') + 3)
    : '';
  return plainWords(`${(title.match(BRACKETS) ?? []).join(' ')} ${extra}`)
    .split(' ')
    .filter((w) => VERSION_WORDS.has(w))
    .sort()
    .join(' ');
};

const artistNames = (artist: string) =>
  artist
    .split(/,|&|;|\/|\s+and\s+|\s+x\s+|\s+feat\.?\s+|\s+ft\.?\s+/i)
    .map(plainWords)
    .filter(Boolean);

/** A music video's title as its song would be filed: "Artist - Song" loses the artist. */
export function songTitleOfVideo(title: string, artist: string): string {
  const parts = title.split(' - ');
  if (parts.length < 2 || !artist) return title;
  return plainWords(parts[0]!) === plainWords(artist)
    ? parts.slice(1).join(' - ')
    : title;
}

export interface RecordingHit {
  isrc?: unknown;
  title?: unknown;
  artist?: unknown;
  duration?: unknown;
}

/** Seconds a search hit can be from the song and still be the same recording. */
const MAX_LENGTH_OFF_S = 3;

/** A search hit that is this very recording, closest in length; null beats a near miss. */
export function sameRecording(
  hits: RecordingHit[],
  title: string,
  artist: string,
  seconds: number,
): RecordingHit | null {
  const wanted = artistNames(artist);
  const off = (hit: RecordingHit) =>
    seconds > 0 && typeof hit.duration === 'number'
      ? Math.abs(hit.duration - seconds)
      : 0;
  const matching = hits.filter((hit) => {
    if (typeof hit.title !== 'string') return false;
    const names = typeof hit.artist === 'string' ? artistNames(hit.artist) : [];
    return (
      mainTitle(hit.title) === mainTitle(title) &&
      versionWords(hit.title) === versionWords(title) &&
      (wanted.length === 0 || names.some((n) => wanted.includes(n))) &&
      off(hit) <= MAX_LENGTH_OFF_S
    );
  });
  return matching.sort((a, b) => off(a) - off(b))[0] ?? null;
}

/** The only place a BiniLyrics or lrc.red document may be read from. */
export function lrcRedUrl(isrc: unknown): string | null {
  if (typeof isrc !== 'string') return null;
  const code = isrc.trim().toUpperCase();
  return /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(code)
    ? `https://lrc.red/s/${code}.ttml`
    : null;
}
