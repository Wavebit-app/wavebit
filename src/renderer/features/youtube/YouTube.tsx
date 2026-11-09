import { Alert, Button, toast } from '@heroui/react';
import { useEffect } from 'react';
import { errorCode } from '../../../shared/errors';
import type { ErrorCode } from '../../../shared/schemas/spotify';
import type { YtItem, YtShelf } from '../../../shared/schemas/youtube';
import { nav } from '../../app/router';
import { player, type Playable } from '../player/player';
import { ytItemMenu } from '../menus/menus';
import { Artwork } from '../../design/Artwork';
import { menuOn } from '../../design/ContextMenu';
import { Shelf, type ShelfKind } from '../../design/Shelf';
import { useSettings, useYtHome } from '../../lib/queries';
import { SPOTIFY_ERRORS } from '../spotify/ConnectSpotify';

/**
 * Every card opens inside wavebit, as BitChord's Home does: albums and
 * playlists as pages, artists as artist pages. A song or video can't be
 * streamed by wavebit, so it says so and offers YouTube Music, rather than
 * leaving for the browser on its own.
 */
export const open = (item: YtItem) => {
  const id = item.browseId;
  if (id && /^(MPRE|VL)/.test(id)) return nav.go({ name: 'ytPage', id });
  if (id?.startsWith('UC')) return nav.go({ name: 'ytArtist', id });
  notInFiles(item.title, item.videoId, item.browseId);
};

/** A YouTube song with no matching file: say so, and offer YouTube Music. */
export function notInFiles(
  title: string,
  videoId: string | null,
  browseId: string | null = null,
) {
  toast(`“${title}” isn’t in your music files`, {
    description: 'wavebit plays YouTube Music songs that you have as files.',
    actionProps: {
      children: 'Open in YouTube Music',
      onPress: () => void window.wavebit.youtube.open(videoId, browseId),
    },
  });
}

/** A card in a square, circle or video shelf: artwork, title, YouTube's own line under it. */
export function Card({
  item,
  shape,
  onPlay,
}: {
  item: YtItem;
  shape: ShelfKind | 'video';
  /** Plays the song or video (and its shelf after it); pages open instead. */
  onPlay?: () => void;
}) {
  const square = useSettings().data?.squareVideoThumbnails ?? false;
  return (
    <button
      type="button"
      onClick={() => (onPlay ? onPlay() : open(item))}
      onContextMenu={menuOn(() => ytItemMenu(item, onPlay))}
      className={`flex w-full min-w-0 flex-col gap-2 rounded-md ${shape === 'circle' ? 'items-center text-center' : 'text-left'}`}
    >
      <Artwork
        src={item.imageUrl}
        className={`w-full ${shape === 'video' && !square ? 'aspect-video' : 'aspect-square'}`}
        rounded={shape === 'circle' ? 'rounded-full' : 'rounded-md'}
      />
      <span className="flex w-full min-w-0 flex-col">
        <span className="truncate text-sm font-medium">{item.title}</span>
        <span className="line-clamp-2 text-[0.8667rem] text-muted">
          {item.subtitle}
        </span>
      </span>
    </button>
  );
}

/** A song in a four-row shelf. */
function Row({ item, onPlay }: { item: YtItem; onPlay?: () => void }) {
  return (
    <button
      type="button"
      onClick={() => (onPlay ? onPlay() : open(item))}
      onContextMenu={menuOn(() => ytItemMenu(item, onPlay))}
      className="flex h-14 w-full min-w-0 items-center gap-3 rounded-md px-2 text-left hover:bg-sunken"
    >
      <Artwork src={item.imageUrl} size={40} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium">{item.title}</span>
        <span className="truncate text-[0.8667rem] text-muted">
          {item.subtitle}
        </span>
      </span>
    </button>
  );
}

/** A YouTube song or video as something to play through the embedded player. */
export function streamOf(item: YtItem): Playable {
  // "Song • Artist" is how YouTube bills a card; the credit is what's after the
  // kind. A search for an artist drops the credit, leaving "Song • 3:44 • 9.5M plays".
  const credit = item.subtitle
    .split(' • ')
    .filter(
      (part) =>
        !/^(song|video|single|ep)$|^\d+:\d{2}|\b(plays|views)$/i.test(
          part.trim(),
        ),
    )[0];
  return {
    id: `youtube:${item.videoId}`,
    title: item.title,
    artist: credit?.trim() ?? '',
    album: '',
    albumKey: null,
    artwork: item.imageUrl,
    durationMs: 0,
    stream: { videoId: item.videoId, isVideo: item.kind === 'video' },
  };
}

export function YtShelfView({ shelf }: { shelf: YtShelf }) {
  // Video shelves use the square grid's columns with 16:9 art.
  const kind: ShelfKind = shelf.layout === 'video' ? 'square' : shelf.layout;
  // The shelf's songs and videos, in order: pressing one plays the rest after it.
  const playable = shelf.items.filter(
    (i) => i.videoId && (i.kind === 'song' || i.kind === 'video'),
  );
  const queue = playable.map(streamOf);
  const playFrom = (item: YtItem) =>
    playable.includes(item)
      ? () => player.playList(queue, playable.indexOf(item), shelf.title)
      : undefined;
  return (
    <Shelf
      title={shelf.title}
      source={
        shelf.strapline ? `YouTube Music · ${shelf.strapline}` : 'YouTube Music'
      }
      kind={kind}
    >
      {shelf.items.map((item, i) =>
        shelf.layout === 'tracks' ? (
          <Row
            key={`${item.videoId}-${i}`}
            item={item}
            onPlay={playFrom(item)}
          />
        ) : (
          <Card
            key={`${item.videoId ?? item.browseId}-${i}`}
            item={item}
            shape={shelf.layout}
            onPlay={playFrom(item)}
          />
        ),
      )}
    </Shelf>
  );
}

/** A Home shelf without its videos, or nothing if videos were all it had. */
function withoutVideos(shelf: YtShelf): YtShelf[] {
  const items = shelf.items.filter((item) => item.kind !== 'video');
  return items.length > 0 ? [{ ...shelf, items }] : [];
}

/** Pages the feed holds at most; YouTube's home rarely runs past four. */
const MAX_PAGES = 6;

/**
 * YouTube Music's home feed as shelves (BitChord's Home): the account's own
 * feed when signed in, YouTube's public one for this region when not. Every
 * page is read as soon as the one before arrives.
 */
export function YouTubeShelves() {
  const home = useYtHome();
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = home;
  const pages = home.data?.pages.length ?? 0;
  const hideVideos = useSettings().data?.hideHomeVideos ?? false;
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && pages < MAX_PAGES)
      void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, pages]);

  if (home.isError) {
    const code = (errorCode(home.error) ?? 'network') as ErrorCode;
    const message = SPOTIFY_ERRORS[code];
    return (
      <Alert status="danger" role="alert" className="mt-8">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>
            {code === 'network'
              ? 'Couldn’t reach YouTube Music'
              : message.title.replace('Spotify', 'YouTube Music')}
          </Alert.Title>
          <Alert.Description>{message.body}</Alert.Description>
        </Alert.Content>
        <Button
          size="sm"
          variant="secondary"
          onPress={() => void home.refetch()}
        >
          Try again
        </Button>
      </Alert>
    );
  }
  return (
    <>
      {home.data?.pages
        .flatMap((p) => p.shelves)
        .flatMap((shelf) => (hideVideos ? withoutVideos(shelf) : [shelf]))
        .map((shelf, i) => (
          <YtShelfView key={`${shelf.title}-${i}`} shelf={shelf} />
        ))}
    </>
  );
}
