import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Playable } from '../features/player/player';
import { recentArtists, recentSongs } from './sidebarListRules.ts';

const song = (id: string, artist: string, stream = true): Playable => ({
  id,
  title: id,
  artist,
  album: '',
  albumKey: null,
  artwork: `art-${id}`,
  durationMs: 0,
  stream: stream ? { videoId: id } : null,
});

test('the song playing leads, and shows once', () => {
  const a = song('a', 'A');
  const b = song('b', 'B');
  assert.deepEqual(recentSongs([a, b], b), [b, a]);
});

test('a song not counted yet still leads the list', () => {
  const a = song('a', 'A');
  const c = song('c', 'C');
  assert.deepEqual(recentSongs([a], c), [c, a]);
});

test('with nothing playing the history stands', () => {
  const a = song('a', 'A');
  assert.deepEqual(recentSongs([a], undefined), [a]);
});

test('each artist once, the latest first, by their first credit', () => {
  const artists = recentArtists([
    song('1', 'Wizkid, Tems'),
    song('2', 'Burna Boy'),
    song('3', 'wizkid'),
  ]);
  assert.deepEqual(
    artists.map((a) => a.name),
    ['Wizkid', 'Burna Boy'],
  );
});

test('a YouTube channel name reads as the artist', () => {
  assert.equal(
    recentArtists([song('1', 'Ayra Starr - Topic')])[0]!.name,
    'Ayra Starr',
  );
});

test('songs with no artist are left out', () => {
  assert.deepEqual(
    recentArtists([song('1', ''), song('2', 'Unknown artist')]),
    [],
  );
});

test('an artist heard from a file counts as local', () => {
  const [artist] = recentArtists([
    song('1', 'Wizkid'),
    song('2', 'Wizkid', false),
  ]);
  assert.equal(artist!.local, true);
});

test('an artist only streamed is not local', () => {
  assert.equal(recentArtists([song('1', 'Wizkid')])[0]!.local, false);
});
