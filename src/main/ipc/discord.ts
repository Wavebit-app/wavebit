import { z } from 'zod';
import { Channels } from '../../shared/ipc/channels';
import { DiscordPlaybackSchema } from '../../shared/schemas/discord';
import {
  discordState,
  publishPlayback,
  retryDiscord,
  setDiscordPrivate,
} from '../discord/presence';
import { handle } from './handle';

const NoInput = z.undefined();

export function registerDiscordIpc(): void {
  handle(Channels.discordStatus, NoInput, () => discordState());
  handle(Channels.discordPublish, DiscordPlaybackSchema.nullable(), (value) => {
    publishPlayback(value);
  });
  handle(Channels.discordRetry, NoInput, () => retryDiscord());
  handle(Channels.discordSetPrivate, z.boolean(), (on) =>
    setDiscordPrivate(on),
  );
}
