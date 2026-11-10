import { app, BrowserWindow, clipboard } from 'electron';
import { z } from 'zod';
import { Channels } from '../../shared/ipc/channels';
import type { AppInfo } from '../../shared/ipc/api';
import { trayActive } from '../window/tray';
import { RefreshSchema, type RefreshScope } from '../../shared/schemas/refresh';
import { TrayStateSchema } from '../../shared/schemas/tray';
import { scan } from '../library/library';
import { native } from '../services/native';
import { forgetViews as forgetSpotify } from '../spotify/service';
import { TITLE_BAR_HEIGHT } from '../window/mainWindow';
import { updateTray } from '../window/tray';
import { forgetViews as forgetYouTube } from '../youtube/service';
import { handle } from './handle';

const NoInput = z.undefined();
/** Pulling a page again and again can't turn into a stream of requests. */
const REFRESH_FLOOR_MS = 10_000;
const Hex = z.string().regex(/^#[0-9a-f]{6}$/i);
const TitleBarSchema = z.object({ color: Hex, symbolColor: Hex }).strict();
const CopySchema = z.object({ text: z.string().min(1).max(4096) }).strict();

export function registerAppIpc(): void {
  handle(Channels.appCopy, CopySchema, ({ text }) => clipboard.writeText(text));
  handle(
    Channels.appInfo,
    NoInput,
    (): AppInfo => ({
      trayAvailable: trayActive(),
      name: app.getName(),
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      nativeVersion: native().nativeVersion(),
    }),
  );

  handle(Channels.appTitleBar, TitleBarSchema, (colors, event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    // setTitleBarOverlay exists on Windows and Linux; macOS draws its own lights.
    if (win && process.platform !== 'darwin')
      win.setTitleBarOverlay({ ...colors, height: TITLE_BAR_HEIGHT });
    win?.setBackgroundColor(colors.color);
  });

  // A pull clears this page's remote caches, so what it asks next is really fresh.
  const lastRefresh = new Map<RefreshScope, number>();
  handle(Channels.appRefresh, RefreshSchema, async ({ scope }) => {
    if (Date.now() - (lastRefresh.get(scope) ?? 0) < REFRESH_FLOOR_MS) return;
    lastRefresh.set(scope, Date.now());
    await Promise.all([forgetYouTube(scope), forgetSpotify(scope)]);
    if (scope === 'library') void scan().catch(() => {});
  });

  handle(Channels.appQuit, NoInput, () => app.quit());
  handle(Channels.appTray, TrayStateSchema, (state) => updateTray(state));
}
