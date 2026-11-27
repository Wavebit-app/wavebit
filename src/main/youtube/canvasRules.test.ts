import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCounterpart, pickCanvasVideo } from './canvasRules.ts';

const panel = (rows: unknown[]) => ({
  contents: { playlistPanelRenderer: { contents: rows } },
});
const row = (videoId: string) => ({ playlistPanelVideoRenderer: { videoId } });

test('a song’s music video, and where the song starts in it', () => {
  const root = panel([
    {
      playlistPanelVideoWrapperRenderer: {
        primaryRenderer: row('J7p4bzqLvCw'),
        counterpart: [
          {
            counterpartRenderer: row('4NRXx6U8ABQ'),
            segmentMap: {
              segment: [
                {
                  primaryVideoStartTimeMilliseconds: '0',
                  counterpartVideoStartTimeMilliseconds: '61000',
                  durationMilliseconds: '200000',
                },
              ],
            },
          },
        ],
      },
    },
    row('xxxxxxxxxxx'),
  ]);
  assert.deepEqual(parseCounterpart(root, 'J7p4bzqLvCw'), {
    videoId: '4NRXx6U8ABQ',
    offsetMs: 61000,
  });
});

test('no pairing, another song’s, or a bad id is nothing', () => {
  assert.equal(
    parseCounterpart(panel([row('J7p4bzqLvCw')]), 'J7p4bzqLvCw'),
    null,
  );
  const other = panel([
    {
      playlistPanelVideoWrapperRenderer: {
        primaryRenderer: row('AMCwYdTJ_PE'),
        counterpart: [{ counterpartRenderer: row('xvZqHgFz51I') }],
      },
    },
  ]);
  assert.equal(parseCounterpart(other, 'J7p4bzqLvCw'), null);
  const bad = panel([
    {
      playlistPanelVideoWrapperRenderer: {
        primaryRenderer: row('J7p4bzqLvCw'),
        counterpart: [{ counterpartRenderer: row('../../evil') }],
      },
    },
  ]);
  assert.equal(parseCounterpart(bad, 'J7p4bzqLvCw'), null);
  // No time map: the video is shown, looping, without a known offset.
  const unmapped = panel([
    {
      playlistPanelVideoWrapperRenderer: {
        primaryRenderer: row('J7p4bzqLvCw'),
        counterpart: [{ counterpartRenderer: row('4NRXx6U8ABQ') }],
      },
    },
  ]);
  assert.deepEqual(parseCounterpart(unmapped, 'J7p4bzqLvCw'), {
    videoId: '4NRXx6U8ABQ',
    offsetMs: 0,
  });
});

test('a search result is the music video only when it is the same song by the same artist', () => {
  const song = {
    videoId: 'J7p4bzqLvCw',
    title: 'Blinding Lights',
    artist: 'The Weeknd',
  };
  const video = (videoId: string, title: string, subtitle: string) => ({
    kind: 'video',
    title,
    subtitle,
    videoId,
  });
  assert.deepEqual(
    pickCanvasVideo(
      [
        {
          kind: 'song',
          title: 'Blinding Lights',
          subtitle: 'Song • The Weeknd',
          videoId: 'J7p4bzqLvCw',
        },
        video(
          'aaaaaaaaaaa',
          'Blinding Lights (Lyrics)',
          'Video • The Weeknd • 9M views',
        ),
        video(
          'bbbbbbbbbbb',
          'Blinding Lights (Live On The 2020 MTV VMAs)',
          'The Weeknd • 51M views',
        ),
        video(
          'ccccccccccc',
          'Blinding Lights (Piano Cover)',
          'Video • Someone Else',
        ),
        video(
          '4NRXx6U8ABQ',
          'Blinding Lights (Official Video)',
          'Video • The Weeknd • 1B views',
        ),
      ],
      song,
    ),
    { videoId: '4NRXx6U8ABQ', offsetMs: null },
  );
  // Another artist's song of the same name, or no artist to check: nothing.
  assert.equal(
    pickCanvasVideo(
      [
        video(
          'ddddddddddd',
          'Blinding Lights (Official Video)',
          'Video • Other Band',
        ),
      ],
      song,
    ),
    null,
  );
  assert.equal(
    pickCanvasVideo(
      [
        video(
          '4NRXx6U8ABQ',
          'Blinding Lights (Official Video)',
          'Video • The Weeknd',
        ),
      ],
      { ...song, artist: '' },
    ),
    null,
  );
  // Featured artists: the first one counts.
  assert.deepEqual(
    pickCanvasVideo(
      [
        video(
          'CQLsdm1ZYAw',
          'Rema, Selena Gomez - Calm Down (Official Music Video)',
          'Video • Rema • 1B views',
        ),
      ],
      {
        videoId: 'TG5nGZOmE-w',
        title: 'Calm Down',
        artist: 'Rema & Selena Gomez',
      },
    ),
    { videoId: 'CQLsdm1ZYAw', offsetMs: null },
  );
});
