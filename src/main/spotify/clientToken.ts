import { randomBytes } from 'node:crypto';
import { cached, store } from '../services/cache';
import { at, num, readJson, str } from './json';
import { spotify } from './session';
import { tokenClientId } from './token';
import { webPlayer } from './webPlayer';

const CLIENT_TOKEN = 'https://clienttoken.spotify.com/v1/clienttoken';
const DEVICE_KEY = 'device:spotify';
const TEN_YEARS_S = 10 * 365 * 24 * 60 * 60;

let current: { token: string; expiresAt: number } | null = null;
let pending: Promise<string | null> | null = null;

/** One random id per installation, like a browser's; never tied to the account. */
function deviceId(): string {
  const known = cached<string>(DEVICE_KEY);
  if (known) return known;
  const fresh = randomBytes(16).toString('hex');
  store(DEVICE_KEY, fresh, TEN_YEARS_S);
  return fresh;
}

const OS: Record<string, string> = {
  win32: 'windows',
  darwin: 'macos',
  linux: 'linux',
};

async function mint(): Promise<string | null> {
  const clientId = tokenClientId();
  if (!clientId) return null;
  const { clientVersion } = await webPlayer();
  const response = await spotify().session.fetch(CLIENT_TOKEN, {
    method: 'POST',
    // The bare type, deliberately: clienttoken answers 400 to a charset suffix (BitChord).
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_data: {
        client_version: clientVersion,
        client_id: clientId,
        js_sdk_data: {
          device_brand: 'unknown',
          device_model: 'unknown',
          os: OS[process.platform] ?? 'unknown',
          os_version: 'unknown',
          device_id: deviceId(),
          device_type: 'computer',
        },
      },
    }),
  });
  const body = await readJson(response);
  const token = str(at(body, 'granted_token', 'token'));
  if (str(body?.response_type) !== 'RESPONSE_GRANTED_TOKEN_RESPONSE' || !token)
    return null;
  const ttl = num(at(body, 'granted_token', 'expires_after_seconds')) ?? 3600;
  current = { token, expiresAt: Date.now() + ttl * 1000 };
  return token;
}

/**
 * Spotify's per-device token. Best effort, as in BitChord: calls go without it
 * when minting fails, and one mint is shared by every caller.
 */
export async function clientToken(): Promise<string | null> {
  if (current && Date.now() < current.expiresAt - 30_000) return current.token;
  pending ??= mint()
    .catch(() => null)
    .finally(() => (pending = null));
  return pending;
}

export function forgetClientToken(): void {
  current = null;
}
