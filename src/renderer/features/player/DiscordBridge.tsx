import { useEffect, useRef } from 'react';
import type { DiscordPlayback } from '../../../shared/schemas/discord';
import { useSettings } from '../../lib/queries';
import { usePlayer } from './player';

/** Forwards only meaningful playback changes; position ticks don't flood IPC. */
export function DiscordBridge() {
  const settings = useSettings().data;
  const track = usePlayer((state) => state.queue[state.index] ?? null);
  const playing = usePlayer((state) => state.playing && !state.error);
  const position = usePlayer((state) => state.position);
  const duration = usePlayer((state) => state.duration);
  const previous = useRef<{
    id: string | null;
    playing: boolean;
    position: number;
    options: string;
  } | null>(null);

  const options = settings
    ? JSON.stringify([
        settings.discordPresenceEnabled,
        settings.playbackSpeed,
        settings.discordActivityType,
        settings.discordShowAlbum,
        settings.discordShowArtwork,
        settings.discordShowProgress,
      ])
    : '';

  useEffect(() => {
    if (!settings) return;
    const id = track?.id ?? null;
    const before = previous.current;
    const changed =
      !before ||
      before.id !== id ||
      before.playing !== playing ||
      before.options !== options ||
      Math.abs(position - before.position) > 1;
    previous.current = { id, playing, position, options };
    if (!changed) return;
    if (!track) {
      void window.wavebit.discord.publish(null).catch(() => {});
      return;
    }
    const playback: DiscordPlayback = {
      id: track.id,
      title: track.title,
      artist: track.artist,
      album: track.album,
      artworkUrl: track.artwork,
      playing,
      position: Math.max(0, position),
      duration: Math.max(0, duration || track.durationMs / 1000),
      speed: settings.playbackSpeed,
    };
    void window.wavebit.discord.publish(playback).catch(() => {});
  }, [duration, options, playing, position, settings, track]);

  useEffect(() => {
    return () => {
      previous.current = null;
      void window.wavebit.discord.publish(null).catch(() => {});
    };
  }, []);

  return null;
}
