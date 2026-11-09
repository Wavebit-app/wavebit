import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BAND_HZ,
  BAND_LIMIT_DB,
  EQ_PRESETS,
  FLAT_BANDS,
  isSilent,
  preampGain,
  presetFor,
  stereoMatrix,
} from './audioEffects.ts';

test('every preset has one value per band, inside the limits', () => {
  for (const preset of EQ_PRESETS) {
    assert.equal(preset.bands.length, BAND_HZ.length, preset.name);
    for (const db of preset.bands)
      assert.ok(Math.abs(db) <= BAND_LIMIT_DB, preset.name);
  }
});

test('preset ids are unique', () => {
  assert.equal(new Set(EQ_PRESETS.map((p) => p.id)).size, EQ_PRESETS.length);
});

test('bands are named by their preset, and hand-made ones are not', () => {
  assert.equal(presetFor(FLAT_BANDS)?.id, 'flat');
  assert.equal(presetFor([3.5, 2, -1.5, -1, 1.5, 3, 3])?.id, 'rock');
  assert.equal(presetFor([1, 1, 1, 1, 1, 1, 1]), null);
});

test('the preamp takes back the largest boost and ignores cuts', () => {
  assert.equal(preampGain(FLAT_BANDS), 1);
  assert.equal(preampGain([-6, -6, 0, 0, 0, 0, 0]), 1);
  assert.ok(Math.abs(preampGain([6, 0, 0, 0, 0, 0, 0]) - 0.501) < 0.001);
});

test('off and centred passes the sound untouched', () => {
  assert.deepEqual(stereoMatrix(false, 0), { ll: 1, rl: 0, lr: 0, rr: 1 });
});

test('widening subtracts each channel from the other', () => {
  const m = stereoMatrix(true, 0);
  assert.ok(m.ll > 1);
  assert.ok(m.rl < 0);
  assert.equal(m.ll, m.rr);
});

test('balance quietens only the far side', () => {
  const right = stereoMatrix(false, 0.5);
  assert.equal(right.ll, 0.5);
  assert.equal(right.rr, 1);
  const left = stereoMatrix(false, -1);
  assert.equal(left.ll, 1);
  assert.equal(left.rr, 0);
});

test('silence is a peak below the threshold, anywhere in the block', () => {
  assert.equal(isSilent([0, 0.001, -0.002]), true);
  assert.equal(isSilent([0, 0.2, 0]), false);
  assert.equal(isSilent([0, -0.2, 0]), false);
});
