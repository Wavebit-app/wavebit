import Store from 'electron-store';
import type {
  Listened,
  ListeningSummary,
  ListenRow,
} from '../../shared/schemas/library';
import { addListen, summarize } from './listeningRules';

interface ListeningFile {
  songs: Record<string, ListenRow>;
}

// Opened on first use, so a test profile set in main.ts applies before the path is read.
let opened: Store<ListeningFile> | null = null;
const store = () =>
  (opened ??= new Store<ListeningFile>({
    name: 'listening',
    defaults: { songs: {} },
    clearInvalidConfig: true,
  }));

/** All-time listening, one row per song. Stays on this computer. */
export function recordListened(report: Listened): void {
  const songs = store().get('songs');
  addListen(songs, report, Date.now());
  store().set('songs', songs);
}

export function listeningSummary(): ListeningSummary {
  return summarize(Object.values(store().get('songs')));
}
