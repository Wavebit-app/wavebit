import { CircleAlert } from 'lucide-react';
import type { MouseEventHandler } from 'react';
import { Artwork } from './Artwork';
import { WaveRing } from './WaveRing';

export type ArtStatus = 'idle' | 'queued' | 'running' | 'failed' | 'done';

/** A cover: square at rest, a circle in a wavy ring while its song downloads. */
export function StatusArt({
  status,
  fraction = 0,
  src,
  size,
  className = '',
  rounded = 'rounded-[4px]',
  onContextMenu,
}: {
  status: ArtStatus;
  fraction?: number;
  src: string | null | undefined;
  size?: number;
  className?: string;
  rounded?: string;
  onContextMenu?: MouseEventHandler<HTMLElement>;
}) {
  const busy = status === 'queued' || status === 'running';
  return (
    <span
      onContextMenu={onContextMenu}
      style={size ? { width: size, height: size } : undefined}
      className={`relative block shrink-0 ${className}`}
    >
      <Artwork
        src={src}
        size={size}
        rounded={busy ? 'rounded-full' : rounded}
        className={`song-art size-full ${busy ? 'song-art-busy' : ''}`}
      />
      {busy && <WaveRing value={fraction} live={status === 'running'} />}
      {status === 'failed' && (
        <span
          className={`absolute inset-0 grid place-items-center bg-black/55 text-danger ${rounded}`}
        >
          <CircleAlert size={18} aria-hidden />
        </span>
      )}
    </span>
  );
}
