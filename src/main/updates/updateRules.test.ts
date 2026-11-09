import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  errorKind,
  isNewer,
  isUnsignedMacError,
  nextLaunchState,
} from './updateRules.ts';

test('compares versions as numbers', () => {
  assert.equal(isNewer('1.10.0', '1.9.9'), true);
  assert.equal(isNewer('1.0.0', '1.0.0'), false);
  assert.equal(isNewer('1.0.0', '1.0.1'), false);
  assert.equal(isNewer('2.0', '1.9.9'), true);
});

test('a first install announces nothing', () => {
  assert.deepEqual(nextLaunchState(null, '1.0.0'), {
    lastVersion: '1.0.0',
    unseen: false,
  });
});

test('moving to a newer version announces it', () => {
  assert.deepEqual(
    nextLaunchState({ lastVersion: '1.0.0', unseen: false }, '1.1.0'),
    { lastVersion: '1.1.0', unseen: true },
  );
});

test('an unpressed label survives relaunches, a pressed one stays gone', () => {
  assert.equal(
    nextLaunchState({ lastVersion: '1.1.0', unseen: true }, '1.1.0').unseen,
    true,
  );
  assert.equal(
    nextLaunchState({ lastVersion: '1.1.0', unseen: false }, '1.1.0').unseen,
    false,
  );
});

test('going back a version announces nothing', () => {
  assert.equal(
    nextLaunchState({ lastVersion: '1.1.0', unseen: false }, '1.0.0').unseen,
    false,
  );
});

test('tells an unsigned macOS refusal from other errors', () => {
  assert.equal(
    isUnsignedMacError('Could not get code signature for running application'),
    true,
  );
  assert.equal(isUnsignedMacError('net::ERR_FAILED'), false);
});

test('names network failures', () => {
  assert.equal(errorKind('net::ERR_INTERNET_DISCONNECTED'), 'network');
  assert.equal(errorKind('HttpError: 404'), 'failed');
});
