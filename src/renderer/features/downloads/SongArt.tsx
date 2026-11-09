import { Check } from 'lucide-react';
import type { ComponentProps } from 'react';
import { StatusArt } from '../../design/StatusArt';
import { WaveRing } from '../../design/WaveRing';
import type { Playable } from '../player/player';
import { useSongDownload } from './store';

/** A song's cover, showing its download. */
export function SongArt({
  track,
  ...art
}: { track: Playable | null } & Omit<
  ComponentProps<typeof StatusArt>,
  'status' | 'fraction'
>) {
  const status = useSongDownload(track);
  return (
    <StatusArt status={status.state} fraction={status.fraction} {...art} />
  );
}

/** The green tick: this song is on this device. */
export function OnDevice({ track }: { track: Playable | null }) {
  const { state } = useSongDownload(track);
  return state === 'done' ? <Tick /> : null;
}

export function Tick({ size = 14 }: { size?: number }) {
  return (
    <span
      role="img"
      aria-label="On this device"
      title="On this device"
      style={{ width: size, height: size }}
      className="grid shrink-0 place-items-center rounded-full bg-success text-success-foreground"
    >
      <Check size={size * 0.7} strokeWidth={3.5} aria-hidden />
    </span>
  );
}

/** Beside a title where no cover shows (a video plays there): the tick, or a small ring. */
export function SongMark({
  track,
  size = 16,
}: {
  track: Playable | null;
  size?: number;
}) {
  const status = useSongDownload(track);
  if (status.state === 'done') return <Tick size={size} />;
  if (status.state !== 'queued' && status.state !== 'running') return null;
  return (
    <span
      className="relative block shrink-0"
      style={{ width: size, height: size }}
    >
      <WaveRing
        value={status.fraction}
        live={status.state === 'running'}
        waves={8}
        label="Downloading"
      />
    </span>
  );
}
