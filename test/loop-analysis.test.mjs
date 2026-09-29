import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildFrameDescriptor,
  descriptorDistance,
  findLoopCandidates,
  hasUsableMatte,
  refineSeamOnFrames,
  seamCostAt,
  seamJumpFrames,
  seamJumpRatio,
  seamRefinementFrames
} from '../public/js/loop-analysis.js';

import { computeFrameDistance, computeLoopTimestamps } from '../public/js/loop-optimizer.js';

const W = 64;
const H = 64;

/**
 * Renders a synthetic keyed frame: an opaque disc on a fully transparent field.
 */
function disc(cx, cy, radius = 7, rgb = [230, 90, 40], width = W, height = H) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = ((y * width) + x) * 4;
      const inside = ((x - cx) ** 2) + ((y - cy) ** 2) <= radius * radius;
      if (inside) {
        data[idx] = rgb[0];
        data[idx + 1] = rgb[1];
        data[idx + 2] = rgb[2];
        data[idx + 3] = 255;
      }
    }
  }
  return { data, width, height };
}

/** Opaque frame with a moving bright square, for the no-matte code path. */
function opaqueFrame(cx, cy, size = 12, width = W, height = H) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = ((y * width) + x) * 4;
      const inside = Math.abs(x - cx) <= size / 2 && Math.abs(y - cy) <= size / 2;
      data[idx] = inside ? 240 : 20;
      data[idx + 1] = inside ? 220 : 24;
      data[idx + 2] = inside ? 60 : 30;
      data[idx + 3] = 255;
    }
  }
  return { data, width, height };
}

/**
 * Builds a sequence whose subject orbits with an exact period of `period`
 * samples, so a seamless loop exists at every phase.
 */
function orbitSequence(count, period, { radius = 16, jitter = 0, render = disc } = {}) {
  const descriptors = [];
  for (let i = 0; i < count; i++) {
    const phase = (2 * Math.PI * (i % period)) / period;
    const cx = (W / 2) + (radius * Math.cos(phase)) + (jitter ? Math.sin(i * 12.9898) * jitter : 0);
    const cy = (H / 2) + (radius * Math.sin(phase));
    descriptors.push(buildFrameDescriptor(render(cx, cy), W, H));
  }
  return descriptors;
}

function uniformTimes(count, dt) {
  return Array.from({ length: count }, (_, i) => i * dt);
}

test('computeLoopTimestamps: closed loop leaves no duplicate seam frame', () => {
  const closed = computeLoopTimestamps(0, 1, 4, true);
  assert.deepEqual(closed, [0, 0.25, 0.5, 0.75]);

  const open = computeLoopTimestamps(0, 1, 5, false);
  assert.deepEqual(open, [0, 0.25, 0.5, 0.75, 1]);

  assert.deepEqual(computeLoopTimestamps(2, 2, 3, true), [2, 2, 2]);
  assert.equal(computeLoopTimestamps(0, 1, 0, true).length, 1);
});

test('buildFrameDescriptor: reports coverage and centroid of the subject', () => {
  const centred = buildFrameDescriptor(disc(32, 32, 8), W, H);
  const expectedCoverage = (Math.PI * 64) / (W * H);
  assert.ok(Math.abs(centred.coverage - expectedCoverage) < 0.02, `coverage ${centred.coverage}`);
  assert.ok(Math.abs(centred.cx - 0.5) < 0.02);
  assert.ok(Math.abs(centred.cy - 0.5) < 0.02);

  const shifted = buildFrameDescriptor(disc(48, 32, 8), W, H);
  assert.ok(shifted.cx > 0.68, `cx ${shifted.cx}`);
  assert.ok(Math.abs(shifted.cy - 0.5) < 0.02);
});

test('descriptorDistance: identical frames are zero, disjoint silhouettes are large', () => {
  const a = buildFrameDescriptor(disc(32, 32), W, H);
  const b = buildFrameDescriptor(disc(32, 32), W, H);
  assert.equal(descriptorDistance(a, b, { matte: true }), 0);

  const far = buildFrameDescriptor(disc(52, 32), W, H);
  assert.ok(descriptorDistance(a, far, { matte: true }) > 0.6, 'disjoint discs must score far apart');
});

test('descriptorDistance: a small subject moving its own width is not "99% similar"', () => {
  // The frame-normalised metric this replaces divided by 64*64 pixels, so a
  // 3px subject could move clean off itself and still read as a ~99% match.
  const a = buildFrameDescriptor(disc(30, 32, 3), W, H);
  const b = buildFrameDescriptor(disc(37, 32, 3), W, H);
  const d = descriptorDistance(a, b, { matte: true });
  assert.ok(d > 0.5, `expected a decisive distance for a fully displaced subject, got ${d}`);
});

test('descriptorDistance: distance grows monotonically with displacement', () => {
  const base = buildFrameDescriptor(disc(32, 32), W, H);
  let previous = -1;
  for (const dx of [0, 2, 4, 6, 9, 13]) {
    const d = descriptorDistance(base, buildFrameDescriptor(disc(32 + dx, 32), W, H), { matte: true });
    assert.ok(d >= previous - 1e-9, `distance dropped at dx=${dx} (${d} < ${previous})`);
    previous = d;
  }
});

test('hasUsableMatte: distinguishes keyed footage from opaque footage', () => {
  assert.equal(hasUsableMatte([buildFrameDescriptor(disc(32, 32), W, H)]), true);
  assert.equal(hasUsableMatte([buildFrameDescriptor(opaqueFrame(32, 32), W, H)]), false);
});

test('findLoopCandidates: recovers the true period of an orbiting subject', () => {
  const period = 16;
  const dt = 0.05;
  const descriptors = orbitSequence(120, period);
  const { candidates, diagnostics } = findLoopCandidates(descriptors, uniformTimes(120, dt), {
    minCycle: 0.3,
    maxCycle: 1.5,
    playbackSpeed: 1,
    targetFps: 12,
    targetFrames: 10,
    weights: { seam: 0.7, period: 0.3, frameFit: 0, activity: 0 }
  });

  assert.equal(diagnostics.mode, 'matte');
  assert.ok(candidates.length > 0, 'expected at least one candidate');
  const best = candidates[0];
  assert.ok(
    Math.abs(best.duration - (period * dt)) < dt * 1.01,
    `expected ~${period * dt}s cycle, got ${best.duration}s`
  );
  assert.ok(best.visualScore > 95, `a synthetic exact loop should score high, got ${best.visualScore}`);
  assert.ok(best.periodScore > 40, `periodicity should be detected, got ${best.periodScore}`);
});

test('findLoopCandidates: survives per-frame jitter and works on opaque footage', () => {
  const period = 12;
  const dt = 0.04;
  const descriptors = orbitSequence(96, period, { jitter: 0.6, render: opaqueFrame });
  const { candidates, diagnostics } = findLoopCandidates(descriptors, uniformTimes(96, dt), {
    minCycle: 0.2,
    maxCycle: 1.0,
    playbackSpeed: 1,
    targetFps: 25,
    targetFrames: 12,
    weights: { seam: 0.7, period: 0.3, frameFit: 0, activity: 0 }
  });

  assert.equal(diagnostics.mode, 'opaque');
  assert.ok(candidates.length > 0);
  assert.ok(
    Math.abs(candidates[0].duration - (period * dt)) < dt * 1.01,
    `expected ~${period * dt}s cycle, got ${candidates[0].duration}s`
  );
});

test('findLoopCandidates: a frozen clip yields no motion activity', () => {
  const descriptors = Array.from({ length: 60 }, () => buildFrameDescriptor(disc(32, 32), W, H));
  const { candidates } = findLoopCandidates(descriptors, uniformTimes(60, 0.05), {
    minCycle: 0.3,
    maxCycle: 1.2,
    targetFps: 12,
    targetFrames: 10
  });

  assert.ok(candidates.length > 0, 'a static clip still yields cuts, but they must be flagged');
  for (const cand of candidates) {
    assert.equal(cand.motionActivityScore, 0, 'a freeze must not be sold as a lively loop');
  }
});

test('findLoopCandidates: frame-fit steers the choice between two valid periods', () => {
  // The subject orbits with period 10; period 20 is an equally seamless loop.
  const dt = 0.05;
  const descriptors = orbitSequence(140, 10);
  const times = uniformTimes(140, dt);
  const common = { minCycle: 0.3, maxCycle: 1.4, playbackSpeed: 1, targetFps: 20 };

  const short = findLoopCandidates(descriptors, times, { ...common, targetFrames: 10 });
  const long = findLoopCandidates(descriptors, times, { ...common, targetFrames: 20 });

  assert.ok(Math.abs(short.candidates[0].duration - 0.5) < dt * 1.01, `short: ${short.candidates[0].duration}`);
  assert.ok(Math.abs(long.candidates[0].duration - 1.0) < dt * 1.01, `long: ${long.candidates[0].duration}`);
  assert.equal(short.candidates[0].calculatedFrames, 10);
  assert.equal(long.candidates[0].calculatedFrames, 20);
});

test('findLoopCandidates: non-uniform sample times are handled', () => {
  const period = 16;
  const dt = 0.05;
  const descriptors = orbitSequence(120, period);
  // Simulate a decoder that snapped some seeks to the previous source frame.
  const times = uniformTimes(120, dt).map((t, i) => t + ((i % 3 === 0) ? 0.004 : 0));
  const { candidates } = findLoopCandidates(descriptors, times, {
    minCycle: 0.3,
    maxCycle: 1.5,
    targetFps: 12,
    targetFrames: 10,
    weights: { seam: 0.7, period: 0.3, frameFit: 0, activity: 0 }
  });
  assert.ok(Math.abs(candidates[0].duration - (period * dt)) < dt * 1.2);
});

test('findLoopCandidates: candidates are de-duplicated and ranked', () => {
  const descriptors = orbitSequence(120, 16);
  const { candidates } = findLoopCandidates(descriptors, uniformTimes(120, 0.05), {
    minCycle: 0.3,
    maxCycle: 1.5,
    targetFps: 12,
    targetFrames: 10,
    maxCandidates: 6,
    minSeparation: 0.2
  });

  assert.ok(candidates.length <= 6);
  for (let i = 1; i < candidates.length; i++) {
    assert.ok(candidates[i - 1].score >= candidates[i].score, 'candidates must be sorted by score');
  }
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const sameEdges =
        Math.abs(candidates[i].startTime - candidates[j].startTime) < 0.2 &&
        Math.abs(candidates[i].endTime - candidates[j].endTime) < 0.2;
      assert.equal(sameEdges, false, 'NMS must not return near-identical cuts');
    }
  }
});

test('findLoopCandidates: degenerate inputs return empty results', () => {
  assert.deepEqual(findLoopCandidates([], [], {}).candidates, []);
  assert.deepEqual(findLoopCandidates([1, 2], [0, 1], {}).candidates, []);
  const flat = Array.from({ length: 10 }, () => buildFrameDescriptor(disc(32, 32), W, H));
  assert.deepEqual(findLoopCandidates(flat, new Array(10).fill(0), {}).candidates, []);
});

test('seamCostAt: matches the ranking metric for a known seam', () => {
  const period = 16;
  const descriptors = orbitSequence(64, period);
  const perfect = seamCostAt(descriptors, 4, 4 + period, { matte: true });
  const offBy = seamCostAt(descriptors, 4, 4 + period + 4, { matte: true });
  assert.ok(perfect < 1e-6, `an exact-period seam must be free, got ${perfect}`);
  assert.ok(offBy > perfect + 0.2, 'a mis-phased seam must cost clearly more');
});

test('computeFrameDistance: keeps the {distance, similarity} contract', () => {
  const a = disc(32, 32);
  const b = disc(32, 32);
  const same = computeFrameDistance(a, b, W, H);
  assert.equal(same.distance, 0);
  assert.equal(same.similarity, 100);

  const moved = computeFrameDistance(a, disc(50, 32), W, H);
  assert.ok(moved.distance > 0.5);
  assert.ok(moved.similarity < 50);

  assert.deepEqual(computeFrameDistance(null, b, W, H), { distance: 1, similarity: 0 });
});

test('findLoopCandidates: 240-sample scan stays well inside interactive budget', () => {
  const descriptors = orbitSequence(240, 20);
  const times = uniformTimes(240, 0.05);
  const started = process.hrtime.bigint();
  const { candidates, diagnostics } = findLoopCandidates(descriptors, times, {
    minCycle: 0.4,
    maxCycle: 3.0,
    targetFps: 12,
    targetFrames: 12,
    frameMode: 'nearest'
  });
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

  assert.ok(candidates.length > 0);
  // The pruned pipeline refines a small fraction of the pairs it scans.
  assert.ok(
    diagnostics.pairsRefined < diagnostics.pairsScanned * 0.25,
    `refined ${diagnostics.pairsRefined} of ${diagnostics.pairsScanned}`
  );
  assert.ok(elapsedMs < 1500, `ranking took ${elapsedMs.toFixed(0)}ms`);

  // Exact mode narrows the duration band up front, so it never even scans the
  // pairs the nearest-mode pass has to prune away.
  const exact = findLoopCandidates(descriptors, times, {
    minCycle: 0.4,
    maxCycle: 3.0,
    targetFps: 12,
    targetFrames: 12,
    frameMode: 'exact'
  });
  assert.ok(
    exact.diagnostics.pairsScanned < diagnostics.pairsScanned * 0.25,
    `exact scanned ${exact.diagnostics.pairsScanned} vs nearest ${diagnostics.pairsScanned}`
  );
});

test('frame mode exact: every candidate lands on the requested frame count', () => {
  const descriptors = orbitSequence(200, 16);
  const times = uniformTimes(200, 0.05);

  for (const targetFrames of [8, 12, 16, 24]) {
    const { candidates, diagnostics } = findLoopCandidates(descriptors, times, {
      minCycle: 0.2,
      maxCycle: 4.0,
      targetFps: 12,
      targetFrames,
      frameMode: 'exact'
    });
    assert.equal(diagnostics.frameMode, 'exact', `mode fell back for ${targetFrames}f`);
    assert.ok(candidates.length > 0, `no candidate for ${targetFrames}f`);
    for (const cand of candidates) {
      assert.equal(
        cand.calculatedFrames,
        targetFrames,
        `wanted ${targetFrames}f, got ${cand.calculatedFrames}f`
      );
      assert.equal(cand.exactFrames, true);
      assert.equal(cand.speed, cand.requestedSpeed, 'exact mode must not retune speed');
    }
  }
});

test('frame mode exact: honours the tolerance band', () => {
  const descriptors = orbitSequence(200, 16);
  const times = uniformTimes(200, 0.05);
  const { candidates } = findLoopCandidates(descriptors, times, {
    minCycle: 0.2,
    maxCycle: 4.0,
    targetFps: 12,
    targetFrames: 12,
    frameTolerance: 2,
    frameMode: 'exact'
  });
  assert.ok(candidates.length > 0);
  for (const cand of candidates) {
    assert.ok(
      Math.abs(cand.calculatedFrames - 12) <= 2,
      `${cand.calculatedFrames}f is outside the ±2 band`
    );
  }
});

test('frame mode exact: falls back when the requested length cannot exist', () => {
  const descriptors = orbitSequence(60, 12);
  const times = uniformTimes(60, 0.05);
  // 400 frames at 12fps is 33s of output; the clip is 3s long.
  const { diagnostics } = findLoopCandidates(descriptors, times, {
    minCycle: 0.2,
    maxCycle: 2.0,
    targetFps: 12,
    targetFrames: 400,
    frameMode: 'exact'
  });
  assert.equal(diagnostics.frameModeFallback, true);
  assert.equal(diagnostics.frameMode, 'nearest');
});

test('frame mode speed: retunes tempo so the frame count is always exact', () => {
  const descriptors = orbitSequence(200, 17);
  const times = uniformTimes(200, 0.05);
  const { candidates, diagnostics } = findLoopCandidates(descriptors, times, {
    minCycle: 0.3,
    maxCycle: 3.0,
    targetFps: 12,
    targetFrames: 15,
    frameMode: 'speed'
  });
  assert.equal(diagnostics.frameMode, 'speed');
  assert.ok(candidates.length > 0);
  for (const cand of candidates) {
    assert.equal(cand.calculatedFrames, 15);
    assert.equal(cand.exactFrames, true);
    assert.ok(cand.speed >= 0.1 && cand.speed <= 16, `speed ${cand.speed} out of range`);
    assert.ok(
      Math.abs(cand.effectiveDuration - (15 / 12)) < 1e-9,
      `output length ${cand.effectiveDuration}s should be 15/12s`
    );
    // The tempo must be representable by the 2-decimal speed control.
    assert.equal(cand.speed, Math.round(cand.speed * 100) / 100);
  }
});

test('frame mode nearest: keeps the legacy soft-scoring behaviour', () => {
  const descriptors = orbitSequence(200, 16);
  const times = uniformTimes(200, 0.05);
  const { candidates, diagnostics } = findLoopCandidates(descriptors, times, {
    minCycle: 0.2,
    maxCycle: 4.0,
    targetFps: 12,
    targetFrames: 12,
    frameMode: 'nearest'
  });
  assert.equal(diagnostics.frameMode, 'nearest');
  assert.equal(diagnostics.frameModeFallback, false);
  assert.ok(candidates.length > 0);
  // The whole cycle range stays reachable rather than being clipped to a band.
  assert.ok(diagnostics.bandLo <= 0.2 + 1e-9);
  assert.ok(diagnostics.bandHi >= 4.0 - 1e-9);
});

test('findLoopCandidates: reports the output-frame stride it used', () => {
  const descriptors = orbitSequence(120, 16);
  const times = uniformTimes(120, 0.05);
  // 1x speed at 12fps = 0.0833s per output frame vs a 0.05s sample step → 2.
  const { diagnostics } = findLoopCandidates(descriptors, times, {
    minCycle: 0.2,
    maxCycle: 3.0,
    targetFps: 12,
    targetFrames: 12,
    frameMode: 'nearest'
  });
  assert.ok(Math.abs(diagnostics.outputStep - (1 / 12)) < 1e-9);
  assert.equal(diagnostics.windowStride, 2);

  const forced = findLoopCandidates(descriptors, times, {
    minCycle: 0.2,
    maxCycle: 3.0,
    targetFps: 12,
    targetFrames: 12,
    frameMode: 'nearest',
    windowStride: 1
  });
  assert.equal(forced.diagnostics.windowStride, 1);
});

// --- Native-frame seam refinement --------------------------------------------

/**
 * Distance between native frames of a subject circling with a period of
 * `period` frames: the chord between the two phases, plus a constant floor so
 * near-ties are decided by the tie-breakers rather than by an exact zero.
 */
function orbitDistance(period, floor = 0) {
  const phase = (k) => (2 * Math.PI * k) / period;
  return (a, b) => {
    const dx = Math.cos(phase(a)) - Math.cos(phase(b));
    const dy = Math.sin(phase(a)) - Math.sin(phase(b));
    return floor + Math.hypot(dx, dy);
  };
}

test('refineSeamOnFrames: moves a coarse seam onto the true period', () => {
  const dist = orbitDistance(47);
  const result = refineSeamOnFrames({
    startFrame: 20, endFrame: 65, stepFrames: 2, searchRadius: 3, windowRadius: 1
  }, dist);
  assert.equal(result.changed, true);
  assert.equal(result.endFrame - result.startFrame, 47);
  assert.ok(result.cost < 1e-9);
  assert.ok(result.anchorCost > 0.1);
  assert.ok(result.gain > 0.99);
});

test('refineSeamOnFrames: never reports a cost above the anchor', () => {
  let seed = 7;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const table = new Map();
  const dist = (a, b) => {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (!table.has(key)) table.set(key, rand());
    return table.get(key);
  };
  for (let trial = 0; trial < 20; trial++) {
    const start = 10 + trial;
    const r = refineSeamOnFrames({ startFrame: start, endFrame: start + 40, stepFrames: 3, searchRadius: 2 }, dist);
    assert.ok(r.cost <= r.anchorCost + 1e-12, `trial ${trial}`);
    if (!r.changed) assert.equal(r.cost, r.anchorCost);
  }
});

test('refineSeamOnFrames: respects the frame-count rule and the clip bounds', () => {
  const dist = orbitDistance(47);
  const even = refineSeamOnFrames({
    startFrame: 20, endFrame: 64, stepFrames: 2, searchRadius: 3, acceptSpan: (k) => k % 2 === 0
  }, dist);
  assert.equal((even.endFrame - even.startFrame) % 2, 0);

  const bounded = refineSeamOnFrames({
    startFrame: 1, endFrame: 45, stepFrames: 2, searchRadius: 3, minFrame: 0, maxFrame: 46
  }, dist);
  assert.ok(bounded.startFrame >= 0);
  assert.ok(bounded.endFrame <= 46);
});

test('refineSeamOnFrames: ties go to the nominal length, then to not moving', () => {
  // Period 3: spans 15, 18, 21, 24 are all perfect.
  const dist = orbitDistance(3, 0.1);
  const r = refineSeamOnFrames({
    startFrame: 30, endFrame: 48, stepFrames: 1, searchRadius: 3, nominalSpan: 21
  }, dist);
  assert.equal(r.endFrame - r.startFrame, 21);

  const still = refineSeamOnFrames({ startFrame: 30, endFrame: 48, stepFrames: 1, searchRadius: 3 }, dist);
  assert.equal(still.changed, false);
  assert.equal(still.startFrame, 30);
});

test('seamRefinementFrames: lists every frame the refinement reads', () => {
  const options = { startFrame: 12, endFrame: 55, stepFrames: 2.5, searchRadius: 2, windowRadius: 1, minFrame: 0, maxFrame: 60 };
  const listed = new Set(seamRefinementFrames(options));
  const read = new Set();
  refineSeamOnFrames(options, (a, b) => {
    read.add(a);
    read.add(b);
    return Math.abs(a - b) % 7;
  });
  for (const k of read) assert.ok(listed.has(k), `frame ${k} read but not listed`);
  for (const k of listed) assert.ok(k >= 0 && k <= 60);
});

test('seamJumpRatio: judges the wrap against an ordinary step', () => {
  const cells = Array.from({ length: 12 }, (_, i) => 2 * i); // 0, 2, …, 22
  const verdict = (period) => seamJumpRatio(cells, orbitDistance(period)).verdict;
  // Period 24: the wrap 22 → 0 is two frames, like every other step.
  assert.equal(verdict(24), 'smooth');
  assert.ok(Math.abs(seamJumpRatio(cells, orbitDistance(24)).ratio - 1) < 1e-9);
  // Period 22: frame 22 is frame 0 again — the pose holds at the wrap.
  assert.equal(verdict(22), 'hold');
  // Period 25 / 26: the wrap skips one / two frames.
  assert.equal(verdict(25), 'bump');
  assert.equal(verdict(26), 'jump');
  // A subject that does not move has no step to compare against.
  assert.equal(seamJumpRatio(cells, () => 0), null);
  assert.equal(seamJumpRatio([0, 1], orbitDistance(24)), null);
});

test('seamJumpFrames: lists the frames seamJumpRatio reads', () => {
  const cells = Array.from({ length: 24 }, (_, i) => 100 + (3 * i));
  const listed = new Set(seamJumpFrames(cells, 4));
  const read = new Set();
  seamJumpRatio(cells, (a, b) => {
    read.add(a);
    read.add(b);
    return 1;
  }, 4);
  assert.deepEqual([...read].sort((a, b) => a - b), [...listed]);
  assert.ok(listed.has(100) && listed.has(169));
});
