/**
 * Text rules for the Discord card, shared so Settings' preview and counters
 * show exactly what the main process sends. Pure and tested.
 */

/** Discord's text fields hold 2 to 128 characters; button labels 1 to 32. */
export const TEXT_LIMIT = 128;
export const LABEL_LIMIT = 32;

/** Controls, bidi overrides and isolates, zero-width marks, the byte-order mark. */
const HIDDEN =
  // eslint-disable-next-line no-control-regex -- removing them is the point
  /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;

/** Hidden characters removed and runs of whitespace made one space. */
export function cleanText(value: string): string {
  // Whitespace first, so a line break between words leaves a space.
  return value
    .replace(/\s+/g, ' ')
    .replace(HIDDEN, '')
    .replace(/ {2,}/g, ' ')
    .trim();
}

const segmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

function graphemes(value: string): string[] {
  return segmenter
    ? Array.from(segmenter.segment(value), (s) => s.segment)
    : Array.from(value);
}

/** Length as Discord and the Rust check count it: code points. */
export const textLength = (value: string) => Array.from(value).length;

/** Cut to `max` code points at a grapheme boundary, ending in "…" when cut. */
export function cut(value: string, max: number): string {
  if (textLength(value) <= max) return value;
  let out = '';
  for (const g of graphemes(value)) {
    if (textLength(out) + textLength(g) > max - 1) break;
    out += g;
  }
  return `${out.trimEnd()}…`;
}

/** Discord refuses one-character text; a blank braille cell pads it invisibly. */
export function padShort(value: string): string {
  return textLength(value) === 1 ? `${value}\u2800` : value;
}

export interface LabelSong {
  title: string;
  artist: string;
  album: string;
}

export interface FilledLabel {
  /** What is sent. */
  text: string;
  /** The filled-in label's length before cutting. */
  length: number;
  cut: boolean;
}

/** A button label: variables filled in, cleaned, cut to 32. Empty falls back. */
export function fillLabel(
  template: string,
  fallback: string,
  song: LabelSong | null,
): FilledLabel {
  const filled = cleanText(
    (template.trim() || fallback)
      .replaceAll('{song_name}', song?.title ?? '')
      .replaceAll('{artist_name}', song?.artist ?? '')
      .replaceAll('{album_name}', song?.album ?? ''),
  );
  const full = filled || fallback;
  const length = textLength(full);
  return {
    text: cut(full, LABEL_LIMIT),
    length,
    cut: length > LABEL_LIMIT,
  };
}

/** The variables a label may use, in the order Settings offers them. */
export const LABEL_VARIABLES = [
  '{song_name}',
  '{artist_name}',
  '{album_name}',
] as const;
