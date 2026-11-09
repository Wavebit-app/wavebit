const number = new Intl.NumberFormat();

export function count(n: number, one: string, many = `${one}s`): string {
  return `${number.format(n)} ${n === 1 ? one : many}`;
}

/** 3:51, or 1:02:09 past an hour. */
export function clock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** "3 days, 4 hours", "2 h 38 min" or "44 min". */
export function length(ms: number, long = false): string {
  const minutes = Math.round(ms / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `${count(days, 'day')}, ${count(hours, 'hour')}`;
  if (hours > 0)
    return long
      ? `${count(hours, 'hour')}, ${mins} min`
      : `${hours} h ${mins} min`;
  return `${mins} min`;
}

export function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 5) return 'Good night';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

const day = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
export function date(secs: number): string {
  return day.format(new Date(secs * 1000));
}

export function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter((w) => /^[\p{L}\p{N}]/u.test(w) && !/^the$/i.test(w))
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join('') || '?'
  );
}

export const artUrl = (albumKey: string) => `media://art/${albumKey}`;

/** A remote cover through the main process's disk cache (artCache.ts); files pass through. */
export function cachedArt(url: string): string {
  if (!url.startsWith('https://')) return url;
  try {
    const encoded = btoa(url)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    return `media://remote/${encoded}`;
  } catch {
    return url;
  }
}
export const trackUrl = (id: string) => `media://track/${id}`;

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

/** When a song was added to a playlist: "yesterday", "3 days ago", then the date. */
export function added(ms: number, now = Date.now()): string {
  const days = Math.floor((now - ms) / 86_400_000);
  if (days < 0) return date(ms / 1000);
  if (days < 7) return relative.format(-days, 'day');
  return date(ms / 1000);
}
