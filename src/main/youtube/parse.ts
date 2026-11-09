/**
 * YouTube Music's home feed into shelves, after BitChord's InnertubeParser
 * (parseHome, carouselShelf, parseTwoRowItem, continuationToken). A shape
 * that moves reads as missing, never as a crash.
 */
import {
  YtCategoryParamsSchema,
  type YtArtist,
  type YtItem,
  type YtKind,
  type YtLayout,
  type YtMood,
  type YtMoodSection,
  type YtPage,
  type YtShelf,
  type YtTrack,
} from '../../shared/schemas/youtube';
import { arr, at, num, obj, str, type Json } from '../spotify/json';

/** YouTube's and Google's image CDNs: the hosts the renderer's CSP allows. */
const IMAGE_HOSTS = ['.googleusercontent.com', '.ggpht.com', '.ytimg.com'];

const runs = (v: unknown): string =>
  arr(at(v, 'runs'))
    .map((r) => str(at(r, 'text')) ?? '')
    .join('')
    .trim();

/** An https image on YouTube's CDNs, asked for at `size` where the URL allows it. */
export function ytImage(raw: string | null, size = 400): string | null {
  if (!raw) return null;
  const url = raw.startsWith('//') ? `https:${raw}` : raw;
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      !IMAGE_HOSTS.some((h) => parsed.hostname.endsWith(h))
    )
      return null;
    // Google's resizable images carry their size in the path: "=w60-h60-l90-rj".
    return url.replace(/=w\d+-h\d+/, `=w${size}-h${size}`);
  } catch {
    return null;
  }
}

/** The largest of a thumbnail list, and whether it is wider than tall. */
function thumb(list: unknown): { url: string | null; wide: boolean } {
  const best = arr(list)
    .map((t) => ({
      url: str(at(t, 'url')),
      w: num(at(t, 'width')) ?? 0,
      h: num(at(t, 'height')) ?? 0,
    }))
    .filter((t) => t.url)
    .sort((a, b) => b.w - a.w)[0];
  return {
    url: ytImage(best?.url ?? null),
    wide: !!best && best.h > 0 && best.w / best.h > 1.2,
  };
}

function kindOf(
  browseId: string | null,
  videoId: string | null,
  wide: boolean,
): YtKind {
  if (browseId?.startsWith('MPRE')) return 'album';
  if (browseId && /^(VL|PL|RD|OLAK)/.test(browseId)) return 'playlist';
  if (browseId?.startsWith('UC')) return 'artist';
  if (browseId) return 'page';
  return wide ? 'video' : videoId ? 'song' : 'page';
}

/** A card (`musicTwoRowItemRenderer`): an album, playlist, artist or a song. */
function twoRow(r: Json): YtItem | null {
  const title = runs(r.title);
  if (!title) return null;
  const endpoint = obj(r.navigationEndpoint);
  let browseId = str(at(endpoint, 'browseEndpoint', 'browseId'));
  // History cards for uncatalogued tracks point at "MPED<videoId>" pages.
  let videoId =
    str(at(endpoint, 'watchEndpoint', 'videoId')) ??
    (browseId?.startsWith('MPED') ? browseId.slice(4) : null);
  if (browseId?.startsWith('MPED')) browseId = null;
  if (videoId && !/^[A-Za-z0-9_-]{11}$/.test(videoId)) videoId = null;
  const image = thumb(
    at(
      r,
      'thumbnailRenderer',
      'musicThumbnailRenderer',
      'thumbnail',
      'thumbnails',
    ),
  );
  const wide = image.wide || /16_9/.test(str(r.aspectRatio) ?? '');
  return {
    kind: kindOf(browseId, videoId, !browseId && !!videoId && wide),
    title,
    subtitle: runs(r.subtitle),
    imageUrl: image.url,
    videoId,
    browseId,
  };
}

/** A row (`musicResponsiveListItemRenderer`): a song with its credit line. */
function listRow(r: Json): YtItem | null {
  const columns = arr(r.flexColumns).map((c) =>
    at(c, 'musicResponsiveListItemFlexColumnRenderer', 'text'),
  );
  const title = runs(columns[0]);
  if (!title) return null;
  const videoId =
    str(at(r, 'playlistItemData', 'videoId')) ??
    str(
      at(
        r,
        'overlay',
        'musicItemThumbnailOverlayRenderer',
        'content',
        'musicPlayButtonRenderer',
        'playNavigationEndpoint',
        'watchEndpoint',
        'videoId',
      ),
    );
  const browseId = str(
    at(r, 'navigationEndpoint', 'browseEndpoint', 'browseId'),
  );
  const image = thumb(
    at(r, 'thumbnail', 'musicThumbnailRenderer', 'thumbnail', 'thumbnails'),
  );
  if (!videoId && !browseId) return null;
  return {
    kind: videoId
      ? image.wide
        ? 'video'
        : 'song'
      : kindOf(browseId, null, false),
    title,
    subtitle: columns.slice(1).map(runs).filter(Boolean).join(' • '),
    imageUrl: image.url,
    videoId: videoId && /^[A-Za-z0-9_-]{11}$/.test(videoId) ? videoId : null,
    browseId: videoId ? null : browseId,
  };
}

function layoutOf(items: YtItem[], rows: boolean): YtLayout {
  if (rows) return 'tracks';
  if (items.every((i) => i.kind === 'artist')) return 'circle';
  if (items.filter((i) => i.kind === 'video').length > items.length / 2)
    return 'video';
  return 'square';
}

function carousel(c: Json): YtShelf | null {
  const header = obj(at(c, 'header', 'musicCarouselShelfBasicHeaderRenderer'));
  const contents = arr(c.contents);
  const rows = !!obj(at(contents[0], 'musicResponsiveListItemRenderer'));
  const items = contents.flatMap((item) => {
    const card = obj(at(item, 'musicTwoRowItemRenderer'));
    const row = obj(at(item, 'musicResponsiveListItemRenderer'));
    return (card && twoRow(card)) ?? (row && listRow(row)) ?? [];
  });
  if (!items.length) return null;
  return {
    title: runs(header?.title) || 'For you',
    strapline: runs(header?.strapline) || null,
    layout: layoutOf(items, rows),
    items,
  };
}

function plainShelf(s: Json): YtShelf | null {
  const items = arr(s.contents).flatMap((item) => {
    const row = obj(at(item, 'musicResponsiveListItemRenderer'));
    return (row && listRow(row)) ?? [];
  });
  if (!items.length) return null;
  return {
    title: runs(s.title) || 'For you',
    strapline: null,
    // Search's Albums, Artists and Playlists shelves are rows too, but of pages.
    layout: items.every((i) => i.videoId) ? 'tracks' : layoutOf(items, false),
    items,
  };
}

/**
 * Every shelf in a home response or a continuation of it, in order. The
 * first page and continuations wrap shelves differently, so they are walked
 * out wherever they are (parseHomeContinuation's approach).
 */
export function parseShelves(root: unknown): YtShelf[] {
  const out: YtShelf[] = [];
  const walk = (node: unknown, depth: number): void => {
    if (depth > 40) return;
    if (Array.isArray(node)) {
      for (const n of node) walk(n, depth + 1);
      return;
    }
    const o = obj(node);
    if (!o) return;
    const c = obj(o.musicCarouselShelfRenderer);
    const s = obj(o.musicShelfRenderer);
    if (c) {
      const shelf = carousel(c);
      if (shelf) out.push(shelf);
      return;
    }
    if (s) {
      const shelf = plainShelf(s);
      if (shelf) out.push(shelf);
      return;
    }
    for (const v of Object.values(o)) walk(v, depth + 1);
  };
  walk(root, 0);
  return out;
}

/** The next page's token: the first continuation renderer, else the older nextContinuationData. */
export function continuation(root: unknown): string | null {
  let found: string | null = null;
  const walk = (node: unknown, depth: number): void => {
    if (found || depth > 40) return;
    if (Array.isArray(node)) {
      for (const n of node) walk(n, depth + 1);
      return;
    }
    const o = obj(node);
    if (!o) return;
    const token =
      str(
        at(
          o,
          'continuationItemRenderer',
          'continuationEndpoint',
          'continuationCommand',
          'token',
        ),
      ) ?? str(at(o, 'nextContinuationData', 'continuation'));
    if (token) {
      found = token;
      return;
    }
    for (const v of Object.values(o)) walk(v, depth + 1);
  };
  walk(root, 0);
  return found;
}

/** The signed-in account from `account/account_menu`. */
export function parseAccount(root: unknown): {
  name: string;
  handle: string | null;
  imageUrl: string | null;
} | null {
  let header: Json | null = null;
  const walk = (node: unknown, depth: number): void => {
    if (header || depth > 30) return;
    if (Array.isArray(node)) return node.forEach((n) => walk(n, depth + 1));
    const o = obj(node);
    if (!o) return;
    header = obj(o.activeAccountHeaderRenderer);
    if (!header) for (const v of Object.values(o)) walk(v, depth + 1);
  };
  walk(root, 0);
  const h = header as Json | null;
  const name = h ? runs(h.accountName) : '';
  if (!h || !name) return null;
  return {
    name,
    handle: runs(h.channelHandle) || null,
    imageUrl: thumb(at(h, 'accountPhoto', 'thumbnails')).url,
  };
}

/** "3:45" or "1:02:03" in ms; 0 when it isn't a time. */
function duration(text: string): number {
  if (!/^\d+(?::\d{2}){1,2}$/.test(text)) return 0;
  return text.split(':').reduce((t, part) => t * 60 + Number(part), 0) * 1000;
}

/** Every renderer named `name` under `root`, in document order. */
function collect(root: unknown, name: string, limit = 2_000): Json[] {
  const out: Json[] = [];
  const walk = (node: unknown, depth: number): void => {
    if (out.length >= limit || depth > 60) return;
    if (Array.isArray(node)) return node.forEach((n) => walk(n, depth + 1));
    const o = obj(node);
    if (!o) return;
    const hit = obj(o[name]);
    if (hit) out.push(hit);
    for (const v of Object.values(o)) walk(v, depth + 1);
  };
  walk(root, 0);
  return out;
}

/** The one browse a mood or genre card may open; the id is never taken from a response. */
const CATEGORY_BROWSE = 'FEmusic_moods_and_genres_category';
const MAX_MOODS_PER_SECTION = 120;

function parseMood(button: Json): YtMood | null {
  const title = runs(button.buttonText).trim().slice(0, 80);
  const endpoint =
    obj(at(button, 'clickCommand', 'browseEndpoint')) ??
    obj(at(button, 'navigationEndpoint', 'browseEndpoint'));
  const params = YtCategoryParamsSchema.safeParse(endpoint?.params);
  if (!title || endpoint?.browseId !== CATEGORY_BROWSE || !params.success)
    return null;
  const argb = num(at(button, 'solid', 'leftStripeColor'));
  return {
    title,
    params: params.data,
    color:
      argb === null
        ? null
        : `#${(argb & 0xffffff).toString(16).padStart(6, '0')}`,
  };
}

/**
 * Explore's moods and genres, after BitChord's parseMoodAndGenres: each titled
 * grid of category buttons, in YouTube's order. "For you" only repeats the
 * cards below it, and an account's shortcut grid does too, so both go.
 */
export function parseMoods(root: unknown): YtMoodSection[] {
  const sections = collect(root, 'gridRenderer').flatMap((grid) => {
    const title = runs(at(grid, 'header', 'gridHeaderRenderer', 'title'));
    const items = arr(grid.items).flatMap((item) => {
      const button = obj(at(item, 'musicNavigationButtonRenderer'));
      return (button && parseMood(button)) ?? [];
    });
    return title && items.length
      ? [{ title, items: items.slice(0, MAX_MOODS_PER_SECTION) }]
      : [];
  });
  return sections.filter(
    (section, i) =>
      section.title.toLowerCase() !== 'for you' &&
      !section.items.some((item) =>
        sections
          .slice(i + 1)
          .some((later) =>
            later.items.some((other) => other.params === item.params),
          ),
      ),
  );
}

/**
 * The cards on a library feed (saved playlists, albums, artists), as
 * BitChord's parseLibraryItemPage reads them: grid cards or list rows,
 * whichever view the account last used, one per browse id.
 */
export function parseLibraryItems(root: unknown): YtItem[] {
  const out = new Map<string, YtItem>();
  for (const card of collect(root, 'musicTwoRowItemRenderer')) {
    const item = twoRow(card);
    if (item?.browseId && !out.has(item.browseId)) out.set(item.browseId, item);
  }
  for (const row of collect(root, 'musicResponsiveListItemRenderer')) {
    const item = listRow(row);
    if (item?.browseId && !out.has(item.browseId)) out.set(item.browseId, item);
  }
  return [...out.values()];
}

/** One song row on a page; the page's own credit and cover fill what a row leaves out. */
function trackRow(
  r: Json,
  fallback: {
    artists: string | null;
    album: string | null;
    imageUrl: string | null;
  },
): YtTrack | null {
  const item = listRow(r);
  if (!item?.videoId) return null;
  const columns = arr(r.flexColumns).map((c) =>
    runs(at(c, 'musicResponsiveListItemFlexColumnRenderer', 'text')),
  );
  const fixed = arr(r.fixedColumns).map((c) =>
    runs(at(c, 'musicResponsiveListItemFixedColumnRenderer', 'text')),
  );
  return {
    videoId: item.videoId,
    title: item.title,
    artists: columns[1] || fallback.artists || '',
    // On an album the third column is a play count ("566K plays"); the album is the page.
    album: fallback.album ?? (columns[2] || null),
    durationMs: duration(fixed[0] ?? ''),
    imageUrl: item.imageUrl ?? fallback.imageUrl,
    localId: null,
    localAlbumKey: null,
  };
}

/**
 * An album or playlist page: the header (musicResponsiveHeaderRenderer, or
 * the older detail headers), its save toggle as BitChord's
 * parseLibraryState reads it (the bookmark toggle, and the play button's
 * playlist id), and its song rows. A continuation has rows only.
 */
export function parsePage(
  root: unknown,
  browseId: string,
): Omit<YtPage, 'items' | 'next'> & { rows: Json[] } {
  const header =
    collect(root, 'musicResponsiveHeaderRenderer', 1)[0] ??
    collect(root, 'musicEditablePlaylistDetailHeaderRenderer', 1)[0] ??
    collect(root, 'musicDetailHeaderRenderer', 1)[0] ??
    null;
  const inner =
    obj(at(header, 'header', 'musicDetailHeaderRenderer')) ?? header;
  const buttons = arr(inner?.buttons);
  const toggle = buttons
    .map((b) => obj(at(b, 'toggleButtonRenderer')))
    .find(
      (t) =>
        str(at(t, 'defaultIcon', 'iconType')) === 'BOOKMARK_BORDER' ||
        str(at(t, 'toggledIcon', 'iconType')) === 'BOOKMARK',
    );
  const play = buttons
    .map((b) => obj(at(b, 'musicPlayButtonRenderer', 'playNavigationEndpoint')))
    .find(Boolean);
  const playlistId =
    str(at(play, 'watchPlaylistEndpoint', 'playlistId')) ??
    str(at(play, 'watchEndpoint', 'playlistId'));
  const description =
    runs(
      at(inner, 'description', 'musicDescriptionShelfRenderer', 'description'),
    ) || runs(inner?.description);
  const image = thumb(
    at(
      inner,
      'thumbnail',
      'musicThumbnailRenderer',
      'thumbnail',
      'thumbnails',
    ) ??
      at(
        inner,
        'thumbnail',
        'croppedSquareThumbnailRenderer',
        'thumbnail',
        'thumbnails',
      ),
  );
  return {
    kind: browseId.startsWith('MPRE') ? 'album' : 'playlist',
    title: runs(inner?.title),
    subtitle: runs(inner?.subtitle),
    byline: runs(inner?.straplineTextOne) || null,
    bylineId:
      arr(at(inner, 'straplineTextOne', 'runs'))
        .map((r) =>
          str(at(r, 'navigationEndpoint', 'browseEndpoint', 'browseId')),
        )
        .find(
          (id): id is string => !!id && /^UC[A-Za-z0-9_-]{10,40}$/.test(id),
        ) ?? null,
    meta: runs(inner?.secondSubtitle) || null,
    description: description ? description.slice(0, 600) : null,
    imageUrl: ytImage(image.url, 600),
    save:
      toggle && playlistId && str(toggle.isDisabled) !== 'true'
        ? { playlistId, saved: toggle.isToggled === true }
        : null,
    rows: collect(root, 'musicResponsiveListItemRenderer'),
  };
}

export function pageTracks(
  rows: Json[],
  fallback: {
    artists: string | null;
    album: string | null;
    imageUrl: string | null;
  },
): YtTrack[] {
  return rows.flatMap((r) => trackRow(r, fallback) ?? []);
}

/** An artist page (UC…): the immersive or visual header, then the same shelves Home uses. */
export function parseArtist(root: unknown): YtArtist {
  const header =
    collect(root, 'musicImmersiveHeaderRenderer', 1)[0] ??
    collect(root, 'musicVisualHeaderRenderer', 1)[0] ??
    collect(root, 'musicResponsiveHeaderRenderer', 1)[0] ??
    null;
  const image = thumb(
    at(
      header,
      'thumbnail',
      'musicThumbnailRenderer',
      'thumbnail',
      'thumbnails',
    ) ??
      at(
        header,
        'foregroundThumbnail',
        'musicThumbnailRenderer',
        'thumbnail',
        'thumbnails',
      ),
  );
  const description = runs(header?.description);
  return {
    name: runs(header?.title) || 'Artist',
    description: description ? description.slice(0, 600) : null,
    imageUrl: ytImage(image.url, 800),
    subscribers:
      runs(
        at(
          header,
          'subscriptionButton',
          'subscribeButtonRenderer',
          'subscriberCountText',
        ),
      ) || null,
    shelves: parseShelves(root),
  };
}

/** A Songs-filtered search result row: id, title, credit and length. */
export interface SearchSong {
  videoId: string;
  title: string;
  artists: string;
  durationMs: number;
}

/** The rows of a Songs search: "Artist • Album • 3:45" under each title. */
export function parseSearchSongs(root: unknown): SearchSong[] {
  return collect(root, 'musicResponsiveListItemRenderer', 40).flatMap((r) => {
    const item = listRow(r);
    if (!item?.videoId) return [];
    const parts = runs(
      at(
        arr(r.flexColumns)[1],
        'musicResponsiveListItemFlexColumnRenderer',
        'text',
      ),
    )
      .split(' • ')
      .map((p) => p.trim())
      .filter(Boolean);
    const length = parts.find((p) => /^\d+(?::\d{2}){1,2}$/.test(p)) ?? '';
    const credit = parts.find(
      (p) => !/^(song|video)$/i.test(p) && !/^\d+(?::\d{2}){1,2}$/.test(p),
    );
    return [
      {
        videoId: item.videoId,
        title: item.title,
        artists: credit ?? '',
        durationMs: duration(length),
      },
    ];
  });
}

/** One song of a radio (`next` on RDAMVM<id>): YouTube's queue panel rows. */
export interface RadioSong {
  videoId: string;
  title: string;
  artists: string;
  durationMs: number;
  imageUrl: string | null;
  /** YouTube's ATV type is the catalogue song; OMV and UGC are videos. */
  isVideo: boolean;
}

export function parseRadio(root: unknown): RadioSong[] {
  return collect(root, 'playlistPanelVideoRenderer', 60).flatMap((r) => {
    const videoId = str(r.videoId);
    const title = runs(r.title);
    if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId) || !title) return [];
    const type = str(
      at(
        r,
        'navigationEndpoint',
        'watchEndpoint',
        'watchEndpointMusicSupportedConfigs',
        'watchEndpointMusicConfig',
        'musicVideoType',
      ),
    );
    return [
      {
        videoId,
        title,
        artists:
          runs(r.shortBylineText) ||
          runs(r.longBylineText).split(' • ')[0] ||
          '',
        durationMs: duration(runs(r.lengthText)),
        imageUrl: thumb(at(r, 'thumbnail', 'thumbnails')).url,
        isVideo: !!type && type !== 'MUSIC_VIDEO_TYPE_ATV',
      },
    ];
  });
}

/**
 * A search page as shelves. YouTube Music now sends its results as one
 * itemSection per row plus a top-result card rather than titled shelves, so
 * the rows are grouped by what they are, the top result leading its group.
 */
export function parseSearch(root: unknown): YtShelf[] {
  const top = collect(root, 'musicCardShelfRenderer', 1)[0];
  const lead = top
    ? (() => {
        const endpoint = obj(top.title)
          ? at(arr(at(top, 'title', 'runs'))[0], 'navigationEndpoint')
          : null;
        const videoId = str(at(endpoint, 'watchEndpoint', 'videoId'));
        const browseId = str(at(endpoint, 'browseEndpoint', 'browseId'));
        const title = runs(top.title);
        if (!title || (!videoId && !browseId)) return null;
        const image = thumb(
          at(
            top,
            'thumbnail',
            'musicThumbnailRenderer',
            'thumbnail',
            'thumbnails',
          ),
        );
        const item: YtItem = {
          kind: videoId
            ? image.wide
              ? 'video'
              : 'song'
            : kindOf(browseId, null, false),
          title,
          subtitle: runs(top.subtitle),
          imageUrl: image.url,
          videoId:
            videoId && /^[A-Za-z0-9_-]{11}$/.test(videoId) ? videoId : null,
          browseId: videoId ? null : browseId,
        };
        return item;
      })()
    : null;
  const rows = collect(root, 'musicResponsiveListItemRenderer', 80).flatMap(
    (r) => listRow(r) ?? [],
  );
  const groups: [string, (i: YtItem) => boolean, YtLayout][] = [
    ['Songs', (i) => i.kind === 'song', 'tracks'],
    ['Videos', (i) => i.kind === 'video', 'tracks'],
    ['Albums', (i) => i.kind === 'album', 'square'],
    ['Artists', (i) => i.kind === 'artist', 'circle'],
    ['Playlists', (i) => i.kind === 'playlist', 'square'],
  ];
  const shelves: YtShelf[] = [];
  if (lead)
    shelves.push({
      title: 'Top result',
      strapline: null,
      layout:
        lead.kind === 'artist' ? 'circle' : lead.videoId ? 'tracks' : 'square',
      items: [lead],
    });
  for (const [title, test, layout] of groups) {
    const items = rows.filter(test);
    if (items.length) shelves.push({ title, strapline: null, layout, items });
  }
  return shelves;
}
