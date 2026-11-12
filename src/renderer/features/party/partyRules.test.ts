import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  IDLE_PARTY,
  type PartyMember,
  type PartyPlayback,
  type PartyTrack,
} from '../../../shared/schemas/party.ts';
import {
  controlsLocked,
  bannerIndex,
  faultMessage,
  inviteLink,
  msUntilStart,
  newDrift,
  partyPositionMs,
  pingLevel,
  queueIndexOf,
  shouldSeek,
  supplierId,
} from './partyRules.ts';

const song = (
  videoId: string,
  durationMs: number | null = null,
): PartyTrack => ({
  videoId,
  title: videoId,
  artist: '',
  thumbnailUrl: null,
  durationMs,
  fromAutoplay: false,
});

const playing = (patch: Partial<PartyPlayback> = {}): PartyPlayback => ({
  ...IDLE_PARTY.playback,
  seq: 1,
  track: song('a', 200_000),
  isPlaying: true,
  positionMs: 42_000,
  anchorMs: 10_000,
  effectivePositionMs: 42_100,
  ...patch,
});

const member = (
  memberId: string,
  patch: Partial<PartyMember> = {},
): PartyMember => ({
  memberId,
  displayName: memberId,
  avatarUrl: null,
  isHost: false,
  connected: true,
  joinedAtMs: 0,
  ...patch,
});

test('the playhead is the position plus the time since the anchor', () => {
  assert.equal(partyPositionMs(playing(), 10_300), 42_300);
  // A frame that arrives late carries an older anchor and lands in the same place.
  assert.equal(
    partyPositionMs(playing({ anchorMs: 9_000, positionMs: 41_000 }), 10_300),
    42_300,
  );
});

test('before a scheduled start it holds, and it stops at the end of the song', () => {
  assert.equal(partyPositionMs(playing(), 9_800), 42_000);
  assert.equal(msUntilStart(playing(), 9_800), 200);
  assert.equal(msUntilStart(playing(), 10_300), 0);
  assert.equal(partyPositionMs(playing(), 10_000_000), 200_000);
});

test('paused, unmeasured and empty parties', () => {
  assert.equal(partyPositionMs(playing({ isPlaying: false }), 99_999), 42_000);
  assert.equal(partyPositionMs(playing(), null), 42_100);
  assert.equal(partyPositionMs(IDLE_PARTY.playback, 5), null);
  assert.equal(msUntilStart(playing({ isPlaying: false }), 0), 0);
});

test('a song in the queue twice is found by the state’s index, then by nearness', () => {
  const queue = {
    seq: 3,
    index: 2,
    items: [song('a'), song('b'), song('a'), song('c')],
  };
  assert.equal(
    queueIndexOf(queue, playing({ queueSeq: 3, queueIndex: 2 }), 'a'),
    2,
  );
  // The state is about an older queue: the queue's own index is the hint.
  assert.equal(
    queueIndexOf(queue, playing({ queueSeq: 2, queueIndex: 0 }), 'a'),
    2,
  );
  // Forward first: from index 1, the copy at 2 beats the one at 0.
  assert.equal(
    queueIndexOf({ ...queue, index: 1 }, playing({ queueSeq: 9 }), 'a'),
    2,
  );
  assert.equal(queueIndexOf(queue, playing(), 'zz'), -1);
  assert.equal(queueIndexOf(queue, playing(), null), -1);
});

test('one member supplies AutoPlay', () => {
  const host = member('m2', { isHost: true });
  assert.equal(supplierId([member('m1'), host], false), 'm2');
  const away = { ...host, connected: false };
  assert.equal(supplierId([member('m3'), member('m1'), away], false), 'm1');
  // Nobody stands in for a host who has locked the party.
  assert.equal(supplierId([member('m1'), away], true), null);
});

test('only a listener in a locked party is locked', () => {
  const you = member('me');
  assert.equal(
    controlsLocked({ code: 'K7M2QX', hostOnlyControl: true, you }),
    true,
  );
  assert.equal(
    controlsLocked({ code: 'K7M2QX', hostOnlyControl: false, you }),
    false,
  );
  assert.equal(
    controlsLocked({
      code: 'K7M2QX',
      hostOnlyControl: true,
      you: { ...you, isHost: true },
    }),
    false,
  );
  assert.equal(
    controlsLocked({ code: null, hostOnlyControl: true, you }),
    false,
  );
});

test('a new control is landed on once, within 120 ms', () => {
  const memory = newDrift();
  assert.equal(shouldSeek(memory, playing({ seq: 5 }), 300, 0), true);
  // The same state again (the heartbeat) with the same small drift is left alone.
  assert.equal(shouldSeek(memory, playing({ seq: 5 }), 300, 700), false);
  // A queue-only change raises the seq but moves nothing.
  assert.equal(shouldSeek(memory, playing({ seq: 6 }), 300, 1_400), false);
  assert.equal(shouldSeek(newDrift(), playing({ seq: 5 }), 100, 0), false);
});

test('drift is corrected on the second strike, then left for six seconds', () => {
  const memory = newDrift();
  const state = playing({ seq: 5 });
  shouldSeek(memory, state, 0, 0);
  assert.equal(shouldSeek(memory, state, 1_500, 700), false);
  assert.equal(shouldSeek(memory, state, 1_500, 1_400), true);
  assert.equal(shouldSeek(memory, state, 1_500, 2_100), false);
  assert.equal(shouldSeek(memory, state, 1_500, 6_000), false);
  // One reading back inside the limit clears the strikes.
  assert.equal(shouldSeek(memory, state, 200, 8_000), false);
  assert.equal(shouldSeek(memory, state, -1_500, 8_700), false);
  assert.equal(shouldSeek(memory, state, -1_500, 9_400), true);
});

test('ping levels, links and messages', () => {
  assert.deepEqual([38, 150, 400, 401].map(pingLevel), [
    'good',
    'slow',
    'slow',
    'poor',
  ]);
  assert.equal(
    inviteLink('K7M2QX', 'https://api.bitchord.kushagrasingh.in'),
    'wavebit://party/K7M2QX',
  );
  assert.equal(
    inviteLink('K7M2QX', 'https://party.example.com'),
    'wavebit://party/K7M2QX?server=https%3A%2F%2Fparty.example.com',
  );
  assert.equal(
    inviteLink('K7M2QX', null, 'https://example.org/invite/'),
    'https://example.org/invite/#K7M2QX',
  );
  assert.equal(
    inviteLink(
      'K7M2QX',
      'https://party.example.com',
      'https://example.org/invite/',
    ),
    'https://example.org/invite/?server=https%3A%2F%2Fparty.example.com#K7M2QX',
  );
  assert.equal(
    faultMessage({ code: 'no_such_party', message: 'x' }),
    'No party with that code.',
  );
  assert.equal(
    faultMessage({ code: 'new_thing', message: 'The server said so.' }),
    'The server said so.',
  );
});

test('everyone in a party gets the same banner', () => {
  assert.equal(bannerIndex('K7M2QX', 3), bannerIndex('K7M2QX', 3));
  assert.ok([0, 1, 2].includes(bannerIndex('K7M2QX', 3)));
  assert.notEqual(bannerIndex('AAAAAA', 3), bannerIndex('AAAAAB', 3));
  assert.equal(bannerIndex('K7M2QX', 0), 0);
});
