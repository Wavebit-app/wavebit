import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BAYER_8, dither, parseHex } from './ditherRules.ts';

test('the Bayer matrix holds every level once', () => {
  assert.deepEqual(
    [...BAYER_8].sort((a, b) => a - b),
    Array.from({ length: 64 }, (_, i) => i),
  );
  // Neighbours are far apart, which is what spreads the dots evenly.
  assert.equal(BAYER_8[0], 0);
  assert.deepEqual(BAYER_8.slice(0, 8), [0, 32, 8, 40, 2, 34, 10, 42]);
});

test('colours are read only from plain hex', () => {
  assert.deepEqual(parseHex('#1e3a5f'), [30, 58, 95]);
  assert.deepEqual(parseHex('#fff'), [255, 255, 255]);
  assert.equal(parseHex('red'), null);
  assert.equal(parseHex('#12345'), null);
  assert.equal(parseHex('url(x)'), null);
});

const solid = (value: number, alpha = 255, n = 64) => {
  const px = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) px.set([value, value, value, alpha], i * 4);
  return px;
};
const opts = {
  threshold: 0.5,
  colorMode: 'duotone' as const,
  primary: [1, 2, 3] as [number, number, number],
  secondary: [200, 201, 202] as [number, number, number],
};
const lightCells = (px: Uint8ClampedArray) => {
  let n = 0;
  for (let i = 0; i < px.length; i += 4) if (px[i] === 200) n++;
  return n;
};

test('black stays dark, white goes light, grey is half and half', () => {
  const black = solid(0);
  dither(black, 8, 8, opts);
  assert.equal(lightCells(black), 0);
  const white = solid(255);
  dither(white, 8, 8, opts);
  assert.equal(lightCells(white), 64);
  // 50% luminance (sRGB 128) lights about half the 8×8 cells.
  const grey = solid(128);
  dither(grey, 8, 8, opts);
  assert.ok(Math.abs(lightCells(grey) - 32) <= 1, String(lightCells(grey)));
  // Every cell ends up opaque, in one of the two colours.
  for (let i = 3; i < grey.length; i += 4) assert.equal(grey[i], 255);
});

test('a higher threshold darkens, and transparency counts as dark', () => {
  const lo = solid(128);
  const hi = solid(128);
  dither(lo, 8, 8, { ...opts, threshold: 0.3 });
  dither(hi, 8, 8, { ...opts, threshold: 0.7 });
  assert.ok(lightCells(lo) > lightCells(hi));
  const clear = solid(255, 0);
  dither(clear, 8, 8, opts);
  assert.equal(lightCells(clear), 0);
});
