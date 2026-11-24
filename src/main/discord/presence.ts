import type { DiscordPresence as NativePresence } from '../../../native/index';
import type { Settings } from '../../shared/schemas/settings';
import {
  DiscordPlaybackSchema,
  DiscordStatusSchema,
  type DiscordPlayback,
  type DiscordStatus,
} from '../../shared/schemas/discord';
import { Events } from '../../shared/ipc/channels';
import { emit } from '../ipc/handle';
import { native } from '../services/native';
import { onSettingsChange, readSettings } from '../services/settings';
import { discordClientId } from './config';
import { makeDiscordActivity } from './presenceRules';

let client: NativePresence | null = null;
let playback: DiscordPlayback | null = null;
let status: DiscordStatus = 'disabled';
let started = false;
let requestedEnabled = false;
let lastActivity = '';

function announce(next: DiscordStatus): void {
  if (status === next) return;
  status = next;
  emit(Events.discordStatus, status);
}

function options(settings: Settings) {
  return {
    ...settings,
    playbackSpeed: settings.playbackSpeed,
  };
}

function apply(settings = readSettings()): void {
  const id = discordClientId();
  if (!settings.discordPresenceEnabled) {
    if (client && requestedEnabled) client.enable(false);
    requestedEnabled = false;
    lastActivity = '';
    announce('disabled');
    return;
  }
  if (!id) {
    announce('not_configured');
    return;
  }
  if (!client) {
    announce('error');
    return;
  }
  if (!requestedEnabled) {
    client.enable(true);
    requestedEnabled = true;
  }
  const activity = makeDiscordActivity(playback, options(settings));
  const json = activity ? JSON.stringify(activity) : '';
  if (json === lastActivity) return;
  lastActivity = json;
  if (json) client.setActivity(json);
  else client.clear();
}

export function startDiscordPresence(): void {
  if (started) return;
  started = true;
  const id = discordClientId();
  if (!id) {
    announce(
      readSettings().discordPresenceEnabled ? 'not_configured' : 'disabled',
    );
    onSettingsChange(apply);
    return;
  }
  try {
    client = new (native().DiscordPresence)(id, (raw: string) => {
      try {
        const parsed = DiscordStatusSchema.safeParse(JSON.parse(raw));
        if (parsed.success) announce(parsed.data);
      } catch {
        announce('error');
      }
    });
  } catch {
    announce('error');
  }
  onSettingsChange(apply);
  apply();
}

export function discordStatus(): DiscordStatus {
  return status;
}

export function publishPlayback(raw: DiscordPlayback | null): void {
  const parsed = raw === null ? null : DiscordPlaybackSchema.safeParse(raw);
  playback = parsed === null ? null : parsed.success ? parsed.data : null;
  apply();
}

export function retryDiscord(): void {
  client?.retry();
  apply();
}

export function stopDiscordPresence(): void {
  const owned = client;
  client = null;
  requestedEnabled = false;
  playback = null;
  lastActivity = '';
  owned?.shutdown(1000);
  announce('disabled');
}
