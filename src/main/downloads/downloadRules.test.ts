import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  canEmbedCover,
  failureOf,
  insideFolder,
  isM4a,
  lyricsText,
  msUntilStart,
  parseProgress,
  songFileName,
  songLocation,
  STARTS_PER_HOUR,
  ytDlpArgs,
} from './downloadRules.ts';

const args = (videoId = 'aqz-KE-bpKQ') =>
  ytDlpArgs({ videoId, denoPath: '/app/deno', cacheDir: '/data/cache' });

test('a run ignores the user’s yt-dlp setup and takes no cookies', () => {
  const list = args();
  for (const flag of [
    '--ignore-config',
    '--no-plugin-dirs',
    '--no-exec',
    '--no-playlist',
  ])
    assert.ok(list.includes(flag), flag);
  assert.ok(!list.some((a) => a.startsWith('--cookies')));
  assert.ok(!list.includes('--remote-components'));
});

test('the address comes last, behind --, built from the id', () => {
  const list = args();
  assert.equal(list.at(-2), '--');
  assert.equal(list.at(-1), 'https://music.youtube.com/watch?v=aqz-KE-bpKQ');
});

test('an id that could be an option or an address is refused', () => {
  for (const id of ['--exec=evil', 'https://x.y', 'short', 'aqz-KE-bpKQ\n'])
    assert.throws(() => args(id));
});

test('progress lines become a fraction, other lines nothing', () => {
  assert.equal(parseProgress('wavebit 50/200'), 0.25);
  assert.equal(parseProgress('wavebit 30767611/30767611'), 1);
  assert.equal(parseProgress('wavebit 900/NA'), null);
  assert.equal(parseProgress('[youtube] Extracting URL'), null);
});

test('yt-dlp’s errors map to reasons a person can act on', () => {
  const cases = [
    ['ERROR: Sign in to confirm you’re not a bot', 'blocked'],
    ['ERROR: unable to download: HTTP Error 429: Too Many Requests', 'blocked'],
    ['ERROR: Sign in to confirm your age', 'age_restricted'],
    ['ERROR: This video is available to Music Premium members', 'restricted'],
    ['ERROR: Private video. Sign in', 'restricted'],
    ['WARNING: n challenge solving failed', 'outdated'],
    ['ERROR: Requested format is not available', 'no_format'],
    ['ERROR: Video unavailable', 'unavailable'],
    ['ERROR: [youtube] abc: This video is unavailable', 'unavailable'],
    ['ERROR: Unable to download webpage: timed out', 'network'],
    ['something new entirely', 'failed'],
  ] as const;
  for (const [line, reason] of cases) assert.equal(failureOf(line), reason);
});

test('a broken solver beats the missing format it causes', () => {
  assert.equal(
    failureOf(
      'WARNING: n challenge solving failed\nERROR: Requested format is not available',
    ),
    'outdated',
  );
});

test('M4A is known by its bytes', () => {
  const ftyp = new TextEncoder().encode('\0\0\0\x18ftypdash');
  assert.ok(isM4a(ftyp));
  assert.ok(!isM4a(new TextEncoder().encode('<!doctype html>')));
  assert.ok(!isM4a(new Uint8Array(3)));
});

test('filenames can’t leave the folder or hide their name', () => {
  assert.equal(
    songFileName('A/B', '../../etc/passwd', 'aqz-KE-bpKQ'),
    'A B - .. .. etc passwd.m4a',
  );
  assert.equal(songFileName('', '...', 'aqz-KE-bpKQ'), 'aqz-KE-bpKQ.m4a');
  assert.equal(songFileName('', 'a‮gnp.m4a', 'x'), 'a gnp.m4a.m4a');
  assert.equal(songFileName('Artist', 'Song?', 'x'), 'Artist - Song.m4a');
});

test('Windows’ reserved names are escaped', () => {
  assert.equal(songFileName('', 'CON', 'x'), '_CON.m4a');
  assert.equal(songFileName('', 'nul.mix', 'x'), '_nul.mix.m4a');
  assert.equal(songFileName('Con', 'Air', 'x'), 'Con - Air.m4a');
});

test('long names stop on a character, under the limit', () => {
  const name = songFileName('', '🎵'.repeat(100), 'x');
  assert.ok(Buffer.byteLength(name) <= 204);
  assert.ok(!name.includes('�'));
});

test('only paths inside the folder count', () => {
  assert.ok(insideFolder('/music/w', '/music/w/song.m4a'));
  assert.ok(!insideFolder('/music/w', '/music/w'));
  assert.ok(!insideFolder('/music/w', '/music/w/../x.m4a'));
  assert.ok(!insideFolder('/music/w', '/music/wave/x.m4a'));
  assert.ok(insideFolder('/music/w', '/music/w/..hidden.m4a'));
});

test('MP4 covers are JPEG or PNG', () => {
  assert.ok(canEmbedCover('image/jpeg'));
  assert.ok(!canEmbedCover('image/webp'));
});

test('songs start freely until the hourly limit', () => {
  const now = 10_000_000;
  const some = Array.from({ length: STARTS_PER_HOUR - 1 }, (_, i) => now - i);
  assert.equal(msUntilStart(some, now), 0);
  const full = [...some, now - 5000];
  assert.ok(STARTS_PER_HOUR < 300);
  assert.equal(msUntilStart(full, now, STARTS_PER_HOUR), 3_600_000 - 5000);
});

test('starts older than an hour stop counting', () => {
  const now = 10_000_000;
  const old = Array.from(
    { length: STARTS_PER_HOUR },
    () => now - 3_600_000 - 1,
  );
  assert.equal(msUntilStart(old, now), 0);
});

test('a flat folder has no subfolders', () => {
  assert.deepEqual(
    songLocation({
      artist: 'A',
      album: 'B',
      title: 'C',
      videoId: 'x',
      organise: false,
    }),
    { dirs: [], name: 'A - C.m4a' },
  );
});

test('folders use the first artist and can’t climb out', () => {
  const place = songLocation({
    artist: '../../etc, Someone',
    album: '..',
    title: 'Song',
    videoId: 'x',
    organise: true,
  });
  assert.deepEqual(place.dirs, ['.. .. etc'.replace(/^[.\s]+/, '')]);
  for (const dir of place.dirs) {
    assert.ok(!dir.includes('/'));
    assert.ok(!dir.startsWith('.'));
  }
});

test('a reserved name can’t be a folder', () => {
  assert.deepEqual(
    songLocation({
      artist: 'CON',
      album: 'NUL',
      title: 'S',
      videoId: 'x',
      organise: true,
    }).dirs,
    ['_CON', '_NUL'],
  );
});

test('timed words keep their stamps, plain words don’t, instrumentals have none', () => {
  const lines = [
    { timeMs: 65_430, text: 'one' },
    { timeMs: 70_000, text: 'two' },
  ];
  assert.equal(
    lyricsText({ kind: 'synced', lines }),
    '[01:05.43]one\n[01:10.00]two',
  );
  assert.equal(lyricsText({ kind: 'plain', lines }), 'one\ntwo');
  assert.equal(lyricsText({ kind: 'instrumental', lines: [] }), null);
});
