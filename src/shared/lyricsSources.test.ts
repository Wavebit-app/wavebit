import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_LYRICS_ORDER,
  enabledSources,
  orderedSources,
} from './lyricsSources.ts';

test('a saved order is kept', () => {
  const saved = [...DEFAULT_LYRICS_ORDER].reverse();
  assert.deepEqual(orderedSources(saved), saved);
});

test('unknown and repeated ids are dropped', () => {
  const order = orderedSources(['gone', 'lrclib', 'lrclib', 'kugou']);
  assert.equal(order.includes('gone' as never), false);
  assert.equal(order.filter((id) => id === 'lrclib').length, 1);
  assert.equal(order.length, DEFAULT_LYRICS_ORDER.length);
});

test('a new source lands after the one listed before it', () => {
  const saved = DEFAULT_LYRICS_ORDER.filter((id) => id !== 'bini');
  const order = orderedSources(saved);
  assert.equal(order.indexOf('bini'), order.indexOf('lrc-red') + 1);
});

test('a new first source goes to the top', () => {
  const saved = DEFAULT_LYRICS_ORDER.filter((id) => id !== 'lrc-red');
  assert.equal(orderedSources(saved)[0], 'lrc-red');
});

test('switched-off sources are not asked', () => {
  const on = enabledSources(DEFAULT_LYRICS_ORDER, ['lrclib', 'kugou']);
  assert.equal(on.includes('lrclib'), false);
  assert.equal(on.includes('kugou'), false);
  assert.equal(on[0], 'lrc-red');
});

test('everything off leaves nothing to ask', () => {
  assert.deepEqual(
    enabledSources(DEFAULT_LYRICS_ORDER, [...DEFAULT_LYRICS_ORDER]),
    [],
  );
});
