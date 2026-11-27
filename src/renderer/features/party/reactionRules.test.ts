import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PARTY_REACTIONS } from '../../../shared/schemas/party.ts';
import {
  admit,
  current,
  FLOAT_MS,
  lane,
  MAX_FLOATS,
  MERGE_MS,
  REACTIONS,
  shouldAnnounce,
  spoken,
} from './reactionRules.ts';

test('the reactions are the server’s eight, each drawn and named here', () => {
  const server = JSON.parse(
    readFileSync(
      new URL('../../../../server/protocol/reactions.json', import.meta.url),
      'utf8',
    ),
  );
  assert.deepEqual([...PARTY_REACTIONS], server);
  for (const id of PARTY_REACTIONS) {
    assert.ok(REACTIONS[id].emoji && REACTIONS[id].name, id);
  }
});

test('a quick repeat from the same person shows a count instead of a pile', () => {
  let floats = admit([], { memberId: 'm', reaction: 'fire' }, 1_000, 1);
  floats = admit(floats, { memberId: 'm', reaction: 'fire' }, 1_200, 2);
  assert.equal(floats.length, 1);
  assert.equal(floats[0]?.count, 2);
  assert.equal(floats[0]?.at, 1_200);
  // Too late, another reaction, or someone else: new floats.
  floats = admit(
    floats,
    { memberId: 'm', reaction: 'fire' },
    1_200 + MERGE_MS,
    3,
  );
  floats = admit(floats, { memberId: 'm', reaction: 'clap' }, 1_700, 4);
  floats = admit(floats, { memberId: 'x', reaction: 'clap' }, 1_700, 5);
  assert.equal(floats.length, 4);
});

test('at most eight float at once, the oldest going first', () => {
  let floats = [] as ReturnType<typeof admit>;
  for (let i = 0; i < 12; i++) {
    floats = admit(floats, { memberId: `m${i}`, reaction: 'heart' }, i, i);
  }
  assert.equal(floats.length, MAX_FLOATS);
  assert.equal(floats[0]?.memberId, 'm4');
});

test('a float goes once its time is up', () => {
  const floats = admit([], { memberId: 'm', reaction: 'wow' }, 0, 1);
  assert.equal(current(floats, FLOAT_MS - 1).length, 1);
  assert.equal(current(floats, FLOAT_MS).length, 0);
});

test('lanes spread across the banner and repeat for the same key', () => {
  assert.equal(lane(3), lane(3));
  for (let k = 0; k < 50; k++) {
    assert.ok(lane(k) >= 8 && lane(k) < 78);
  }
});

test('screen readers hear one in three seconds, named', () => {
  assert.equal(shouldAnnounce(null, 0), true);
  assert.equal(shouldAnnounce(1_000, 3_999), false);
  assert.equal(shouldAnnounce(1_000, 4_000), true);
  assert.equal(spoken('Maya', 'fire'), 'Maya: Fire');
});
