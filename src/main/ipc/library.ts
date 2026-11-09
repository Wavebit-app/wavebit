import { stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { BrowserWindow, shell } from 'electron';
import { z } from 'zod';
import type { Loudness } from '../../../native/index';
import { Channels, Events } from '../../shared/ipc/channels';
import type { FileInfo } from '../../shared/schemas/library';
import { playHistory, recordPlayed } from '../services/history';
import { listeningSummary, recordListened } from '../services/listening';
import {
  AlbumKeySchema,
  ArtistNameSchema,
  ListenedSchema,
  ListQuerySchema,
  PlayedSongSchema,
  RemoveFolderSchema,
  SearchSchema,
  StationQuerySchema,
  TrackIdSchema,
  TracksQuerySchema,
} from '../../shared/schemas/library';
import {
  addFolder,
  lib,
  libraryState,
  removeFolder,
  scan,
} from '../library/library';
import { emit, handle } from './handle';

const NoInput = z.undefined();

export function registerLibraryIpc(): void {
  handle(Channels.libraryState, NoInput, () => libraryState());
  // Ids, not paths, cross IPC: the page can only name a song the library holds.
  handle(Channels.libraryShowInFolder, TrackIdSchema, ({ id }) => {
    const path = lib().trackPath(id);
    if (path) shell.showItemInFolder(path);
  });
  // Only a folder the library already reads: openPath opens whatever it is given.
  handle(Channels.libraryOpenFolder, RemoveFolderSchema, ({ path }) => {
    if (libraryState().folders.includes(path)) void shell.openPath(path);
  });
  handle(
    Channels.libraryFileInfo,
    TrackIdSchema,
    async ({ id }): Promise<FileInfo | null> => {
      const path = lib().trackPath(id);
      const file = path ? await stat(path).catch(() => null) : null;
      return path && file
        ? {
            format: extname(path).slice(1).toUpperCase(),
            sizeBytes: file.size,
            modifiedMs: file.mtimeMs,
          }
        : null;
    },
  );
  handle(Channels.libraryAddFolder, NoInput, (_input, event) =>
    addFolder(BrowserWindow.fromWebContents(event.sender)),
  );
  handle(Channels.libraryRemoveFolder, RemoveFolderSchema, ({ path }) =>
    removeFolder(path),
  );
  handle(Channels.libraryScan, NoInput, () => scan());
  handle(Channels.libraryTracks, TracksQuerySchema, (q) =>
    lib().tracks(q.query, q.sort, q.offset, q.limit),
  );
  handle(Channels.libraryAlbums, ListQuerySchema, (q) =>
    lib().albums(q.query, q.offset, q.limit),
  );
  handle(Channels.libraryHome, NoInput, () => lib().home());
  // A station is at most 100 songs: a queue, not the whole library.
  handle(Channels.libraryStation, StationQuerySchema, (q) =>
    lib().station(q.kind, q.kind === 'artist' ? q.artist : null, 100),
  );
  handle(Channels.libraryAlbum, AlbumKeySchema, ({ key }) => lib().album(key));
  handle(Channels.libraryArtists, ListQuerySchema, (q) =>
    lib().artists(q.query, q.offset, q.limit),
  );
  handle(Channels.libraryArtist, ArtistNameSchema, ({ name }) =>
    lib().artist(name),
  );
  handle(Channels.librarySearch, SearchSchema, ({ query }) =>
    lib().search(query),
  );
  // Home's Top Picks and shelves follow every play (DESIGN.md › Home).
  handle(Channels.libraryRecordPlay, TrackIdSchema, ({ id }) => {
    lib().recordPlay(id);
    emit(Events.playsChanged, null);
  });
  handle(Channels.libraryPlayed, PlayedSongSchema, (song) => {
    recordPlayed(song);
    emit(Events.playsChanged, null);
  });
  handle(Channels.libraryHistory, z.undefined(), () => playHistory());
  handle(Channels.libraryListened, ListenedSchema, (report) => {
    recordListened(report);
    emit(Events.listeningChanged, null);
  });
  handle(Channels.libraryListening, NoInput, () => listeningSummary());
  handle(
    Channels.libraryLoudness,
    TrackIdSchema,
    ({ id }) => lib().loudness(id) as Promise<Loudness>,
  );
}
