import { BrowserWindow } from 'electron';
import { z } from 'zod';
import { AppError } from '../../shared/errors';
import { sessionFingerprint, spotify, WEB_PLAYER } from './session';

const HARVEST_TIMEOUT_MS = 30_000;
/**
 * A freshly started web player can answer anonymously before it has read its
 * session; its signed-in token follows. Only an anonymous answer with nothing
 * better this long after it means signed out.
 */
const ANONYMOUS_GRACE_MS = 8_000;
/** Renew this long before the token expires instead of waiting for a 401. */
const EARLY_MS = 60_000;

const TokenSchema = z.object({
  accessToken: z.string().min(1),
  accessTokenExpirationTimestampMs: z.number(),
  isAnonymous: z.boolean(),
  clientId: z.string().optional(),
});

interface Token {
  value: string;
  expiresAt: number;
  fingerprint: string;
  clientId: string | null;
}

let cached: Token | null = null;
let pending: Promise<Token> | null = null;

/**
 * Loads the real web player in a hidden window and reads the token from its
 * own /api/token response through the DevTools protocol. Nothing is injected
 * into Spotify's page, and the window is destroyed as soon as the token
 * arrives. This is the method BitChord's Android app uses.
 */
function harvest(fingerprint: string): Promise<Token> {
  const win = new BrowserWindow({
    show: false,
    width: 1024,
    height: 720,
    webPreferences: {
      // Offscreen, the page counts as visible (a hidden window doesn't), so the
      // web player boots and asks for its token, and nothing appears on screen.
      offscreen: true,
      session: spotify().session,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      backgroundThrottling: false,
    },
  });
  const contents = win.webContents;
  contents.setAudioMuted(true);
  const dbg = contents.debugger;
  const tokenRequests = new Set<string>();

  let grace: ReturnType<typeof setTimeout> | undefined;
  return new Promise<Token>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new AppError('timed_out')),
      HARVEST_TIMEOUT_MS,
    );
    dbg.on('message', (_event, method, params: Record<string, unknown>) => {
      if (method === 'Network.responseReceived') {
        const response = params.response as { url?: string } | undefined;
        if (response?.url?.startsWith(`${WEB_PLAYER}/api/token`))
          tokenRequests.add(params.requestId as string);
      } else if (
        method === 'Network.loadingFinished' &&
        tokenRequests.has(params.requestId as string)
      ) {
        void (
          dbg.sendCommand('Network.getResponseBody', {
            requestId: params.requestId,
          }) as Promise<{
            body: string;
          }>
        )
          .then(({ body }) => {
            const token = TokenSchema.parse(JSON.parse(body));
            if (token.isAnonymous) {
              grace ??= setTimeout(
                () => reject(new AppError('signed_out')),
                ANONYMOUS_GRACE_MS,
              );
              return;
            }
            clearTimeout(timer);
            clearTimeout(grace);
            // Spotify may have refreshed the cookie while the player loaded:
            // write it out now, so a hard stop can't leave a stale one on disk.
            void spotify()
              .session.cookies.flushStore()
              .catch(() => {});
            resolve({
              value: token.accessToken,
              expiresAt: token.accessTokenExpirationTimestampMs,
              fingerprint,
              clientId: token.clientId ?? null,
            });
          })
          .catch((error: unknown) => {
            clearTimeout(timer);
            reject(error instanceof AppError ? error : new AppError('changed'));
          });
      }
    });
    try {
      dbg.attach('1.3');
    } catch {
      clearTimeout(timer);
      reject(new AppError('changed'));
      return;
    }
    // As in the login window: a redirect rejects loadURL with ERR_ABORTED, so
    // only a main-frame load that really failed counts as a network error.
    contents.on('did-fail-load', (_e, code, _desc, _url, isMainFrame) => {
      if (!isMainFrame || code === -3) return;
      clearTimeout(timer);
      reject(new AppError('network'));
    });
    // A fresh webContents has no renderer until it loads something, and
    // Network.enable waits for one; about:blank creates it, then the web player loads.
    void contents
      .loadURL('about:blank')
      .then(() => dbg.sendCommand('Network.enable'))
      .then(() => contents.loadURL(`${WEB_PLAYER}/`).catch(() => {}))
      .catch(() => {
        clearTimeout(timer);
        reject(new AppError('changed'));
      });
  }).finally(() => {
    clearTimeout(grace);
    if (!win.isDestroyed()) win.destroy();
  });
}

/** A valid bearer for the signed-in account. Concurrent callers share one harvest. */
export async function accessToken(): Promise<string> {
  const fingerprint = await sessionFingerprint();
  if (!fingerprint) {
    cached = null;
    throw new AppError('signed_out');
  }
  // A token minted for another account is never reused (BitChord's check).
  if (
    cached &&
    cached.fingerprint === fingerprint &&
    cached.expiresAt - EARLY_MS > Date.now()
  )
    return cached.value;
  pending ??= harvest(fingerprint)
    .then((token) => (cached = token))
    .finally(() => (pending = null));
  return (await pending).value;
}

/** The web player's client id from its last token, which the client-token call needs. */
export function tokenClientId(): string | null {
  return cached?.clientId ?? null;
}

export function forgetToken(): void {
  cached = null;
}
