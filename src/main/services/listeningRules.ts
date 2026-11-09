/** What Library's listening cards add up. Pure, so it can be tested. */
import type {
  Listened,
  ListeningSummary,
  ListenRow,
} from '../../shared/schemas/library.ts';

const FILE_ID = /^[0-9a-f]{16}$/;

const firstArtist = (artist: string) =>
  artist.split(/,\s*|\s+&\s+/)[0]?.trim() ?? '';

const fold = (text: string) => text.trim().toLowerCase();

export function addListen(
  rows: Record<string, ListenRow>,
  { song, ms, plays }: Listened,
  now: number,
): void {
  const known = rows[song.id];
  rows[song.id] = {
    ...song,
    playedAt: now,
    ms: (known?.ms ?? 0) + ms,
    plays: (known?.plays ?? 0) + plays,
  };
}

interface Group {
  rows: ListenRow[];
  ms: number;
  plays: number;
}

/** The group heard longest, plays breaking a tie. Songs never played don't count. */
function top(rows: ListenRow[], key: (row: ListenRow) => string): Group | null {
  const groups = new Map<string, Group>();
  for (const row of rows) {
    const name = key(row);
    if (!name || row.plays === 0) continue;
    const group = groups.get(name) ?? { rows: [], ms: 0, plays: 0 };
    group.rows.push(row);
    group.ms += row.ms;
    group.plays += row.plays;
    groups.set(name, group);
  }
  let best: Group | null = null;
  for (const group of groups.values())
    if (
      !best ||
      group.ms > best.ms ||
      (group.ms === best.ms && group.plays > best.plays)
    )
      best = group;
  best?.rows.sort((a, b) => b.ms - a.ms);
  return best;
}

const artworkOf = (group: Group) =>
  group.rows.find((row) => row.artwork)?.artwork ?? null;

export function summarize(rows: ListenRow[]): ListeningSummary {
  // A file and its stream are one song to the listener, so they add up.
  const song = top(
    rows,
    (r) => `${fold(r.title)}\n${fold(firstArtist(r.artist))}`,
  );
  const artist = top(rows, (r) => fold(firstArtist(r.artist)));
  const album = top(rows, (r) =>
    r.album ? `${fold(r.album)}\n${fold(firstArtist(r.artist))}` : '',
  );
  return {
    totalMs: rows.reduce((sum, row) => sum + row.ms, 0),
    totalPlays: rows.reduce((sum, row) => sum + row.plays, 0),
    topSong: song && {
      ...song.rows[0]!,
      artwork: artworkOf(song),
      ms: song.ms,
      plays: song.plays,
    },
    topArtist: artist && {
      name: firstArtist(artist.rows[0]!.artist),
      localName:
        artist.rows.find((row) => FILE_ID.test(row.id))?.artist ?? null,
      artwork: artworkOf(artist),
      ms: artist.ms,
      plays: artist.plays,
    },
    topAlbum: album && {
      title: album.rows[0]!.album,
      artist: firstArtist(album.rows[0]!.artist),
      albumKey: album.rows.find((row) => row.albumKey)?.albumKey ?? null,
      artwork: artworkOf(album),
      ms: album.ms,
      plays: album.plays,
    },
  };
}
