import type { BrowserWindow } from 'electron';
import { loginWindow } from '../auth/loginWindow';
import { spotify } from './session';

const LOGIN_URL =
  'https://accounts.spotify.com/login?continue=https%3A%2F%2Fopen.spotify.com%2F';

const login = loginWindow();

async function hasSession(): Promise<boolean> {
  const [cookie] = await spotify().session.cookies.get({
    url: 'https://open.spotify.com/',
    name: 'sp_dc',
  });
  return !!cookie?.value;
}

/** Spotify's own login page; done once the `sp_dc` session cookie appears. */
export function openLogin(parent: BrowserWindow | null): Promise<void> {
  return login.open(parent, {
    session: spotify().session,
    url: LOGIN_URL,
    doneOnCookie: (c) =>
      c.name === 'sp_dc' && !!c.domain?.endsWith('spotify.com'),
    // Already signed in, Spotify skips the form without changing the cookie.
    doneOnPage: hasSession,
  });
}

export const cancelLogin = login.cancel;
export const loginOpen = login.isOpen;
