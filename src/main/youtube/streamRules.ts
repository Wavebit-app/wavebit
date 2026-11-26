import { onDomain } from '../security/urls.ts';

export const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
export const STREAM_HOSTS = ['googlevideo.com'] as const;
export const STREAM_LEASE_MS = 10 * 60_000;
export const STREAM_RESOLVE_TIMEOUT_MS = 25_000;
export const STREAM_OUTPUT_LIMIT = 8 * 1024 * 1024;

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

function formatUrl(format: YtDlpFormat): string | null {
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
    .sort((a, b) => {
      const ext = (value: YtDlpFormat) =>
        value.ext === 'm4a' || value.ext === 'mp4' ? 2 : 1;
      return (
        ext(b) - ext(a) ||
        (number(b.abr ?? b.tbr) ?? 0) - (number(a.abr ?? a.tbr) ?? 0)
      );
    })[0];
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
    const mp4 = (format: YtDlpFormat) => (format.ext === 'mp4' ? 1 : 0);
    return (
      h264(b) - h264(a) ||
      mp4(b) - mp4(a) ||
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
