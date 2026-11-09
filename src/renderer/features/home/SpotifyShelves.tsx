import { Button } from '@heroui/react';
import type { SpotifyRecent } from '../../../shared/schemas/spotify';
import { nav } from '../../app/router';
import { Artwork } from '../../design/Artwork';
import { menuOn } from '../../design/ContextMenu';
import { PlaylistCover } from '../../design/PlaylistCover';
import { Shelf } from '../../design/Shelf';
import {
  useSignedIn,
  useSpotifyHome,
  useSpotifyRecentMore,
} from '../../lib/queries';
import { TrackCell } from '../library/Tiles';
import { recentMenu, spotifyArtistMenu } from '../menus/menus';
import { player } from '../player/player';
import { playable } from '../spotify/PlaylistPage';

const PERIODS = {
  month: 'this month',
  halfYear: 'of the last 6 months',
  year: 'of the past year',
};

export function openRecent(item: SpotifyRecent, playSong: () => void): void {
  if (item.kind === 'track') playSong();
  if (item.kind === 'album') nav.go({ name: 'spotifyAlbum', id: item.id });
  if (item.kind === 'playlist') nav.go({ name: 'playlist', id: item.id });
  if (item.kind === 'artist') nav.go({ name: 'spotifyArtist', id: item.id });
}

/**
 * Home's Spotify rows (DESIGN.md › Spotify): what was played lately, and top
 * songs and artists for the shortest period Spotify has any for. A row with nothing to show isn't drawn.
 */
export function SpotifyShelves() {
  const signedIn = useSignedIn();
  const data = useSpotifyHome(signedIn).data;
  const more = useSpotifyRecentMore(data?.recentBefore ?? null);
  if (!signedIn || !data) return null;

  const cards = new Map(
    [...data.recent, ...(more.data?.pages.flatMap((p) => p.items) ?? [])].map(
      (r) => [`${r.kind}-${r.id}`, r],
    ),
  );
  const recent = [...cards.values()];
  const canLoad =
    data.recentBefore !== null && (!more.data || more.hasNextPage);
  const recentSongs = recent.flatMap((r) => (r.track ? [r.track] : []));
  const recentQueue = recentSongs.map(playable);
  const topQueue = data.topTracks.map(playable);
  const period = PERIODS[data.topRange];
  const topTitle = `Your top songs ${period}`;

  return (
    <>
      {recent.length > 0 && (
        <Shelf
          title="Recently played"
          source="Spotify"
          kind="square"
          action={
            canLoad ? (
              <Button
                size="sm"
                variant="ghost"
                isPending={more.isFetching}
                onPress={() =>
                  void (more.data ? more.fetchNextPage() : more.refetch())
                }
              >
                Show older
              </Button>
            ) : undefined
          }
        >
          {recent.map((item) => (
            <button
              key={`${item.kind}-${item.id}`}
              type="button"
              onContextMenu={menuOn(() =>
                recentMenu(
                  item,
                  item.track
                    ? () =>
                        player.playList(
                          recentQueue,
                          recentSongs.indexOf(item.track!),
                          'Recently played',
                        )
                    : undefined,
                ),
              )}
              onClick={() =>
                openRecent(item, () =>
                  player.playList(
                    recentQueue,
                    recentSongs.indexOf(item.track!),
                    'Recently played',
                  ),
                )
              }
              className={`flex min-w-0 flex-col gap-2 rounded-md ${item.kind === 'artist' ? 'items-center text-center' : 'text-left'}`}
            >
              {item.kind === 'playlist' ? (
                <PlaylistCover
                  id={item.id}
                  src={item.imageUrl}
                  className="aspect-square w-full"
                  rounded="rounded-md"
                />
              ) : (
                <Artwork
                  src={item.imageUrl}
                  className="aspect-square w-full"
                  rounded={
                    item.kind === 'artist' ? 'rounded-full' : 'rounded-md'
                  }
                />
              )}
              <span className="flex w-full min-w-0 flex-col">
                <span className="truncate text-sm font-medium">
                  {item.name}
                </span>
                {item.subtitle && (
                  <span className="truncate text-[0.8667rem] text-muted">
                    {item.subtitle}
                  </span>
                )}
              </span>
            </button>
          ))}
        </Shelf>
      )}
      {topQueue.length > 0 && (
        <Shelf title={topTitle} source="Spotify" kind="tracks">
          {topQueue.map((t, i) => (
            <TrackCell
              key={t.id}
              track={t}
              onPlay={() => player.playList(topQueue, i, topTitle)}
            />
          ))}
        </Shelf>
      )}
      {data.topArtists.length > 0 && (
        <Shelf
          title={`Your top artists ${period}`}
          source="Spotify"
          kind="circle"
        >
          {data.topArtists.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => nav.go({ name: 'spotifyArtist', id: a.id })}
              onContextMenu={menuOn(() => spotifyArtistMenu(a))}
              className="flex min-w-0 flex-col items-center gap-2 rounded-md text-center"
            >
              <Artwork
                src={a.imageUrl}
                className="aspect-square w-full"
                rounded="rounded-full"
              />
              <span className="w-full truncate text-sm font-medium">
                {a.name}
              </span>
            </button>
          ))}
        </Shelf>
      )}
    </>
  );
}
