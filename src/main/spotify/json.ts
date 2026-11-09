/** Tolerant readers for Spotify's JSON: a wrong shape becomes null, never a crash. */
export type Json = Record<string, unknown>;

export const obj = (v: unknown): Json | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null;
export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const str = (v: unknown): string | null =>
  typeof v === 'string' ? v : null;
export const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
export const at = (v: unknown, ...keys: string[]): unknown =>
  keys.reduce<unknown>((o, k) => obj(o)?.[k], v);

/**
 * Only https URLs on Spotify's own CDNs reach the renderer: the same hosts
 * CSP allows (`*.scdn.co`, `*.spotifycdn.com`), so a changed response can
 * never point the page somewhere else.
 */
/** The 22-character id in a Spotify URI or bare id, or null for anything else. */
export function spotifyId(value: unknown): string | null {
  const id = str(value)?.split(':').pop();
  return id && /^[A-Za-z0-9]{22}$/.test(id) ? id : null;
}

export function cdnUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const { protocol, hostname, username, password } = new URL(url);
    return protocol === 'https:' &&
      !username &&
      !password &&
      (hostname.endsWith('.scdn.co') || hostname.endsWith('.spotifycdn.com'))
      ? url
      : null;
  } catch {
    return null;
  }
}

/**
 * The smallest image at least `min` wide, else the widest (BitChord's
 * `sized()`): sizes arrive in no fixed order, and rows don't need 640px.
 */
export function sized(sources: unknown, min = 300): string | null {
  const list = arr(sources)
    .map((s) => ({
      url: cdnUrl(str(at(s, 'url'))),
      width: num(at(s, 'width')) ?? 0,
    }))
    .filter((s): s is { url: string; width: number } => !!s.url)
    .sort((a, b) => a.width - b.width);
  return (list.find((s) => s.width >= min) ?? list.at(-1))?.url ?? null;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/**
 * A playlist description as plain text. Spotify sends HTML (links, `&amp;`,
 * `&#x27;`); the renderer only ever shows text, so tags are dropped here.
 */
export function plainText(html: unknown, max = 500): string | null {
  const raw = str(html);
  if (!raw) return null;
  const text = raw
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
      if (code[0] !== '#') return ENTITIES[code.toLowerCase()] ?? whole;
      const n =
        code[1]?.toLowerCase() === 'x'
          ? parseInt(code.slice(2), 16)
          : parseInt(code.slice(1), 10);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
    })
    // Control characters (bidi overrides included) never reach the page.
    // oxlint-disable-next-line no-control-regex -- matching them is the point
    .replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? text.slice(0, max) : null;
}

/** An ISO time as epoch ms; Spotify's own playlists say 1970, which means unknown. */
export function time(iso: unknown): number | null {
  const ms = Date.parse(str(iso) ?? '');
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

/** Spotify's largest page (100 playlist rows) is well under this. */
const MAX_BODY = 8 * 1024 * 1024;

/** The body as text, or null past MAX_BODY, reading no further than that. */
export async function boundedText(response: Response): Promise<string | null> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** A response body as a JSON object (an array as `{ values }`), or null; bodies over 8 MB are refused unread. */
export async function readJson(response: Response): Promise<Json | null> {
  const declared = Number(response.headers.get('Content-Length'));
  if (declared > MAX_BODY) {
    await response.body?.cancel().catch(() => {});
    return null;
  }
  // Content-Length can be absent or wrong, so the cap is on what really arrives.
  const text = await boundedText(response).catch(() => null);
  if (text === null) return null;
  try {
    const value: unknown = JSON.parse(text);
    // A bare array (GET /me/library/contains) arrives as `{ values: [...] }`.
    return Array.isArray(value) ? { values: value } : obj(value);
  } catch {
    return null;
  }
}
