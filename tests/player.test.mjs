import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FeedPoller, audibleTime, identity, trackPosition } from '../public/player.js';

test('joining radio mid-song publishes song position rather than connection time', () => {
  const start = Date.parse('2026-09-25T12:00:00Z');
  const track = { duration: 240 };
  assert.deepEqual(trackPosition(track, start, start + 93000), { duration: 240, position: 93, playbackRate: 1 });
  assert.equal(trackPosition(track, start, start - 22000).position, 0);
  assert.equal(trackPosition(track, start, start + 300000).position, 240);
  assert.equal(trackPosition({ duration: Infinity }, start), null);
  assert.equal(trackPosition({ duration: 0 }, start), null);
  assert.equal(trackPosition(track, NaN), null);
  assert.equal(trackPosition(null, start), null);
});

test('track timing follows the matching ID and advertised buffer, not fetch time', () => {
  const now = Date.parse('2026-09-25T12:00:10Z');
  const track = { subsonic_id: 'a', title: 'One', artist: 'Artist' };
  const state = { current: { ...track, startedAt: '2026-09-25T12:00:00Z' } };
  assert.equal(audibleTime(track, state, 22, now), now + 12000);
  assert.equal(audibleTime(track, state, 900, now), now + 50000);
  assert.equal(audibleTime(track, { current: { ...state.current, subsonic_id: 'b' } }, 22, now), now);
  assert.equal(audibleTime(track, { current: { ...state.current, startedAt: 'invalid' } }, 22, now), now);
  assert.equal(audibleTime(track, null, 22, now), now);
});
test('different recordings with identical titles have different identities', () => {
  assert.notEqual(identity({ title: 'Song', subsonic_id: 'a' }), identity({ title: 'Song', subsonic_id: 'b' }));
});
test('polling continues during hidden playback, stops when paused and resumes on return', async () => {
  let hidden = false, playing = false, now = 0, calls = 0;
  const p = new FeedPoller({ active: () => !hidden || playing, now: () => now, poll: async () => calls++ });
  await p.refresh(); assert.equal(calls, 1);
  hidden = true; now += 5000; await p.refresh(); assert.equal(calls, 1);
  playing = true; await p.refresh(); assert.equal(calls, 2);
  now += 5000; await p.refresh(); assert.equal(calls, 3);
  playing = false; now += 5000; await p.refresh(true); assert.equal(calls, 3);
  hidden = false; await p.refresh(true); assert.equal(calls, 4);
});
test('media events do not create overlapping requests or bypass the cadence', async () => {
  let calls = 0, finish;
  const p = new FeedPoller({ active: () => true, poll: () => { calls++; return new Promise(resolve => { finish = resolve; }); } });
  const first = p.refresh(); await p.refresh(true); assert.equal(calls, 1);
  finish(); await first; await p.refresh(); assert.equal(calls, 1);
});
test('a failed request releases the next retry', async () => {
  let calls = 0;
  const p = new FeedPoller({ active: () => true, poll: async () => { if (++calls === 1) throw new Error('network'); } });
  await assert.rejects(p.refresh()); await p.refresh(true); assert.equal(calls, 2);
});
