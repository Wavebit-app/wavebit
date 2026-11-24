import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_SETTINGS } from '../../shared/schemas/settings.ts';
import type { DiscordPlayback } from '../../shared/schemas/discord.ts';
import { makeDiscordActivity } from './presenceRules.ts';

const playback: DiscordPlayback = {
  id: 'track-1',
  title: 'Song',
  artist: 'Artist',
  album: 'Album',
  artworkUrl: 'https://i.scdn.co/image/cover',
  playing: true,
  position: 60,
  duration: 240,
  speed: 1,
};

const settings = {
  ...DEFAULT_SETTINGS,
  discordPresenceEnabled: true,
};

test('presence is opt-in and clears while paused or idle', () => {
  assert.equal(makeDiscordActivity(playback, DEFAULT_SETTINGS), null);
  assert.equal(
    makeDiscordActivity({ ...playback, playing: false }, settings),
    null,
  );
  assert.equal(makeDiscordActivity(null, settings), null);
});

test('activity maps title, artist, album, image and activity type', () => {
  assert.deepEqual(makeDiscordActivity(playback, settings, 1_700_000_000_000), {
    type: 2,
    details: 'Song',
    state: 'Artist · Album',
    timestamps: { start: 1_699_999_940, end: 1_700_000_180 },
    assets: {
      large_image: 'https://i.scdn.co/image/cover',
      large_text: 'Album',
    },
  });
});

test('timestamps account for playback speed and clamp seeks to track duration', () => {
  const activity = makeDiscordActivity(
    { ...playback, position: 300, speed: 2 },
    { ...settings, playbackSpeed: 2 },
    1_700_000_000_000,
  );
  assert.deepEqual(activity?.timestamps, {
    start: 1_699_999_880,
    end: 1_700_000_000,
  });
});

test('private, local and unknown-host artwork URLs are omitted', () => {
  for (const artworkUrl of [
    'media://remote/album',
    'https://localhost/art.png',
    'https://example.com/art.png',
  ]) {
    assert.equal(
      makeDiscordActivity({ ...playback, artworkUrl }, settings)?.assets,
      undefined,
    );
  }
});

test('settings can omit album, artwork and playback progress', () => {
  assert.deepEqual(
    makeDiscordActivity(playback, {
      ...settings,
      discordShowAlbum: false,
      discordShowArtwork: false,
      discordShowProgress: false,
      discordActivityType: 'playing',
    }),
    { type: 0, details: 'Song', state: 'Artist' },
  );
});

test('display text is cleaned and clipped before IPC reaches Discord', () => {
  const activity = makeDiscordActivity(
    { ...playback, title: ` ${'x'.repeat(140)}\n` },
    settings,
  );
  assert.equal(activity?.details.length, 128);
  assert.equal(activity?.details.includes('\n'), false);
});
