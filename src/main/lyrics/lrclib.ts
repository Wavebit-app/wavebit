import { net } from 'electron';
import { AppError } from '../../shared/errors';
import {
  closest,
  forLyricsSearch,
  parseLrc,
  parsePlain,
  primaryArtist,
  type LrcLibHit,
} from '../../shared/lrc';
import type { Lyrics, LyricsQuery } from '../../shared/schemas/lyrics';
import { arr, at, num, readJson, str, type Json } from '../spotify/json';

const API = 'https://lrclib.net/api';
const TIMEOUT_MS = 10_000;

/** One LRCLIB call. A 404 is its "no such song", so it is null, not a failure. */
async function call(
  path: 'get' | 'search',
  params: Record<string, string>,
): Promise<Json | null> {
  let response: Response;
  try {
    response = await net.fetch(
      `${API}/${path}?${new URLSearchParams(params)}`,
      {
        // LRCLIB asks every app to name itself.
        headers: { 'User-Agent': 'wavebit (desktop music player)' },
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
  } catch {
    throw new AppError('network');
  }
  if (response.status === 404) return null;
  if (response.status === 429) throw new AppError('rate_limited');
  if (!response.ok) throw new AppError('network');
  return readJson(response);
}

function toHit(value: unknown): LrcLibHit {
  return {
    duration: num(at(value, 'duration')) ?? 0,
    syncedLyrics: str(at(value, 'syncedLyrics')),
    plainLyrics: str(at(value, 'plainLyrics')),
  };
}

function synced(lrc: string | null): Lyrics | null {
  const lines = lrc ? parseLrc(lrc) : [];
  return lines.some((l) => l.text) ? { kind: 'synced', lines } : null;
}

function plain(text: string | null): Lyrics | null {
  const lines = text ? parsePlain(text) : [];
  return lines.length > 0 ? { kind: 'plain', lines } : null;
}

/**
 * Lyrics for any song, by name, as BitChord's LrcLib does it: the exact
 * `get` for that length, then `search` for the closest length. Timed words
 * are preferred, from either; plain words are the last resort.
 */
export async function lrclib(song: LyricsQuery): Promise<Lyrics | null> {
  const track_name = forLyricsSearch(song.title);
  const artist_name = primaryArtist(song.artist);
  const seconds = Math.round(song.durationMs / 1000);
  const exact =
    seconds > 0 && artist_name
      ? await call('get', {
          track_name,
          artist_name,
          duration: String(seconds),
          ...(song.album && { album_name: song.album }),
        })
      : null;
  if (exact && at(exact, 'instrumental') === true)
    return { kind: 'instrumental', lines: [] };
  const found = synced(str(at(exact, 'syncedLyrics')));
  if (found) return found;
  const results = await call('search', {
    track_name,
    ...(artist_name && { artist_name }),
  });
  const hits = arr(at(results, 'values')).slice(0, 50).map(toHit);
  return (
    synced(closest(hits, seconds, 'syncedLyrics')) ??
    plain(str(at(exact, 'plainLyrics'))) ??
    plain(closest(hits, seconds, 'plainLyrics'))
  );
}
