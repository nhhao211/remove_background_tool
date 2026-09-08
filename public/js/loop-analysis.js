/**
 * Loop Analysis — pure periodicity/seam-matching core
 * Video Background Remover & Sprite Sheet Studio
 *
 * No DOM, no canvas: everything here takes plain `ImageData`-shaped objects
 * ({ data, width, height }) and numbers, so `test/loop-analysis.test.mjs` can
 * exercise it under `node --test`.
 *
 * The pipeline is coarse-to-fine:
 *
 *   1. Each sampled frame is reduced once to a fixed descriptor (a 32x32 grid
 *      of alpha + alpha-weighted colour, plus centroid/spread). Every later
 *      comparison reads the descriptor, never the pixels, which is what turns
 *      an O(N^2 * 5184px) scan into an O(N * L * 64) scan plus a handful of
 *      O(1024) refinements.
 *   2. A coarse 8x8 distance table over the admissible lag window feeds a lag
 *      profile A(lag) — the autocorrelation that actually detects periodicity,
 *      instead of trusting a single lucky frame pair.
 *   3. Surviving (phase, lag) pairs are re-scored on the fine grid with a
 *      windowed, dynamics-preserving seam cost (Schoedl et al., "Video
 *      Textures"): matching a neighbourhood forces velocity to line up, not
 *      just pose.
 *   4. Scores are contrast-normalised against the clip's own noise floor and
 *      baseline motion, so 100% means "the seam is as smooth as two ordinary
 *      consecutive frames" and 0% means "no better than cutting at random".
 */

/** Fine descriptor grid resolution (cells per axis). */
export const FINE_GRID = 32;
/** Coarse descriptor grid resolution, used for pruning and the lag profile. */
export const COARSE_GRID = 8;

const FINE_CELLS = FINE_GRID * FINE_GRID;
const COARSE_CELLS = COARSE_GRID * COARSE_GRID;
const BLOCK = FINE_GRID / COARSE_GRID;

/** Weight of each distance term when the frames carry a real alpha matte. */
const MATTE_WEIGHTS = { shape: 0.45, color: 0.35, position: 0.20 };

/** Below this mean alpha a cell holds no usable colour. */
const ALPHA_EPS = 0.004;

function clamp01(v) {
  return v < 0 ? 0 : (v > 1 ? 1 : v);
}

function toScore(value01) {
  return Math.round(clamp01(value01) * 1000) / 10;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = Float64Array.from(values).sort();
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Reduces one frame to a comparison descriptor.
 *
 * Colour is stored alpha-weighted per cell, so a cell that is half background
 * does not drag the foreground colour toward the key colour. Alpha is kept
 * separately as the shape channel.
 *
 * @param {{ data: Uint8ClampedArray|Uint8Array, width?: number, height?: number }} imageData - RGBA pixels
 * @param {number} [width] - Frame width (defaults to imageData.width)
 * @param {number} [height] - Frame height (defaults to imageData.height)
 * @returns {{ fine: Float32Array, coarse: Float32Array, coverage: number, cx: number, cy: number, spread: number }}
 */
export function buildFrameDescriptor(imageData, width, height) {
  const w = Math.max(1, Math.round(Number(width ?? imageData?.width) || 0));
  const h = Math.max(1, Math.round(Number(height ?? imageData?.height) || 0));
  const data = imageData?.data;

  const fine = new Float32Array(FINE_CELLS * 4);
  const coarse = new Float32Array(COARSE_CELLS * 4);
  if (!data || data.length < w * h * 4) {
    return { fine, coarse, coverage: 0, cx: 0.5, cy: 0.5, spread: 0.25 };
  }

  const acc = new Float64Array(FINE_CELLS * 4);
  const counts = new Uint32Array(FINE_CELLS);

  // Column bins are shared by every row, so resolve them once.
  const colBin = new Uint16Array(w);
  for (let x = 0; x < w; x++) {
    colBin[x] = Math.min(FINE_GRID - 1, Math.floor((x * FINE_GRID) / w));
  }

  for (let y = 0; y < h; y++) {
    const rowOffset = Math.min(FINE_GRID - 1, Math.floor((y * FINE_GRID) / h)) * FINE_GRID;
    const rowBase = y * w * 4;
    for (let x = 0; x < w; x++) {
      const cell = rowOffset + colBin[x];
      const idx = rowBase + (x * 4);
      const a = data[idx + 3] / 255;
      const o = cell * 4;
      acc[o] += a;
      acc[o + 1] += a * data[idx];
      acc[o + 2] += a * data[idx + 1];
      acc[o + 3] += a * data[idx + 2];
      counts[cell]++;
    }
  }

  let coverageSum = 0;
  let weightSum = 0;
  let cxSum = 0;
  let cySum = 0;

  for (let cell = 0; cell < FINE_CELLS; cell++) {
    const n = counts[cell] || 1;
    const o = cell * 4;
    const alphaMean = acc[o] / n;
    fine[o] = alphaMean;
    if (acc[o] > 1e-9) {
      const inv = 1 / (acc[o] * 255);
      fine[o + 1] = acc[o + 1] * inv;
      fine[o + 2] = acc[o + 2] * inv;
      fine[o + 3] = acc[o + 3] * inv;
    }

    coverageSum += alphaMean;
    const gx = ((cell % FINE_GRID) + 0.5) / FINE_GRID;
    const gy = (Math.floor(cell / FINE_GRID) + 0.5) / FINE_GRID;
    weightSum += alphaMean;
    cxSum += alphaMean * gx;
    cySum += alphaMean * gy;
  }

  const coverage = coverageSum / FINE_CELLS;
  const cx = weightSum > 1e-9 ? (cxSum / weightSum) : 0.5;
  const cy = weightSum > 1e-9 ? (cySum / weightSum) : 0.5;

  let varSum = 0;
  for (let cell = 0; cell < FINE_CELLS; cell++) {
    const a = fine[cell * 4];
    if (a <= 0) continue;
    const gx = ((cell % FINE_GRID) + 0.5) / FINE_GRID;
    const gy = (Math.floor(cell / FINE_GRID) + 0.5) / FINE_GRID;
    varSum += a * (((gx - cx) * (gx - cx)) + ((gy - cy) * (gy - cy)));
  }
  const spread = weightSum > 1e-9 ? Math.sqrt(varSum / weightSum) : 0.25;

  // Coarse grid: box-average of BLOCK x BLOCK fine cells, colour re-weighted by alpha.
  for (let cy2 = 0; cy2 < COARSE_GRID; cy2++) {
    for (let cx2 = 0; cx2 < COARSE_GRID; cx2++) {
      let aSum = 0;
      let rSum = 0;
      let gSum = 0;
      let bSum = 0;
      for (let dy = 0; dy < BLOCK; dy++) {
        const rowOffset = ((cy2 * BLOCK) + dy) * FINE_GRID;
        for (let dx = 0; dx < BLOCK; dx++) {
          const o = (rowOffset + (cx2 * BLOCK) + dx) * 4;
          const a = fine[o];
          aSum += a;
          rSum += a * fine[o + 1];
          gSum += a * fine[o + 2];
          bSum += a * fine[o + 3];
        }
      }
      const o2 = ((cy2 * COARSE_GRID) + cx2) * 4;
      coarse[o2] = aSum / (BLOCK * BLOCK);
      if (aSum > 1e-9) {
        coarse[o2 + 1] = rSum / aSum;
        coarse[o2 + 2] = gSum / aSum;
        coarse[o2 + 3] = bSum / aSum;
      }
    }
  }

  return { fine, coarse, coverage, cx, cy, spread };
}

/**
 * Shape + colour distance between two descriptor grids.
 *
 * Shape uses `sum|aA-aB| / sum(aA+aB)` — a Dice-style ratio normalised by the
 * subject's own area, not by the frame. That is the single most important fix
 * over a frame-normalised metric: a small subject on a large canvas no longer
 * scores 99% similar against everything.
 *
 * @param {Float32Array} A - First grid (a, r, g, b per cell)
 * @param {Float32Array} B - Second grid
 * @param {number} cells - Cell count
 * @returns {{ shape: number, color: number }} Both in 0..1
 */
function gridDistance(A, B, cells) {
  let shapeNum = 0;
  let shapeDen = 0;
  let colorNum = 0;
  let colorDen = 0;

  for (let cell = 0; cell < cells; cell++) {
    const o = cell * 4;
    const aA = A[o];
    const aB = B[o];
    shapeNum += aA > aB ? (aA - aB) : (aB - aA);
    shapeDen += aA + aB;

    const w = aA < aB ? aA : aB;
    if (w > ALPHA_EPS) {
      const dr = A[o + 1] - B[o + 1];
      const dg = A[o + 2] - B[o + 2];
      const db = A[o + 3] - B[o + 3];
      const rMean = (A[o + 1] + B[o + 1]) * 0.5;
      // Redmean weighting, rescaled so a full black/white flip reads exactly 1.
      const dc = Math.sqrt((((2 + rMean) * dr * dr) + (4 * dg * dg) + ((3 - rMean) * db * db)) / 9);
      colorNum += w * dc;
      colorDen += w;
    }
  }

  const shape = shapeDen > 1e-9 ? (shapeNum / shapeDen) : 0;
  let color;
  if (colorDen > 1e-9) {
    color = Math.min(1, colorNum / colorDen);
  } else {
    // No shared foreground. Two empty frames match; one-sided emptiness does not.
    color = shapeDen > 1e-3 ? 1 : 0;
  }
  return { shape, color };
}

/**
 * Distance between two descriptors, in 0..1.
 *
 * @param {Object} a - Descriptor from buildFrameDescriptor
 * @param {Object} b - Descriptor from buildFrameDescriptor
 * @param {Object} [ctx] - { matte: boolean, coarse: boolean }
 * @returns {number} 0 (identical) .. 1 (maximally different)
 */
export function descriptorDistance(a, b, ctx = {}) {
  if (!a || !b) return 1;
  const useCoarse = ctx.coarse === true;
  const grids = gridDistance(
    useCoarse ? a.coarse : a.fine,
    useCoarse ? b.coarse : b.fine,
    useCoarse ? COARSE_CELLS : FINE_CELLS
  );

  // Opaque footage carries no silhouette information, so shape and centroid are
  // constant by construction; colour alone is the honest signal there.
  if (ctx.matte === false) return clamp01(grids.color);

  const drift = Math.hypot(a.cx - b.cx, a.cy - b.cy);
  const scale = (0.5 * (a.spread + b.spread)) + 0.02;
  const position = Math.min(1, drift / scale);

  return clamp01(
    (MATTE_WEIGHTS.shape * grids.shape) +
    (MATTE_WEIGHTS.color * grids.color) +
    (MATTE_WEIGHTS.position * position)
  );
}

/**
 * Decides whether a descriptor set carries a usable alpha matte.
 *
 * @param {Object[]} descriptors - Frame descriptors
 * @returns {boolean} True when alpha varies enough to be informative
 */
export function hasUsableMatte(descriptors) {
  if (!descriptors || descriptors.length === 0) return false;
  let sum = 0;
  let min = Infinity;
  for (const d of descriptors) {
    sum += d.coverage;
    if (d.coverage < min) min = d.coverage;
  }
  const mean = sum / descriptors.length;
  return mean < 0.97 || min < 0.95;
}

/**
 * How a candidate is made to deliver the requested frame count:
 *  - 'exact'   : only cycles whose length already yields `targetFrames` are
 *                considered, so the trim window moves and the speed is kept.
 *  - 'speed'   : any cycle is allowed and the playback speed is solved so the
 *                cycle yields `targetFrames`, so the seam is kept untouched.
 *  - 'nearest' : the historical behaviour — score how close the count lands.
 */
const FRAME_MODES = new Set(['exact', 'speed', 'nearest']);

/** Binomial neighbourhood weights, indexed by radius. */
const WINDOW_WEIGHTS = [
  [1],
  [1, 2, 1],
  [1, 4, 6, 4, 1],
  [1, 6, 15, 20, 15, 6, 1]
];

/**
 * Detects candidate loop cycles from a sequence of frame descriptors.
 *
 * @param {Object[]} descriptors - Descriptors, in capture order
 * @param {number[]} times - Actual source timestamps (seconds), strictly increasing
 * @param {Object} [options={}]
 * @param {number} [options.minCycle=0.25] - Minimum cycle length in source seconds
 * @param {number} [options.maxCycle] - Maximum cycle length in source seconds
 * @param {number} [options.playbackSpeed=1] - Playback multiplier applied to the loop
 * @param {number} [options.targetFrames=24] - Desired output frame count
 * @param {number} [options.targetFps=12] - Desired output FPS
 * @param {number} [options.maxCandidates=6] - How many candidates to return
 * @param {number} [options.minSeparation=0.18] - NMS separation in seconds
 * @param {number} [options.windowRadius=2] - Seam neighbourhood radius (0..3)
 * @param {Object} [options.weights] - { seam, period, frameFit, activity }
 * @returns {{ candidates: Object[], lagProfile: Array, diagnostics: Object }}
 */
export function findLoopCandidates(descriptors, times, options = {}) {
  const N = Math.min(descriptors?.length || 0, times?.length || 0);
  const empty = { candidates: [], lagProfile: [], diagnostics: { samples: N, mode: 'none' } };
  if (N < 4) return empty;

  const matte = options.matte !== undefined ? !!options.matte : hasUsableMatte(descriptors);
  const ctxFine = { matte, coarse: false };
  const ctxCoarse = { matte, coarse: true };

  const span = times[N - 1] - times[0];
  if (!(span > 0)) return empty;

  const speed = Math.max(0.1, Math.min(16, Number(options.playbackSpeed) || 1));
  const targetFrames = Math.max(1, Math.min(500, Math.round(Number(options.targetFrames) || 24)));
  const targetFps = Math.max(1, Math.min(60, Math.round(Number(options.targetFps) || 12)));

  const minCycle = Math.max(1e-3, Number(options.minCycle) || 0.25);
  const maxCycle = Math.max(minCycle, Math.min(span, Number(options.maxCycle) || span));

  // Source seconds consumed by one output frame. A cycle yields exactly
  // `targetFrames` frames when its duration is targetFrames * outputStep.
  const outputStep = speed / targetFps;
  const frameTolerance = Math.max(0, Math.min(targetFrames - 1, Math.round(Number(options.frameTolerance) || 0)));
  const requestedMode = FRAME_MODES.has(options.frameMode) ? options.frameMode : 'exact';

  // In 'exact' mode the search never looks at cycles that cannot produce the
  // requested frame count, so the winner is guaranteed to fit rather than
  // merely scored on how close it came.
  let bandLo = minCycle;
  let bandHi = maxCycle;
  let frameMode = requestedMode;
  let frameModeFallback = false;

  if (requestedMode === 'exact') {
    const wantLo = Math.max(minCycle, (targetFrames - frameTolerance - 0.5) * outputStep);
    const wantHi = Math.min(maxCycle, (targetFrames + frameTolerance + 0.5) * outputStep);
    if (wantHi > wantLo && wantLo < span) {
      bandLo = wantLo;
      bandHi = wantHi;
    } else {
      // The requested length simply does not exist inside this search range.
      frameMode = 'nearest';
      frameModeFallback = true;
    }
  }

  const stepMedian = median(Array.from({ length: N - 1 }, (_, i) => times[i + 1] - times[i])) || (span / (N - 1));
  const lagMin = Math.max(1, Math.floor(bandLo / stepMedian));
  const lagMax = Math.min(N - 1, Math.ceil(bandHi / stepMedian));
  if (lagMax < lagMin) return empty;
  const lagCount = lagMax - lagMin + 1;

  // --- Memoised fine distance, integer-keyed (string keys were a real cost). ---
  const fineCache = new Map();
  function fineDist(i, j) {
    if (i === j) return 0;
    const lo = i < j ? i : j;
    const hi = i < j ? j : i;
    const key = (lo * N) + hi;
    const hit = fineCache.get(key);
    if (hit !== undefined) return hit;
    const value = descriptorDistance(descriptors[lo], descriptors[hi], ctxFine);
    fineCache.set(key, value);
    return value;
  }

  // --- Stage 1: coarse distance table over the admissible lag window. ---
  const coarseTable = new Float32Array(N * lagCount).fill(-1);
  for (let i = 0; i < N; i++) {
    const rowBase = i * lagCount;
    for (let lag = lagMin; lag <= lagMax; lag++) {
      const j = i + lag;
      if (j >= N) break;
      const duration = times[j] - times[i];
      if (duration < bandLo) continue;
      if (duration > bandHi) break;
      coarseTable[rowBase + (lag - lagMin)] = descriptorDistance(descriptors[i], descriptors[j], ctxCoarse);
    }
  }

  // --- Stage 2: lag profile A(lag) — the periodicity signal. ---
  const lagProfile = new Array(lagCount);
  const profileValues = [];
  for (let lag = lagMin; lag <= lagMax; lag++) {
    let sum = 0;
    let count = 0;
    for (let i = 0; i + lag < N; i++) {
      const v = coarseTable[(i * lagCount) + (lag - lagMin)];
      if (v >= 0) {
        sum += v;
        count++;
      }
    }
    const mean = count > 0 ? (sum / count) : Number.POSITIVE_INFINITY;
    lagProfile[lag - lagMin] = { lag, seconds: lag * stepMedian, mean, count, prominence: 0 };
    if (count > 0) profileValues.push(mean);
  }

  const profileMedian = median(profileValues);
  const profileSpread = median(profileValues.map((v) => Math.abs(v - profileMedian))) * 1.4826;
  const promScale = Math.max(profileSpread, profileMedian * 0.08, 1e-4);
  const localWindow = Math.max(2, Math.round(lagCount * 0.18));

  for (let k = 0; k < lagCount; k++) {
    const entry = lagProfile[k];
    if (!entry.count) continue;
    const lo = Math.max(0, k - localWindow);
    const hi = Math.min(lagCount - 1, k + localWindow);
    const neighbourhood = [];
    for (let m = lo; m <= hi; m++) {
      if (lagProfile[m].count) neighbourhood.push(lagProfile[m].mean);
    }
    const localMedian = median(neighbourhood);
    const isLocalMin =
      (k === 0 || !lagProfile[k - 1].count || lagProfile[k - 1].mean >= entry.mean) &&
      (k === lagCount - 1 || !lagProfile[k + 1].count || lagProfile[k + 1].mean >= entry.mean);
    const dip = clamp01((localMedian - entry.mean) / promScale);
    entry.prominence = isLocalMin ? dip : dip * 0.5;
  }

  // --- Stage 3: coarse windowed seam cost, then prune. ---
  const radius = Math.max(0, Math.min(3, Math.round(Number(options.windowRadius ?? 2)) || 0));
  const weights = WINDOW_WEIGHTS[radius];
  const weightTotal = weights.reduce((a, b) => a + b, 0);

  // Smoothness is perceived at the output frame rate, so the neighbourhood the
  // seam is matched over should step in output frames, not in sample slots.
  const autoStride = Math.max(1, Math.min(4, Math.round(outputStep / stepMedian) || 1));
  const stride = Math.max(1, Math.min(8, Math.round(Number(options.windowStride ?? autoStride)) || 1));

  function windowedCost(i, j, distFn) {
    let acc = 0;
    for (let k = -radius; k <= radius; k++) {
      const ii = Math.max(0, Math.min(N - 1, i + (k * stride)));
      const jj = Math.max(0, Math.min(N - 1, j + (k * stride)));
      acc += weights[k + radius] * distFn(ii, jj);
    }
    return acc / weightTotal;
  }

  const coarseAt = (i, j) => {
    const lag = j - i;
    if (lag >= lagMin && lag <= lagMax) {
      const v = coarseTable[(i * lagCount) + (lag - lagMin)];
      if (v >= 0) return v;
    }
    return descriptorDistance(descriptors[i], descriptors[j], ctxCoarse);
  };

  function frameFitFor(duration) {
    if (frameMode === 'speed') {
      // Solve the speed that turns this cycle into exactly targetFrames, then
      // score how far that drags the user away from the speed they asked for.
      // Quantised to what the speed control can actually hold, so the reported
      // tempo and the tempo the UI applies are the same number.
      const adaptedSpeed = Math.round(((duration * targetFps) / targetFrames) * 100) / 100;
      const usable = adaptedSpeed >= 0.1 && adaptedSpeed <= 16;
      const drift = Math.abs(Math.log2(adaptedSpeed / speed));
      return {
        frames: targetFrames,
        effective: targetFrames / targetFps,
        fit: usable ? clamp01(1 - drift) : 0,
        adaptedSpeed: usable ? adaptedSpeed : speed,
        usable
      };
    }

    const effective = duration / speed;
    const frames = Math.max(1, Math.round(effective * targetFps));
    const relError = Math.abs(frames - targetFrames) / targetFrames;
    const frameError = Math.abs(frames - targetFrames);
    return {
      frames,
      effective,
      // The band already excludes the wrong lengths; this is the hard gate that
      // makes "exactly N frames" a guarantee rather than a strong preference.
      fit: frameMode === 'exact'
        ? clamp01(1 - (frameError / (frameTolerance + 1)))
        : clamp01(1 - (relError * 1.6)),
      adaptedSpeed: speed,
      usable: frameMode !== 'exact' || frameError <= frameTolerance
    };
  }

  const prelim = [];
  const coarseMedian = profileMedian || 1;
  for (let i = 0; i < N; i++) {
    const rowBase = i * lagCount;
    for (let lag = lagMin; lag <= lagMax; lag++) {
      const j = i + lag;
      if (j >= N) break;
      const base = coarseTable[rowBase + (lag - lagMin)];
      if (base < 0) continue;
      const cost = windowedCost(i, j, coarseAt);
      const { fit, usable } = frameFitFor(times[j] - times[i]);
      if (!usable) continue;
      const prom = lagProfile[lag - lagMin].prominence;
      const rank = (0.60 * (1 - clamp01(cost / Math.max(coarseMedian, 1e-6)))) + (0.25 * fit) + (0.15 * prom);
      prelim.push({ i, j, lag, cost, rank });
    }
  }
  if (!prelim.length) return empty;

  prelim.sort((a, b) => b.rank - a.rank);
  const shortlist = prelim.slice(0, Math.min(prelim.length, Math.max(64, Math.round(prelim.length * 0.12))));

  // --- Stage 4: contrast normalisation references, in the fine metric. ---
  const floorSamples = [];
  const floorStride = Math.max(1, Math.floor((N - 1) / 48));
  for (let i = 0; i + 1 < N; i += floorStride) floorSamples.push(fineDist(i, i + 1));
  const noiseFloor = median(floorSamples);

  const baselineSamples = [];
  const baseStride = Math.max(1, Math.floor(prelim.length / 192));
  for (let k = 0; k < prelim.length; k += baseStride) {
    const p = prelim[k];
    baselineSamples.push(fineDist(p.i, p.j));
  }
  const baseline = median(baselineSamples);
  const contrast = Math.max(baseline - noiseFloor, 0.02);

  // --- Stage 5: fine scoring. ---
  const w = {
    seam: 0.50,
    period: 0.18,
    frameFit: 0.22,
    activity: 0.10,
    ...(options.weights || {})
  };
  const weightSum = w.seam + w.period + w.frameFit + w.activity || 1;

  const scored = [];
  for (const p of shortlist) {
    const duration = times[p.j] - times[p.i];
    const seamCost = windowedCost(p.i, p.j, fineDist);
    const seam = clamp01(1 - ((seamCost - noiseFloor) / contrast));

    // A frozen segment is a perfect seam and a useless loop; require real motion.
    let activityRaw = 0;
    for (const frac of [0.25, 0.5, 0.75]) {
      const mid = p.i + Math.max(1, Math.round(p.lag * frac));
      if (mid >= N || mid === p.i) continue;
      const d = fineDist(p.i, mid);
      if (d > activityRaw) activityRaw = d;
    }
    const activity = clamp01(activityRaw / Math.max(baseline, 1e-6));

    const { frames, effective, fit, adaptedSpeed } = frameFitFor(duration);
    const prominence = lagProfile[p.lag - lagMin].prominence;

    const combined = ((w.seam * seam) + (w.period * prominence) + (w.frameFit * fit) + (w.activity * activity)) / weightSum;

    scored.push({
      startIndex: p.i,
      endIndex: p.j,
      lag: p.lag,
      startTime: times[p.i],
      endTime: times[p.j],
      duration,
      speed: adaptedSpeed,
      requestedSpeed: speed,
      effectiveDuration: effective,
      calculatedFrames: frames,
      calculatedFps: targetFps,
      frameMode,
      exactFrames: frames === targetFrames,
      seamCost,
      distance: seamCost,
      score: toScore(combined),
      visualScore: toScore(seam),
      periodScore: toScore(prominence),
      frameFitScore: toScore(fit),
      speedFitScore: toScore(frameMode === 'speed' ? fit : 1),
      motionActivityScore: toScore(activity)
    });
  }

  scored.sort((a, b) => b.score - a.score);

  // --- Stage 6: non-maximum suppression over (phase, period). ---
  const maxCandidates = Math.max(1, Math.min(24, Math.round(Number(options.maxCandidates) || 6)));
  const separation = Math.max(0, Number(options.minSeparation ?? 0.18) || 0);
  const kept = [];
  for (const cand of scored) {
    if (kept.length >= maxCandidates) break;
    const duplicate = kept.some((existing) => {
      const sameEdges =
        Math.abs(existing.startTime - cand.startTime) < separation &&
        Math.abs(existing.endTime - cand.endTime) < separation;
      if (sameEdges) return true;
      // Same period re-phased inside the same span is the same animation.
      const samePeriod = Math.abs(existing.duration - cand.duration) < (separation * 0.6);
      const overlap =
        Math.min(existing.endTime, cand.endTime) - Math.max(existing.startTime, cand.startTime);
      const union =
        Math.max(existing.endTime, cand.endTime) - Math.min(existing.startTime, cand.startTime);
      return samePeriod && union > 0 && (overlap / union) > 0.85;
    });
    if (!duplicate) kept.push(cand);
  }

  return {
    candidates: kept,
    lagProfile,
    diagnostics: {
      samples: N,
      mode: matte ? 'matte' : 'opaque',
      frameMode,
      frameModeFallback,
      targetFrames,
      outputStep,
      bandLo,
      bandHi,
      windowStride: stride,
      stepMedian,
      lagMin,
      lagMax,
      pairsScanned: prelim.length,
      pairsRefined: shortlist.length,
      fineComparisons: fineCache.size,
      noiseFloor,
      baseline,
      contrast
    }
  };
}

/**
 * Rescores one already-known seam, used by the refinement pass and the seam
 * inspector so both report the same number the ranking used.
 *
 * @param {Object[]} descriptors - Descriptors of the local neighbourhood
 * @param {number} startIndex - Index of the loop's first frame
 * @param {number} endIndex - Index of the frame the loop wraps back from
 * @param {Object} [options={}] - { matte, windowRadius }
 * @returns {number} Windowed seam cost in 0..1
 */
export function seamCostAt(descriptors, startIndex, endIndex, options = {}) {
  const N = descriptors.length;
  const matte = options.matte !== undefined ? !!options.matte : hasUsableMatte(descriptors);
  const radius = Math.max(0, Math.min(3, Math.round(Number(options.windowRadius ?? 2)) || 0));
  const weights = WINDOW_WEIGHTS[radius];
  const total = weights.reduce((a, b) => a + b, 0);
  const ctx = { matte, coarse: false };

  let acc = 0;
  for (let k = -radius; k <= radius; k++) {
    const ii = Math.max(0, Math.min(N - 1, startIndex + k));
    const jj = Math.max(0, Math.min(N - 1, endIndex + k));
    acc += weights[k + radius] * descriptorDistance(descriptors[ii], descriptors[jj], ctx);
  }
  return acc / total;
}
