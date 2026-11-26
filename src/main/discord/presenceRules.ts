/**
 * The Discord card for what is playing, apart from Electron so it can be
 * tested. The Rust module checks the result again before anything is sent.
 */
import type { AudioQuality } from '../../../native/index';
import {
  cleanText,
  cut,
  fillLabel,
  padShort,
  TEXT_LIMIT,
} from '../../shared/discordText.ts';
import type {
  DiscordActivity,
  DiscordActivityType,
  DiscordHidden,
  DiscordPlayback,
} from '../../shared/schemas/discord.ts';
import type { Settings } from '../../shared/schemas/settings.ts';
import { isPublicCover } from '../security/urls.ts';

export const WAVEBIT_PAGE = 'https://github.com/Wavebit-app/wavebit';

const ACTIVITY_TYPES: Record<DiscordActivityType, number> = {
  playing: 0,
  listening: 2,
  watching: 3,
  competing: 5,
};

const STATUS_DISPLAY = { app: 0, artist: 1, title: 2 } as const;

/** Picture names uploaded to wavebit's Discord application, and their hover text. */
const BADGES: Record<DiscordPlayback['source'], [string, string]> = {
  youtube: ['youtube-music', 'From YouTube Music'],
  spotify: ['spotify', 'From Spotify'],
  file: ['file', 'From your files'],
};

export type DiscordCardSettings = Pick<
  Settings,
  | 'discordPresenceEnabled'
  | 'discordActivityType'
  | 'discordStatusDisplay'
  | 'discordShowAlbum'
  | 'discordShowArtwork'
  | 'discordShowSource'
  | 'discordShowProgress'
  | 'discordShowSpeed'
  | 'discordShowQuality'
  | 'discordShareFiles'
  | 'discordWhenPaused'
  | 'discordSongButton'
  | 'discordSongLink'
  | 'discordSongButtonText'
  | 'discordAppButton'
  | 'discordAppButtonText'
>;

/** What was playing when the renderer last reported, and when that was. */
export interface PlaybackAt extends DiscordPlayback {
  /** Milliseconds since the epoch at which `position` was true. */
  at: number;
}

export interface Card {
  activity: DiscordActivity | null;
  hidden: DiscordHidden | null;
}

/** The song's page on the service it plays from, or Spotify when asked and known. */
export function songLink(
  playback: Pick<DiscordPlayback, 'youtubeId' | 'spotifyId'>,
  prefer: Settings['discordSongLink'],
): { url: string; label: string } | null {
  const spotify = playback.spotifyId
    ? {
        url: `https://open.spotify.com/track/${playback.spotifyId}`,
        label: 'Open in Spotify',
      }
    : null;
  const youtube = playback.youtubeId
    ? {
        url: `https://music.youtube.com/watch?v=${playback.youtubeId}`,
        label: 'Listen on YouTube Music',
      }
    : null;
  return prefer === 'spotify' ? (spotify ?? youtube) : (youtube ?? spotify);
}

/** "Hi-Res Lossless · FLAC · 24-bit · 96 kHz", for lossless files only. */
export function qualityLine(quality: AudioQuality | null): string | null {
  if (!quality?.lossless) return null;
  const rate = quality.sampleRateHz ?? 0;
  const depth = quality.bitDepth ?? 0;
  const hiRes = depth > 16 || rate > 48_000;
  const parts = [hiRes ? 'Hi-Res Lossless' : 'Lossless', quality.codec];
  if (depth) parts.push(`${depth}-bit`);
  if (rate) parts.push(`${Number((rate / 1000).toFixed(1))} kHz`);
  if (quality.channels === 1) parts.push('Mono');
  else if (quality.channels && quality.channels > 2)
    parts.push(`${quality.channels} ch`);
  return cut(parts.join(' · '), TEXT_LIMIT);
}

const speedTag = (speed: number) => ` [${Number(speed.toFixed(2))}×]`;

const text = (value: string) => padShort(cut(cleanText(value), TEXT_LIMIT));

/** Translates what is playing into the local RPC activity, or says why there is none. */
export function makeDiscordCard(
  playback: PlaybackAt | null,
  settings: DiscordCardSettings,
  options: { private: boolean; quality: AudioQuality | null },
): Card {
  if (!settings.discordPresenceEnabled)
    return { activity: null, hidden: 'off' };
  if (options.private) return { activity: null, hidden: 'private' };
  if (!playback) return { activity: null, hidden: 'nothing' };
  if (playback.source === 'file' && !settings.discordShareFiles)
    return { activity: null, hidden: 'files' };
  if (!playback.playing && settings.discordWhenPaused === 'hide')
    return { activity: null, hidden: 'paused' };

  const title = cleanText(playback.title) || 'Unknown song';
  const speed = playback.speed > 0 ? playback.speed : 1;
  const tag =
    settings.discordShowSpeed && Math.abs(speed - 1) > 0.001
      ? speedTag(speed)
      : '';
  const album = settings.discordShowAlbum ? cleanText(playback.album) : '';
  const state = cleanText(
    [cleanText(playback.artist), album].filter(Boolean).join(' · '),
  );
  const link = songLink(playback, settings.discordSongLink);

  const activity: DiscordActivity = {
    type: ACTIVITY_TYPES[settings.discordActivityType],
    status_display_type: STATUS_DISPLAY[settings.discordStatusDisplay],
    // The speed tag survives a long title: the title is cut first.
    details: padShort(cut(title, TEXT_LIMIT - tag.length) + tag),
    ...(link && { details_url: link.url }),
    ...(state && { state: text(state) }),
  };

  const duration = Math.max(0, playback.duration);
  if (playback.playing && settings.discordShowProgress && duration > 0) {
    const position = Math.min(Math.max(0, playback.position), duration);
    // Anchored to when the position was true, so the same report always
    // gives the same card, and Discord's bar runs at wall-clock speed.
    const start = Math.round(playback.at - (position * 1000) / speed);
    activity.timestamps = {
      start,
      end: Math.round(start + (duration * 1000) / speed),
    };
  }

  const assets: NonNullable<DiscordActivity['assets']> = {};
  const cover =
    settings.discordShowArtwork && playback.source !== 'file'
      ? playback.artworkUrl
      : null;
  if (cover && isPublicCover(cover)) assets.large_image = cover;
  const quality = settings.discordShowQuality
    ? qualityLine(options.quality)
    : null;
  const hover = quality ?? (album || null);
  const [badge, badgeText] = BADGES[playback.source];
  if (!playback.playing) {
    // Shown paused: the badge carries the word, since there is no timer.
    assets.small_image = badge;
    assets.small_text = 'Paused';
  } else if (settings.discordShowSource) {
    assets.small_image = badge;
    assets.small_text = badgeText;
  }
  // Hover text needs a picture to hover.
  if (hover && (assets.large_image || assets.small_image))
    assets.large_text = text(hover);
  if (Object.keys(assets).length) activity.assets = assets;

  const song = {
    title,
    artist: cleanText(playback.artist),
    album: cleanText(playback.album),
  };
  const buttons: NonNullable<DiscordActivity['buttons']> = [];
  if (settings.discordSongButton && link)
    buttons.push({
      label: fillLabel(settings.discordSongButtonText, link.label, song).text,
      url: link.url,
    });
  if (settings.discordAppButton)
    buttons.push({
      label: fillLabel(settings.discordAppButtonText, 'Get wavebit', song).text,
      url: WAVEBIT_PAGE,
    });
  if (buttons.length) activity.buttons = buttons;

  return { activity, hidden: null };
}
