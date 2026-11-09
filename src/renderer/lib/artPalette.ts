export type Rgb = readonly [number, number, number];

const linear = (c: number) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

export const luminance = ([r, g, b]: Rgb): number =>
  0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);

export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

export const toHex = (rgb: Rgb): string =>
  `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;

const mix = (a: Rgb, b: Rgb, amount: number): Rgb =>
  a.map((c, i) => c + (b[i]! - c) * amount) as unknown as Rgb;

const BLACK: Rgb = [0, 0, 0];
const distance = (a: Rgb, b: Rgb) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const DISTINCT = 60;

/** A cover's most present colours, from RGBA pixels: vivid ones count for more than grey. */
export function pickColors(pixels: ArrayLike<number>, count = 3): Rgb[] {
  const buckets = new Map<
    number,
    { sum: [number, number, number]; weight: number }
  >();
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3]! < 128) continue;
    const [r, g, b] = [pixels[i]!, pixels[i + 1]!, pixels[i + 2]!];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const [high, low] = [Math.max(r, g, b), Math.min(r, g, b)];
    // Shadows and paper count for little, so a dark cover's real colour shows.
    const weight = high < 48 || low > 215 ? 0.02 : 0.25 + (high - low) / 255;
    const bucket = buckets.get(key) ?? { sum: [0, 0, 0], weight: 0 };
    bucket.sum[0] += r * weight;
    bucket.sum[1] += g * weight;
    bucket.sum[2] += b * weight;
    bucket.weight += weight;
    buckets.set(key, bucket);
  }
  const ranked = [...buckets.values()]
    .sort((a, b) => b.weight - a.weight)
    .map(
      ({ sum, weight }): Rgb => [
        sum[0] / weight,
        sum[1] / weight,
        sum[2] / weight,
      ],
    );
  const chosen: Rgb[] = [];
  for (const color of ranked) {
    if (chosen.length === count) break;
    if (chosen.every((c) => distance(c, color) >= DISTINCT)) chosen.push(color);
  }
  if (chosen.length === 0) return [];
  // A plain cover has one colour; shades of it fill the mesh.
  while (chosen.length < count)
    chosen.push(mix(chosen[0]!, BLACK, 0.3 * chosen.length));
  return chosen;
}

function toHsl([r, g, b]: Rgb): [number, number, number] {
  const [red, green, blue] = [r / 255, g / 255, b / 255];
  const high = Math.max(red, green, blue);
  const low = Math.min(red, green, blue);
  const lightness = (high + low) / 2;
  const range = high - low;
  if (range === 0) return [0, 0, lightness];
  const saturation = range / (1 - Math.abs(2 * lightness - 1));
  let hue: number;
  if (high === red) hue = ((green - blue) / range) % 6;
  else if (high === green) hue = (blue - red) / range + 2;
  else hue = (red - green) / range + 4;
  return [(hue * 60 + 360) % 360, saturation, lightness];
}

function fromHsl(hue: number, saturation: number, lightness: number): Rgb {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const channel = (n: number) => {
    const k = (n + hue / 30) % 12;
    return (
      255 * (lightness - (chroma / 2) * Math.max(-1, Math.min(k - 3, 9 - k, 1)))
    );
  };
  return [channel(0), channel(8), channel(4)];
}

/** Below this a cover is really grey, and inventing a hue for it would be wrong. */
const GREY_SATURATION = 0.08;

/** A washed-out colour made rich enough to read as its hue. A grey stays grey. */
const enriched = (saturation: number, least: number) =>
  saturation < GREY_SATURATION ? saturation : Math.max(saturation, least);

/** The most colourful of a cover's main colours. */
export function vividest(colors: readonly Rgb[]): Rgb {
  return colors.reduce((best, color) =>
    toHsl(color)[1] > toHsl(best)[1] ? color : best,
  );
}

/** The lightness nearest `from` that passes, searching toward `to`. */
function lightnessThat(
  passes: (lightness: number) => boolean,
  from: number,
  to: number,
): number {
  let [failing, passing] = [from, to];
  if (passes(from)) return from;
  for (let i = 0; i < 16; i++) {
    const middle = (failing + passing) / 2;
    if (passes(middle)) passing = middle;
    else failing = middle;
  }
  return passing;
}

/**
 * How far a mesh can go and stay readable under the full-screen player's
 * stronger secondary text and accent controls (3:1 for those, 4.5:1 for text).
 */
export const MESH_MAX_DARK = 0.075;
export const MESH_MIN_LIGHT = 0.68;
/** The mesh's deepest colour is its base, so its corners stand out. */
const MESH_DEPTH = [1, 0.8, 0.5];
const MESH_SATURATION = 0.68;

/** Each colour keeps its hue and is made rich, as bright as text allows. */
export function meshColors(colors: readonly Rgb[], dark: boolean): string[] {
  // A grey corner of a colourful cover takes the cover's hue, not a dull patch.
  const [leadHue, leadSaturation] = toHsl(vividest(colors));
  return colors.map((color, i) => {
    const [ownHue, ownSaturation] = toHsl(color);
    const grey = ownSaturation < GREY_SATURATION;
    const hue = grey ? leadHue : ownHue;
    const rich = enriched(
      grey ? leadSaturation : ownSaturation,
      MESH_SATURATION,
    );
    const lum = (l: number) => luminance(fromHsl(hue, rich, l));
    const lightness = dark
      ? lightnessThat(
          (l) => lum(l) <= MESH_MAX_DARK * (MESH_DEPTH[i] ?? 0.5),
          0.5,
          0,
        )
      : lightnessThat((l) => lum(l) >= MESH_MIN_LIGHT, 0.5, 1);
    return toHex(fromHsl(hue, rich, lightness));
  });
}

/** A still mesh: one colour in each of three corners, on the deepest of them. */
export function meshBackground(colors: readonly string[]): string {
  const [a, b, c] = colors;
  return [
    `radial-gradient(60% 80% at 12% 18%, ${a}, transparent 70%)`,
    `radial-gradient(70% 90% at 88% 22%, ${b}, transparent 72%)`,
    `radial-gradient(90% 90% at 50% 100%, ${c}, transparent 75%)`,
    c,
  ].join(', ');
}

/** The Artwork theme's lightness for each surface, deepest first. */
const SURFACES = {
  canvas: 0.07,
  sunken: 0.095,
  surface: 0.12,
  'default-hover': 0.15,
  raised: 0.18,
  line: 0.2,
  'line-strong': 0.32,
} as const;
const SURFACE_SATURATION = 0.55;
/** Past this, a loud cover's surfaces get too bright for text. */
const SURFACE_SATURATION_MAX = 0.65;

export type ArtworkSurface = keyof typeof SURFACES;

/** Dark surfaces in the hue of a cover's colour (the Artwork theme). */
export function artworkSurfaces(color: Rgb): Record<ArtworkSurface, string> {
  const [hue, saturation] = toHsl(color);
  const rich = Math.min(
    enriched(saturation, SURFACE_SATURATION),
    SURFACE_SATURATION_MAX,
  );
  const out = {} as Record<ArtworkSurface, string>;
  for (const name of Object.keys(SURFACES) as ArtworkSurface[])
    out[name] = toHex(fromHsl(hue, rich, SURFACES[name]));
  return out;
}
