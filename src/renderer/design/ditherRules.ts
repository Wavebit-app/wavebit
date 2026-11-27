/**
 * Ordered dithering for `DitherShader.tsx`: pure, so it is tested without a
 * canvas. Every cell becomes one of two colours, chosen by comparing its
 * brightness with a Bayer matrix, which turns gradients into the regular
 * cross-hatch of old screens and printers.
 */

/** The 8×8 Bayer matrix, values 0 to 63. */
export const BAYER_8: readonly number[] = (() => {
  const out: number[] = Array.from({ length: 64 }, () => 0);
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      // Bit-reversal interleave of x ^ y and y: the classic construction.
      const v = x ^ y;
      out[y * 8 + x] =
        ((v & 1) << 5) |
        ((y & 1) << 4) |
        ((v & 2) << 2) |
        ((y & 2) << 1) |
        ((v & 4) >> 1) |
        ((y & 4) >> 2);
    }
  return out;
})();

/** #rgb or #rrggbb as [r, g, b], or null. */
export function parseHex(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join('') : m[1]!;
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

export type ColorMode = 'duotone' | 'grayscale';

/**
 * Dithers RGBA pixels in place. `threshold` (0 to 1) moves the cut: higher
 * makes more cells dark. Transparent pixels count as dark.
 */
export function dither(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  options: {
    threshold: number;
    colorMode: ColorMode;
    primary: [number, number, number];
    secondary: [number, number, number];
  },
): void {
  const dark =
    options.colorMode === 'grayscale' ? ([0, 0, 0] as const) : options.primary;
  const light =
    options.colorMode === 'grayscale'
      ? ([255, 255, 255] as const)
      : options.secondary;
  const shift = 0.5 - Math.min(1, Math.max(0, options.threshold));
  for (let y = 0; y < height; y++) {
    const row = (y & 7) * 8;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const a = pixels[i + 3]! / 255;
      const lum =
        ((0.2126 * pixels[i]! +
          0.7152 * pixels[i + 1]! +
          0.0722 * pixels[i + 2]!) /
          255) *
        a;
      const cut = (BAYER_8[row + (x & 7)]! + 0.5) / 64;
      const c = lum + shift > cut ? light : dark;
      pixels[i] = c[0];
      pixels[i + 1] = c[1];
      pixels[i + 2] = c[2];
      pixels[i + 3] = 255;
    }
  }
}
