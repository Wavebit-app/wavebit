/** What the search pill remembers. Pure, so it can be tested. */

export const MAX_RECENT = 20;
export const MAX_LENGTH = 100;

// Typed text only: a control character never comes from the keyboard's letters.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

/** The search as it is kept: trimmed, single-spaced, or null when it can't be kept. */
function tidy(query: unknown): string | null {
  if (typeof query !== 'string' || CONTROL.test(query)) return null;
  const text = query.trim().replace(/\s+/g, ' ');
  return text && text.length <= MAX_LENGTH ? text : null;
}

/** The list with `query` first. The same words in other capitals count as one search. */
export function withSearch(list: string[], query: string): string[] {
  const text = tidy(query);
  if (!text) return list;
  const lower = text.toLowerCase();
  return [text, ...list.filter((s) => s.toLowerCase() !== lower)].slice(
    0,
    MAX_RECENT,
  );
}

/** Reads what was saved. Storage is untrusted: anything unexpected is dropped. */
export function parseSearches(raw: string | null): string[] {
  let saved: unknown;
  try {
    saved = JSON.parse(raw ?? '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(saved)) return [];
  // Oldest first, so the newest ends up on top and wins a duplicate.
  return saved
    .slice(0, MAX_RECENT)
    .reverse()
    .reduce<string[]>(
      (list, entry) => (tidy(entry) ? withSearch(list, entry as string) : list),
      [],
    );
}
