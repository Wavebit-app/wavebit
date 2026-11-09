import assert from 'node:assert/strict';
import test from 'node:test';
import { notesFromCommits } from './release-notes.mjs';

test('sorts features and fixes under their headings', () => {
  assert.equal(
    notesFromCommits([
      'feat: add a mini player',
      'fix(audio): stop the crackle',
      'chore: bump deps',
    ]),
    '## New\n\n- Add a mini player\n\n## Fixed\n\n- Stop the crackle\n',
  );
});

test('a breaking feature still counts, and repeats are dropped', () => {
  assert.equal(
    notesFromCommits(['feat!: new library', 'feat: new library']),
    '## New\n\n- New library\n',
  );
});

test('a release of only maintenance still says something', () => {
  assert.match(
    notesFromCommits(['chore: tidy', 'ci: pin actions']),
    /Maintenance/,
  );
});
