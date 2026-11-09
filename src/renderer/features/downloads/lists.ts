import type { DownloadList } from '../../../shared/schemas/downloads';
import { spotifyPages, ytPages } from '../menus/menus';
import type { Playable } from '../player/player';
import { queueSongs } from './downloads';
import { downloadLists, trackKey } from './store';

const api = () => window.wavebit;
/** Far past any real list; the queue's own limit is the one that matters. */
const WHOLE_LIST = 20_000;

/** Every song of a list, read when it's needed. */
export function loadList(list: DownloadList): Promise<Playable[]> {
  if (list.kind === 'spotifyPlaylist')
    return spotifyPages(
      (offset) => api().spotify.playlist(list.id, offset),
      WHOLE_LIST,
    );
  if (list.kind === 'spotifyAlbum')
    return spotifyPages(
      (offset) => api().spotify.album(list.id, offset),
      WHOLE_LIST,
    );
  return ytPages(list.id, WHOLE_LIST);
}

export interface LibraryPart {
  list: DownloadList;
  tracks: Playable[];
}

async function readLists(lists: DownloadList[]): Promise<LibraryPart[]> {
  const parts: LibraryPart[] = [];
  for (const list of lists) {
    // One list that can't be read shouldn't stop the others.
    const tracks = await loadList(list).catch(() => []);
    if (tracks.length) parts.push({ list, tracks });
  }
  return parts;
}

/** Everything saved in the signed-in Spotify and YouTube Music accounts. */
export async function readWholeLibrary(): Promise<LibraryPart[]> {
  const lists: DownloadList[] = [];
  if ((await api().spotify.status()).state === 'signed_in') {
    const [playlists, albums] = await Promise.all([
      api()
        .spotify.playlists()
        .catch(() => []),
      api()
        .spotify.albums()
        .catch(() => []),
    ]);
    for (const p of playlists)
      lists.push({ kind: 'spotifyPlaylist', id: p.id, title: p.name });
    for (const a of albums)
      lists.push({ kind: 'spotifyAlbum', id: a.id, title: a.name });
  }
  if ((await api().youtube.status()).state === 'signed_in') {
    const library = await api()
      .youtube.library()
      .catch(() => null);
    for (const item of [
      ...(library?.playlists ?? []),
      ...(library?.albums ?? []),
    ])
      if (item.browseId && /^(MPRE|VL)/.test(item.browseId))
        lists.push({ kind: 'ytPage', id: item.browseId, title: item.title });
  }
  return readLists(lists);
}

export function countSongs(parts: LibraryPart[]): number {
  const keys = new Set<string>();
  for (const { tracks } of parts)
    for (const track of tracks) {
      const key = trackKey(track);
      if (key) keys.add(key);
    }
  return keys.size;
}

export async function queueLibrary(parts: LibraryPart[]): Promise<number> {
  let added = 0;
  for (const { list, tracks } of parts)
    added += (await queueSongs(tracks, list)).added;
  return added;
}

/** "Keep downloaded playlists up to date": anything new goes in the queue. */
export async function syncDownloadedLists(): Promise<void> {
  await queueLibrary(await readLists(downloadLists()));
}
