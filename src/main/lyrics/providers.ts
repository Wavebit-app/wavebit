import {
  forLyricsSearch,
  parseLrc,
  parsePlain,
  primaryArtist,
} from '../../shared/lrc';
import {
  lrcRedUrl,
  parseKugou,
  parseLyricsPlus,
  parseQrc,
  parseTtml,
  sameRecording,
  type RecordingHit,
} from '../../shared/lyricsParse';
import type { LyricsSourceId } from '../../shared/lyricsSources';
import type { Lyrics, LyricsQuery } from '../../shared/schemas/lyrics';
import { arr, at, num, obj, str, type Json } from '../spotify/json';
import { innertube } from '../youtube/innertube';
import { match } from '../youtube/service';
import { getJson, getText, withParams } from './http';
import { lrclib } from './lrclib';

type Provider = (song: LyricsQuery) => Promise<Lyrics | null>;

function asked(song: LyricsQuery) {
  return {
    title: forLyricsSearch(song.title),
    artist: primaryArtist(song.artist),
    album: song.album,
    seconds: Math.floor(song.durationMs / 1000) || null,
  };
}

const document = async (url: string | null) => {
  const ttml = url ? await getText(url) : null;
  return ttml ? parseTtml(ttml) : null;
};

const lrcRed: Provider = async (song) => {
  const { title, artist, seconds } = asked(song);
  const body = await getJson(
    withParams('https://lrc.red/search.json', {
      q: `${title} ${artist}`.trim(),
    }),
  );
  const hits = arr(at(body, 'hits')) as RecordingHit[];
  return document(
    lrcRedUrl(sameRecording(hits, title, artist, seconds ?? 0)?.isrc),
  );
};

const bini: Provider = async (song) => {
  const { title, artist, album, seconds } = asked(song);
  const body = await getJson(
    // lyrics-api.binimum.org redirects its searches here.
    withParams('https://lrc.red/api/v1', {
      track: title,
      artist,
      album,
      duration: seconds,
    }),
  );
  // Read from lrc.red by its ISRC, never from an address in the response.
  return document(lrcRedUrl(at(arr(at(body, 'results'))[0], 'isrc')));
};

/** BetterLyrics answers with TTML, or with QQ Music's karaoke text from the Portato route. */
function betterLyrics(endpoint: string): Provider {
  return async (song) => {
    const { title, artist, album, seconds } = asked(song);
    const body = await getJson(
      withParams(endpoint, { s: title, a: artist, d: seconds, al: album }),
    );
    const ttml = str(at(body, 'ttml'));
    if (ttml) return parseTtml(ttml);
    const karaoke = str(at(body, 'lyrics'));
    return karaoke ? parseQrc(karaoke) : null;
  };
}

const LYRICS_PLUS = [
  'https://lyricsplus.prjktla.my.id',
  'https://lyricsplus.binimum.org',
];

/** Volunteer mirrors, asked together. The first with lyrics answers; failing means all failed. */
const lyricsPlus: Provider = (song) => {
  const { title, artist, album, seconds } = asked(song);
  return new Promise((resolve, reject) => {
    let waiting = LYRICS_PLUS.length;
    let failure: unknown = null;
    const finish = () => {
      if (--waiting > 0) return;
      if (failure) reject(failure as Error);
      else resolve(null);
    };
    for (const host of LYRICS_PLUS)
      getJson(
        withParams(`${host}/v2/lyrics/get`, {
          title,
          artist,
          album,
          duration: seconds,
        }),
      ).then(
        (body) => {
          const found = parseLyricsPlus(arr(at(body, 'lyrics')) as []);
          if (found) resolve(found);
          finish();
        },
        (error: unknown) => {
          failure = error;
          finish();
        },
      );
  });
};

const unison: Provider = async (song) => {
  const { title, artist, album, seconds } = asked(song);
  const body = await getJson(
    withParams('https://unison.boidu.dev/lyrics', {
      song: title,
      artist,
      album,
      duration: seconds,
    }),
  );
  if (at(body, 'success') !== true) return null;
  const text = str(at(body, 'data', 'lyrics'))?.trim();
  if (!text) return null;
  if (str(at(body, 'data', 'format'))?.toLowerCase() === 'ttml')
    return parseTtml(text);
  const timed = parseLrc(text);
  if (timed.some((l) => l.text)) return { kind: 'synced', lines: timed };
  const plain = parsePlain(text);
  return plain.length ? { kind: 'plain', lines: plain } : null;
};

/** The first object under `key`, however deep YouTube has nested it. */
function deepFind(node: unknown, key: string): Json | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = deepFind(child, key);
      if (found) return found;
    }
    return null;
  }
  const object = obj(node);
  if (!object) return null;
  if (obj(object[key])) return obj(object[key]);
  for (const value of Object.values(object)) {
    const found = deepFind(value, key);
    if (found) return found;
  }
  return null;
}

/** The Lyrics tab on a song's page. It carries no timing, so these are always plain. */
const youtubeMusic: Provider = async (song) => {
  const artist = primaryArtist(song.artist);
  const videoId =
    song.videoId ??
    (
      await match({
        title: forLyricsSearch(song.title),
        artists: artist ? [artist] : [],
        durationMs: song.durationMs,
      })
    )?.videoId;
  if (!videoId) return null;
  const tabs = arr(
    deepFind(
      await innertube('next', { videoId, isAudioOnly: true }),
      'watchNextTabbedResultsRenderer',
    )?.tabs,
  );
  const browseId = tabs
    .map((tab) =>
      str(at(tab, 'tabRenderer', 'endpoint', 'browseEndpoint', 'browseId')),
    )
    .find((id) => id?.startsWith('MPLY'));
  if (!browseId) return null;
  const shelf = deepFind(
    await innertube('browse', { browseId }),
    'musicDescriptionShelfRenderer',
  );
  const text = arr(at(shelf, 'description', 'runs'))
    .map((run) => str(at(run, 'text')) ?? '')
    .join('');
  const lines = parsePlain(text);
  return lines.length ? { kind: 'plain', lines } : null;
};

interface KugouCandidate {
  id?: unknown;
  accesskey?: unknown;
}

/** How many songs from KuGou's search are tried for lyrics. */
const KUGOU_TRIES = 4;
/** Seconds a KuGou song can be from ours and still be the same recording. */
const KUGOU_LENGTH_OFF_S = 8;

const firstCandidate = async (
  params: Record<string, string | number | null>,
): Promise<KugouCandidate | undefined> => {
  const search = await getJson(
    withParams('https://lyrics.kugou.com/search', {
      ver: 1,
      man: 'yes',
      client: 'pc',
      ...params,
    }),
  );
  return arr(at(search, 'candidates'))[0] as KugouCandidate | undefined;
};

/** KuGou finds lyrics far better by its own song hash than by name, so that goes first. */
async function kugouCandidate(
  keyword: string,
  seconds: number | null,
): Promise<KugouCandidate | undefined> {
  const songs = await getJson(
    withParams('https://mobileservice.kugou.com/api/v3/search/song', {
      version: 9108,
      plat: 0,
      pagesize: 8,
      showtype: 0,
      keyword,
    }),
  );
  const off = (song: unknown) =>
    Math.abs((num(at(song, 'duration')) ?? 0) - (seconds ?? 0));
  const hashes = arr(at(songs, 'data', 'info'))
    .filter((song) => !seconds || off(song) <= KUGOU_LENGTH_OFF_S)
    .sort((a, b) => off(a) - off(b))
    .slice(0, KUGOU_TRIES)
    .map((song) => str(at(song, 'hash')));
  for (const hash of hashes) {
    const found = hash ? await firstCandidate({ hash }) : undefined;
    if (found) return found;
  }
  return firstCandidate({
    keyword,
    duration: seconds ? seconds * 1000 : null,
  });
}

const kugou: Provider = async (song) => {
  const { title, artist, album, seconds } = asked(song);
  const keyword = `${title.replace(/\s*[([].*?[)\]]/g, '')} - ${artist}${album ? ` ${album}` : ''}`;
  const best = await kugouCandidate(keyword, seconds);
  if (typeof best?.id !== 'string' || typeof best.accesskey !== 'string')
    return null;
  const download = await getJson(
    withParams('https://lyrics.kugou.com/download', {
      fmt: 'lrc',
      charset: 'utf8',
      client: 'pc',
      ver: 1,
      id: best.id,
      accesskey: best.accesskey,
    }),
  );
  const content = str(at(download, 'content'));
  return content
    ? parseKugou(Buffer.from(content, 'base64').toString('utf8'))
    : null;
};

export const PROVIDERS: Record<LyricsSourceId, Provider> = {
  'lrc-red': lrcRed,
  bini,
  'better-lyrics': betterLyrics('https://lyrics-api.boidu.dev/getLyrics'),
  'better-lyrics-portato': betterLyrics(
    'https://lyrics-api.boidu.dev/qq/getLyrics',
  ),
  'lyrics-plus': lyricsPlus,
  unison,
  'youtube-music': youtubeMusic,
  kugou,
  lrclib,
};
