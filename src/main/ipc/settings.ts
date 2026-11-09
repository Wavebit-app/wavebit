import { z } from 'zod';
import { Channels } from '../../shared/ipc/channels';
import { SettingsPatchSchema } from '../../shared/schemas/settings';
import { readSettings, writeSettings } from '../services/settings';
import { handle } from './handle';

export function registerSettingsIpc(): void {
  handle(Channels.settingsGet, z.undefined(), () => readSettings());
  handle(Channels.settingsSet, SettingsPatchSchema, (patch) =>
    writeSettings(patch),
  );
}
