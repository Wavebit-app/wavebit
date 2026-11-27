import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  newSecret,
  p2pLink,
  readHelperLine,
  safetyNumber,
} from './p2pRules.ts';

const PEER = '12D3KooWGzBf9Cg7Lr5dNrYJcDP6CQsk2r7mRAbjaGsLc2ZLA7zz';

test('the helper’s lines are read as untrusted', () => {
  assert.deepEqual(
    readHelperLine(`{"event":"ready","port":43121,"peerId":"${PEER}"}`),
    {
      event: 'ready',
      port: 43121,
      peerId: PEER,
    },
  );
  assert.deepEqual(readHelperLine('{"event":"links","direct":1,"relayed":2}'), {
    event: 'links',
    direct: 1,
    relayed: 2,
  });
  for (const junk of [
    '',
    'not json',
    '{"event":"ready","port":80,"peerId":"x"}',
    `{"event":"ready","port":43121,"peerId":"${PEER}","extra":1}`,
    '{"event":"links","direct":-1,"relayed":0}',
    '{"event":"error","code":"<script>"}',
    '{"event":"shell","cmd":"rm -rf"}',
    'x'.repeat(2_000),
  ])
    assert.equal(readHelperLine(junk), null, junk.slice(0, 40));
});

test('a safety number is the same for the same computer, and short', () => {
  const one = safetyNumber(PEER);
  assert.equal(one, safetyNumber(PEER));
  assert.match(one, /^[0-9A-Z]{4} · [0-9A-Z]{4}$/);
  assert.notEqual(one, safetyNumber(`${PEER.slice(0, -1)}y`));
});

test('a host’s link names the computer, its key, and a relay only when it isn’t the usual one', () => {
  const relay = `/dns4/relay.example.com/udp/4001/quic-v1/p2p/${PEER}`;
  assert.equal(
    p2pLink('K7M2QX', PEER, 'keykeykeykeykeykeykeyk', relay, relay),
    `wavebit://party/K7M2QX?peer=${PEER}&key=keykeykeykeykeykeykeyk`,
  );
  assert.equal(
    p2pLink('K7M2QX', PEER, 'keykeykeykeykeykeykeyk', relay, null),
    `wavebit://party/K7M2QX?peer=${PEER}&key=keykeykeykeykeykeykeyk&relay=${encodeURIComponent(relay)}`,
  );
});

test('secrets are url-safe and as long as asked', () => {
  const s = newSecret(16);
  assert.match(s, /^[A-Za-z0-9_-]{22}$/);
  assert.notEqual(s, newSecret(16));
});
