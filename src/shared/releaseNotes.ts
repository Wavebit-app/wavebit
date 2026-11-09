import type { ReleaseNotesSection } from './schemas/updates';

const MAX_SECTIONS = 8;
const MAX_ITEMS = 40;
const MAX_ITEM_CHARS = 300;

/** Markdown to plain text: no markup from a release ever reaches a page. */
function plain(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_~<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_ITEM_CHARS);
}

/**
 * A release body as sections of plain lines: `## Heading`, then `- item`
 * lines. Anything else (a Full Changelog link, a stray paragraph) is left out.
 */
export function parseReleaseNotes(body: string): ReleaseNotesSection[] {
  const sections: ReleaseNotesSection[] = [];
  let current: ReleaseNotesSection | null = null;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    const heading = /^#{1,6}\s+(.+)$/.exec(line);
    if (heading) {
      current = { title: plain(heading[1] ?? ''), items: [] };
      sections.push(current);
      continue;
    }
    const item = /^[-*+]\s+(.+)$/.exec(line);
    if (!item) continue;
    current ??= sections[sections.push({ title: '', items: [] }) - 1] ?? null;
    const text = plain(item[1] ?? '');
    if (text && current && current.items.length < MAX_ITEMS)
      current.items.push(text);
  }
  return sections.filter((s) => s.items.length > 0).slice(0, MAX_SECTIONS);
}
