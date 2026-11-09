import { BrowserWindow } from 'electron';
import { z } from 'zod';
import { Channels } from '../../shared/ipc/channels';
import {
  DownloadAddSchema,
  DownloadIdSchema,
} from '../../shared/schemas/downloads';
import { TrackIdSchema } from '../../shared/schemas/library';
import {
  addDownloads,
  cancelAllDownloads,
  cancelDownload,
  chooseDownloadFolder,
  clearFinishedDownloads,
  deleteDownload,
  deleteDownloadedTrack,
  downloadedLibrary,
  downloadsState,
  locateDownload,
  moveDownloadToTop,
  openDownloadFolder,
  pauseDownloads,
  removeDownload,
  resumeDownloads,
  retryDownload,
  retryFailedDownloads,
  showDownloadInFolder,
} from '../downloads/downloads';
import { handle } from './handle';

const NoInput = z.undefined();

/** Every action names a job: the page never sends a path. */
export function registerDownloadsIpc(): void {
  handle(Channels.downloadsState, NoInput, () => downloadsState());
  handle(Channels.downloadsAdd, DownloadAddSchema, ({ songs, list }) =>
    addDownloads(songs, list),
  );
  handle(Channels.downloadsCancel, DownloadIdSchema, ({ id }) =>
    cancelDownload(id),
  );
  handle(Channels.downloadsCancelAll, NoInput, () => cancelAllDownloads());
  handle(Channels.downloadsRemove, DownloadIdSchema, ({ id }) =>
    removeDownload(id),
  );
  handle(Channels.downloadsClear, NoInput, () => clearFinishedDownloads());
  handle(Channels.downloadsPause, NoInput, () => pauseDownloads());
  handle(Channels.downloadsResume, NoInput, () => resumeDownloads());
  handle(Channels.downloadsRetry, DownloadIdSchema, ({ id }) =>
    retryDownload(id),
  );
  handle(Channels.downloadsRetryFailed, NoInput, () => retryFailedDownloads());
  handle(Channels.downloadsMoveToTop, DownloadIdSchema, ({ id }) =>
    moveDownloadToTop(id),
  );
  handle(Channels.downloadsDelete, DownloadIdSchema, ({ id }) =>
    deleteDownload(id),
  );
  handle(Channels.downloadsShowInFolder, DownloadIdSchema, ({ id }) =>
    showDownloadInFolder(id),
  );
  handle(Channels.downloadsLocate, DownloadIdSchema, ({ id }) =>
    locateDownload(id),
  );
  handle(Channels.downloadsChooseFolder, NoInput, (_input, event) =>
    chooseDownloadFolder(BrowserWindow.fromWebContents(event.sender)),
  );
  handle(Channels.downloadsLibrary, NoInput, () => downloadedLibrary());
  handle(Channels.downloadsOpenFolder, NoInput, () => openDownloadFolder());
  handle(Channels.downloadsDeleteTrack, TrackIdSchema, ({ id }) =>
    deleteDownloadedTrack(id),
  );
}
