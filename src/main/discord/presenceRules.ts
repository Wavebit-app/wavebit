import type { Settings } from '../../shared/schemas/settings';
import type {
  DiscordPlayback,
  DiscordActivityType,
} from '../../shared/schemas/discord';

export interface DiscordActivity {
  type: number;
  details: string;
  state?: string;
  timestamps?: { start: number; end: number };
  assets?: { large_image: string; large_text?: string };
}

const activityTypes: Record<DiscordActivityType, number> = {
  playing: 0,
  listening: 2,
  watching: 3,
  competing: 5,
};

const ART_HOSTS = [
  'scdn.co',
  'spotifycdn.com',
  'googleusercontent.com',
  'ytimg.com',
  'ggpht.com',
];

function cleanText(value: string, limit = 128): string {
  const safe = [...value]
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code > 0x1f && code !== 0x7f;
    })
    .join('')
    .trim();
  return [...safe].slice(0, limit).join('');
}

function publicArtwork(value: string | null): string | null {
  if (!value || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      !ART_HOSTS.some(
        (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
      )
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}

/** Translates a playback snapshot into the documented local RPC activity shape. */
export function makeDiscordActivity(
  playback: DiscordPlayback | null,
  settings: Pick<
    Settings,
    | 'discordPresenceEnabled'
    | 'discordActivityType'
    | 'discordShowAlbum'
    | 'discordShowArtwork'
    | 'discordShowProgress'
    | 'playbackSpeed'
  >,
  nowMs = Date.now(),
): DiscordActivity | null {
  if (!settings.discordPresenceEnabled || !playback?.playing) return null;

  const title = cleanText(playback.title) || 'Unknown track';
  const artist = cleanText(playback.artist);
  const album = settings.discordShowAlbum ? cleanText(playback.album) : '';
  const state = cleanText([artist, album].filter(Boolean).join(' · '));
  const activity: DiscordActivity = {
    type: activityTypes[settings.discordActivityType],
    details: title,
    ...(state && { state }),
  };

  const duration = Math.max(0, playback.duration);
  const position = Math.min(
    Math.max(0, playback.position),
    duration || playback.position,
  );
  const speed = settings.playbackSpeed;
  if (settings.discordShowProgress && duration > 0 && speed > 0) {
    const now = Math.floor(nowMs / 1000);
    activity.timestamps = {
      start: Math.max(0, now - Math.floor(position / speed)),
      end: now + Math.max(0, Math.ceil((duration - position) / speed)),
    };
  }

  if (settings.discordShowArtwork) {
    const image = publicArtwork(playback.artworkUrl);
    if (image) {
      activity.assets = {
        large_image: image,
        ...(album && { large_text: album }),
      };
    }
  }
  return activity;
}
