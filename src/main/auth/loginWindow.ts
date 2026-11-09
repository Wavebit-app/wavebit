import { BrowserWindow, type Cookie, type Session } from 'electron';
import { AppError } from '../../shared/errors';

const TIMEOUT_MS = 10 * 60_000;

export interface LoginOptions {
  session: Session;
  /** The service's own sign-in page. */
  url: string;
  /** Finishes as soon as a cookie like this is set (Spotify's sp_dc). */
  doneOnCookie?: (cookie: Cookie) => boolean;
  /** Checked after every page load; true finishes (already signed in, or back on the service). */
  doneOnPage: (url: string) => Promise<boolean>;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

/**
 * A service's real sign-in page in a separate, isolated window: no preload,
 * sandboxed, its partition's host allowlist (security.ts), and its title
 * always the host it is on, so the person can see where they are typing.
 * One per service at a time; a second open focuses it.
 */
export function loginWindow() {
  let current: {
    win: BrowserWindow;
    done: Promise<void>;
    cancel: () => void;
  } | null = null;

  function open(parent: BrowserWindow | null, opts: LoginOptions) {
    if (current) {
      current.win.focus();
      return current.done;
    }
    const ses = opts.session;
    const win = new BrowserWindow({
      ...(parent && { parent }),
      width: 480,
      height: 720,
      title: hostOf(opts.url),
      autoHideMenuBar: true,
      webPreferences: {
        session: ses,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: false,
        spellcheck: false,
        devTools: false,
      },
    });
    win.removeMenu();
    const contents = win.webContents;
    contents.on('page-title-updated', (event) => event.preventDefault());
    contents.on('did-navigate', (_e, url) => win.setTitle(hostOf(url)));

    let settled = false;
    let resolveDone!: () => void;
    let rejectDone!: (error: Error) => void;
    const done = new Promise<void>((resolve, reject) => {
      resolveDone = resolve;
      rejectDone = reject;
    });
    const finish = (error?: AppError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ses.cookies.off('changed', onCookie);
      current = null;
      if (!win.isDestroyed()) win.destroy();
      if (error) rejectDone(error);
      else {
        // The new session cookies go to disk now, not at Chromium's next flush.
        void ses.cookies.flushStore().catch(() => {});
        resolveDone();
      }
    };
    const onCookie = (
      _e: unknown,
      cookie: Cookie,
      _cause: string,
      removed: boolean,
    ) => {
      if (!removed && cookie.value && opts.doneOnCookie?.(cookie)) finish();
    };
    ses.cookies.on('changed', onCookie);
    contents.on('did-navigate', (_e, url) => {
      void opts
        .doneOnPage(url)
        .then((yes) => yes && finish())
        .catch(() => {});
    });
    const timer = setTimeout(
      () => finish(new AppError('timed_out')),
      TIMEOUT_MS,
    );
    win.on('closed', () => finish(new AppError('closed')));
    current = { win, done, cancel: () => finish(new AppError('cancelled')) };
    // A redirect rejects loadURL with ERR_ABORTED; only a main-frame load
    // that really failed is a network error.
    contents.on('did-fail-load', (_e, code, _desc, _url, isMainFrame) => {
      if (isMainFrame && code !== -3) finish(new AppError('network'));
    });
    void win.loadURL(opts.url).catch(() => {});
    return done;
  }

  return {
    open,
    cancel: () => current?.cancel(),
    isOpen: () => current !== null,
  };
}
