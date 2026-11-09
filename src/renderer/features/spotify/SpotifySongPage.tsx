import { Skeleton } from '@heroui/react';
import { Heart, ListEnd } from 'lucide-react';
import { useMemo, type CSSProperties } from 'react';
import { nav } from '../../app/router';
import { Artwork } from '../../design/Artwork';
import { Backdrop } from '../../design/Backdrop';
import { SpotifyMark } from '../../design/BrandMarks';
import { IconAction, openInBrowser, PlayAction } from '../../design/IconAction';
import { Shelf } from '../../design/Shelf';
import { clock, count } from '../../lib/format';
import {
  useSaved,
  useSaveTrack,
  useSignedIn,
  useSpotifySong,
} from '../../lib/queries';
import { useSizeClass } from '../../lib/useBreakpoint';
import { player } from '../player/player';
import { ListDownloadAction } from '../downloads/DownloadActions';
import { playable } from './PlaylistPage';
import { Release } from './Release';
import { SignedOut, SpotifyError } from './SpotifyStates';

/**
 * One Spotify song (GET /tracks/{id}, else the web player's getTrack): the
 * cover, its artists and album as links, Play, Add to queue and the heart.
 * Opened from a pasted link or a row's Song details.
 */
export function SpotifySongPage({ id }: { id: string }) {
  const signedIn = useSignedIn();
  const song = useSpotifySong(id, signedIn);
  const compact = useSizeClass() === 'compact';
  const pad = compact ? 'px-5' : 'px-10';
  const s = song.data;
  const uris = useMemo(() => (s ? [s.uri] : []), [s]);
  const saved = useSaved(uris, signedIn).data?.get(s?.uri ?? '');
  const save = useSaveTrack();

  if (!signedIn)
    return (
      <div className="flex min-h-full items-center justify-center">
        <SignedOut />
      </div>
    );
  if (song.isError)
    return (
      <div className={`${pad} py-8`}>
        <SpotifyError error={song.error} retry={() => void song.refetch()} />
      </div>
    );

  const track = useMemo(() => (s ? playable(s) : null), [s]);
  const tracks = useMemo(() => (track ? [track] : []), [track]);
  const link = 'font-medium text-foreground hover:underline';
  return (
    <div>
      <section
        className={`relative flex min-h-[280px] items-end ${pad} pt-10 pb-7`}
      >
        <Backdrop src={s?.coverUrl} />
        <div
          className={`relative flex gap-7 ${compact ? 'flex-col items-start' : 'items-end'}`}
        >
          {s ? (
            <Artwork
              src={s.coverUrl}
              size={compact ? 160 : 200}
              rounded="rounded-md"
            />
          ) : (
            <Skeleton className="size-[200px] rounded-md" />
          )}
          <div className="flex min-w-0 flex-col gap-2">
            <span className="flex items-center gap-1.5 text-[0.8667rem] font-medium text-muted">
              <SpotifyMark size={14} />
              Spotify song
            </span>
            <h1 className="text-headline font-semibold tracking-[-0.02em]">
              {s?.title ?? ' '}
            </h1>
            {s && (
              <span className="text-sm text-muted tabular-nums">
                {s.artists.map((name, i) => {
                  const artist = s.artistIds[i];
                  return (
                    <span key={`${name}-${i}`}>
                      {i > 0 && ', '}
                      {artist ? (
                        <button
                          type="button"
                          onClick={() =>
                            nav.go({ name: 'spotifyArtist', id: artist })
                          }
                          className={link}
                        >
                          {name}
                        </button>
                      ) : (
                        <span className="font-medium text-foreground">
                          {name}
                        </span>
                      )}
                    </span>
                  );
                })}
                {s.album && ' · '}
                {s.album &&
                  (s.albumId ? (
                    <button
                      type="button"
                      onClick={() =>
                        nav.go({ name: 'spotifyAlbum', id: s.albumId! })
                      }
                      className={link}
                    >
                      {s.album}
                    </button>
                  ) : (
                    s.album
                  ))}
                {' · '}
                {[
                  s.year,
                  clock(s.durationMs),
                  s.explicit ? 'Explicit' : null,
                  s.playCount ? count(s.playCount, 'play') : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-1">
              <PlayAction
                isDisabled={!track}
                onPress={() =>
                  track && player.playList([track], 0, s?.title ?? '')
                }
              />
              <IconAction
                label="Add to queue"
                isDisabled={!track}
                onPress={() => track && player.addToQueue(track)}
              >
                <ListEnd size={24} aria-hidden />
              </IconAction>
              {s && saved !== undefined && (
                <IconAction
                  label={saved ? 'Saved' : 'Save'}
                  active={saved}
                  onPress={() => save.mutate({ uri: s.uri, saved: !saved })}
                >
                  <Heart
                    size={24}
                    fill={saved ? 'currentColor' : 'none'}
                    aria-hidden
                  />
                </IconAction>
              )}
              {track && (
                <ListDownloadAction
                  tracks={tracks}
                  complete
                  title={track.title}
                />
              )}
              <IconAction
                label="Open in Spotify"
                onPress={() =>
                  openInBrowser(`https://open.spotify.com/track/${id}`)
                }
              >
                <SpotifyMark size={24} />
              </IconAction>
            </div>
          </div>
        </div>
      </section>
      {s?.albumId && s.album && (
        <div
          style={
            { '--page-x': compact ? '1.25rem' : '2.5rem' } as CSSProperties
          }
          className={`${pad} pb-12`}
        >
          <Shelf title="On the album" source="Spotify" kind="square">
            <Release
              id={s.albumId}
              name={s.album}
              imageUrl={s.coverUrl}
              year={s.year}
            />
          </Shelf>
        </div>
      )}
    </div>
  );
}
