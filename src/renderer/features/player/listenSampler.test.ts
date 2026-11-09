import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_STEP_MS, newListen, tick } from './listenSampler.ts';

const MINUTES_4 = 240_000;

test('time adds up while playing', () => {
  const l = newListen('a', 0);
  tick(l, 1_000, true, MINUTES_4);
  tick(l, 2_000, true, MINUTES_4);
  assert.equal(l.heard, 2_000);
  assert.equal(l.pendingMs, 2_000);
});

test('a pause adds nothing, even when the next tick is late', () => {
  const l = newListen('a', 0);
  tick(l, 1_000, true, MINUTES_4);
  tick(l, 3_600_000, false, MINUTES_4);
  tick(l, 3_601_000, true, MINUTES_4);
  assert.equal(l.heard, 2_000);
});

test('one gap is capped, so a stalled clock can not inflate the time', () => {
  const l = newListen('a', 0);
  tick(l, 3_600_000, true, MINUTES_4);
  assert.equal(l.heard, MAX_STEP_MS);
});

test('a clock going backwards adds nothing', () => {
  const l = newListen('a', 5_000);
  tick(l, 1_000, true, MINUTES_4);
  assert.equal(l.heard, 0);
});

function playFor(lengthMs: number, seconds: number) {
  const l = newListen('a', 0);
  let counts = 0;
  for (let s = 1; s <= seconds; s++)
    if (tick(l, s * 1000, true, lengthMs)) counts++;
  return { l, counts };
}

test('a play counts once, at half the song', () => {
  const short = playFor(100_000, 49);
  assert.equal(short.counts, 0);
  const done = playFor(100_000, 90);
  assert.equal(done.counts, 1);
  assert.equal(done.l.pendingPlays, 1);
});

test('a very short song still needs 30 seconds', () => {
  assert.equal(playFor(20_000, 29).counts, 0);
  assert.equal(playFor(20_000, 30).counts, 1);
});

test('a very long song counts at 4 minutes', () => {
  assert.equal(playFor(3_600_000, 239).counts, 0);
  assert.equal(playFor(3_600_000, 240).counts, 1);
});

test('time keeps building after the song has counted', () => {
  const { l } = playFor(100_000, 90);
  assert.equal(l.heard, 90_000);
});
