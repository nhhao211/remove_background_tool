/**
 * Animation Loop Optimizer & Periodicity Seeker
 * Video Background Remover & Sprite Sheet Studio
 *
 * Provides intelligent cycle detection, closed-loop modular sampling,
 * and temporal crossfade blending to eliminate animation stutter/jump at loop seams.
 */

import { runKeyer } from './keyer/index.js';

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
 * Analyzes silhouette IoU distance, Redmean RGB foreground difference, and centroid drift.
 *
 * @param {ImageData} imgDataA - First frame image data
 * @param {ImageData} imgDataB - Second frame image data
 * @param {number} width - Frame width
 * @param {number} height - Frame height
 * @returns {{ distance: number, similarity: number }}
 */
export function computeFrameDistance(imgDataA, imgDataB, width, height) {
  if (!imgDataA || !imgDataB) return { distance: 1, similarity: 0 };
  const dataA = imgDataA.data;
  const dataB = imgDataB.data;
  const totalPixels = width * height;
  if (!totalPixels || dataA.length !== dataB.length) return { distance: 1, similarity: 0 };

  let alphaDiffSum = 0;
  let colorDiffSum = 0;
  let overlapPixels = 0;
  let sumXA = 0;
  let sumYA = 0;
  let countA = 0;
  let sumXB = 0;
  let sumYB = 0;
  let countB = 0;

  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    const aA = dataA[idx + 3];
    const aB = dataB[idx + 3];

    alphaDiffSum += Math.abs(aA - aB);

    const x = i % width;
    const y = Math.floor(i / width);

    if (aA >= 25) {
      sumXA += x;
      sumYA += y;
      countA++;
    }
    if (aB >= 25) {
      sumXB += x;
      sumYB += y;
      countB++;
    }

    if (aA >= 25 && aB >= 25) {
      const rA = dataA[idx];
      const gA = dataA[idx + 1];
      const bA = dataA[idx + 2];
      const rB = dataB[idx];
      const gB = dataB[idx + 1];
      const bB = dataB[idx + 2];

      const rMean = (rA + rB) / 2;
      const dr = rA - rB;
      const dg = gA - gB;
      const db = bA - bB;

      // Weighted Redmean color metric (0 - ~765)
      const dColor = Math.sqrt(
        (2 + (rMean / 256)) * dr * dr +
        4 * dg * dg +
        (2 + ((255 - rMean) / 256)) * db * db
      );
      colorDiffSum += dColor / 765;
      overlapPixels++;
    }
  }

  // 1. Normalized Alpha Silhouette Difference: 0 (identical shape) to 1 (completely disjoint)
  const normAlphaDist = alphaDiffSum / (totalPixels * 255);

  // 2. Normalized Color Difference on overlapping foreground pixels: 0 to 1
  const normColorDist = overlapPixels > 0 ? (colorDiffSum / overlapPixels) : 1;

  // 3. Centroid Shift Penalty (measures whether subject moved horizontally/vertically)
  const cxA = countA > 0 ? (sumXA / countA) : (width / 2);
  const cyA = countA > 0 ? (sumYA / countA) : (height / 2);
  const cxB = countB > 0 ? (sumXB / countB) : (width / 2);
  const cyB = countB > 0 ? (sumYB / countB) : (height / 2);
  const maxDiagonal = Math.hypot(width, height) || 1;
  const centroidDrift = Math.hypot(cxA - cxB, cyA - cyB) / maxDiagonal;

  // Combined distance: weighted composition
  const totalDistance = Math.min(1, Math.max(0,
    (normAlphaDist * 0.45) + (normColorDist * 0.40) + (centroidDrift * 0.15)
  ));

  const similarity = Math.max(0, Math.min(100, Math.round((1 - totalDistance) * 1000) / 10));

  return { distance: totalDistance, similarity };
}

/**
 * Scans video range to detect candidate seamless loop cycles.
 *
 * @param {HTMLVideoElement} video - HTML5 video element
 * @param {Object} [options={}] - Scan parameters
 * @param {number} [options.duration] - Total video duration in seconds
 * @param {number} [options.searchStart=0] - Start timestamp for search range
 * @param {number} [options.searchEnd] - End timestamp for search range
 * @param {number} [options.minCycleDuration=0.35] - Minimum valid loop cycle length in seconds
 * @param {number} [options.maxCycleDuration=4.5] - Maximum valid loop cycle length in seconds
 * @param {number} [options.sampleRate=20] - Sampling frequency in frames per second
 * @param {Object} [options.chromaOptions] - Chroma key configuration for background removal
 * @param {Object} [options.cropOptions] - Video crop margins { top, bottom, left, right }
 * @param {Function} [options.onProgress] - Progress callback (percentage: number, statusText: string)
 * @param {Function} [options.seekVideoAsync] - Helper function to seek video asynchronously
 * @returns {Promise<Array<Object>>} List of top candidate loop cycles
 */
/**
 * Scans video range to detect candidate seamless loop cycles.
 * Supports speed acceleration for multi-action footage and frame budget targeting (~24 frames).
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
 * @param {number} [options.sampleRate=20] - Sampling frequency in frames per second
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

  // Ideal source duration to produce exactly targetFrames at targetFps after speed acceleration
  const idealSourceDuration = (targetFrames * speed) / targetFps;

  const defaultMinCycle = Math.max(0.25, Math.min(searchSpan * 0.9, idealSourceDuration * 0.4));
  const defaultMaxCycle = Math.min(searchSpan, Math.max(defaultMinCycle + 0.2, idealSourceDuration * 1.8));

  const minCycle = Math.max(0.2, Number(options.minCycleDuration) || defaultMinCycle);
  const maxCycle = Math.min(searchSpan, Math.max(minCycle + 0.1, Number(options.maxCycleDuration) || defaultMaxCycle));

  const sampleRate = Math.max(10, Math.min(30, Math.round(Number(options.sampleRate) || 20)));
  const stepTime = 1 / sampleRate;

  const chromaOptions = options.chromaOptions || { enabled: false, keyColors: [] };
  const crop = options.cropOptions || { top: 0, bottom: 0, left: 0, right: 0 };

  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  const seekAsync = typeof options.seekVideoAsync === 'function' ? options.seekVideoAsync : (vid, time) => {
    return new Promise((resolve) => {
      let resolved = false;
      const onSeeked = () => {
        if (!resolved) {
          resolved = true;
          vid.removeEventListener('seeked', onSeeked);
          resolve();
        }
      };
      vid.addEventListener('seeked', onSeeked);
      vid.currentTime = Math.min(time, duration);
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          vid.removeEventListener('seeked', onSeeked);
          resolve();
        }
      }, 800);
    });
  };

  // Thumbnail dimensions for rapid client-side frame matching
  const thumbW = 72;
  const thumbH = 72;
  const thumbCanvas = document.createElement('canvas');
  thumbCanvas.width = thumbW;
  thumbCanvas.height = thumbH;
  const thumbCtx = thumbCanvas.getContext('2d', { willReadFrequently: true });

  const originalTime = video.currentTime;
  const wasPaused = video.paused;
  video.pause();

  const sourceW = video.videoWidth || 1280;
  const sourceH = video.videoHeight || 720;
  const cropX = Math.max(0, Math.min(sourceW - 10, crop.left || 0));
  const cropY = Math.max(0, Math.min(sourceH - 10, crop.top || 0));
  const cropW = Math.max(10, sourceW - cropX - (crop.right || 0));
  const cropH = Math.max(10, sourceH - cropY - (crop.bottom || 0));

  const sampleTimestamps = [];
  for (let t = searchStart; t <= searchEnd + 0.001; t += stepTime) {
    sampleTimestamps.push(Math.min(searchEnd, Number(t.toFixed(4))));
  }
  const totalSamples = sampleTimestamps.length;
  if (totalSamples < 5) return [];

  onProgress(5, `Đang trích xuất ${totalSamples} frames (${searchSpan.toFixed(2)}s video @ ${speed}x)...`);

  // Step 1: Capture and process all sample frames
  const sampleFrames = [];

  for (let i = 0; i < totalSamples; i++) {
    const t = sampleTimestamps[i];
    await seekAsync(video, t);

    thumbCtx.clearRect(0, 0, thumbW, thumbH);
    thumbCtx.drawImage(
      video,
      cropX, cropY, cropW, cropH,
      0, 0, thumbW, thumbH
    );

    let imgData = thumbCtx.getImageData(0, 0, thumbW, thumbH);
    if (chromaOptions.enabled && chromaOptions.keyColors && chromaOptions.keyColors.length > 0) {
      const keyResult = runKeyer(imgData, chromaOptions);
      imgData = keyResult.imageData;
      thumbCtx.putImageData(imgData, 0, 0);
    }

    sampleFrames.push({
      index: i,
      time: t,
      imgData,
      thumbDataUrl: thumbCanvas.toDataURL('image/jpeg', 0.8)
    });

    const progressPct = 5 + Math.round(((i + 1) / totalSamples) * 60);
    if (i % 5 === 0 || i === totalSamples - 1) {
      onProgress(progressPct, `Trích xuất frame ${i + 1}/${totalSamples}...`);
    }
  }

  // Step 2: Compute upper-triangle frame distance matrix and evaluate periodic cycles
  onProgress(70, `Đang phân tích độ khớp chu kỳ & mục tiêu ~${targetFrames} frames...`);

  const distanceCache = new Map();
  function getPairDistance(idxA, idxB) {
    if (idxA === idxB) return { distance: 0, similarity: 100 };
    const minI = Math.min(idxA, idxB);
    const maxI = Math.max(idxA, idxB);
    const key = `${minI}_${maxI}`;
    if (distanceCache.has(key)) return distanceCache.get(key);

    const result = computeFrameDistance(sampleFrames[minI].imgData, sampleFrames[maxI].imgData, thumbW, thumbH);
    distanceCache.set(key, result);
    return result;
  }

  const rawCandidates = [];

  for (let i = 0; i < totalSamples; i++) {
    const timeA = sampleFrames[i].time;

    for (let j = i + 1; j < totalSamples; j++) {
      const timeB = sampleFrames[j].time;
      const cycleDuration = timeB - timeA;

      if (cycleDuration < minCycle) continue;
      if (cycleDuration > maxCycle) break;

      const mainPair = getPairDistance(i, j);

      // Check continuity on neighboring frames to ensure directional velocity matches
      let continuityDistance = mainPair.distance;
      let countNeighbors = 1;

      if (i + 1 < totalSamples && j + 1 < totalSamples) {
        continuityDistance += getPairDistance(i + 1, j + 1).distance * 0.5;
        countNeighbors += 0.5;
      }
      if (i - 1 >= 0 && j - 1 >= 0) {
        continuityDistance += getPairDistance(i - 1, j - 1).distance * 0.5;
        countNeighbors += 0.5;
      }

      const avgDistance = continuityDistance / countNeighbors;
      const visualScore = Math.max(0, Math.min(100, Math.round((1 - avgDistance) * 1000) / 10));

      // Calculate candidate frames at chosen Speed and FPS
      const effectiveDuration = cycleDuration / speed;
      const candFrames = Math.max(1, Math.round(effectiveDuration * targetFps));
      const frameError = Math.abs(candFrames - targetFrames);

      // Frame Fit Score (100% when candFrames === targetFrames, decreases by 8% per frame difference)
      const frameFitScore = Math.max(0, Math.min(100, 100 - (frameError * 8.5)));

      // Measure internal action motion activity (ensures subject actually moves dynamically)
      const midIdx = Math.floor((i + j) / 2);
      const motionDist = getPairDistance(i, midIdx).distance;
      const motionActivityScore = Math.min(100, Math.round(motionDist * 180));

      // Combined Multi-Action Loop Score
      // 55% Visual match at seam + 35% Frame fit (~24f) + 10% Dynamic action bonus
      const combinedScore = Math.max(0, Math.min(100, Math.round(
        ((visualScore * 0.55) + (frameFitScore * 0.35) + (motionActivityScore * 0.10)) * 10
      ) / 10));

      rawCandidates.push({
        startIndex: i,
        endIndex: j,
        startTime: timeA,
        endTime: timeB,
        duration: Number(cycleDuration.toFixed(3)),
        speed,
        effectiveDuration: Number(effectiveDuration.toFixed(3)),
        calculatedFrames: candFrames,
        calculatedFps: targetFps,
        score: combinedScore,
        visualScore,
        frameFitScore,
        motionActivityScore,
        distance: avgDistance,
        startThumb: sampleFrames[i].thumbDataUrl,
        endThumb: sampleFrames[j].thumbDataUrl
      });
    }
  }

  onProgress(90, 'Xếp hạng các chu kỳ tối ưu...');

  // Step 3: Filter local peaks and non-maximum suppression (avoid clusters of overlapping frames)
  rawCandidates.sort((a, b) => b.score - a.score);

  const finalCandidates = [];
  const minTimeSeparation = 0.18; // Seconds of separation between distinct candidate loop suggestions

  for (const cand of rawCandidates) {
    if (finalCandidates.length >= 6) break;

    const isDuplicate = finalCandidates.some((existing) => {
      const diffStart = Math.abs(existing.startTime - cand.startTime);
      const diffEnd = Math.abs(existing.endTime - cand.endTime);
      return diffStart < minTimeSeparation && diffEnd < minTimeSeparation;
    });

    if (!isDuplicate) {
      finalCandidates.push({
        id: `loop_${cand.startTime.toFixed(2)}_${cand.endTime.toFixed(2)}`,
        startTime: cand.startTime,
        endTime: cand.endTime,
        duration: cand.duration,
        speed: cand.speed,
        effectiveDuration: cand.effectiveDuration,
        calculatedFrames: cand.calculatedFrames,
        calculatedFps: cand.calculatedFps,
        score: cand.score,
        visualScore: cand.visualScore,
        frameFitScore: cand.frameFitScore,
        motionActivityScore: cand.motionActivityScore,
        startThumb: cand.startThumb,
        endThumb: cand.endThumb
      });
    }
  }

  // Restore original video state
  await seekAsync(video, originalTime);
  if (!wasPaused) {
    // Keep paused as safe default after analysis
  }

  onProgress(100, `Tìm thấy ${finalCandidates.length} chu kỳ lặp (~${targetFrames} frames @ ${speed}x)!`);
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
