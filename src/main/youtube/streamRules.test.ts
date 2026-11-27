import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  mediaContentType,
  mediaRangeAllowed,
  leaseActive,
  mayReleaseLease,
  selectFormats,
  streamUrlAllowed,
  streamResolverArgs,
  streamRequestAllowed,
  upstreamRange,
  parseContentRange,
  askedRange,
} from './streamRules.ts';
import {
  YtStreamResolveSchema,
  YtStreamReleaseSchema,
} from '../../shared/schemas/youtube.ts';

const info = {
  id: 'aqz-KE-bpKQ',
  duration: 120,
  formats: [
    {
      url: 'https://rr1---sn.googlevideo.com/audio',
      ext: 'm4a',
      vcodec: 'none',
      acodec: 'mp4a.40.2',
      abr: 128,
    },
    {
      url: 'https://rr1---sn.googlevideo.com/video',
      ext: 'mp4',
      vcodec: 'avc1.64001f',
      acodec: 'none',
      width: 1280,
      height: 720,
      fps: 30,
    },
  ],
};

test('stream resolver IPC accepts only an id, an opaque request id and supported heights', () => {
  const requestId = 'd7d9c58d-8aa1-4d97-99f7-28aa81186810';
  assert.ok(
    YtStreamResolveSchema.safeParse({
      requestId,
      videoId: 'aqz-KE-bpKQ',
      maxHeight: 720,
    }).success,
  );
  assert.ok(
    !YtStreamResolveSchema.safeParse({
      requestId,
      videoId: 'https://evil.test',
      maxHeight: 720,
    }).success,
  );
  assert.ok(
    !YtStreamResolveSchema.safeParse({
      requestId,
      videoId: 'aqz-KE-bpKQ',
      maxHeight: 9999,
    }).success,
  );
  assert.ok(
    !YtStreamResolveSchema.safeParse({
      requestId,
      videoId: 'aqz-KE-bpKQ',
      maxHeight: 720,
      url: 'https://evil.test',
    }).success,
  );
  assert.ok(
    YtStreamReleaseSchema.safeParse({ requestId: null, leaseId: requestId })
      .success,
  );
  assert.ok(
    !YtStreamReleaseSchema.safeParse({ requestId: null, leaseId: null })
      .success,
  );
});

test('only HTTPS googlevideo hosts may be proxied', () => {
  assert.ok(
    streamUrlAllowed('https://rr1---sn.googlevideo.com/videoplayback?x=1'),
  );
  assert.ok(!streamUrlAllowed('https://googlevideo.com.evil.test/a'));
  assert.ok(!streamUrlAllowed('https://googlevideo.com:8443/a'));
  assert.ok(!streamUrlAllowed('http://rr1.googlevideo.com/a'));
  assert.ok(!streamUrlAllowed('https://user:pass@rr1.googlevideo.com/a'));
});

test('resolver arguments use the fixed id URL and never accept cookies or config', () => {
  const args = streamResolverArgs({
    videoId: 'aqz-KE-bpKQ',
    denoPath: '/app/tools/deno',
  });
  for (const flag of [
    '--ignore-config',
    '--no-plugin-dirs',
    '--no-exec',
    '--no-playlist',
    '--skip-download',
  ])
    assert.ok(args.includes(flag));
  assert.ok(args.includes('deno:/app/tools/deno'));
  assert.ok(args.includes('--no-cache-dir'));
  assert.ok(
    !args.some((arg) => /cookie|remote-components|config-locations/i.test(arg)),
  );
  assert.equal(args.at(-2), '--');
  assert.equal(args.at(-1), 'https://music.youtube.com/watch?v=aqz-KE-bpKQ');
  assert.throws(() =>
    streamResolverArgs({
      videoId: 'https://evil.test',
      denoPath: '/deno',
    }),
  );
});

test('single byte ranges are accepted and malformed or multi ranges are refused', () => {
  assert.ok(mediaRangeAllowed(null));
  assert.ok(mediaRangeAllowed('bytes=0-'));
  assert.ok(mediaRangeAllowed('bytes=100-200'));
  assert.ok(mediaRangeAllowed('bytes=-500'));
  assert.ok(!mediaRangeAllowed('bytes=200-100'));
  assert.ok(!mediaRangeAllowed('bytes=999999999999999999999999-'));
  assert.ok(!mediaRangeAllowed('bytes=-'));
  assert.ok(!mediaRangeAllowed('bytes=0-1,4-5'));
  assert.ok(!mediaRangeAllowed('items=0-1'));
});

test('leases expire at their deadline and only their owner may release them', () => {
  assert.ok(leaseActive(2_000, 1_999));
  assert.ok(!leaseActive(2_000, 2_000));
  assert.ok(!leaseActive(Number.POSITIVE_INFINITY, 1_000));
  assert.ok(mayReleaseLease(7, 7));
  assert.ok(!mayReleaseLease(7, 8));
});

test('format selection returns separate audio and silent video streams under the cap', () => {
  const selected = selectFormats(info, 'aqz-KE-bpKQ', 720);
  assert.ok(selected);
  assert.equal(selected.audio.url, info.formats[0]!.url);
  assert.equal(selected.video.url, info.formats[1]!.url);
  assert.equal(selected.height, 720);
  assert.equal(selected.durationMs, 120_000);
  assert.deepEqual(selected.heights, [720]);
  assert.equal(mediaContentType('audio', selected.audio), 'audio/mp4');
  assert.equal(mediaContentType('video', selected.video), 'video/mp4');
  assert.equal(selectFormats(info, 'different-id', 720), null);
});

test('YouTube is asked for at most one piece at a time', () => {
  const MB = 1024 * 1024;
  assert.equal(upstreamRange(null, 8 * MB), `bytes=0-${8 * MB - 1}`);
  assert.equal(upstreamRange('bytes=0-', 8 * MB), `bytes=0-${8 * MB - 1}`);
  assert.equal(
    upstreamRange('bytes=50000000-', 8 * MB),
    `bytes=50000000-${50000000 + 8 * MB - 1}`,
  );
  // A smaller range is passed on whole; a suffix is left alone.
  assert.equal(upstreamRange('bytes=100-199', 8 * MB), 'bytes=100-199');
  assert.equal(upstreamRange('bytes=-4096', 8 * MB), 'bytes=-4096');
  assert.equal(
    upstreamRange(`bytes=0-${20 * MB}`, 8 * MB),
    `bytes=0-${8 * MB - 1}`,
  );
});

test('a stream request is refused only when it says it comes from elsewhere', () => {
  // As isTrustedOrigin reads it: app://wavebit, whatever the path.
  const trusted = (u: string) => {
    const url = URL.parse(u);
    return url?.protocol === 'app:' && url.host === 'wavebit';
  };
  // The player's own media requests carry neither header.
  assert.equal(streamRequestAllowed(null, null, trusted), true);
  assert.equal(
    streamRequestAllowed('app://wavebit', 'app://wavebit/index.html', trusted),
    true,
  );
  assert.equal(
    streamRequestAllowed('https://evil.example', null, trusted),
    false,
  );
  assert.equal(
    streamRequestAllowed(
      null,
      'https://www.youtube-nocookie.com/embed/x',
      trusted,
    ),
    false,
  );
  assert.equal(streamRequestAllowed(null, 'not a url', trusted), false);
  assert.equal(streamRequestAllowed('null', null, trusted), false);
});

test('an HLS playlist is never chosen as the video or the audio', () => {
  // As yt-dlp lists them: the HLS format first, with the same codec and height.
  const withHls = {
    ...info,
    formats: [
      {
        url: 'https://manifest.googlevideo.com/api/manifest/hls_playlist/x',
        ext: 'mp4',
        vcodec: 'avc1.4D4015',
        acodec: 'none',
        width: 640,
        height: 360,
        protocol: 'm3u8_native',
      },
      {
        url: 'https://rr1---sn.googlevideo.com/video360',
        ext: 'mp4',
        vcodec: 'avc1.4D4015',
        acodec: 'none',
        width: 640,
        height: 360,
        protocol: 'https',
      },
      {
        url: 'https://manifest.googlevideo.com/api/manifest/hls_playlist/a',
        ext: 'm4a',
        vcodec: 'none',
        acodec: 'mp4a.40.2',
        abr: 256,
        protocol: 'm3u8_native',
      },
      {
        url: 'https://rr1---sn.googlevideo.com/audio',
        ext: 'm4a',
        vcodec: 'none',
        acodec: 'mp4a.40.2',
        abr: 128,
        protocol: 'https',
      },
    ],
  };
  const picked = selectFormats(withHls, 'aqz-KE-bpKQ', 360);
  assert.equal(picked?.video.url, 'https://rr1---sn.googlevideo.com/video360');
  assert.equal(picked?.audio.url, 'https://rr1---sn.googlevideo.com/audio');
  assert.deepEqual(picked?.heights, [360]);
});

test('WebM is preferred, since YouTube’s MP4 files can’t be seeked into', () => {
  const both = {
    ...info,
    formats: [
      ...info.formats,
      {
        url: 'https://rr1---sn.googlevideo.com/opus',
        ext: 'webm',
        vcodec: 'none',
        acodec: 'opus',
        abr: 120,
        protocol: 'https',
      },
      {
        url: 'https://rr1---sn.googlevideo.com/vp9',
        ext: 'webm',
        vcodec: 'vp9',
        acodec: 'none',
        width: 1280,
        height: 720,
        fps: 30,
        protocol: 'https',
      },
    ],
  };
  const picked = selectFormats(both, 'aqz-KE-bpKQ', 720);
  assert.equal(picked?.audio.url, 'https://rr1---sn.googlevideo.com/opus');
  assert.equal(picked?.video.url, 'https://rr1---sn.googlevideo.com/vp9');
  assert.equal(picked?.mimeType, 'video/webm');
  // Without WebM, MP4 still plays.
  assert.equal(
    selectFormats(info, 'aqz-KE-bpKQ', 720)?.audio.url,
    'https://rr1---sn.googlevideo.com/audio',
  );
});

test('the player gets the whole range it asked for, as one answer', () => {
  assert.deepEqual(parseContentRange('bytes 0-1048575/59181741'), {
    start: 0,
    end: 1048575,
    total: 59181741,
  });
  for (const bad of [
    null,
    '',
    'bytes */100',
    'bytes 5-4/100',
    'bytes 0-100/100',
    'items 0-1/2',
  ])
    assert.equal(parseContentRange(bad), null, String(bad));
  assert.deepEqual(askedRange('bytes=655360-', 59181741), [655360, 59181740]);
  assert.deepEqual(askedRange('bytes=0-99', 1000), [0, 99]);
  assert.deepEqual(askedRange('bytes=900-5000', 1000), [900, 999]);
  assert.deepEqual(askedRange(null, 1000), [0, 999]);
  assert.equal(askedRange('bytes=1000-', 1000), null);
  assert.equal(askedRange('bytes=-500', 1000), null);
});
