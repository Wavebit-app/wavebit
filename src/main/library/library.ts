import { app, dialog, type BrowserWindow } from 'electron';
import { watch, type FSWatcher } from 'node:fs';
import { realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Library, ScanResult } from '../../../native/index';
import { Events } from '../../shared/ipc/channels';
import type {
  AddFolderResult,
  LibraryState,
} from '../../shared/schemas/library';
import { emit } from '../ipc/handle';
import { native } from '../services/native';
import {
  onSettingsChange,
  readSettings,
  writeSettings,
} from '../services/settings';

export const MAX_FOLDERS = 20;
const PROGRESS_MS = 250;
const WATCH_DEBOUNCE_MS = 2_000;

let library: Library | null = null;
let running: Promise<ScanResult> | null = null;
let watchers: FSWatcher[] = [];
let watchTimer: NodeJS.Timeout | undefined;

export function lib(): Library {
  library ??= new (native().Library)(
    path.join(app.getPath('userData'), 'library.db'),
  );
  return library;
}

export function libraryState(): LibraryState {
  const stats = lib().stats();
  return {
    folders: readSettings().libraryFolders,
    trackCount: stats.trackCount,
    durationMs: stats.durationMs,
    albumCount: stats.albumCount,
    artistCount: stats.artistCount,
    scanning: running !== null,
  };
}

/** One scan at a time; a second caller waits on the same one. */
export function scan(): Promise<ScanResult> {
  if (running) return running;
  const folders = readSettings().libraryFolders;
  if (folders.length === 0) {
    lib().clear();
    const empty = { seen: 0, added: 0, updated: 0, removed: 0 };
    emit(Events.libraryChanged, empty);
    return Promise.resolve(empty);
  }
  const ticker = setInterval(
    () => emit(Events.scanProgress, lib().scanProgress()),
    PROGRESS_MS,
  );
  running = (lib().scan(folders) as Promise<ScanResult>).finally(() => {
    clearInterval(ticker);
    running = null;
    emit(Events.scanProgress, lib().scanProgress());
  });
  void running
    .then((result) => emit(Events.libraryChanged, result))
    .catch(() => {});
  return running;
}

/** The system folder picker, refusing folders too broad to hold only music. */
export async function pickFolder(
  win: BrowserWindow | null,
  title: string,
): Promise<
  | { ok: true; folder: string }
  | { ok: false; reason: 'cancelled' | 'root' | 'home' }
> {
  const options = { title, properties: ['openDirectory' as const] };
  const picked = win
    ? await dialog.showOpenDialog(win, options)
    : await dialog.showOpenDialog(options);
  const chosen = picked.filePaths[0];
  if (picked.canceled || !chosen) return { ok: false, reason: 'cancelled' };

  const folder = await realpath(chosen);
  // The whole disk or the home folder would sweep in far more than music.
  if (path.parse(folder).root === folder) return { ok: false, reason: 'root' };
  if (folder === (await realpath(os.homedir())))
    return { ok: false, reason: 'home' };
  return { ok: true, folder };
}

export async function addFolder(
  win: BrowserWindow | null,
): Promise<AddFolderResult> {
  const picked = await pickFolder(win, 'Add a music folder');
  if (!picked.ok) return picked;
  const { folder } = picked;
  const folders = readSettings().libraryFolders;
  if (folders.includes(folder)) return { ok: false, reason: 'duplicate' };
  if (folders.length >= MAX_FOLDERS) return { ok: false, reason: 'limit' };

  writeSettings({ libraryFolders: [...folders, folder] });
  void scan().catch(() => {});
  return { ok: true, state: libraryState() };
}

export function removeFolder(folder: string): LibraryState {
  const folders = readSettings().libraryFolders.filter((f) => f !== folder);
  writeSettings({ libraryFolders: folders });
  void scan().catch(() => {});
  return libraryState();
}

/** Rescans a short while after files change in a watched folder. */
function rewatch(): void {
  for (const w of watchers) w.close();
  watchers = [];
  const { watchFolders, libraryFolders } = readSettings();
  if (!watchFolders) return;
  for (const folder of libraryFolders) {
    try {
      watchers.push(
        watch(folder, { recursive: true, persistent: false }, () => {
          clearTimeout(watchTimer);
          watchTimer = setTimeout(
            () => void scan().catch(() => {}),
            WATCH_DEBOUNCE_MS,
          );
        }),
      );
    } catch {
      // A folder that vanished or can't be watched is still scanned on demand.
    }
  }
}

export function startLibrary(): void {
  lib();
  let last = '';
  onSettingsChange((s) => {
    const key = `${s.watchFolders}|${s.libraryFolders.join('\n')}`;
    if (key !== last) {
      last = key;
      rewatch();
    }
  });
  last = `${readSettings().watchFolders}|${readSettings().libraryFolders.join('\n')}`;
  rewatch();
  // Catch up on files changed while the app was closed.
  void scan().catch(() => {});
}
