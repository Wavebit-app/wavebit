import type { SpotifyRecent } from '../../shared/schemas/spotify';
import { arr, at, num, obj, sized, spotifyId, str, time } from './json.ts';
import type { RawTrack } from './pathfinder';

export function namedArtists(
  list: unknown,
): { id: string | null; name: string }[] {
  return arr(list).flatMap((a) => {
    const name = str(at(a, 'name'))?.trim();
    return name ? [{ name, id: spotifyId(at(a, 'id')) }] : [];
  });
}

/**
 * One row from the Web API. Since February 2026 a playlist's song sits under
 * `item` (it was `track`, which other lists still use); episodes are left out.
 */
export function rowTrack(row: unknown): RawTrack | null {
  const data = obj(at(row, 'item')) ?? obj(at(row, 'track'));
  const uri = str(data?.uri);
  const title = str(data?.name)?.trim();
  if (!data || !uri || !title || str(data.type) === 'episode') return null;
  const artists = namedArtists(data.artists);
  return {
    uri,
    title,
    artists: artists.map((a) => a.name),
    artistIds: artists.map((a) => a.id),
    album: str(at(data, 'album', 'name')),
    albumId: spotifyId(at(data, 'album', 'id')),
    durationMs: num(data.duration_ms) ?? 0,
    imageUrl: sized(at(data, 'album', 'images'), 64),
    addedAt: time(at(row, 'added_at')),
  };
}

export type RecentCard = Omit<SpotifyRecent, 'track'> & { track: RawTrack };

export interface RecentPlays {
  items: RecentCard[];
  /** The `before` for the next page back, or null at the end. */
  before: number | null;
}

/** GET /me/player/recently-played takes `before` or `after`, never both; wavebit only pages back. */
export function recentPlaysUrl(api: string, before?: number): string {
  const page = before ? `&before=${before}` : '';
  return `${api}/v1/me/player/recently-played?limit=50${page}`;
}

/** One card per song, newest first: a song played twice on the page shows once. */
export function parseRecentPlays(body: unknown): RecentPlays {
  const seen = new Set<string>();
  const items = arr(at(body, 'items')).flatMap((row): RecentCard[] => {
    const track = rowTrack(row);
    const id = spotifyId(track?.uri);
    if (!track || !id || seen.has(id)) return [];
    seen.add(id);
    return [
      {
        kind: 'track',
        id,
        name: track.title,
        subtitle: track.artists.join(', ') || null,
        imageUrl: sized(at(row, 'track', 'album', 'images'), 300),
        playedAt: time(at(row, 'played_at')),
        track,
      },
    ];
  });
  const cursor = Number(at(body, 'cursors', 'before'));
  return {
    items,
    before:
      at(body, 'next') && Number.isSafeInteger(cursor) && cursor > 0
        ? cursor
        : null,
  };
}
