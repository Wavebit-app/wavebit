import type { ErrorCode } from './schemas/spotify';

const PREFIX = 'wavebit:';

/** Thrown in the main process; Electron sends only the message across IPC. */
export class AppError extends Error {
  constructor(readonly code: ErrorCode) {
    super(`${PREFIX}${code}`);
  }
}

/** The error code inside an IPC rejection, or null for anything else. */
export function errorCode(error: unknown): ErrorCode | null {
  const message = error instanceof Error ? error.message : String(error);
  const match = /wavebit:([a-z_]+)/.exec(message);
  return (match?.[1] as ErrorCode | undefined) ?? null;
}
