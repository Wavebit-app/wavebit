/** For a card that came without YouTube's colour: muted, never neon (BitChord's eight). */
const FALLBACK = [
  '#cc6a55',
  '#c07a92',
  '#9c8ac0',
  '#8090c8',
  '#d0a060',
  '#6a88b0',
  '#7aaed0',
  '#86b890',
];

const channels = (hex: string) =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

const linear = (c: number) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

export function whiteContrast(rgb: number[]): number {
  const [r = 0, g = 0, b = 0] = rgb.map(linear);
  return 1.05 / (0.2126 * r + 0.7152 * g + 0.0722 * b + 0.05);
}

/**
 * The card's colour, darkened only as far as white text needs. YouTube's
 * palette is pale (white on its green is 1.2:1), and a cover tinted by
 * multiplying can only get darker, so white stays readable across the card.
 */
export function moodTone(color: string | null, title: string): string {
  let hash = 0;
  for (const ch of title) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  let rgb = channels(color ?? FALLBACK[hash % FALLBACK.length]!);
  while (whiteContrast(rgb) < 4.6) rgb = rgb.map((c) => c * 0.97);
  return `#${rgb
    .map((c) => Math.round(c).toString(16).padStart(2, '0'))
    .join('')}`;
}
