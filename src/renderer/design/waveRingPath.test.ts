import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  RING_RADIUS,
  shownProgress,
  waveAmplitude,
  wavePath,
} from './waveRingPath.ts';

test('the wave is flat at both ends and full in the middle', () => {
  assert.equal(waveAmplitude(0), 0);
  assert.equal(waveAmplitude(1), 0);
  assert.equal(waveAmplitude(0.5), 3.4);
  assert.ok(waveAmplitude(0.05) < 3.4);
});

test('a flat ring stays on its radius and inside the box', () => {
  for (const [, x, y] of wavePath(10, 0).matchAll(/[ML]([\d.]+) ([\d.]+)/g)) {
    const r = Math.hypot(Number(x) - 50, Number(y) - 50);
    assert.ok(Math.abs(r - RING_RADIUS) < 0.02);
  }
});

test('a wavy ring never leaves the box', () => {
  for (const [, x, y] of wavePath(10, 3.4).matchAll(/[ML]([\d.]+) ([\d.]+)/g))
    assert.ok(Math.hypot(Number(x) - 50, Number(y) - 50) < 50);
});

test('a running download always shows a sliver', () => {
  assert.equal(shownProgress(0, true), 0.02);
  assert.equal(shownProgress(0, false), 0);
  assert.equal(shownProgress(2, true), 1);
});
