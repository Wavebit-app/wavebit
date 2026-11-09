/**
 * The rules behind downloads.ts, apart from Electron so they can be tested:
 * what yt-dlp is told, what its output means, and what a file may be called.
 */
import path from 'node:path';
import type { DownloadFailure } from '../../shared/schemas/downloads';
import type { Lyrics } from '../../shared/schemas/lyrics';

export const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

const PROGRESS_PREFIX = 'wavebit ';
const PROGRESS_TEMPLATE = `download:${PROGRESS_PREFIX}%(progress.downloaded_bytes)s/%(progress.total_bytes,progress.total_bytes_estimate)s`;

/** The arguments of one download; every path yt-dlp may otherwise choose is fixed here. */
export function ytDlpArgs(options: {
  videoId: string;
  denoPath: string;
  cacheDir: string;
}): string[] {
  if (!VIDEO_ID.test(options.videoId)) throw new Error('Bad video id');
  return [
    // The user's own yt-dlp setup must not reach this run.
    '--ignore-config',
    '--no-plugin-dirs',
    '--no-update',
    '--no-exec',
    '--no-playlist',
    // Deno sandboxes the challenge solver; no solver is fetched at run time.
    '--no-js-runtimes',
    '--js-runtimes',
    `deno:${options.denoPath}`,
    // AAC in MP4: the one audio format that plays, and can be tagged, without ffmpeg.
    '-f',
    'ba[ext=m4a]',
    '--max-filesize',
    '200M',
    // googlevideo slows one long response to playback speed; small ranges aren't.
    '--http-chunk-size',
    '2M',
    '--cache-dir',
    options.cacheDir,
    '--no-mtime',
    '--newline',
    '--progress-template',
    PROGRESS_TEMPLATE,
    '-o',
    '%(id)s.%(ext)s',
    '--',
    `https://music.youtube.com/watch?v=${options.videoId}`,
  ];
}

/** How far along a progress line says the download is, or null if it isn't one. */
export function parseProgress(line: string): number | null {
  if (!line.startsWith(PROGRESS_PREFIX)) return null;
  const [done, total] = line.slice(PROGRESS_PREFIX.length).split('/');
  const fraction = Number(done) / Number(total);
  return Number.isFinite(fraction) ? Math.min(Math.max(fraction, 0), 1) : null;
}

/** What yt-dlp's error output means. Order matters: a block reads like other failures. */
export function failureOf(stderr: string): DownloadFailure {
  if (/not a bot|HTTP Error 429|Too Many Requests|rate.?limit/i.test(stderr))
    return 'blocked';
  if (/confirm your age|age.?restrict|inappropriate for some/i.test(stderr))
    return 'age_restricted';
  if (/Premium|members.?only|join this channel|private video/i.test(stderr))
    return 'restricted';
  if (
    /challenge solving failed|signature solving failed|nsig|only images are available|unable to extract|failed to extract/i.test(
      stderr,
    )
  )
    return 'outdated';
  if (/requested format is not available/i.test(stderr)) return 'no_format';
  if (/unavailable|not available|has been removed|blocked it/i.test(stderr))
    return 'unavailable';
  if (
    /unable to download|getaddrinfo|name resolution|timed out|connection|ssl/i.test(
      stderr,
    )
  )
    return 'network';
  return 'failed';
}

/** A file is M4A by its bytes (`ftyp` at offset 4), whatever it is called. */
export function isM4a(head: Uint8Array): boolean {
  return (
    head.length >= 8 &&
    new TextDecoder('latin1').decode(head.subarray(4, 8)) === 'ftyp'
  );
}

const MAX_STEM_BYTES = 200;
// Illegal somewhere, or invisible and able to disguise a name.
// oxlint-disable-next-line no-control-regex
const UNSAFE = /[\\/:*?"<>|\x00-\x1f\x7f‎‏‪-‮⁦-⁩]/g;
const RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\.|$)/i;

function clean(raw: string): string {
  return raw.replace(UNSAFE, ' ').replace(/\s+/g, ' ').trim();
}

/** Cut on a character boundary, under the 255-byte limit filenames have. */
function shorten(text: string): string {
  let out = '';
  for (const char of text) {
    if (Buffer.byteLength(out + char) > MAX_STEM_BYTES) break;
    out += char;
  }
  return out;
}

/** "Artist - Title.m4a", safe on every system this runs on. */
export function songFileName(
  artist: string,
  title: string,
  videoId: string,
): string {
  const parts = [clean(artist), clean(title)].filter(Boolean);
  const stem =
    shorten(parts.join(' - '))
      .replace(/^[.\s]+|[.\s]+$/g, '')
      .trim() || videoId;
  return `${RESERVED.test(stem) ? `_${stem}` : stem}.m4a`;
}

export function insideFolder(folder: string, file: string): boolean {
  const relative = path.relative(folder, file);
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

/** A folder name, safe the same way a file name is. Empty when nothing is left. */
function safeFolder(raw: string): string {
  const name = shorten(clean(raw))
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .trim();
  return RESERVED.test(name) ? `_${name}` : name;
}

/** Where a song goes under the download folder. */
export function songLocation(song: {
  artist: string;
  album: string;
  title: string;
  videoId: string;
  organise: boolean;
}): { dirs: string[]; name: string } {
  const name = songFileName(song.artist, song.title, song.videoId);
  if (!song.organise) return { dirs: [], name };
  const artist =
    safeFolder(song.artist.split(/,\s*|\s+&\s+/)[0] ?? '') || 'Unknown artist';
  const album = safeFolder(song.album);
  return { dirs: album ? [artist, album] : [artist], name };
}

/** yt-dlp's wiki puts anonymous use at about 300 videos an hour; this stays under it. */
export const STARTS_PER_HOUR = 250;
const HOUR_MS = 60 * 60_000;

export const recentStarts = (starts: number[], now: number): number[] =>
  starts.filter((at) => at > now - HOUR_MS && at <= now);

/** How long until another song may start: 0 means now. */
export function msUntilStart(
  starts: number[],
  now: number,
  limit = STARTS_PER_HOUR,
): number {
  const recent = recentStarts(starts, now).sort((a, b) => a - b);
  if (recent.length < limit) return 0;
  return recent[recent.length - limit]! + HOUR_MS - now;
}

const stamp = (ms: number) => {
  const hundredths = Math.floor(ms / 10);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `[${pad(Math.floor(hundredths / 6000))}:${pad(Math.floor(hundredths / 100) % 60)}.${pad(hundredths % 100)}]`;
};

/** The words as they go in a file: LRC when timed, plain lines when not. */
export function lyricsText(lyrics: Lyrics): string | null {
  if (lyrics.kind === 'instrumental' || lyrics.lines.length === 0) return null;
  return lyrics.lines
    .map((l) => (lyrics.kind === 'synced' ? stamp(l.timeMs) + l.text : l.text))
    .join('\n');
}

/** MP4 covers can only be JPEG or PNG. */
export const canEmbedCover = (mime: string): boolean =>
  mime === 'image/jpeg' || mime === 'image/png';
