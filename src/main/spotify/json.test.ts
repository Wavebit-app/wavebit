import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cdnUrl, plainText, sized, time } from './json.ts';

test('descriptions lose their HTML and keep their words', () => {
  assert.equal(
    plainText(
      'Songs for <a href="spotify:playlist:x">late</a> drives &amp; rain &#x27;26',
    ),
    "Songs for late drives & rain '26",
  );
  assert.equal(plainText('<script>alert(1)</script>'), 'alert(1)');
  assert.equal(plainText('a‮b'), 'a b');
  assert.equal(plainText(''), null);
  assert.equal(plainText(42), null);
});

test('only https images on Spotify CDNs pass', () => {
  assert.equal(
    cdnUrl('https://i.scdn.co/image/ab67'),
    'https://i.scdn.co/image/ab67',
  );
  assert.equal(
    cdnUrl('https://pickasso.spotifycdn.com/image/x'),
    'https://pickasso.spotifycdn.com/image/x',
  );
  assert.equal(cdnUrl('http://i.scdn.co/image/x'), null);
  assert.equal(cdnUrl('https://evil.example/i.scdn.co'), null);
  assert.equal(cdnUrl('https://scdn.co.evil.example/x'), null);
  assert.equal(cdnUrl('javascript:alert(1)'), null);
});

test('sized picks the smallest image at least as wide as drawn', () => {
  const images = [
    { url: 'https://i.scdn.co/640', width: 640 },
    { url: 'https://i.scdn.co/64', width: 64 },
    { url: 'https://i.scdn.co/300', width: 300 },
  ];
  assert.equal(sized(images, 200), 'https://i.scdn.co/300');
  assert.equal(sized(images, 1000), 'https://i.scdn.co/640');
  assert.equal(
    sized([{ url: 'https://i.scdn.co/x', width: null }]),
    'https://i.scdn.co/x',
  );
});

test('1970 means unknown', () => {
  assert.equal(time('1970-01-01T00:00:00Z'), null);
  assert.equal(time('2026-10-05T12:00:00Z'), Date.UTC(2026, 9, 5, 12));
  assert.equal(time('soon'), null);
});
