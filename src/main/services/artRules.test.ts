import assert from 'node:assert/strict';
import { test } from 'node:test';
import { imageMime, overBudget } from './artRules.ts';

const bytes = (...b: number[]) => new Uint8Array(b);
const text = (s: string) => new TextEncoder().encode(s);

test('an image is known by its first bytes', () => {
  assert.equal(imageMime(bytes(0xff, 0xd8, 0xff, 0xe0)), 'image/jpeg');
  assert.equal(imageMime(bytes(0x89, 0x50, 0x4e, 0x47)), 'image/png');
  assert.equal(imageMime(text('GIF89a')), 'image/gif');
  assert.equal(imageMime(text('RIFF0000WEBPVP8 ')), 'image/webp');
});

test('anything else is refused, whatever it claims to be', () => {
  assert.equal(
    imageMime(text('<svg xmlns="http://www.w3.org/2000/svg">')),
    null,
  );
  assert.equal(imageMime(text('<!doctype html>')), null);
  assert.equal(imageMime(bytes()), null);
});

test('the cache drops the least recently used first', () => {
  const files = [
    { name: 'old', size: 60, mtimeMs: 1 },
    { name: 'new', size: 60, mtimeMs: 3 },
    { name: 'mid', size: 30, mtimeMs: 2 },
  ];
  assert.deepEqual(overBudget(files, 100), ['old']);
  assert.deepEqual(overBudget(files, 10), ['new', 'mid', 'old']);
  assert.deepEqual(overBudget(files, 1000), []);
});
