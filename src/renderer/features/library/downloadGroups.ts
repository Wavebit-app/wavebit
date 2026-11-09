import type {
  AlbumSummary,
  ArtistSummary,
  LocalTrack,
} from '../../../shared/schemas/library.ts';

/** The albums downloaded songs belong to, newest download first. */
export function albumsOf(tracks: LocalTrack[]): AlbumSummary[] {
  const albums = new Map<string, AlbumSummary>();
  for (const t of tracks) {
    if (!t.album) continue;
    const known = albums.get(t.albumKey);
    albums.set(t.albumKey, {
      key: t.albumKey,
      title: t.album,
      artist: known?.artist ?? t.artist,
      trackCount: (known?.trackCount ?? 0) + 1,
      durationMs: (known?.durationMs ?? 0) + t.durationMs,
      hasArt: !!known?.hasArt || t.hasArt,
    });
  }
  return [...albums.values()];
}

/** The artists of downloaded songs, by the credit on the file. */
export function artistsOf(tracks: LocalTrack[]): ArtistSummary[] {
  const artists = new Map<string, { row: ArtistSummary; keys: Set<string> }>();
  for (const t of tracks) {
    if (!t.artist) continue;
    const known = artists.get(t.artist) ?? {
      row: { name: t.artist, albumCount: 0, trackCount: 0 },
      keys: new Set<string>(),
    };
    if (t.album) known.keys.add(t.albumKey);
    known.row.trackCount += 1;
    known.row.albumCount = known.keys.size;
    if (t.hasArt) known.row.artKey ??= t.albumKey;
    artists.set(t.artist, known);
  }
  return [...artists.values()].map((a) => a.row);
}

/** Narrows the list as the filter pill does, ignoring case. */
export function matching(tracks: LocalTrack[], query: string): LocalTrack[] {
  const q = query.toLowerCase();
  if (!q) return tracks;
  return tracks.filter((t) =>
    `${t.title}\n${t.artist}\n${t.album}`.toLowerCase().includes(q),
  );
}
