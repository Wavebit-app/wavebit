import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseRelease, nextVersion, parseVersion } from './release-plan.mjs';

test('accepts stable tags only', () => {
  assert.deepEqual(parseVersion('v1.2.3'), [1, 2, 3]);
  for (const tag of [
    'v01.2.3',
    'v1.2.3-beta.1',
    '1.2',
    'x1.2.3',
    '1.2.3\nmalicious',
  ])
    assert.equal(parseVersion(tag), null);
});

test('patch by default; feature and breaking changes take precedence', () => {
  assert.equal(nextVersion('1.0.0', ['fix: repair audio']), '1.0.1');
  assert.equal(nextVersion('v1.0.9', []), '1.0.10');
  assert.equal(
    nextVersion('1.0.9', ['feat(audio): add device selection', 'fix: typo']),
    '1.1.0',
  );
  assert.equal(
    nextVersion('1.4.2', [
      'feat: device selection',
      'fix(api)!: remove old interface',
    ]),
    '2.0.0',
  );
  assert.equal(
    nextVersion('1.4.2', [
      'refactor: update API\n\nBREAKING CHANGE: drop old interface',
    ]),
    '2.0.0',
  );
  assert.equal(
    nextVersion('1.4.2', [
      'refactor: update API\n\nBREAKING-CHANGE: drop old interface',
    ]),
    '2.0.0',
  );
  assert.throws(() => nextVersion('invalid', []));
});

const releases = [
  { tag_name: 'v1.9.0', draft: false },
  { tag_name: 'v1.10.0', draft: false },
  { tag_name: 'v2.0.0', draft: false },
  { tag_name: 'v3.0.0', draft: true, target_commitish: 'draft-commit' },
  { tag_name: 'v4.0.0', draft: false, prerelease: true },
];
const resolve = (tag) =>
  ({
    'v1.9.0': 'older',
    'v1.10.0': 'previous',
    'v2.0.0': 'other-branch',
    'v4.0.0': 'preview',
  })[tag];

test('chooses highest numeric stable published ancestor, ignoring unrelated tags and drafts', () => {
  assert.equal(
    chooseRelease(releases, 'head', resolve, (sha) =>
      ['older', 'previous'].includes(sha),
    ).previous.tag_name,
    'v1.10.0',
  );
});

test('rerunning published commit reuses its tag even after newer releases', () => {
  assert.equal(
    chooseRelease(releases, 'older', resolve, () => true).current.tag_name,
    'v1.9.0',
  );
});

test('resumes draft on the same commit before GitHub has created its tag', () => {
  assert.equal(
    chooseRelease(releases, 'draft-commit', resolve, () => true).current
      .tag_name,
    'v3.0.0',
  );
});

test('first release has no predecessor', () => {
  assert.deepEqual(
    chooseRelease([], 'head', resolve, () => false),
    { previous: undefined },
  );
});
