import { AppError } from '../../shared/errors';
import { obj, readJson, str, type Json } from '../spotify/json';
import {
  MUSIC_ORIGIN,
  sapisid,
  sapisidHash,
  sessionFingerprint,
  youtube,
} from './session';

const API = `${MUSIC_ORIGIN}/youtubei/v1`;
/** WEB_REMIX, YouTube Music's web client. Its id and a fallback version (BitChord's Innertube.kt). */
const CLIENT_ID = '67';
const FALLBACK_VERSION = '1.20250101.01.00';
const SCOPE_TTL_MS = 10 * 60_000;
/** The music.youtube.com page is ~1 MB; anything far past that isn't the page. */
const MAX_SHELL = 6 * 1024 * 1024;

/** What the music.youtube.com page says about this session (its `ytcfg`). */
interface Scope {
  fingerprint: string | null;
  loggedIn: boolean;
  clientVersion: string;
  visitorData: string | null;
  /** Which Google login in the jar (`X-Goog-AuthUser`). */
  authUser: string;
  /** A brand channel (`X-Goog-PageId`), when one is selected. */
  pageId: string | null;
  at: number;
}

let scope: Scope | null = null;
let pending: Promise<Scope> | null = null;
let blockedUntil = 0;

const cfg = (html: string, key: string): string | null =>
  new RegExp(`"${key}"\\s*:\\s*"?([^",}]+)"?`).exec(html)?.[1] ?? null;

/**
 * Reads the page's own config, as BitChord's `fetchSessionScope` does: one
 * GET of music.youtube.com with the session, values read by regex. A page that
 * says it is signed out has a dead cookie or none; nothing account-specific
 * is sent then.
 */
async function readScope(fingerprint: string | null): Promise<Scope> {
  const response = await youtube()
    .session.fetch(`${MUSIC_ORIGIN}/`, {
      credentials: 'include',
      headers: { Accept: 'text/html' },
    })
    .catch(() => {
      throw new AppError('network');
    });
  const html = response.ok ? await response.text().catch(() => '') : '';
  const page = html.length <= MAX_SHELL ? html : '';
  const loggedIn = cfg(page, 'LOGGED_IN') === 'true';
  return {
    fingerprint,
    loggedIn,
    clientVersion: cfg(page, 'INNERTUBE_CLIENT_VERSION') ?? FALLBACK_VERSION,
    visitorData: cfg(page, 'VISITOR_DATA'),
    authUser: (loggedIn && cfg(page, 'SESSION_INDEX')) || '0',
    pageId: (loggedIn && cfg(page, 'DELEGATED_SESSION_ID')) || null,
    at: Date.now(),
  };
}

/** The current scope; one page read at a time, kept 10 minutes or until the account changes. */
export async function sessionScope(): Promise<Scope> {
  const fingerprint = await sessionFingerprint();
  if (
    scope &&
    scope.fingerprint === fingerprint &&
    Date.now() - scope.at < SCOPE_TTL_MS
  )
    return scope;
  pending ??= readScope(fingerprint)
    .then((fresh) => (scope = fresh))
    .finally(() => (pending = null));
  return pending;
}

export function forgetScope(): void {
  scope = null;
}

/**
 * One InnerTube call as YouTube Music's web client. Signed in, the session's
 * cookies ride along and the request carries a fresh SAPISIDHASH; signed out
 * it is the anonymous web client. A 429 holds every call until Retry-After.
 */
export async function innertube(
  endpoint:
    | 'browse'
    | 'search'
    | 'next'
    | 'account/account_menu'
    | 'like/like'
    | 'like/removelike',
  body: Json,
  query: Record<string, string> = {},
): Promise<Json> {
  if (Date.now() < blockedUntil) throw new AppError('rate_limited');
  const s = await sessionScope();
  const secret = s.loggedIn ? await sapisid() : null;
  const url = new URL(`${API}/${endpoint}`);
  url.searchParams.set('prettyPrint', 'false');
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  let response: Response;
  try {
    response = await youtube().session.fetch(url.href, {
      method: 'POST',
      credentials: secret ? 'include' : 'omit',
      redirect: 'error',
      headers: {
        'Content-Type': 'application/json',
        Origin: MUSIC_ORIGIN,
        'X-Origin': MUSIC_ORIGIN,
        Referer: `${MUSIC_ORIGIN}/`,
        'X-YouTube-Client-Name': CLIENT_ID,
        'X-YouTube-Client-Version': s.clientVersion,
        ...(s.visitorData && { 'X-Goog-Visitor-Id': s.visitorData }),
        ...(secret && {
          Authorization: sapisidHash(secret),
          'X-Goog-AuthUser': s.authUser,
          ...(s.pageId && { 'X-Goog-PageId': s.pageId }),
        }),
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'WEB_REMIX',
            clientVersion: s.clientVersion,
            hl: 'en',
            ...(s.visitorData && { visitorData: s.visitorData }),
          },
          user: { lockedSafetyMode: false },
          request: { useSsl: true },
        },
        ...body,
      }),
    });
  } catch {
    throw new AppError('network');
  }
  if (response.status === 429) {
    const wait = Number(response.headers.get('Retry-After'));
    blockedUntil =
      Date.now() + (Number.isFinite(wait) && wait > 0 ? wait : 60) * 1000;
    throw new AppError('rate_limited');
  }
  if (response.status === 401 || response.status === 403) {
    // The page's account index or channel may have moved: read it again next time.
    forgetScope();
    throw new AppError(secret ? 'signed_out' : 'network');
  }
  if (!response.ok) throw new AppError('network');
  const json = await readJson(response);
  if (!json) throw new AppError('changed');
  // The first anonymous answer mints a visitor id; later calls reuse it.
  const visitor = str(obj(json.responseContext)?.visitorData);
  if (visitor && !s.visitorData) s.visitorData = visitor;
  return json;
}
