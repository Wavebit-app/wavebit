import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_SETTINGS } from '../../shared/schemas/settings.ts';
import {
  makeDiscordCard,
  qualityLine,
  songLink,
  WAVEBIT_PAGE,
  type PlaybackAt,
} from './presenceRules.ts';

const AT = 1_795_680_000_000;
const on = { ...DEFAULT_SETTINGS, discordPresenceEnabled: true };
const none = { private: false, quality: null };

const stream: PlaybackAt = {
  id: 'yt:MV_3Dpw-BRY',
  title: 'Night Drive',
  artist: 'Kavinsky',
  album: 'OutRun',
  artworkUrl: 'https://lh3.googleusercontent.com/abc=w544-h544',
  playing: true,
  position: 64,
  duration: 199,
  speed: 1,
  source: 'youtube',
  youtubeId: 'MV_3Dpw-BRY',
  spotifyId: null,
  at: AT,
};
const file: PlaybackAt = {
  ...stream,
  id: '0123456789abcdef',
  title: 'Teardrop',
  artist: 'Massive Attack',
  album: 'Mezzanine',
  artworkUrl: 'media://art/0123456789abcdef',
  source: 'file',
  youtubeId: null,
};

test('says why there is no card', () => {
  assert.equal(makeDiscordCard(stream, DEFAULT_SETTINGS, none).hidden, 'off');
  assert.equal(
    makeDiscordCard(stream, on, { ...none, private: true }).hidden,
    'private',
  );
  assert.equal(makeDiscordCard(null, on, none).hidden, 'nothing');
  assert.equal(
    makeDiscordCard(file, { ...on, discordShareFiles: false }, none).hidden,
    'files',
  );
  assert.equal(
    makeDiscordCard({ ...stream, playing: false }, on, none).hidden,
    'paused',
  );
});

test('a stream becomes the full card', () => {
  const { activity } = makeDiscordCard(stream, on, none);
  assert.deepEqual(activity, {
    type: 2,
    status_display_type: 1,
    details: 'Night Drive',
    details_url: 'https://music.youtube.com/watch?v=MV_3Dpw-BRY',
    state: 'Kavinsky · OutRun',
    timestamps: { start: AT - 64_000, end: AT - 64_000 + 199_000 },
    assets: {
      large_image: 'https://lh3.googleusercontent.com/abc=w544-h544',
      large_text: 'OutRun',
      small_image: 'youtube-music',
      small_text: 'From YouTube Music',
    },
    buttons: [
      {
        label: 'Listen on YouTube Music',
        url: 'https://music.youtube.com/watch?v=MV_3Dpw-BRY',
      },
      { label: 'Get wavebit', url: WAVEBIT_PAGE },
    ],
  });
});

test('speed is divided out of the times and tagged on the title', () => {
  const { activity } = makeDiscordCard({ ...stream, speed: 1.25 }, on, none);
  assert.equal(activity?.details, 'Night Drive [1.25×]');
  assert.equal(activity?.timestamps?.start, AT - 51_200);
  assert.equal(activity?.timestamps?.end, AT - 51_200 + 159_200);
  const untagged = makeDiscordCard(
    { ...stream, speed: 1.25 },
    { ...on, discordShowSpeed: false },
    none,
  );
  assert.equal(untagged.activity?.details, 'Night Drive');
});

test('the same report always gives the same card', () => {
  const a = JSON.stringify(makeDiscordCard(stream, on, none).activity);
  const b = JSON.stringify(makeDiscordCard(stream, on, none).activity);
  assert.equal(a, b);
});

test('a file never sends its cover and links nowhere without an id', () => {
  const { activity } = makeDiscordCard(file, on, none);
  assert.equal(activity?.assets?.large_image, undefined);
  assert.equal(activity?.details_url, undefined);
  assert.deepEqual(activity?.buttons, [
    { label: 'Get wavebit', url: WAVEBIT_PAGE },
  ]);
  assert.equal(activity?.assets?.small_image, 'file');
});

test('a lossless file shows its quality as the hover text', () => {
  const quality = {
    codec: 'FLAC',
    lossless: true,
    sampleRateHz: 96_000,
    bitDepth: 24,
    bitrateKbps: 2_800,
    channels: 2,
  };
  assert.equal(
    qualityLine(quality),
    'Hi-Res Lossless · FLAC · 24-bit · 96 kHz',
  );
  assert.equal(
    qualityLine({ ...quality, sampleRateHz: 44_100, bitDepth: 16 }),
    'Lossless · FLAC · 16-bit · 44.1 kHz',
  );
  assert.equal(
    qualityLine({ ...quality, codec: 'MP3', lossless: false }),
    null,
  );
  const { activity } = makeDiscordCard(file, on, { private: false, quality });
  assert.equal(
    activity?.assets?.large_text,
    'Hi-Res Lossless · FLAC · 24-bit · 96 kHz',
  );
  const off = makeDiscordCard(
    file,
    { ...on, discordShowQuality: false },
    { private: false, quality },
  );
  assert.equal(off.activity?.assets?.large_text, 'Mezzanine');
});

test('button labels are filled, cleaned and cut to 32', () => {
  const long = {
    ...stream,
    title: 'A Very Long Song Title That Goes On And On',
  };
  const { activity } = makeDiscordCard(
    long,
    { ...on, discordAppButtonText: 'Hear {song_name}\u202e on wavebit' },
    none,
  );
  const label = activity?.buttons?.[1]?.label ?? '';
  assert.equal(Array.from(label).length, 32);
  assert.ok(label.endsWith('…'));
  assert.ok(!label.includes('\u202e'));
  const blank = makeDiscordCard(
    stream,
    { ...on, discordSongButtonText: '   ' },
    none,
  );
  assert.equal(blank.activity?.buttons?.[0]?.label, 'Listen on YouTube Music');
});

test('the song button leads where it plays, or to Spotify when asked', () => {
  const both = {
    youtubeId: 'MV_3Dpw-BRY',
    spotifyId: '4uLU6hMCjMI75M1A2tKUQC',
  };
  assert.equal(songLink(both, 'plays')?.label, 'Listen on YouTube Music');
  assert.equal(
    songLink(both, 'spotify')?.url,
    'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC',
  );
  assert.equal(songLink({ youtubeId: null, spotifyId: null }, 'spotify'), null);
});

test('status line, activity type and paused cards', () => {
  const song = makeDiscordCard(
    stream,
    { ...on, discordStatusDisplay: 'title', discordActivityType: 'playing' },
    none,
  );
  assert.equal(song.activity?.status_display_type, 2);
  assert.equal(song.activity?.type, 0);
  const paused = makeDiscordCard(
    { ...stream, playing: false },
    { ...on, discordWhenPaused: 'show', discordShowSource: false },
    none,
  );
  assert.equal(paused.activity?.timestamps, undefined);
  assert.equal(paused.activity?.assets?.small_text, 'Paused');
});

test('hidden characters and one-letter titles are made safe', () => {
  const { activity } = makeDiscordCard(
    { ...stream, title: 'X', artist: 'Art\u0007ist\u200b', album: '' },
    on,
    none,
  );
  assert.equal(activity?.details, 'X\u2800');
  assert.equal(activity?.state, 'Artist');
});
