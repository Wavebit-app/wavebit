import { createHash } from 'node:crypto';
import { AppError } from '../../shared/errors';
import {
  enabledSources,
  type LyricsSourceId,
} from '../../shared/lyricsSources';
import type {
  FoundLyrics,
  Lyrics,
  LyricsQuery,
} from '../../shared/schemas/lyrics';
import { cached, store } from '../services/cache';
import { readSettings } from '../services/settings';
import { chooseLyrics, type Answer } from './choose';
import { PROVIDERS } from './providers';

const HIT_TTL_S = 30 * 24 * 60 * 60;
/** A song may gain lyrics, so a miss isn't kept long. */
const MISS_TTL_S = 12 * 60 * 60;

/** One source's answer, kept per source so a change of order costs no new requests. */
async function ask(source: LyricsSourceId, song: LyricsQuery): Promise<Answer> {
  const id = createHash('sha256')
    .update(`${song.title}\n${song.artist}\n${song.album}\n${song.durationMs}`)
    .digest('hex')
    .slice(0, 32);
  const key = `lyrics:${source}:${id}`;
  const hit = cached<{ lyrics: Lyrics | null }>(key);
  if (hit) return hit.lyrics;
  try {
    const found = await PROVIDERS[source](song);
    store(key, { lyrics: found }, found ? HIT_TTL_S : MISS_TTL_S);
    return found;
  } catch {
    // Not cached, so the next try asks again.
    return 'failed';
  }
}

/** A song's lyrics from the enabled sources, or null when none has them. */
export async function lyrics(song: LyricsQuery): Promise<FoundLyrics | null> {
  const settings = readSettings();
  // Asked for a bare title, most sources guess; LRCLIB's answers are checked by length.
  const known = song.artist.trim() !== '' && song.artist !== 'Unknown artist';
  const sources = enabledSources(
    settings.lyricsSourceOrder,
    settings.lyricsSourcesOff,
  ).filter((source) => known || source === 'lrclib');
  const found = await chooseLyrics(
    sources,
    sources.map((source) => ask(source, song)),
  );
  if (found === 'failed') throw new AppError('network');
  return found;
}
