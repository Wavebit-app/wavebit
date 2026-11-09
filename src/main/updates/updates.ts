import { app, net, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import { promises as fs, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { Events } from '../../shared/ipc/channels';
import { parseReleaseNotes } from '../../shared/releaseNotes';
import type {
  NotesTarget,
  ReleaseNotes,
  ReleaseNotesSection,
  UpdatePage,
  UpdateStatus,
} from '../../shared/schemas/updates';
import { stopDownloadsForUpdate } from '../downloads/downloads';
import { emit } from '../ipc/handle';
import { onSettingsChange, readSettings } from '../services/settings';
import {
  errorKind,
  isUnsignedMacError,
  nextLaunchState,
  type LaunchState,
} from './updateRules';

const REPO = 'Wavebit-app/wavebit';
const FIRST_CHECK_MS = 10_000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const NOTES_TIMEOUT_MS = 10_000;

const dataFile = (name: string) => path.join(app.getPath('userData'), name);
const launchFile = () => dataFile('update-state.json');
const notesFile = () => dataFile('release-notes.json');

let status: UpdateStatus = {
  state: 'unavailable',
  currentVersion: app.getVersion(),
  justUpdated: false,
};
let launch: LaunchState | null = null;
let setQuitting: (quitting: boolean) => void = () => {};

function set(patch: Partial<UpdateStatus>): UpdateStatus {
  status = { ...status, ...patch };
  emit(Events.updateStatus, status);
  return status;
}

export const updateStatus = (): UpdateStatus => status;

// --- Whether this launch follows an update -----------------------------------

const LaunchStateSchema = z.object({
  lastVersion: z.string().max(32),
  unseen: z.boolean(),
});

function readLaunchState(): LaunchState | null {
  try {
    const parsed = LaunchStateSchema.safeParse(
      JSON.parse(readFileSync(launchFile(), 'utf8')),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function saveLaunchState(): void {
  try {
    writeFileSync(launchFile(), JSON.stringify(launch));
  } catch (error) {
    console.error('updates: could not save launch state', error);
  }
}

/** What's new was pressed: the label goes, the section in About stays. */
export function markWhatsNewSeen(): UpdateStatus {
  if (launch) {
    launch = { ...launch, unseen: false };
    saveLaunchState();
  }
  return set({ justUpdated: false });
}

// --- Release details, live from GitHub and saved for offline ------------------

const SavedNotesSchema = z.record(
  z.string(),
  z.object({
    date: z.string().nullable(),
    sections: z.array(
      z.object({ title: z.string(), items: z.array(z.string()) }),
    ),
  }),
);
type SavedNotes = z.infer<typeof SavedNotesSchema>;

const ReleaseSchema = z.object({
  published_at: z.string().nullable(),
  body: z.string().nullable(),
});

async function readSavedNotes(): Promise<SavedNotes> {
  try {
    const parsed = SavedNotesSchema.safeParse(
      JSON.parse(await fs.readFile(notesFile(), 'utf8')),
    );
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

/** Keeps only the installed version's notes and the waiting one's. */
async function saveNotes(
  version: string,
  entry: { date: string | null; sections: ReleaseNotesSection[] },
): Promise<void> {
  const saved = await readSavedNotes();
  const next: SavedNotes = { [version]: entry };
  for (const keep of [app.getVersion(), status.version])
    if (keep && keep !== version && saved[keep]) next[keep] = saved[keep];
  await fs.writeFile(notesFile(), JSON.stringify(next)).catch((error) => {
    console.error('updates: could not save release notes', error);
  });
}

export async function releaseNotes(
  target: NotesTarget,
): Promise<ReleaseNotes | null> {
  const version = target === 'pending' ? status.version : app.getVersion();
  if (!version) return null;
  try {
    const response = await net.fetch(
      `https://api.github.com/repos/${REPO}/releases/tags/v${encodeURIComponent(version)}`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'wavebit',
        },
        signal: AbortSignal.timeout(NOTES_TIMEOUT_MS),
      },
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const release = ReleaseSchema.parse(await response.json());
    const entry = {
      date: release.published_at,
      sections: parseReleaseNotes(release.body ?? ''),
    };
    await saveNotes(version, entry);
    return { version, ...entry, source: 'live' };
  } catch (error) {
    console.warn('updates: release notes unavailable', error);
    const saved = (await readSavedNotes())[version];
    return saved
      ? { version, ...saved, source: 'saved' }
      : { version, date: null, sections: [], source: 'failed' };
  }
}

export function openUpdatePage(page: UpdatePage): void {
  const base = `https://github.com/${REPO}`;
  const url =
    page === 'repo'
      ? base
      : page === 'releases'
        ? `${base}/releases`
        : `${base}/releases/tag/v${encodeURIComponent(status.version ?? app.getVersion())}`;
  void shell.openExternal(url);
}

// --- Checking, downloading, installing ----------------------------------------

function failed(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error('updates:', message);
  if (status.state === 'installing') {
    // Still running: the window has to be able to hide to the tray again.
    setQuitting(false);
    set({ state: 'error', error: 'install' });
    return;
  }
  if (
    process.platform === 'darwin' &&
    status.version &&
    isUnsignedMacError(message)
  ) {
    set({ state: 'manual', error: undefined });
    return;
  }
  set({ state: 'error', error: errorKind(message), checkedAt: Date.now() });
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  const { state } = status;
  if (
    state === 'unavailable' ||
    state === 'checking' ||
    state === 'downloading' ||
    state === 'downloaded' ||
    state === 'installing'
  )
    return status;
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    failed(error);
  }
  return status;
}

export async function downloadUpdate(): Promise<UpdateStatus> {
  if (status.state !== 'available') return status;
  set({ state: 'downloading', progress: 0 });
  try {
    await autoUpdater.downloadUpdate();
  } catch (error) {
    failed(error);
  }
  return status;
}

/**
 * Closes wavebit, shows the installer and opens the new version. The order
 * matters: closing would hide to the tray unless quitting is set first, and on
 * Windows a song download still running would lock files the installer replaces.
 */
export async function installUpdate(): Promise<UpdateStatus> {
  if (status.state !== 'downloaded') return status;
  set({ state: 'installing', error: undefined });
  setQuitting(true);
  await stopDownloadsForUpdate();
  try {
    // Not silent: on Windows this is what shows the installer's progress
    // window, and its one-click mode starts the app when it finishes.
    autoUpdater.quitAndInstall(false, true);
  } catch (error) {
    failed(error);
  }
  return status;
}

function listen(): void {
  autoUpdater.on('checking-for-update', () =>
    set({ state: 'checking', error: undefined }),
  );
  autoUpdater.on('update-available', (info) =>
    set({
      state: autoUpdater.autoDownload ? 'downloading' : 'available',
      version: info.version,
      progress: 0,
      transferred: undefined,
      total: undefined,
      checkedAt: Date.now(),
    }),
  );
  autoUpdater.on('update-not-available', () =>
    set({ state: 'up-to-date', version: undefined, checkedAt: Date.now() }),
  );
  autoUpdater.on('download-progress', (progress) =>
    set({
      state: 'downloading',
      progress: Math.min(100, Math.max(0, progress.percent)),
      transferred: progress.transferred,
      total: progress.total,
    }),
  );
  autoUpdater.on('update-downloaded', (info) =>
    set({
      state: 'downloaded',
      version: info.version,
      progress: 100,
      checkedAt: Date.now(),
    }),
  );
  autoUpdater.on('error', failed);
}

export function startUpdates(onQuitting: (quitting: boolean) => void): void {
  setQuitting = onQuitting;
  // Running from source, or from a package manager that updates it instead.
  if (!app.isPackaged || process.env.FLATPAK_ID) return;

  launch = nextLaunchState(readLaunchState(), app.getVersion());
  saveLaunchState();
  status = { ...status, justUpdated: launch.unseen };

  if (!autoUpdater.isUpdaterActive()) return;
  status = { ...status, state: 'idle' };

  autoUpdater.autoDownload = readSettings().autoUpdate;
  // Quitting never starts an installer by surprise; the update waits for its button.
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.disableWebInstaller = true;
  autoUpdater.logger = console;
  onSettingsChange((settings) => {
    autoUpdater.autoDownload = settings.autoUpdate;
  });
  listen();

  setTimeout(() => void checkForUpdates(), FIRST_CHECK_MS).unref();
  setInterval(() => void checkForUpdates(), CHECK_EVERY_MS).unref();
}
