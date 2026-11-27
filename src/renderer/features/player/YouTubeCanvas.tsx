import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useCanvas, useSettings, useSignedIn } from '../../lib/queries';
import { useMotion } from '../../lib/useTheme';
import { usePlayer, type Playable } from './player';
import { VideoSlot } from './VideoSlot';

/** The YouTube Canvas's picture: small, since it sits behind words, muted. */
const CANVAS_HEIGHT = 360;
/** How far the picture may drift from the song before it is put back. */
const DRIFT_S = 1.5;

export interface YouTubeCanvasSource {
  url: string;
  /** Where the song starts in the video, or null when that isn't known. */
  offsetMs: number | null;
}

/**
 * The YouTube Canvas for `track`: a YouTube song's music video, as Spotify's
 * Canvas is a Spotify song's clip. Only for a song (a music video already
 * shows itself), only with the setting on and Motion at Full, and never in
 * place of a Spotify Canvas. Nothing is asked for until the song is playing,
 * so the video never competes with the song's own stream.
 */
export function useYouTubeCanvas(
  track: Playable | undefined,
): YouTubeCanvasSource | null {
  const settings = useSettings().data;
  const motion = useMotion();
  const signedIn = useSignedIn();
  const playing = usePlayer((s) => s.playing && !s.loading && !s.fromCopy);
  const videoId = track?.stream?.videoId ?? null;
  const spotify = useCanvas(
    track?.spotifyUri,
    !!settings?.spotifyCanvas && signedIn && motion === 'full',
  ).data;
  const enabled =
    !!settings?.youtubeCanvas &&
    motion === 'full' &&
    !!videoId &&
    !track?.stream?.isVideo &&
    !spotify &&
    !!track?.title;
  const found = useQuery({
    queryKey: ['youtube', 'canvas', videoId],
    queryFn: () =>
      window.wavebit.youtube.canvas({
        videoId: videoId!,
        title: track!.title.slice(0, 200),
        artist: track!.artist.slice(0, 200),
      }),
    enabled: enabled && playing,
    staleTime: Infinity,
    retry: false,
  });
  const canvasId = found.data?.videoId ?? null;
  const stream = useQuery({
    queryKey: ['youtube', 'canvas-stream', canvasId],
    queryFn: () =>
      window.wavebit.youtube.resolveStream({
        requestId: crypto.randomUUID(),
        videoId: canvasId!,
        maxHeight: CANVAS_HEIGHT,
      }),
    enabled: enabled && playing && !!canvasId,
    // The stream's lease lasts 10 minutes past its last read.
    staleTime: 8 * 60_000,
    gcTime: 8 * 60_000,
    retry: false,
  });
  if (!enabled || !found.data || !stream.data) return null;
  return { url: stream.data.videoUrl, offsetMs: found.data.offsetMs };
}

/**
 * The music video, muted, filling its box: paused with the music and, when
 * YouTube Music says where the song starts in it, kept at the same moment.
 * It fades in once it plays, so nothing flashes black first.
 */
export function YouTubeCanvas({
  source,
  scrim = true,
}: {
  source: YouTubeCanvasSource;
  scrim?: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const playing = usePlayer((s) => s.playing);
  const position = usePlayer((s) => s.position);
  const [shown, setShown] = useState(false);
  const synced = source.offsetMs !== null;

  useEffect(() => setShown(false), [source.url]);

  useEffect(() => {
    const el = video.current;
    if (!el) return;
    if (playing) void el.play().catch(() => {});
    else el.pause();
  }, [playing, source.url]);

  useEffect(() => {
    const el = video.current;
    if (!el || !synced || !Number.isFinite(el.duration)) return;
    const target = position + source.offsetMs! / 1000;
    if (target < 0 || target > el.duration) return;
    if (Math.abs(el.currentTime - target) > DRIFT_S) el.currentTime = target;
  }, [position, source.offsetMs, synced]);

  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-0 overflow-hidden transition-opacity duration-500 ${shown ? 'opacity-100' : 'opacity-0'}`}
    >
      <video
        ref={video}
        src={source.url}
        muted
        loop={!synced}
        playsInline
        autoPlay
        onPlaying={() => setShown(true)}
        onError={() => setShown(false)}
        className="size-full object-cover"
      />
      {scrim && <div className="scrim absolute inset-0" />}
    </div>
  );
}

/**
 * A place the full-screen player shows the stream's picture: the YouTube
 * Canvas when the song has one, else YouTube's own player (its still
 * picture for a song, the video for a music video).
 */
export function CanvasOrVideo({
  track,
  className,
}: {
  track: Playable;
  className: string;
}) {
  const source = useYouTubeCanvas(track);
  if (!source) return <VideoSlot className={className} />;
  return (
    <div
      aria-hidden
      className={`relative overflow-hidden bg-black ${className}`}
    >
      <YouTubeCanvas source={source} scrim={false} />
    </div>
  );
}
