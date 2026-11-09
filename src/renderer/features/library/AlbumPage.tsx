import { Button, Skeleton } from '@heroui/react';
import { Shuffle } from 'lucide-react';
import { nav } from '../../app/router';
import { Artwork } from '../../design/Artwork';
import { Backdrop } from '../../design/Backdrop';
import { Empty } from '../../design/Empty';
import { IconAction, PlayAction, ViewMenu } from '../../design/IconAction';
import { artUrl, count, length } from '../../lib/format';
import { useAlbum } from '../../lib/queries';
import { useSizeClass } from '../../lib/useBreakpoint';
import { fromLocal, player } from '../player/player';
import { SongRow } from './SongRow';
import { AlbumTile, GRID } from './Tiles';

const COLUMNS = '28px minmax(0,1fr) 56px';

/** DESIGN.md › Album page. */
export function AlbumPage({ albumKey }: { albumKey: string }) {
  const album = useAlbum(albumKey);
  const compact = useSizeClass() === 'compact';
  const pad = compact ? 'px-5' : 'px-10';

  if (album.data === null)
    return (
      <Empty
        art="search"
        title="This album is gone"
        action={
          <Button onPress={() => nav.go({ name: 'library', tab: 'albums' })}>
            Show all albums
          </Button>
        }
      >
        Its files were removed or moved out of your music folders.
      </Empty>
    );

  const detail = album.data;
  const cover = detail?.album.hasArt ? artUrl(albumKey) : null;
  const tracks = detail?.tracks.map(fromLocal) ?? [];
  const discs = new Set(detail?.tracks.map((t) => t.discNo ?? 1)).size > 1;

  return (
    <div>
      <section
        className={`relative flex min-h-[280px] items-end ${pad} pt-10 pb-7`}
      >
        <Backdrop src={cover} />
        <div
          className={`relative flex w-full gap-7 ${compact ? 'flex-col items-start' : 'items-end'}`}
        >
          {detail ? (
            <Artwork
              src={cover}
              size={compact ? 180 : 220}
              rounded="rounded-md"
            />
          ) : (
            <Skeleton className="size-[220px] rounded-md" />
          )}
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="text-[0.8667rem] font-medium text-muted">
              Album
            </span>
            <h1 className="text-headline font-semibold tracking-[-0.02em]">
              {detail?.album.title ?? ' '}
            </h1>
            {detail && (
              <>
                <button
                  type="button"
                  onClick={() =>
                    nav.go({ name: 'artist', artist: detail.album.artist })
                  }
                  className="self-start text-base font-medium hover:text-accent"
                >
                  {detail.album.artist}
                </button>
                <span className="text-sm text-muted tabular-nums">
                  {[
                    detail.album.year,
                    count(detail.album.trackCount, 'song'),
                    length(detail.album.durationMs),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                <div className="mt-1.5 flex items-center gap-1">
                  <PlayAction
                    onPress={() =>
                      player.playList(tracks, 0, detail.album.title)
                    }
                  />
                  <IconAction
                    label="Shuffle"
                    onPress={() =>
                      player.shuffleList(tracks, detail.album.title)
                    }
                  >
                    <Shuffle size={24} aria-hidden />
                  </IconAction>
                  <ViewMenu />
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      <div className={`${pad} pt-5 pb-10`}>
        <div role="table" aria-label="Songs" className="flex flex-col gap-1">
          {detail?.tracks.map((t, i) => (
            <div key={t.id}>
              {discs &&
                (i === 0 ||
                  (detail.tracks[i - 1]!.discNo ?? 1) !== (t.discNo ?? 1)) && (
                  <h3
                    className={`px-3 pb-2 text-sm font-semibold text-muted ${i > 0 ? 'pt-5' : ''}`}
                  >
                    Disc {t.discNo ?? 1}
                  </h3>
                )}
              <SongRow
                no={t.trackNo ?? i + 1}
                track={tracks[i]!}
                title={t.title}
                artist={t.artist}
                durationMs={t.durationMs}
                showArt={false}
                onPlay={() => player.playList(tracks, i, detail.album.title)}
                columns={COLUMNS}
              />
            </div>
          ))}
        </div>
        {detail && (
          <>
            <p className="mt-5 px-3 text-[0.8667rem] text-muted">
              {detail.album.year ? `Released ${detail.album.year} · ` : ''}
              {detail.format}
            </p>
            {detail.moreByArtist.length > 0 && (
              <>
                <h2 className="mt-9 mb-3 font-semibold">
                  More by {detail.album.artist}
                </h2>
                <div className={GRID}>
                  {detail.moreByArtist.map((a) => (
                    <AlbumTile
                      key={a.key}
                      album={a}
                      meta={a.year ? String(a.year) : a.artist}
                    />
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
