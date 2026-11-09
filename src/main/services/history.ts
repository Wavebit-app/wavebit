import Store from 'electron-store';
import type { HistoryEntry, PlayedSong } from '../../shared/schemas/library';

const MAX_ENTRIES = 100;

interface HistoryFile {
  plays: HistoryEntry[];
}

// Opened on first use, so a test profile set in main.ts applies before the path is read.
let opened: Store<HistoryFile> | null = null;
const store = () =>
  (opened ??= new Store<HistoryFile>({
    name: 'history',
    defaults: { plays: [] },
    clearInvalidConfig: true,
  }));

/** What wavebit has played, newest first, one entry per song. Stays on this computer. */
export function playHistory(): HistoryEntry[] {
  return store().get('plays');
}

export function recordPlayed(song: PlayedSong): void {
  const rest = playHistory().filter((p) => p.id !== song.id);
  store().set(
    'plays',
    [{ ...song, playedAt: Date.now() }, ...rest].slice(0, MAX_ENTRIES),
  );
}
