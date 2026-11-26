import type {
  AudioQuality,
  DiscordPresence as NativePresence,
} from '../../../native/index';
import {
  DiscordPlaybackSchema,
  DiscordReportSchema,
  type DiscordPlayback,
  type DiscordReport,
  type DiscordState,
} from '../../shared/schemas/discord';
import { Events } from '../../shared/ipc/channels';
import { emit } from '../ipc/handle';
import { lib } from '../library/library';
import { native } from '../services/native';
import { onSettingsChange, readSettings } from '../services/settings';
import { discordClientId } from './config';
import { makeDiscordCard, type PlaybackAt } from './presenceRules';

const FILE_ID = /^[0-9a-f]{16}$/;

let client: NativePresence | null = null;
/** The application id `client` was made for. */
let clientId = '';
let started = false;
let enabled = false;
let playback: PlaybackAt | null = null;
/** Private listening: until turned off or wavebit quits, never saved. */
let privateListening = false;
let lastSent = '';
let report: DiscordReport = {
  status: 'disabled',
  user: null,
  client: null,
  problem: null,
  showing: false,
  sentAt: null,
};
let state: DiscordState = {
  ...report,
  private: false,
  card: null,
  hidden: 'off',
  song: null,
  appIdSource: null,
};
let appIdSource: DiscordState['appIdSource'] = null;
const listeners = new Set<(state: DiscordState) => void>();

/** Each file's quality, read once per run; files don't change format while playing. */
const qualities = new Map<string, AudioQuality | null>();

function qualityFor(id: string): AudioQuality | null {
  if (!FILE_ID.test(id)) return null;
  if (qualities.has(id)) return qualities.get(id) ?? null;
  qualities.set(id, null);
  if (qualities.size > 500) qualities.delete(qualities.keys().next().value!);
  void (lib().audioQuality(id) as Promise<AudioQuality | null>)
    .then((quality) => {
      qualities.set(id, quality ?? null);
      if (quality?.lossless && playback?.id === id) apply();
    })
    .catch(() => {});
  return null;
}

function currentCard() {
  return makeDiscordCard(playback, readSettings(), {
    private: privateListening,
    quality: playback ? qualityFor(playback.id) : null,
  });
}

function announce(card = currentCard()): void {
  const next: DiscordState = {
    ...report,
    private: privateListening,
    card: card.activity,
    hidden: card.hidden,
    song: playback ? { title: playback.title, artist: playback.artist } : null,
    appIdSource,
  };
  if (JSON.stringify(next) === JSON.stringify(state)) return;
  state = next;
  emit(Events.discordStatus, state);
  for (const listener of listeners) listener(state);
}

const IDLE: DiscordReport = {
  status: 'disabled',
  user: null,
  client: null,
  problem: null,
  showing: false,
  sentAt: null,
};

/** A new id (typed in Settings) needs a new connection: the old one is closed first. */
function useClientFor(id: string): void {
  if (id === clientId && (client || !id)) return;
  const old = client;
  client = null;
  enabled = false;
  lastSent = '';
  clientId = id;
  report = { ...IDLE, status: id ? 'disabled' : 'not_configured' };
  old?.shutdown(500);
  if (!id) return;
  try {
    client = new (native().DiscordPresence)(id, (raw: string) => {
      // Reports from a client that has since been replaced are dropped.
      if (clientId === id) onReport(raw);
    });
  } catch {
    client = null;
  }
}

function apply(): void {
  const settings = readSettings();
  const { id, source } = discordClientId(settings.discordClientId);
  appIdSource = source;
  useClientFor(id);
  if (!settings.discordPresenceEnabled || !client) {
    if (client && enabled) client.enable(false);
    enabled = false;
    lastSent = '';
    report = {
      ...IDLE,
      // Off, no id to use, or on with an id whose client couldn't start.
      status: !id
        ? 'not_configured'
        : settings.discordPresenceEnabled
          ? 'waiting'
          : 'disabled',
    };
    announce();
    return;
  }
  if (!enabled) {
    client.enable(true);
    enabled = true;
  }
  const card = currentCard();
  const json = card.activity ? JSON.stringify(card.activity) : '';
  if (json !== lastSent) {
    lastSent = json;
    // The Rust module refuses anything off; then the card comes down rather than going stale.
    if (!json || !client.setActivity(json)) client.clear();
  }
  announce(card);
}

function onReport(raw: string): void {
  try {
    const parsed = DiscordReportSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return;
    // The Rust module keeps the card and sends it again on each new connection.
    report = parsed.data;
    announce();
  } catch {
    // A malformed report changes nothing.
  }
}

export function startDiscordPresence(): void {
  if (started) return;
  started = true;
  onSettingsChange(apply);
  apply();
}

export function discordState(): DiscordState {
  return state;
}

export function onDiscordState(
  listener: (state: DiscordState) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function publishPlayback(raw: DiscordPlayback | null): void {
  if (raw === null) playback = null;
  else {
    const parsed = DiscordPlaybackSchema.safeParse(raw);
    playback = parsed.success ? { ...parsed.data, at: Date.now() } : null;
  }
  apply();
}

export function setDiscordPrivate(on: boolean): void {
  privateListening = on;
  apply();
}

export function retryDiscord(): void {
  client?.retry();
  lastSent = '';
  apply();
}

export function stopDiscordPresence(): void {
  const owned = client;
  client = null;
  clientId = '';
  enabled = false;
  playback = null;
  lastSent = '';
  owned?.shutdown(1000);
}
