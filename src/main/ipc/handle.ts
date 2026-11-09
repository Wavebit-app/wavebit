import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import type { z } from 'zod';
import type { EventPayloads } from '../../shared/ipc/api';
import { AppError } from '../../shared/errors';
import { isTrustedOrigin } from '../security/protocol';

/**
 * Registers a handler that rejects foreign frames and validates its input
 * before running. Only `wavebit:<code>` errors cross to the page: a bad input
 * or an unexpected failure (whose message may hold a file path or SQL) is
 * logged here and sent as `wavebit:failed`.
 */
export function handle<S extends z.ZodType, R>(
  channel: string,
  schema: S,
  run: (input: z.infer<S>, event: IpcMainInvokeEvent) => R | Promise<R>,
): void {
  ipcMain.handle(channel, async (event: IpcMainInvokeEvent, raw: unknown) => {
    const frameUrl = event.senderFrame?.url;
    if (!frameUrl || event.senderFrame?.parent || !isTrustedOrigin(frameUrl))
      throw new Error(
        `Rejected ${channel} from ${frameUrl ?? 'unknown frame'}`,
      );
    const input = schema.safeParse(raw);
    if (!input.success) {
      console.warn(`ipc: rejected input for ${channel}`);
      throw new AppError('failed');
    }
    try {
      return await run(input.data, event);
    } catch (error) {
      if (error instanceof AppError) throw error;
      console.error(`ipc: ${channel} failed`, error);
      throw new AppError('failed');
    }
  });
}

let target: WebContents | null = null;

/** Events go to the app window only, never to a Spotify window. */
export function setEventTarget(contents: WebContents | null): void {
  target = contents;
}

export function emit<E extends keyof EventPayloads>(
  event: E,
  payload: EventPayloads[E],
): void {
  if (target && !target.isDestroyed()) target.send(event, payload);
}
