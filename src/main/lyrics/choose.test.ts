import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { LyricsSourceId } from '../../shared/lyricsSources';
import type { Lyrics } from '../../shared/schemas/lyrics';
import { chooseLyrics, type Answer } from './choose.ts';

const IDS: LyricsSourceId[] = ['lrc-red', 'bini', 'lrclib'];
const timed: Lyrics = { kind: 'synced', lines: [{ timeMs: 1, text: 'a' }] };
const plain: Lyrics = { kind: 'plain', lines: [{ timeMs: 0, text: 'a' }] };
const now = (...a: Answer[]) => a.map((x) => Promise.resolve(x));

test('the first timed source in the order wins', async () => {
  const found = await chooseLyrics(IDS, now(null, timed, timed));
  assert.equal(found && found !== 'failed' && found.source, 'bini');
});

test('timed lower down beats plain higher up', async () => {
  const found = await chooseLyrics(IDS, now(plain, null, timed));
  assert.equal(found && found !== 'failed' && found.source, 'lrclib');
});

test('plain is the last resort, from the highest source', async () => {
  const found = await chooseLyrics(IDS, now(null, plain, plain));
  assert.equal(found && found !== 'failed' && found.source, 'bini');
});

test('a fast lower source cannot jump ahead of a slow higher one', async () => {
  let finish!: (a: Answer) => void;
  const slow = new Promise<Answer>((r) => (finish = r));
  const choosing = chooseLyrics(IDS, [slow, Promise.resolve(timed)]);
  setTimeout(() => finish(timed), 5);
  const found = await choosing;
  assert.equal(found && found !== 'failed' && found.source, 'lrc-red');
});

test('a failed source is skipped', async () => {
  const found = await chooseLyrics(IDS, now('failed', timed, null));
  assert.equal(found && found !== 'failed' && found.source, 'bini');
});

test('no source having it is not a failure', async () => {
  assert.equal(await chooseLyrics(IDS, now(null, 'failed', null)), null);
});

test('every source failing is a failure', async () => {
  assert.equal(
    await chooseLyrics(IDS, now('failed', 'failed', 'failed')),
    'failed',
  );
});

test('nothing asked is no answer', async () => {
  assert.equal(await chooseLyrics([], []), null);
});
