import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copyName, overBudget, parseIndex } from './offlineRules.ts';

test('parseIndex keeps only well-formed entries', () => {
  const index = parseIndex({
    dQw4w9WgXcQ: { bytes: 4_000_000, usedAt: 10 },
    'not-an-id': { bytes: 1, usedAt: 1 },
    'kJQP7kiw5F/': { bytes: 1, usedAt: 1 },
    fJ9rUzIMcZQ: { bytes: -5, usedAt: 1 },
    '9bZkp7q19f0': { bytes: 1.5, usedAt: 1 },
    J7p4bzqLvCw: { bytes: 10, usedAt: 'yesterday' },
    '5G-rzr2FxTw': { bytes: 999_999_999_999, usedAt: 1 },
  });
  assert.deepEqual([...index.keys()], ['dQw4w9WgXcQ']);
  assert.equal(parseIndex(null).size, 0);
  assert.equal(parseIndex([1, 2]).size, 0);
  assert.equal(parseIndex('x').size, 0);
});

test('overBudget removes the oldest copies until the rest fit', () => {
  const index = parseIndex({
    aaaaaaaaaaa: { bytes: 5, usedAt: 3 },
    bbbbbbbbbbb: { bytes: 5, usedAt: 1 },
    ccccccccccc: { bytes: 5, usedAt: 2 },
  });
  assert.deepEqual(overBudget(index, 15), []);
  assert.deepEqual(overBudget(index, 10), ['bbbbbbbbbbb']);
  assert.deepEqual(overBudget(index, 4), [
    'bbbbbbbbbbb',
    'ccccccccccc',
    'aaaaaaaaaaa',
  ]);
});

test('overBudget never removes the copy being played', () => {
  const index = parseIndex({
    aaaaaaaaaaa: { bytes: 5, usedAt: 3 },
    bbbbbbbbbbb: { bytes: 5, usedAt: 1 },
  });
  assert.deepEqual(overBudget(index, 5, 'bbbbbbbbbbb'), ['aaaaaaaaaaa']);
});

test('copyName accepts only video ids', () => {
  assert.equal(copyName('dQw4w9WgXcQ'), 'dQw4w9WgXcQ.m4a');
  assert.throws(() => copyName('../../etc/x'));
  assert.throws(() => copyName('dQw4w9WgXc'));
});
