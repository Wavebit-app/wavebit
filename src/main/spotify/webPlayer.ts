import { cached, store } from '../services/cache';
import { spotify, WEB_PLAYER } from './session';

export type Operation =
  | 'libraryV3'
  | 'fetchPlaylist'
  | 'fetchLibraryTracks'
  | 'profileAttributes'
  | 'canvas'
  | 'getAlbum'
  | 'areEntitiesInLibrary'
  | 'addToLibrary'
  | 'removeFromLibrary'
  | 'queryArtistOverview'
  | 'searchTracks'
  | 'getTrack'
  | 'userTopContent'
  | 'fetchEntitiesForRecentlyPlayed';
const OPERATIONS: Operation[] = [
  'libraryV3',
  'fetchPlaylist',
  'fetchLibraryTracks',
  'profileAttributes',
  'canvas',
  'getAlbum',
  'areEntitiesInLibrary',
  'addToLibrary',
  'removeFromLibrary',
  'queryArtistOverview',
  'searchTracks',
  'getTrack',
  'userTopContent',
  'fetchEntitiesForRecentlyPlayed',
];

/** The last values BitChord saw working (its extension and SpotifyCanvasQuery.kt, 2026-10-16). */
const KNOWN: WebPlayerInfo = {
  clientVersion: '1.2.77.0',
  hashes: {
    libraryV3:
      '390c78e5b951029bad359785e69b07b536a509c581cbcd0aded5e5067f187455',
    fetchPlaylist:
      '21ea11a6ac75a5f3e01fd365d29c18e0a4a8b7dc09f89bbb5d73910190c6acaf',
    fetchLibraryTracks:
      '087278b20b743578a6262c2b0b4bcd20d879c503cc359a2285baf083ef944240',
    profileAttributes:
      '08ffb4730af3746e04a8301396f20875dbbce10c75243803091a9274eacc8ac0',
    canvas: '575138ab27cd5c1b3e54da54d0a7cc8d85485402de26340c2145f0f6bb5e7a9f',
    // Read from the web player's bundle (web-player.632a438d.js) on 2026-11-08.
    getAlbum:
      '0b6ce3511e1b02e4a40fa95440f992acbe85080eb308af9194322d708fc1914f',
    areEntitiesInLibrary:
      '134337999233cc6fdd6b1e6dbf94841409f04a946c5c7b744b09ba0dfe5a85ed',
    addToLibrary:
      '896ebcb47815681340860d121cb5d494e157e2a78d3950385cd54e0393c67148',
    removeFromLibrary:
      '896ebcb47815681340860d121cb5d494e157e2a78d3950385cd54e0393c67148',
    queryArtistOverview:
      'eafb1620d783ece118e72fbfede2b0064483e029d3c1aafafa1c2de0e25a89e7',
    // In the search route's own chunk; BitChord's last known value (2026-10-16).
    searchTracks:
      'b02683192a98dde7966b5e6655a79eeb62713eab703eda9902c932818dd52751',
    getTrack:
      'e7b1bf4e95cb3d733d48b442f93006e9712fd504e8b88d7a82e6e3bac9306a6b',
    // In the profile route's own chunk, not the main bundle (read 2026-11-08).
    userTopContent:
      '61b7353d3625780022dbc63d459eb64cd609e7e5e2a820f9160d65030efe2e15',
    fetchEntitiesForRecentlyPlayed:
      'cf5d2e94ffd82788470788ae1f6090cc3e9e774fb8fd383580634c6e6f50f7be',
  },
};
// Not under `spotify:`: these describe the web player, not an account, so sign-out keeps them.
const KEY = 'webplayer:spotify';
const TTL_S = 24 * 60 * 60;

export interface WebPlayerInfo {
  clientVersion: string;
  hashes: Record<Operation, string>;
}

async function text(url: string): Promise<string> {
  const response = await spotify().session.fetch(url);
  return response.ok ? response.text() : '';
}

/** `"fetchPlaylist","query","<64 hex>"` (or `"mutation"`), the way the web player's bundle declares its operations. */
export function queryHashIn(script: string, operation: string): string | null {
  return (
    new RegExp(
      `["']${operation}["']\\s*,\\s*["'](?:query|mutation)["']\\s*,\\s*["']([0-9a-f]{64})["']`,
    ).exec(script)?.[1] ?? null
  );
}

/** The page's base64 `appServerConfig` carries the client version the client-token call wants. */
export function clientVersionIn(html: string): string | null {
  const config =
    /<script id="appServerConfig" type="text\/plain">([^<]+)<\/script>/.exec(
      html,
    )?.[1];
  if (!config) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(config, 'base64').toString('utf8'),
    ) as { clientVersion?: unknown };
    return typeof parsed.clientVersion === 'string'
      ? parsed.clientVersion
      : null;
  } catch {
    return null;
  }
}

/**
 * Reads the web player's page and bundle at most once a day (or once after a
 * retired hash) and falls back to the last known values, as BitChord does.
 */
export async function webPlayer(refresh = false): Promise<WebPlayerInfo> {
  const known = cached<WebPlayerInfo>(KEY);
  // A cache from before an operation was added lacks its hash: read again.
  const complete = known && OPERATIONS.every((op) => known.hashes[op]);
  if (known && complete && !refresh) return known;
  try {
    const html = await text(`${WEB_PLAYER}/`);
    const bundleUrl =
      /https:\/\/open\.spotifycdn\.com\/cdn\/build\/web-player\/web-player\.[0-9a-f]+\.js/.exec(
        html,
      )?.[0];
    const bundle = bundleUrl ? await text(bundleUrl) : '';
    const fresh: WebPlayerInfo = {
      clientVersion:
        clientVersionIn(html) ?? known?.clientVersion ?? KNOWN.clientVersion,
      hashes: Object.fromEntries(
        OPERATIONS.map((op) => [
          op,
          queryHashIn(bundle, op) ?? known?.hashes[op] ?? KNOWN.hashes[op],
        ]),
      ) as Record<Operation, string>,
    };
    store(KEY, fresh, TTL_S);
    return fresh;
  } catch {
    return known ?? KNOWN;
  }
}
