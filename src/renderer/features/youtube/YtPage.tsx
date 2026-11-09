import { Skeleton } from '@heroui/react';
import { Bookmark, Shuffle } from 'lucide-react';
import { YouTubeMusicMark } from '../../design/BrandMarks';
import { IconAction, PlayAction, ViewMenu } from '../../design/IconAction';
import { useEffect, useMemo } from 'react';
import type { YtTrack } from '../../../shared/schemas/youtube';
import { nav } from '../../app/router';
import { Artwork } from '../../design/Artwork';
import { Backdrop } from '../../design/Backdrop';
import { count } from '../../lib/format';
import { useYtPage, useYtSave, useYtStatus } from '../../lib/queries';
import { useSizeClass } from '../../lib/useBreakpoint';
import type { DownloadList } from '../../../shared/schemas/downloads';
import { ListDownloadAction } from '../downloads/DownloadActions';
import { loadList } from '../downloads/lists';
import { SongRow, SongRowSkeleton } from '../library/SongRow';
import { player, type Playable } from '../player/player';

const WIDE = '32px minmax(0,2fr) minmax(0,1.2fr) 56px';
const NARROW = '24px minmax(0,1fr) 56px';

/** A file when one matches, else the video itself through YouTube's embedded player. */
export function playable(t: YtTrack): Playable {
  const base = {
    title: t.title,
    artist: t.artists,
    album: t.album ?? '',
    artwork: t.imageUrl,
    durationMs: t.durationMs,
  };
  return t.localId
    ? { ...base, id: t.localId, albumKey: t.localAlbumKey }
    : {
        ...base,
        id: `youtube:${t.videoId}`,
        albumKey: null,
        stream: { videoId: t.videoId },
      };
}

/**
 * A YouTube Music album (MPRE…) or playlist (VL…), laid out like a Spotify
 * playlist: the header over the cover, then the rows. A row that matches a
 * file plays from it; the rest play in YouTube's embedded player. Save is
 * YouTube's like on the list.
 */
export function YtPage({ id }: { id: string }) {
  const page = useYtPage(id);
  const signedIn = useYtStatus().data?.state === 'signed_in';
  const save = useYtSave(id);
  const compact = useSizeClass() === 'compact';
  const pad = compact ? 'px-5' : 'px-10';
  const columns = compact ? NARROW : WIDE;

  // Long playlists load page by page until the whole list is in.
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = page;
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const first = page.data?.pages[0];
  const tracks = useMemo(
    () => page.data?.pages.flatMap((p) => p.items) ?? [],
    [page.data],
  );
  const queue = useMemo(() => tracks.map(playable), [tracks]);
  const matched = queue.filter((q) => !q.stream).length;
  const title = first?.title || 'YouTube Music';
  const list: DownloadList = { kind: 'ytPage', id, title };
  const open = (videoId: string | null) =>
    void window.wavebit.youtube.open(videoId, videoId ? null : id);

  if (page.isError)
    return (
      <div className={`${pad} py-8`}>
        <p role="alert" className="text-muted">
          YouTube Music didn’t send this page.{' '}
          <button
            type="button"
            onClick={() => void page.refetch()}
            className="font-medium text-accent hover:underline"
          >
            Try again
          </button>
        </p>
      </div>
    );

  return (
    <div>
      <section
        className={`relative flex min-h-[280px] items-end ${pad} pt-10 pb-7`}
      >
        <Backdrop src={first?.imageUrl} />
        <div
          className={`relative flex gap-7 ${compact ? 'flex-col items-start' : 'items-end'}`}
        >
          {first ? (
            <Artwork
              src={first.imageUrl}
              size={compact ? 160 : 200}
              rounded="rounded-md"
            />
          ) : (
            <Skeleton className="size-[200px] rounded-md" />
          )}
          <div className="flex min-w-0 flex-col gap-2">
            <span className="text-[0.8667rem] font-medium text-muted">
              YouTube Music {first?.kind === 'album' ? 'album' : 'playlist'}
            </span>
            <h1 className="text-headline font-semibold tracking-[-0.02em]">
              {title}
            </h1>
            {first?.description && (
              <p className="line-clamp-2 max-w-[640px] text-muted">
                {first.description}
              </p>
            )}
            {first && (
              <span className="text-sm text-muted tabular-nums">
                {first.byline &&
                  (first.bylineId ? (
                    <button
                      type="button"
                      onClick={() =>
                        nav.go({ name: 'ytArtist', id: first.bylineId! })
                      }
                      className="font-medium text-foreground hover:underline"
                    >
                      {first.byline}
                    </button>
                  ) : (
                    <span className="font-medium text-foreground">
                      {first.byline}
                    </span>
                  ))}
                {first.byline && ' · '}
                {[first.subtitle, first.meta, `${matched} play from your files`]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-1">
              <PlayAction
                isDisabled={queue.length === 0}
                onPress={() => player.playList(queue, 0, title)}
              />
              <IconAction
                label="Shuffle"
                isDisabled={queue.length === 0}
                onPress={() => player.shuffleList(queue, title)}
              >
                <Shuffle size={24} aria-hidden />
              </IconAction>
              {first?.save && signedIn && (
                <IconAction
                  label={first.save.saved ? 'Saved' : 'Save to library'}
                  active={first.save.saved}
                  isPending={save.isPending}
                  onPress={() =>
                    save.mutate({
                      playlistId: first.save!.playlistId,
                      saved: !first.save!.saved,
                    })
                  }
                >
                  <Bookmark
                    size={24}
                    fill={first.save.saved ? 'currentColor' : 'none'}
                    aria-hidden
                  />
                </IconAction>
              )}
              {first && (
                <ListDownloadAction
                  tracks={queue}
                  complete={!hasNextPage}
                  title={title}
                  list={list}
                  load={() => loadList(list)}
                />
              )}
              <IconAction
                label="Open in YouTube Music"
                onPress={() => open(null)}
              >
                <YouTubeMusicMark size={24} />
              </IconAction>
              <ViewMenu />
            </div>
          </div>
        </div>
      </section>

      <div className={`${pad} pt-6 pb-10`}>
        <div role="table" aria-label="Songs" className="flex flex-col gap-1">
          <div
            role="row"
            style={{ gridTemplateColumns: columns }}
            className="grid h-7 items-center gap-4 px-3 text-[0.8667rem] font-medium text-muted"
          >
            <span role="columnheader" className="text-right">
              #
            </span>
            <span role="columnheader">Title</span>
            {!compact && (
              <>
                <span role="columnheader">Album</span>
              </>
            )}
            <span role="columnheader" className="text-right">
              Time
            </span>
          </div>
          {page.isPending
            ? Array.from({ length: 8 }, (_, i) => (
                <SongRowSkeleton key={i} columns={columns} />
              ))
            : tracks.map((t, index) => {
                const track = playable(t);
                return (
                  <SongRow
                    key={`${t.videoId}-${index}`}
                    no={index + 1}
                    track={track}
                    title={t.title}
                    artist={t.artists}
                    album={compact ? undefined : (t.album ?? '')}
                    onAlbum={
                      t.localAlbumKey
                        ? () => nav.go({ name: 'album', key: t.localAlbumKey! })
                        : undefined
                    }
                    status={track.stream ? 'stream' : 'matched'}
                    statusColumn={false}
                    durationMs={t.durationMs}
                    artwork={t.imageUrl}
                    onPlay={() => player.playList(queue, index, title)}
                    columns={columns}
                  />
                );
              })}
        </div>
        {first && tracks.length === 0 && (
          <p className="mt-6 text-muted">{count(0, 'song')} on this page.</p>
        )}
      </div>
    </div>
  );
}
