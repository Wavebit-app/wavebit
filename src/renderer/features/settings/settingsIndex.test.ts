import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SETTINGS, searchSettings, setting } from './settingsIndex.ts';

const ids = (q: string) => searchSettings(q).map((s) => s.id);

test('every id is unique', () => {
  assert.equal(new Set(SETTINGS.map((s) => s.id)).size, SETTINGS.length);
});

test('every section can be found', () => {
  assert.equal(new Set(SETTINGS.map((s) => s.section)).size, 8);
});

test('a name that starts with the query comes first', () => {
  assert.equal(ids('crossfade')[0], 'crossfade');
  assert.equal(ids('volume')[0], 'normalize');
});

test('finds by a word that is not in the name', () => {
  assert.ok(ids('oled').includes('theme'));
  assert.ok(ids('kugou').includes('lyricsSources'));
  assert.ok(ids('replaygain').includes('normalize'));
});

test('every word has to match', () => {
  assert.ok(ids('lyrics blur').includes('lyricsBlur'));
  assert.equal(ids('lyrics blur').includes('syncedLyrics'), false);
});

test('case and outside spaces do not matter', () => {
  assert.deepEqual(ids('  THEME '), ids('theme'));
});

test('an empty query finds nothing', () => {
  assert.deepEqual(ids('   '), []);
});

test('nonsense finds nothing', () => {
  assert.deepEqual(ids('zzzzqq'), []);
});

test('results are limited', () => {
  assert.ok(ids('a').length <= 12);
});

test('an unknown id is a programming error', () => {
  assert.throws(() => setting('nope'));
  assert.equal(setting('accent').label, 'Accent');
});
