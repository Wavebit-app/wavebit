import { Skeleton } from '@heroui/react';
import { Shuffle } from 'lucide-react';
import type { CSSProperties } from 'react';
import { nav } from '../../app/router';
import { Artwork } from '../../design/Artwork';
import { menuOn } from '../../design/ContextMenu';
import { spotifyArtistMenu } from '../menus/menus';
import { Backdrop } from '../../design/Backdrop';
import { SpotifyMark } from '../../design/BrandMarks';
import {
  IconAction,
  openInBrowser,
  PlayAction,
  ViewMenu,
} from '../../design/IconAction';
import { Shelf } from '../../design/Shelf';
import { count } from '../../lib/format';
import { useSignedIn, useSpotifyArtist } from '../../lib/queries';
import { useSizeClass } from '../../lib/useBreakpoint';
import { ListDownloadAction } from '../downloads/DownloadActions';
import { SongRow, SongRowSkeleton } from '../library/SongRow';
import { player } from '../player/player';
import { playable } from './PlaylistPage';
import { Release } from './Release';
import { rowLinks } from './rowLinks';
import { SignedOut, SpotifyError } from './SpotifyStates';

const WIDE = '32px minmax(0,2fr) minmax(0,1.2fr) 56px';
const NARROW = '24px minmax(0,1fr) 56px';

/**
 * A Spotify artist inside wavebit (the web player's queryArtistOverview):
 * the photo in a circle over the backdrop, followers and monthly listeners,
 * Popular songs that play (from a file, else YouTube Music), then each kind
 * of release (Spotify's include_groups: album, single, compilation, appears
 * on), Fans also like and, last as on BitChord, About.
 */
export function SpotifyArtistPage({ id }: { id: string }) {
  const signedIn = useSignedIn();
  const artist = useSpotifyArtist(id, signedIn);
  const compact = useSizeClass() === 'compact';
  const pad = compact ? 'px-5' : 'px-10';
  const columns = compact ? NARROW : WIDE;
  const a = artist.data;
  const queue = (a?.topTracks ?? []).map(playable);

  if (!signedIn)
    return (
      <div className="flex min-h-full items-center justify-center">
        <SignedOut />
      </div>
    );
  if (artist.isError)
    return (
      <div className={`${pad} py-8`}>
        <SpotifyError
          error={artist.error}
          retry={() => void artist.refetch()}
        />
      </div>
    );

  return (
    <div>
      <section
        className={`relative flex min-h-[280px] items-end ${pad} pt-10 pb-7`}
      >
        <Backdrop src={a?.imageUrl} />
        <div
          className={`relative flex gap-7 ${compact ? 'flex-col items-start' : 'items-end'}`}
        >
          {a ? (
            <Artwork
              src={a.imageUrl}
              size={compact ? 140 : 180}
              rounded="rounded-full"
            />
          ) : (
            <Skeleton className="size-[180px] rounded-full" />
          )}
          <div className="flex min-w-0 flex-col gap-2">
            <span className="flex items-center gap-1.5 text-[0.8667rem] font-medium text-muted">
              <SpotifyMark size={14} />
              Spotify artist
            </span>
            <h1 className="text-headline font-semibold tracking-[-0.02em]">
              {a?.name ?? ' '}
            </h1>
            {a && (
              <span className="text-sm text-muted tabular-nums">
                {[
                  a.monthlyListeners !== null
                    ? `${a.monthlyListeners.toLocaleString()} monthly listeners`
                    : null,
                  a.followers !== null ? count(a.followers, 'follower') : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-1">
              <PlayAction
                isDisabled={queue.length === 0}
                onPress={() => player.playList(queue, 0, a?.name ?? '')}
              />
              <IconAction
                label="Shuffle"
                isDisabled={queue.length === 0}
                onPress={() => player.shuffleList(queue, a?.name ?? '')}
              >
                <Shuffle size={24} aria-hidden />
              </IconAction>
              {a && (
                <ListDownloadAction tracks={queue} complete title={a.name} />
              )}
              <IconAction
                label="Open in Spotify"
                onPress={() =>
                  openInBrowser(`https://open.spotify.com/artist/${id}`)
                }
              >
                <SpotifyMark size={24} />
              </IconAction>
              <ViewMenu />
            </div>
          </div>
        </div>
      </section>

      <div
        style={{ '--page-x': compact ? '1.25rem' : '2.5rem' } as CSSProperties}
        className={`${pad} pt-6 pb-12`}
      >
        <h2 className="text-[1rem] font-semibold">Popular</h2>
        <div
          role="table"
          aria-label="Popular songs"
          className="mt-3 flex flex-col gap-1"
        >
          {artist.isPending
            ? Array.from({ length: 5 }, (_, i) => (
                <SongRowSkeleton key={i} columns={columns} />
              ))
            : a?.topTracks.map((t, index) => {
                const track = queue[index]!;
                return (
                  <SongRow
                    key={`${t.uri}-${index}`}
                    no={index + 1}
                    track={track}
                    title={t.title}
                    artist={t.artists.join(', ')}
                    album={compact ? undefined : (t.album ?? '')}
                    {...rowLinks(t)}
                    status={track.stream ? 'stream' : 'matched'}
                    statusColumn={false}
                    durationMs={t.durationMs}
                    artwork={t.imageUrl}
                    onPlay={() => player.playList(queue, index, a.name)}
                    columns={columns}
                  />
                );
              })}
        </div>
        {a && a.albums.length > 0 && (
          <Shelf title="Albums" source="Spotify" kind="square">
            {a.albums.map((r) => (
              <Release key={r.id} {...r} />
            ))}
          </Shelf>
        )}
        {a && a.singles.length > 0 && (
          <Shelf title="Singles and EPs" source="Spotify" kind="square">
            {a.singles.map((r) => (
              <Release key={r.id} {...r} />
            ))}
          </Shelf>
        )}
        {a && a.compilations.length > 0 && (
          <Shelf title="Compilations" source="Spotify" kind="square">
            {a.compilations.map((r) => (
              <Release key={r.id} {...r} />
            ))}
          </Shelf>
        )}
        {a && a.appearsOn.length > 0 && (
          <Shelf title="Appears on" source="Spotify" kind="square">
            {a.appearsOn.map((r) => (
              <Release key={r.id} {...r} />
            ))}
          </Shelf>
        )}
        {a && a.related.length > 0 && (
          <Shelf title="Fans also like" source="Spotify" kind="circle">
            {a.related.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => nav.go({ name: 'spotifyArtist', id: r.id })}
                onContextMenu={menuOn(() => spotifyArtistMenu(r))}
                className="flex min-w-0 flex-col items-center gap-2 rounded-md text-center"
              >
                <Artwork
                  src={r.imageUrl}
                  className="aspect-square w-full"
                  rounded="rounded-full"
                />
                <span className="w-full truncate text-sm font-medium">
                  {r.name}
                </span>
              </button>
            ))}
          </Shelf>
        )}
        {a?.biography && (
          <section aria-label={`About ${a.name}`} className="mt-9">
            <h2 className="text-[1rem] font-semibold">About {a.name}</h2>
            <p className="mt-2 max-w-[720px] whitespace-pre-line text-muted">
              {a.biography}
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
