import { Button, Kbd, Spinner } from '@heroui/react';
import { Search, X } from 'lucide-react';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { nav } from '../../app/router';
import { searchInputId, setUi, useUi } from '../../app/ui';
import { Artwork } from '../../design/Artwork';
import { menuOn, type MenuSpec } from '../../design/ContextMenu';
import { artUrl } from '../../lib/format';
import {
  usePlaylists,
  useSearch,
  useSignedIn,
  useYtSearch,
} from '../../lib/queries';
import {
  localAlbumMenu,
  localArtistMenu,
  songMenu,
  spotifyPlaylistMenu,
  ytItemMenu,
} from '../menus/menus';
import { fromLocal, player } from '../player/player';
import { open as openYt, streamOf } from '../youtube/YouTube';
import { SpotifyMark } from '../../design/BrandMarks';
import { parseSpotifyLink } from '../../../shared/spotifyLink';
import { spotifyRoute } from '../spotify/rowLinks';
import { fitResults } from './budget';

interface Result {
  key: string;
  group: string;
  title: string;
  meta: string;
  art: string | null;
  open: () => void;
  /** Drawn instead of the artwork. */
  mark?: boolean;
  /** A person: the picture is a circle. */
  round?: boolean;
  /** What a right-click on the row offers. */
  menu?: () => MenuSpec | null;
}

const LINK_TITLES = {
  playlist: 'Open this Spotify playlist',
  album: 'Open this Spotify album',
  artist: 'Open this Spotify artist',
  track: 'Open this Spotify song',
};

const MIN_REMOTE = 2;
const REMOTE_DELAY_MS = 300;
/** YouTube Music's sections the dropdown shows, and how many rows of each. */
const YT_GROUPS: Record<string, number> = {
  'Top result': 1,
  Songs: 3,
  Artists: 2,
  Albums: 2,
  Playlists: 1,
};

/** Google serves any size of a cover; a 40px row needs far less than the 400px parsed. */
const thumbnail = (url: string | null) =>
  url?.replace(/=w\d+-h\d+/, '=w120-h120') ?? null;

/**
 * DESIGN.md › Search: the title-bar pill. Results dock under it; Up and Down
 * move, Enter opens, Esc clears. Files answer at once, YouTube Music's real
 * results (covers and artist avatars) join them when typing pauses. Spotify
 * playlists are filtered from the list already loaded, so typing never calls
 * Spotify.
 */
export function SearchBox({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  const query = useUi((s) => s.search);
  const deferred = useDeferredValue(query.trim());
  const results = useSearch(deferred);
  const signedIn = useSignedIn();
  const playlists = usePlaylists(signedIn);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  const link = useMemo(() => parseSpotifyLink(deferred), [deferred]);

  // YouTube Music is asked once typing pauses, not on every key.
  const [settled, setSettled] = useState('');
  useEffect(() => {
    const wanted =
      open && !link && deferred.length >= MIN_REMOTE ? deferred : '';
    if (!wanted) return setSettled('');
    const timer = setTimeout(() => setSettled(wanted), REMOTE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [deferred, link, open]);
  const remote = useYtSearch(settled);
  const waiting =
    !link &&
    deferred.length >= MIN_REMOTE &&
    (settled !== deferred || remote.isFetching);

  const items = useMemo<Result[]>(() => {
    if (link)
      return [
        {
          key: 'link',
          group: 'Spotify link',
          title: LINK_TITLES[link.kind],
          meta:
            link.kind === 'playlist'
              ? 'Add it to your playlists from its page'
              : 'Opens here in wavebit',
          art: null,
          mark: true,
          open: () => nav.go(spotifyRoute(link)),
        },
      ];
    if (!deferred || !results.data) return [];
    const lower = deferred.toLowerCase();
    const r = results.data;
    const local: Result[] = [
      ...r.tracks.map((t) => ({
        key: `t${t.id}`,
        group: 'Your songs',
        title: t.title,
        meta: `${t.artist}${t.album ? ` · ${t.album}` : ''}`,
        art: t.hasArt ? artUrl(t.albumKey) : null,
        menu: () => songMenu(fromLocal(t)),
        open: () =>
          player.playList(
            r.tracks.map(fromLocal),
            r.tracks.indexOf(t),
            'Search',
          ),
      })),
      ...r.albums.map((a) => ({
        key: `a${a.key}`,
        group: 'Your albums',
        title: a.title,
        meta: a.artist,
        art: a.hasArt ? artUrl(a.key) : null,
        menu: () => localAlbumMenu(a),
        open: () => nav.go({ name: 'album', key: a.key }),
      })),
      ...r.artists.map((a) => ({
        key: `r${a.name}`,
        group: 'Your artists',
        title: a.name,
        meta: `${a.trackCount} songs`,
        art: a.artKey ? artUrl(a.artKey) : null,
        round: true,
        menu: () => localArtistMenu(a),
        open: () => nav.go({ name: 'artist', artist: a.name }),
      })),
      ...(playlists.data ?? [])
        .filter((p) => p.name.toLowerCase().includes(lower))
        .slice(0, 3)
        .map((p) => ({
          key: `p${p.id}`,
          group: 'Spotify playlists',
          title: p.name,
          meta: p.owner ?? 'Spotify',
          art: p.imageUrl,
          menu: () => spotifyPlaylistMenu(p),
          open: () => nav.go({ name: 'playlist', id: p.id }),
        })),
    ];
    const fromYt = ((settled ? remote.data : undefined) ?? []).flatMap(
      (shelf) => {
        const limit = YT_GROUPS[shelf.title];
        if (!limit) return [];
        const usable = shelf.items.filter(
          (i) => i.videoId || /^(MPRE|VL|UC)/.test(i.browseId ?? ''),
        );
        const songs = usable.filter((i) => i.videoId);
        return usable.slice(0, limit).map((item): Result => {
          return {
            key: `y${shelf.title}${item.videoId ?? item.browseId}`,
            group: shelf.title,
            title: item.title,
            meta: item.subtitle,
            art: thumbnail(item.imageUrl),
            round: item.kind === 'artist',
            menu: () => ytItemMenu(item),
            open: item.videoId
              ? () =>
                  player.playList(
                    songs.map(streamOf),
                    songs.indexOf(item),
                    'Search',
                  )
              : () => openYt(item),
          };
        });
      },
    );
    return [
      ...fitResults(local, fromYt, waiting),
      {
        key: 'everywhere',
        group: 'Everywhere',
        title: `See everything for “${deferred}”`,
        meta: 'Your files, YouTube Music and Spotify',
        art: null,
        open: () => nav.go({ name: 'search', query: deferred }),
      },
    ];
  }, [
    deferred,
    link,
    results.data,
    playlists.data,
    remote.data,
    settled,
    waiting,
  ]);

  useEffect(() => {
    setActive(0);
  }, [deferred]);
  // Keyboard moves keep the chosen row in view; `nearest` leaves a hovered one still.
  useEffect(() => {
    box.current
      ?.querySelector('[role=option][aria-selected=true]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, []);

  const choose = (item: Result | undefined) => {
    if (!item) return;
    item.open();
    setOpen(false);
  };
  const clear = () => {
    setUi({ search: '' });
    document.getElementById(searchInputId)?.focus();
  };

  return (
    <div ref={box} className="relative w-full">
      <label
        className={`flex items-center gap-2 rounded-full bg-sunken pr-1.5 pl-3.5 text-muted ring-1 ring-[var(--field-border)] focus-within:ring-2 focus-within:ring-accent ${size === 'lg' ? 'h-12' : 'h-[38px]'}`}
      >
        <Search size={size === 'lg' ? 18 : 15} aria-hidden />
        <input
          id={searchInputId}
          type="search"
          role="combobox"
          aria-expanded={open && !!deferred}
          aria-controls="wavebit-search-results"
          aria-label="Search your music"
          placeholder="Search your music"
          value={query}
          onChange={(e) => {
            setUi({ search: e.target.value });
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, items.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === 'Enter') choose(items[active]);
            else if (e.key === 'Escape') {
              e.stopPropagation();
              if (query) clear();
              else (e.target as HTMLInputElement).blur();
            }
          }}
          className={`min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted [&::-webkit-search-cancel-button]:hidden ${size === 'lg' ? 'text-base' : 'text-[0.8667rem]'}`}
        />
        {query ? (
          <Button
            isIconOnly
            variant="ghost"
            size="sm"
            aria-label="Clear search"
            onPress={clear}
            className="size-6 min-w-6 rounded-full"
          >
            <X size={14} />
          </Button>
        ) : (
          size === 'sm' && (
            <Kbd className="rounded-full bg-overlay px-2 text-[0.7333rem]">
              Ctrl K
            </Kbd>
          )
        )}
      </label>

      {open && deferred && (link || results.data || results.isFetched) && (
        <div
          id="wavebit-search-results"
          role="listbox"
          aria-label="Search results"
          className="absolute inset-x-0 top-[calc(100%+12px)] z-50 max-h-[min(340px,60vh)] overflow-y-auto rounded-md bg-overlay p-2 shadow-overlay"
        >
          {items.map((item, i) => (
            <div key={item.key}>
              {(i === 0 || items[i - 1]!.group !== item.group) && (
                <h3
                  className={`px-2 pb-1 text-xs font-semibold text-muted ${i === 0 ? 'pt-1' : 'pt-3'}`}
                >
                  {item.group}
                </h3>
              )}
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onContextMenu={menuOn(item.menu)}
                onClick={() => choose(item)}
                className={`flex h-14 w-full items-center gap-3 rounded-[4px] px-2 text-left ${i === active ? 'bg-sunken' : ''}`}
              >
                {item.mark ? (
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-[4px] bg-sunken">
                    <SpotifyMark size={20} />
                  </span>
                ) : (
                  <Artwork
                    src={item.art}
                    size={40}
                    rounded={item.round ? 'rounded-full' : 'rounded-[4px]'}
                  />
                )}
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium">
                    {item.title}
                  </span>
                  <span className="truncate text-xs text-muted">
                    {item.meta}
                  </span>
                </span>
              </button>
            </div>
          ))}
          {waiting && (
            <p className="flex items-center gap-2 px-2 pt-2 pb-1 text-xs text-muted">
              <Spinner size="sm" color="current" />
              Searching YouTube Music
            </p>
          )}
        </div>
      )}
    </div>
  );
}
