/** The lyric services, in their default order (DESIGN.md › Lyrics). */
export const LYRICS_SOURCES = [
  {
    id: 'lrc-red',
    label: 'lrc.red',
    detail: 'Apple timings, found by recording',
  },
  {
    id: 'bini',
    label: 'BiniLyrics',
    detail: 'Apple timings, matched on the recording',
  },
  {
    id: 'better-lyrics',
    label: 'BetterLyrics',
    detail: 'Apple Music timings',
  },
  {
    id: 'better-lyrics-portato',
    label: 'BetterLyrics Portato',
    detail: 'QQ Music timings through BetterLyrics',
  },
  { id: 'lyrics-plus', label: 'LyricsPlus', detail: 'Community mirrors' },
  { id: 'unison', label: 'Unison', detail: 'Contributed by listeners' },
  {
    id: 'youtube-music',
    label: 'YouTube Music',
    detail: 'Plain lyrics from the song’s Lyrics tab',
  },
  {
    id: 'kugou',
    label: 'KuGou',
    detail: 'Whole lines, strong outside English',
  },
  { id: 'lrclib', label: 'LRCLIB', detail: 'Whole lines, free and open' },
] as const;

export type LyricsSourceId = (typeof LYRICS_SOURCES)[number]['id'];

export const DEFAULT_LYRICS_ORDER: readonly LyricsSourceId[] =
  LYRICS_SOURCES.map((s) => s.id);

export const sourceLabel = (id: LyricsSourceId): string =>
  LYRICS_SOURCES.find((s) => s.id === id)!.label;

const known = (id: string): id is LyricsSourceId =>
  DEFAULT_LYRICS_ORDER.includes(id as LyricsSourceId);

/**
 * A saved order made current: ids this version doesn't know go, and a source
 * added since it was saved takes its place after the one listed before it.
 */
export function orderedSources(saved: readonly string[]): LyricsSourceId[] {
  const order = [...new Set(saved)].filter(known);
  DEFAULT_LYRICS_ORDER.forEach((id, i) => {
    if (order.includes(id)) return;
    const before = DEFAULT_LYRICS_ORDER.slice(0, i)
      .reverse()
      .find((b) => order.includes(b));
    order.splice(before ? order.indexOf(before) + 1 : 0, 0, id);
  });
  return order;
}

/** The sources to ask, in the order to trust them. */
export function enabledSources(
  order: readonly string[],
  off: readonly string[],
): LyricsSourceId[] {
  return orderedSources(order).filter((id) => !off.includes(id));
}
