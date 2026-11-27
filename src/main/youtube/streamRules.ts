import { onDomain } from '../security/urls.ts';

export const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
export const STREAM_HOSTS = ['googlevideo.com'] as const;
export const STREAM_LEASE_MS = 10 * 60_000;
// yt-dlp takes 10 to 15 s for a long video, more on a slow connection.
export const STREAM_RESOLVE_TIMEOUT_MS = 45_000;
export const STREAM_OUTPUT_LIMIT = 8 * 1024 * 1024;
/**
 * The most asked of YouTube's servers at once. They send a request for more
 * than about 10 MB at little more than playback speed, which starved long
 * mixes; and the player only starts once the whole first piece has arrived
 * (measured on a 500 KB/s line: 3.6 s at 1 MB, 7 to 11 s at 2 MB, 17 s at
 * 8 MB). The player asks for the next piece as it needs it.
 */
export const STREAM_CHUNK_BYTES = 1024 * 1024;

export interface YtDlpFormat {
  url?: unknown;
  format_id?: unknown;
  ext?: unknown;
  vcodec?: unknown;
  acodec?: unknown;
  height?: unknown;
  width?: unknown;
  fps?: unknown;
  tbr?: unknown;
  abr?: unknown;
  protocol?: unknown;
  manifest_url?: unknown;
}

export interface YtDlpInfo {
  id?: unknown;
  duration?: unknown;
  formats?: unknown;
}

export interface SelectedFormats {
  audio: YtDlpFormat;
  video: YtDlpFormat;
  heights: number[];
  width: number;
  height: number;
  durationMs: number;
  mimeType: string;
}

export function streamUrlAllowed(raw: unknown): raw is string {
  return (
    typeof raw === 'string' && raw.length <= 8192 && onDomain(STREAM_HOSTS, raw)
  );
}

export function streamResolverArgs(options: {
  videoId: string;
  denoPath: string;
}): string[] {
  if (!VIDEO_ID.test(options.videoId)) throw new Error('Bad video id');
  return [
    '--ignore-config',
    '--no-plugin-dirs',
    '--no-update',
    '--no-exec',
    '--no-playlist',
    '--no-warnings',
    '--no-progress',
    '--dump-single-json',
    '--skip-download',
    '--no-js-runtimes',
    '--js-runtimes',
    `deno:${options.denoPath}`,
    // Keep signed media URLs and resolver state in this short-lived run only.
    '--no-cache-dir',
    '--',
    `https://music.youtube.com/watch?v=${options.videoId}`,
  ];
}

export function mediaRangeAllowed(value: string | null): boolean {
  if (value === null) return true;
  if (value.length > 80) return false;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) return false;
  const start = match[1] ? Number(match[1]) : null;
  const end = match[2] ? Number(match[2]) : null;
  return (
    (start === null || Number.isSafeInteger(start)) &&
    (end === null || Number.isSafeInteger(end)) &&
    (start === null || end === null || start <= end)
  );
}

/**
 * The range asked of YouTube for one the player asked of wavebit: the same
 * start, at most STREAM_CHUNK_BYTES long. A suffix range (the last N bytes)
 * is passed on as it is; the player only asks for small ones.
 */
export function upstreamRange(
  value: string | null,
  chunk = STREAM_CHUNK_BYTES,
): string {
  const match = value ? /^bytes=(\d*)-(\d*)$/.exec(value) : null;
  if (value && match && !match[1]) return value;
  const start = match?.[1] ? Number(match[1]) : 0;
  const asked = match?.[2] ? Number(match[2]) : Number.POSITIVE_INFINITY;
  const end = Math.min(asked, start + chunk - 1);
  return `bytes=${start}-${end}`;
}

/** `bytes a-b/total` from a Content-Range header, or null. */
export function parseContentRange(
  value: string | null,
): { start: number; end: number; total: number } | null {
  const match = value ? /^bytes (\d+)-(\d+)\/(\d+)$/.exec(value) : null;
  if (!match) return null;
  const [start, end, total] = [match[1], match[2], match[3]].map(Number);
  return Number.isSafeInteger(total) && start! <= end! && end! < total!
    ? { start: start!, end: end!, total: total! }
    : null;
}

/**
 * The bytes the player asked for, as [start, end] within a file of `total`
 * bytes: the whole rest of the file for an open range. Null for a suffix
 * range or one that starts past the end.
 */
export function askedRange(
  value: string | null,
  total: number,
): [number, number] | null {
  if (value === null) return total > 0 ? [0, total - 1] : null;
  const match = /^bytes=(\d+)-(\d*)$/.exec(value);
  if (!match) return null;
  const start = Number(match[1]);
  const end = match[2] ? Math.min(Number(match[2]), total - 1) : total - 1;
  return start <= end ? [start, end] : null;
}

/**
 * Whether a media:// stream request may come from this app's page. The
 * player's media requests reach the handler with neither Origin nor
 * Referer, as library files do, so their absence is allowed; the lease id
 * in the address is random and short-lived. A request that does say where
 * it comes from must come from the app's own page.
 */
export function streamRequestAllowed(
  origin: string | null,
  referer: string | null,
  trusted: (url: string) => boolean,
): boolean {
  if (origin !== null && !trusted(origin)) return false;
  // `trusted` reads a whole address (isTrustedOrigin), as Referer is one.
  return referer === null || trusted(referer);
}

export function leaseActive(expiresAt: number, now: number): boolean {
  return Number.isSafeInteger(expiresAt) && expiresAt > now;
}

export function mayReleaseLease(ownerId: number, requesterId: number): boolean {
  return Number.isSafeInteger(ownerId) && ownerId === requesterId;
}

function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null;
}

/**
 * A format the player can read as one file: plain HTTPS. yt-dlp also lists
 * HLS (`m3u8_native`) formats on googlevideo.com with the same codecs and
 * heights; their URL is a playlist, which a media element can't parse.
 */
function formatUrl(format: YtDlpFormat): string | null {
  if (format.protocol !== undefined && format.protocol !== 'https') return null;
  return streamUrlAllowed(format.url) ? format.url : null;
}

function videoMime(format: YtDlpFormat): string {
  if (format.ext === 'mp4') return 'video/mp4';
  if (format.ext === 'webm') return 'video/webm';
  return 'application/octet-stream';
}

function audioMime(format: YtDlpFormat): string {
  if (format.ext === 'm4a' || format.ext === 'mp4') return 'audio/mp4';
  if (format.ext === 'webm') return 'audio/webm';
  if (format.ext === 'ogg') return 'audio/ogg';
  return 'application/octet-stream';
}

/**
 * 1 for WebM. YouTube's MP4 files are fragmented (DASH): Chromium can only
 * seek within the part it has already read, so a jump further on (resuming
 * a long mix, or the seek bar) lands at the end and the song counts as
 * finished. Its WebM files carry their seek index at the start.
 */
const seekable = (format: YtDlpFormat) => (format.ext === 'webm' ? 1 : 0);

/** Selects independent audio and video-only CDN formats from yt-dlp metadata. */
export function selectFormats(
  info: YtDlpInfo,
  videoId: string,
  maxHeight: number,
): SelectedFormats | null {
  if (info.id !== videoId || !Array.isArray(info.formats)) return null;
  const formats = info.formats.filter(
    (entry): entry is YtDlpFormat => !!entry && typeof entry === 'object',
  );
  const audio = formats
    .filter(
      (format) =>
        format.vcodec === 'none' &&
        number(format.abr ?? format.tbr) !== null &&
        formatUrl(format) !== null &&
        ['m4a', 'mp4', 'webm', 'ogg'].includes(String(format.ext)),
    )
    .sort(
      (a, b) =>
        seekable(b) - seekable(a) ||
        (number(b.abr ?? b.tbr) ?? 0) - (number(a.abr ?? a.tbr) ?? 0),
    )[0];
  const videos = formats.filter(
    (format) =>
      format.acodec === 'none' &&
      number(format.height) !== null &&
      number(format.height)! <= maxHeight &&
      formatUrl(format) !== null &&
      ['mp4', 'webm'].includes(String(format.ext)),
  );
  const heights = [
    ...new Set(
      formats
        .filter(
          (format) =>
            format.acodec === 'none' &&
            number(format.height) !== null &&
            formatUrl(format) !== null,
        )
        .map((format) => number(format.height)!)
        .filter((height) => height <= 1080),
    ),
  ].sort((a, b) => b - a);
  const video = videos.sort((a, b) => {
    const h264 = (format: YtDlpFormat) =>
      typeof format.vcodec === 'string' && format.vcodec.startsWith('avc1')
        ? 1
        : 0;
    return (
      seekable(b) - seekable(a) ||
      h264(b) - h264(a) ||
      (number(b.height) ?? 0) - (number(a.height) ?? 0) ||
      (number(b.fps) ?? 0) - (number(a.fps) ?? 0)
    );
  })[0];
  if (!audio || !video) return null;
  const width = number(video.width) ?? 0;
  const height = number(video.height) ?? 0;
  const duration = number(info.duration);
  if (!width || !height || !duration || duration > 24 * 60 * 60) return null;
  return {
    audio,
    video,
    heights,
    width,
    height,
    durationMs: Math.round(duration * 1000),
    mimeType: videoMime(video),
  };
}

export function mediaContentType(
  kind: 'audio' | 'video',
  format: YtDlpFormat,
): string {
  return kind === 'audio' ? audioMime(format) : videoMime(format);
}
