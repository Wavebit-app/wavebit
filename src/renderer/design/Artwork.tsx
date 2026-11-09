import { Music } from 'lucide-react';
import { useState, type MouseEventHandler } from 'react';

/** A cover, or the music icon on `sunken` when there is none or it fails to load. */
export function Artwork({
  src,
  size,
  className = '',
  rounded = 'rounded-[4px]',
  onContextMenu,
}: {
  src: string | null | undefined;
  size?: number;
  className?: string;
  rounded?: string;
  onContextMenu?: MouseEventHandler<HTMLElement>;
}) {
  const [failed, setFailed] = useState(false);
  const style = size ? { width: size, height: size } : undefined;
  if (!src || failed)
    return (
      <span
        aria-hidden
        onContextMenu={onContextMenu}
        style={style}
        className={`flex shrink-0 items-center justify-center bg-sunken text-muted ${rounded} ${className}`}
      >
        <Music
          size={size ? Math.max(14, size * 0.36) : 24}
          strokeWidth={1.75}
        />
      </span>
    );
  return (
    <img
      src={src}
      alt=""
      onContextMenu={onContextMenu}
      style={style}
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailed(true)}
      className={`shrink-0 bg-sunken object-cover ${rounded} ${className}`}
    />
  );
}
