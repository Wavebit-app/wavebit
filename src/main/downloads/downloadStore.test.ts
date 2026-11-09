import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseStored } from './downloadStore.ts';

const record = {
  file: '/music/a.m4a',
  title: 'A',
  artist: 'B',
  addedAt: 1,
  keys: [],
};
const song = {
  videoId: 'aqz-KE-bpKQ',
  match: null,
  title: 'A',
  artist: 'B',
  album: '',
  artwork: null,
  durationMs: 0,
};

test('anything that isn’t the saved shape starts empty', () => {
  for (const raw of [null, 'x', 3, []])
    assert.deepEqual(parseStored(raw).queue, []);
});

test('good entries are kept', () => {
  const stored = parseStored({
    records: { 'aqz-KE-bpKQ': record },
    queue: [{ song, list: null }],
    lists: [{ kind: 'ytPage', id: 'VLabc', title: 'T' }],
    starts: [5],
  });
  assert.equal(stored.records['aqz-KE-bpKQ']?.title, 'A');
  assert.equal(stored.queue.length, 1);
  assert.equal(stored.lists.length, 1);
  assert.deepEqual(stored.starts, [5]);
});

test('one bad entry doesn’t lose the rest', () => {
  const stored = parseStored({
    records: {
      '../../etc/x': record,
      'aqz-KE-bpKQ': record,
      bbbbbbbbbbb: { ...record, file: 'relative.m4a' },
      ccccccccccc: { ...record, file: '/etc/passwd' },
    },
    queue: [
      { song: { ...song, videoId: '--exec=x' }, list: null },
      { song, list: null },
    ],
    starts: ['x', 7],
  });
  assert.deepEqual(Object.keys(stored.records), ['aqz-KE-bpKQ']);
  assert.equal(stored.queue.length, 1);
  assert.deepEqual(stored.starts, [7]);
});

test('a saved record can’t set a prototype', () => {
  const stored = parseStored(
    JSON.parse(`{"records":{"__proto__":${JSON.stringify(record)}}}`),
  );
  assert.equal(Object.keys(stored.records).length, 0);
  assert.equal(({} as Record<string, unknown>).file, undefined);
});
