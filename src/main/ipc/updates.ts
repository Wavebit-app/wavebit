import { z } from 'zod';
import { Channels } from '../../shared/ipc/channels';
import {
  NotesQuerySchema,
  UpdatePageSchema,
} from '../../shared/schemas/updates';
import {
  checkForUpdates,
  downloadUpdate,
  installUpdate,
  markWhatsNewSeen,
  openUpdatePage,
  releaseNotes,
  updateStatus,
} from '../updates/updates';
import { handle } from './handle';

const NoInput = z.undefined();

export function registerUpdatesIpc(): void {
  handle(Channels.updatesStatus, NoInput, updateStatus);
  handle(Channels.updatesCheck, NoInput, checkForUpdates);
  handle(Channels.updatesDownload, NoInput, downloadUpdate);
  handle(Channels.updatesInstall, NoInput, installUpdate);
  handle(Channels.updatesSeen, NoInput, markWhatsNewSeen);
  handle(Channels.updatesNotes, NotesQuerySchema, ({ target }) =>
    releaseNotes(target),
  );
  handle(Channels.updatesOpen, UpdatePageSchema, ({ page }) =>
    openUpdatePage(page),
  );
}
