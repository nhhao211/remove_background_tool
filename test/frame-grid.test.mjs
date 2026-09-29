import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SEEK_PHASE,
  describePacing,
  evenPacingFpsOptions,
  frameIndexAt,
  frameSeekTime,
  frameTime,
  inferFrameGrid,
  isValidGrid,
  lastFrameIndex,
  planCrossfadeTwins,
  planLoopFrames,
  planSeekTimeAt,
  sampleTimes,
  seekTimeFor,
  snapTimeToFrame
} from '../public/js/frame-grid.js';

import { computeLoopTimestamps } from '../public/js/loop-optimizer.js';

const GRID30 = { frameDuration: 1 / 30, origin: 0, fps: 30 };
const near = (actual, expected, eps = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= eps, `expected ${expected}, got ${actual}`);

// Frames a probe would see: scattered across the clip plus one adjacent pair.
const PROBE_FRAMES = [4, 13, 14, 27, 41, 58, 73];

test('inferFrameGrid: recovers standard rates and snaps them', () => {
  for (const fps of [24, 25, 30, 60]) {
    const grid = inferFrameGrid(PROBE_FRAMES.map((k) => k / fps));
    assert.ok(grid, `no grid for ${fps}`);
    near(grid.fps, fps, 1e-9);
    assert.equal(grid.standard, true);
    near(grid.origin, 0, 1e-7);
  }
});

test('inferFrameGrid: NTSC 29.97 is not mistaken for 30', () => {
  const grid = inferFrameGrid(PROBE_FRAMES.map((k) => (k * 1001) / 30000));
  near(grid.fps, 30000 / 1001, 1e-9);
  assert.equal(grid.standard, true);
});

test('inferFrameGrid: millisecond-rounded PTS (WebM) still snap to the true rate', () => {
  const times = PROBE_FRAMES.map((k) => Math.round((k / 30) * 1000) / 1000);
  const grid = inferFrameGrid(times);
  near(grid.fps, 30, 1e-9);
  assert.ok(grid.maxResidual < 0.001);
});

test('inferFrameGrid: sparse millisecond PTS at 60 fps pick the right frame indices', () => {
  // One adjacent pair, then samples hundreds of frames away: a gap measured to
  // the millisecond is 4 % off, which alone would misplace the far samples.
  for (const fps of [60, 60000 / 1001, 24]) {
    const times = [10, 11, 180, 320, 470, 611].map((k) => Math.round((k / fps) * 1000) / 1000);
    const grid = inferFrameGrid(times);
    assert.ok(grid, `no grid for ${fps}`);
    near(grid.fps, fps, 1e-9);
  }
});

test('inferFrameGrid: exact PTS tell 29.97 and 30 apart over a clip', () => {
  const frames = [41, 42, 79, 126, 173, 207, 256];
  near(inferFrameGrid(frames.map((k) => k / 30)).fps, 30, 1e-9);
  near(inferFrameGrid(frames.map((k) => (k * 1001) / 30000)).fps, 30000 / 1001, 1e-9);
});

test('inferFrameGrid: keeps a non-zero phase', () => {
  const grid = inferFrameGrid(PROBE_FRAMES.map((k) => 0.0125 + (k / 25)));
  near(grid.fps, 25, 1e-9);
  near(grid.origin, 0.0125, 1e-7);
  // Frame 0 is the first frame at or after t = 0.
  assert.equal(frameIndexAt(0.0125, grid), 0);
});

test('inferFrameGrid: variable frame rate and thin probes give up', () => {
  assert.equal(inferFrameGrid([0, 0.033, 0.05, 0.1, 0.13, 0.21, 0.25]), null);
  assert.equal(inferFrameGrid([0.1, 0.2]), null);
  assert.equal(inferFrameGrid([0.1, 0.1, 0.1, 0.1]), null);
  assert.equal(inferFrameGrid(null), null);
  assert.equal(isValidGrid(null), false);
  assert.equal(isValidGrid(GRID30), true);
});

test('frameIndexAt: floor semantics with a boundary snap', () => {
  assert.equal(frameIndexAt(0.09, GRID30), 2);
  // Exactly on a PTS — the case a real seek gets wrong half the time.
  assert.equal(frameIndexAt(0.1, GRID30), 3);
  assert.equal(frameIndexAt(3 * (1 / 30) - 1e-10, GRID30), 3);
  // Trim inputs hold milliseconds: 0.133 means frame 4 (0.13333…).
  assert.equal(frameIndexAt(0.133, GRID30), 4);
  assert.equal(frameIndexAt(0.1 + (0.5 / 30), GRID30), 3);
  assert.equal(frameIndexAt(-1, GRID30), 0);
});

test('frameSeekTime / seekTimeFor aim at the middle of the frame', () => {
  near(frameSeekTime(3, GRID30), (3 + SEEK_PHASE) / 30);
  near(seekTimeFor(0.1, GRID30), 3.5 / 30);
  near(seekTimeFor(0.12, GRID30), 3.5 / 30);
  // No grid: the time passes through untouched.
  assert.equal(seekTimeFor(0.1, null), 0.1);
  near(snapTimeToFrame(0.12, GRID30), 0.1);
  assert.equal(snapTimeToFrame(0.12, null), 0.12);
});

test('lastFrameIndex: bounds the clip', () => {
  assert.equal(lastFrameIndex(GRID30, 1), 29);
  assert.equal(lastFrameIndex(GRID30, 1.01), 30);
  assert.equal(lastFrameIndex(GRID30, 0), Infinity);
});

test('sampleTimes matches the legacy computeLoopTimestamps', () => {
  for (const closed of [true, false]) {
    assert.deepEqual(sampleTimes(1, 3, 12, closed), computeLoopTimestamps(1, 3, 12, closed));
  }
});

test('planLoopFrames: whole-frame steps pace evenly and the wrap is one step', () => {
  const plan = planLoopFrames({ start: 1, end: 2, count: 15, closed: true, grid: GRID30, duration: 5 });
  assert.deepEqual(plan.frameIndices, Array.from({ length: 15 }, (_, i) => 30 + (2 * i)));
  assert.equal(plan.spanFrames, 30);
  assert.deepEqual(plan.steps, Array(15).fill(2));
  assert.equal(plan.evenPacing, true);
  assert.equal(plan.duplicateFrames, 0);
  plan.seekTimes.forEach((t, i) => near(t, (plan.frameIndices[i] + 0.5) / 30));
  plan.frameTimes.forEach((t, i) => near(t, plan.frameIndices[i] / 30));
  // Logical times are unchanged — strokes and regions bind to these.
  assert.deepEqual(plan.times, sampleTimes(1, 2, 15, true));
});

test('planLoopFrames: fractional steps alternate but still close the loop exactly', () => {
  const plan = planLoopFrames({ start: 1, end: 2, count: 12, closed: true, grid: GRID30, duration: 5 });
  assert.equal(plan.evenPacing, false);
  assert.equal(plan.minStep, 2);
  assert.equal(plan.maxStep, 3);
  assert.equal(plan.steps.reduce((a, b) => a + b, 0), 30);
  assert.equal(describePacing(plan).label, '2–3');
  assert.equal(describePacing(plan).even, false);
});

test('planLoopFrames: open range lands its last cell on the end frame', () => {
  const plan = planLoopFrames({ start: 1, end: 2, count: 16, closed: false, grid: GRID30, duration: 5 });
  assert.equal(plan.frameIndices[0], 30);
  assert.equal(plan.frameIndices[15], 60);
  assert.equal(plan.steps.length, 15);
  assert.deepEqual(plan.steps, Array(15).fill(2));
});

test('planLoopFrames: a trim point on a frame boundary is not a coin toss', () => {
  // 0.1 s trim snap on a 30 fps clip sits exactly on frame 3's PTS.
  const plan = planLoopFrames({ start: 0.1, end: 1.1, count: 10, closed: true, grid: GRID30, duration: 5 });
  assert.equal(plan.frameIndices[0], 3);
  assert.equal(plan.spanFrames, 30);
  // Every seek has half a frame of margin on both sides.
  for (let i = 0; i < plan.count; i++) {
    const phase = (plan.seekTimes[i] * 30) - plan.frameIndices[i];
    near(phase, 0.5, 1e-9);
  }
});

test('planLoopFrames: never plans a frame past the end of the clip', () => {
  const closed = planLoopFrames({ start: 0.5, end: 1, count: 5, closed: true, grid: GRID30, duration: 1 });
  assert.equal(closed.spanFrames, 15);
  assert.ok(closed.frameIndices.every((k) => k <= 29));
  const open = planLoopFrames({ start: 0.5, end: 1, count: 5, closed: false, grid: GRID30, duration: 1 });
  assert.equal(open.frameIndices[4], 29);
});

test('planLoopFrames: reports cells that have to repeat a frame', () => {
  const plan = planLoopFrames({ start: 1, end: 1.2, count: 10, closed: true, grid: GRID30, duration: 5 });
  assert.equal(plan.spanFrames, 6);
  assert.ok(plan.duplicateFrames > 0);
  assert.equal(describePacing(plan).duplicates, plan.duplicateFrames);
});

test('planLoopFrames: without a grid it is the legacy time sampling', () => {
  const plan = planLoopFrames({ start: 1, end: 3, count: 12, closed: true, grid: null, duration: 5 });
  assert.deepEqual(plan.seekTimes, computeLoopTimestamps(1, 3, 12, true));
  assert.equal(plan.frameIndices, null);
  assert.equal(describePacing(plan), null);
});

test('planSeekTimeAt: periodic twins one loop length away', () => {
  const plan = planLoopFrames({ start: 1, end: 2, count: 15, closed: true, grid: GRID30, duration: 5 });
  near(planSeekTimeAt(plan, 0), 30.5 / 30);
  // -1: the frame that plays right before cell 0 — cell 14's twin.
  near(planSeekTimeAt(plan, -1), 28.5 / 30);
  // N: the frame right after cell 14 — cell 0's twin.
  near(planSeekTimeAt(plan, 15), 60.5 / 30);

  const atZero = planLoopFrames({ start: 0, end: 1, count: 15, closed: true, grid: GRID30, duration: 5 });
  assert.equal(planSeekTimeAt(atZero, -1), null);

  const legacy = planLoopFrames({ start: 1, end: 2, count: 10, closed: true, grid: null, duration: 5 });
  near(planSeekTimeAt(legacy, -1), 0.9);
  near(planSeekTimeAt(legacy, 10), 2);
});

test('planCrossfadeTwins: tail cells ease into the pre-roll frames', () => {
  const plan = planLoopFrames({ start: 1, end: 2, count: 15, closed: true, grid: GRID30, duration: 5 });
  const fade = planCrossfadeTwins(plan, 3);
  assert.equal(fade.variant, 'tail');
  assert.equal(fade.count, 3);
  assert.deepEqual(fade.pairs.map((p) => p.cell), [14, 13, 12]);
  assert.deepEqual(fade.pairs.map((p) => p.twin), [-1, -2, -3]);
  near(fade.pairs[0].seekTime, 28.5 / 30);
  near(fade.pairs[2].seekTime, 24.5 / 30);
  // Smoothstep, heaviest next to the seam.
  near(fade.pairs[0].weight, 0.84375);
  near(fade.pairs[1].weight, 0.5);
  near(fade.pairs[2].weight, 0.15625);
});

test('planCrossfadeTwins: no pre-roll falls back to the head variant', () => {
  const plan = planLoopFrames({ start: 0, end: 1, count: 15, closed: true, grid: GRID30, duration: 5 });
  const fade = planCrossfadeTwins(plan, 3);
  assert.equal(fade.variant, 'head');
  assert.deepEqual(fade.pairs.map((p) => p.cell), [0, 1, 2]);
  near(fade.pairs[0].seekTime, 30.5 / 30);
  assert.ok(fade.pairs[0].weight > fade.pairs[2].weight);
});

test('planCrossfadeTwins: twins outside the clip shorten the fade', () => {
  // Loop starts on frame 2: one pre-roll twin; the clip ends at frame 35: two post-roll twins.
  const plan = planLoopFrames({ start: 2 / 30, end: 32 / 30, count: 15, closed: true, grid: GRID30, duration: 1.2 });
  const fade = planCrossfadeTwins(plan, 3);
  assert.equal(fade.variant, 'head');
  assert.equal(fade.count, 2);
  assert.equal(fade.requested, 3);
  near(fade.pairs[0].weight, (2 / 3) ** 2 * (3 - (4 / 3)));
});

test('planCrossfadeTwins: clamps to half the loop and turns off at 0', () => {
  const plan = planLoopFrames({ start: 1, end: 2, count: 4, closed: true, grid: GRID30, duration: 5 });
  assert.equal(planCrossfadeTwins(plan, 10).requested, 2);
  assert.equal(planCrossfadeTwins(plan, 10).count, 2);
  assert.deepEqual(planCrossfadeTwins(plan, 0).pairs, []);
  assert.equal(planCrossfadeTwins(null, 3).variant, null);
});

test('evenPacingFpsOptions: only rates that step whole source frames', () => {
  const at1x = evenPacingFpsOptions(30, 1, 24, { min: 8, max: 30 }).map((o) => o.fps);
  assert.deepEqual(at1x, [30, 15, 10]);
  assert.ok(!at1x.includes(12));
  const at2x = evenPacingFpsOptions(30, 2, 24, { min: 8, max: 24 });
  assert.deepEqual(at2x.map((o) => o.fps), [20, 15, 12, 10]);
  assert.equal(at2x.find((o) => o.fps === 12).step, 5);
  assert.deepEqual(evenPacingFpsOptions(0, 1, 24), []);
});
