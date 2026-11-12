import { app, BrowserWindow, Menu, session } from 'electron';
import path from 'node:path';
import { startDownloads } from './downloads/downloads';
import { registerAppIpc } from './ipc/app';
import { registerDownloadsIpc } from './ipc/downloads';
import { registerLibraryIpc } from './ipc/library';
import { registerLyricsIpc } from './ipc/lyrics';
import { registerPartyIpc } from './ipc/party';
import { registerSettingsIpc } from './ipc/settings';
import { registerSpotifyIpc } from './ipc/spotify';
import { registerUpdatesIpc } from './ipc/updates';
import { registerYouTubeIpc } from './ipc/youtube';
import { lib, startLibrary } from './library/library';
import {
  inviteIn,
  leavePartyOnQuit,
  openInvite,
  startParty,
} from './party/party';
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

// A second launch only hands its arguments (an invite link, say) to the first
// and goes. It must start nothing itself: acting on the link too would join
// as the same device and throw the first window out of the party.
const primary = app.requestSingleInstanceLock();
if (!primary) app.quit();

app.enableSandbox();
app.setAppUserModelId('dev.wavebit.app');
registerSchemes();
hardenAllWebContents();

let mainWindow: BrowserWindow | null = null;

let quitting = false;
app.on('before-quit', () => {
  quitting = true;
  leavePartyOnQuit();
});

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

// Launching wavebit again brings back a window hidden in the tray. An invite
// link starts wavebit a second time with the link as an argument.
app.on('second-instance', (_event, argv) => {
  showWindow();
  const link = inviteIn(argv);
  if (link) openInvite(link);
});
// macOS hands links over as an event instead.
app.on('open-url', (event, url) => {
  event.preventDefault();
  showWindow();
  openInvite(url);
});

void app.whenReady().then(() => {
  if (!primary) return;
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
  registerPartyIpc();
  startLibrary();
  startDownloads();
  startUpdates((value) => (quitting = value));
  startParty();
  // `wavebit://party/CODE` opens wavebit. A dev build isn't an installed app, so it doesn't claim the link.
  if (app.isPackaged) app.setAsDefaultProtocolClient('wavebit');
  const link = inviteIn(process.argv);
  if (link) openInvite(link);

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
