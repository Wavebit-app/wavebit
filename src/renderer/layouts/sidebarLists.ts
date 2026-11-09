import { primaryArtist } from '../../shared/lrc.ts';
import type { Playable } from '../features/player/player';

export interface RecentArtist {
  name: string;
  /** The credit as played; the library files its artists under it. */
  credit: string;
  /** A cover of theirs, until there's a picture of them. */
  art: string | null;
  /** Heard from a file here, so nothing needs asking online. */
  local: boolean;
}

/** The song playing now, then what was listened to; a song shows once. */
export function recentSongs(
  history: Playable[],
  current: Playable | undefined,
): Playable[] {
  if (!current) return history;
  return [current, ...history.filter((song) => song.id !== current.id)];
}

/** Each artist in those songs once, the latest listened to first. */
export function recentArtists(songs: Playable[]): RecentArtist[] {
  const found = new Map<string, RecentArtist>();
  for (const song of songs) {
    const name = primaryArtist(song.artist).trim();
    if (!name || /^unknown( artist)?$/i.test(name)) continue;
    const key = name.toLowerCase();
    const known = found.get(key);
    if (known) {
      known.local ||= !song.stream;
      known.art ??= song.artwork;
    } else
      found.set(key, {
        name,
        credit: song.artist,
        art: song.artwork,
        local: !song.stream,
      });
  }
  return [...found.values()];
}
