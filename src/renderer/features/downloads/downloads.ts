import { toast } from '@heroui/react';
import {
  MAX_BATCH,
  type DownloadList,
  type DownloadSong,
} from '../../../shared/schemas/downloads';
import { setUi } from '../../app/ui';
import { isFile, type Playable } from '../player/player';

/** A song wavebit streams and has no file for. */
export const canDownload = (t: Playable): boolean =>
  !isFile(t.id) && !!(t.stream?.videoId || t.stream?.match) && !!t.title.trim();

const toSong = (t: Playable): DownloadSong => ({
  videoId: t.stream?.videoId ?? null,
  match: t.stream?.match ?? null,
  title: t.title.trim().slice(0, 300),
  artist: t.artist.slice(0, 400),
  album: t.album.slice(0, 300),
  artwork: t.artwork && t.artwork.length <= 4096 ? t.artwork : null,
  durationMs: Math.min(Math.round(t.durationMs), 24 * 60 * 60 * 1000),
});

/** Sends the songs in batches the main process accepts. */
export async function queueSongs(
  tracks: Playable[],
  list: DownloadList | null,
): Promise<{ added: number; skipped: number; wanted: number }> {
  const wanted = tracks.filter(canDownload).map(toSong);
  let added = 0;
  let skipped = 0;
  for (let i = 0; i < wanted.length; i += MAX_BATCH) {
    const part = await window.wavebit.downloads.add(
      wanted.slice(i, i + MAX_BATCH),
      list,
    );
    added += part.added;
    skipped += part.skipped;
  }
  return { added, skipped, wanted: wanted.length };
}

const songs = (n: number) =>
  `${n.toLocaleString()} ${n === 1 ? 'song' : 'songs'}`;

/** Queues the songs and says what happened; the drawer shows the rest. */
export async function downloadSongs(
  tracks: Playable[],
  label: string,
  list: DownloadList | null = null,
): Promise<void> {
  try {
    const { added, skipped, wanted } = await queueSongs(tracks, list);
    if (wanted === 0) {
      toast(`“${label}” is already on this device`);
      return;
    }
    if (added === 0) {
      toast(`“${label}” is already downloaded or queued`);
      return;
    }
    toast(
      wanted === 1
        ? `Downloading “${label}”`
        : `Downloading ${songs(added)} from “${label}”`,
      {
        description: skipped ? `${songs(skipped)} already there` : undefined,
        actionProps: {
          children: 'View',
          onPress: () => setUi({ downloads: true }),
        },
      },
    );
  } catch {
    toast(`Couldn’t download “${label}”`);
  }
}
