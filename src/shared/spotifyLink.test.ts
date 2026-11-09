import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSpotifyLink } from './spotifyLink.ts';

const ID = '37i9dQZF1DXcBWIGoYBM5M';

test('reads links and URIs for every kind', () => {
  for (const kind of ['playlist', 'album', 'artist', 'track']) {
    const want = { kind, id: ID };
    assert.deepEqual(
      parseSpotifyLink(`https://open.spotify.com/${kind}/${ID}`),
      want,
    );
    assert.deepEqual(parseSpotifyLink(`spotify:${kind}:${ID}`), want);
  }
});

test('ignores share parameters, locales and stray spaces', () => {
  const want = { kind: 'playlist', id: ID };
  assert.deepEqual(
    parseSpotifyLink(`  https://open.spotify.com/playlist/${ID}?si=abc123\n`),
    want,
  );
  assert.deepEqual(
    parseSpotifyLink(`https://open.spotify.com/intl-de/playlist/${ID}`),
    want,
  );
});

test('refuses everything else', () => {
  for (const bad of [
    '',
    'late night drive',
    ID,
    `http://open.spotify.com/playlist/${ID}`,
    `https://open.spotify.com.evil.example/playlist/${ID}`,
    `https://evil.example/open.spotify.com/playlist/${ID}`,
    `https://open.spotify.com/show/${ID}`,
    `https://open.spotify.com/playlist/${ID}/../../me`,
    'https://open.spotify.com/playlist/short',
    `spotify:user:${ID}`,
    `spotify:playlist:${ID}:extra`,
    `https://open.spotify.com/playlist/${ID}?${'x'.repeat(600)}`,
  ])
    assert.equal(parseSpotifyLink(bad), null, bad);
});
