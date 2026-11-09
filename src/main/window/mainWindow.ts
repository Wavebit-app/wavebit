import { app, BrowserWindow, nativeTheme, screen } from 'electron';
import path from 'node:path';
import { setEventTarget } from '../ipc/handle';
import { APP_ORIGIN } from '../security/protocol';
import { readSettings } from '../services/settings';
import { readBounds, saveBounds } from '../services/windowState';

export const TITLE_BAR_HEIGHT = 48;
// DESIGN.md › Palette: `canvas` and `ink`, so the frame never flashes white.
const FRAME = {
  light: { color: '#eef0f3', symbolColor: '#14161a' },
  dark: { color: '#0b0b0d', symbolColor: '#f1f1f3' },
};

function isDark(): boolean {
  const { theme } = readSettings();
  return (
    theme === 'dark' || (theme === 'system' && nativeTheme.shouldUseDarkColors)
  );
}

/** Saved bounds only if they still land on a connected display. */
function startBounds() {
  const saved = readBounds();
  const visible =
    saved.x !== undefined &&
    saved.y !== undefined &&
    screen.getAllDisplays().some(({ workArea: a }) => {
      const x = saved.x!;
      const y = saved.y!;
      return (
        x < a.x + a.width &&
        x + saved.width > a.x &&
        y < a.y + a.height &&
        y + 40 > a.y
      );
    });
  return visible ? saved : { ...saved, x: undefined, y: undefined };
}

export function createMainWindow(): BrowserWindow {
  const bounds = startBounds();
  const frame = isDark() ? FRAME.dark : FRAME.light;
  const mac = process.platform === 'darwin';
  const win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: 360,
    minHeight: 480,
    show: false,
    title: 'wavebit',
    backgroundColor: frame.color,
    titleBarStyle: 'hidden',
    ...(mac
      ? { trafficLightPosition: { x: 14, y: 16 } }
      : { titleBarOverlay: { ...frame, height: TITLE_BAR_HEIGHT } }),
    ...(process.platform === 'linux' && {
      icon: app.isPackaged
        ? path.join(process.resourcesPath, 'icon.png')
        : path.join(app.getAppPath(), 'assets', 'brand', 'icon.png'),
    }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });
  if (bounds.maximized) win.maximize();
  setEventTarget(win.webContents);

  const remember = () => {
    if (win.isDestroyed() || win.isMinimized()) return;
    const maximized = win.isMaximized();
    const b = maximized ? readBounds() : win.getBounds();
    saveBounds({ x: b.x, y: b.y, width: b.width, height: b.height, maximized });
  };
  win.on('close', remember);
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => setEventTarget(null));

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    if (process.env.WAVEBIT_DEVTOOLS === '1')
      win.webContents.openDevTools({ mode: 'detach' });
  } else {
    void win.loadURL(`${APP_ORIGIN}/index.html`);
  }
  return win;
}
