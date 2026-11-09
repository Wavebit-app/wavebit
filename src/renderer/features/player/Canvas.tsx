import { useEffect, useRef } from 'react';
import { useCanvas, useSettings, useSignedIn } from '../../lib/queries';
import { useMotion } from '../../lib/useTheme';
import { usePlayer } from './player';

/**
 * Spotify's Canvas behind the full-screen player (BitChord's Canvas toggle):
 * muted and looping, paused with the music, never fetched with Motion below
 * Full or the setting off. Sits under the same flat scrim as the backdrop.
 */
export function SpotifyCanvas({
  uri,
  scrim = true,
}: {
  uri: string | null | undefined;
  scrim?: boolean;
}) {
  const enabled = useSettings().data?.spotifyCanvas ?? false;
  const signedIn = useSignedIn();
  const motion = useMotion();
  const playing = usePlayer((s) => s.playing);
  const canvas = useCanvas(uri, enabled && signedIn && motion === 'full');
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = video.current;
    if (!el) return;
    if (playing) void el.play().catch(() => {});
    else el.pause();
  }, [playing, canvas.data]);

  if (!canvas.data) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      <video
        ref={video}
        src={canvas.data}
        muted
        loop
        playsInline
        autoPlay
        className="size-full object-cover"
      />
      {scrim && <div className="scrim absolute inset-0" />}
    </div>
  );
}
