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
