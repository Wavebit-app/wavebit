import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseRecentPlays, recentPlaysUrl } from './webRows.ts';

const API = 'https://api.spotify.com';
const SONG = '11dFghVXANMlKmJXsNCbNl';
const ARTIST = '6sFIWsNpZYqfjUpaCgueju';
const ALBUM = '4aawyAB9vmqN3uQ7FjRGTy';

function play(uri: string, playedAt: string) {
  return {
    track: {
      type: 'track',
      uri,
      name: 'Cut To The Feeling',
      duration_ms: 207959,
      artists: [{ id: ARTIST, name: 'Carly Rae Jepsen' }],
      album: {
        id: ALBUM,
        name: 'Cut To The Feeling',
        images: [
          { url: 'https://i.scdn.co/image/ab67616d00001e02aa', width: 300 },
        ],
      },
    },
    played_at: playedAt,
    context: {
      type: 'playlist',
      uri: 'spotify:playlist:37i9dQZF1DXcBWIGoYBM5M',
    },
  };
}

test('reads the documented recently-played response', () => {
  const { items, before } = parseRecentPlays({
    items: [play(`spotify:track:${SONG}`, '2026-11-08T10:15:30.000Z')],
    next: 'https://api.spotify.com/v1/me/player/recently-played?before=1762596930000',
    cursors: { after: '1762596930999', before: '1762596930000' },
    limit: 50,
  });
  assert.equal(before, 1762596930000);
  assert.equal(items.length, 1);
  const [card] = items;
  assert.equal(card!.kind, 'track');
  assert.equal(card!.id, SONG);
  assert.equal(card!.name, 'Cut To The Feeling');
  assert.equal(card!.subtitle, 'Carly Rae Jepsen');
  assert.equal(card!.playedAt, Date.parse('2026-11-08T10:15:30.000Z'));
  assert.deepEqual(card!.track.artistIds, [ARTIST]);
  assert.equal(card!.track.albumId, ALBUM);
});

test('a song played twice shows once, the newest play', () => {
  const uri = `spotify:track:${SONG}`;
  const { items } = parseRecentPlays({
    items: [
      play(uri, '2026-11-08T10:15:30.000Z'),
      play(uri, '2026-11-08T09:00:00.000Z'),
    ],
  });
  assert.equal(items.length, 1);
  assert.equal(items[0]!.playedAt, Date.parse('2026-11-08T10:15:30.000Z'));
});

test('the last page has no cursor, and episodes are left out', () => {
  const page = parseRecentPlays({
    items: [
      { track: { type: 'episode', uri: 'spotify:episode:x', name: 'Talk' } },
    ],
    next: null,
    cursors: null,
  });
  assert.deepEqual(page, { items: [], before: null });
});

test('pages with before, and never sends after', () => {
  assert.equal(
    recentPlaysUrl(API),
    `${API}/v1/me/player/recently-played?limit=50`,
  );
  const next = recentPlaysUrl(API, 1762596930000);
  assert.match(next, /[?&]before=1762596930000/);
  assert.doesNotMatch(next, /after=/);
});
