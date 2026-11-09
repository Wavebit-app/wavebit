import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { LocalTrack } from '../../../shared/schemas/library.ts';
import { albumsOf, artistsOf, matching } from './downloadGroups.ts';

const track = (over: Partial<LocalTrack>): LocalTrack => ({
  id: '0123456789abcdef',
  title: 'Night Drive',
  artist: 'Mara Vale',
  album: 'Glass Rooms',
  albumKey: 'k1',
  durationMs: 1000,
  hasArt: false,
  addedAt: 0,
  plays: 0,
  ...over,
});

test('songs group into albums, keeping the newest first', () => {
  const albums = albumsOf([
    track({ albumKey: 'k2', album: 'Low Tide' }),
    track({ hasArt: true }),
    track({}),
  ]);
  assert.deepEqual(
    albums.map((a) => [a.key, a.trackCount, a.durationMs, a.hasArt]),
    [
      ['k2', 1, 1000, false],
      ['k1', 2, 2000, true],
    ],
  );
});

test('songs with no album stay out of the albums', () => {
  assert.equal(albumsOf([track({ album: '' })]).length, 0);
});

test('artists count their songs and albums and take art when there is some', () => {
  const [artist] = artistsOf([
    track({}),
    track({ albumKey: 'k2', hasArt: true }),
  ]);
  assert.equal(artist?.trackCount, 2);
  assert.equal(artist?.albumCount, 2);
  assert.equal(artist?.artKey, 'k2');
});

test('the filter matches title, artist or album, ignoring case', () => {
  const list = [track({ title: 'Paper Sun' }), track({ artist: 'Tessel' })];
  assert.equal(matching(list, 'paper').length, 1);
  assert.equal(matching(list, 'TESSEL').length, 1);
  assert.equal(matching(list, 'glass').length, 2);
  assert.equal(matching(list, '').length, 2);
});
