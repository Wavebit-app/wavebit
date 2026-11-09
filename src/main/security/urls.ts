/**
 * The URL rules behind security.ts and protocol.ts, apart from Electron so
 * they can be tested on their own.
 */

/** https only, on the default port, with no credentials in the address. */
function plainHttps(url: string): URL | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' &&
      !parsed.port &&
      !parsed.username &&
      !parsed.password
      ? parsed
      : null;
  } catch {
    return null;
  }
}

/** On exactly one of these hosts. */
export function onExactHost(hosts: ReadonlySet<string>, url: string): boolean {
  const parsed = plainHttps(url);
  return !!parsed && hosts.has(parsed.hostname);
}

/** On one of these domains or a subdomain of it. */
export function onDomain(domains: readonly string[], url: string): boolean {
  const parsed = plainHttps(url);
  return (
    !!parsed &&
    domains.some(
      (d) => parsed.hostname === d || parsed.hostname.endsWith(`.${d}`),
    )
  );
}

/** The artwork CDNs, the same ones the page's CSP allows for <img>. */
const ART_DOMAINS = [
  'scdn.co',
  'spotifycdn.com',
  'googleusercontent.com',
  'ggpht.com',
  'ytimg.com',
];

/**
 * The cover address in a media://remote/<base64url> path, or null. Only these
 * hosts: the page can't use the main process to reach anything else.
 */
export function artUrlFromPath(encoded: string): string | null {
  if (!encoded || encoded.length > 4096 || !/^[\w-]+$/.test(encoded))
    return null;
  const url = Buffer.from(encoded, 'base64url').toString('utf8');
  return onDomain(ART_DOMAINS, url) ? url : null;
}

/**
 * CORS headers for a media:// response, or null to refuse it. A plain <img>
 * or <audio> sends no Origin and gets none back, so it can show the media but
 * never read it; only the app's own page may read the bytes (Web Audio needs
 * that). The YouTube embed shares the app's session, so `*` would hand it the
 * library.
 */
export function mediaCors(
  origin: string | null,
  trusted: (origin: string) => boolean,
): Record<string, string> | null {
  if (origin === null) return {};
  if (!trusted(origin)) return null;
  return { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };
}
