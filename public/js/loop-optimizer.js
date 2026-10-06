/**
 * Animation Loop Optimizer & Periodicity Seeker
 * Video Background Remover & Sprite Sheet Studio
 *
 * Provides intelligent cycle detection, closed-loop modular sampling,
 * and temporal crossfade blending to eliminate animation stutter/jump at loop seams.
 *
 * This file owns everything that needs the DOM (seeking, canvas capture,
 * keying, thumbnails). The ranking maths lives in `loop-analysis.js` so it can
 * be tested under `node --test`.
 */

import { runKeyer } from './keyer/index.js';
import { dissolveImageData, morphBlendImageData } from './seam-morph.js';
import {
  buildFrameDescriptor,
  descriptorDistance,
  findLoopCandidates,
  hasUsableMatte,
  LOOP_SCORE_WEIGHTS,
  recommendCrossfade,
  refineSeamOnFrames,
  seamJumpFrames,
  seamJumpRatio,
  seamQualityScore,
  seamRefinementFrames,
  seamResidual,
  seamResidualFrames
} from './loop-analysis.js';
import {
  describePacing,
  frameIndexAt,
  frameSeekTime,
  frameTime,
  inferFrameGrid,
  isValidGrid,
  lastFrameIndex,
  planLoopFrames,
  sampleTimes
} from './frame-grid.js';

function toPercent(value01) {
  return Math.round(Math.max(0, Math.min(1, value01)) * 1000) / 10;
}

/**
 * Calculates sampling timestamps for animation generation.
 *
 * @param {number} startTime - Start time in seconds
 * @param {number} endTime - End time in seconds
 * @param {number} frameCount - Total number of frames to generate
 * @param {boolean} [isClosedLoop=true] - If true, samples closed periodic cycle (N steps across [s, e)); if false, samples open range (N-1 intervals across [s, e])
 * @returns {number[]} Array of timestamps in seconds
 */
export function computeLoopTimestamps(startTime, endTime, frameCount, isClosedLoop = true) {
  return sampleTimes(startTime, endTime, frameCount, isClosedLoop);
}

/**
 * Computes visual distance and similarity score between two frame ImageDatas.
 *
 * Shape difference is normalised by the subject's own area (a Dice-style
 * ratio), not by the frame area — otherwise a small subject on a large canvas
 * reads as ~99% similar against every other frame and the score carries no
 * information. Colour is compared only where both frames have foreground, and
 * centroid drift is measured relative to the subject's size.
 *
 * @param {ImageData} imgDataA - First frame image data
 * @param {ImageData} imgDataB - Second frame image data
 * @param {number} width - Frame width
 * @param {number} height - Frame height
 * @returns {{ distance: number, similarity: number }}
 */
export function computeFrameDistance(imgDataA, imgDataB, width, height) {
  if (!imgDataA || !imgDataB) return { distance: 1, similarity: 0 };
  const w = Math.max(1, Math.round(Number(width) || imgDataA.width || 0));
  const h = Math.max(1, Math.round(Number(height) || imgDataA.height || 0));
  if (!w || !h || imgDataA.data.length !== imgDataB.data.length) {
    return { distance: 1, similarity: 0 };
  }

  const a = buildFrameDescriptor(imgDataA, w, h);
  const b = buildFrameDescriptor(imgDataB, w, h);
  const matte = hasUsableMatte([a, b]);
  const distance = descriptorDistance(a, b, { matte, coarse: false });

  return {
    distance,
    similarity: Math.max(0, Math.min(100, Math.round((1 - distance) * 1000) / 10))
  };
}

function defaultSeek(duration) {
  return (vid, time) => new Promise((resolve) => {
    let resolved = false;
    const onSeeked = () => {
      if (resolved) return;
      resolved = true;
      vid.removeEventListener('seeked', onSeeked);
      resolve();
    };
    vid.addEventListener('seeked', onSeeked);
    vid.currentTime = Math.max(0, Math.min(time, duration));
    setTimeout(onSeeked, 800);
  });
}

/**
 * Seeks and reports the presentation timestamp of the frame that ends up on
 * screen, via requestVideoFrameCallback. `video.currentTime` cannot answer
 * that: it echoes the time that was asked for.
 *
 * The callback is registered before the seek starts so it cannot be missed,
 * and it lands a few ms after 'seeked'. Seeking to the frame already on
 * screen presents nothing new and the callback never fires, hence the short
 * wait after 'seeked' before giving up on this probe.
 */
function seekForMediaTime(video, time, { timeout = 1500, settle = 250 } = {}) {
  return new Promise((resolve) => {
    let done = false;
    let seeked = false;
    let mediaTime = null;
    let handle = null;
    let settleTimer = null;
    let hardTimer = null;
    const finish = () => {
      if (done) return;
      done = true;
      video.removeEventListener('seeked', onSeeked);
      if (handle !== null && typeof video.cancelVideoFrameCallback === 'function') {
        video.cancelVideoFrameCallback(handle);
      }
      clearTimeout(settleTimer);
      clearTimeout(hardTimer);
      resolve(mediaTime);
    };
    const onSeeked = () => {
      seeked = true;
      if (mediaTime !== null) finish();
      else settleTimer = setTimeout(finish, settle);
    };
    handle = video.requestVideoFrameCallback((now, meta) => {
      handle = null;
      const t = Number(meta?.mediaTime);
      mediaTime = Number.isFinite(t) ? t : null;
      if (seeked) finish();
    });
    video.addEventListener('seeked', onSeeked);
    hardTimer = setTimeout(finish, timeout);
    video.currentTime = time;
  });
}

// Spread over the clip and deliberately irrational-looking, so the probes do
// not all share one phase against a round frame rate.
const GRID_PROBE_FRACTIONS = [0.137, 0.263, 0.419, 0.577, 0.691, 0.853];

/**
 * Measures the video's native frame grid (frame duration and phase) from real
 * presentation timestamps. See frame-grid.js for why every seek depends on it.
 *
 * A handful of scattered probes pin the phase; a probe half a millisecond
 * before a known PTS lands on the previous frame, which pins the frame
 * duration. Returns null when the browser has no requestVideoFrameCallback,
 * the tab is hidden (callbacks are tied to rendering), or the clip is
 * variable-frame-rate — callers then fall back to plain time sampling.
 *
 * @param {HTMLVideoElement} video
 * @param {{duration?: number}} [options]
 * @returns {Promise<Object|null>} inferFrameGrid() result
 */
export async function detectFrameGrid(video, options = {}) {
  if (!video || typeof video.requestVideoFrameCallback !== 'function') return null;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return null;
  const duration = Number(options.duration) || video.duration || 0;
  if (!Number.isFinite(duration) || duration <= 0.1) return null;

  const originalTime = video.currentTime;
  video.pause();

  const times = [];
  const limit = Math.max(0, duration - 0.05);
  try {
    for (const frac of GRID_PROBE_FRACTIONS) {
      const t = await seekForMediaTime(video, Math.min(limit, frac * duration));
      if (t !== null) times.push(t);
    }
    // Two adjacency probes: one would do, the second keeps a single odd
    // decode from deciding the frame duration on its own.
    const anchors = times.filter((t) => t > 0.001);
    for (const anchor of [anchors[0], anchors[3] ?? anchors[1]]) {
      if (anchor === undefined) continue;
      const t = await seekForMediaTime(video, anchor - 0.0005);
      if (t !== null) times.push(t);
    }
  } finally {
    await seekForMediaTime(video, originalTime, { timeout: 1000, settle: 0 });
  }

  return inferFrameGrid(times);
}

/**
 * Scans video range to detect candidate seamless loop cycles.
 *
 * Pipeline: native-frame sampling -> per-frame descriptors -> coarse lag
 * profile (periodicity) -> fine windowed seam cost -> contrast-normalised
 * scoring -> seam refinement on individual native frames -> as-played seam
 * check on the frames the sheet will actually contain.
 *
 * With `options.frameGrid` (from detectFrameGrid) every sample is a whole
 * native frame: seeks aim at the middle of the frame and the reported time is
 * that frame's PTS, so a candidate's start/end map back to exactly the frames
 * that were compared. Without a grid a synthetic lattice finer than the
 * sampling step stands in for it.
 *
 * @param {HTMLVideoElement} video - HTML5 video element
 * @param {Object} [options={}] - Scan parameters
 * @param {number} [options.duration] - Total video duration in seconds
 * @param {number} [options.searchStart=0] - Start timestamp for search range
 * @param {number} [options.searchEnd] - End timestamp for search range
 * @param {number} [options.playbackSpeed=1] - Video playback speed multiplier (e.g. 1x, 2x, 3x, 4x)
 * @param {number} [options.targetFrames=24] - Target frame count for the loop animation
 * @param {number} [options.targetFps=12] - Target preview FPS (e.g. 12, 16, 24)
 * @param {number} [options.minCycleDuration] - Minimum valid loop cycle length in seconds (source time)
 * @param {number} [options.maxCycleDuration] - Maximum valid loop cycle length in seconds (source time)
 * @param {number} [options.sampleRate] - Sampling frequency in frames per second (auto when omitted)
 * @param {number} [options.maxSamples=320] - Hard cap on captured frames (seek budget)
 * @param {boolean} [options.refine=true] - Run the native-frame seam refinement pass
 * @param {number} [options.refineCandidates=3] - How many top candidates to refine
 * @param {number} [options.maxCandidates=6] - How many candidates to return
 * @param {Object|null} [options.frameGrid] - Native frame grid (detectFrameGrid)
 * @param {Object} [options.chromaOptions] - Chroma key configuration for background removal
 * @param {Object} [options.cropOptions] - Video crop margins { top, bottom, left, right }
 * @param {Function} [options.onProgress] - Progress callback (percentage: number, statusText: string)
 * @param {Function} [options.seekVideoAsync] - Helper function to seek video asynchronously
 * @returns {Promise<Array<Object>>} List of top candidate loop cycles
 */
export async function scanVideoForOptimalLoops(video, options = {}) {
  const duration = Number(options.duration) || video.duration || 0;
  if (!duration || duration <= 0) return [];

  const searchStart = Math.max(0, Math.min(duration, Number(options.searchStart) || 0));
  const searchEnd = Math.max(searchStart + 0.2, Math.min(duration, Number(options.searchEnd) || duration));
  const searchSpan = searchEnd - searchStart;

  const speed = Math.max(0.1, Math.min(16, Number(options.playbackSpeed) || 1));
  const targetFrames = Math.max(1, Math.min(500, Math.round(Number(options.targetFrames) || 24)));
  const targetFps = Math.max(1, Math.min(60, Math.round(Number(options.targetFps) || 12)));

  // Source seconds consumed by one output frame once the speed multiplier applies.
  const outputStep = speed / targetFps;
  const idealSourceDuration = targetFrames * outputStep;

  const defaultMinCycle = Math.max(0.25, Math.min(searchSpan * 0.9, idealSourceDuration * 0.4));
  const defaultMaxCycle = Math.min(searchSpan, Math.max(defaultMinCycle + 0.2, idealSourceDuration * 1.8));

  const minCycle = Math.max(0.2, Number(options.minCycleDuration) || defaultMinCycle);
  const maxCycle = Math.min(searchSpan, Math.max(minCycle + 0.1, Number(options.maxCycleDuration) || defaultMaxCycle));

  // Sampling twice per output frame keeps candidate durations close to whole
  // output frames while halving the seeks a flat 20 fps grid would need.
  const maxSamples = Math.max(24, Math.min(600, Math.round(Number(options.maxSamples) || 320)));
  const autoStep = Math.max(1 / 30, Math.min(1 / 8, outputStep / 2));
  let stepTime = Number(options.sampleRate) > 0 ? (1 / Number(options.sampleRate)) : autoStep;
  stepTime = Math.max(stepTime, searchSpan / maxSamples);

  const frameMode = ['exact', 'speed', 'nearest'].includes(options.frameMode) ? options.frameMode : 'exact';

  const chromaOptions = options.chromaOptions || { enabled: false, keyColors: [] };
  const keyingOn = !!(chromaOptions.enabled && chromaOptions.keyColors && chromaOptions.keyColors.length > 0);
  const crop = options.cropOptions || { top: 0, bottom: 0, left: 0, right: 0 };

  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  const seekAsync = typeof options.seekVideoAsync === 'function'
    ? options.seekVideoAsync
    : defaultSeek(duration);

  // The lattice every sample, seam and trim point lives on. A real grid means
  // "frame k" is a decoded frame; the synthetic one is only a fine time grid,
  // seeked at its nodes exactly like the old time sampling was.
  const nativeGrid = isValidGrid(options.frameGrid) ? options.frameGrid : null;
  const lattice = nativeGrid || { frameDuration: Math.max(stepTime / 4, 1 / 120), origin: 0 };
  const delta = lattice.frameDuration;
  const maxFrame = lastFrameIndex(lattice, duration);
  const seekTimeOf = (k) => (nativeGrid
    ? frameSeekTime(k, nativeGrid)
    : Math.max(0, Math.min(duration, frameTime(k, lattice))));
  const timeOf = (k) => frameTime(k, lattice);

  const originalTime = video.currentTime;
  video.pause();

  const sourceW = video.videoWidth || 1280;
  const sourceH = video.videoHeight || 720;
  const cropX = Math.max(0, Math.min(sourceW - 10, crop.left || 0));
  const cropY = Math.max(0, Math.min(sourceH - 10, crop.top || 0));
  const cropW = Math.max(10, sourceW - cropX - (crop.right || 0));
  const cropH = Math.max(10, sourceH - cropY - (crop.bottom || 0));

  // Aspect-preserving analysis thumbnail: squashing to a square distorts the
  // silhouette and the centroid drift measurement along with it.
  const longSide = 96;
  const ratio = cropH / cropW;
  const thumbW = ratio >= 1 ? Math.max(40, Math.round(longSide / ratio)) : longSide;
  const thumbH = ratio >= 1 ? longSide : Math.max(40, Math.round(longSide * ratio));

  const thumbCanvas = document.createElement('canvas');
  thumbCanvas.width = thumbW;
  thumbCanvas.height = thumbH;
  const thumbCtx = thumbCanvas.getContext('2d', { willReadFrequently: true });

  let seekCount = 0;
  // Every pass asks for frames by index, so one decode serves the coarse
  // scan, the refinement strips and the seam check alike.
  const captures = new Map();

  /** Seeks to native frame `k`, keys it and reduces it to a descriptor. */
  async function captureFrame(k) {
    const hit = captures.get(k);
    if (hit) return hit;
    await seekAsync(video, seekTimeOf(k));
    seekCount++;

    thumbCtx.clearRect(0, 0, thumbW, thumbH);
    thumbCtx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, thumbW, thumbH);

    let imgData = thumbCtx.getImageData(0, 0, thumbW, thumbH);
    if (keyingOn) {
      imgData = runKeyer(imgData, chromaOptions).imageData;
    }

    const sample = {
      frame: k,
      time: timeOf(k),
      imgData,
      descriptor: buildFrameDescriptor(imgData, thumbW, thumbH)
    };
    captures.set(k, sample);
    return sample;
  }

  async function captureFrames(list, onEach) {
    for (let n = 0; n < list.length; n++) {
      await captureFrame(list[n]);
      if (onEach) onEach(n);
    }
  }

  function thumbUrl(imgData) {
    thumbCtx.putImageData(imgData, 0, 0);
    return thumbCanvas.toDataURL('image/jpeg', 0.8);
  }

  // --- Pass 1: capture the coarse grid, in whole lattice frames. ---
  const kFirst = Math.min(maxFrame, frameIndexAt(searchStart, lattice));
  const kLast = Math.max(kFirst, Math.min(maxFrame, frameIndexAt(searchEnd, lattice)));
  let stride = Math.max(1, Math.round(stepTime / delta));
  while (Math.floor((kLast - kFirst) / stride) + 1 > maxSamples) stride++;

  const coarseFrames = [];
  for (let k = kFirst; k <= kLast; k += stride) coarseFrames.push(k);
  const plannedCount = coarseFrames.length;
  const gridNote = nativeGrid ? `, lưới ${nativeGrid.fps.toFixed(nativeGrid.standard && Number.isInteger(nativeGrid.fps) ? 0 : 2)} fps gốc` : '';
  onProgress(4, `Đang trích xuất ~${plannedCount} frames (${searchSpan.toFixed(2)}s video @ ${speed}x${gridNote})...`);

  await captureFrames(coarseFrames, (n) => {
    if (n % 5 === 0 || n === plannedCount - 1) {
      onProgress(4 + Math.round(((n + 1) / plannedCount) * 56), `Trích xuất frame ${n + 1}/${plannedCount}...`);
    }
  });

  const samples = coarseFrames.map((k) => captures.get(k));
  const times = samples.map((sample) => sample.time);
  const descriptors = samples.map((sample) => sample.descriptor);

  if (descriptors.length < 6) {
    await seekAsync(video, originalTime);
    onProgress(100, 'Phạm vi quét quá ngắn để phân tích chu kỳ.');
    return [];
  }

  // --- Pass 2: periodicity + seam ranking. ---
  onProgress(64, `Đang dò chu kỳ trên ${descriptors.length} frames & mục tiêu ~${targetFrames} frames...`);

  const matte = hasUsableMatte(descriptors);
  const analysis = findLoopCandidates(descriptors, times, {
    minCycle,
    maxCycle,
    playbackSpeed: speed,
    targetFrames,
    targetFps,
    matte,
    frameMode,
    frameTolerance: Math.max(0, Math.round(Number(options.frameTolerance) || 0)),
    maxCandidates: Math.max(1, Math.min(12, Math.round(Number(options.maxCandidates) || 6))),
    minSeparation: Math.max(stride * delta * 1.5, 0.12)
  });

  const candidates = analysis.candidates;
  if (!candidates.length) {
    await seekAsync(video, originalTime);
    onProgress(100, 'Không tìm thấy chu kỳ lặp rõ rệt.');
    return [];
  }

  const resolvedMode = analysis.diagnostics.frameMode;
  const fineCtx = { matte, coarse: false };
  const dist = (a, b) => {
    const A = captures.get(a);
    const B = captures.get(b);
    if (!A || !B) return null;
    return a === b ? 0 : descriptorDistance(A.descriptor, B.descriptor, fineCtx);
  };
  // Lattice frames per output frame: the spacing of the cells in the sheet.
  const stepFrames = outputStep / delta;

  for (const cand of candidates) {
    cand.startFrame = samples[cand.startIndex].frame;
    cand.endFrame = samples[cand.endIndex].frame;
  }

  // --- Pass 3: seam refinement on individual lattice frames. ---
  // The coarse grid only offers every `stride`-th frame as a seam, and scores
  // it with neighbours one sample apart. Here both ends move independently
  // frame by frame, and the neighbours sit one *output* step apart — the
  // spacing the loop is played at.
  const refineEnabled = options.refine !== false;
  const refineCount = Math.max(0, Math.min(candidates.length, Math.round(Number(options.refineCandidates ?? 3) || 0)));

  if (refineEnabled && refineCount > 0) {
    const searchRadius = Math.max(2, Math.min(8, Math.ceil(stride / 2) + 1));

    for (let c = 0; c < refineCount; c++) {
      const cand = candidates[c];
      onProgress(
        68 + Math.round((c / refineCount) * 18),
        `Tinh chỉnh viền nối ứng viên #${c + 1}/${refineCount} theo từng frame gốc...`
      );

      // The frame-count rule each mode already enforced on the coarse grid.
      // Exact/nearest: the cycle must still come out at the same number of
      // frames at the requested speed. Speed: the re-solved tempo must stay
      // inside what the speed control can hold.
      const acceptSpan = (span) => {
        const seconds = span * delta;
        if (seconds < minCycle - 1e-9 || seconds > maxCycle + 1e-9) return false;
        if (resolvedMode === 'speed') {
          const adapted = Math.round(((seconds * targetFps) / cand.calculatedFrames) * 100) / 100;
          return adapted >= 0.1 && adapted <= 16;
        }
        return Math.max(1, Math.round((seconds / speed) * targetFps)) === cand.calculatedFrames;
      };
      const refineOptions = {
        startFrame: cand.startFrame,
        endFrame: cand.endFrame,
        stepFrames,
        searchRadius,
        windowRadius: 1,
        minFrame: 0,
        maxFrame,
        acceptSpan,
        nominalSpan: resolvedMode === 'speed'
          ? cand.endFrame - cand.startFrame
          : cand.calculatedFrames * stepFrames
      };

      await captureFrames(seamRefinementFrames(refineOptions));
      const result = refineSeamOnFrames(refineOptions, dist);
      if (!result.changed || !(result.cost < result.anchorCost)) continue;

      const spanSeconds = (result.endFrame - result.startFrame) * delta;
      if (resolvedMode === 'speed') {
        // Speed mode buys the frame count with tempo, so a re-cut cycle needs
        // its tempo re-solved or the count drifts again. Quantised to the 2
        // decimals the speed control keeps, so the tempo on the card is the
        // tempo the player actually runs at.
        cand.speed = Math.round(((spanSeconds * targetFps) / cand.calculatedFrames) * 100) / 100;
        cand.effectiveDuration = cand.calculatedFrames / targetFps;
      } else {
        cand.effectiveDuration = spanSeconds / cand.speed;
      }

      const gain = result.gain;
      cand.startFrame = result.startFrame;
      cand.endFrame = result.endFrame;
      // Keep the reported cost on the ranking scale; only the ratio transfers.
      cand.seamCost = cand.seamCost * (1 - gain);
      cand.distance = cand.seamCost;
      cand.refined = true;
      // Reward the improvement without letting refinement outrank a genuinely
      // better cycle: the seam term can gain at most its own remaining headroom.
      cand.visualScore = Math.min(100, Math.round((cand.visualScore + ((100 - cand.visualScore) * gain)) * 10) / 10);
      cand.score = Math.min(100, Math.round((cand.score + ((100 - cand.score) * gain * 0.5)) * 10) / 10);
    }
  }

  for (const cand of candidates) {
    cand.startTime = timeOf(cand.startFrame);
    cand.endTime = timeOf(cand.endFrame);
    cand.duration = cand.endTime - cand.startTime;
  }

  // --- Pass 4: judge every seam with one yardstick, then rank on it. ---
  // Two measurements on native frames, for every candidate (refined or not):
  //  - the residual: windowed seam cost divided by an ordinary step of the
  //    loop's own motion, i.e. "the wrap is off by this many cells". Unlike
  //    the contrast-normalised coarse cost it compares across candidates of
  //    different length and speed, and refined candidates are not scored on a
  //    different scale from unrefined ones;
  //  - the as-played wrap on the planned cells (last cell → first against a
  //    step between cells), which also sees the pacing rounding of the plan.
  // The final score is re-composed from these with the same weights the
  // search used, so the order on screen is the order of the seams you see.
  onProgress(86, 'Đang đo độ lệch điểm nối trên đúng các frame sẽ xuất...');
  for (let c = 0; c < candidates.length; c++) {
    const cand = candidates[c];
    onProgress(86 + Math.round((c / candidates.length) * 8), `Đo điểm nối ${c + 1}/${candidates.length}...`);

    const residualOptions = {
      startFrame: cand.startFrame,
      endFrame: cand.endFrame,
      // Cells sit one output step apart at the candidate's own tempo.
      stepFrames: (cand.speed / targetFps) / delta,
      windowRadius: 1,
      samples: 8,
      minFrame: 0,
      maxFrame
    };
    await captureFrames(seamResidualFrames(residualOptions));
    const residual = seamResidual(residualOptions, dist);

    const plan = planLoopFrames({
      start: cand.startTime,
      end: cand.endTime,
      count: cand.calculatedFrames,
      closed: true,
      grid: lattice,
      duration
    });
    cand.pacing = nativeGrid ? describePacing(plan) : null;
    let jump = null;
    if (plan.frameIndices) {
      await captureFrames(seamJumpFrames(plan.frameIndices, 4));
      jump = seamJumpRatio(plan.frameIndices, dist, 4);
    }
    cand.seamJump = jump ? { ratio: Math.round(jump.ratio * 100) / 100, verdict: jump.verdict } : null;

    // 1 while the wrap reads like any other step, falling to 0 once it is
    // more than ~2.6 steps; a hold (the pose repeats) costs half as much.
    let played = null;
    if (jump) {
      played = 1 - (Math.max(0, jump.ratio - 1.15) / 1.5);
      if (jump.ratio < 0.35) played = 0.5 + (0.5 * (jump.ratio / 0.35));
      played = Math.max(0, Math.min(1, played));
    }

    if (residual) {
      const seamQ = seamQualityScore(residual.residual);
      const seamTerm = played === null ? seamQ : (0.75 * seamQ) + (0.25 * played);
      const w = LOOP_SCORE_WEIGHTS;
      const combined = (
        (w.seam * seamTerm) +
        (w.period * (cand.periodScore / 100)) +
        (w.frameFit * (cand.frameFitScore / 100)) +
        (w.activity * (cand.motionActivityScore / 100))
      ) / (w.seam + w.period + w.frameFit + w.activity);
      cand.score = toPercent(combined);
      cand.visualScore = toPercent(seamQ);
      cand.seamResidual = Math.round(residual.residual * 100) / 100;
      cand.seamVerdict = residual.verdict;
      cand.recommendedCrossfade = recommendCrossfade(residual.residual, cand.calculatedFrames);
    } else {
      // Subject barely moves: there is no step to measure against, so keep
      // the search's score and only let the as-played check weigh in.
      if (played !== null) cand.score = Math.round(cand.score * (0.85 + (0.15 * played)) * 10) / 10;
      cand.seamResidual = null;
      cand.seamVerdict = null;
      cand.recommendedCrossfade = 0;
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  // --- Pass 5: thumbnails, for the survivors only. ---
  onProgress(94, 'Đang dựng thumbnail cho các chu kỳ tối ưu...');

  const finalCandidates = [];
  for (const cand of candidates) {
    const startSample = await captureFrame(cand.startFrame);
    const endSample = await captureFrame(cand.endFrame);
    finalCandidates.push({
      id: `loop_${cand.startTime.toFixed(3)}_${cand.endTime.toFixed(3)}`,
      startTime: cand.startTime,
      endTime: cand.endTime,
      duration: Number(cand.duration.toFixed(3)),
      startFrame: nativeGrid ? cand.startFrame : null,
      endFrame: nativeGrid ? cand.endFrame : null,
      spanFrames: nativeGrid ? cand.endFrame - cand.startFrame : null,
      frameGridFps: nativeGrid ? nativeGrid.fps : null,
      speed: cand.speed,
      effectiveDuration: Number(cand.effectiveDuration.toFixed(3)),
      calculatedFrames: cand.calculatedFrames,
      calculatedFps: cand.calculatedFps,
      requestedSpeed: cand.requestedSpeed,
      frameMode: cand.frameMode,
      exactFrames: !!cand.exactFrames,
      score: cand.score,
      visualScore: cand.visualScore,
      periodScore: cand.periodScore,
      frameFitScore: cand.frameFitScore,
      speedFitScore: cand.speedFitScore,
      motionActivityScore: cand.motionActivityScore,
      refined: !!cand.refined,
      seamCost: Number(cand.seamCost.toFixed(4)),
      seamJump: cand.seamJump || null,
      seamResidual: cand.seamResidual ?? null,
      seamVerdict: cand.seamVerdict ?? null,
      recommendedCrossfade: cand.recommendedCrossfade ?? 0,
      pacing: cand.pacing || null,
      startThumb: thumbUrl(startSample.imgData),
      endThumb: thumbUrl(endSample.imgData)
    });
  }

  await seekAsync(video, originalTime);

  const unit = nativeGrid ? 'frame gốc' : 'lần seek';
  onProgress(
    100,
    `Tìm thấy ${finalCandidates.length} chu kỳ lặp (~${targetFrames} frames @ ${speed}x, ${seekCount} ${unit}).`
  );
  return finalCandidates;
}

/**
 * Blends one loop cell toward its periodic twin, in place.
 *
 * The twin is the frame one loop period away from the cell (see
 * planCrossfadeTwins in frame-grid.js), so the blend eases the motion into
 * the frames that really come before or after the seam, instead of pulling
 * tail cells toward the head of the loop — which played the head twice.
 *
 * With `morph` on, the two frames are blended at their meeting point along
 * the estimated displacement (seam-morph.js) instead of dissolved, so a limb
 * a few pixels off is drawn once, in between, rather than twice at half
 * opacity. The morph falls back to the plain dissolve on its own whenever the
 * flow does not explain the difference; with `morph` off the result is the
 * dissolve, byte for byte as before.
 *
 * @param {HTMLCanvasElement} target - Cell canvas, modified in place
 * @param {HTMLCanvasElement} twin - Twin frame, same size
 * @param {number} weight - Share of the twin, 0..1
 * @param {{ morph?: boolean }} [options]
 * @returns {{ mode: ('morph'|'dissolve'|'none'), gain?: number, meanShift?: number }}
 */
export function blendLoopTwin(target, twin, weight, options = {}) {
  const w = Math.max(0, Math.min(1, Number(weight) || 0));
  if (!target || !twin || w <= 0) return { mode: 'none' };
  const width = target.width;
  const height = target.height;
  if (!width || !height || twin.width !== width || twin.height !== height) return { mode: 'none' };

  const targetCtx = target.getContext('2d');
  const targetImgData = targetCtx.getImageData(0, 0, width, height);
  const twinImgData = twin.getContext('2d').getImageData(0, 0, width, height);

  // Both paths blend in linear light, not in sRGB code values: averaging two
  // gamma-encoded numbers lands darker than the light the frames carry, so
  // the seam would dip in brightness against its neighbours.
  let result;
  if (options.morph) {
    result = morphBlendImageData(targetImgData, twinImgData, w);
  } else {
    dissolveImageData(targetImgData, twinImgData, w);
    result = { mode: 'dissolve' };
  }

  targetCtx.putImageData(targetImgData, 0, 0);
  return result;
}

/**
 * As-played seam check on frames that are already on canvases (the loop
 * inspector's full-cycle player): the wrap from the last canvas to the first,
 * against an ordinary step between neighbours. Same yardstick the scanner's
 * seam check uses, so a nudged or hand-made trim gets a comparable verdict.
 *
 * With `nextFrame` — the frame one loop length after the first cell, i.e. the
 * frame the wrap stands in for — it also reports the residual the scanner
 * ranks on: how far that frame is from the first cell, in ordinary steps.
 *
 * @param {HTMLCanvasElement[]} canvases - The loop's cells, in order
 * @param {{ nextFrame?: HTMLCanvasElement }} [options]
 * @returns {{ ratio:number, seam:number, typical:number, verdict:string,
 *   residual:(number|null), residualVerdict:(string|null),
 *   recommendedCrossfade:number }|null}
 */
export function measureLoopSeam(canvases, options = {}) {
  if (!Array.isArray(canvases) || canvases.length < 3) return null;
  const descriptorOf = (canvas) => {
    const c2d = canvas?.getContext?.('2d');
    if (!c2d || !canvas.width || !canvas.height) return null;
    return buildFrameDescriptor(c2d.getImageData(0, 0, canvas.width, canvas.height), canvas.width, canvas.height);
  };
  // Only the cells the check reads are reduced: after Generate these are
  // full-resolution frames and a long sheet would otherwise be read whole.
  const indices = canvases.map((_, i) => i);
  const samples = Math.min(8, canvases.length - 1);
  const descriptors = new Map();
  for (const i of [0, ...seamJumpFrames(indices, samples)]) {
    if (descriptors.has(i)) continue;
    const d = descriptorOf(canvases[i]);
    if (!d) return null;
    descriptors.set(i, d);
  }
  const ctx = { matte: hasUsableMatte(Array.from(descriptors.values())), coarse: false };
  const distance = (a, b) => descriptorDistance(a, b, ctx);
  const jump = seamJumpRatio(
    indices,
    (a, b) => distance(descriptors.get(a), descriptors.get(b)),
    samples
  );
  if (!jump) return null;

  let residual = null;
  let residualVerdict = null;
  const next = options.nextFrame
    && options.nextFrame.width === canvases[0].width
    && options.nextFrame.height === canvases[0].height
    ? descriptorOf(options.nextFrame)
    : null;
  if (next) {
    residual = distance(descriptors.get(0), next) / jump.typical;
    residualVerdict = residual > 0.75 ? 'jump' : (residual > 0.3 ? 'bump' : 'smooth');
  }
  return {
    ...jump,
    residual,
    residualVerdict,
    recommendedCrossfade: recommendCrossfade(residual, canvases.length)
  };
}

/**
 * Renders a visual difference heatmap between two canvases onto a target canvas.
 *
 * @param {HTMLCanvasElement} canvasA - Start frame canvas
 * @param {HTMLCanvasElement} canvasB - End frame canvas
 * @param {HTMLCanvasElement} targetCanvas - Canvas to render heatmap onto
 */
export function createDiffHeatmapCanvas(canvasA, canvasB, targetCanvas) {
  if (!canvasA || !canvasB || !targetCanvas) return;
  const w = Math.min(canvasA.width, canvasB.width);
  const h = Math.min(canvasA.height, canvasB.height);
  if (!w || !h) return;

  targetCanvas.width = w;
  targetCanvas.height = h;

  const ctxA = canvasA.getContext('2d');
  const ctxB = canvasB.getContext('2d');
  const ctxT = targetCanvas.getContext('2d');

  const dataA = ctxA.getImageData(0, 0, w, h).data;
  const dataB = ctxB.getImageData(0, 0, w, h).data;
  const imgOut = ctxT.createImageData(w, h);
  const out = imgOut.data;

  for (let i = 0; i < dataA.length; i += 4) {
    const aA = dataA[i + 3];
    const aB = dataB[i + 3];
    const alphaDiff = Math.abs(aA - aB);

    const dr = Math.abs(dataA[i] - dataB[i]);
    const dg = Math.abs(dataA[i + 1] - dataB[i + 1]);
    const db = Math.abs(dataA[i + 2] - dataB[i + 2]);
    const colorDiff = (dr + dg + db) / 3;

    const diff = Math.min(255, Math.round((alphaDiff * 0.6) + (colorDiff * 0.4)));

    if (aA < 15 && aB < 15) {
      // Both transparent background: dark neutral
      out[i] = 15;
      out[i + 1] = 23;
      out[i + 2] = 42;
      out[i + 3] = 255;
    } else if (diff < 22) {
      // Near-perfect match: vibrant emerald green
      out[i] = 16;
      out[i + 1] = 185;
      out[i + 2] = 129;
      out[i + 3] = 235;
    } else if (diff < 65) {
      // Minor pose discrepancy: warm amber
      out[i] = 245;
      out[i + 1] = 158;
      out[i + 2] = 11;
      out[i + 3] = 245;
    } else {
      // Major mismatch (jump/stutter location): vivid rose/red
      out[i] = 239;
      out[i + 1] = 68;
      out[i + 2] = 68;
      out[i + 3] = 255;
    }
  }

  ctxT.putImageData(imgOut, 0, 0);
}
