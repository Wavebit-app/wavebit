import { Button, Skeleton } from '@heroui/react';
import type { CSSProperties } from 'react';
import { nav } from '../../app/router';
import { SpotifyMark, YouTubeMusicMark } from '../../design/BrandMarks';
import { PageHeader } from '../../design/PageHeader';
import { Shelf } from '../../design/Shelf';
import {
  useSearch,
  useSignedIn,
  useSpotifySearch,
  useYtSearch,
} from '../../lib/queries';
import { useSizeClass } from '../../lib/useBreakpoint';
import { AlbumTile, ArtistTile, TrackCell } from '../library/Tiles';
import { SongRow, SongRowSkeleton } from '../library/SongRow';
import { fromLocal, player } from '../player/player';
import { playable } from '../spotify/PlaylistPage';
import { rowLinks } from '../spotify/rowLinks';
import { YtShelfView } from '../youtube/YouTube';

const WIDE = '32px minmax(0,2fr) minmax(0,1.2fr) 56px';
const NARROW = '24px minmax(0,1fr) 56px';

function Source({
  mark,
  children,
}: {
  mark: React.ReactNode;
  children: string;
}) {
  return (
    <h2 className="mt-10 flex items-center gap-2 text-lg font-semibold">
      {mark}
      {children}
    </h2>
  );
}

/**
 * Search beyond the quick list: your files, then YouTube Music's own search
 * (Songs, Videos, Albums, Artists, Playlists) and Spotify's songs (the web
 * player's searchTracks), 20 more at a time. Everything plays: files from
 * disk, the rest from YouTube Music.
 */
export function SearchPage({ query }: { query: string }) {
  const compact = useSizeClass() === 'compact';
  const signedIn = useSignedIn();
  const local = useSearch(query).data;
  const yt = useYtSearch(query);
  const sp = useSpotifySearch(query, signedIn);
  const columns = compact ? NARROW : WIDE;
  const spTracks = sp.data?.pages.flatMap((p) => p.items) ?? [];
  const spQueue = spTracks.map(playable);
  const localQueue = (local?.tracks ?? []).map(fromLocal);

  return (
    <div
      style={{ '--page-x': compact ? '1.25rem' : '2.5rem' } as CSSProperties}
      className={compact ? 'px-5 pt-5 pb-10' : 'px-10 pt-8 pb-12'}
    >
      <PageHeader
        title={`“${query}”`}
        meta="Your files, YouTube Music and Spotify"
      />

      {local &&
        local.tracks.length + local.albums.length + local.artists.length >
          0 && (
          <>
            <Source mark={null}>On this computer</Source>
            {localQueue.length > 0 && (
              <Shelf title="Songs" kind="tracks">
                {localQueue.map((t, i) => (
                  <TrackCell
                    key={t.id}
                    track={t}
                    onPlay={() => player.playList(localQueue, i, `“${query}”`)}
                  />
                ))}
              </Shelf>
            )}
            {local.albums.length > 0 && (
              <Shelf title="Albums" kind="square">
                {local.albums.map((a) => (
                  <AlbumTile key={a.key} album={a} />
                ))}
              </Shelf>
            )}
            {local.artists.length > 0 && (
              <Shelf title="Artists" kind="circle">
                {local.artists.map((a) => (
                  <ArtistTile key={a.name} artist={a} />
                ))}
              </Shelf>
            )}
          </>
        )}

      <Source mark={<YouTubeMusicMark size={20} />}>YouTube Music</Source>
      {yt.isPending ? (
        <Skeleton className="mt-4 h-40 w-full rounded-md" />
      ) : yt.isError ? (
        <p className="mt-3 text-muted">
          YouTube Music didn’t answer. Try again in a moment.
        </p>
      ) : yt.data.length === 0 ? (
        <p className="mt-3 text-muted">Nothing on YouTube Music for this.</p>
      ) : (
        yt.data.map((shelf, i) => (
          <YtShelfView key={`${shelf.title}-${i}`} shelf={shelf} />
        ))
      )}

      <Source mark={<SpotifyMark size={20} />}>Spotify</Source>
      {!signedIn ? (
        <p className="mt-3 text-muted">
          Connect Spotify in Settings to search it too.{' '}
          <button
            type="button"
            onClick={() => nav.go({ name: 'settings', section: 'spotify' })}
            className="font-medium text-accent hover:underline"
          >
            Settings › Spotify
          </button>
        </p>
      ) : sp.isError ? (
        <p className="mt-3 text-muted">
          Spotify’s search didn’t answer. Try again in a moment.
        </p>
      ) : (
        <div
          role="table"
          aria-label="Spotify songs"
          className="mt-3 flex flex-col gap-1"
        >
          {sp.isPending
            ? Array.from({ length: 5 }, (_, i) => (
                <SongRowSkeleton key={i} columns={columns} />
              ))
            : spTracks.map((t, i) => {
                const track = spQueue[i]!;
                return (
                  <SongRow
                    key={`${t.uri}-${i}`}
                    no={i + 1}
                    track={track}
                    title={t.title}
                    artist={t.artists.join(', ')}
                    album={compact ? undefined : (t.album ?? '')}
                    {...rowLinks(t)}
                    durationMs={t.durationMs}
                    artwork={t.imageUrl}
                    onPlay={() =>
                      player.playList(spQueue, i, `“${query}” on Spotify`)
                    }
                    columns={columns}
                  />
                );
              })}
          {sp.hasNextPage && (
            <div className="mt-3">
              <Button
                variant="secondary"
                isPending={sp.isFetchingNextPage}
                onPress={() => void sp.fetchNextPage()}
              >
                Show more
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
