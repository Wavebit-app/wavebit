import { z } from 'zod';
import { Channels } from '../../shared/ipc/channels';
import { DiscordPlaybackSchema } from '../../shared/schemas/discord';
import {
  discordStatus,
  publishPlayback,
  retryDiscord,
} from '../discord/presence';
import { handle } from './handle';

const NoInput = z.undefined();

export function registerDiscordIpc(): void {
  handle(Channels.discordStatus, NoInput, () => discordStatus());
  handle(Channels.discordPublish, DiscordPlaybackSchema.nullable(), (value) => {
    publishPlayback(value);
  });
  handle(Channels.discordRetry, NoInput, () => retryDiscord());
}
