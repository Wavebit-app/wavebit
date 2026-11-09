import { safeStorage } from 'electron';
import type { SpotifyStorage } from '../../shared/schemas/spotify';

/**
 * Whether the OS can encrypt what Chromium stores (cookies included). On
 * Linux without a keyring, Chromium falls back to `basic_text`, a hard-coded
 * key, so the Spotify session must not outlive the process there.
 * Call after `app.whenReady()`.
 */
export function storageKind(): SpotifyStorage {
  if (process.platform !== 'linux') return 'keyring';
  const backend = safeStorage.getSelectedStorageBackend();
  return backend === 'basic_text' || backend === 'unknown'
    ? 'session'
    : 'keyring';
}
