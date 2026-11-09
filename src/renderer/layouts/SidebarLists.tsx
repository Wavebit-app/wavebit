import { Tooltip } from '@heroui/react';
import { ChevronDown } from 'lucide-react';
import {
  useMemo,
  useState,
  type MouseEventHandler,
  type ReactNode,
} from 'react';
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
/** DESIGN.md › Sidebar: large enough to tell one cover from another. */
const ART = { playlist: 36, song: 44, artist: 40, rail: 48 };

function Heading({ rail, children }: { rail: boolean; children: string }) {
  // The rail has no words to spare: a gap separates the groups.
  if (rail)
    return (
      <h2 className="h-3 shrink-0 first:h-2">
        <span className="sr-only">{children}</span>
      </h2>
    );
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
  rail,
  children,
}: {
  items: T[];
  page: number;
  rail: boolean;
  children: (item: T, index: number) => ReactNode;
}) {
  const [shown, setShown] = useState(page);
  const more = () => setShown(shown + page);
  return (
    <>
      {items.slice(0, shown).map(children)}
      {items.length > shown &&
        (rail ? (
          <Tooltip delay={300}>
            <Tooltip.Trigger>
              <button
                type="button"
                aria-label="Show more"
                onClick={more}
                className="no-drag flex h-8 w-12 shrink-0 items-center justify-center rounded-md text-muted hover:bg-sunken hover:text-foreground"
              >
                <ChevronDown size={18} aria-hidden />
              </button>
            </Tooltip.Trigger>
            <Tooltip.Content placement="right">Show more</Tooltip.Content>
          </Tooltip>
        ) : (
          <button
            type="button"
            onClick={more}
            className="no-drag h-8 shrink-0 rounded-md px-3 text-left text-[0.8667rem] font-medium text-muted hover:bg-sunken hover:text-foreground"
          >
            Show more
          </button>
        ))}
    </>
  );
}

/** One picture in the folded sidebar: its name is the tooltip. */
function RailArt({
  label,
  name,
  active = false,
  playing,
  onPress,
  onContextMenu,
  children,
}: {
  /** What a press does, for screen readers. */
  label: string;
  /** What it is, for the tooltip. */
  name: string;
  active?: boolean;
  /** Set while this is what's playing. */
  playing?: { paused: boolean };
  onPress: () => void;
  onContextMenu?: MouseEventHandler<HTMLElement>;
  children: ReactNode;
}) {
  return (
    <Tooltip delay={300}>
      <Tooltip.Trigger>
        <button
          type="button"
          aria-label={label}
          aria-current={active ? 'page' : undefined}
          onClick={onPress}
          onContextMenu={onContextMenu}
          className={`no-drag relative grid size-14 shrink-0 place-items-center rounded-md ${
            active ? 'bg-accent-soft' : 'hover:bg-sunken'
          }`}
        >
          {children}
          {playing && (
            <span className="absolute inset-1 grid place-items-center rounded-md bg-black/50">
              <PlayingBars paused={playing.paused} className="text-white" />
            </span>
          )}
        </button>
      </Tooltip.Trigger>
      <Tooltip.Content placement="right">{name}</Tooltip.Content>
    </Tooltip>
  );
}

function Playlists({ rail }: { rail: boolean }) {
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
      <Heading rail={rail}>Playlists</Heading>
      <Paged items={playlists} page={PAGE.playlists} rail={rail}>
        {(p) => {
          const active = route.name === 'playlist' && route.id === p.id;
          const open = () => nav.go({ name: 'playlist', id: p.id });
          const menu = menuOn(() =>
            spotifyPlaylistMenu(p, () => removing.mutate(p.id)),
          );
          if (rail)
            return (
              <RailArt
                key={p.id}
                label={`Open ${p.name}`}
                name={p.name}
                active={active}
                playing={source === p.name ? { paused } : undefined}
                onPress={open}
                onContextMenu={menu}
              >
                <PlaylistCover
                  id={p.id}
                  src={p.imageUrl}
                  size={ART.rail}
                  rounded="rounded-md"
                />
              </RailArt>
            );
          return (
            <button
              key={p.id}
              type="button"
              aria-current={active ? 'page' : undefined}
              onClick={open}
              onContextMenu={menu}
              className={`no-drag flex h-12 shrink-0 items-center gap-2.5 rounded-md px-3 text-left text-sm ${
                active
                  ? 'bg-accent-soft font-semibold text-accent'
                  : 'hover:bg-sunken'
              }`}
            >
              <PlaylistCover id={p.id} src={p.imageUrl} size={ART.playlist} />
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
  rail,
  onPress,
}: {
  song: Playable;
  current: boolean;
  paused: boolean;
  rail: boolean;
  onPress: () => void;
}) {
  const label = current ? `${song.title}, now playing` : `Play ${song.title}`;
  const menu = menuOn(() => songMenu(song));
  if (rail)
    return (
      <RailArt
        label={label}
        name={`${song.title} · ${song.artist}`}
        playing={current ? { paused } : undefined}
        onPress={onPress}
        onContextMenu={menu}
      >
        <Artwork
          key={song.artwork}
          src={song.artwork}
          size={ART.rail}
          rounded="rounded-md"
        />
      </RailArt>
    );
  return (
    <button
      type="button"
      onClick={onPress}
      onContextMenu={menu}
      aria-label={label}
      className="no-drag flex h-14 shrink-0 items-center gap-2.5 rounded-md px-3 text-left hover:bg-sunken"
    >
      <Artwork key={song.artwork} src={song.artwork} size={ART.song} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
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
  rail,
}: {
  artist: RecentArtist;
  current: boolean;
  paused: boolean;
  rail: boolean;
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
  if (rail)
    return (
      <RailArt
        label={`Open ${artist.name}`}
        name={artist.name}
        active={active}
        playing={current ? { paused } : undefined}
        onPress={() => nav.go(target)}
      >
        <Artwork
          key={picture}
          src={picture}
          size={ART.rail}
          rounded="rounded-full"
        />
      </RailArt>
    );
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      onClick={() => nav.go(target)}
      className={`no-drag flex h-13 shrink-0 items-center gap-2.5 rounded-md px-3 text-left text-sm ${
        active ? 'bg-accent-soft font-semibold text-accent' : 'hover:bg-sunken'
      }`}
    >
      <Artwork
        key={picture}
        src={picture}
        size={ART.artist}
        rounded="rounded-full"
      />
      <span className="min-w-0 flex-1 truncate">{artist.name}</span>
      {current && <PlayingBars paused={paused} />}
    </button>
  );
}

/**
 * DESIGN.md › Sidebar: one scrolling list under the main links, as BitChord's
 * web sidebar has it: Playlists, Recently played and Artists, each paged with
 * Show more. Bars mark whatever is playing. Folded to the rail, the same lists
 * stay as pictures.
 */
export function SidebarLists({ rail }: { rail: boolean }) {
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
    <div
      className={
        rail
          ? 'no-scrollbar mt-2 flex min-h-0 w-full flex-1 flex-col items-center gap-1 overflow-y-auto'
          : '-mx-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-1'
      }
    >
      <Playlists rail={rail} />
      {songs.length > 0 && (
        <>
          <Heading rail={rail}>Recently played</Heading>
          <Paged items={songs} page={PAGE.songs} rail={rail}>
            {(song, i) => {
              const isCurrent = song.id === current?.id;
              return (
                <SongRow
                  key={song.id}
                  song={song}
                  current={isCurrent}
                  paused={paused}
                  rail={rail}
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
          <Heading rail={rail}>Artists</Heading>
          <Paged items={artists} page={PAGE.artists} rail={rail}>
            {(artist) => (
              <ArtistRow
                key={artist.name}
                artist={artist}
                current={artist.name.toLowerCase() === playingArtist}
                paused={paused}
                rail={rail}
              />
            )}
          </Paged>
        </>
      )}
    </div>
  );
}
