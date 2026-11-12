import { app, safeStorage, shell } from 'electron';
import { createHash, randomBytes } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import { AppError } from '../../shared/errors';
import type { ErrorCode } from '../../shared/schemas/spotify';
import { obj, readJson, str, num } from '../spotify/json';
import { storageKind } from '../services/storageBackend';

/**
 * Signing in to Google the way Google supports for desktop apps: its own
 * page in the default browser, a loopback redirect to 127.0.0.1 and PKCE
 * (RFC 8252). It needs an OAuth client of the person's own (Google Cloud
 * Console › Credentials › Desktop app), entered in Settings › YouTube Music.
 * The client and the refresh token are encrypted with the OS keyring
 * (safeStorage) and never leave the main process; without a keyring they are
 * kept in memory until quit.
 */

const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const REVOKE = 'https://oauth2.googleapis.com/revoke';
/** Read-only: playlists, likes and subscriptions. Nothing is written to the account. */
const SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';
const SIGN_IN_TIMEOUT_MS = 5 * 60_000;

interface Stored {
  clientId: string;
  clientSecret: string;
  refreshToken: string | null;
}

let memory: Stored | null = null;
let access: { token: string; expiresAt: number } | null = null;
let pending: { server: Server; cancel: () => void } | null = null;

const file = () => path.join(app.getPath('userData'), 'youtube-oauth.bin');
const persistent = () =>
  storageKind() === 'keyring' && safeStorage.isEncryptionAvailable();

async function load(): Promise<Stored | null> {
  if (memory) return memory;
  if (!persistent()) return null;
  try {
    const raw = safeStorage.decryptString(await readFile(file()));
    const parsed = obj(JSON.parse(raw));
    const clientId = str(parsed?.clientId);
    const clientSecret = str(parsed?.clientSecret);
    if (!clientId || !clientSecret) return null;
    memory = {
      clientId,
      clientSecret,
      refreshToken: str(parsed?.refreshToken),
    };
    return memory;
  } catch {
    return null;
  }
}

async function save(next: Stored | null): Promise<void> {
  memory = next;
  access = null;
  if (!persistent()) return;
  if (!next) {
    await rm(file(), { force: true });
    return;
  }
  await writeFile(file(), safeStorage.encryptString(JSON.stringify(next)), {
    mode: 0o600,
  });
}

export async function oauthStatus(): Promise<{
  configured: boolean;
  signedIn: boolean;
  signingIn: boolean;
}> {
  const stored = await load();
  return {
    configured: !!stored,
    signedIn: !!stored?.refreshToken,
    signingIn: pending !== null,
  };
}

/** Stores the person's own OAuth client; a new client signs the old account out. */
export async function configure(
  clientId: string,
  clientSecret: string,
): Promise<void> {
  const current = await load();
  await save({
    clientId,
    clientSecret,
    refreshToken: current?.clientId === clientId ? current.refreshToken : null,
  });
}

async function tokenRequest(params: Record<string, string>): Promise<{
  accessToken: string;
  expiresIn: number;
  refreshToken: string | null;
}> {
  let response: Response;
  try {
    response = await fetch(TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
      redirect: 'error',
    });
  } catch {
    throw new AppError('network');
  }
  const body = await readJson(response);
  const accessToken = str(body?.access_token);
  if (!response.ok || !accessToken) {
    const error = str(body?.error);
    // Google's own code only (never the request), so the log says why.
    console.warn(`youtube oauth: token endpoint ${response.status} ${error}`);
    throw new AppError(tokenError(response.status, error));
  }
  return {
    accessToken,
    expiresIn: num(body?.expires_in) ?? 3600,
    refreshToken: str(body?.refresh_token),
  };
}

/**
 * What a refused token request means. A refused client answers 401
 * `invalid_client`; a revoked or expired grant answers 400 `invalid_grant`.
 */
function tokenError(status: number, error: string | null): ErrorCode {
  if (
    status === 401 ||
    error === 'invalid_client' ||
    error === 'unauthorized_client' ||
    error === 'deleted_client'
  )
    return 'bad_client';
  if (error === 'invalid_grant') return 'signed_out';
  if (status === 429) return 'rate_limited';
  return status >= 500 ? 'network' : 'failed';
}

const base64url = (b: Buffer) => b.toString('base64url');

/**
 * Opens Google's sign-in page in the default browser and waits (5 minutes at
 * most) for it to come back to http://127.0.0.1:<port>/callback with a code.
 */
export async function signInWithBrowser(): Promise<void> {
  const stored = await load();
  if (!stored) throw new AppError('failed');
  pending?.cancel();
  const verifier = base64url(randomBytes(48));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  const state = base64url(randomBytes(24));

  const code = await new Promise<{ code: string; redirect: string }>(
    (resolve, reject) => {
      const server = createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        // Without this sign-in's state it isn't Google coming back: any page
        // or program can reach a loopback port, and it must not end the wait.
        if (
          url.pathname !== '/callback' ||
          url.searchParams.get('state') !== state
        ) {
          res.writeHead(404).end();
          return;
        }
        const got = url.searchParams.get('code');
        const refused = url.searchParams.get('error');
        if (refused)
          console.warn(`youtube oauth: sign-in page said ${refused}`);
        res
          .writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Content-Security-Policy': "default-src 'none'",
          })
          .end(
            got
              ? '<!doctype html><title>wavebit</title><p style="font:16px system-ui;margin:40px">Signed in. You can close this tab and go back to wavebit.</p>'
              : '<!doctype html><title>wavebit</title><p style="font:16px system-ui;margin:40px">Signing in didn’t finish. Go back to wavebit and try again.</p>',
          );
        finish(
          got
            ? null
            : new AppError(refused === 'access_denied' ? 'denied' : 'failed'),
          got,
        );
      });
      // Set once listening. The token request must repeat it exactly, and a
      // closed server has no address any more, so it is never read again.
      let redirect = '';
      const timer = setTimeout(
        () => finish(new AppError('timed_out'), null),
        SIGN_IN_TIMEOUT_MS,
      );
      const finish = (error: AppError | null, got: string | null) => {
        clearTimeout(timer);
        server.close();
        pending = null;
        if (error || !got) reject(error ?? new AppError('cancelled'));
        else resolve({ code: got, redirect });
      };
      pending = {
        server,
        cancel: () => finish(new AppError('cancelled'), null),
      };
      // Loopback only, on a port the OS picks.
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address !== 'object') {
          finish(new AppError('failed'), null);
          return;
        }
        redirect = `http://127.0.0.1:${address.port}/callback`;
        const params = new URLSearchParams({
          client_id: stored.clientId,
          redirect_uri: redirect,
          response_type: 'code',
          scope: SCOPE,
          code_challenge: challenge,
          code_challenge_method: 'S256',
          state,
          access_type: 'offline',
          prompt: 'consent',
        });
        void shell.openExternal(`${AUTH}?${params}`);
      });
    },
  );

  const tokens = await tokenRequest({
    client_id: stored.clientId,
    client_secret: stored.clientSecret,
    code: code.code,
    code_verifier: verifier,
    grant_type: 'authorization_code',
    redirect_uri: code.redirect,
  });
  // Google sends a refresh token with prompt=consent; keep the old one if not.
  const refreshToken = tokens.refreshToken ?? stored.refreshToken;
  if (!refreshToken) throw new AppError('failed');
  await save({ ...stored, refreshToken });
  access = {
    token: tokens.accessToken,
    expiresAt: Date.now() + tokens.expiresIn * 1000,
  };
}

export function cancelBrowserSignIn(): void {
  pending?.cancel();
}

/** A valid access token, refreshed a minute before it expires. Main process only. */
export async function accessToken(): Promise<string> {
  if (access && access.expiresAt - 60_000 > Date.now()) return access.token;
  const stored = await load();
  if (!stored?.refreshToken) throw new AppError('signed_out');
  let fresh: Awaited<ReturnType<typeof tokenRequest>>;
  try {
    fresh = await tokenRequest({
      client_id: stored.clientId,
      client_secret: stored.clientSecret,
      refresh_token: stored.refreshToken,
      grant_type: 'refresh_token',
    });
  } catch (error) {
    // A revoked or expired grant won't come back: show signed out, not stuck.
    if (error instanceof AppError && error.code === 'signed_out')
      await save({ ...stored, refreshToken: null });
    throw error;
  }
  access = {
    token: fresh.accessToken,
    expiresAt: Date.now() + fresh.expiresIn * 1000,
  };
  return access.token;
}

/** Revokes the grant at Google and forgets it here; the client stays configured. */
export async function signOutBrowser(): Promise<void> {
  const stored = await load();
  if (stored?.refreshToken)
    await fetch(REVOKE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: stored.refreshToken }),
    }).catch(() => {});
  if (stored) await save({ ...stored, refreshToken: null });
}
