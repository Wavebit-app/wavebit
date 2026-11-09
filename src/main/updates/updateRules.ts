export interface LaunchState {
  lastVersion: string;
  /** What's new hasn't been pressed for the version that was installed. */
  unseen: boolean;
}

const numbers = (version: string) =>
  version.split('.').map((part) => Number.parseInt(part, 10) || 0);

export function isNewer(version: string, than: string): boolean {
  const [a, b] = [numbers(version), numbers(than)];
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

/** A first install has nothing to announce; only moving to a newer version does. */
export function nextLaunchState(
  stored: LaunchState | null,
  current: string,
): LaunchState {
  if (!stored) return { lastVersion: current, unseen: false };
  return {
    lastVersion: current,
    unseen: isNewer(current, stored.lastVersion) || stored.unseen,
  };
}

/** Squirrel.Mac refuses a bundle whose signature doesn't match the running app. */
export function isUnsignedMacError(message: string): boolean {
  return /code signature|did not pass validation|not signed/i.test(message);
}

export function errorKind(message: string): 'network' | 'failed' {
  return /net::|ENOTFOUND|ETIMEDOUT|ECONN|EAI_AGAIN|socket|timeout/i.test(
    message,
  )
    ? 'network'
    : 'failed';
}
