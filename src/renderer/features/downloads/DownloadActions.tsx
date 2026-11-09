import { toast } from '@heroui/react';
import { ArrowDown, Check, CircleAlert, Download } from 'lucide-react';
import { useState } from 'react';
import type { DownloadList } from '../../../shared/schemas/downloads';
import { setUi } from '../../app/ui';
import { IconAction } from '../../design/IconAction';
import { WaveRing } from '../../design/WaveRing';
import type { Playable } from '../player/player';
import { downloadSongs } from './downloads';
import { useDownloadSummary, useListProgress } from './store';

type Look = 'idle' | 'busy' | 'done' | 'warn';

/** The arrow in its ring while downloading; a tick or a warning once it's over. */
function Glyph({
  look,
  fraction,
  icon,
  label,
}: {
  look: Look;
  fraction: number;
  icon: number;
  label: string;
}) {
  return (
    <span className="relative grid size-full place-items-center">
      {look === 'busy' && (
        <WaveRing value={fraction} live label={label} waves={12} />
      )}
      {look === 'busy' ? (
        <ArrowDown size={icon * 0.6} className="text-accent" aria-hidden />
      ) : look === 'done' ? (
        <Check
          size={icon}
          strokeWidth={2.75}
          className="text-success"
          aria-hidden
        />
      ) : look === 'warn' ? (
        <CircleAlert size={icon} className="text-danger" aria-hidden />
      ) : (
        <Download size={icon} aria-hidden />
      )}
    </span>
  );
}

/** Beside Explore: the whole batch, and the way to the drawer. */
export function DownloadsButton({ size = 38 }: { size?: number }) {
  const s = useDownloadSummary();
  const look: Look =
    s.active > 0
      ? 'busy'
      : s.failed > 0
        ? 'warn'
        : s.done > 0
          ? 'done'
          : 'idle';
  const percent = Math.round(s.fraction * 100);
  const label =
    look === 'busy'
      ? `Downloads, ${percent}%`
      : look === 'warn'
        ? `Downloads, ${s.failed} failed`
        : 'Downloads';
  return (
    <IconAction
      label={label}
      size={size}
      onPress={() => setUi({ downloads: true })}
    >
      <Glyph look={look} fraction={s.fraction} icon={22} label={label} />
    </IconAction>
  );
}

/**
 * The large download at the head of an album or playlist, just before the
 * service's own link. Its ring counts only this list's songs.
 */
export function ListDownloadAction({
  tracks,
  complete,
  title,
  list = null,
  load,
}: {
  /** The songs on the page, for the ring and the tick. */
  tracks: Playable[];
  /** Every song of the list is in `tracks`. */
  complete: boolean;
  title: string;
  list?: DownloadList | null;
  /** Reads the whole list when the page only has part of it. */
  load?: () => Promise<Playable[]>;
}) {
  const progress = useListProgress(tracks, complete);
  const [reading, setReading] = useState(false);
  const look: Look = progress.busy
    ? 'busy'
    : progress.onDevice
      ? 'done'
      : 'idle';
  const label =
    look === 'busy'
      ? `Downloading, ${Math.round(progress.fraction * 100)}%`
      : look === 'done'
        ? 'On this device'
        : 'Download all';

  const press = () => {
    if (look === 'busy') {
      setUi({ downloads: true });
      return;
    }
    if (look === 'done') {
      toast(`“${title}” is already on this device`);
      return;
    }
    setReading(true);
    void (async () => {
      try {
        await downloadSongs(load ? await load() : tracks, title, list);
      } catch {
        toast(`Couldn’t load “${title}”`);
      } finally {
        setReading(false);
      }
    })();
  };

  return (
    <IconAction label={label} size={48} isPending={reading} onPress={press}>
      <Glyph look={look} fraction={progress.fraction} icon={28} label={label} />
    </IconAction>
  );
}
