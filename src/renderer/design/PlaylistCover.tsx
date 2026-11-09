import { Heart } from 'lucide-react';
import { LIKED_ID } from '../../shared/schemas/spotify';
import { Artwork } from './Artwork';

/**
 * A playlist's cover. Liked Songs isn't a playlist to Spotify and has no cover,
 * so wavebit draws its own: the heart on `accent-soft` (DESIGN.md › Spotify).
 */
export function PlaylistCover({
  id,
  src,
  size,
  className = '',
  rounded = 'rounded-[4px]',
}: {
  id: string;
  src: string | null | undefined;
  size?: number;
  className?: string;
  rounded?: string;
}) {
  if (id !== LIKED_ID)
    return (
      <Artwork src={src} size={size} className={className} rounded={rounded} />
    );
  const style = size ? { width: size, height: size } : undefined;
  return (
    <span
      aria-hidden
      style={style}
      className={`flex shrink-0 items-center justify-center bg-accent-soft text-accent ${rounded} ${className}`}
    >
      <Heart
        size={size ? Math.max(12, size * 0.42) : 40}
        fill="currentColor"
        strokeWidth={1.5}
      />
    </span>
  );
}
