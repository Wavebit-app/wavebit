import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cleanText,
  cut,
  fillLabel,
  padShort,
  textLength,
} from './discordText.ts';

const song = { title: 'Night Drive', artist: 'Kavinsky', album: 'OutRun' };

test('hidden characters go and whitespace collapses', () => {
  assert.equal(cleanText(' a‮b​\u0000c\n\td '), 'abc d');
});

test('cutting keeps whole emoji and stays within the limit', () => {
  const family = '\u{1F468}‍\u{1F469}‍\u{1F467}';
  const text = `${'a'.repeat(28)}${family}${family}`;
  const out = cut(text, 32);
  assert.ok(textLength(out) <= 32);
  assert.ok(out.endsWith('…'));
  assert.ok(!out.includes('‍…'));
  assert.equal(cut('short', 32), 'short');
});

test('labels fill variables, fall back when empty and report a cut', () => {
  assert.deepEqual(fillLabel('Hear {song_name}', 'Get wavebit', song), {
    text: 'Hear Night Drive',
    length: 16,
    cut: false,
  });
  assert.equal(fillLabel('  ', 'Get wavebit', song).text, 'Get wavebit');
  assert.equal(
    fillLabel('{album_name}', 'Get wavebit', { ...song, album: '' }).text,
    'Get wavebit',
  );
  const long = fillLabel(
    '{song_name} by {artist_name} from {album_name}',
    'x',
    song,
  );
  assert.equal(long.cut, true);
  assert.equal(textLength(long.text), 32);
});

test('one character is padded to two', () => {
  assert.equal(textLength(padShort('X')), 2);
  assert.equal(padShort('XY'), 'XY');
});
