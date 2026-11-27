import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseYouTubeLink } from './youtubeLink.ts';

const V = 'dQw4w9WgXcQ';
const PL = 'PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI';

test('reads every way a video is shared', () => {
  const want = { kind: 'video', videoId: V, list: null };
  for (const link of [
    `https://www.youtube.com/watch?v=${V}`,
    `https://youtube.com/watch?v=${V}&t=42s&feature=share`,
    `https://m.youtube.com/watch?v=${V}`,
    `https://music.youtube.com/watch?v=${V}&si=AbCdEf`,
    `https://youtu.be/${V}?si=AbCdEf`,
    `youtu.be/${V}`,
    `www.youtube.com/watch?v=${V}`,
    `http://www.youtube.com/watch?v=${V}`,
    `https://www.youtube.com/shorts/${V}`,
    `https://www.youtube.com/live/${V}?feature=shared`,
    `https://www.youtube.com/embed/${V}`,
    `https://www.youtube-nocookie.com/embed/${V}`,
    `  https://www.youtube.com/watch?v=${V}\n`,
    // A mix is one person's, so only its video is taken.
    `https://music.youtube.com/watch?v=${V}&list=RDAMVM${V}`,
  ])
    assert.deepEqual(parseYouTubeLink(link), want, link);
  assert.deepEqual(
    parseYouTubeLink(`https://www.youtube.com/watch?v=${V}&list=${PL}`),
    { kind: 'video', videoId: V, list: PL },
  );
});

test('reads playlists, albums, artists and handles', () => {
  assert.deepEqual(
    parseYouTubeLink(`https://music.youtube.com/playlist?list=${PL}`),
    { kind: 'playlist', list: PL },
  );
  assert.deepEqual(
    parseYouTubeLink(`https://music.youtube.com/browse/VL${PL}`),
    { kind: 'playlist', list: PL },
  );
  assert.deepEqual(
    parseYouTubeLink('https://music.youtube.com/browse/MPREb_4pL8gzRtw1p?si=x'),
    { kind: 'album', browseId: 'MPREb_4pL8gzRtw1p' },
  );
  const uc = 'UCuAXFkgsw1L7xaCfnd5JJOw';
  for (const link of [
    `https://music.youtube.com/channel/${uc}`,
    `https://www.youtube.com/channel/${uc}`,
    `https://music.youtube.com/browse/${uc}`,
  ])
    assert.deepEqual(parseYouTubeLink(link), { kind: 'artist', browseId: uc });
  assert.deepEqual(parseYouTubeLink('https://www.youtube.com/@Adele/videos'), {
    kind: 'handle',
    handle: '@Adele',
  });
});

test('refuses everything else', () => {
  for (const bad of [
    '',
    'never gonna give you up',
    V,
    `https://www.youtube.com.evil.example/watch?v=${V}`,
    `https://evil.example/www.youtube.com/watch?v=${V}`,
    `https://user:pass@www.youtube.com/watch?v=${V}`,
    `https://www.youtube.com:8443/watch?v=${V}`,
    `javascript://www.youtube.com/watch?v=${V}`,
    `file:///www.youtube.com/watch?v=${V}`,
    'https://www.youtube.com/watch?v=short',
    `https://www.youtube.com/watch?v=${V}x`,
    `https://www.youtube.com/watch?v=${V}/../../x`,
    'https://www.youtube.com/playlist?list=WL',
    'https://www.youtube.com/playlist?list=LL',
    'https://www.youtube.com/playlist',
    'https://music.youtube.com/browse/FEmusic_library_landing',
    'https://www.youtube.com/channel/notachannel',
    'https://www.youtube.com/@<script>',
    `https://www.youtube.com/watch?v=${V}&${'x'.repeat(600)}`,
    `https://www.youtube.com/watch?v= ${V}`,
  ])
    assert.equal(parseYouTubeLink(bad), null, bad);
});
