import { toast } from '@heroui/react';
import {
  Copy,
  Disc3,
  Download,
  ExternalLink,
  FolderOpen,
  Heart,
  HeartOff,
  Info,
  Link2,
  ListEnd,
  ListMusic,
  ListStart,
  MicVocal,
  Play,
  Radio,
  RefreshCw,
  Shuffle,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import type {
  AlbumSummary,
  ArtistSummary,
} from '../../../shared/schemas/library';
import {
  LIKED_ID,
  type SpotifyPlaylist,
  type SpotifyRecent,
  type SpotifyTrackPage,
} from '../../../shared/schemas/spotify';
import type { DownloadList } from '../../../shared/schemas/downloads';
import type { YtItem } from '../../../shared/schemas/youtube';
import { nav } from '../../app/router';
import type { MenuAction, MenuSpec } from '../../design/ContextMenu';
import { showDetails, type Details } from '../../design/DetailsSheet';
import { openInBrowser } from '../../design/IconAction';
import { artUrl, clock, date } from '../../lib/format';
import { canDownload, downloadSongs } from '../downloads/downloads';
import { loadList } from '../downloads/lists';
import { fromLocal, isFile, player, type Playable } from '../player/player';
import { playable as spotifyPlayable } from '../spotify/PlaylistPage';
import { open as openYt, streamOf } from '../youtube/YouTube';
import { playable as ytPlayable } from '../youtube/YtPage';

/** Far past any album; a card's Play shouldn't read a 10,000-song playlist. */
const MAX_SONGS = 500;
const SPOTIFY_TRACK = /^spotify:track:([A-Za-z0-9]{22})$/;

const api = () => window.wavebit;

type Maybe = MenuAction | false | null | undefined | '';

const action = (
  id: string,
  label: string,
  icon: LucideIcon,
  run: () => void,
  danger = false,
): MenuAction => ({ id, label, icon, run, danger });

const sections = (...groups: Maybe[][]) =>
  groups
    .map((g) => g.filter((a): a is MenuAction => !!a))
    .filter((g) => g.length > 0);

function copy(text: string, done: string) {
  void api()
    .app.copy(text)
    .then(() => toast(done));
}

function playNext(tracks: Playable[], title: string) {
  // Each goes to the head of the list, so the last song goes first.
  [...tracks].reverse().forEach(player.playNext);
  toast(`“${title}” plays next`);
}

function addToQueue(tracks: Playable[], title: string) {
  tracks.forEach(player.addToQueue);
  toast(`“${title}” added to the queue`);
}

async function startRadio(track: Playable, videoId: string) {
  try {
    const songs = await api().youtube.radio(videoId);
    player.playList(
      [
        track,
        ...songs
          .filter((s) => s.videoId !== videoId)
          .map((s) => ({
            id: `youtube:${s.videoId}`,
            title: s.title,
            artist: s.artists,
            album: '',
            albumKey: null,
            artwork: s.imageUrl,
            durationMs: s.durationMs,
            stream: { videoId: s.videoId, isVideo: s.isVideo },
          })),
      ],
      0,
      `${track.title} radio`,
    );
  } catch {
    toast('YouTube Music didn’t send a radio for this song');
  }
}

function songDetails(track: Playable): Details {
  const file = isFile(track.id);
  return {
    heading: 'Song details',
    title: track.title,
    subtitle: track.artist,
    art: track.artwork,
    fileId: file ? track.id : undefined,
    rows: [
      ['Artist', track.artist],
      ['Album', track.album],
      ['Length', track.durationMs ? clock(track.durationMs) : null],
      ['Track', track.local?.trackNo],
      ['Disc', track.local?.discNo],
      ['Added', track.local ? date(track.local.addedAt) : null],
      ['Plays', track.local?.plays],
      [
        'Source',
        file
          ? 'Your files'
          : track.stream?.videoId
            ? 'YouTube Music'
            : 'Spotify, played from YouTube Music',
      ],
    ],
  };
}

export interface SongMenuOptions {
  onPlay?: () => void;
  onAlbum?: () => void;
  onArtist?: () => void;
  /** Replaces the details sheet: Spotify's songs have a page of their own. */
  onDetails?: () => void;
  saved?: { value: boolean; toggle: () => void };
  /** Library › Downloads: sends the file to the Trash, after asking. */
  onDelete?: () => void;
  /** Replaces the playing actions: the queue's own rows. */
  queue?: MenuAction[];
}

export function songMenu(track: Playable, o: SongMenuOptions = {}): MenuSpec {
  const file = isFile(track.id);
  const videoId = track.stream?.videoId ?? null;
  const spotifyId = SPOTIFY_TRACK.exec(track.spotifyUri ?? '')?.[1];
  const album =
    o.onAlbum ??
    (track.albumKey
      ? () => nav.go({ name: 'album', key: track.albumKey! })
      : undefined);
  const artist =
    o.onArtist ??
    (file ? () => nav.go({ name: 'artist', artist: track.artist }) : undefined);
  const spotifyUrl = spotifyId && `https://open.spotify.com/track/${spotifyId}`;
  const link = videoId
    ? `https://music.youtube.com/watch?v=${videoId}`
    : spotifyUrl;
  return {
    label: `Actions for ${track.title}`,
    sections: sections(
      o.queue ?? [
        action(
          'play',
          'Play',
          Play,
          o.onPlay ?? (() => player.playList([track], 0, track.title)),
        ),
        action('next', 'Play next', ListStart, () =>
          playNext([track], track.title),
        ),
        action('queue', 'Add to queue', ListEnd, () =>
          addToQueue([track], track.title),
        ),
        videoId &&
          action('radio', 'Start radio', Radio, () => {
            void startRadio(track, videoId);
          }),
      ],
      [
        album && action('album', 'Go to album', Disc3, album),
        artist && action('artist', 'Go to artist', MicVocal, artist),
      ],
      [
        o.saved &&
          action(
            'save',
            o.saved.value ? 'Remove from Liked Songs' : 'Save to Liked Songs',
            o.saved.value ? HeartOff : Heart,
            o.saved.toggle,
          ),
        canDownload(track) &&
          action('download', 'Download', Download, () => {
            void downloadSongs([track], track.title);
          }),
      ],
      [
        action(
          'details',
          'Show details',
          Info,
          o.onDetails ?? (() => showDetails(songDetails(track))),
        ),
        file &&
          action('folder', 'Show in folder', FolderOpen, () => {
            void api().library.showInFolder(track.id);
          }),
        o.onDelete && action('delete', 'Delete file', Trash2, o.onDelete),
        videoId
          ? action('open', 'Open in YouTube Music', ExternalLink, () => {
              void api().youtube.open(videoId, null);
            })
          : spotifyUrl &&
            action('open', 'Open in Spotify', ExternalLink, () =>
              openInBrowser(spotifyUrl),
            ),
        link &&
          action('copy', 'Copy link', Link2, () => copy(link, 'Link copied')),
      ],
    ),
  };
}

interface Collection {
  noun: 'album' | 'playlist' | 'artist';
  title: string;
  /** A streamed album or playlist, which can be downloaded whole. */
  list?: DownloadList;
  /** Its songs, read when an action needs them; artists on YouTube have none. */
  load?: () => Promise<Playable[]>;
  open: () => void;
  onArtist?: () => void;
  external?: { label: string; run: () => void };
  link?: string;
  details: Omit<Details, 'heading' | 'title'>;
  remove?: { label: string; run: () => void };
}

function collectionMenu(c: Collection): MenuSpec {
  const withSongs = (use: (tracks: Playable[]) => void) => () => {
    void (async () => {
      try {
        const tracks = (await c.load?.()) ?? [];
        if (tracks.length) use(tracks);
        else toast(`“${c.title}” has no songs to play`);
      } catch {
        toast(`Couldn’t load “${c.title}”`);
      }
    })();
  };
  const name = c.noun.charAt(0).toUpperCase() + c.noun.slice(1);
  return {
    label: `Actions for ${c.title}`,
    sections: sections(
      c.load
        ? [
            action(
              'play',
              'Play',
              Play,
              withSongs((t) => player.playList(t, 0, c.title)),
            ),
            action(
              'shuffle',
              'Shuffle',
              Shuffle,
              withSongs((t) => player.shuffleList(t, c.title)),
            ),
            action(
              'next',
              'Play next',
              ListStart,
              withSongs((t) => playNext(t, c.title)),
            ),
            action(
              'queue',
              'Add to queue',
              ListEnd,
              withSongs((t) => addToQueue(t, c.title)),
            ),
          ]
        : [],
      [
        // Only a streamed list: a library album is already files.
        c.list &&
          action('download', 'Download all', Download, () => {
            const list = c.list!;
            void loadList(list)
              .then((t) => downloadSongs(t, c.title, list))
              .catch(() => toast(`Couldn’t load “${c.title}”`));
          }),
      ],
      [
        action(
          'open',
          `Open ${c.noun}`,
          c.noun === 'artist'
            ? MicVocal
            : c.noun === 'album'
              ? Disc3
              : ListMusic,
          c.open,
        ),
        c.onArtist && action('artist', 'Go to artist', MicVocal, c.onArtist),
      ],
      [
        action('details', 'Show details', Info, () =>
          showDetails({
            ...c.details,
            heading: `${name} details`,
            title: c.title,
          }),
        ),
        c.external &&
          action('external', c.external.label, ExternalLink, c.external.run),
        c.link &&
          action('copy', 'Copy link', Link2, () =>
            copy(c.link!, 'Link copied'),
          ),
      ],
      [
        c.remove &&
          action('remove', c.remove.label, Trash2, c.remove.run, true),
      ],
    ),
  };
}

export async function spotifyPages(
  read: (offset: number) => Promise<SpotifyTrackPage>,
  limit = MAX_SONGS,
): Promise<Playable[]> {
  const items: SpotifyTrackPage['items'] = [];
  for (;;) {
    const page = await read(items.length);
    items.push(...page.items);
    if (
      page.items.length === 0 ||
      items.length >= page.total ||
      items.length >= limit
    )
      return items.map(spotifyPlayable);
  }
}

export async function ytPages(
  browseId: string,
  limit = MAX_SONGS,
): Promise<Playable[]> {
  const tracks: Playable[] = [];
  let next: string | null = null;
  do {
    const page = await api().youtube.page(browseId, next);
    tracks.push(...page.items.map(ytPlayable));
    next = page.next;
  } while (next && tracks.length < limit);
  return tracks;
}

export function localAlbumMenu(a: AlbumSummary): MenuSpec {
  return collectionMenu({
    noun: 'album',
    title: a.title,
    load: async () =>
      (await api().library.album(a.key))?.tracks.map(fromLocal) ?? [],
    open: () => nav.go({ name: 'album', key: a.key }),
    onArtist: () => nav.go({ name: 'artist', artist: a.artist }),
    details: {
      subtitle: a.artist,
      art: a.hasArt ? artUrl(a.key) : null,
      rows: [
        ['Artist', a.artist],
        ['Year', a.year],
        ['Songs', a.trackCount],
        ['Length', clock(a.durationMs)],
        ['Source', 'Your files'],
      ],
    },
  });
}

export function localArtistMenu(a: ArtistSummary): MenuSpec {
  return collectionMenu({
    noun: 'artist',
    title: a.name,
    // Every song on the artist's albums, as the artist page's Play takes them.
    load: async () => {
      const artist = await api().library.artist(a.name);
      const albums = await Promise.all(
        artist?.albums.map((r) => api().library.album(r.key)) ?? [],
      );
      const all = albums.flatMap((r) => r?.tracks ?? []);
      return (all.length ? all : (artist?.topTracks ?? [])).map(fromLocal);
    },
    open: () => nav.go({ name: 'artist', artist: a.name }),
    details: {
      art: a.artKey ? artUrl(a.artKey) : null,
      round: true,
      rows: [
        ['Albums', a.albumCount],
        ['Songs', a.trackCount],
        ['Source', 'Your files'],
      ],
    },
  });
}

export function spotifyPlaylistMenu(
  p: SpotifyPlaylist,
  remove?: () => void,
): MenuSpec {
  const url =
    p.id === LIKED_ID
      ? 'https://open.spotify.com/collection/tracks'
      : `https://open.spotify.com/playlist/${p.id}`;
  return collectionMenu({
    noun: 'playlist',
    title: p.name,
    list: { kind: 'spotifyPlaylist', id: p.id, title: p.name },
    load: () => spotifyPages((offset) => api().spotify.playlist(p.id, offset)),
    open: () => nav.go({ name: 'playlist', id: p.id }),
    external: { label: 'Open in Spotify', run: () => openInBrowser(url) },
    link: url,
    details: {
      subtitle: p.owner,
      art: p.imageUrl,
      rows: [
        ['Owner', p.owner],
        ['Songs', p.trackCount],
        ['Source', p.imported ? 'Added from a Spotify link' : 'Spotify'],
      ],
    },
    remove:
      p.imported && remove
        ? { label: 'Remove from wavebit', run: remove }
        : undefined,
  });
}

export function spotifyAlbumMenu(r: {
  id: string;
  name: string;
  imageUrl: string | null;
  year?: number | null;
  subtitle?: string | null;
}): MenuSpec {
  const url = `https://open.spotify.com/album/${r.id}`;
  return collectionMenu({
    noun: 'album',
    title: r.name,
    list: { kind: 'spotifyAlbum', id: r.id, title: r.name },
    load: () => spotifyPages((offset) => api().spotify.album(r.id, offset)),
    open: () => nav.go({ name: 'spotifyAlbum', id: r.id }),
    external: { label: 'Open in Spotify', run: () => openInBrowser(url) },
    link: url,
    details: {
      subtitle: r.subtitle,
      art: r.imageUrl,
      rows: [
        ['Year', r.year],
        ['Source', 'Spotify'],
      ],
    },
  });
}

export function spotifyArtistMenu(a: {
  id: string;
  name: string;
  imageUrl: string | null;
}): MenuSpec {
  const url = `https://open.spotify.com/artist/${a.id}`;
  return collectionMenu({
    noun: 'artist',
    title: a.name,
    load: async () =>
      (await api().spotify.artist(a.id)).topTracks.map(spotifyPlayable),
    open: () => nav.go({ name: 'spotifyArtist', id: a.id }),
    external: { label: 'Open in Spotify', run: () => openInBrowser(url) },
    link: url,
    details: {
      art: a.imageUrl,
      round: true,
      rows: [['Source', 'Spotify']],
    },
  });
}

/** A card from Spotify's recently played; a song keeps the shelf's own Play. */
export function recentMenu(
  item: SpotifyRecent,
  onPlay?: () => void,
): MenuSpec | null {
  if (item.kind === 'track')
    return item.track
      ? songMenu(spotifyPlayable(item.track), { onPlay })
      : null;
  if (item.kind === 'album')
    return spotifyAlbumMenu({ ...item, subtitle: item.subtitle });
  if (item.kind === 'artist') return spotifyArtistMenu(item);
  return collectionMenu({
    noun: 'playlist',
    title: item.name,
    list: { kind: 'spotifyPlaylist', id: item.id, title: item.name },
    load: () =>
      spotifyPages((offset) => api().spotify.playlist(item.id, offset)),
    open: () => nav.go({ name: 'playlist', id: item.id }),
    external: {
      label: 'Open in Spotify',
      run: () => openInBrowser(`https://open.spotify.com/playlist/${item.id}`),
    },
    link: `https://open.spotify.com/playlist/${item.id}`,
    details: {
      subtitle: item.subtitle,
      art: item.imageUrl,
      rows: [['Source', 'Spotify']],
    },
  });
}

/** A YouTube Music card or row; null for something wavebit can't act on. */
export function ytItemMenu(item: YtItem, onPlay?: () => void): MenuSpec | null {
  if (item.videoId) return songMenu(streamOf(item), { onPlay });
  const id = item.browseId;
  if (!id) return null;
  const details = {
    subtitle: item.subtitle,
    art: item.imageUrl,
    round: id.startsWith('UC'),
    rows: [['Source', 'YouTube Music']] as Details['rows'],
  };
  const external = {
    label: 'Open in YouTube Music',
    run: () => void api().youtube.open(null, id),
  };
  if (id.startsWith('UC'))
    return collectionMenu({
      noun: 'artist',
      title: item.title,
      open: () => openYt(item),
      external,
      link: `https://music.youtube.com/channel/${id}`,
      details,
    });
  if (!/^(MPRE|VL)/.test(id)) return null;
  return collectionMenu({
    noun: id.startsWith('VL') ? 'playlist' : 'album',
    title: item.title,
    list: { kind: 'ytPage', id, title: item.title },
    load: () => ytPages(id),
    open: () => openYt(item),
    external,
    link: id.startsWith('VL')
      ? `https://music.youtube.com/playlist?list=${id.slice(2)}`
      : `https://music.youtube.com/browse/${id}`,
    details,
  });
}

/** A station on Home: nothing to open, only a queue to start. */
export function stationMenu(title: string, play: () => void): MenuSpec {
  return {
    label: `Actions for ${title}`,
    sections: [[action('play', 'Play', Play, play)]],
  };
}

export function folderMenu(path: string, onRemove: () => void): MenuSpec {
  return {
    label: `Actions for ${path}`,
    sections: sections(
      [
        action('open', 'Open folder', FolderOpen, () => {
          void api().library.openFolder(path);
        }),
        action('rescan', 'Rescan library', RefreshCw, () => {
          void api().library.scan();
        }),
        action('copy', 'Copy path', Copy, () => copy(path, 'Path copied')),
      ],
      [action('remove', 'Remove from library', Trash2, onRemove, true)],
    ),
  };
}
