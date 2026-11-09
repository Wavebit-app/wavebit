import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseReleaseNotes } from './releaseNotes.ts';

test('reads headings and their items', () => {
  assert.deepEqual(
    parseReleaseNotes('## New\n- One\n- Two\n\n## Fixed\n* Three\n'),
    [
      { title: 'New', items: ['One', 'Two'] },
      { title: 'Fixed', items: ['Three'] },
    ],
  );
});

test('strips markup and leaves out what is not a list', () => {
  assert.deepEqual(
    parseReleaseNotes(
      '## New\n- **Bold** [link](https://x.dev) `code` <b>\n\nFull Changelog: https://x.dev',
    ),
    [{ title: 'New', items: ['Bold link code b'] }],
  );
});

test('items before any heading keep an empty title', () => {
  assert.deepEqual(parseReleaseNotes('- Alone'), [
    { title: '', items: ['Alone'] },
  ]);
});

test('an empty heading and an empty body give nothing', () => {
  assert.deepEqual(parseReleaseNotes('## New\n'), []);
  assert.deepEqual(parseReleaseNotes(''), []);
});
