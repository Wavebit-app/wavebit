import { BrowserWindow } from 'electron';
import { z } from 'zod';
import { Channels } from '../../shared/ipc/channels';
import {
  AlbumQuerySchema,
  ArtistQuerySchema,
  ImportQuerySchema,
  PlaylistQuerySchema,
  RecentMoreSchema,
  SavedQuerySchema,
  SaveSchema,
  SearchQuerySchema,
  SongQuerySchema,
  TrackUriSchema,
} from '../../shared/schemas/spotify';
import {
  albumPage,
  artistPage,
  albums,
  artists,
  canvas,
  save,
  saved,
  search,
  cancelSignIn,
  home,
  recentMore,
  importPlaylist,
  removeImport,
  song,
  playlistPage,
  playlists,
  refresh,
  signIn,
  signOut,
  status,
} from '../spotify/service';
import { handle } from './handle';

const NoInput = z.undefined();

export function registerSpotifyIpc(): void {
  handle(Channels.spotifyStatus, NoInput, () => status());
  handle(Channels.spotifySignIn, NoInput, (_input, event) =>
    signIn(BrowserWindow.fromWebContents(event.sender)),
  );
  handle(Channels.spotifyCancelSignIn, NoInput, () => cancelSignIn());
  handle(Channels.spotifySignOut, NoInput, () => signOut());
  handle(Channels.spotifyPlaylists, NoInput, () => playlists());
  handle(Channels.spotifyPlaylist, PlaylistQuerySchema, ({ id, offset }) =>
    playlistPage(id, offset),
  );
  handle(Channels.spotifyCanvas, TrackUriSchema, ({ uri }) => canvas(uri));
  handle(Channels.spotifyRefresh, NoInput, () => refresh());
  handle(Channels.spotifyAlbums, NoInput, () => albums());
  handle(Channels.spotifySearch, SearchQuerySchema, ({ query, offset }) =>
    search(query, offset),
  );
  handle(Channels.spotifyArtist, ArtistQuerySchema, ({ id }) => artistPage(id));
  handle(Channels.spotifyArtists, NoInput, () => artists());
  handle(Channels.spotifyHome, NoInput, () => home());
  handle(Channels.spotifyRecentMore, RecentMoreSchema, ({ before }) =>
    recentMore(before),
  );
  handle(Channels.spotifySong, SongQuerySchema, ({ id }) => song(id));
  handle(Channels.spotifyImport, ImportQuerySchema, ({ id }) =>
    importPlaylist(id),
  );
  handle(Channels.spotifyRemoveImport, ImportQuerySchema, ({ id }) =>
    removeImport(id),
  );
  handle(Channels.spotifyAlbum, AlbumQuerySchema, ({ id, offset }) =>
    albumPage(id, offset),
  );
  handle(Channels.spotifySaved, SavedQuerySchema, ({ uris }) => saved(uris));
  handle(Channels.spotifySave, SaveSchema, ({ uris, saved: value }) =>
    save(uris, value),
  );
}
