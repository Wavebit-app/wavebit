import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  decodeEntities,
  lrcRedUrl,
  parseKugou,
  parseLyricsPlus,
  parseQrc,
  parseTtml,
  sameRecording,
  songTitleOfVideo,
  ttmlTime,
} from './lyricsParse.ts';

const words = (l: { lines: { text: string }[] } | null) =>
  l?.lines.map((x) => x.text).filter(Boolean);

test('TTML clocks', () => {
  assert.equal(ttmlTime('27.395'), 27395);
  assert.equal(ttmlTime('1:05.20'), 65200);
  assert.equal(ttmlTime('1:02:03.4'), 3723400);
  assert.equal(ttmlTime('12s'), 12000);
  assert.equal(ttmlTime('1500ms'), 1500);
  assert.equal(ttmlTime(''), null);
  assert.equal(ttmlTime('soon'), null);
});

test('TTML syllables join, and space separates words', () => {
  const found = parseTtml(
    '<tt><body><div><p begin="0:01.000" end="0:03.000"><span begin="1" end="2">Sea</span><span begin="2" end="3">side</span> <span begin="3" end="3.5">town</span></p></div></body></tt>',
  );
  assert.equal(found?.kind, 'synced');
  assert.deepEqual(words(found), ['Seaside town']);
  assert.equal(found?.lines[0]?.timeMs, 1000);
});

test('TTML leaves out translations, romanisation and background vocals', () => {
  const found = parseTtml(
    '<tt><p begin="1" end="2">Main<span ttm:role="x-bg"><span begin="1" end="2">(ooh)</span></span><span ttm:role="x-translation">Principal</span></p></tt>',
  );
  assert.deepEqual(words(found), ['Main']);
});

test('TTML with no times is a still page', () => {
  const found = parseTtml('<tt><p>One line</p><p>Two &amp; three</p></tt>');
  assert.equal(found?.kind, 'plain');
  assert.deepEqual(words(found), ['One line', 'Two & three']);
});

test('TTML keeps a long break and drops a short one', () => {
  const found = parseTtml(
    '<tt><p begin="1" end="2">A</p><p begin="2.5" end="3">B</p><p begin="12" end="13">C</p></tt>',
  );
  const breaks = found!.lines.filter((l) => l.text === '').map((l) => l.timeMs);
  assert.deepEqual(breaks, [3000, 13000]);
});

test('TTML that holds nothing is no answer', () => {
  assert.equal(parseTtml('<tt><body/></tt>'), null);
  assert.equal(parseTtml('not xml at all'), null);
});

test('decodes entities and survives one out of range', () => {
  assert.equal(decodeEntities('it&#x27;s &amp; &#65;'), "it's & A");
  assert.equal(decodeEntities('&#x110000;'), '&#x110000;');
});

test('LyricsPlus lines, from text or syllables', () => {
  const found = parseLyricsPlus([
    { time: 1000, duration: 500, text: 'Whole line', syllabus: [] },
    { time: 2000, text: '', syllabus: [{ text: 'Sylla' }, { text: 'bles' }] },
    { text: 'no time' },
  ]);
  assert.equal(found?.kind, 'synced');
  assert.deepEqual(words(found), ['Whole line', 'Syllables']);
});

test('KuGou credits go from both ends', () => {
  const found = parseKugou(
    [
      '[00:00.00]Song - Artist',
      '[00:01.00]作词：Someone',
      '[00:02.00]作曲：Someone',
      '[00:10.00]First line',
      '[00:12.00]Second line',
      '[03:00.00]制作人：Someone',
    ].join('\n'),
  );
  assert.deepEqual(words(found), ['First line', 'Second line']);
});

test('KuGou opening title with no credits goes', () => {
  const found = parseKugou('[00:00.00]Song - Artist\n[00:10.00]First line');
  assert.deepEqual(words(found), ['First line']);
});

test('KuGou instrumental notice is no answer', () => {
  assert.equal(parseKugou('[00:01.00]纯音乐，请欣赏'), null);
});

test('QRC strips syllable times', () => {
  const found = parseQrc(
    '<Lyric_1 LyricContent="[ti:Song]\n[1000,2000]Sea(0,500)side(500,500) (1000,0)town(1000,1000)\n[3500,1000]It&apos;s(0,500) late(500,500)\n"/>',
  );
  assert.deepEqual(words(found), ['Seaside town', "It's late"]);
  assert.equal(found?.lines[0]?.timeMs, 1000);
});

test('a hit must be the same song and version', () => {
  const hits = [
    { isrc: 'A', title: 'Low Tide (Live)', artist: 'Coast', duration: 200 },
    { isrc: 'B', title: 'Low Tide', artist: 'Coast', duration: 205 },
    { isrc: 'C', title: 'Low Tide', artist: 'Coast', duration: 200.5 },
    { isrc: 'D', title: 'Low Tide', artist: 'Someone', duration: 200 },
  ];
  assert.equal(sameRecording(hits, 'Low Tide', 'Coast', 200)?.isrc, 'C');
  assert.equal(sameRecording(hits, 'Low Tide (Live)', 'Coast', 200)?.isrc, 'A');
  assert.equal(sameRecording(hits, 'High Tide', 'Coast', 200), null);
});

test('matching ignores accents and shared credits', () => {
  const hits = [
    { isrc: 'A', title: 'Café', artist: 'Rosé & Bruno', duration: 90 },
  ];
  assert.equal(sameRecording(hits, 'Cafe', 'Rose', 90)?.isrc, 'A');
});

test('a video title loses its leading artist', () => {
  assert.equal(
    songTitleOfVideo('Stunna Gambino - Kiss & Tell', 'Stunna Gambino'),
    'Kiss & Tell',
  );
  assert.equal(
    songTitleOfVideo('RÖYKSOPP - What Else', 'Royksopp'),
    'What Else',
  );
});

test('a video title keeps a dash that is not the artist', () => {
  assert.equal(songTitleOfVideo('Low Tide - Live', 'Coast'), 'Low Tide - Live');
  assert.equal(songTitleOfVideo('Low Tide', 'Coast'), 'Low Tide');
  assert.equal(songTitleOfVideo('A - B', ''), 'A - B');
});

test('only a real ISRC makes a document address', () => {
  assert.equal(
    lrcRedUrl('gbaye9701374'),
    'https://lrc.red/s/GBAYE9701374.ttml',
  );
  assert.equal(lrcRedUrl('../../etc'), null);
  assert.equal(lrcRedUrl(42), null);
});
