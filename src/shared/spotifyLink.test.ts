import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isSpotifyShortLink, parseSpotifyLink } from './spotifyLink.ts';

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
    `https://open.spotify.com.evil.example/playlist/${ID}`,
    `https://evil.example/open.spotify.com/playlist/${ID}`,
    `https://open.spotify.com/show/${ID}`,
    `https://open.spotify.com/playlist/${ID}/../../me`,
    'https://open.spotify.com/playlist/short',
    `spotify:user:${ID}`,
    `https://user:pw@open.spotify.com/playlist/${ID}`,
    `https://open.spotify.com:444/playlist/${ID}`,
    `javascript://open.spotify.com/playlist/${ID}`,
    `https://spotify.link/abc`,
    `spotify:playlist:${ID}:extra`,
    `https://open.spotify.com/playlist/${ID}?${'x'.repeat(600)}`,
  ])
    assert.equal(parseSpotifyLink(bad), null, bad);
});

test('reads embeds, old user playlists and links without https', () => {
  const want = { kind: 'playlist', id: ID };
  for (const link of [
    `https://open.spotify.com/embed/playlist/${ID}?utm_source=generator`,
    `https://open.spotify.com/user/spotify/playlist/${ID}`,
    `spotify:user:spotify:playlist:${ID}`,
    `open.spotify.com/playlist/${ID}`,
    `http://open.spotify.com/playlist/${ID}`,
    `https://play.spotify.com/playlist/${ID}`,
  ])
    assert.deepEqual(parseSpotifyLink(link), want, link);
});

test('knows a short share link when it sees one', () => {
  assert.equal(isSpotifyShortLink('https://spotify.link/aBcD3fGh1Jb'), true);
  assert.equal(isSpotifyShortLink('spoti.fi/3xYz'), true);
  assert.equal(isSpotifyShortLink('https://spotify.link/'), false);
  assert.equal(
    isSpotifyShortLink(`https://open.spotify.com/track/${ID}`),
    false,
  );
  assert.equal(
    isSpotifyShortLink('https://spotify.link.evil.example/a'),
    false,
  );
});
