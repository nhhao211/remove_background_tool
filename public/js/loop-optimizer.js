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
import {
  buildFrameDescriptor,
  descriptorDistance,
  findLoopCandidates,
  hasUsableMatte
} from './loop-analysis.js';

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
  const count = Math.max(1, Math.round(Number(frameCount) || 1));
  const s = Math.max(0, Number(startTime) || 0);
  const e = Math.max(s, Number(endTime) || s);
  const span = e - s;

  const timestamps = [];
  if (count === 1 || span <= 0) {
    for (let i = 0; i < count; i++) timestamps.push(s);
    return timestamps;
  }

  if (isClosedLoop) {
    // Closed periodic cycle: N intervals across [s, e).
    // Frame N-1 ends right before e, so when animation loops back to Frame 0 (at s === e in cycle),
    // there is NO duplicate frame at the boundary.
    const step = span / count;
    for (let i = 0; i < count; i++) {
      timestamps.push(s + (i * step));
    }
  } else {
    // Open linear range: N-1 intervals across [s, e]. Last frame is exactly at e.
    const step = span / (count - 1);
    for (let i = 0; i < count; i++) {
      timestamps.push(s + (i * step));
    }
  }

  return timestamps;
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
 * Scans video range to detect candidate seamless loop cycles.
 *
 * Pipeline: adaptive sampling -> per-frame descriptors -> coarse lag profile
 * (periodicity) -> fine windowed seam cost -> contrast-normalised scoring ->
 * sub-sample refinement of the winners.
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
 * @param {boolean} [options.refine=true] - Run the sub-sample seam refinement pass
 * @param {number} [options.refineCandidates=3] - How many top candidates to refine
 * @param {number} [options.maxCandidates=6] - How many candidates to return
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

  const chromaOptions = options.chromaOptions || { enabled: false, keyColors: [] };
  const keyingOn = !!(chromaOptions.enabled && chromaOptions.keyColors && chromaOptions.keyColors.length > 0);
  const crop = options.cropOptions || { top: 0, bottom: 0, left: 0, right: 0 };

  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  const seekAsync = typeof options.seekVideoAsync === 'function'
    ? options.seekVideoAsync
    : defaultSeek(duration);

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

  /**
   * Seeks, grabs the frame, keys it and reduces it to a descriptor.
   * The timestamp reported back is the decoder's actual position, not the
   * requested one — those differ by up to half a source frame and that error
   * used to land straight in the returned trim points.
   */
  async function captureSample(requestedTime) {
    await seekAsync(video, Math.max(0, Math.min(duration, requestedTime)));
    seekCount++;
    const actualTime = Number.isFinite(video.currentTime) ? video.currentTime : requestedTime;

    thumbCtx.clearRect(0, 0, thumbW, thumbH);
    thumbCtx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, thumbW, thumbH);

    let imgData = thumbCtx.getImageData(0, 0, thumbW, thumbH);
    if (keyingOn) {
      imgData = runKeyer(imgData, chromaOptions).imageData;
    }

    return {
      time: actualTime,
      imgData,
      descriptor: buildFrameDescriptor(imgData, thumbW, thumbH)
    };
  }

  function thumbUrl(imgData) {
    thumbCtx.putImageData(imgData, 0, 0);
    return thumbCanvas.toDataURL('image/jpeg', 0.8);
  }

  // --- Pass 1: capture the coarse grid. ---
  const plannedCount = Math.max(1, Math.floor((searchEnd - searchStart) / stepTime) + 1);
  onProgress(4, `Đang trích xuất ~${plannedCount} frames (${searchSpan.toFixed(2)}s video @ ${speed}x)...`);

  const samples = [];
  const times = [];
  const descriptors = [];
  let lastTime = -Infinity;

  for (let n = 0; n < plannedCount; n++) {
    const t = Math.min(searchEnd, searchStart + (n * stepTime));
    const sample = await captureSample(t);

    // A grid finer than the source frame rate returns the same decoded frame
    // twice; keeping it would fake a zero-cost seam.
    if (sample.time > lastTime + 1e-4) {
      lastTime = sample.time;
      samples.push(sample);
      times.push(sample.time);
      descriptors.push(sample.descriptor);
    }

    if (n % 5 === 0 || n === plannedCount - 1) {
      onProgress(4 + Math.round(((n + 1) / plannedCount) * 56), `Trích xuất frame ${n + 1}/${plannedCount}...`);
    }
  }

  // When the sampling grid outran the source frame rate, duplicate decodes were
  // dropped above; the smallest surviving gap is then the native frame duration,
  // which is the finest step refinement can usefully ask for.
  let minGap = Infinity;
  for (let i = 1; i < times.length; i++) {
    const gap = times[i] - times[i - 1];
    if (gap > 1e-4 && gap < minGap) minGap = gap;
  }
  const droppedDuplicates = plannedCount - times.length;
  const nativeStep = droppedDuplicates > 0 && Number.isFinite(minGap) ? minGap : 0;

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
    maxCandidates: Math.max(1, Math.min(12, Math.round(Number(options.maxCandidates) || 6))),
    minSeparation: Math.max(stepTime * 1.5, 0.12)
  });

  let candidates = analysis.candidates;
  if (!candidates.length) {
    await seekAsync(video, originalTime);
    onProgress(100, 'Không tìm thấy chu kỳ lặp rõ rệt.');
    return [];
  }

  // --- Pass 3: sub-sample refinement of the winners. ---
  // The coarse grid quantises every seam to `stepTime`; at 12 fps sampling that
  // is ~1.5 source frames of slop, which is exactly the residual jump users see.
  const refineEnabled = options.refine !== false;
  const refineCount = Math.max(0, Math.min(candidates.length, Math.round(Number(options.refineCandidates ?? 3) || 0)));

  if (refineEnabled && refineCount > 0) {
    const fineStep = Math.max(stepTime / 4, nativeStep);
    const STRIP = 3; // strip covers offsets -3..3 so a +-2 shift keeps a +-1 window
    const SHIFT = 2;

    for (let c = 0; c < refineCount; c++) {
      const cand = candidates[c];
      onProgress(
        68 + Math.round((c / refineCount) * 22),
        `Tinh chỉnh viền nối ứng viên #${c + 1}/${refineCount}...`
      );

      const startStrip = [];
      const endStrip = [];
      let usable = true;

      for (let k = -STRIP; k <= STRIP && usable; k++) {
        const ts = cand.startTime + (k * fineStep);
        const te = cand.endTime + (k * fineStep);
        if (ts < 0 || te > duration) {
          usable = false;
          break;
        }
        startStrip.push(await captureSample(ts));
        endStrip.push(await captureSample(te));
      }
      if (!usable) continue;

      // Cost of a fixed fine-grained window, so the refined offsets and the
      // unrefined one are measured with the exact same yardstick. Comparing a
      // fine window against the coarse ranking cost would report a gain on
      // every candidate purely because the window shrank.
      const localCost = (si, ei) => {
        let acc = 0;
        let wsum = 0;
        for (let k = -1; k <= 1; k++) {
          const w = k === 0 ? 2 : 1;
          acc += w * descriptorDistance(
            startStrip[si + k].descriptor,
            endStrip[ei + k].descriptor,
            { matte, coarse: false }
          );
          wsum += w;
        }
        return acc / wsum;
      };

      const anchorCost = localCost(STRIP, STRIP);
      let best = null;
      for (let ds = -SHIFT; ds <= SHIFT; ds++) {
        for (let de = -SHIFT; de <= SHIFT; de++) {
          const si = ds + STRIP;
          const ei = de + STRIP;
          const newDuration = endStrip[ei].time - startStrip[si].time;
          if (newDuration < minCycle || newDuration > maxCycle) continue;
          const cost = localCost(si, ei);
          if (!best || cost < best.cost) {
            best = { cost, si, ei, newDuration };
          }
        }
      }

      if (best && best.cost < anchorCost) {
        const s = startStrip[best.si];
        const e = endStrip[best.ei];
        const effective = best.newDuration / speed;
        const frames = Math.max(1, Math.round(effective * targetFps));
        const gain = anchorCost > 1e-9 ? Math.max(0, 1 - (best.cost / anchorCost)) : 0;

        cand.startTime = s.time;
        cand.endTime = e.time;
        cand.duration = best.newDuration;
        cand.effectiveDuration = effective;
        cand.calculatedFrames = frames;
        // Keep the reported cost on the ranking scale; only the ratio transfers.
        cand.seamCost = cand.seamCost * (1 - gain);
        cand.distance = cand.seamCost;
        cand.refined = true;
        // Reward the improvement without letting refinement outrank a genuinely
        // better cycle: the seam term can gain at most its own remaining headroom.
        cand.visualScore = Math.min(100, Math.round((cand.visualScore + ((100 - cand.visualScore) * gain)) * 10) / 10);
        cand.score = Math.min(100, Math.round((cand.score + ((100 - cand.score) * gain * 0.5)) * 10) / 10);
        cand.startSample = s;
        cand.endSample = e;
      }
    }

    candidates.sort((a, b) => b.score - a.score);
  }

  // --- Pass 4: thumbnails, for the survivors only. ---
  onProgress(94, 'Đang dựng thumbnail cho các chu kỳ tối ưu...');

  const finalCandidates = candidates.map((cand) => ({
    id: `loop_${cand.startTime.toFixed(3)}_${cand.endTime.toFixed(3)}`,
    startTime: cand.startTime,
    endTime: cand.endTime,
    duration: Number(cand.duration.toFixed(3)),
    speed: cand.speed,
    effectiveDuration: Number(cand.effectiveDuration.toFixed(3)),
    calculatedFrames: cand.calculatedFrames,
    calculatedFps: cand.calculatedFps,
    score: cand.score,
    visualScore: cand.visualScore,
    periodScore: cand.periodScore,
    frameFitScore: cand.frameFitScore,
    motionActivityScore: cand.motionActivityScore,
    refined: !!cand.refined,
    seamCost: Number(cand.seamCost.toFixed(4)),
    startThumb: thumbUrl((cand.startSample || samples[cand.startIndex]).imgData),
    endThumb: thumbUrl((cand.endSample || samples[cand.endIndex]).imgData)
  }));

  await seekAsync(video, originalTime);

  onProgress(
    100,
    `Tìm thấy ${finalCandidates.length} chu kỳ lặp (~${targetFrames} frames @ ${speed}x, ${seekCount} lần seek).`
  );
  return finalCandidates;
}

/**
 * Applies temporal crossfade blending to the boundary frames of an animation.
 * Smoothly blends the last k frames into the first k frames using smoothstep interpolation.
 *
 * @param {HTMLCanvasElement[]} frames - Array of individual frame canvas elements
 * @param {number} crossfadeCount - Number of frames to blend (0 to 6)
 */
export function applyLoopCrossfade(frames, crossfadeCount = 0) {
  const k = Math.max(0, Math.min(Math.floor(frames.length / 2), Math.round(Number(crossfadeCount) || 0)));
  if (k <= 0 || !Array.isArray(frames) || frames.length < k * 2) return;

  const N = frames.length;
  const width = frames[0].width;
  const height = frames[0].height;

  for (let m = 0; m < k; m++) {
    const tailIndex = N - k + m;
    const headIndex = m;

    const tailCtx = frames[tailIndex].getContext('2d');
    const headCtx = frames[headIndex].getContext('2d');

    const tailImgData = tailCtx.getImageData(0, 0, width, height);
    const headImgData = headCtx.getImageData(0, 0, width, height);

    const tailData = tailImgData.data;
    const headData = headImgData.data;

    // Smoothstep transition factor across the crossfade window
    const t = (m + 1) / (k + 1);
    const weightHead = t * t * (3 - (2 * t));
    const weightTail = 1 - weightHead;

    for (let i = 0; i < tailData.length; i += 4) {
      const aTail = tailData[i + 3] / 255;
      const aHead = headData[i + 3] / 255;

      const alphaOut = (aTail * weightTail) + (aHead * weightHead);
      if (alphaOut > 0.001) {
        tailData[i] = Math.round(((tailData[i] * aTail * weightTail) + (headData[i] * aHead * weightHead)) / alphaOut);
        tailData[i + 1] = Math.round(((tailData[i + 1] * aTail * weightTail) + (headData[i + 1] * aHead * weightHead)) / alphaOut);
        tailData[i + 2] = Math.round(((tailData[i + 2] * aTail * weightTail) + (headData[i + 2] * aHead * weightHead)) / alphaOut);
        tailData[i + 3] = Math.round(alphaOut * 255);
      } else {
        tailData[i + 3] = 0;
      }
    }

    tailCtx.putImageData(tailImgData, 0, 0);
  }
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
