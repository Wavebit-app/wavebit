import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ListenRow, PlayedSong } from '../../shared/schemas/library.ts';
import { addListen, summarize } from './listeningRules.ts';

const song = (over: Partial<PlayedSong> = {}): PlayedSong => ({
  id: '0123456789abcdef',
  title: 'Night Drive',
  artist: 'Mara Vale',
  album: 'Glass Rooms',
  albumKey: 'aaaaaaaaaaaaaaaa',
  artwork: null,
  durationMs: 200_000,
  spotifyUri: null,
  videoId: null,
  match: null,
  ...over,
});

const row = (over: Partial<ListenRow> = {}): ListenRow => ({
  ...song(),
  playedAt: 0,
  ms: 60_000,
  plays: 1,
  ...over,
});

test('reports add up on one row per song', () => {
  const rows: Record<string, ListenRow> = {};
  addListen(rows, { song: song(), ms: 30_000, plays: 0 }, 5);
  addListen(rows, { song: song(), ms: 12_000, plays: 1 }, 9);
  const only = rows['0123456789abcdef']!;
  assert.equal(only.ms, 42_000);
  assert.equal(only.plays, 1);
  assert.equal(only.playedAt, 9);
});

test('totals count everything, including songs never finished', () => {
  const s = summarize([row(), row({ id: 'b', ms: 5_000, plays: 0 })]);
  assert.equal(s.totalMs, 65_000);
  assert.equal(s.totalPlays, 1);
});

test('nothing played means no top categories', () => {
  const s = summarize([row({ plays: 0 })]);
  assert.equal(s.topSong, null);
  assert.equal(s.topArtist, null);
  assert.equal(s.topAlbum, null);
});

test('a file and its stream add up as one song', () => {
  const s = summarize([
    row({ ms: 100_000, plays: 2 }),
    row({ id: 'youtube:abcdefghijk', ms: 90_000, plays: 1, albumKey: null }),
    row({ id: 'c', title: 'Other', ms: 150_000, plays: 3 }),
  ]);
  assert.equal(s.topSong?.title, 'Night Drive');
  assert.equal(s.topSong?.ms, 190_000);
  assert.equal(s.topSong?.plays, 3);
});

test('the top artist is the first credit, and a stream has no page to open', () => {
  const s = summarize([
    row({
      id: 'youtube:abcdefghijk',
      artist: 'Oren Ash, Tessel',
      album: '',
      albumKey: null,
    }),
  ]);
  assert.equal(s.topArtist?.name, 'Oren Ash');
  assert.equal(s.topArtist?.localName, null);
});

test('a file gives the top artist its local name', () => {
  assert.equal(summarize([row()]).topArtist?.localName, 'Mara Vale');
});

test('songs with no album never make a top album', () => {
  assert.equal(summarize([row({ album: '' })]).topAlbum, null);
});

test('plays break a tie in listening time', () => {
  const s = summarize([
    row({ id: 'a', title: 'One', ms: 1_000, plays: 1 }),
    row({ id: 'b', title: 'Two', ms: 1_000, plays: 4 }),
  ]);
  assert.equal(s.topSong?.title, 'Two');
});
