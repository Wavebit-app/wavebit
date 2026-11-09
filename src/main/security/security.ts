import { app, shell, type Session, type WebContents } from 'electron';
import { isTrustedOrigin } from './protocol';
import { onDomain, onExactHost } from './urls';

/** Hosts a link in the app may open in the user's browser. */
const EXTERNAL_HOSTS = new Set([
  'accounts.spotify.com',
  'open.spotify.com',
  'www.spotify.com',
  'support.spotify.com',
  'music.youtube.com',
  'www.youtube.com',
  'youtu.be',
]);

/**
 * Pages the Spotify sign-in window may show: Spotify itself and the identity
 * providers its login page offers ("Continue with Google/Facebook/Apple").
 */
const SPOTIFY_LOGIN_HOSTS = [
  'spotify.com',
  'scdn.co',
  'spotifycdn.com',
  'accounts.google.com',
  'facebook.com',
  'appleid.apple.com',
  'idmsa.apple.com',
];

/**
 * Pages the YouTube Music sign-in window may show: Google's own sign-in
 * (which hands the session to YouTube through accounts.youtube.com) and the
 * hosts its pages load from.
 */
export const YOUTUBE_LOGIN_HOSTS = [
  'youtube.com',
  'google.com',
  'gstatic.com',
  'googleusercontent.com',
  'ggpht.com',
  'ytimg.com',
];

/** A service's own partition, and the only hosts its windows may show. */
const loginSessions = new WeakMap<Session, readonly string[]>();

/** Marks a session as Spotify's, so its windows get the login rules below. */
export function markSpotifySession(session: Session): void {
  loginSessions.set(session, SPOTIFY_LOGIN_HOSTS);
}

/** Marks a session as YouTube Music's, with Google's sign-in hosts. */
export function markYouTubeSession(session: Session): void {
  loginSessions.set(session, YOUTUBE_LOGIN_HOSTS);
}

function openExternalIfAllowed(url: string): void {
  if (onExactHost(EXTERNAL_HOSTS, url))
    void shell.openExternal(new URL(url).toString());
}

/**
 * YouTube's embedded player asks every embedding app to identify itself in
 * the Referer header. A page served from app:// sends none, so the app's own
 * identity is added to embed requests that lack one (dev, on localhost,
 * already sends its origin).
 */
export function identifyToYouTubeEmbeds(session: Session): void {
  session.webRequest.onBeforeSendHeaders(
    { urls: ['https://www.youtube-nocookie.com/embed/*'] },
    (details, callback) => {
      const headers = details.requestHeaders;
      if (!headers.Referer && !headers.referer)
        headers.Referer = 'https://app.wavebit.desktop/';
      callback({ requestHeaders: headers });
    },
  );
}

/** No camera, microphone, notifications, geolocation or anything else unless added here. */
export function hardenSession(session: Session): void {
  session.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  session.setPermissionCheckHandler(() => false);
  session.setDevicePermissionHandler(() => false);
  // wavebit never downloads through a page, so no page or embed can save a file.
  session.on('will-download', (event) => event.preventDefault());
}

/** A sign-in window: only its service's hosts, and popups in the same kind of window. */
function hardenLoginContents(
  contents: WebContents,
  hosts: readonly string[],
): void {
  const allowed = (url: string) => onDomain(hosts, url);
  contents.setWindowOpenHandler(({ url }) =>
    // Identity-provider popups stay in the same locked-down kind of window.
    allowed(url)
      ? {
          action: 'allow',
          overrideBrowserWindowOptions: {
            width: 480,
            height: 720,
            autoHideMenuBar: true,
            webPreferences: {
              session: contents.session,
              sandbox: true,
              contextIsolation: true,
              nodeIntegration: false,
              webviewTag: false,
              devTools: false,
            },
          },
        }
      : { action: 'deny' },
  );
  contents.on('will-navigate', (event, url) => {
    if (!allowed(url)) event.preventDefault();
  });
  contents.on('will-redirect', (event, url) => {
    if (!allowed(url)) event.preventDefault();
  });
}

/** Applies to every window, including any created later. */
export function hardenAllWebContents(): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault());
    const hosts = loginSessions.get(contents.session);
    if (hosts) {
      hardenLoginContents(contents, hosts);
      return;
    }
    contents.setWindowOpenHandler(({ url }) => {
      openExternalIfAllowed(url);
      return { action: 'deny' };
    });
    contents.on('will-navigate', (event, url) => {
      if (!isTrustedOrigin(url)) {
        event.preventDefault();
        openExternalIfAllowed(url);
      }
    });
    contents.on('will-redirect', (event, url) => {
      if (!isTrustedOrigin(url)) event.preventDefault();
    });
    // The page's only frame is YouTube's embedded player; no frame may
    // navigate anywhere else (a link inside it, a redirect, an injected src).
    contents.on('will-frame-navigate', (event) => {
      if (event.isMainFrame) return;
      try {
        const { protocol, hostname } = new URL(event.url);
        if (protocol === 'https:' && hostname === 'www.youtube-nocookie.com')
          return;
      } catch {
        // Not a URL: refused below.
      }
      event.preventDefault();
    });
  });
}
