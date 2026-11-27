export type SpotifyLinkKind = 'playlist' | 'album' | 'artist' | 'track';

export interface SpotifyLink {
  kind: SpotifyLinkKind;
  id: string;
}

const KINDS = 'playlist|album|artist|track';
// spotify:<kind>:<id>, and the older spotify:user:<name>:playlist:<id>.
const URI = new RegExp(
  `^spotify:(?:user:[A-Za-z0-9._-]{1,64}:)?(${KINDS}):([A-Za-z0-9]{22})$`,
);
// An optional locale segment (open.spotify.com/intl-de/playlist/<id>), the
// embed player's /embed/, and the older /user/<name>/playlist/<id>.
const PATH = new RegExp(
  `^/(?:intl-[a-z-]+/)?(?:embed/)?(?:user/[A-Za-z0-9._-]{1,64}/)?(${KINDS})/([A-Za-z0-9]{22})/?$`,
);
const HOSTS = new Set(['open.spotify.com', 'play.spotify.com']);
/** Spotify's share shorteners: their target is only known by asking Spotify. */
const SHORT_HOSTS = new Set(['spotify.link', 'spoti.fi', 'spotify.app.link']);

/**
 * Reads a Spotify link or URI someone pasted: an https://open.spotify.com
 * address (with or without ?si=…) or spotify:<kind>:<id>. Anything else is
 * null, so only an id of the right shape ever reaches a request.
 */
export function parseSpotifyLink(text: string): SpotifyLink | null {
  const input = text.trim();
  if (input.length > 512) return null;
  const uri = URI.exec(input);
  if (uri) return { kind: uri[1] as SpotifyLinkKind, id: uri[2]! };
  if (/\s/.test(input)) return null;
  const url = URL.parse(
    /^[a-z]+:\/\//i.test(input) ? input : `https://${input}`,
  );
  if (
    !url ||
    (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    url.username ||
    url.password ||
    url.port ||
    !HOSTS.has(url.hostname.toLowerCase())
  )
    return null;
  const path = PATH.exec(url.pathname);
  return path ? { kind: path[1] as SpotifyLinkKind, id: path[2]! } : null;
}

/**
 * A spotify.link (or spoti.fi) share link. Spotify forwards those with
 * script on its own page, so wavebit can't read where they go without
 * running Spotify's page; the search asks for the open.spotify.com address.
 */
export function isSpotifyShortLink(text: string): boolean {
  const input = text.trim();
  if (input.length > 512 || /\s/.test(input)) return false;
  const url = URL.parse(
    /^[a-z]+:\/\//i.test(input) ? input : `https://${input}`,
  );
  return (
    !!url &&
    (url.protocol === 'https:' || url.protocol === 'http:') &&
    SHORT_HOSTS.has(url.hostname.toLowerCase()) &&
    url.pathname.length > 1
  );
}
