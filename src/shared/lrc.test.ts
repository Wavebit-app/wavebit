import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  activeLine,
  closest,
  forLyricsSearch,
  parseLrc,
  parsePlain,
  primaryArtist,
} from './lrc.ts';

test('reads LRC stamps, in hundredths and thousandths', () => {
  assert.deepEqual(parseLrc('[ti:Song]\n[00:01.50] one\n[01:02.345]two\n'), [
    { timeMs: 1500, text: 'one' },
    { timeMs: 62345, text: 'two' },
  ]);
});

test('one line with several stamps repeats, in time order', () => {
  assert.deepEqual(parseLrc('[00:20.00][00:02.00]chorus\n[00:03.00]verse'), [
    { timeMs: 2000, text: 'chorus' },
    { timeMs: 3000, text: 'verse' },
    { timeMs: 20000, text: 'chorus' },
  ]);
});

test('a short empty stamp goes, a long one stays, the last always stays', () => {
  const lines = parseLrc(
    '[00:01.00]a\n[00:02.00]\n[00:03.00]b\n[00:04.00]\n[00:09.00]c\n[00:12.00]',
  );
  assert.deepEqual(
    lines.map((l) => l.timeMs),
    [1000, 3000, 4000, 9000, 12000],
  );
});

test('a long run-up gets its own break', () => {
  assert.deepEqual(parseLrc('[00:10.00]late')[0], { timeMs: 0, text: '' });
  assert.equal(parseLrc('[00:02.00]soon')[0]!.text, 'soon');
});

test('plain lyrics lose their blank lines', () => {
  assert.deepEqual(
    parsePlain('one\n\n two \n').map((l) => l.text),
    ['one', 'two'],
  );
});

test('credits and upload labels go; other recordings stay', () => {
  assert.equal(forLyricsSearch('Dracula (feat. JENNIE)'), 'Dracula');
  assert.equal(forLyricsSearch('Song ft. Someone Else'), 'Song');
  assert.equal(forLyricsSearch('Song [Official Music Video]'), 'Song');
  assert.equal(forLyricsSearch('Song (Remix)'), 'Song (Remix)');
  assert.equal(forLyricsSearch('Song (Live)'), 'Song (Live)');
  assert.equal(forLyricsSearch('(Official Video)'), '(Official Video)');
});

test('the first artist, without the Topic suffix', () => {
  assert.equal(primaryArtist('Travis Scott, Drake'), 'Travis Scott');
  assert.equal(primaryArtist('Shakira & Burna Boy'), 'Shakira');
  assert.equal(primaryArtist('Ayra Starr - Topic'), 'Ayra Starr');
});

test('picks the closest length, and refuses a different edit', () => {
  const hit = (duration: number, syncedLyrics: string | null) => ({
    duration,
    syncedLyrics,
    plainLyrics: null,
  });
  const hits = [hit(205, 'far'), hit(201, 'near'), hit(200, null)];
  assert.equal(closest(hits, 200, 'syncedLyrics'), 'near');
  assert.equal(closest([hit(260, 'other')], 200, 'syncedLyrics'), null);
  assert.equal(closest([hit(260, 'any')], 0, 'syncedLyrics'), 'any');
});

test('the active line is the last one that has started', () => {
  const lines = [0, 1000, 2000].map((timeMs) => ({ timeMs, text: 'x' }));
  assert.equal(activeLine(lines.slice(1), 500), -1);
  assert.equal(activeLine(lines, 0), 0);
  assert.equal(activeLine(lines, 1999), 1);
  assert.equal(activeLine(lines, 9000), 2);
});
