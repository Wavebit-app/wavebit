import { Button, Dropdown, Label, ProgressBar, Skeleton } from '@heroui/react';
import {
  ArrowDownUp,
  ChevronDown,
  ChevronRight,
  Disc3,
  Download,
  FolderPlus,
  LayoutGrid,
  List,
  ListMusic,
  Music,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { useDeferredValue, useState, type CSSProperties } from 'react';
import type { SongSort } from '../../../shared/schemas/library';
import type { DownloadList } from '../../../shared/schemas/downloads';
import { nav, type LibraryTab, type Route } from '../../app/router';
import { Empty } from '../../design/Empty';
import { ViewMenu } from '../../design/IconAction';
import { PageHeader } from '../../design/PageHeader';
import { Segmented } from '../../design/Segmented';
import { Shelf, ShowAll } from '../../design/Shelf';
import { count, length } from '../../lib/format';
import {
  useAddFolder,
  useAlbums,
  useArtists,
  useDownloaded,
  useHome,
  useLibraryState,
  usePlaylists,
  useScanProgress,
  useSignedIn,
  useSpotifyAlbums,
  useSpotifyArtists,
  useGoogleAccount,
  useYtLibrary,
  useYtOAuth,
  useYtStatus,
} from '../../lib/queries';
import { useSizeClass } from '../../lib/useBreakpoint';
import { SearchBox } from '../search/SearchBox';
import { SignedOut, SpotifyError } from '../spotify/SpotifyStates';
import { ImportPlaylist } from '../spotify/ImportPlaylist';
import { DownloadsPage } from './DownloadsPage';
import { Filter } from './Filter';
import { ListeningCards } from './ListeningCards';
import { SongList } from './SongList';
import { Card as YtCard, YtShelfView } from '../youtube/YouTube';
import { AlbumTile, ArtistTile, GRID, PlaylistTile } from './Tiles';
import { Artwork } from '../../design/Artwork';

const SORTS: { value: SongSort; label: string }[] = [
  { value: 'title', label: 'Title' },
  { value: 'artist', label: 'Artist' },
  { value: 'album', label: 'Album' },
  { value: 'recent', label: 'Recently added' },
];

export function AddFolderButton({
  variant = 'primary',
}: {
  variant?: 'primary' | 'secondary';
}) {
  const add = useAddFolder();
  return (
    <Button
      variant={variant}
      isPending={add.isPending}
      onPress={() => add.mutate()}
    >
      <FolderPlus size={16} aria-hidden />
      {variant === 'primary' ? 'Add a music folder' : 'Add folder'}
    </Button>
  );
}

function ScanProgress() {
  const progress = useScanProgress();
  if (!progress.running) return null;
  return (
    <ProgressBar
      aria-label="Reading files"
      className="mt-5 gap-2"
      value={progress.total ? (progress.seen / progress.total) * 100 : 0}
    >
      <span className="text-sm text-muted tabular-nums">
        Reading · {progress.seen.toLocaleString()} of{' '}
        {count(progress.total, 'file')}
      </span>
      <ProgressBar.Track className="h-1">
        <ProgressBar.Fill className="bg-accent" />
      </ProgressBar.Track>
    </ProgressBar>
  );
}

/** One of the overview's links: icon, name, count and a chevron, no lines between. */
function CollectionLink({
  icon: Icon,
  label,
  meta,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  meta?: string;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      className="flex h-13 items-center gap-4 rounded-md px-3 text-left hover:bg-sunken"
    >
      <Icon size={22} className="shrink-0 text-accent" aria-hidden />
      <span className="flex-1 text-[1.0667rem]">{label}</span>
      {meta && <span className="text-sm text-muted tabular-nums">{meta}</span>}
      <ChevronRight size={18} className="text-faint" aria-hidden />
    </button>
  );
}

const LIST_PAGE: Record<DownloadList['kind'], (id: string) => Route> = {
  spotifyPlaylist: (id) => ({ name: 'playlist', id }),
  spotifyAlbum: (id) => ({ name: 'spotifyAlbum', id }),
  ytPage: (id) => ({ name: 'ytPage', id }),
};

/** An album or playlist downloaded whole. */
function DownloadedListTile({
  list,
  art,
}: {
  list: DownloadList;
  art: string | null;
}) {
  return (
    <button
      type="button"
      onClick={() => nav.go(LIST_PAGE[list.kind](list.id))}
      className="flex min-w-0 flex-col gap-2 rounded-md text-left"
    >
      <Artwork
        src={art}
        className="aspect-square w-full"
        rounded="rounded-md"
      />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium">{list.title}</span>
        <span className="truncate text-[0.8667rem] text-muted">
          {list.kind === 'spotifyAlbum' ? 'Album' : 'Playlist'}
        </span>
      </span>
    </button>
  );
}

/**
 * The Library's first page, after BitChord's: links to each collection, then
 * one row of each with Show all. Playlists lead, as on the phone; signed out,
 * the row holds the tile that connects Spotify.
 */
function Overview() {
  const state = useLibraryState().data;
  const signedIn = useSignedIn();
  const playlists = usePlaylists(signedIn);
  const recent = useHome().data?.recentAlbums ?? [];
  const spAlbums = useSpotifyAlbums(signedIn).data ?? [];
  const spArtists = useSpotifyArtists(signedIn).data ?? [];
  const ytSignedIn = useYtStatus().data?.state === 'signed_in';
  const yt = useYtLibrary(ytSignedIn).data;
  const googleSignedIn = !!useYtOAuth().data?.signedIn;
  const google = useGoogleAccount(googleSignedIn).data;
  const albums = useAlbums('').data ?? [];
  const artists = useArtists('').data ?? [];
  const downloaded = useDownloaded().data;
  // A list saved whole keeps only its name; its cover comes from what's loaded here.
  const covers = new Map<string, string | null | undefined>([
    ...(playlists.data ?? []).map((p) => [p.id, p.imageUrl] as const),
    ...spAlbums.map((a) => [a.id, a.imageUrl] as const),
    ...[...(yt?.playlists ?? []), ...(yt?.albums ?? [])].map(
      (y) => [y.browseId ?? '', y.imageUrl] as const,
    ),
  ]);
  const go = (tab: LibraryTab) => nav.go({ name: 'library', tab });
  const n = (value: number | undefined) => value?.toLocaleString();

  return (
    <>
      <ListeningCards />
      <nav
        aria-label="Collections"
        className="mt-5 grid gap-x-6 gap-y-1 min-[900px]:grid-cols-2"
      >
        <CollectionLink
          icon={Download}
          label="Downloads"
          meta={n(downloaded?.tracks.length)}
          onPress={() => go('downloads')}
        />
        <CollectionLink
          icon={Music}
          label="Songs"
          meta={n(state?.trackCount)}
          onPress={() => go('songs')}
        />
        <CollectionLink
          icon={Disc3}
          label="Albums"
          meta={n(state?.albumCount)}
          onPress={() => go('albums')}
        />
        <CollectionLink
          icon={UserRound}
          label="Artists"
          meta={n(state?.artistCount)}
          onPress={() => go('artists')}
        />
        <CollectionLink
          icon={ListMusic}
          label="Playlists"
          meta={signedIn ? n(playlists.data?.length) : undefined}
          onPress={() => go('playlists')}
        />
      </nav>

      {downloaded && downloaded.lists.length > 0 && (
        <Shelf title="Downloaded whole" source="On this computer" kind="square">
          {downloaded.lists.map((list) => (
            <DownloadedListTile
              key={`${list.kind}:${list.id}`}
              list={list}
              art={covers.get(list.id) ?? null}
            />
          ))}
        </Shelf>
      )}

      <Shelf
        title="Playlists"
        source="Spotify"
        kind="square"
        action={<ShowAll onPress={() => go('playlists')} />}
      >
        {signedIn
          ? (playlists.data ?? [])
              .slice(0, 12)
              .map((p) => <PlaylistTile key={p.id} playlist={p} />)
          : [
              <button
                key="connect"
                type="button"
                onClick={() => go('playlists')}
                className="flex min-w-0 flex-col gap-2 text-left"
              >
                <span className="flex aspect-square w-full items-center justify-center rounded-md bg-sunken text-accent">
                  <ListMusic size={40} strokeWidth={1.75} aria-hidden />
                </span>
                <span className="flex flex-col">
                  <span className="text-sm font-medium">Connect Spotify</span>
                  <span className="text-[0.8667rem] text-muted">
                    Your playlists, here
                  </span>
                </span>
              </button>,
            ]}
      </Shelf>
      {spAlbums.length > 0 && (
        <Shelf title="Saved albums" source="Spotify" kind="square">
          {spAlbums.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => nav.go({ name: 'spotifyAlbum', id: a.id })}
              className="flex min-w-0 flex-col gap-2 rounded-md text-left"
            >
              <Artwork
                src={a.imageUrl}
                className="aspect-square w-full"
                rounded="rounded-md"
              />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium">{a.name}</span>
                <span className="truncate text-[0.8667rem] text-muted">
                  {[a.artists.join(', '), a.year].filter(Boolean).join(' · ')}
                </span>
              </span>
            </button>
          ))}
        </Shelf>
      )}
      {spArtists.length > 0 && (
        <Shelf title="Artists you follow" source="Spotify" kind="circle">
          {spArtists.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => nav.go({ name: 'spotifyArtist', id: a.id })}
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
      {google && google.playlists.length > 0 && (
        <Shelf title="Your playlists" source="YouTube" kind="square">
          {google.playlists.map((item) => (
            <YtCard key={item.browseId} item={item} shape="square" />
          ))}
        </Shelf>
      )}
      {google && google.liked.length > 0 && (
        <YtShelfView
          shelf={{
            title: 'Liked videos',
            strapline: null,
            layout: 'video',
            items: google.liked,
          }}
        />
      )}
      {google && google.subscriptions.length > 0 && (
        <Shelf title="Subscriptions" source="YouTube" kind="circle">
          {google.subscriptions.map((item) => (
            <YtCard key={item.browseId} item={item} shape="circle" />
          ))}
        </Shelf>
      )}
      {yt && yt.playlists.length > 0 && (
        <Shelf title="Playlists" source="YouTube Music" kind="square">
          {yt.playlists.map((item) => (
            <YtCard key={item.browseId} item={item} shape="square" />
          ))}
        </Shelf>
      )}
      {yt && yt.albums.length > 0 && (
        <Shelf title="Albums" source="YouTube Music" kind="square">
          {yt.albums.map((item) => (
            <YtCard key={item.browseId} item={item} shape="square" />
          ))}
        </Shelf>
      )}
      {yt && yt.artists.length > 0 && (
        <Shelf title="Artists" source="YouTube Music" kind="circle">
          {yt.artists.map((item) => (
            <YtCard key={item.browseId} item={item} shape="circle" />
          ))}
        </Shelf>
      )}
      {recent.length > 0 && (
        <Shelf
          title="Recently Added"
          source="On this computer"
          kind="square"
          action={<ShowAll onPress={() => go('albums')} />}
        >
          {recent.map((a) => (
            <AlbumTile key={a.key} album={a} />
          ))}
        </Shelf>
      )}
      {artists.length > 0 && (
        <Shelf
          title="Artists"
          source="On this computer"
          kind="circle"
          action={<ShowAll onPress={() => go('artists')} />}
        >
          {artists.slice(0, 16).map((a) => (
            <ArtistTile key={a.name} artist={a} />
          ))}
        </Shelf>
      )}
      {albums.length > 0 && (
        <Shelf
          title="Albums"
          source="On this computer"
          kind="square"
          action={<ShowAll onPress={() => go('albums')} />}
        >
          {albums.slice(0, 16).map((a) => (
            <AlbumTile key={a.key} album={a} />
          ))}
        </Shelf>
      )}
    </>
  );
}

/** Every Spotify playlist, Liked Songs first (what used to be the Spotify page). */
function Playlists({ query }: { query: string }) {
  const signedIn = useSignedIn();
  const playlists = usePlaylists(signedIn);
  if (!signedIn)
    return (
      <div className="flex justify-center py-10">
        <SignedOut />
      </div>
    );
  if (playlists.isError)
    return (
      <SpotifyError
        error={playlists.error}
        retry={() => void playlists.refetch()}
      />
    );
  const lower = query.toLowerCase();
  const shown = (playlists.data ?? []).filter(
    (p) => !lower || p.name.toLowerCase().includes(lower),
  );
  if (playlists.data && shown.length === 0)
    return (
      <Empty art="search" title={`No playlists match “${query}”`} size={72}>
        Check the spelling.
      </Empty>
    );
  return (
    <div className={GRID}>
      {playlists.isPending
        ? Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="aspect-square w-full rounded-md" />
          ))
        : shown.map((p) => <PlaylistTile key={p.id} playlist={p} />)}
    </div>
  );
}

/** DESIGN.md › Library: the overview, or one whole collection. */
export function LibraryPage({ tab }: { tab: LibraryTab }) {
  const state = useLibraryState().data;
  const compact = useSizeClass() === 'compact';

  if (tab === 'downloads')
    return (
      <div
        style={{ '--page-x': compact ? '1.25rem' : '2.5rem' } as CSSProperties}
        className={compact ? 'px-5 pt-5 pb-10' : 'px-10 pt-8 pb-12'}
      >
        <DownloadsPage compact={compact} />
      </div>
    );

  if (
    state &&
    state.folders.length === 0 &&
    (tab === 'songs' || tab === 'albums' || tab === 'artists')
  )
    return (
      <div
        className={`flex min-h-full flex-col ${compact ? 'p-5' : 'px-10 py-8'}`}
      >
        <PageHeader title="Library" />
        <div className="flex flex-1 items-center justify-center">
          <Empty
            art="folder"
            title="Add your music"
            action={<AddFolderButton />}
          >
            Choose the folders that hold your music files. wavebit reads them
            where they are.
          </Empty>
        </div>
      </div>
    );

  return (
    <div
      style={{ '--page-x': compact ? '1.25rem' : '2.5rem' } as CSSProperties}
      className={compact ? 'px-5 pt-5 pb-10' : 'px-10 pt-8 pb-12'}
    >
      <PageHeader
        title="Library"
        meta={
          state
            ? `${count(state.trackCount, 'song')} · ${length(state.durationMs, true)}`
            : ' '
        }
      >
        {tab === 'overview' && <AddFolderButton variant="secondary" />}
      </PageHeader>
      {compact && (
        <div className="mt-4">
          <SearchBox size="lg" />
        </div>
      )}
      {tab === 'overview' ? (
        <>
          <ScanProgress />
          <Overview />
        </>
      ) : (
        <Collection tab={tab} compact={compact} />
      )}
    </div>
  );
}

/** One whole collection, with its toolbar: Songs, Albums, Artists or Playlists. */
function Collection({
  tab,
  compact,
}: {
  tab: Exclude<LibraryTab, 'overview' | 'downloads'>;
  compact: boolean;
}) {
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<SongSort>('title');
  const [view, setView] = useState<'list' | 'grid'>('list');
  const query = useDeferredValue(filter.trim());
  const albums = useAlbums(tab === 'albums' ? query : '');
  const artists = useArtists(tab === 'artists' ? query : '');
  const showSongsAsGrid = tab === 'songs' && view === 'grid';
  return (
    <>
      <div className="mt-5 flex flex-wrap items-center gap-2.5">
        <Segmented
          label="Show"
          value={tab}
          onChange={(next) => nav.go({ name: 'library', tab: next })}
          fullWidth={compact}
          options={[
            { value: 'songs', label: 'Songs' },
            { value: 'albums', label: 'Albums' },
            { value: 'artists', label: 'Artists' },
            { value: 'playlists', label: 'Playlists' },
          ]}
        />
        {!compact && (
          <Filter value={filter} onChange={setFilter} label={`Filter ${tab}`} />
        )}
        <span className="flex-1" />
        {tab === 'songs' && !compact && (
          <>
            <Dropdown>
              <Button variant="ghost" className="h-9">
                <ArrowDownUp size={16} aria-hidden />
                {SORTS.find((s) => s.value === sort)?.label}
                <ChevronDown size={14} aria-hidden />
              </Button>
              <Dropdown.Popover placement="bottom end">
                <Dropdown.Menu
                  aria-label="Sort songs by"
                  selectionMode="single"
                  selectedKeys={new Set([sort])}
                  onAction={(key) => setSort(key as SongSort)}
                >
                  {SORTS.map((s) => (
                    <Dropdown.Item
                      key={s.value}
                      id={s.value}
                      textValue={s.label}
                    >
                      <Label>{s.label}</Label>
                      <Dropdown.ItemIndicator />
                    </Dropdown.Item>
                  ))}
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>
            <Segmented
              label="View"
              value={view}
              onChange={setView}
              options={[
                { value: 'list', label: <List size={16} />, ariaLabel: 'List' },
                {
                  value: 'grid',
                  label: <LayoutGrid size={16} />,
                  ariaLabel: 'Albums grid',
                },
              ]}
            />
          </>
        )}
        {tab === 'songs' && view === 'list' && <ViewMenu size={36} />}
        {tab === 'playlists' && <ImportPlaylist />}
        {!compact && tab !== 'playlists' && (
          <AddFolderButton variant="secondary" />
        )}
      </div>

      <ScanProgress />

      <div className="mt-5">
        {tab === 'playlists' && <Playlists query={query} />}
        {tab === 'songs' && !showSongsAsGrid && (
          <SongList query={query} sort={sort} />
        )}
        {(tab === 'albums' || showSongsAsGrid) &&
          (albums.data?.length === 0 && query ? (
            <Empty art="search" title={`No albums match “${query}”`} size={72}>
              Check the spelling, or try the artist’s name.
            </Empty>
          ) : (
            <div className={GRID}>
              {albums.data?.map((a) => (
                <AlbumTile key={a.key} album={a} />
              ))}
            </div>
          ))}
        {tab === 'artists' &&
          (artists.data?.length === 0 && query ? (
            <Empty art="search" title={`No artists match “${query}”`} size={72}>
              Check the spelling.
            </Empty>
          ) : (
            <div className={GRID}>
              {artists.data?.map((a) => (
                <ArtistTile key={a.name} artist={a} />
              ))}
            </div>
          ))}
      </div>
    </>
  );
}
