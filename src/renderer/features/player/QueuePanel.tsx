import { Button } from '@heroui/react';
import {
  ArrowLeft,
  GripVertical,
  Infinity as InfinityIcon,
  ListStart,
  Play,
  Trash2,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { setUi } from '../../app/ui';
import { OnDevice, SongArt } from '../downloads/SongArt';
import { YouTubeMusicMark } from '../../design/BrandMarks';
import { menuOn } from '../../design/ContextMenu';
import { PlayingBars } from '../../design/PlayingBars';
import { songMenu } from '../menus/menus';
import { IconButton } from './controls';
import { usePlayHistory, useSettings } from '../../lib/queries';
import { fromHistory, player, usePlayer, type Playable } from './player';
import { count } from '../../lib/format';
import { controlsLocked } from '../party/partyRules';
import { useParty } from '../party/store';
import { VideoStrip } from './VideoSlot';

const HISTORY_LIMIT = 25;

function Row({
  track,
  onPlay,
  onRemove,
  drag,
}: {
  track: Playable;
  onPlay: () => void;
  onRemove?: () => void;
  drag?: {
    index: number;
    onDrop: (from: number, to: number) => void;
    onMove: (delta: -1 | 1) => void;
    dropAbove: boolean;
    setOver: (i: number | null) => void;
  };
}) {
  return (
    <div
      className="group relative -mx-2 flex h-[52px] items-center gap-2 rounded-md px-2 hover:bg-sunken focus-within:bg-sunken"
      draggable={!!drag}
      onDragStart={(e) =>
        drag &&
        e.dataTransfer.setData('text/x-wavebit-queue', String(drag.index))
      }
      onDragOver={(e) => {
        if (!drag) return;
        e.preventDefault();
        drag.setOver(drag.index);
      }}
      onDragLeave={() => drag?.setOver(null)}
      onDrop={(e) => {
        if (!drag) return;
        const from = Number(e.dataTransfer.getData('text/x-wavebit-queue'));
        drag.setOver(null);
        if (Number.isInteger(from)) drag.onDrop(from, drag.index);
      }}
      onContextMenu={menuOn(() =>
        songMenu(
          track,
          onRemove && {
            queue: [
              { id: 'now', label: 'Play now', icon: Play, run: onPlay },
              {
                id: 'next',
                label: 'Play next',
                icon: ListStart,
                run: () => {
                  onRemove();
                  player.playNext(track);
                },
              },
              {
                id: 'remove',
                label: 'Remove from queue',
                icon: Trash2,
                run: onRemove,
                danger: true,
              },
            ],
          },
        ),
      )}
      onKeyDown={(e) => {
        if (
          drag &&
          e.altKey &&
          (e.key === 'ArrowUp' || e.key === 'ArrowDown')
        ) {
          e.preventDefault();
          drag.onMove(e.key === 'ArrowUp' ? -1 : 1);
        }
      }}
    >
      {drag?.dropAbove && (
        <span
          aria-hidden
          className="absolute -top-0.5 right-2 left-2 h-0.5 rounded-full bg-accent"
        />
      )}
      {drag && (
        <GripVertical
          size={16}
          aria-label="Drag to reorder (Alt Up, Alt Down)"
          className="shrink-0 cursor-grab text-transparent group-hover:text-foreground"
        />
      )}
      <button
        type="button"
        onClick={onPlay}
        aria-label={`Play ${track.title} now`}
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
      >
        <SongArt track={track} src={track.artwork} size={40} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-medium">{track.title}</span>
            <OnDevice track={track} />
          </span>
          <span className="flex min-w-0 items-center gap-1 text-[0.8667rem] text-muted">
            {track.stream && <YouTubeMusicMark size={12} />}
            <span className="truncate">{track.artist}</span>
          </span>
        </span>
      </button>
      {onRemove && (
        <Button
          isIconOnly
          variant="ghost"
          size="sm"
          aria-label={`Remove ${track.title}`}
          onPress={onRemove}
          className="size-8 min-w-8 opacity-0 group-hover:opacity-100 focus:opacity-100"
        >
          <X size={16} />
        </Button>
      )}
    </div>
  );
}

function Heading({ children }: { children: string }) {
  return (
    <h3 className="mt-5 mb-1.5 text-[0.8667rem] font-semibold text-muted">
      {children}
    </h3>
  );
}

/**
 * DESIGN.md › Queue, after BitChord's Up Next: what you started, the songs
 * you added (Play next at their head, Add to queue at their tail), then
 * AutoPlay, YouTube Music's radio added when the list runs low. A press on a
 * row plays it now; a right-click or long press has Play now, Play next,
 * Remove and the song's own actions. Clear removes only the songs you added.
 */
export function QueuePanel({
  className = 'w-[var(--drawer-width,360px)] rounded-panel bg-surface',
}: {
  className?: string;
}) {
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const upNext = usePlayer((s) => s.upNext);
  const source = usePlayer((s) => s.source);
  const autoplay = usePlayer((s) => s.autoplay);
  const autoplayStart = usePlayer((s) => s.autoplayStart);
  const paused = usePlayer((s) => !s.playing);
  usePlayer((s) => s.shuffle);
  // In a party the queue is everyone's: how many share it, and how full it is.
  const party = useParty((s) =>
    s.code
      ? `Shared with ${count(s.members.length - 1, 'other')} · ${Math.max(0, s.queue.items.length - 1)} of 25 songs${controlsLocked(s) ? ' · the host controls it' : ''}`
      : null,
  );
  const [over, setOver] = useState<number | null>(null);
  const current = queue[index];
  const showHistory = useSettings().data?.showQueueHistory ?? false;
  const history = usePlayHistory().data;
  // Oldest first, so the list reads down into Now playing.
  const past = showHistory
    ? (history ?? []).slice(0, HISTORY_LIMIT).map(fromHistory).reverse()
    : [];
  const upcoming = player.upcoming();
  const listed = upcoming.filter(
    (u) => autoplayStart === null || u.index < autoplayStart,
  );
  const radio = upcoming.filter(
    (u) => autoplayStart !== null && u.index >= autoplayStart,
  );

  const rows = (items: typeof upcoming, offset: number) =>
    items.slice(0, 200).map(({ track, index: at }, i) => (
      <Row
        key={`${track.id}-${at}`}
        track={track}
        onPlay={() => player.playAt(at)}
        onRemove={() => player.removeUpcoming(offset + i)}
        drag={{
          index: offset + i,
          dropAbove: over === offset + i,
          setOver,
          onDrop: (from, to) =>
            player.moveUpcoming(from, to > from ? to - 1 : to),
          onMove: (delta) =>
            player.moveUpcoming(offset + i, offset + i + delta),
        }}
      />
    ));

  return (
    <aside
      aria-label="Up next"
      className={`flex ${className} shrink-0 flex-col overflow-hidden`}
    >
      <VideoStrip />
      <div className="flex min-h-0 flex-1 flex-col pt-5 pr-4 pb-4 pl-5">
        <div className="flex items-center gap-1.5">
          <IconButton
            label="Back to Now playing"
            onPress={() => setUi({ panel: 'now' })}
            size={32}
          >
            <ArrowLeft size={18} />
          </IconButton>
          <h2 className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-xl font-semibold">
              {party ? 'Party queue' : 'Up next'}
            </span>
            {party && (
              <span className="truncate text-[0.8667rem] font-normal text-muted tabular-nums">
                {party}
              </span>
            )}
          </h2>
          <IconButton
            label={autoplay ? 'AutoPlay is on' : 'AutoPlay is off'}
            onPress={player.toggleAutoplay}
            size={32}
          >
            <InfinityIcon
              size={18}
              className={autoplay ? 'text-accent' : 'text-muted'}
            />
          </IconButton>
          <Button
            variant="ghost"
            size="sm"
            onPress={player.clearAdded}
            isDisabled={upNext.length === 0}
          >
            Clear
          </Button>
          <IconButton
            label="Close queue"
            onPress={() => setUi({ panel: null })}
            size={32}
          >
            <X size={18} />
          </IconButton>
        </div>
        <div className="-mx-2 mt-2 flex-1 overflow-y-auto px-2">
          {past.length > 0 && (
            <>
              <Heading>History</Heading>
              {past.map((track, i) => (
                <Row
                  key={`${track.id}-${i}`}
                  track={track}
                  onPlay={() => player.playList(past, i, 'History')}
                />
              ))}
            </>
          )}
          {current && (
            <>
              <h3 className="mt-3 mb-1.5 text-[0.8667rem] font-semibold text-muted">
                Now playing
              </h3>
              <div className="-mx-2 flex h-[52px] items-center gap-3 rounded-md bg-foreground/5 px-2">
                <SongArt track={current} src={current.artwork} size={40} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-sm font-semibold text-accent">
                      {current.title}
                    </span>
                    <OnDevice track={current} />
                  </span>
                  <span className="truncate text-[0.8667rem] text-muted">
                    {current.artist}
                  </span>
                </span>
                <PlayingBars paused={paused} className="mr-1 text-accent" />
              </div>
            </>
          )}
          {upNext.length > 0 && (
            <>
              <Heading>Added by you</Heading>
              {upNext.map((t, i) => (
                <Row
                  key={`${t.id}-${i}`}
                  track={t}
                  onPlay={() => player.playAdded(i)}
                  onRemove={() => player.removeUpNext(i)}
                />
              ))}
            </>
          )}
          {listed.length > 0 && (
            <>
              <Heading>{source ? `Next from ${source}` : 'Next'}</Heading>
              {rows(listed, 0)}
            </>
          )}
          {radio.length > 0 && (
            <>
              <Heading>AutoPlay</Heading>
              {rows(radio, listed.length)}
            </>
          )}
          {current && autoplay && radio.length === 0 && listed.length < 3 && (
            <p className="mt-5 text-sm text-muted">
              AutoPlay adds similar songs from YouTube Music when this list
              ends.
            </p>
          )}
          {!current && (
            <p className="mt-6 text-sm text-muted">
              Play a song and what comes next shows here.
            </p>
          )}
        </div>
      </div>
    </aside>
  );
}
