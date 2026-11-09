import Store from 'electron-store';
import { z } from 'zod';
import {
  DEFAULT_SETTINGS,
  SettingsSchema,
  type Settings,
  type SettingsPatch,
} from '../../shared/schemas/settings';

// Opened on first use, so a test profile set in main.ts applies before the path is read.
let opened: Store<Settings> | null = null;
const store = () =>
  (opened ??= new Store<Settings>({
    name: 'settings',
    defaults: DEFAULT_SETTINGS,
    clearInvalidConfig: true,
  }));

// Not strict: settings written by an older version may carry retired keys.
const Lenient = z.object(SettingsSchema.shape);

const listeners = new Set<(settings: Settings) => void>();

export function readSettings(): Settings {
  const parsed = Lenient.safeParse({ ...DEFAULT_SETTINGS, ...store().store });
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

/** Writes a patch. Only the main process may pass `libraryFolders`, `downloadFolder` and `importedPlaylists`. */
export function writeSettings(
  patch: SettingsPatch &
    Partial<
      Pick<Settings, 'libraryFolders' | 'downloadFolder' | 'importedPlaylists'>
    >,
): Settings {
  const next = SettingsSchema.parse({ ...readSettings(), ...patch });
  store().store = next;
  for (const listener of listeners) listener(next);
  return next;
}

export function onSettingsChange(listener: (settings: Settings) => void): void {
  listeners.add(listener);
}
