import { app, net, protocol } from 'electron';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { cachedImage } from '../services/artCache';
import { artUrlFromPath, mediaCors } from './urls';

export const APP_SCHEME = 'app';
export const APP_HOST = 'wavebit';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
export const MEDIA_SCHEME = 'media';

export function isTrustedOrigin(url: string): boolean {
  try {
    const parsed = new URL(url);
    // Node reports the origin of a custom scheme as "null", so compare parts.
    if (parsed.protocol === `${APP_SCHEME}:` && parsed.host === APP_HOST)
      return true;
    return (
      !app.isPackaged &&
      !!MAIN_WINDOW_VITE_DEV_SERVER_URL &&
      parsed.origin === new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL).origin
    );
  } catch {
    return false;
  }
}

// The renderer talks to the main process over IPC, so it needs no network
// access of its own. Spotify and YouTube artwork hosts are allowed for <img> only.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: ${MEDIA_SCHEME}: https://*.scdn.co https://*.spotifycdn.com https://*.googleusercontent.com https://*.ggpht.com https://*.ytimg.com`,
  "font-src 'self' data:",
  "connect-src 'self'",
  // Spotify Canvas clips come from canvaz.scdn.co (Settings › Spotify › Canvas).
  `media-src 'self' ${MEDIA_SCHEME}: https://*.scdn.co`,
  // YouTube's official embedded player, for songs wavebit has no file for.
  'frame-src https://www.youtube-nocookie.com',
  "worker-src 'none'",
  "manifest-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

/** Must run before `app.whenReady()`. */
export function registerSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        codeCache: true,
      },
    },
    // stream: lets <audio> seek with Range requests.
    {
      scheme: MEDIA_SCHEME,
      // corsEnabled: Web Audio (crossfade, normalisation) only reads CORS-clean media.
      privileges: {
        standard: true,
        secure: true,
        stream: true,
        corsEnabled: true,
      },
    },
  ]);
}

/**
 * Serves the built renderer from `root` as app://wavebit/… instead of file://,
 * so the page gets a real origin, a CSP header and no filesystem reach.
 */
export function serveRenderer(root: string): void {
  protocol.handle(APP_SCHEME, async (request) => {
    const { host, pathname } = new URL(request.url);
    if (host !== APP_HOST) return new Response('Not found', { status: 404 });

    let relative: string;
    try {
      relative = decodeURIComponent(
        pathname === '/' ? '/index.html' : pathname,
      );
    } catch {
      return new Response('Bad request', { status: 400 });
    }
    const file = path.normalize(path.join(root, relative));
    if (!file.startsWith(root + path.sep))
      return new Response('Forbidden', { status: 403 });

    try {
      const response = await net.fetch(pathToFileURL(file).toString());
      const headers = new Headers(response.headers);
      headers.set('Content-Security-Policy', CSP);
      headers.set('X-Content-Type-Options', 'nosniff');
      // The YouTube embed shares this session; it can't load the app's files.
      headers.set('Cross-Origin-Resource-Policy', 'same-origin');
      return new Response(response.body, { status: response.status, headers });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

const AUDIO_TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
  '.webm': 'audio/webm',
};

export interface MediaSource {
  trackPath(id: string): string | null;
  artwork(albumKey: string): { mime: string; data: Buffer } | null;
}

const ID = /^[0-9a-f]{16}$/;

/** Parses `bytes=start-end` against a file size. Null means "not satisfiable". */
export function parseRange(
  header: string | null,
  size: number,
): [number, number] | null {
  const match = header && /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match) return [0, size - 1];
  const [, from, to] = match;
  if (!from && !to) return null;
  // `bytes=-500` is the last 500 bytes.
  const start = from ? Number(from) : Math.max(0, size - Number(to));
  const end = from && to ? Math.min(Number(to), size - 1) : size - 1;
  return start <= end && start < size ? [start, end] : null;
}

/**
 * media://track/<id> streams a library file with Range support and
 * media://art/<album key> serves its cover. Only ids from the library are
 * accepted, so the page can never name a path.
 */
export function serveMedia(source: () => MediaSource): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const { host, pathname } = new URL(request.url);
    const id = pathname.slice(1);
    const cors = mediaCors(request.headers.get('Origin'), isTrustedOrigin);
    if (!cors) return new Response('Forbidden', { status: 403 });

    // A remote album cover, kept on disk (services/artCache.ts).
    if (host === 'remote') {
      const url = artUrlFromPath(id);
      const art = url && (await cachedImage(url));
      if (!art) return new Response('Not found', { status: 404 });
      return new Response(new Uint8Array(art.data), {
        headers: {
          'Content-Type': art.mime,
          'Cache-Control': 'max-age=86400',
          'X-Content-Type-Options': 'nosniff',
          ...cors,
        },
      });
    }

    if (!ID.test(id)) return new Response('Not found', { status: 404 });

    if (host === 'art') {
      const art = source().artwork(id);
      if (!art) return new Response('Not found', { status: 404 });
      return new Response(new Uint8Array(art.data), {
        headers: {
          'Content-Type': art.mime,
          'Cache-Control': 'max-age=3600',
          ...cors,
        },
      });
    }
    if (host !== 'track') return new Response('Not found', { status: 404 });

    const file = source().trackPath(id);
    if (!file) return new Response('Not found', { status: 404 });
    let size: number;
    try {
      size = (await fs.stat(file)).size;
    } catch {
      return new Response('Gone', { status: 410 });
    }
    const range = parseRange(request.headers.get('Range'), size);
    if (!range)
      return new Response('Range not satisfiable', {
        status: 416,
        headers: { 'Content-Range': `bytes */${size}` },
      });
    const [start, end] = range;
    const body = Readable.toWeb(
      createReadStream(file, { start, end }),
    ) as ReadableStream;
    const partial = request.headers.has('Range');
    return new Response(body, {
      status: partial ? 206 : 200,
      headers: {
        'Content-Type':
          AUDIO_TYPES[path.extname(file).toLowerCase()] ??
          'application/octet-stream',
        'Content-Length': String(end - start + 1),
        'Accept-Ranges': 'bytes',
        ...cors,
        ...(partial && { 'Content-Range': `bytes ${start}-${end}/${size}` }),
      },
    });
  });
}
