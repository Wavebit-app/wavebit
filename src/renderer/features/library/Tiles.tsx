import type {
  AlbumSummary,
  ArtistSummary,
} from '../../../shared/schemas/library';
import type { SpotifyPlaylist } from '../../../shared/schemas/spotify';
import { nav } from '../../app/router';
import { Artwork } from '../../design/Artwork';
import { PlaylistCover } from '../../design/PlaylistCover';
import { menuOn } from '../../design/ContextMenu';
import { PlayingBars } from '../../design/PlayingBars';
import { artUrl, count, initials } from '../../lib/format';
import { useRemoveImport } from '../../lib/queries';
import {
  localAlbumMenu,
  localArtistMenu,
  songMenu,
  spotifyPlaylistMenu,
} from '../menus/menus';
import { usePlayer, type Playable } from '../player/player';

export function AlbumTile({
  album,
  meta,
}: {
  album: AlbumSummary;
  meta?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => nav.go({ name: 'album', key: album.key })}
      onContextMenu={menuOn(() => localAlbumMenu(album))}
      className="flex min-w-0 flex-col gap-2 rounded-md text-left"
    >
      <Artwork
        src={album.hasArt ? artUrl(album.key) : null}
        className="aspect-square w-full"
        rounded="rounded-md"
      />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium">{album.title}</span>
        <span className="truncate text-[0.8667rem] text-muted tabular-nums">
          {meta ?? album.artist}
        </span>
      </span>
    </button>
  );
}

export function ArtistTile({ artist }: { artist: ArtistSummary }) {
  return (
    <button
      type="button"
      onClick={() => nav.go({ name: 'artist', artist: artist.name })}
      onContextMenu={menuOn(() => localArtistMenu(artist))}
      className="flex min-w-0 flex-col items-center gap-2 rounded-md text-center"
    >
      {artist.artKey ? (
        <Artwork
          src={artUrl(artist.artKey)}
          className="aspect-square w-full"
          rounded="rounded-full"
        />
      ) : (
        <span
          aria-hidden
          className="flex aspect-square w-full items-center justify-center rounded-full bg-accent-soft text-3xl font-semibold text-accent"
        >
          {initials(artist.name)}
        </span>
      )}
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium">{artist.name}</span>
        <span className="truncate text-[0.8667rem] text-muted tabular-nums">
          {count(artist.trackCount, 'song')}
        </span>
      </span>
    </button>
  );
}

export function PlaylistTile({ playlist }: { playlist: SpotifyPlaylist }) {
  const removing = useRemoveImport();
  return (
    <button
      type="button"
      onClick={() => nav.go({ name: 'playlist', id: playlist.id })}
      onContextMenu={menuOn(() =>
        spotifyPlaylistMenu(playlist, () => removing.mutate(playlist.id)),
      )}
      className="flex min-w-0 flex-col gap-2 rounded-md text-left"
    >
      <PlaylistCover
        id={playlist.id}
        src={playlist.imageUrl}
        className="aspect-square w-full"
        rounded="rounded-md"
      />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium">{playlist.name}</span>
        <span className="truncate text-[0.8667rem] text-muted tabular-nums">
          {[
            playlist.trackCount !== null
              ? count(playlist.trackCount, 'song')
              : null,
            playlist.owner,
          ]
            .filter(Boolean)
            .join(' · ') || 'Your library'}
        </span>
      </span>
    </button>
  );
}

/**
 * One song in a four-row shelf (BitChord's Recents pager): artwork, title and
 * artist. A press plays the whole shelf from this song.
 */
export function TrackCell({
  track,
  meta,
  onPlay,
}: {
  track: Playable;
  meta?: string;
  onPlay: () => void;
}) {
  const now = usePlayer((s) =>
    s.queue[s.index]?.id === track.id
      ? s.playing
        ? 'playing'
        : 'paused'
      : null,
  );
  const playing = now !== null;
  return (
    <div
      onContextMenu={menuOn(() => songMenu(track, { onPlay }))}
      className="flex min-w-0 items-center rounded-md hover:bg-sunken"
    >
      <button
        type="button"
        onClick={onPlay}
        aria-current={playing ? 'true' : undefined}
        className="flex h-14 min-w-0 flex-1 items-center gap-3 rounded-md px-2 text-left"
      >
        <Artwork src={track.artwork} size={40} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span
            className={`truncate font-medium ${playing ? 'text-accent' : ''}`}
          >
            {track.title}
          </span>
          <span className="truncate text-[0.8667rem] text-muted">
            {track.artist}
          </span>
        </span>
        {now && <PlayingBars paused={now === 'paused'} />}
        {meta && (
          <span className="shrink-0 text-[0.8667rem] text-muted tabular-nums">
            {meta}
          </span>
        )}
      </button>
    </div>
  );
}

export const GRID =
  'grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-4';
