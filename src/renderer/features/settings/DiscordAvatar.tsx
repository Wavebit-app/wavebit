import { useState } from 'react';
import type { DiscordUser } from '../../../shared/schemas/discord';
import { DiscordMark } from '../../design/BrandMarks';
import { cachedArt } from '../../lib/format';

export type DiscordDot =
  | 'success'
  | 'faint'
  | 'warning'
  | 'accent'
  | 'off'
  | null;

const DOT: Record<Exclude<DiscordDot, null>, string> = {
  success: 'bg-success',
  faint: 'bg-faint',
  warning: 'bg-warning',
  accent: 'bg-accent',
  off: 'bg-line-strong',
};

/**
 * The Discord picture the local client reported, through wavebit's cover
 * cache, or the Discord mark on `sunken`. The dot repeats the status line.
 */
export function DiscordAvatar({
  user,
  size,
  dot,
  ring = 'ring-[color-mix(in_srgb,var(--foreground)_5%,var(--surface))]',
}: {
  user: DiscordUser | null | undefined;
  size: number;
  dot: DiscordDot;
  /** The colour around the dot: whatever the avatar sits on. */
  ring?: string;
}) {
  const [failed, setFailed] = useState(false);
  const dotSize = Math.round(size * 0.29);
  return (
    <span className="relative shrink-0" style={{ width: size, height: size }}>
      {user?.avatarUrl && !failed ? (
        <img
          src={cachedArt(user.avatarUrl)}
          alt=""
          draggable={false}
          onError={() => setFailed(true)}
          className="size-full rounded-full bg-sunken object-cover"
        />
      ) : (
        <span className="flex size-full items-center justify-center rounded-full bg-sunken">
          <DiscordMark size={Math.round(size * 0.5)} />
        </span>
      )}
      {dot && (
        <span
          aria-hidden
          style={{ width: dotSize, height: dotSize }}
          className={`absolute -right-px -bottom-px rounded-full ring-3 ${ring} ${DOT[dot]}`}
        />
      )}
    </span>
  );
}
