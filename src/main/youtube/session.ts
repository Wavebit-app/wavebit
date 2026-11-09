import { session, type Session } from 'electron';
import { createHash } from 'node:crypto';
import type { SpotifyStorage } from '../../shared/schemas/spotify';
import { hardenSession, markYouTubeSession } from '../security/security';
import { storageKind } from '../services/storageBackend';

export const MUSIC_ORIGIN = 'https://music.youtube.com';

/** The cookies YouTube signs requests with, newest form first (BitChord's SAPISID_NAMES). */
const SAPISID_NAMES = ['SAPISID', '__Secure-3PAPISID', '__Secure-1PAPISID'];

let cached: { session: Session; storage: SpotifyStorage } | null = null;

/**
 * YouTube Music's own partition, apart from the app's and Spotify's. With a
 * keyring its cookies persist, encrypted by Chromium; without one they live
 * in memory and go when wavebit quits.
 */
export function youtube(): { session: Session; storage: SpotifyStorage } {
  if (cached) return cached;
  const storage = storageKind();
  const ses = session.fromPartition(
    storage === 'keyring' ? 'persist:youtube' : 'youtube',
  );
  hardenSession(ses);
  markYouTubeSession(ses);
  // Google refuses sign-in to browsers it takes for embedded ones; drop the
  // Electron and app tokens so the session reads as the Chrome it runs on.
  ses.setUserAgent(
    ses.getUserAgent().replace(/\s(?:Electron|wavebit)\/\S+/g, ''),
  );
  cached = { session: ses, storage };
  return cached;
}

/** The signing secret, read in the main process only. Never logged, never sent over IPC. */
export async function sapisid(): Promise<string | null> {
  const cookies = await youtube().session.cookies.get({
    url: `${MUSIC_ORIGIN}/`,
  });
  for (const name of SAPISID_NAMES) {
    const value = cookies.find((c) => c.name === name)?.value;
    if (value) return value;
  }
  return null;
}

/** A hash of the signing cookie, or null when signed out: the cache key for this account. */
export async function sessionFingerprint(): Promise<string | null> {
  const secret = await sapisid();
  return secret
    ? createHash('sha256').update(secret).digest('hex').slice(0, 16)
    : null;
}

/**
 * Google's SAPISIDHASH: `<seconds>_<sha1("<seconds> <SAPISID> <origin>")>`.
 * The one header that turns a cookie-carrying request into a signed-in one.
 */
export function sapisidHash(secret: string, now = Date.now()): string {
  const seconds = Math.floor(now / 1000);
  const digest = createHash('sha1')
    .update(`${seconds} ${secret} ${MUSIC_ORIGIN}`)
    .digest('hex');
  return `SAPISIDHASH ${seconds}_${digest}`;
}
