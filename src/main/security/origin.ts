import { app } from 'electron';

/** The local app origin, or the active dev server origin in unpackaged runs. */
export function isTrustedOrigin(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'app:' && parsed.host === 'wavebit') return true;
    return (
      !app.isPackaged &&
      !!MAIN_WINDOW_VITE_DEV_SERVER_URL &&
      parsed.origin === new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL).origin
    );
  } catch {
    return false;
  }
}
