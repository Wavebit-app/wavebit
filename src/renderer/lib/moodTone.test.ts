import assert from 'node:assert/strict';
import { test } from 'node:test';
import { moodTone, whiteContrast } from './moodTone.ts';

const rgb = (hex: string) =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

test('every card keeps white text readable', () => {
  for (const color of ['#a4ffa4', '#ffe780', '#ffffff', '#606060', null])
    assert.ok(whiteContrast(rgb(moodTone(color, 'Chill'))) >= 4.5, `${color}`);
});

test('a colour already dark enough is left alone', () => {
  assert.equal(moodTone('#aa09aa', 'Bhojpuri'), '#aa09aa');
});

test('the same title always gets the same fallback', () => {
  assert.equal(moodTone(null, 'Chill'), moodTone(null, 'Chill'));
});
