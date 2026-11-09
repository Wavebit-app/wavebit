import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  menuText,
  trayHostAnswer,
  trayItems,
  trayTooltip,
} from './trayMenu.ts';

const song = {
  title: 'Harbor Lights',
  artist: 'Nova Reyes',
  playing: true,
  shuffle: true,
  repeat: 'all' as const,
};
const idle = { ...song, title: null, artist: '', playing: false };
const window = { visible: true, closeToTray: true, mac: false };
const find = (items: ReturnType<typeof trayItems>, label: string) =>
  items.find((i) => i.label === label);

test('shows the song and offers Pause while playing', () => {
  const items = trayItems(song, window);
  assert.equal(items[0]!.label, 'Harbor Lights');
  assert.equal(items[0]!.enabled, false);
  assert.equal(items[1]!.label, 'Nova Reyes');
  assert.equal(find(items, 'Pause')?.action, 'toggle');
  assert.equal(find(items, 'Play'), undefined);
});

test('with nothing playing, the player items are off but the pages are not', () => {
  const items = trayItems(idle, window);
  assert.equal(items[0]!.label, 'Nothing playing');
  for (const label of [
    'Play',
    'Previous',
    'Next',
    'Now playing',
    'Lyrics',
    'Queue',
  ])
    assert.equal(find(items, label)?.enabled, false, label);
  assert.notEqual(find(items, 'Home')?.enabled, false);
  assert.equal(find(items, 'Quit wavebit')?.action, 'quit');
});

test('shuffle, repeat and close-to-tray reflect their state', () => {
  const items = trayItems(song, window);
  assert.equal(find(items, 'Shuffle')?.checked, true);
  const repeat = find(items, 'Repeat')?.submenu ?? [];
  assert.deepEqual(
    repeat.map((r) => [r.label, r.checked, r.action]),
    [
      ['Off', false, 'repeat:off'],
      ['All', true, 'repeat:all'],
      ['One', false, 'repeat:one'],
    ],
  );
  assert.equal(find(items, 'Keep running when closed')?.checked, true);
});

test('offers Hide or Show by whether the window is showing', () => {
  assert.equal(find(trayItems(song, window), 'Hide wavebit')?.action, 'hide');
  const hidden = trayItems(song, { ...window, visible: false });
  assert.equal(find(hidden, 'Show wavebit')?.action, 'show');
});

test('an ampersand stays literal, and long names are cut', () => {
  assert.equal(menuText('Salt & Pepper', false), 'Salt && Pepper');
  assert.equal(menuText('Salt & Pepper', true), 'Salt & Pepper');
  assert.equal(menuText('x'.repeat(90), true).length, 60);
});

test('the tooltip names the song and fits Windows', () => {
  assert.equal(trayTooltip(idle), 'wavebit');
  assert.equal(trayTooltip(song), 'Harbor Lights – Nova Reyes');
  assert.ok(trayTooltip({ ...song, title: 'x'.repeat(400) }).length < 128);
});

test('on a short screen the pages fold into one row and nothing is lost', () => {
  const full = trayItems(song, window);
  const short = trayItems(song, { ...window, short: true });
  const open = find(short, 'Open');
  assert.ok(short.length < full.length);
  assert.equal(find(short, 'Home'), undefined);
  for (const label of ['Now playing', 'Lyrics', 'Queue', 'Home', 'Settings'])
    assert.ok(
      open?.submenu?.some((i) => i.label === label),
      label,
    );
  assert.ok(find(short, 'Quit wavebit'));
});

test('a desktop tray is only ruled out by a clear no', () => {
  assert.equal(trayHostAnswer('(true,)'), true);
  assert.equal(trayHostAnswer('(false,)\n'), false);
  assert.equal(trayHostAnswer(''), true);
});
