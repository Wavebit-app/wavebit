import { Channels } from '../../shared/ipc/channels';
import { LyricsQuerySchema } from '../../shared/schemas/lyrics';
import { lyrics } from '../lyrics/repository';
import { handle } from './handle';

export function registerLyricsIpc(): void {
  handle(Channels.lyricsGet, LyricsQuerySchema, (song) => lyrics(song));
}
