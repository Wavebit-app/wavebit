import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  artworkSurfaces,
  contrast,
  meshBackground,
  meshColors,
  pickColors,
  vividest,
  type Rgb,
} from './artPalette.ts';

const fromHex = (hex: string): Rgb => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

/** Covers at the extremes, the ones most likely to break contrast. */
const COVERS: Rgb[] = [
  [255, 255, 255],
  [255, 255, 0],
  [0, 255, 255],
  [255, 0, 255],
  [255, 0, 0],
  [0, 255, 0],
  [0, 0, 255],
  [128, 128, 128],
  [0, 0, 0],
  [226, 114, 91],
];

/** Secondary text as the full-screen player's mesh strengthens it, per theme. */
const MESH_MUTED_DARK: Rgb[] = [
  [210, 210, 213],
  [220, 220, 222],
  [222, 223, 226],
];
const MESH_MUTED_LIGHT: Rgb = [53, 55, 58];
/** The dimmest accent in dark themes (blue), and the Artwork theme's text. */
const ACCENT_DARK: Rgb = [127, 149, 255];
const ARTWORK_MUTED: Rgb = [194, 197, 205];
const INK_DARK: Rgb = [241, 241, 243];

const pixels = (...colors: Rgb[]) =>
  colors.flatMap((c) => [c[0], c[1], c[2], 255]);

test('picks the most present colour first', () => {
  const data = pixels(...Array<Rgb>(9).fill([200, 40, 40]), [40, 40, 200]);
  const [first] = pickColors(data, 2);
  assert.ok(first![0] > first![2]);
});

test('a mostly black cover still gives its colour first', () => {
  const data = pixels(...Array<Rgb>(30).fill([8, 8, 9]), [150, 90, 50]);
  const [first] = pickColors(data, 2);
  assert.ok(first![0] > 100);
});

test('skips see-through pixels', () => {
  assert.deepEqual(pickColors([255, 0, 0, 0], 3), []);
});

test('a plain cover still fills the mesh', () => {
  const picked = pickColors(pixels([200, 40, 40], [200, 40, 40]), 3);
  assert.equal(picked.length, 3);
});

test('text and controls hold contrast on any dark mesh', () => {
  for (const cover of COVERS)
    for (const hex of meshColors([cover, cover, cover], true)) {
      for (const muted of MESH_MUTED_DARK)
        assert.ok(contrast(fromHex(hex), muted) >= 4.5, `${hex} text`);
      assert.ok(contrast(fromHex(hex), ACCENT_DARK) >= 3, `${hex} accent`);
    }
});

test('secondary text holds AA on any light mesh', () => {
  for (const cover of COVERS)
    for (const hex of meshColors([cover], false))
      assert.ok(contrast(fromHex(hex), MESH_MUTED_LIGHT) >= 4.5, `${hex}`);
});

test('a muted cover gives a rich mesh in its own hue', () => {
  // Faded brown: the mesh must be clearly coloured, with red leading blue.
  const [hex] = meshColors([[120, 100, 85]], true);
  const [r, g, b] = fromHex(hex!);
  assert.ok(r > b + 40, `${hex} should read as brown`);
  assert.ok(r > g);
});

test('a grey part of a colourful cover takes its hue', () => {
  const [, grey] = meshColors(
    [
      [150, 90, 50],
      [56, 55, 50],
    ],
    true,
  );
  const [r, , b] = fromHex(grey!);
  assert.ok(r > b + 25, `${grey} should follow the cover`);
});

test('a grey cover stays grey', () => {
  const [hex] = meshColors([[128, 128, 128]], true);
  const [r, , b] = fromHex(hex!);
  assert.ok(Math.abs(r - b) < 12, `${hex} should be neutral`);
});

test('the mesh names all three colours', () => {
  const css = meshBackground(['#111111', '#222222', '#333333']);
  for (const hex of ['#111111', '#222222', '#333333'])
    assert.ok(css.includes(hex));
});

test('Artwork theme text holds AA on every surface, for any cover', () => {
  for (const cover of COVERS) {
    const s = artworkSurfaces(cover);
    for (const name of ['canvas', 'sunken', 'surface', 'raised'] as const) {
      const ground = fromHex(s[name]);
      assert.ok(contrast(ground, INK_DARK) >= 7, `ink on ${name}`);
      assert.ok(contrast(ground, ARTWORK_MUTED) >= 4.5, `muted on ${name}`);
      assert.ok(contrast(ground, ACCENT_DARK) >= 3, `accent on ${name}`);
    }
  }
});

test('a muted cover clearly tints the Artwork theme', () => {
  const s = artworkSurfaces([120, 100, 85]);
  const [r, , b] = fromHex(s.surface);
  assert.ok(r - b >= 18, `${s.surface} should be visibly brown`);
});

test('the most colourful colour is chosen for the tint', () => {
  const dull: Rgb = [120, 118, 116];
  const vivid: Rgb = [150, 60, 40];
  assert.deepEqual(vividest([dull, vivid]), vivid);
});
