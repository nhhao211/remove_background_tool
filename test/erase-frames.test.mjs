import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ORPHAN_FRAME,
  isGlobalStroke,
  resolveStrokeFrame,
  strokesForFrame,
  eraseStrokePlan
} from '../public/js/erase-frames.js';

import { normalizeStrokes } from '../public/js/stroke-mask.js';

const stroke = (extra = {}) => ({
  mode: 'add',
  points: [{ x: 0.5, y: 0.5 }],
  size: 80,
  strength: 1,
  hardness: 0.8,
  frame: null,
  frameTime: null,
  ...extra
});

// Six frames evenly spaced across a two-second trim.
const times = [0, 0.4, 0.8, 1.2, 1.6, 2];

test('a stroke with no frame belongs to every frame', () => {
  assert.equal(isGlobalStroke(stroke()), true);
  assert.equal(isGlobalStroke(stroke({ frame: undefined })), true);
  assert.equal(isGlobalStroke(stroke({ frame: 0 })), false);
  assert.equal(resolveStrokeFrame(stroke(), times, 6), null);
});

test('a frame-bound stroke resolves to its own index when nothing has changed', () => {
  assert.equal(resolveStrokeFrame(stroke({ frame: 3, frameTime: 1.2 }), times, 6), 3);
  assert.equal(resolveStrokeFrame(stroke({ frame: 0, frameTime: 0 }), times, 6), 0);
  assert.equal(resolveStrokeFrame(stroke({ frame: 5, frameTime: 2 }), times, 6), 5);
});

test('a changed frame count re-binds the stroke by time, not by index', () => {
  // The same clip regenerated at 11 frames: what was frame 3 of 6 (t=1.2) is
  // now frame 6 of 11, and the index alone would have pointed at t=0.6.
  const denser = [0, 0.2, 0.4, 0.6, 0.8, 1.0, 1.2, 1.4, 1.6, 1.8, 2.0];
  assert.equal(resolveStrokeFrame(stroke({ frame: 3, frameTime: 1.2 }), denser, 11), 6);
  // And back the other way: a coarser sheet snaps to the nearest surviving frame.
  assert.equal(resolveStrokeFrame(stroke({ frame: 6, frameTime: 1.2 }), [0, 1, 2], 3), 1);
});

test('the nearest frame wins even when no timestamp matches exactly', () => {
  assert.equal(resolveStrokeFrame(stroke({ frame: 2, frameTime: 0.95 }), times, 6), 2);
  assert.equal(resolveStrokeFrame(stroke({ frame: 2, frameTime: 1.05 }), times, 6), 3);
});

test('a binding that cannot be honoured is orphaned rather than clamped', () => {
  // No timestamps to re-bind against and the index is past the end: applying it
  // to the last frame would erase content the user never pointed at.
  assert.equal(resolveStrokeFrame(stroke({ frame: 9 }), null, 6), ORPHAN_FRAME);
  assert.equal(resolveStrokeFrame(stroke({ frame: 9 }), [], 6), ORPHAN_FRAME);
  // Nothing generated yet: there is no frame to belong to.
  assert.equal(resolveStrokeFrame(stroke({ frame: 0, frameTime: 0 }), times, 0), ORPHAN_FRAME);
});

test('a short timestamp list is ignored so a half-filled sheet cannot mis-bind', () => {
  assert.equal(resolveStrokeFrame(stroke({ frame: 4, frameTime: 1.6 }), [0, 0.4], 6), 4);
});

test('strokesForFrame keeps global and frame-bound strokes in paint order', () => {
  const first = stroke({ points: [{ x: 0.1, y: 0.1 }] });
  const local = stroke({ points: [{ x: 0.2, y: 0.2 }], frame: 2, frameTime: 0.8 });
  const other = stroke({ points: [{ x: 0.3, y: 0.3 }], frame: 4, frameTime: 1.6 });
  const rub = stroke({ mode: 'subtract', points: [{ x: 0.4, y: 0.4 }] });
  const all = [first, local, other, rub];

  assert.deepEqual(strokesForFrame(all, 2, times, 6), [first, local, rub]);
  assert.deepEqual(strokesForFrame(all, 4, times, 6), [first, other, rub]);
  assert.deepEqual(strokesForFrame(all, 0, times, 6), [first, rub]);
  assert.deepEqual(strokesForFrame([], 0, times, 6), []);
});

test('an orphaned stroke reaches no frame at all', () => {
  const lost = stroke({ frame: 12 });
  const kept = stroke();
  const all = [kept, lost];
  for (let index = 0; index < 6; index += 1) {
    assert.deepEqual(strokesForFrame(all, index, null, 6), [kept]);
  }
});

test('the plan names only the frames that need a mask of their own', () => {
  const globalOne = stroke();
  const onTwo = stroke({ frame: 2, frameTime: 0.8 });
  const onTwoAgain = stroke({ frame: 2, frameTime: 0.8 });
  const lost = stroke({ frame: 40 });
  const plan = eraseStrokePlan([globalOne, onTwo, onTwoAgain, lost], times, 6);

  assert.deepEqual(plan.globalStrokes, [globalOne]);
  assert.deepEqual([...plan.frameIndices], [2]);
  assert.equal(plan.boundCount, 3);
  assert.equal(plan.orphanCount, 1);
});

test('an empty stroke list plans no work', () => {
  const plan = eraseStrokePlan([], times, 6);
  assert.deepEqual(plan.globalStrokes, []);
  assert.equal(plan.frameIndices.size, 0);
  assert.equal(plan.boundCount, 0);
  assert.equal(plan.orphanCount, 0);
});

test('the binding survives the round trip through localStorage normalization', () => {
  const saved = normalizeStrokes([
    stroke({ frame: 3, frameTime: 1.2 }),
    stroke(),
    // Legacy strokes carry neither field and must stay global.
    { mode: 'add', points: [{ x: 0.5, y: 0.5 }], size: 80, strength: 1, hardness: 0.8 }
  ]);

  assert.equal(saved[0].frame, 3);
  assert.equal(saved[0].frameTime, 1.2);
  assert.equal(saved[1].frame, null);
  assert.equal(saved[2].frame, null);
  assert.equal(resolveStrokeFrame(saved[0], times, 6), 3);
  assert.equal(resolveStrokeFrame(saved[2], times, 6), null);
});

test('a nonsense binding normalizes away instead of poisoning the plan', () => {
  const saved = normalizeStrokes([
    stroke({ frame: -2, frameTime: 1 }),
    stroke({ frame: 1.7, frameTime: 'later' })
  ]);
  assert.equal(saved[0].frame, null);
  assert.equal(saved[1].frame, 1);
  assert.equal(saved[1].frameTime, null);
  // With no usable timestamp the index is still honoured.
  assert.equal(resolveStrokeFrame(saved[1], times, 6), 1);
});
