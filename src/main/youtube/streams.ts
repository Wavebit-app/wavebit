import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { app } from 'electron';
import { AppError } from '../../shared/errors';
import type {
  YtResolvedStream,
  YtStreamResolve,
} from '../../shared/schemas/youtube';
import { killTree } from '../process/killTree';
import { isTrustedOrigin } from '../security/origin';
import {
  mediaContentType,
  mediaRangeAllowed,
  leaseActive,
  mayReleaseLease,
  selectFormats,
  streamResolverArgs,
  STREAM_LEASE_MS,
  STREAM_OUTPUT_LIMIT,
  STREAM_RESOLVE_TIMEOUT_MS,
  streamUrlAllowed,
  type YtDlpInfo,
} from './streamRules';

type StreamKind = 'audio' | 'video';

interface Lease {
  ownerId: number;
  expiresAt: number;
  audioUrl: string;
  videoUrl: string;
  audioType: string;
  videoType: string;
  width: number;
  height: number;
}

interface ResolveRun {
  ownerId: number;
  child: ChildProcess | null;
  cancelled: boolean;
  cancel(): void;
}

const leases = new Map<string, Lease>();
const resolving = new Map<string, ResolveRun>();
const MAX_RESOLVERS = 2;
const STDERR_LIMIT = 8 * 1024;
const MAX_REDIRECTS = 5;
const PROXY_ENV = [
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
];

const userPath = (name: string) => path.join(app.getPath('userData'), name);

function tool(name: string): string {
  const dir = app.isPackaged
    ? path.join(process.resourcesPath, 'tools')
    : path.join(app.getAppPath(), 'tools');
  return path.join(dir, process.platform === 'win32' ? `${name}.exe` : name);
}

function prune(): void {
  const now = Date.now();
  for (const [id, lease] of leases)
    if (!leaseActive(lease.expiresAt, now)) leases.delete(id);
}

const leaseSweep = setInterval(prune, 60_000);
leaseSweep.unref();

function runResolver(
  videoId: string,
  requestId: string,
  ownerId: number,
): Promise<YtDlpInfo> {
  const env: NodeJS.ProcessEnv = {
    PATH: '',
    HOME: userPath('yt-dlp-home'),
    DENO_NO_UPDATE_CHECK: '1',
  };
  for (const name of PROXY_ENV)
    if (process.env[name]) env[name] = process.env[name];

  let runRef: ResolveRun | null = null;
  return new Promise<YtDlpInfo>((resolve, reject) => {
    let settled = false;
    let stdout = '';
    let stderr = '';
    const run: ResolveRun = {
      ownerId,
      child: null,
      cancelled: false,
      cancel() {
        run.cancelled = true;
        if (run.child) killTree(run.child);
      },
    };
    runRef = run;
    const finishError = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    const args = streamResolverArgs({
      videoId,
      denoPath: tool('deno'),
    });
    const child = spawn(tool('yt-dlp'), args, {
      cwd: app.getPath('userData'),
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    run.child = child;
    resolving.set(requestId, run);
    const timer = setTimeout(() => {
      run.cancel();
      finishError(new AppError('timed_out'));
    }, STREAM_RESOLVE_TIMEOUT_MS);
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
      if (Buffer.byteLength(stdout, 'utf8') > STREAM_OUTPUT_LIMIT) {
        run.cancel();
        finishError(new AppError('failed'));
      }
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-STDERR_LIMIT);
    });
    child.once('error', () => finishError(new AppError('network')));
    child.once('close', (code) => {
      if (run.cancelled) {
        finishError(new AppError('cancelled'));
        return;
      }
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        // Keep stderr out of IPC and logs; yt-dlp output can contain CDN URLs.
        console.warn(
          `youtube: stream resolver exited with status ${String(code)} (${stderr.length} diagnostic bytes)`,
        );
        reject(
          new AppError(
            /network|timed out|connection/i.test(stderr)
              ? 'network'
              : 'changed',
          ),
        );
        return;
      }
      try {
        resolve(JSON.parse(stdout) as YtDlpInfo);
      } catch {
        reject(new AppError('changed'));
      }
    });
  }).finally(() => {
    if (runRef && resolving.get(requestId) === runRef)
      resolving.delete(requestId);
  });
}

export async function resolveStream(
  input: YtStreamResolve,
  ownerId: number,
): Promise<YtResolvedStream> {
  const previous = resolving.get(input.requestId);
  if (previous?.ownerId === ownerId) {
    previous.cancel();
    resolving.delete(input.requestId);
  } else if (previous) throw new AppError('failed');
  if (resolving.size >= MAX_RESOLVERS) throw new AppError('rate_limited');
  prune();
  const info = await runResolver(input.videoId, input.requestId, ownerId);
  const selected = selectFormats(info, input.videoId, input.maxHeight);
  if (!selected) throw new AppError('changed');
  const audioUrl = selected.audio.url;
  const videoUrl = selected.video.url;
  if (!streamUrlAllowed(audioUrl) || !streamUrlAllowed(videoUrl))
    throw new AppError('changed');
  if (leases.size >= 100) prune();
  if (leases.size >= 100) throw new AppError('rate_limited');
  const leaseId = randomUUID();
  leases.set(leaseId, {
    ownerId,
    expiresAt: Date.now() + STREAM_LEASE_MS,
    audioUrl,
    videoUrl,
    audioType: mediaContentType('audio', selected.audio),
    videoType: selected.mimeType,
    width: selected.width,
    height: selected.height,
  });
  return {
    leaseId,
    audioUrl: `media://stream/${leaseId}/audio`,
    videoUrl: `media://stream/${leaseId}/video`,
    durationMs: selected.durationMs,
    width: selected.width,
    height: selected.height,
    mimeType: selected.mimeType,
    heights: selected.heights,
  };
}

app.on('before-quit', () => {
  clearInterval(leaseSweep);
  for (const run of resolving.values()) run.cancel();
  resolving.clear();
  leases.clear();
});

export function releaseStream(
  ownerId: number,
  requestId: string | null,
  leaseId: string | null,
): void {
  if (requestId) {
    const run = resolving.get(requestId);
    if (run && mayReleaseLease(run.ownerId, ownerId)) run.cancel();
  }
  if (leaseId) {
    const lease = leases.get(leaseId);
    if (lease && mayReleaseLease(lease.ownerId, ownerId))
      leases.delete(leaseId);
  }
}

async function fetchAllowed(
  url: string,
  range: string | null,
  signal: AbortSignal,
): Promise<Response> {
  let current = url;
  for (let count = 0; count <= MAX_REDIRECTS; count++) {
    if (!streamUrlAllowed(current)) throw new AppError('changed');
    const response = await fetch(current, {
      method: 'GET',
      redirect: 'manual',
      cache: 'no-store',
      credentials: 'omit',
      signal,
      headers: range ? { Range: range } : {},
    });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get('Location');
    if (!location || count === MAX_REDIRECTS) throw new AppError('network');
    const next = new URL(location, current).toString();
    if (!streamUrlAllowed(next)) throw new AppError('changed');
    current = next;
  }
  throw new AppError('network');
}

/** Main-process range proxy for one opaque audio/video lease. */
export async function streamMedia(
  request: Request,
  leaseId: string,
  kind: StreamKind,
): Promise<Response> {
  const origin = request.headers.get('Origin');
  if (!origin || !isTrustedOrigin(origin))
    return new Response('Forbidden', { status: 403 });
  if (request.method !== 'GET' && request.method !== 'HEAD')
    return new Response('Method not allowed', { status: 405 });
  const range = request.headers.get('Range');
  if (!mediaRangeAllowed(range))
    return new Response('Range not satisfiable', { status: 416 });
  prune();
  const lease = leases.get(leaseId);
  if (!lease || !leaseActive(lease.expiresAt, Date.now()))
    return new Response('Gone', { status: 410 });
  const upstreamUrl = kind === 'audio' ? lease.audioUrl : lease.videoUrl;
  if (!streamUrlAllowed(upstreamUrl))
    return new Response('Gone', { status: 410 });
  try {
    const upstream = await fetchAllowed(
      upstreamUrl,
      range,
      AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]),
    );
    const headers = new Headers({
      'Content-Type': kind === 'audio' ? lease.audioType : lease.videoType,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Access-Control-Allow-Origin': origin,
      Vary: 'Origin',
    });
    for (const name of ['Content-Length', 'Content-Range', 'Accept-Ranges']) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    const status = [200, 206, 416, 403, 404, 410].includes(upstream.status)
      ? upstream.status
      : 502;
    return new Response(request.method === 'HEAD' ? null : upstream.body, {
      status,
      headers,
    });
  } catch {
    return new Response('Stream unavailable', { status: 502 });
  }
}
