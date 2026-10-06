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

/** How the candidate score is composed; the scanner re-scores with the same mix. */
export const LOOP_SCORE_WEIGHTS = Object.freeze({ seam: 0.50, period: 0.18, frameFit: 0.22, activity: 0.10 });

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
    ...LOOP_SCORE_WEIGHTS,
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

/**
 * Seam neighbourhood offsets in native frames: one output step apart, rounded
 * symmetrically so a 2.5-frame step gives -3, 0, +3 rather than -2, 0, +3.
 */
function seamWindowOffsets(stepFrames, radius) {
  const h = Math.max(1, Number(stepFrames) || 1);
  const out = [];
  for (let m = -radius; m <= radius; m++) {
    out.push(Math.sign(m) * Math.round(Math.abs(m) * h));
  }
  return out;
}

function normaliseRefineOptions(options) {
  const startFrame = Math.round(Number(options.startFrame) || 0);
  const endFrame = Math.round(Number(options.endFrame) || 0);
  const searchRadius = Math.max(0, Math.min(12, Math.round(Number(options.searchRadius ?? 2)) || 0));
  const windowRadius = Math.max(0, Math.min(3, Math.round(Number(options.windowRadius ?? 1)) || 0));
  const minFrame = Number.isFinite(Number(options.minFrame)) ? Math.round(Number(options.minFrame)) : 0;
  const maxFrame = Number.isFinite(Number(options.maxFrame)) ? Math.round(Number(options.maxFrame)) : Infinity;
  const offsets = seamWindowOffsets(options.stepFrames, windowRadius);
  return { startFrame, endFrame, searchRadius, windowRadius, minFrame, maxFrame, offsets };
}

/**
 * Windowed seam cost on native frames: frames one output step before, at and
 * after the cut on each side, weighted by WINDOW_WEIGHTS. Neighbours outside
 * the decodable range are skipped; the centre pair is mandatory.
 */
function windowedFrameCost(a, b, o, weights, dist) {
  let acc = 0;
  let wsum = 0;
  for (let m = 0; m < o.offsets.length; m++) {
    const ka = a + o.offsets[m];
    const kb = b + o.offsets[m];
    if (ka < o.minFrame || kb < o.minFrame || ka > o.maxFrame || kb > o.maxFrame) {
      if (m === o.windowRadius) return Infinity;
      continue;
    }
    const d = dist(ka, kb);
    if (d === null || d === undefined || !Number.isFinite(d)) {
      if (m === o.windowRadius) return Infinity;
      continue;
    }
    acc += weights[m] * d;
    wsum += weights[m];
  }
  return wsum > 0 ? acc / wsum : Infinity;
}

/**
 * Native frames the seam refinement will ask `dist()` about, so the caller
 * can decode them all before the (synchronous) search runs.
 *
 * @param {Object} options - Same options as refineSeamOnFrames()
 * @returns {number[]} Sorted unique frame indices
 */
export function seamRefinementFrames(options = {}) {
  const o = normaliseRefineOptions(options);
  const set = new Set();
  for (const anchor of [o.startFrame, o.endFrame]) {
    for (let d = -o.searchRadius; d <= o.searchRadius; d++) {
      for (const off of o.offsets) {
        const k = anchor + d + off;
        if (k >= o.minFrame && k <= o.maxFrame) set.add(k);
      }
    }
  }
  return Array.from(set).sort((a, b) => a - b);
}

/**
 * Re-places a seam on the native frame grid.
 *
 * The coarse scan puts a seam on its sampling lattice, one or more source
 * frames away from the best cut. This searches start and end independently
 * within ±searchRadius native frames and scores every pair with the same
 * windowed cost: frames one *output* step before, at and after the cut on
 * each side, weighted 1-2-1. Matching the neighbours an output step away is
 * what makes the velocity line up at the rate the loop is actually played;
 * neighbours one source frame away barely move and say little about it.
 *
 * The original pair is always scored with the same yardstick and wins ties,
 * so refinement can only lower the cost it reports. `acceptSpan(K)` is the
 * caller's frame-count rule (a loop of K native frames must still produce
 * the same number of cells); `nominalSpan` breaks near-ties toward the length
 * the user asked for.
 *
 * @param {Object} options
 * @param {number} options.startFrame - Coarse seam start (native frame index)
 * @param {number} options.endFrame - Coarse seam end: the twin of startFrame
 * @param {number} options.stepFrames - Native frames per output frame
 * @param {number} [options.searchRadius=2] - Frames each end may move
 * @param {number} [options.windowRadius=1] - Output steps either side of the cut
 * @param {number} [options.minFrame=0] - First decodable frame
 * @param {number} [options.maxFrame=Infinity] - Last decodable frame
 * @param {(span:number)=>boolean} [options.acceptSpan] - Admissible loop lengths
 * @param {number} [options.nominalSpan] - Preferred loop length in frames
 * @param {(a:number, b:number)=>(number|null)} dist - Distance between frames
 * @returns {{ startFrame:number, endFrame:number, cost:number, anchorCost:number,
 *   gain:number, changed:boolean, evaluated:number }}
 */
export function refineSeamOnFrames(options, dist) {
  const o = normaliseRefineOptions(options || {});
  const weights = WINDOW_WEIGHTS[o.windowRadius];
  const acceptSpan = typeof options.acceptSpan === 'function' ? options.acceptSpan : () => true;
  const nominal = Number(options.nominalSpan);
  const hasNominal = Number.isFinite(nominal) && nominal > 0;
  const stepFrames = Math.max(1, Number(options.stepFrames) || 1);

  const costAt = (a, b) => windowedFrameCost(a, b, o, weights, dist);

  // Near-tie breakers only: one percent per output frame of length drift, and
  // a vanishing preference for not moving at all.
  const adjusted = (cost, a, b) => {
    let v = cost;
    if (hasNominal) v *= 1 + (0.01 * Math.abs((b - a) - nominal) / stepFrames);
    return v + (1e-9 * (Math.abs(a - o.startFrame) + Math.abs(b - o.endFrame)));
  };

  const anchorCost = costAt(o.startFrame, o.endFrame);
  let best = {
    a: o.startFrame,
    b: o.endFrame,
    cost: anchorCost,
    score: Number.isFinite(anchorCost) ? adjusted(anchorCost, o.startFrame, o.endFrame) : Infinity
  };
  let evaluated = 1;

  for (let da = -o.searchRadius; da <= o.searchRadius; da++) {
    for (let db = -o.searchRadius; db <= o.searchRadius; db++) {
      if (!da && !db) continue;
      const a = o.startFrame + da;
      const b = o.endFrame + db;
      if (b <= a || a < o.minFrame || b > o.maxFrame) continue;
      if (!acceptSpan(b - a)) continue;
      const cost = costAt(a, b);
      evaluated++;
      if (!Number.isFinite(cost)) continue;
      const score = adjusted(cost, a, b);
      if (score < best.score) best = { a, b, cost, score };
    }
  }

  const changed = best.a !== o.startFrame || best.b !== o.endFrame;
  const gain = Number.isFinite(anchorCost) && anchorCost > 1e-9 && Number.isFinite(best.cost)
    ? clamp01(1 - (best.cost / anchorCost))
    : 0;

  return {
    startFrame: best.a,
    endFrame: best.b,
    cost: best.cost,
    anchorCost,
    gain,
    changed,
    evaluated
  };
}

function seamJumpPairs(frameIndices, samples) {
  const n = Array.isArray(frameIndices) ? frameIndices.length : 0;
  if (n < 3) return null;
  const interior = [];
  const count = Math.max(1, Math.min(n - 1, Math.round(Number(samples) || 6)));
  const used = new Set();
  for (let s = 0; s < count; s++) {
    // Spread over the loop, away from the seam itself.
    const i = Math.min(n - 2, Math.floor(((s + 0.5) * (n - 1)) / count));
    if (used.has(i)) continue;
    used.add(i);
    if (frameIndices[i + 1] !== frameIndices[i]) interior.push([frameIndices[i], frameIndices[i + 1]]);
  }
  return { seam: [frameIndices[n - 1], frameIndices[0]], interior };
}

/**
 * Frames seamJumpRatio() reads, so the caller can decode them first.
 */
export function seamJumpFrames(frameIndices, samples = 6) {
  const pairs = seamJumpPairs(frameIndices, samples);
  if (!pairs) return [];
  const set = new Set(pairs.seam);
  for (const [a, b] of pairs.interior) {
    set.add(a);
    set.add(b);
  }
  return Array.from(set).sort((a, b) => a - b);
}

/**
 * How big the wrap from the last cell back to the first looks, relative to an
 * ordinary step inside the loop — measured on the frames the sheet will really
 * contain, not on the seam the search optimised. ~1 is invisible; 2 reads as
 * a skipped frame; well below 1 is a hold (the pose repeats at the wrap).
 *
 * @param {number[]} frameIndices - Planned native frame of each cell
 * @param {(a:number, b:number)=>(number|null)} dist - Distance between frames
 * @returns {{ ratio:number, seam:number, typical:number, verdict:string }|null}
 */
export function seamJumpRatio(frameIndices, dist, samples = 6) {
  const pairs = seamJumpPairs(frameIndices, samples);
  if (!pairs || !pairs.interior.length) return null;
  const seam = dist(pairs.seam[0], pairs.seam[1]);
  if (seam === null || seam === undefined || !Number.isFinite(seam)) return null;
  const steps = [];
  for (const [a, b] of pairs.interior) {
    const d = dist(a, b);
    if (d !== null && d !== undefined && Number.isFinite(d)) steps.push(d);
  }
  const typical = median(steps);
  // A subject that barely moves has no step to compare the wrap against.
  if (!(typical > 1e-4)) return null;
  const ratio = seam / typical;
  let verdict = 'smooth';
  if (ratio > 1.75) verdict = 'jump';
  else if (ratio > 1.3) verdict = 'bump';
  else if (ratio < 0.35) verdict = 'hold';
  return { ratio, seam, typical, verdict };
}

/** Interior step pairs (k, k + one output step) spread over the loop. */
function residualStepPairs(o, stepFrames, samples) {
  const step = Math.max(1, Math.round(stepFrames));
  const last = o.endFrame - step;
  const pairs = [];
  if (last < o.startFrame) return pairs;
  const count = Math.max(1, Math.round(Number(samples) || 8));
  const seen = new Set();
  for (let s = 0; s < count; s++) {
    const k = o.startFrame + Math.round(((s + 0.5) * (last - o.startFrame)) / count);
    if (seen.has(k) || k < o.minFrame || k + step > o.maxFrame) continue;
    seen.add(k);
    pairs.push([k, k + step]);
  }
  return pairs;
}

function normaliseResidualOptions(options) {
  return normaliseRefineOptions({ ...options, searchRadius: 0, windowRadius: options.windowRadius ?? 1 });
}

/**
 * Frames seamResidual() reads, so the caller can decode them first.
 *
 * @param {Object} options - Same options as seamResidual()
 * @returns {number[]} Sorted unique frame indices
 */
export function seamResidualFrames(options = {}) {
  const o = normaliseResidualOptions(options);
  const set = new Set();
  for (const off of o.offsets) {
    for (const k of [o.startFrame + off, o.endFrame + off]) {
      if (k >= o.minFrame && k <= o.maxFrame) set.add(k);
    }
  }
  for (const [a, b] of residualStepPairs(o, options.stepFrames, options.samples ?? 8)) {
    set.add(a);
    set.add(b);
  }
  return Array.from(set).sort((a, b) => a - b);
}

/**
 * How far off the seam is, in units of the loop's own motion per cell.
 *
 * The cut joins frame `endFrame` back to `startFrame`; on a perfect cycle the
 * two (and their neighbours one output step away) are the same pose, so the
 * windowed seam cost is ~0. Dividing it by the median distance of an ordinary
 * step between cells turns it into "the wrap is off by this many steps": 0.1
 * is invisible, 0.5 is a visible nudge, 1 is a whole frame skipped or
 * repeated. Unlike the seam cost on its own this is comparable across
 * candidates of different length and speed, and across clips — a fast subject
 * has big steps and can absorb a bigger seam cost without anyone seeing it.
 *
 * @param {Object} options
 * @param {number} options.startFrame - Loop start (native frame)
 * @param {number} options.endFrame - Loop end: the twin of startFrame
 * @param {number} options.stepFrames - Native frames per output cell
 * @param {number} [options.windowRadius=1] - Output steps either side of the cut
 * @param {number} [options.samples=8] - Interior steps to take the median of
 * @param {number} [options.minFrame=0]
 * @param {number} [options.maxFrame=Infinity]
 * @param {(a:number, b:number)=>(number|null)} dist - Distance between frames
 * @returns {{ residual:number, seamCost:number, typical:number, verdict:string }|null}
 *   null when the subject barely moves (no step to measure against).
 */
export function seamResidual(options, dist) {
  const o = normaliseResidualOptions(options || {});
  const seamCost = windowedFrameCost(o.startFrame, o.endFrame, o, WINDOW_WEIGHTS[o.windowRadius], dist);
  if (!Number.isFinite(seamCost)) return null;
  const steps = [];
  for (const [a, b] of residualStepPairs(o, options.stepFrames, options.samples ?? 8)) {
    const d = dist(a, b);
    if (d !== null && d !== undefined && Number.isFinite(d)) steps.push(d);
  }
  const typical = median(steps);
  if (!(typical > 1e-4)) return null;
  const residual = seamCost / typical;
  let verdict = 'smooth';
  if (residual > 0.75) verdict = 'jump';
  else if (residual > 0.3) verdict = 'bump';
  return { residual, seamCost, typical, verdict };
}

/**
 * Seam quality from a residual (seamResidual): 1 at a perfect seam, ~0.74 at
 * 0.3 steps, ~0.16 at 0.75, ~0 past 1.2.
 */
export function seamQualityScore(residual) {
  // Number(null) is 0, which would read a missing measurement as a perfect seam.
  if (residual === null || residual === undefined) return 0;
  const r = Number(residual);
  if (!Number.isFinite(r) || r < 0) return 0;
  return Math.exp(-((r / 0.55) ** 2));
}

/**
 * Loop crossfade cells worth spending on a seam that is `residual` steps off.
 * An invisible seam gets none (a crossfade always softens detail a little);
 * a bigger miss is spread over more cells so no single step absorbs it. Never
 * more than a quarter of the loop, nor the six the slider allows.
 *
 * @param {number|null} residual
 * @param {number} cellCount - Cells in the loop
 * @returns {number}
 */
export function recommendCrossfade(residual, cellCount) {
  const r = Number(residual);
  if (residual === null || residual === undefined || !Number.isFinite(r)) return 0;
  let cells = 0;
  if (r > 0.8) cells = 4;
  else if (r > 0.45) cells = 3;
  else if (r > 0.2) cells = 2;
  const cap = Math.min(6, Math.floor((Math.round(Number(cellCount)) || 0) / 4));
  return Math.max(0, Math.min(cells, cap));
}
