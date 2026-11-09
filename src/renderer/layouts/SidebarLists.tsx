import { useMemo, useState, type ReactNode } from 'react';
import { primaryArtist } from '../../shared/lrc';
import { nav, useNav, type Route } from '../app/router';
import { Artwork } from '../design/Artwork';
import { menuOn } from '../design/ContextMenu';
import { PlayingBars } from '../design/PlayingBars';
import { PlaylistCover } from '../design/PlaylistCover';
import { songMenu, spotifyPlaylistMenu } from '../features/menus/menus';
import {
  fromHistory,
  player,
  usePlayer,
  type Playable,
} from '../features/player/player';
import {
  useArtistProfile,
  usePlayHistory,
  usePlaylists,
  useRemoveImport,
  useSettings,
  useSignedIn,
} from '../lib/queries';
import {
  recentArtists,
  recentSongs,
  type RecentArtist,
} from './sidebarListRules';

const PAGE = { playlists: 6, songs: 8, artists: 6 };

function Heading({ children }: { children: string }) {
  return (
    <h2 className="mx-3 mt-6 mb-2 shrink-0 text-[0.8667rem] font-semibold text-muted first:mt-5">
      {children}
    </h2>
  );
}

/** The first `page` rows, then Show more for the next `page`. */
function Paged<T>({
  items,
  page,
  children,
}: {
  items: T[];
  page: number;
  children: (item: T, index: number) => ReactNode;
}) {
  const [shown, setShown] = useState(page);
  return (
    <>
      {items.slice(0, shown).map(children)}
      {items.length > shown && (
        <button
          type="button"
          onClick={() => setShown(shown + page)}
          className="no-drag h-8 shrink-0 rounded-md px-3 text-left text-[0.8667rem] font-medium text-muted hover:bg-sunken hover:text-foreground"
        >
          Show more
        </button>
      )}
    </>
  );
}

function Playlists() {
  const { route } = useNav();
  const show = useSettings().data?.showPlaylists ?? false;
  const signedIn = useSignedIn();
  const playlists = usePlaylists(signedIn && show).data ?? [];
  const removing = useRemoveImport();
  const source = usePlayer((s) => s.source);
  const paused = usePlayer((s) => !s.playing);
  if (!signedIn || !show || playlists.length === 0) return null;
  return (
    <>
      <Heading>Playlists</Heading>
      <Paged items={playlists} page={PAGE.playlists}>
        {(p) => {
          const active = route.name === 'playlist' && route.id === p.id;
          return (
            <button
              key={p.id}
              type="button"
              aria-current={active ? 'page' : undefined}
              onClick={() => nav.go({ name: 'playlist', id: p.id })}
              onContextMenu={menuOn(() =>
                spotifyPlaylistMenu(p, () => removing.mutate(p.id)),
              )}
              className={`no-drag flex h-9 shrink-0 items-center gap-2.5 rounded-md px-3 text-left text-sm ${
                active
                  ? 'bg-accent-soft font-semibold text-accent'
                  : 'hover:bg-sunken'
              }`}
            >
              <PlaylistCover id={p.id} src={p.imageUrl} size={24} />
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              {source === p.name && <PlayingBars paused={paused} />}
            </button>
          );
        }}
      </Paged>
    </>
  );
}

function SongRow({
  song,
  current,
  paused,
  onPress,
}: {
  song: Playable;
  current: boolean;
  paused: boolean;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      onContextMenu={menuOn(() => songMenu(song))}
      aria-label={current ? `${song.title}, now playing` : `Play ${song.title}`}
      className="no-drag flex h-11 shrink-0 items-center gap-2.5 rounded-md px-3 text-left hover:bg-sunken"
    >
      <Artwork key={song.artwork} src={song.artwork} size={32} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className={`truncate text-sm leading-tight ${current ? 'font-semibold text-accent' : 'font-medium'}`}
        >
          {song.title}
        </span>
        <span className="truncate text-xs leading-tight text-muted">
          {song.artist}
        </span>
      </span>
      {current && <PlayingBars paused={paused} />}
    </button>
  );
}

function ArtistRow({
  artist,
  current,
  paused,
}: {
  artist: RecentArtist;
  current: boolean;
  paused: boolean;
}) {
  const { route } = useNav();
  // A file's artist stays private: their name is only asked about for streams.
  const profile = useArtistProfile(artist.local ? '' : artist.name).data;
  const picture =
    profile?.imageUrl?.replace(/=w\d+-h\d+/, '=w120-h120') ?? artist.art;
  const target: Route = artist.local
    ? { name: 'artist', artist: artist.credit }
    : profile?.browseId
      ? { name: 'ytArtist', id: profile.browseId }
      : { name: 'search', query: artist.name };
  const active =
    (route.name === 'ytArtist' && route.id === profile?.browseId) ||
    (route.name === 'artist' && route.artist === artist.credit);
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      onClick={() => nav.go(target)}
      className={`no-drag flex h-9 shrink-0 items-center gap-2.5 rounded-md px-3 text-left text-sm ${
        active ? 'bg-accent-soft font-semibold text-accent' : 'hover:bg-sunken'
      }`}
    >
      <Artwork key={picture} src={picture} size={28} rounded="rounded-full" />
      <span className="min-w-0 flex-1 truncate">{artist.name}</span>
      {current && <PlayingBars paused={paused} />}
    </button>
  );
}

/**
 * DESIGN.md › Sidebar: one scrolling list under the main links, as BitChord's
 * web sidebar has it: Playlists, Recently played and Artists, each paged with
 * Show more. Bars mark whatever is playing.
 */
export function SidebarLists() {
  const history = usePlayHistory().data;
  const current = usePlayer((s) => s.queue[s.index]);
  const paused = usePlayer((s) => !s.playing);
  const songs = useMemo(
    () => recentSongs((history ?? []).map(fromHistory), current),
    [history, current],
  );
  const artists = useMemo(() => recentArtists(songs), [songs]);
  const playingArtist = current
    ? primaryArtist(current.artist).trim().toLowerCase()
    : '';
  return (
    <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-1">
      <Playlists />
      {songs.length > 0 && (
        <>
          <Heading>Recently played</Heading>
          <Paged items={songs} page={PAGE.songs}>
            {(song, i) => {
              const isCurrent = song.id === current?.id;
              return (
                <SongRow
                  key={song.id}
                  song={song}
                  current={isCurrent}
                  paused={paused}
                  onPress={() =>
                    isCurrent
                      ? player.toggle()
                      : player.playList(songs, i, 'Recently played')
                  }
                />
              );
            }}
          </Paged>
        </>
      )}
      {artists.length > 0 && (
        <>
          <Heading>Artists</Heading>
          <Paged items={artists} page={PAGE.artists}>
            {(artist) => (
              <ArtistRow
                key={artist.name}
                artist={artist}
                current={artist.name.toLowerCase() === playingArtist}
                paused={paused}
              />
            )}
          </Paged>
        </>
      )}
    </div>
  );
}
