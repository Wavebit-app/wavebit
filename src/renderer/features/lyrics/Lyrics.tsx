import { Button, Spinner } from '@heroui/react';
import { useEffect, useRef, type CSSProperties } from 'react';
import { activeLine } from '../../../shared/lrc';
import type { LyricLine } from '../../../shared/schemas/lyrics';
import { enabledSources, sourceLabel } from '../../../shared/lyricsSources';
import { useLyrics, useSettings } from '../../lib/queries';
import { useMotion } from '../../lib/useTheme';
import { player, usePlayer } from '../player/player';

/** BitChord's fade: the lines around the current one, then a floor for the rest. */
const NEAR_FADE = [1, 0.7, 0.58];
const FAR_FADE = 0.46;
/** Where the current line sits in the column, as on BitChord's full-screen player. */
const ANCHOR = 0.3;
/** How long a hand on the scroller keeps the lines from following the song. */
const HAND_SCROLL_MS = 4_000;
/** Lines further than this from the current one are no blurrier. */
const MAX_BLUR_STEPS = 3;

function Lines({
  lines,
  size,
}: {
  lines: LyricLine[];
  size: 'panel' | 'full';
}) {
  const active = usePlayer((s) => activeLine(lines, s.position * 1000));
  const scroller = useRef<HTMLDivElement>(null);
  const handUntil = useRef(0);
  const motion = useMotion();

  useEffect(() => {
    const box = scroller.current;
    const line = box?.querySelector<HTMLElement>(`[data-line="${active}"]`);
    if (!box || !line || Date.now() < handUntil.current) return;
    box.scrollTo({
      top: line.offsetTop - box.clientHeight * ANCHOR,
      behavior: motion === 'full' ? 'smooth' : 'auto',
    });
  }, [active, motion]);

  // While a hand is on the scroller, every line is sharp (Blur unfocused lyrics).
  const browsing = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(browsing.current), []);
  const byHand = () => {
    handUntil.current = Date.now() + HAND_SCROLL_MS;
    const box = scroller.current;
    if (!box) return;
    box.dataset.browsing = '';
    clearTimeout(browsing.current);
    browsing.current = setTimeout(() => {
      delete box.dataset.browsing;
    }, HAND_SCROLL_MS);
  };
  return (
    <div
      ref={scroller}
      onWheel={byHand}
      onTouchMove={byHand}
      className={`lyrics relative min-h-0 flex-1 overflow-y-auto ${size === 'full' ? 'lyrics-full' : 'lyrics-panel'}`}
    >
      <ol className="flex flex-col">
        {lines.map((line, i) => {
          const away = Math.abs(i - active);
          const current = i === active;
          return (
            <li key={`${line.timeMs}-${i}`} data-line={i}>
              <button
                type="button"
                onClick={() => player.seek(line.timeMs / 1000)}
                aria-current={current ? 'true' : undefined}
                aria-label={line.text || 'Instrumental break'}
                style={
                  {
                    '--fade': NEAR_FADE[away] ?? FAR_FADE,
                    '--away': Math.min(away, MAX_BLUR_STEPS),
                  } as CSSProperties
                }
                className="lyric-line"
                data-current={current || undefined}
              >
                {line.text || (
                  <span aria-hidden className="lyric-gap">
                    <i />
                    <i />
                    <i />
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Message({ title, line }: { title: string; line: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1 px-6 pb-16 text-center">
      <p className="font-semibold">{title}</p>
      <p className="text-sm text-muted">{line}</p>
    </div>
  );
}

/**
 * DESIGN.md › Lyrics: the playing song's words. Timed lines follow the song
 * and a click seeks to one; untimed ones are a still page. The same for a
 * file, a Spotify song or a YouTube one, since they're found by name.
 */
export function Lyrics({ size }: { size: 'panel' | 'full' }) {
  const track = usePlayer((s) => s.queue[s.index]);
  const lyrics = useLyrics(track ?? null);
  const found = lyrics.data;
  const settings = useSettings().data;
  const anySource =
    !settings ||
    enabledSources(settings.lyricsSourceOrder, settings.lyricsSourcesOff)
      .length > 0;

  if (!track)
    return <Message title="No lyrics" line="Play a song to see its words." />;
  if (!anySource)
    return (
      <Message
        title="No lyrics sources are on"
        line="Lyrics will not be fetched. Turn a source on in Settings."
      />
    );
  if (lyrics.isPending)
    return (
      <div className="flex flex-1 items-center justify-center pb-16">
        <Spinner size="sm" aria-label="Finding the lyrics" />
      </div>
    );
  if (lyrics.isError)
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 pb-16 text-center">
        <p className="text-sm text-muted">Couldn’t reach any lyrics source.</p>
        <Button
          size="sm"
          variant="secondary"
          onPress={() => void lyrics.refetch()}
        >
          Try again
        </Button>
      </div>
    );
  if (!found)
    return (
      <Message
        title="No lyrics available"
        line="None of your lyrics sources has this song yet."
      />
    );
  if (found.kind === 'instrumental')
    return (
      <Message title="Instrumental" line="There are no words to this one." />
    );
  const follow = found.kind === 'synced' && settings?.syncedLyrics !== false;
  return (
    <>
      {follow ? (
        <Lines key={track.id} lines={found.lines} size={size} />
      ) : (
        <div
          className={`lyrics min-h-0 flex-1 overflow-y-auto ${size === 'full' ? 'lyrics-full' : 'lyrics-panel'}`}
        >
          {found.kind === 'plain' && (
            <p className="pb-4 text-sm text-muted">
              These lyrics aren’t timed.
            </p>
          )}
          {found.lines
            .filter((line) => line.text)
            .map((line, i) => (
              <p key={i} className="lyric-still">
                {line.text}
              </p>
            ))}
        </div>
      )}
      <p className="shrink-0 pt-2 text-xs text-muted">
        Lyrics from {sourceLabel(found.source)}
      </p>
    </>
  );
}
