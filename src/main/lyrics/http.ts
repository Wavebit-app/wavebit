import { net } from 'electron';
import { AppError } from '../../shared/errors';
import { boundedText } from '../spotify/json';

/** The only hosts a lyric lookup may reach. */
const HOSTS = new Set([
  'lrc.red',
  'lyrics-api.boidu.dev',
  'unison.boidu.dev',
  'lyricsplus.prjktla.my.id',
  'lyricsplus.binimum.org',
  'mobileservice.kugou.com',
  'lyrics.kugou.com',
]);
/** A source that is down shouldn't hold the lyrics up for long. */
const TIMEOUT_MS = 10_000;

const allowed = (url: string) => {
  const parsed = new URL(url);
  return parsed.protocol === 'https:' && HOSTS.has(parsed.hostname);
};

/** Query parameters with the empty ones left out. */
export function withParams(
  url: string,
  params: Record<string, string | number | null>,
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value !== null && value !== '') query.set(key, String(value));
  return `${url}?${query}`;
}

/** A GET as text. A 404 is a source's "no such song", so it is null, not a failure. */
export async function getText(url: string): Promise<string | null> {
  if (!allowed(url)) throw new AppError('network');
  let response: Response;
  try {
    response = await net.fetch(url, {
      headers: { 'User-Agent': 'wavebit (desktop music player)' },
      // A redirect could leave HOSTS, so one is a failure.
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new AppError('network');
  }
  if (response.status === 404) return null;
  if (response.status === 429) throw new AppError('rate_limited');
  if (!response.ok) throw new AppError('network');
  return boundedText(response).catch(() => {
    throw new AppError('network');
  });
}

export async function getJson(url: string): Promise<unknown> {
  const text = await getText(url);
  if (text === null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
