import { useEffect, useRef } from 'react';
import type { DiscordPlayback } from '../../../shared/schemas/discord';
import { useSettings } from '../../lib/queries';
import { isFile, usePlayer, type Playable } from './player';

/** How far the position may drift from where it should be before it counts as a seek. */
const SEEK_TOLERANCE = 2;

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const SPOTIFY_ID = /^spotify:track:([A-Za-z0-9]{22})$/;

function ids(
  track: Playable,
): Pick<DiscordPlayback, 'source' | 'youtubeId' | 'spotifyId'> {
  const videoId = track.stream?.videoId ?? null;
  const spotifyId = track.spotifyUri?.match(SPOTIFY_ID)?.[1] ?? null;
  return {
    source: isFile(track.id)
      ? 'file'
      : track.spotifyUri
        ? 'spotify'
        : 'youtube',
    youtubeId: videoId && YOUTUBE_ID.test(videoId) ? videoId : null,
    spotifyId,
  };
}

/**
 * Tells the main process what is playing at the moments the card changes: a
 * new song, play or pause, a seek, or a new speed. Discord counts the bar on
 * its own, so ordinary ticks send nothing.
 */
export function DiscordBridge() {
  const enabled = useSettings().data?.discordPresenceEnabled ?? false;
  const speed = useSettings().data?.playbackSpeed ?? 1;
  const track = usePlayer((state) => state.queue[state.index] ?? null);
  const playing = usePlayer((state) => state.playing && !state.error);
  const position = usePlayer((state) => state.position);
  const duration = usePlayer((state) => state.duration);
  const last = useRef<{
    key: string;
    position: number;
    at: number;
    playing: boolean;
    speed: number;
  } | null>(null);

  useEffect(() => {
    if (!enabled) {
      last.current = null;
      return;
    }
    if (!track) {
      if (last.current?.key !== '')
        void window.wavebit.discord.publish(null).catch(() => {});
      last.current = {
        key: '',
        position: 0,
        at: Date.now(),
        playing: false,
        speed,
      };
      return;
    }
    const now = Date.now();
    const key = `${track.id}|${duration > 0 ? Math.round(duration) : 0}`;
    const before = last.current;
    const expected = before
      ? before.position +
        (before.playing ? ((now - before.at) / 1000) * before.speed : 0)
      : 0;
    const changed =
      !before ||
      before.key !== key ||
      before.playing !== playing ||
      before.speed !== speed ||
      Math.abs(position - expected) > SEEK_TOLERANCE;
    if (!changed) return;
    last.current = { key, position, at: now, playing, speed };
    const playback: DiscordPlayback = {
      id: track.id,
      title: track.title,
      artist: track.artist,
      album: track.album,
      artworkUrl: track.artwork,
      playing,
      position: Math.max(0, position),
      duration: Math.max(0, duration || track.durationMs / 1000),
      speed,
      ...ids(track),
    };
    void window.wavebit.discord.publish(playback).catch(() => {});
  }, [enabled, track, playing, position, duration, speed]);

  useEffect(
    () => () => {
      void window.wavebit.discord.publish(null).catch(() => {});
    },
    [],
  );

  return null;
}
