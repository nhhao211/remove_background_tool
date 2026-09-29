/**
 * Native frame grid — maps continuous media time onto the video's own frames.
 * Video Background Remover & Sprite Sheet Studio
 *
 * A paused `<video>` shows the frame with the greatest PTS <= currentTime
 * (measured in Chrome on H.264 and VP9 at 24/25/29.97/30/60 fps). Two things
 * follow from that and both used to show up as stutter:
 *
 *  - Seeking exactly onto a PTS is a coin toss. 0.1 s on a 30 fps clip *is*
 *    frame 3's PTS, and float rounding lands on frame 3 or frame 2 at random.
 *    Trim points snap to 0.1 s, so the first frame of a loop, and every frame
 *    that shares its phase, jittered by one source frame.
 *  - `video.currentTime` after a seek is the time that was asked for, not the
 *    PTS of the frame on screen, so nothing downstream could see the error.
 *
 * So every seek aims at the middle of a frame, and every sampling plan is
 * expressed in whole native frames. The grid itself (frame duration + phase)
 * is inferred from real PTS values collected with requestVideoFrameCallback;
 * see `detectFrameGrid()` in loop-optimizer.js.
 *
 * Pure: no DOM, tested under `node --test` (test/frame-grid.test.mjs).
 */

// Rates a grid snaps to when the least-squares fit lands this close, so the
// fps shown to the user reads 29.97 rather than 29.9701.
export const STANDARD_FPS = [
  8, 10, 12, 15, 24000 / 1001, 24, 25, 30000 / 1001, 30, 48, 50,
  60000 / 1001, 60, 72, 90, 100, 120, 144, 240
];

// Where inside a frame's display interval seeks aim. The middle keeps half a
// frame of margin on both sides, which covers float error, container PTS
// rounding (WebM stores milliseconds) and a slightly-off inferred phase.
export const SEEK_PHASE = 0.5;

// A time this close below a PTS is treated as that PTS. Trim values computed
// from frame times come back as 2.9999999996 frames and mean frame 3; trim
// inputs hold milliseconds, so 0.133 on a 30 fps clip means frame 4 (0.1333).
const BOUNDARY_SNAP_FRAMES = 0.02;
const BOUNDARY_SNAP_SECONDS = 0.0006;

const STANDARD_SNAP_REL = 3e-4;

function fitLine(times, frameDuration) {
  const t0 = times[0];
  const n = times.map((t) => Math.round((t - t0) / frameDuration));
  const count = times.length;
  let sn = 0;
  let st = 0;
  for (let i = 0; i < count; i++) {
    sn += n[i];
    st += times[i];
  }
  const mn = sn / count;
  const mt = st / count;
  let snn = 0;
  let snt = 0;
  for (let i = 0; i < count; i++) {
    snn += (n[i] - mn) * (n[i] - mn);
    snt += (n[i] - mn) * (times[i] - mt);
  }
  const slope = snn > 0 ? snt / snn : frameDuration;
  return { n, slope, intercept: mt - (slope * mn) };
}

function residualOf(times, n, slope, intercept) {
  let max = 0;
  for (let i = 0; i < times.length; i++) {
    const r = Math.abs(times[i] - (intercept + (n[i] * slope)));
    if (r > max) max = r;
  }
  return max;
}

// Largest PTS error a lattice may leave: covers millisecond PTS rounding
// (WebM) with room to spare, still rejects frames that are not on one lattice.
function fitTolerance(frameDuration) {
  return Math.max(0.0008, 0.04 * frameDuration);
}

/**
 * Least-squares lattice grown outward from the adjacent pair. The gap of one
 * pair is only good to a millisecond when PTS are rounded (WebM) — up to 6 %
 * of a 60 fps frame — so extrapolating it straight to a sample a hundred
 * frames away picks the wrong frame index. Adding samples nearest-first
 * refits the duration over an ever longer span before it is trusted further.
 */
function fitOutward(times, anchor, frameDuration) {
  const order = times
    .map((_, i) => i)
    .sort((a, b) => Math.abs(times[a] - times[anchor]) - Math.abs(times[b] - times[anchor]));
  const ordered = order.map((i) => times[i]);
  let slope = frameDuration;
  for (let count = 2; count <= ordered.length; count++) {
    slope = fitLine(ordered.slice(0, count), slope).slope;
    if (!(slope > 0)) return null;
  }
  const fit = fitLine(ordered, slope);
  if (!(fit.slope > 0)) return null;
  return { times: ordered, ...fit, maxResidual: residualOf(ordered, fit.n, fit.slope, fit.intercept) };
}

/**
 * Fallback when probes are too sparse for fitOutward(): try every standard
 * rate near the measured gap as-is. An exact duration puts every sample on
 * the right frame index no matter how far apart they are, so only the right
 * rate survives the residual check.
 */
function fitStandard(times, gap) {
  let best = null;
  for (const fps of STANDARD_FPS) {
    const d = 1 / fps;
    if (Math.abs(d - gap) > Math.max(0.0012, 0.06 * gap)) continue;
    const n = times.map((t) => Math.round((t - times[0]) / d));
    let sum = 0;
    for (let i = 0; i < times.length; i++) sum += times[i] - (n[i] * d);
    const intercept = sum / times.length;
    const maxResidual = residualOf(times, n, d, intercept);
    if (maxResidual <= fitTolerance(d) && (!best || maxResidual < best.maxResidual)) {
      best = { times, n, slope: d, intercept, maxResidual };
    }
  }
  return best;
}

/**
 * Infers the frame grid from presentation timestamps of decoded frames.
 *
 * The smallest gap between two distinct PTS values is taken as one frame, so
 * the probe has to include at least one pair of adjacent frames. Every other
 * sample must then sit on the same lattice; a variable-frame-rate clip does
 * not, and gets `null` so callers fall back to plain time sampling.
 *
 * @param {number[]} mediaTimes - PTS values (seconds), any order, duplicates ok
 * @returns {{frameDuration:number, origin:number, fps:number, standard:boolean,
 *   samples:number, maxResidual:number}|null}
 */
export function inferFrameGrid(mediaTimes) {
  if (!Array.isArray(mediaTimes)) return null;
  const sorted = mediaTimes
    .map(Number)
    .filter((t) => Number.isFinite(t) && t >= -1e-6)
    .sort((a, b) => a - b);

  const times = [];
  for (const t of sorted) {
    if (!times.length || t - times[times.length - 1] > 1e-4) times.push(t);
  }
  if (times.length < 3) return null;

  let minGap = Infinity;
  let anchor = 0;
  for (let i = 1; i < times.length; i++) {
    const gap = times[i] - times[i - 1];
    if (gap < minGap) {
      minGap = gap;
      anchor = i - 1;
    }
  }
  // Below 2 fps or above 480 fps is not a video frame rate this app can use.
  if (!(minGap > 1 / 480) || minGap > 0.5) return null;

  let fit = fitOutward(times, anchor, minGap);
  let standard = false;
  if (fit && fit.maxResidual <= fitTolerance(fit.slope)) {
    const fitFps = 1 / fit.slope;
    for (const fps of STANDARD_FPS) {
      if (Math.abs(fitFps - fps) / fps <= STANDARD_SNAP_REL) {
        const snapped = 1 / fps;
        const offsets = fit.times.map((t, i) => t - (fit.n[i] * snapped));
        const snappedIntercept = offsets.reduce((a, b) => a + b, 0) / offsets.length;
        const snappedResidual = residualOf(fit.times, fit.n, snapped, snappedIntercept);
        if (snappedResidual <= fitTolerance(snapped)) {
          fit = { ...fit, slope: snapped, intercept: snappedIntercept, maxResidual: snappedResidual };
          standard = true;
        }
        break;
      }
    }
  } else {
    fit = fitStandard(times, minGap);
    if (!fit) return null;
    standard = true;
  }
  const { slope, intercept, maxResidual } = fit;

  // Phase of the lattice, folded into [0, frameDuration) so frame 0 is the
  // first frame at or after t = 0.
  let origin = intercept - (Math.floor(intercept / slope) * slope);
  if (origin > slope - 1e-9) origin = 0;
  if (Math.abs(origin) < 1e-7) origin = 0;

  return {
    frameDuration: slope,
    origin,
    fps: 1 / slope,
    standard,
    samples: times.length,
    maxResidual
  };
}

export function isValidGrid(grid) {
  return !!grid && Number(grid.frameDuration) > 0 && Number.isFinite(Number(grid.origin));
}

/**
 * Index of the frame a paused video shows at `time` (floor semantics).
 */
export function frameIndexAt(time, grid) {
  const t = Number(time) || 0;
  const snap = Math.max(BOUNDARY_SNAP_FRAMES, BOUNDARY_SNAP_SECONDS / grid.frameDuration);
  return Math.max(0, Math.floor(((t - grid.origin) / grid.frameDuration) + snap));
}

/** PTS of frame `k`. */
export function frameTime(k, grid) {
  return grid.origin + (k * grid.frameDuration);
}

/** The time to seek to so the video shows exactly frame `k`. */
export function frameSeekTime(k, grid) {
  return grid.origin + ((k + SEEK_PHASE) * grid.frameDuration);
}

/**
 * Where to seek to show the frame that is on screen at `time`. Without a grid
 * the time is passed through unchanged, as before.
 */
export function seekTimeFor(time, grid) {
  const t = Number(time) || 0;
  if (!isValidGrid(grid)) return t;
  return frameSeekTime(frameIndexAt(t, grid), grid);
}

/** Index of the last frame of a clip of `duration` seconds, or Infinity. */
export function lastFrameIndex(grid, duration) {
  const d = Number(duration);
  if (!(d > 0)) return Infinity;
  return Math.max(0, Math.ceil(((d - grid.origin) / grid.frameDuration) - 1e-6) - 1);
}

/** Snaps a time to the PTS of the frame shown at it. */
export function snapTimeToFrame(time, grid) {
  if (!isValidGrid(grid)) return Number(time) || 0;
  return frameTime(frameIndexAt(time, grid), grid);
}

/**
 * Evenly spaced sample times across a range.
 *
 * Closed: N steps across [s, e) — the last frame is one step before e, so the
 * wrap from frame N-1 back to frame 0 is one step like every other. Open: N-1
 * steps across [s, e], last frame exactly at e.
 */
export function sampleTimes(startTime, endTime, frameCount, isClosedLoop = true) {
  const count = Math.max(1, Math.round(Number(frameCount) || 1));
  const s = Math.max(0, Number(startTime) || 0);
  const e = Math.max(s, Number(endTime) || s);
  const span = e - s;

  const timestamps = [];
  if (count === 1 || span <= 0) {
    for (let i = 0; i < count; i++) timestamps.push(s);
    return timestamps;
  }
  const step = isClosedLoop ? span / count : span / (count - 1);
  for (let i = 0; i < count; i++) timestamps.push(s + (i * step));
  return timestamps;
}

/**
 * Plans which native frame every output cell shows.
 *
 * With a grid, cell i shows frame k0 + round(i * K / P), where K is the loop
 * length in native frames and P the number of output steps it spans (N closed,
 * N-1 open). Every cell is a real decoded frame chosen by integer arithmetic,
 * so two runs of the same trim produce the same frames, the loop is exactly K
 * frames long, and the wrap step is part of the same Bresenham sequence as
 * the steps inside the loop.
 *
 * Without a grid it degrades to the plain time sampling used before.
 *
 * `times` stays the logical sampling (what erase strokes and regions bind
 * to); `seekTimes` is what to hand the video.
 *
 * @param {Object} p
 * @param {number} p.start - Trim start (s)
 * @param {number} p.end - Trim end (s)
 * @param {number} p.count - Output frame count N
 * @param {boolean} [p.closed=true] - Closed loop sampling
 * @param {Object|null} [p.grid] - Result of inferFrameGrid()
 * @param {number} [p.duration] - Clip duration, bounds the last frame
 */
export function planLoopFrames({ start, end, count, closed = true, grid = null, duration } = {}) {
  const N = Math.max(1, Math.round(Number(count) || 1));
  const times = sampleTimes(start, end, N, closed);
  const s = times[0];
  const e = Math.max(s, Number(end) || s);
  const periodSteps = closed ? N : Math.max(1, N - 1);

  if (!isValidGrid(grid)) {
    const span = e - s;
    const step = N > 1 ? span / periodSteps : 0;
    return {
      count: N,
      closed: !!closed,
      grid: null,
      times,
      seekTimes: times.slice(),
      frameTimes: times.slice(),
      frameIndices: null,
      startFrame: null,
      spanFrames: null,
      periodSteps,
      steps: null,
      stepFrames: null,
      evenPacing: null,
      duplicateFrames: 0,
      timeStep: step,
      start: s,
      end: e,
      maxFrame: Infinity,
      duration: Number(duration) || Infinity
    };
  }

  const maxFrame = lastFrameIndex(grid, duration);
  const k0 = Math.min(maxFrame, frameIndexAt(s, grid));
  const kEnd = Math.min(maxFrame + (closed ? 1 : 0), Math.max(k0, frameIndexAt(e, grid)));
  const K = N > 1 ? Math.max(0, kEnd - k0) : 0;

  const frameIndices = [];
  for (let i = 0; i < N; i++) {
    frameIndices.push(Math.min(maxFrame, k0 + Math.round((i * K) / periodSteps)));
  }

  const steps = [];
  for (let i = 1; i < N; i++) steps.push(frameIndices[i] - frameIndices[i - 1]);
  if (closed && N > 1) steps.push((k0 + K) - frameIndices[N - 1]);

  let minStep = Infinity;
  let maxStep = -Infinity;
  let duplicateFrames = 0;
  for (const st of steps) {
    if (st < minStep) minStep = st;
    if (st > maxStep) maxStep = st;
    if (st <= 0) duplicateFrames++;
  }

  return {
    count: N,
    closed: !!closed,
    grid,
    times,
    seekTimes: frameIndices.map((k) => frameSeekTime(k, grid)),
    frameTimes: frameIndices.map((k) => frameTime(k, grid)),
    frameIndices,
    startFrame: k0,
    spanFrames: K,
    periodSteps,
    steps,
    stepFrames: K / periodSteps,
    minStep: steps.length ? minStep : 0,
    maxStep: steps.length ? maxStep : 0,
    evenPacing: steps.length ? minStep === maxStep : true,
    duplicateFrames,
    timeStep: (K * grid.frameDuration) / periodSteps,
    start: s,
    end: e,
    maxFrame,
    duration: Number(duration) || Infinity
  };
}

/**
 * Seek time of the cell `i` periods away from the planned loop, for any
 * integer i: -1 is the frame that comes right before cell 0 when the loop is
 * played as a continuous cycle (the pre-roll twin of cell N-1), N is the frame
 * right after cell N-1 (the post-roll twin of cell 0). Returns null when that
 * frame falls outside the clip.
 */
export function planSeekTimeAt(plan, i) {
  if (!plan) return null;
  const P = plan.periodSteps;
  const q = Math.floor(i / P);
  const r = i - (q * P);

  if (plan.frameIndices) {
    const k = plan.frameIndices[r] + (q * plan.spanFrames);
    if (k < 0 || k > plan.maxFrame) return null;
    return frameSeekTime(k, plan.grid);
  }

  const t = plan.start + (i * plan.timeStep);
  if (t < -1e-9 || t > plan.duration + 1e-9) return null;
  return Math.max(0, t);
}

/**
 * Which frames a seam crossfade blends each cell with, and how much.
 *
 * Each blended cell is mixed with its periodic twin — the frame exactly one
 * loop length away — never with another cell. The tail variant eases the last
 * cells into the frames that play right *before* cell 0 in the source, so the
 * wrap lands on a motion that really leads into cell 0; the head variant eases
 * the first cells out of the frames that play right *after* the last cell.
 * The cell next to the seam leans hardest on its twin (smoothstep weights).
 *
 * Blending tail cells toward head cells instead, as this used to, makes the
 * end of the loop show the start's pose one step early: the head plays twice
 * and the loop visibly rewinds at the wrap.
 *
 * Tail is preferred; head is used when the clip has more room after the loop
 * than before it (a loop starting on frame 0 has no pre-roll). Twins that fall
 * outside the clip shorten the fade rather than cancel it.
 *
 * @param {Object} plan - planLoopFrames() result
 * @param {number} crossfadeCount - Requested blended cells (0 = off)
 * @returns {{variant:('tail'|'head'|null), count:number, requested:number,
 *   pairs:{cell:number, twin:number, seekTime:number, weight:number}[]}}
 */
export function planCrossfadeTwins(plan, crossfadeCount) {
  const N = plan ? plan.count : 0;
  const k = Math.max(0, Math.min(Math.floor(N / 2), Math.round(Number(crossfadeCount) || 0)));
  const none = { variant: null, count: 0, requested: k, pairs: [] };
  if (!plan || k <= 0) return none;
  const P = plan.periodSteps;

  const collect = (pairAt) => {
    const found = [];
    for (let j = 0; j < k; j++) {
      const pair = pairAt(j);
      const seekTime = planSeekTimeAt(plan, pair.twin);
      // Twins get further from the clip as j grows, so the first miss ends it.
      if (seekTime === null) break;
      found.push({ ...pair, seekTime });
    }
    return found;
  };

  const tail = collect((j) => ({ cell: N - 1 - j, twin: N - 1 - j - P }));
  const head = collect((j) => ({ cell: j, twin: j + P }));
  const useTail = tail.length >= head.length;
  const chosen = useTail ? tail : head;
  const count = chosen.length;
  if (!count) return none;

  return {
    variant: useTail ? 'tail' : 'head',
    count,
    requested: k,
    pairs: chosen.map((pair, j) => {
      const t = (count - j) / (count + 1);
      return { ...pair, weight: t * t * (3 - (2 * t)) };
    })
  };
}

/**
 * Human-readable pacing of a plan, for the UI hint: "2–3" when output steps
 * alternate between 2 and 3 source frames, "3" when every step is 3.
 */
export function describePacing(plan) {
  if (!plan || !plan.frameIndices || !plan.steps || !plan.steps.length) return null;
  const { minStep, maxStep } = plan;
  return {
    min: minStep,
    max: maxStep,
    even: minStep === maxStep,
    average: plan.stepFrames,
    label: minStep === maxStep ? String(minStep) : `${minStep}–${maxStep}`,
    duplicates: plan.duplicateFrames
  };
}

/**
 * Whole-number preview FPS values at which `frames` output frames pace evenly.
 *
 * With Auto FPS the trim spans frames * sourceFps * speed / fps native frames,
 * and the cells step through them evenly only when that is a multiple of
 * `frames`. 12 fps from a 30 fps clip is 2.5 source frames per cell, so the
 * steps alternate 2, 3, 2, 3 — the 3:2 judder no seam can fix.
 *
 * @returns {{fps:number, step:number}[]} highest fps first
 */
export function evenPacingFpsOptions(sourceFps, speed = 1, frames = 24, { min = 4, max = 60 } = {}) {
  const src = Number(sourceFps);
  const sp = Number(speed) || 1;
  const N = Math.max(1, Math.round(Number(frames) || 1));
  if (!(src > 0)) return [];
  const out = [];
  for (let fps = Math.floor(max); fps >= Math.ceil(min); fps--) {
    const span = Math.round((N * src * sp) / fps);
    if (span > 0 && span % N === 0) out.push({ fps, step: span / N });
  }
  return out;
}
