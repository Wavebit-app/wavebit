import { Button } from '@heroui/react';
import { Shuffle } from 'lucide-react';
import { nav } from '../../app/router';
import { Backdrop } from '../../design/Backdrop';
import { Empty } from '../../design/Empty';
import { IconAction, PlayAction, ViewMenu } from '../../design/IconAction';
import { artUrl, count, initials } from '../../lib/format';
import { useArtist } from '../../lib/queries';
import { useSizeClass } from '../../lib/useBreakpoint';
import { fromLocal, player } from '../player/player';
import { SongRow } from './SongRow';
import { AlbumTile, GRID } from './Tiles';

const COLUMNS = '24px minmax(0,1fr) 48px';

/** DESIGN.md › Artist page: the newest album's artwork behind the header. */
export function ArtistPage({ name }: { name: string }) {
  const artist = useArtist(name).data;
  const compact = useSizeClass() === 'compact';
  const pad = compact ? 'px-5' : 'px-10';

  if (artist === null)
    return (
      <Empty
        art="search"
        title="No songs by this artist"
        action={
          <Button onPress={() => nav.go({ name: 'library', tab: 'artists' })}>
            Show all artists
          </Button>
        }
      >
        Their files were removed or moved out of your music folders.
      </Empty>
    );

  const top = artist?.topTracks.map(fromLocal) ?? [];
  // Play and Shuffle take every song on the artist's albums, newest album first.
  const playAll = (shuffle: boolean) =>
    void Promise.all(
      artist!.albums.map((a) => window.wavebit.library.album(a.key)),
    ).then((albums) => {
      const all = albums.flatMap((a) => a?.tracks ?? []).map(fromLocal);
      const list = all.length ? all : top;
      if (shuffle) player.shuffleList(list, name);
      else player.playList(list, 0, name);
    });

  return (
    <div>
      <section
        className={`relative flex min-h-[280px] items-end ${pad} pt-10 pb-8`}
      >
        <Backdrop
          src={artist?.artist.artKey ? artUrl(artist.artist.artKey) : null}
        />
        <div
          className={`relative flex gap-7 ${compact ? 'flex-col items-start' : 'items-end'}`}
        >
          <span
            aria-hidden
            className="flex size-40 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[3.4rem] font-semibold tracking-[-0.02em] text-accent"
          >
            {initials(name)}
          </span>
          <div className="flex flex-col gap-1.5">
            <span className="text-[0.8667rem] font-medium text-muted">
              Artist
            </span>
            <h1 className="text-hero font-semibold tracking-[-0.02em]">
              {name}
            </h1>
            {artist && (
              <>
                <span className="text-sm text-muted tabular-nums">
                  {count(artist.artist.albumCount, 'album')} ·{' '}
                  {count(artist.artist.trackCount, 'song')}
                </span>
                <div className="mt-1.5 flex items-center gap-1">
                  <PlayAction onPress={() => playAll(false)} />
                  <IconAction label="Shuffle" onPress={() => playAll(true)}>
                    <Shuffle size={24} aria-hidden />
                  </IconAction>
                  <ViewMenu />
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      {artist && (
        <div className={`${pad} pt-6 pb-10`}>
          <h2 className="mb-2 font-semibold">Top songs</h2>
          <div
            role="table"
            aria-label="Top songs"
            className="grid grid-cols-[repeat(auto-fill,minmax(340px,1fr))] gap-x-8 gap-y-1"
          >
            {artist.topTracks.map((t, i) => (
              <SongRow
                key={t.id}
                no={i + 1}
                track={top[i]!}
                title={t.title}
                artist={t.album || t.artist}
                durationMs={t.durationMs}
                artwork={top[i]!.artwork}
                onPlay={() => player.playList(top, i, name)}
                columns={COLUMNS}
              />
            ))}
          </div>
          {artist.albums.length > 0 && (
            <>
              <h2 className="mt-9 mb-3 font-semibold">Albums</h2>
              <div className={GRID}>
                {artist.albums.map((a) => (
                  <AlbumTile
                    key={a.key}
                    album={a}
                    meta={a.year ? String(a.year) : count(a.trackCount, 'song')}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
