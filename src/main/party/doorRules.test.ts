import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shut, SHUT_MS, stillShut } from './doorRules.ts';

const NOW = 1_800_000_000_000;

test('a door shuts for a day and then opens', () => {
  const doors = shut({}, 'K7M2QX', NOW);
  assert.deepEqual(Object.keys(stillShut(doors, NOW + 1)), ['K7M2QX']);
  assert.deepEqual(Object.keys(stillShut(doors, NOW + SHUT_MS - 1)), [
    'K7M2QX',
  ]);
  assert.deepEqual(stillShut(doors, NOW + SHUT_MS), {});
});

test('shutting one door keeps the others and drops the ones that opened', () => {
  const first = shut({}, 'AAAAAA', NOW);
  const later = shut(first, 'BBBBBB', NOW + SHUT_MS - 5);
  assert.deepEqual(Object.keys(later).sort(), ['AAAAAA', 'BBBBBB']);
  assert.deepEqual(Object.keys(shut(later, 'CCCCCC', NOW + SHUT_MS)).sort(), [
    'BBBBBB',
    'CCCCCC',
  ]);
});

test('what is read from disk is not trusted', () => {
  assert.deepEqual(stillShut(null, NOW), {});
  assert.deepEqual(stillShut('K7M2QX', NOW), {});
  assert.deepEqual(
    stillShut(
      {
        k7m2qx: NOW + 5,
        'K7M2QX!': NOW + 5,
        TOOLONG1: NOW + 5,
        STRING: 'soon',
        // Further off than a day: a clock that was wrong when it was written.
        FOREVR: NOW + SHUT_MS * 400,
        GOOD01: NOW + 5,
      },
      NOW,
    ),
    { GOOD01: NOW + 5 },
  );
});
