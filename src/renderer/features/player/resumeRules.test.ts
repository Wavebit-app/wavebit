import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_POINTS,
  notePoint,
  parsePoints,
  type ResumePoints,
} from './resumeRules.ts';

const FILE = 'edbe2a3e589ffa1c';
const VIDEO = 'youtube:dQw4w9WgXcQ';

test('a song left part-way is remembered where it stopped', () => {
  const points: ResumePoints = new Map();
  notePoint(points, FILE, 83.4, 200);
  assert.equal(points.get(FILE), 83.4);
});

test('a song that barely started, or reached its end, is forgotten', () => {
  const points: ResumePoints = new Map([[FILE, 83]]);
  notePoint(points, FILE, 2, 200);
  assert.equal(points.has(FILE), false);
  notePoint(points, FILE, 83, 200);
  notePoint(points, FILE, 195, 200);
  assert.equal(points.has(FILE), false);
});

test('a song of unknown length is not remembered', () => {
  const points: ResumePoints = new Map();
  notePoint(points, FILE, 60, 0);
  notePoint(points, VIDEO, 60, Number.NaN);
  assert.equal(points.size, 0);
});

test('the songs left longest ago go first once the list is full', () => {
  const points: ResumePoints = new Map();
  for (let i = 0; i <= MAX_POINTS; i++)
    notePoint(points, i.toString(16).padStart(16, '0'), 30, 200);
  assert.equal(points.size, MAX_POINTS);
  assert.equal(points.has('0'.repeat(16)), false);
  // Noting a song again makes it the newest.
  const second = '1'.padStart(16, '0');
  notePoint(points, second, 40, 200);
  assert.equal([...points.keys()].at(-1), second);
});

test('saved points are read back, and anything unexpected is dropped', () => {
  const points: ResumePoints = new Map();
  notePoint(points, FILE, 83.4, 200);
  notePoint(points, VIDEO, 12, 200);
  assert.deepEqual(parsePoints(JSON.stringify([...points])), points);

  assert.equal(parsePoints(null).size, 0);
  assert.equal(parsePoints('{nope').size, 0);
  assert.equal(parsePoints('{"a":1}').size, 0);
  const odd = JSON.stringify([
    ['../../etc/passwd', 30],
    [FILE, '30'],
    [FILE, -4],
    [VIDEO, 1e999],
    'x',
    [VIDEO, 44],
  ]);
  assert.deepEqual([...parsePoints(odd)], [[VIDEO, 44]]);
});
