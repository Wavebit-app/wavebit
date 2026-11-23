import assert from 'node:assert/strict';
import test from 'node:test';
import { isRequestedVideo } from './youtubeEmbedRules.ts';

test('iframe reports are accepted only for the requested video', () => {
  assert.equal(isRequestedVideo('new-video', 'new-video'), true);
  assert.equal(isRequestedVideo('old-video', 'new-video'), false);
  assert.equal(isRequestedVideo('old-video', null), false);
  assert.equal(isRequestedVideo(null, 'new-video'), false);
});
