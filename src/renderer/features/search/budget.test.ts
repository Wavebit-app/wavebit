import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fitResults, MAX_RESULTS } from './budget.ts';

const rows = (name: string, count: number) =>
  Array.from({ length: count }, (_, i) => `${name}${i}`);

test('never shows more than nine, with both sources full', () => {
  const shown = fitResults(rows('l', 14), rows('r', 15), false);
  assert.equal(shown.length, MAX_RESULTS);
  assert.equal(shown.filter((s) => s.startsWith('l')).length, 5);
  assert.equal(shown.filter((s) => s.startsWith('r')).length, 4);
});

test('local rows come first', () => {
  assert.deepEqual(fitResults(['l0'], ['r0'], false), ['l0', 'r0']);
});

test('YouTube Music fills what a small library leaves', () => {
  const shown = fitResults(rows('l', 2), rows('r', 15), false);
  assert.equal(shown.filter((s) => s.startsWith('r')).length, 7);
  assert.equal(shown.length, MAX_RESULTS);
});

test('the library fills what YouTube Music leaves', () => {
  const shown = fitResults(rows('l', 14), rows('r', 1), false);
  assert.equal(shown.filter((s) => s.startsWith('l')).length, 8);
  assert.equal(shown.length, MAX_RESULTS);
});

test('with no YouTube Music answer the library may use all nine', () => {
  assert.equal(fitResults(rows('l', 14), [], false).length, MAX_RESULTS);
});

test('while YouTube Music is asked, local rows stop at their share', () => {
  assert.equal(fitResults(rows('l', 14), [], true).length, 5);
});

test('held results keep their rows during a refined search', () => {
  assert.equal(fitResults(rows('l', 14), rows('r', 4), true).length, 9);
});
