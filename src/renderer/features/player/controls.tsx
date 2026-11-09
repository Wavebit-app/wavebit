import { Button, Slider, Tooltip } from '@heroui/react';
import {
  CirclePause,
  CirclePlay,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { clock } from '../../lib/format';
import { player, usePlayer } from './player';

export function IconButton({
  label,
  onPress,
  children,
  active = false,
  size = 36,
  className = '',
}: {
  label: string;
  onPress: () => void;
  children: ReactNode;
  active?: boolean;
  size?: number;
  className?: string;
}) {
  return (
    <Tooltip delay={600}>
      <Tooltip.Trigger>
        <Button
          isIconOnly
          variant="ghost"
          aria-label={label}
          aria-pressed={active || undefined}
          onPress={onPress}
          style={{ width: size, height: size, minWidth: size }}
          className={`icon-sized rounded-md ${active ? 'text-accent' : 'text-foreground'} ${className}`}
        >
          {children}
        </Button>
      </Tooltip.Trigger>
      <Tooltip.Content>{label}</Tooltip.Content>
    </Tooltip>
  );
}

/** Shuffle, previous, Play, next and repeat. `scale` grows them for the full-screen player. */
export function Transport({ scale = 1 }: { scale?: number }) {
  const playing = usePlayer((s) => s.playing);
  const shuffle = usePlayer((s) => s.shuffle);
  const repeat = usePlayer((s) => s.repeat);
  const small = 16 * scale;
  const mid = 18 * scale;
  const PlayIcon = playing ? CirclePause : CirclePlay;
  return (
    <div className="flex items-center justify-between gap-3">
      <IconButton
        label={shuffle ? 'Shuffle on' : 'Shuffle off'}
        active={shuffle}
        onPress={player.toggleShuffle}
        size={32 * scale}
      >
        <Shuffle size={small} />
      </IconButton>
      <IconButton label="Previous" onPress={player.previous} size={36 * scale}>
        <SkipBack size={mid} />
      </IconButton>
      <IconButton
        label={playing ? 'Pause' : 'Play'}
        onPress={player.toggle}
        size={40 * scale}
        className="text-accent"
      >
        <PlayIcon
          size={34 * scale}
          strokeWidth={1.75}
          className="text-accent"
        />
      </IconButton>
      <IconButton label="Next" onPress={player.next} size={36 * scale}>
        <SkipForward size={mid} />
      </IconButton>
      <IconButton
        label={
          repeat === 'off'
            ? 'Repeat off'
            : repeat === 'all'
              ? 'Repeat all'
              : 'Repeat one'
        }
        active={repeat !== 'off'}
        onPress={player.cycleRepeat}
        size={32 * scale}
      >
        {repeat === 'one' ? <Repeat1 size={small} /> : <Repeat size={small} />}
      </IconButton>
    </div>
  );
}

/** The flat seek bar with times; `remaining` shows −m:ss on the right. */
export function SeekBar({
  thick = false,
  remaining = false,
}: {
  thick?: boolean;
  remaining?: boolean;
}) {
  const position = usePlayer((s) => Math.floor(s.position));
  const duration = usePlayer((s) => s.duration);
  const playing = usePlayer((s) => s.playing);
  const max = Math.max(1, duration);
  const played = `${Math.min(100, (Math.min(position, max) / max) * 100)}%`;
  return (
    <div
      className={`flex w-full ${thick ? 'flex-col gap-2' : 'items-center gap-2.5'}`}
    >
      {!thick && (
        <span className="w-10 text-right text-xs text-muted tabular-nums">
          {clock(position * 1000)}
        </span>
      )}
      <Slider
        aria-label="Seek"
        minValue={0}
        maxValue={max}
        step={1}
        value={Math.min(position, max)}
        onChange={(v) => player.seek(Array.isArray(v) ? v[0]! : v)}
        className="wave-slider flex-1"
      >
        <Slider.Track className="h-3">
          {/* The rest of the song: a flat line. */}
          <span
            aria-hidden
            style={{ left: played }}
            className="pointer-events-none absolute right-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-[var(--line-strong)]"
          />
          {/* The played part: a wave that flows while playing and settles flat when paused. */}
          <span
            aria-hidden
            style={
              {
                width: played,
                '--wave-amp': playing ? 1 : 0.18,
                '--wave-run': playing ? 'running' : 'paused',
              } as CSSProperties
            }
            className="wave-played pointer-events-none absolute top-1/2 left-0 -mt-[6px]"
          />
          <Slider.Fill />
          <Slider.Thumb className={thick ? 'size-3.5' : 'size-3'} />
        </Slider.Track>
      </Slider>
      {thick ? (
        <div className="flex justify-between text-sm text-muted tabular-nums">
          <span>{clock(position * 1000)}</span>
          <span>
            {remaining
              ? `−${clock((duration - position) * 1000)}`
              : clock(duration * 1000)}
          </span>
        </div>
      ) : (
        <span className="w-10 text-xs text-muted tabular-nums">
          {clock(duration * 1000)}
        </span>
      )}
    </div>
  );
}

export function Volume({ width = 96 }: { width?: number }) {
  const volume = usePlayer((s) => s.volume);
  const Icon = volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  return (
    <div className="flex items-center gap-2" data-volume={volume}>
      <IconButton
        label={volume === 0 ? 'Unmute' : 'Mute'}
        onPress={() => player.setVolume(volume === 0 ? 0.8 : 0)}
        size={32}
      >
        <Icon size={18} />
      </IconButton>
      <Slider
        aria-label="Volume"
        minValue={0}
        maxValue={1}
        step={0.01}
        value={volume}
        onChange={(v) => player.setVolume(Array.isArray(v) ? v[0]! : v)}
        style={{ width }}
      >
        <Slider.Track className="h-1">
          <Slider.Fill />
          <Slider.Thumb className="size-3" />
        </Slider.Track>
      </Slider>
    </div>
  );
}
