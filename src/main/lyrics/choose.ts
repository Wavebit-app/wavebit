import type { LyricsSourceId } from '../../shared/lyricsSources';
import type { FoundLyrics, Lyrics } from '../../shared/schemas/lyrics';

/** One source's answer: its lyrics, null for "doesn't have it", or that it couldn't be reached. */
export type Answer = Lyrics | null | 'failed';

/**
 * The answer to show. Sources are asked together and read in the listed
 * order, so a lower one finishing first can't jump ahead: the first with
 * timed lines wins at once, and otherwise the first with anything at all.
 * `'failed'` only when no source could be reached.
 */
export async function chooseLyrics(
  sources: readonly LyricsSourceId[],
  answers: readonly Promise<Answer>[],
): Promise<FoundLyrics | null | 'failed'> {
  let fallback: FoundLyrics | null = null;
  let failures = 0;
  for (const [i, pending] of answers.entries()) {
    const answer = await pending;
    if (answer === 'failed') failures += 1;
    else if (answer) {
      const found = { ...answer, source: sources[i]! } as FoundLyrics;
      if (answer.kind === 'synced') return found;
      fallback ??= found;
    }
  }
  if (fallback) return fallback;
  return failures > 0 && failures === answers.length ? 'failed' : null;
}
