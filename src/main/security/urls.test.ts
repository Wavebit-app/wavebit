import assert from 'node:assert/strict';
import { test } from 'node:test';
import { artUrlFromPath, mediaCors, onDomain, onExactHost } from './urls.ts';

const hosts = new Set(['open.spotify.com']);

test('an exact host must match exactly, over plain https', () => {
  assert.equal(onExactHost(hosts, 'https://open.spotify.com/track/1'), true);
  assert.equal(onExactHost(hosts, 'http://open.spotify.com/'), false);
  assert.equal(onExactHost(hosts, 'https://x.open.spotify.com/'), false);
  assert.equal(
    onExactHost(hosts, 'https://open.spotify.com.evil.test/'),
    false,
  );
  assert.equal(onExactHost(hosts, 'not a url'), false);
});

test('a port or credentials never pass', () => {
  assert.equal(onExactHost(hosts, 'https://open.spotify.com:8443/'), false);
  assert.equal(onExactHost(hosts, 'https://a:b@open.spotify.com/'), false);
  assert.equal(onDomain(['spotify.com'], 'https://spotify.com:8443/'), false);
});

test('a domain covers its subdomains and nothing that only ends alike', () => {
  assert.equal(onDomain(['spotify.com'], 'https://spotify.com/'), true);
  assert.equal(onDomain(['spotify.com'], 'https://a.spotify.com/'), true);
  assert.equal(onDomain(['spotify.com'], 'https://evilspotify.com/'), false);
  assert.equal(onDomain(['spotify.com'], 'file:///etc/passwd'), false);
});

test('the art cache reaches only the artwork hosts', () => {
  const path = (url: string) => Buffer.from(url).toString('base64url');
  const cover = 'https://i.scdn.co/image/abc';
  assert.equal(artUrlFromPath(path(cover)), cover);
  assert.equal(artUrlFromPath(path('https://evil.test/a.jpg')), null);
  assert.equal(artUrlFromPath(path('http://i.scdn.co/a.jpg')), null);
  assert.equal(artUrlFromPath(path('https://i.scdn.co:8443/a')), null);
  assert.equal(artUrlFromPath(path('file:///etc/passwd')), null);
  assert.equal(artUrlFromPath('not/base64'), null);
  assert.equal(artUrlFromPath(''), null);
});

test('media is readable by the app page only', () => {
  const trusted = (origin: string) => origin === 'app://wavebit';
  assert.deepEqual(mediaCors('app://wavebit', trusted), {
    'Access-Control-Allow-Origin': 'app://wavebit',
    Vary: 'Origin',
  });
  assert.equal(mediaCors('https://www.youtube-nocookie.com', trusted), null);
  assert.equal(mediaCors('null', trusted), null);
  assert.deepEqual(mediaCors(null, trusted), {});
});
