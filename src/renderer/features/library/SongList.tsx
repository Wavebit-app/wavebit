import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { LocalTrack, SongSort } from '../../../shared/schemas/library';
import { date } from '../../lib/format';
import { useSettings, useSongs } from '../../lib/queries';
import { useSizeClass } from '../../lib/useBreakpoint';
import { useScrollElement } from '../../layouts/scroll';
import { fromLocal, player } from '../player/player';
import { SongRow, SongRowSkeleton } from './SongRow';

const WIDE = '36px minmax(0,2.2fr) minmax(0,1.3fr) 104px 56px';
const NARROW = '28px minmax(0,1fr) 56px';

/** Every song in the library, loading 200 at a time as the list nears its end. */
export function SongList({ query, sort }: { query: string; sort: SongSort }) {
  const songs = useSongs(query, sort);
  const compact = useSizeClass() === 'compact';
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = songs;

  if (songs.isPending)
    return (
      <div
        role="status"
        aria-label="Loading songs"
        className="flex flex-col gap-1"
      >
        {Array.from({ length: 9 }, (_, i) => (
          <SongRowSkeleton key={i} columns={compact ? NARROW : WIDE} />
        ))}
      </div>
    );

  return (
    <SongTable
      tracks={songs.data?.pages.flatMap((p) => p.items) ?? []}
      total={songs.data?.pages[0]?.total ?? 0}
      sort={sort}
      source="Library"
      onNearEnd={
        hasNextPage && !isFetchingNextPage
          ? () => void fetchNextPage()
          : undefined
      }
    />
  );
}

/** The song rows, virtualized against the workspace's own scroll. */
export function SongTable({
  tracks: loaded,
  total,
  sort,
  source,
  onNearEnd,
  onDelete,
}: {
  tracks: LocalTrack[];
  total: number;
  sort: SongSort;
  source: string;
  onNearEnd?: () => void;
  onDelete?: (track: LocalTrack) => void;
}) {
  const scroller = useScrollElement();
  const list = useRef<HTMLDivElement>(null);
  const [margin, setMargin] = useState(0);
  const compact = useSizeClass() === 'compact';
  const rowH = useSettings().data?.density === 'compact' ? 44 : 56;
  const columns = compact ? NARROW : WIDE;

  useLayoutEffect(() => {
    if (list.current && scroller.current)
      setMargin(
        list.current.getBoundingClientRect().top -
          scroller.current.getBoundingClientRect().top +
          scroller.current.scrollTop,
      );
  }, [scroller, total]);

  const virtual = useVirtualizer({
    count: total,
    getScrollElement: () => scroller.current,
    estimateSize: () => rowH + 4,
    overscan: 12,
    scrollMargin: margin,
  });
  const items = virtual.getVirtualItems();
  const last = items.at(-1)?.index ?? 0;
  useEffect(() => {
    if (last >= loaded.length - 40) onNearEnd?.();
  }, [last, loaded.length, onNearEnd]);

  const play = (track: LocalTrack) => {
    // The queue is what has loaded so far, from the clicked row on.
    const index = loaded.indexOf(track);
    player.playList(loaded.map(fromLocal), Math.max(0, index), source);
  };

  return (
    <div role="table" aria-label="Songs" aria-rowcount={total}>
      <div
        role="row"
        style={{ gridTemplateColumns: columns }}
        className="grid h-7 items-center gap-4 px-3 text-[0.8667rem] font-medium text-muted"
      >
        <span role="columnheader" className="text-right">
          #
        </span>
        <span
          role="columnheader"
          aria-sort={sort === 'title' ? 'ascending' : 'none'}
          className={`flex items-center gap-1 ${sort === 'title' ? 'text-foreground' : ''}`}
        >
          Title
          {sort === 'title' && <ChevronDown size={14} aria-hidden />}
        </span>
        {!compact && (
          <>
            <span role="columnheader">Album</span>
            <span
              role="columnheader"
              className={sort === 'recent' ? 'text-foreground' : ''}
            >
              Added
            </span>
          </>
        )}
        <span role="columnheader" className="text-right">
          Time
        </span>
      </div>
      <div
        ref={list}
        className="relative mt-1"
        style={{ height: virtual.getTotalSize() }}
      >
        {items.map((row) => {
          const track = loaded[row.index];
          return (
            <div
              key={row.key}
              className="absolute inset-x-0"
              style={{
                top: 0,
                transform: `translateY(${row.start - virtual.options.scrollMargin}px)`,
              }}
            >
              {track ? (
                <SongRow
                  no={row.index + 1}
                  track={fromLocal(track)}
                  title={track.title}
                  artist={track.artist}
                  album={compact ? undefined : track.album}
                  extra={
                    compact ? undefined : (
                      <span
                        role="cell"
                        className="text-sm text-muted tabular-nums"
                      >
                        {date(track.addedAt)}
                      </span>
                    )
                  }
                  durationMs={track.durationMs}
                  artwork={fromLocal(track).artwork}
                  onPlay={() => play(track)}
                  onDelete={onDelete && (() => onDelete(track))}
                  columns={columns}
                />
              ) : (
                <SongRowSkeleton columns={columns} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
