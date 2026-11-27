/**
 * What a pasted YouTube or YouTube Music link points at. Read on this
 * computer, with nothing fetched: only ids of the right shape come out, so a
 * link can never steer a request anywhere but YouTube Music's own calls.
 */
export type YouTubeLink =
  | { kind: 'video'; videoId: string; list: string | null }
  | { kind: 'playlist'; list: string }
  | { kind: 'album'; browseId: string }
  | { kind: 'artist'; browseId: string }
  /** youtube.com/@name: a handle needs YouTube to resolve, so it is searched. */
  | { kind: 'handle'; handle: string };

const HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);

const VIDEO = /^[A-Za-z0-9_-]{11}$/;
const LIST = /^[A-Za-z0-9_-]{10,64}$/;
const CHANNEL = /^UC[A-Za-z0-9_-]{22}$/;
const ALBUM = /^MPREb_[A-Za-z0-9_-]{6,40}$/;
const HANDLE = /^@[\p{L}\p{N}._-]{3,30}$/u;
/** Paths that end in a video id: /shorts/ID, /live/ID, /embed/ID, /v/ID, /e/ID. */
const VIDEO_PATH = /^\/(?:shorts|live|embed|v|e)\/([A-Za-z0-9_-]{11})\/?$/;

/**
 * A playlist worth opening as a page. Mixes (RD…) are made for one person
 * and one moment, and Watch later and Liked (WL, LL) are private, so a link
 * carrying one only plays its video.
 */
function ownList(list: string | null): string | null {
  if (!list || !LIST.test(list) || /^(RD|WL$|LL$|UL)/.test(list)) return null;
  return list;
}

function fromUrl(url: URL): YouTubeLink | null {
  const host = url.hostname.toLowerCase();
  const path = url.pathname;
  const params = url.searchParams;
  const list = ownList(params.get('list'));

  if (host.endsWith('youtu.be')) {
    const id = path.replace(/^\/|\/$/g, '');
    return VIDEO.test(id) ? { kind: 'video', videoId: id, list } : null;
  }
  if (path === '/watch' || path === '/watch/') {
    const id = params.get('v');
    return id && VIDEO.test(id) ? { kind: 'video', videoId: id, list } : null;
  }
  const video = VIDEO_PATH.exec(path);
  if (video) return { kind: 'video', videoId: video[1]!, list };
  if (path === '/playlist' || path === '/playlist/')
    return list ? { kind: 'playlist', list } : null;

  const browse = /^\/browse\/([A-Za-z0-9_-]{8,70})\/?$/.exec(path)?.[1];
  if (browse) {
    if (ALBUM.test(browse)) return { kind: 'album', browseId: browse };
    if (CHANNEL.test(browse)) return { kind: 'artist', browseId: browse };
    if (browse.startsWith('VL') && ownList(browse.slice(2)))
      return { kind: 'playlist', list: browse.slice(2) };
    return null;
  }
  const channel = /^\/channel\/([A-Za-z0-9_-]{24})\/?$/.exec(path)?.[1];
  if (channel && CHANNEL.test(channel))
    return { kind: 'artist', browseId: channel };
  const handle = /^\/(@[^/]+)\/?(?:videos|featured|shorts|streams)?\/?$/.exec(
    path,
  )?.[1];
  if (handle) {
    const decoded = (() => {
      try {
        return decodeURIComponent(handle);
      } catch {
        return '';
      }
    })();
    if (HANDLE.test(decoded)) return { kind: 'handle', handle: decoded };
  }
  return null;
}

/**
 * Reads a YouTube link someone pasted: youtube.com (www, m, music),
 * youtu.be, youtube-nocookie.com, with or without https://, share
 * parameters (si=, t=, feature=) ignored. Anything else is null.
 */
export function parseYouTubeLink(text: string): YouTubeLink | null {
  const input = text.trim();
  if (!input || input.length > 512 || /\s/.test(input)) return null;
  const withScheme = /^[a-z]+:\/\//i.test(input) ? input : `https://${input}`;
  const url = URL.parse(withScheme);
  if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:'))
    return null;
  if (url.username || url.password || url.port) return null;
  if (!HOSTS.has(url.hostname.toLowerCase())) return null;
  return fromUrl(url);
}

/** The browse id YouTube Music opens a playlist under. */
export const playlistBrowseId = (list: string) => `VL${list}`;
