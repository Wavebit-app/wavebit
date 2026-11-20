import { z } from 'zod';
import { Channels } from '../../shared/ipc/channels';
import {
  OfflineHasSchema,
  OfflineKeepSchema,
} from '../../shared/schemas/offline';
import {
  clearOffline,
  isOnline,
  keepOffline,
  offlineHas,
} from '../offline/offlineSongs';
import { handle } from './handle';

const NoInput = z.undefined();

export function registerOfflineIpc(): void {
  handle(Channels.offlineKeep, OfflineKeepSchema, ({ videoId }) =>
    keepOffline(videoId),
  );
  handle(Channels.offlineHas, OfflineHasSchema, ({ videoIds }) =>
    offlineHas(videoIds),
  );
  handle(Channels.offlineOnline, NoInput, () => isOnline());
  handle(Channels.offlineClear, NoInput, () => clearOffline());
}
