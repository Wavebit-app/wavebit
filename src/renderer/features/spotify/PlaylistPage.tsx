import { Heart, ListPlus, Search, Shuffle, X } from 'lucide-react';
import { SpotifyMark } from '../../design/BrandMarks';
import {
  IconAction,
  openInBrowser,
  PlayAction,
  ViewMenu,
} from '../../design/IconAction';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  LIKED_ID,
  type SpotifyAlbumDetails,
  type SpotifyTrack,
} from '../../../shared/schemas/spotify';
import { nav } from '../../app/router';
import { filterInputId } from '../../app/ui';
import { PlaylistCover } from '../../design/PlaylistCover';
import { Backdrop } from '../../design/Backdrop';
import { Shelf } from '../../design/Shelf';
import { added, count, length } from '../../lib/format';
import {
  useImportPlaylist,
  usePlaylist,
  usePlaylists,
  useRemoveImport,
  useSaved,
  useSaveTrack,
  useSignedIn,
  useSpotifyAlbum,
} from '../../lib/queries';
import { useSizeClass } from '../../lib/useBreakpoint';
import type { DownloadList } from '../../../shared/schemas/downloads';
import { ListDownloadAction } from '../downloads/DownloadActions';
import { loadList } from '../downloads/lists';
import { SongRow, SongRowSkeleton } from '../library/SongRow';
import { player, type Playable } from '../player/player';
import { Release } from './Release';
import { rowLinks } from './rowLinks';
import { SignedOut, SpotifyError } from './SpotifyStates';

const WIDE = '32px minmax(0,2fr) minmax(0,1.2fr) 36px 56px';
/** With the Added column: Spotify's own playlists have no dates, so it shows only when some row does. */
const DATED = '32px minmax(0,2fr) minmax(0,1.2fr) 104px 36px 56px';
const NARROW = '24px minmax(0,1fr) 36px 56px';

/**
 * The heart: filled `accent` when the song is in Liked Songs. A press saves
 * or removes it at once (PUT or DELETE /me/library) and goes back if
 * Spotify refuses.
 */
export function SaveHeart({
  uri,
  saved,
}: {
  uri: string;
  saved: boolean | undefined;
}) {
  const save = useSaveTrack();
  if (saved === undefined) return <span role="cell" />;
  return (
    <span role="cell" className="flex justify-center">
      <button
        type="button"
        aria-label={saved ? 'Remove from Liked Songs' : 'Save to Liked Songs'}
        aria-pressed={saved}
        onClick={(e) => {
          e.stopPropagation();
          save.mutate({ uri, saved: !saved });
        }}
        onDoubleClick={(e) => e.stopPropagation()}
        className="flex size-8 items-center justify-center rounded-md hover:bg-sunken"
      >
        <Heart
          size={17}
          fill={saved ? 'currentColor' : 'none'}
          className={saved ? 'text-accent' : 'text-muted'}
          aria-hidden
        />
      </button>
    </span>
  );
}

/**
 * Every Spotify row plays: from the matching file when there is one, else
 * from YouTube Music, found by title, artists and length (BitChord's
 * SpotifyImporter.matchTrack) when the row comes up.
 */
export function playable(t: SpotifyTrack): Playable {
  const base = {
    title: t.title,
    artist: t.artists.join(', '),
    album: t.album ?? '',
    artwork: t.imageUrl,
    durationMs: t.durationMs,
    spotifyUri: t.uri,
  };
  if (t.localId) return { ...base, id: t.localId, albumKey: t.localAlbumKey };
  return {
    ...base,
    id: t.uri,
    albumKey: null,
    stream: {
      videoId: null,
      match: {
        title: t.title,
        artists: t.artists.slice(0, 20),
        durationMs: Math.round(t.durationMs),
      },
    },
  };
}

/**
 * DESIGN.md › Spotify › A playlist: Spotify's rows, played from matching
 * local files. A saved album opens here too (`album`), its rows from
 * GET /albums/{id}/tracks or the web player's getAlbum.
 */
export function PlaylistPage({
  id,
  album = false,
}: {
  id: string;
  album?: boolean;
}) {
  const signedIn = useSignedIn();
  const asPlaylist = usePlaylist(id, !album);
  const asAlbum = useSpotifyAlbum(id, album && signedIn);
  const playlist = album ? asAlbum : asPlaylist;
  const compact = useSizeClass() === 'compact';
  const [filter, setFilter] = useState('');
  const pad = compact ? 'px-5' : 'px-10';
  const listed = usePlaylists(signedIn && !album);
  const entry = listed.data?.find((p) => p.id === id);
  const importing = useImportPlaylist();
  const removing = useRemoveImport();
  const saveTrack = useSaveTrack();

  // Long playlists load 100 at a time until the whole list is in.
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = playlist;
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const first = playlist.data?.pages[0];
  const tracks = useMemo(
    () => playlist.data?.pages.flatMap((p) => p.items) ?? [],
    [playlist.data],
  );
  const matched = tracks.filter((t) => t.localId).length;
  const dated = tracks.some((t) => t.addedAt);
  // An album's rows are all the album's: no Album column, no artwork on each.
  const columns = compact || album ? NARROW : dated ? DATED : WIDE;
  const showAlbum = !compact && !album;
  const details = first?.album;
  const lower = filter.trim().toLowerCase();
  const visible = tracks.filter(
    (t) =>
      !lower ||
      t.title.toLowerCase().includes(lower) ||
      t.artists.join(' ').toLowerCase().includes(lower),
  );
  const queue = useMemo(() => tracks.map(playable), [tracks]);
  const list: DownloadList = {
    kind: album ? 'spotifyAlbum' : 'spotifyPlaylist',
    id,
    title: first?.name || 'This list',
  };
  const saved = useSaved(
    tracks.map((t) => t.uri),
    signedIn,
  ).data;
  const name = first?.name ?? (album ? 'Album' : 'Playlist');
  const noun = album ? 'album' : 'playlist';

  if (!signedIn)
    return (
      <div className="flex min-h-full items-center justify-center">
        <SignedOut />
      </div>
    );
  if (playlist.isError)
    return (
      <div className={`${pad} py-8`}>
        <SpotifyError
          error={playlist.error}
          retry={() => void playlist.refetch()}
        />
      </div>
    );

  return (
    <div>
      <section
        className={`relative flex min-h-[280px] items-end ${pad} pt-10 pb-7`}
      >
        <Backdrop src={first?.imageUrl} />
        <div
          className={`relative flex gap-7 ${compact ? 'flex-col items-start' : 'items-end'}`}
        >
          <PlaylistCover
            id={id}
            src={first?.imageUrl}
            size={compact ? 160 : 200}
            rounded="rounded-md"
          />
          <div className="flex min-w-0 flex-col gap-2">
            <span className="text-[0.8667rem] font-medium text-muted">
              Spotify {details ? ALBUM_KINDS[details.kind] : noun}
            </span>
            <h1 className="text-headline font-semibold tracking-[-0.02em]">
              {name}
            </h1>
            {first?.description && (
              <p className="line-clamp-2 max-w-[640px] text-muted">
                {first.description}
              </p>
            )}
            {first && (
              <span className="text-sm text-muted tabular-nums">
                {details?.artists.map((a, i) => (
                  <span key={`${a.name}-${i}`}>
                    {i > 0 && ', '}
                    {a.id ? (
                      <button
                        type="button"
                        onClick={() =>
                          nav.go({ name: 'spotifyArtist', id: a.id! })
                        }
                        className="font-medium text-foreground hover:underline"
                      >
                        {a.name}
                      </button>
                    ) : (
                      <span className="font-medium text-foreground">
                        {a.name}
                      </span>
                    )}
                  </span>
                ))}
                {details && details.artists.length > 0 && ' · '}
                {[
                  details ? details.year : first.owner,
                  first.followers ? count(first.followers, 'follower') : null,
                  count(first.total, 'song'),
                  length(tracks.reduce((s, t) => s + t.durationMs, 0)),
                  `${matched} play from your files`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-1">
              <PlayAction
                isDisabled={queue.length === 0}
                onPress={() => player.playList(queue, 0, name)}
              />
              <IconAction
                label="Shuffle"
                isDisabled={queue.length === 0}
                onPress={() => player.shuffleList(queue, name)}
              >
                <Shuffle size={24} aria-hidden />
              </IconAction>
              {!album && id !== LIKED_ID && listed.data && !entry && (
                <IconAction
                  label="Add to your playlists"
                  isPending={importing.isPending}
                  onPress={() => importing.mutate(id)}
                >
                  <ListPlus size={24} aria-hidden />
                </IconAction>
              )}
              {entry?.imported && (
                <IconAction
                  label="Remove from wavebit"
                  isPending={removing.isPending}
                  onPress={() => removing.mutate(id)}
                >
                  <X size={24} aria-hidden />
                </IconAction>
              )}
              {first && (
                <ListDownloadAction
                  tracks={queue}
                  complete={!hasNextPage}
                  title={list.title}
                  list={list}
                  load={() => loadList(list)}
                />
              )}
              <IconAction
                label="Open in Spotify"
                onPress={() =>
                  openInBrowser(
                    id === LIKED_ID
                      ? 'https://open.spotify.com/collection/tracks'
                      : `https://open.spotify.com/${album ? 'album' : 'playlist'}/${id}`,
                  )
                }
              >
                <SpotifyMark size={24} />
              </IconAction>
              <ViewMenu />
            </div>
          </div>
        </div>
      </section>

      <div className={`${pad} pt-6 pb-10`}>
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="flex-1" />
          <label className="flex h-9 flex-[0_1_240px] items-center gap-2 rounded-full bg-sunken px-3.5 text-muted ring-1 ring-[var(--field-border)] focus-within:ring-2 focus-within:ring-accent">
            <Search size={15} aria-hidden />
            <input
              id={filterInputId}
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={`Filter this ${noun}`}
              aria-label={`Filter this ${noun}`}
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted"
            />
          </label>
        </div>
        <div
          role="table"
          aria-label="Songs"
          className="mt-4 flex flex-col gap-1"
        >
          <div
            role="row"
            style={{ gridTemplateColumns: columns }}
            className="grid h-7 items-center gap-4 px-3 text-[0.8667rem] font-medium text-muted"
          >
            <span role="columnheader" className="text-right">
              #
            </span>
            <span role="columnheader">Title</span>
            {showAlbum && (
              <>
                <span role="columnheader">Album</span>
                {dated && <span role="columnheader">Added</span>}
              </>
            )}
            <span role="columnheader">
              <span className="sr-only">Saved</span>
            </span>
            <span role="columnheader" className="text-right">
              Time
            </span>
          </div>
          {playlist.isPending
            ? Array.from({ length: 8 }, (_, i) => (
                <SongRowSkeleton key={i} columns={columns} />
              ))
            : visible.map((t) => {
                const track = playable(t);
                const index = tracks.indexOf(t);
                return (
                  <SongRow
                    key={`${t.uri}-${index}`}
                    no={index + 1}
                    track={track}
                    title={t.title}
                    artist={t.artists.join(', ')}
                    album={showAlbum ? (t.album ?? '') : undefined}
                    {...rowLinks(t)}
                    onAlbum={album ? undefined : rowLinks(t).onAlbum}
                    showArt={!album}
                    status={track.stream ? 'stream' : 'matched'}
                    statusColumn={false}
                    extra={
                      <>
                        {showAlbum && dated && (
                          <span
                            role="cell"
                            className="truncate text-[0.8667rem] text-muted"
                          >
                            {t.addedAt ? added(t.addedAt) : ''}
                          </span>
                        )}
                        <SaveHeart uri={t.uri} saved={saved?.get(t.uri)} />
                      </>
                    }
                    saved={
                      saved?.has(t.uri)
                        ? {
                            value: !!saved.get(t.uri),
                            toggle: () =>
                              saveTrack.mutate({
                                uri: t.uri,
                                saved: !saved.get(t.uri),
                              }),
                          }
                        : undefined
                    }
                    durationMs={t.durationMs}
                    artwork={t.imageUrl}
                    onPlay={() => player.playList(queue, index, name)}
                    columns={columns}
                  />
                );
              })}
        </div>
        {details && <AlbumFooter details={details} compact={compact} />}
      </div>
    </div>
  );
}

const ALBUM_KINDS = {
  album: 'album',
  single: 'single',
  ep: 'EP',
  compilation: 'compilation',
};

const RELEASE_DATE = new Intl.DateTimeFormat(undefined, { dateStyle: 'long' });

/** BitChord's album footer (date, label, copyright), then More by. */
function AlbumFooter({
  details,
  compact,
}: {
  details: SpotifyAlbumDetails;
  compact: boolean;
}) {
  const lines = [
    details.released ? RELEASE_DATE.format(new Date(details.released)) : null,
    details.label,
    details.copyright,
  ].filter((l, i, all): l is string => !!l && all.indexOf(l) === i);
  return (
    <div
      style={{ '--page-x': compact ? '1.25rem' : '2.5rem' } as CSSProperties}
    >
      {lines.length > 0 && (
        <footer className="mt-5 flex flex-col gap-0.5 text-[0.8667rem] text-muted">
          {lines.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </footer>
      )}
      {details.more.length > 0 && (
        <Shelf
          title={`More by ${details.artists[0]?.name ?? 'this artist'}`}
          source="Spotify"
          kind="square"
        >
          {details.more.map((r) => (
            <Release key={r.id} {...r} />
          ))}
        </Shelf>
      )}
    </div>
  );
}
