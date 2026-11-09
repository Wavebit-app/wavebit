import { Skeleton } from '@heroui/react';
import type { CSSProperties } from 'react';
import type { LocalTrack } from '../../../shared/schemas/library';
import { nav } from '../../app/router';
import { PageHeader } from '../../design/PageHeader';
import { Shelf, type ShelfKind } from '../../design/Shelf';
import { count, greeting } from '../../lib/format';
import {
  useHome,
  useLibraryState,
  usePlayHistory,
  usePlaylists,
  useSettings,
  useSignedIn,
  useSpotifyStatus,
} from '../../lib/queries';
import { useSizeClass } from '../../lib/useBreakpoint';
import {
  AlbumTile,
  ArtistTile,
  PlaylistTile,
  TrackCell,
} from '../library/Tiles';
import { fromHistory, fromLocal, player } from '../player/player';
import { SearchBox } from '../search/SearchBox';
import { YouTubeShelves } from '../youtube/YouTube';
import { SpotifyShelves } from './SpotifyShelves';
import { TopPicks } from './TopPicks';

/** A four-row song shelf: any song plays the whole shelf from there. */
function TrackShelf({
  title,
  subtitle,
  tracks,
  plays,
}: {
  title: string;
  subtitle?: string;
  tracks: LocalTrack[];
  plays?: boolean;
}) {
  const queue = tracks.map(fromLocal);
  return (
    <Shelf title={title} subtitle={subtitle} kind="tracks">
      {queue.map((t, i) => (
        <TrackCell
          key={t.id}
          track={t}
          meta={plays ? count(tracks[i]!.plays, 'play') : undefined}
          onPlay={() => player.playList(queue, i, title)}
        />
      ))}
    </Shelf>
  );
}

/**
 * Recently Played: what was listened to in wavebit, newest first, streams
 * included, then the library's older file plays. BitChord's comes from the
 * account's history; plays here never reach Spotify, so wavebit keeps its own.
 */
function RecentlyPlayed({ local }: { local: LocalTrack[] }) {
  const history = usePlayHistory().data ?? [];
  const seen = new Set(history.map((h) => h.id));
  const queue = [
    ...history.map(fromHistory),
    ...local.filter((t) => !seen.has(t.id)).map(fromLocal),
  ].slice(0, 24);
  if (queue.length === 0) return null;
  return (
    <Shelf title="Recently Played" kind="tracks">
      {queue.map((t, i) => (
        <TrackCell
          key={t.id}
          track={t}
          onPlay={() => player.playList(queue, i, 'Recently Played')}
        />
      ))}
    </Shelf>
  );
}

function SkeletonShelf({ kind }: { kind: ShelfKind }) {
  return (
    <Shelf title=" " label="Loading" kind={kind}>
      {Array.from({ length: kind === 'tracks' ? 8 : 6 }, (_, i) =>
        kind === 'tracks' ? (
          <Skeleton key={i} className="my-2 h-10 w-full rounded-md" />
        ) : (
          <Skeleton
            key={i}
            className={`w-full rounded-md ${kind === 'picks' ? 'aspect-[3/4]' : 'aspect-square'}`}
          />
        ),
      )}
    </Shelf>
  );
}

/**
 * DESIGN.md › Home, after BitChord's Home feed: Top Picks for You, Recently
 * Played, then shelves of albums, playlists, songs and artists. Everything
 * but Your playlists comes from the local library and its play history.
 */
export function HomePage() {
  const state = useLibraryState().data;
  const home = useHome();
  const status = useSpotifyStatus().data;
  const signedIn = useSignedIn();
  const playlists = usePlaylists(signedIn).data ?? [];
  const compact = useSizeClass() === 'compact';
  const feed = home.data;
  const hide = useSettings().data;
  const empty = state?.trackCount === 0;
  const name =
    status?.state === 'signed_in'
      ? (status.profile?.displayName ?? null)
      : null;

  return (
    <div
      style={{ '--page-x': compact ? '1.25rem' : '2.5rem' } as CSSProperties}
      className={compact ? 'px-5 pt-5 pb-10' : 'px-10 pt-8 pb-12'}
    >
      <PageHeader
        title={greeting()}
        meta="Your music, Spotify and YouTube Music"
      />
      {compact && (
        <div className="mt-4">
          <SearchBox size="lg" />
        </div>
      )}

      {empty ? (
        <>
          {!hide?.hideTopPicks && <TopPicks picks={null} name={name} />}
          {!hide?.hideRecentlyPlayed && <RecentlyPlayed local={[]} />}
          <SpotifyShelves />
          <YouTubeShelves />
        </>
      ) : !feed ? (
        <>
          <SkeletonShelf kind="picks" />
          <SkeletonShelf kind="tracks" />
          <SkeletonShelf kind="square" />
        </>
      ) : (
        <>
          {!hide?.hideTopPicks && <TopPicks picks={feed.picks} name={name} />}
          {!hide?.hideRecentlyPlayed && (
            <RecentlyPlayed local={feed.recentlyPlayed} />
          )}
          <SpotifyShelves />
          <YouTubeShelves />
          {feed.recentAlbums.length > 0 && (
            <Shelf
              title="Recently Added"
              kind="square"
              onOpen={() => nav.go({ name: 'library', tab: 'albums' })}
            >
              {feed.recentAlbums.map((a) => (
                <AlbumTile key={a.key} album={a} />
              ))}
            </Shelf>
          )}
          {playlists.length > 0 && (
            <Shelf
              title="Your playlists"
              kind="square"
              onOpen={() => nav.go({ name: 'library', tab: 'playlists' })}
            >
              {playlists.slice(0, 12).map((p) => (
                <PlaylistTile key={p.id} playlist={p} />
              ))}
            </Shelf>
          )}
          {feed.onRepeat.length > 0 && (
            <TrackShelf
              title="On Repeat"
              subtitle="Your most played songs"
              tracks={feed.onRepeat}
              plays
            />
          )}
          {feed.topArtists.length > 0 && (
            <Shelf
              title="Your artists"
              kind="circle"
              onOpen={() => nav.go({ name: 'library', tab: 'artists' })}
            >
              {feed.topArtists.map((a) => (
                <ArtistTile key={a.name} artist={a} />
              ))}
            </Shelf>
          )}
          {feed.unplayedAlbums.length > 0 && (
            <Shelf
              title="Albums you haven’t played"
              subtitle="In your library, never started"
              kind="square"
            >
              {feed.unplayedAlbums.map((a) => (
                <AlbumTile key={a.key} album={a} />
              ))}
            </Shelf>
          )}
        </>
      )}
    </div>
  );
}
