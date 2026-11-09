import { session, type Session } from 'electron';
import { createHash } from 'node:crypto';
import type { SpotifyStorage } from '../../shared/schemas/spotify';
import { hardenSession, markSpotifySession } from '../security/security';
import { storageKind } from '../services/storageBackend';

export const WEB_PLAYER = 'https://open.spotify.com';

let cached: { session: Session; storage: SpotifyStorage } | null = null;

/**
 * Spotify's own partition, apart from the app's. With a keyring its cookies
 * persist (encrypted by Chromium with the OS key); without one they live in
 * memory and go when wavebit quits.
 */
export function spotify(): { session: Session; storage: SpotifyStorage } {
  if (cached) return cached;
  const storage = storageKind();
  const ses = session.fromPartition(
    storage === 'keyring' ? 'persist:spotify' : 'spotify',
  );
  hardenSession(ses);
  markSpotifySession(ses);
  // Spotify serves its web player to browsers; drop the Electron and app tokens.
  ses.setUserAgent(
    ses.getUserAgent().replace(/\s(?:Electron|wavebit)\/\S+/g, ''),
  );
  cached = { session: ses, storage };
  return cached;
}

/** A hash of the session cookie, or null when signed out. The cookie itself never leaves here. */
export async function sessionFingerprint(): Promise<string | null> {
  const [cookie] = await spotify().session.cookies.get({
    url: `${WEB_PLAYER}/`,
    name: 'sp_dc',
  });
  return cookie?.value
    ? createHash('sha256').update(cookie.value).digest('hex')
    : null;
}

export async function clearSpotifySession(): Promise<void> {
  const ses = spotify().session;
  await ses.clearStorageData();
  await ses.clearCache();
}
