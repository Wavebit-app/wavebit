import {
  app,
  Menu,
  nativeImage,
  screen,
  Tray,
  type BrowserWindow,
  type MenuItemConstructorOptions,
} from 'electron';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { Events } from '../../shared/ipc/channels';
import type { TrayCommand, TrayState } from '../../shared/schemas/tray';
import { emit } from '../ipc/handle';
import { onSettingsChange, readSettings } from '../services/settings';
import {
  SHORT_SCREEN_PX,
  trayHostAnswer,
  trayItems,
  trayTooltip,
  type TrayAction,
  type TrayItem,
} from './trayMenu';

let tray: Tray | null = null;
let window: (() => BrowserWindow | null) | null = null;
let state: TrayState = {
  title: null,
  artist: '',
  playing: false,
  shuffle: false,
  repeat: 'off',
};

const mac = process.platform === 'darwin';

/** Commands that lead to a page or panel need the window in front first. */
const SHOWS_WINDOW: ReadonlySet<TrayAction> = new Set<TrayAction>([
  'nowPlaying',
  'lyrics',
  'queue',
  'home',
  'library',
  'search',
  'settings',
]);

export function showWindow(): void {
  const win = window?.();
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function run(action: TrayAction): void {
  if (action === 'show') return showWindow();
  if (action === 'hide') return window?.()?.hide();
  if (action === 'quit') return app.quit();
  if (SHOWS_WINDOW.has(action)) showWindow();
  emit(Events.trayCommand, action as TrayCommand);
}

function toTemplate(item: TrayItem): MenuItemConstructorOptions {
  const { action, submenu, ...rest } = item;
  return {
    ...rest,
    ...(action && { click: () => run(action) }),
    ...(submenu && { submenu: submenu.map(toTemplate) }),
  };
}

/** Rebuilt on every change: on Linux an edited menu doesn't show until it's set again. */
function refresh(): void {
  if (!tray || tray.isDestroyed()) return;
  const win = window?.();
  tray.setContextMenu(
    Menu.buildFromTemplate(
      trayItems(state, {
        visible: !!win && win.isVisible(),
        closeToTray: readSettings().closeToTray,
        mac,
        short: screen.getPrimaryDisplay().workAreaSize.height < SHORT_SCREEN_PX,
      }).map(toTemplate),
    ),
  );
  tray.setToolTip(trayTooltip(state));
}

export function updateTray(next: TrayState): void {
  state = next;
  refresh();
}

/** Keeps Show and Hide right as the window comes and goes. */
export function followWindow(win: BrowserWindow): void {
  win.on('show', refresh);
  win.on('hide', refresh);
  win.on('closed', refresh);
}

/** Whether closing the window should leave wavebit running here. */
export const trayActive = () => !!tray && !tray.isDestroyed();

/**
 * Linux only draws a tray if something on the desktop provides one (COSMIC and
 * KDE do; plain GNOME and a Flatpak's filtered session bus don't), and
 * `new Tray` succeeds either way. Without this, closing the window would leave
 * wavebit running with no way back to it. If `gdbus` can't say, assume yes.
 */
function trayHostExists(): Promise<boolean> {
  if (process.platform !== 'linux') return Promise.resolve(true);
  return new Promise((resolve) =>
    execFile(
      'gdbus',
      [
        'call',
        '--session',
        '--dest',
        'org.freedesktop.DBus',
        '--object-path',
        '/org/freedesktop/DBus',
        '--method',
        'org.freedesktop.DBus.NameHasOwner',
        'org.kde.StatusNotifierWatcher',
      ],
      { timeout: 2_000 },
      (error, stdout) => resolve(error ? true : trayHostAnswer(stdout)),
    ),
  );
}

export async function createTray(
  getWindow: () => BrowserWindow | null,
): Promise<void> {
  window = getWindow;
  if (!(await trayHostExists())) return;
  const file = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(app.getAppPath(), 'assets', 'brand', 'icon.png');
  const icon = nativeImage
    .createFromPath(file)
    .resize({ width: mac ? 18 : 24, height: mac ? 18 : 24, quality: 'best' });
  try {
    tray = new Tray(icon);
  } catch {
    // A desktop without a tray: the window simply closes as usual.
    tray = null;
    return;
  }
  // macOS opens the menu. On Linux only some desktops send this (COSMIC opens the menu itself).
  if (!mac)
    tray.on('click', () => {
      const win = getWindow();
      if (win?.isVisible()) win.hide();
      else showWindow();
    });
  onSettingsChange(refresh);
  refresh();
}
