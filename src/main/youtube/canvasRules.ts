import { arr, at, obj, str, type Json } from '../spotify/json.ts';

/**
 * The YouTube Canvas's rules: which music video goes with a song. Pure, so
 * they are tested without YouTube.
 */

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export interface CanvasVideo {
  videoId: string;
  /** Where the song starts in the video, or null when that isn't known. */
  offsetMs: number | null;
}

/** Every object under `root` holding `name`, in document order. */
function collect(root: unknown, name: string, limit: number): Json[] {
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

/**
 * The music video YouTube Music pairs with a song (its Song/Video switch),
 * from a `next` response: the counterpart of the panel row for `videoId`,
 * and where the video is when the song starts, from the first segment of
 * its time map. It is only sent to signed-in accounts. Null when there is
 * none.
 */
export function parseCounterpart(
  root: unknown,
  videoId: string,
): CanvasVideo | null {
  for (const wrapper of collect(
    root,
    'playlistPanelVideoWrapperRenderer',
    80,
  )) {
    const primary = obj(
      at(wrapper, 'primaryRenderer', 'playlistPanelVideoRenderer'),
    );
    if (str(primary?.videoId) !== videoId) continue;
    for (const entry of arr(wrapper.counterpart)) {
      const counter = obj(
        at(entry, 'counterpartRenderer', 'playlistPanelVideoRenderer'),
      );
      const id = str(counter?.videoId);
      if (!id || id === videoId || !VIDEO_ID.test(id)) continue;
      const segment = obj(arr(at(entry, 'segmentMap', 'segment'))[0]);
      const song = Number(str(segment?.primaryVideoStartTimeMilliseconds) ?? 0);
      const video = Number(
        str(segment?.counterpartVideoStartTimeMilliseconds) ?? 0,
      );
      const offset =
        Number.isFinite(song) && Number.isFinite(video) ? video - song : 0;
      return {
        videoId: id,
        offsetMs: Math.max(-600_000, Math.min(600_000, offset)),
      };
    }
  }
  return null;
}

/** Lower case, brackets dropped, letters and digits only. */
export const core = (title: string) =>
  title
    .toLowerCase()
    .replace(/[([].*?[)\]]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** Words in a video's title (beyond the song's own) that mean it isn't the music video. */
const NOT_THE_VIDEO =
  /\b(cover|reaction|lyrics?|karaoke|instrumental|live|remix|sped up|slowed|8d|nightcore|tutorial|piano)\b/;

/**
 * The music video among YouTube Music's search results for a song: a video
 * whose title holds the song's title, credited to the song's first artist,
 * and not a cover, a lyric video, a live take or the like. The first such,
 * as YouTube ranks them. Null when none qualifies.
 */
export function pickCanvasVideo(
  items: readonly {
    kind: string;
    title: string;
    subtitle: string;
    videoId: string | null;
  }[],
  song: { videoId: string; title: string; artist: string },
): CanvasVideo | null {
  const title = core(song.title);
  const artist = core(song.artist.split(/,| & | x | feat\.? /i)[0] ?? '');
  if (!title || !artist) return null;
  const found = items.find((item) => {
    if (item.kind !== 'video' || !item.videoId) return false;
    if (item.videoId === song.videoId || !VIDEO_ID.test(item.videoId))
      return false;
    // The original title, brackets included: "(Lyrics)" and "(Live)" sit in them.
    const raw = item.title.toLowerCase();
    return (
      core(item.title).includes(title) &&
      core(item.subtitle).includes(artist) &&
      !NOT_THE_VIDEO.test(raw.replace(song.title.toLowerCase(), ''))
    );
  });
  return found?.videoId ? { videoId: found.videoId, offsetMs: null } : null;
}
