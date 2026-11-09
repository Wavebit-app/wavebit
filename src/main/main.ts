import { app, BrowserWindow, Menu, session } from 'electron';
import path from 'node:path';
import { startDownloads } from './downloads/downloads';
import { registerAppIpc } from './ipc/app';
import { registerDownloadsIpc } from './ipc/downloads';
import { registerLibraryIpc } from './ipc/library';
import { registerLyricsIpc } from './ipc/lyrics';
import { registerSettingsIpc } from './ipc/settings';
import { registerSpotifyIpc } from './ipc/spotify';
import { registerUpdatesIpc } from './ipc/updates';
import { registerYouTubeIpc } from './ipc/youtube';
import { lib, startLibrary } from './library/library';
import {
  registerSchemes,
  serveMedia,
  serveRenderer,
} from './security/protocol';
import {
  hardenAllWebContents,
  hardenSession,
  identifyToYouTubeEmbeds,
} from './security/security';
import { responseCache } from './services/cache';
import { readSettings } from './services/settings';
import { startUpdates } from './updates/updates';
import { createMainWindow } from './window/mainWindow';
import {
  createTray,
  followWindow,
  showWindow,
  trayActive,
} from './window/tray';

// Dev and test runs can point at a throwaway profile; packaged builds ignore this.
if (!app.isPackaged && process.env.WAVEBIT_USER_DATA)
  app.setPath('userData', process.env.WAVEBIT_USER_DATA);

if (!app.requestSingleInstanceLock()) app.quit();

app.enableSandbox();
app.setAppUserModelId('dev.wavebit.app');
registerSchemes();
hardenAllWebContents();

let mainWindow: BrowserWindow | null = null;

let quitting = false;
app.on('before-quit', () => (quitting = true));

function openWindow(): void {
  const win = createMainWindow();
  mainWindow = win;
  win.on('closed', () => (mainWindow = null));
  // Closing keeps wavebit playing in the tray; Quit, and the system shutting down, don't.
  win.on('close', (event) => {
    if (quitting || !trayActive() || !readSettings().closeToTray) return;
    event.preventDefault();
    win.hide();
  });
  win.on('session-end', () => (quitting = true));
  followWindow(win);
}

// Launching wavebit again brings back a window hidden in the tray.
app.on('second-instance', showWindow);

void app.whenReady().then(() => {
  // The app draws its own title bar and menus; no native menu bar.
  Menu.setApplicationMenu(null);
  hardenSession(session.defaultSession);
  identifyToYouTubeEmbeds(session.defaultSession);
  serveRenderer(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}`));
  serveMedia(lib);

  responseCache().purgeExpired();
  registerAppIpc();
  registerSettingsIpc();
  registerLibraryIpc();
  registerLyricsIpc();
  registerSpotifyIpc();
  registerYouTubeIpc();
  registerDownloadsIpc();
  registerUpdatesIpc();
  startLibrary();
  startDownloads();
  startUpdates((value) => (quitting = value));

  void createTray(() => mainWindow);
  openWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) openWindow();
    else showWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
