import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_LENGTH,
  MAX_RECENT,
  parseSearches,
  withSearch,
} from './recentRules.ts';

test('the newest search comes first, and a repeat moves up instead of doubling', () => {
  let list = withSearch([], 'kraftwerk');
  list = withSearch(list, '  daft   punk ');
  assert.deepEqual(list, ['daft punk', 'kraftwerk']);
  assert.deepEqual(withSearch(list, 'Kraftwerk'), ['Kraftwerk', 'daft punk']);
});

test('nothing empty, overlong or with control characters is kept', () => {
  const list = ['a'];
  assert.equal(withSearch(list, '   '), list);
  assert.equal(withSearch(list, 'x'.repeat(MAX_LENGTH + 1)), list);
  assert.equal(withSearch(list, 'a\u0000b'), list);
});

test('only the latest searches are kept', () => {
  let list: string[] = [];
  for (let i = 0; i < MAX_RECENT + 5; i++) list = withSearch(list, `q${i}`);
  assert.equal(list.length, MAX_RECENT);
  assert.equal(list[0], `q${MAX_RECENT + 4}`);
  assert.equal(list.includes('q0'), false);
});

test('saved searches are read back in order, and anything unexpected is dropped', () => {
  const list = ['daft punk', 'kraftwerk'];
  assert.deepEqual(parseSearches(JSON.stringify(list)), list);
  assert.deepEqual(parseSearches(null), []);
  assert.deepEqual(parseSearches('{nope'), []);
  assert.deepEqual(parseSearches('{"a":1}'), []);
  assert.deepEqual(
    parseSearches(
      JSON.stringify([
        'ok',
        7,
        null,
        ['x'],
        'OK',
        '',
        'x'.repeat(500),
        'b\u0007',
      ]),
    ),
    ['ok'],
  );
});
