import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gainFor } from './gain.ts';

test('a loud master is turned down to the target', () => {
  // -8 LUFS to -14 is -6 dB, a gain of about 0.5.
  assert.ok(Math.abs(gainFor({ lufs: -8, peak: 1 }, 'normal') - 0.501) < 0.01);
});

test('a quiet song is boosted only as far as its peak allows', () => {
  // -20 LUFS wants +6 dB (x2), but a 0.8 peak caps the boost at 0.99 / 0.8.
  assert.ok(
    Math.abs(gainFor({ lufs: -20, peak: 0.8 }, 'normal') - 0.99 / 0.8) < 1e-9,
  );
  assert.ok(
    Math.abs(gainFor({ lufs: -20, peak: 0.25 }, 'normal') - 1.995) < 0.01,
  );
});

test('unknown loudness leaves the song as it is', () => {
  assert.equal(gainFor({ lufs: undefined, peak: undefined }, 'loud'), 1);
});
