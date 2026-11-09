export type SpotifyLinkKind = 'playlist' | 'album' | 'artist' | 'track';

export interface SpotifyLink {
  kind: SpotifyLinkKind;
  id: string;
}

const KINDS = 'playlist|album|artist|track';
const URI = new RegExp(`^spotify:(${KINDS}):([A-Za-z0-9]{22})$`);
// An optional locale segment: open.spotify.com/intl-de/playlist/<id>.
const PATH = new RegExp(`^/(?:intl-[a-z-]+/)?(${KINDS})/([A-Za-z0-9]{22})/?$`);

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
  const url = URL.parse(input);
  if (url?.protocol !== 'https:' || url.hostname !== 'open.spotify.com')
    return null;
  const path = PATH.exec(url.pathname);
  return path ? { kind: path[1] as SpotifyLinkKind, id: path[2]! } : null;
}
