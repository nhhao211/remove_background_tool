import { clamp01, colorMetrics, colorMetricsLinear, keyDistance, normalizeColor, smootherstep, SRGB_TO_LINEAR } from "./color.js";
import { detectEdgeColors } from './background.js';
import { dilateMask, erodeForegroundAlpha } from './refine.js';
import { createRegionAllows } from './regions.js';
import { suppressSpill } from './spill.js';

/**
 * The two matting strategies, moved across unchanged.
 *
 * `applyDirectMatte` was `applyChromaKey` — every pixel is judged on colour
 * alone, so an enclosed background pocket is keyed out along with the surround.
 * `applyConnectedMatte` was `removeConnectedBackground` — only background
 * reachable from the frame border (or an explicit seed) is keyed, so pockets
 * survive.
 *
 * Their tuning constants differ and are deliberately NOT merged into a shared
 * table. The numbers below are the shipped ones, and a shared table is exactly
 * how they would silently drift into each other during this move. Phase 3 is
 * where they get reconciled on purpose, with the baseline showing the diff.
 */

/**
 * Video path. Colour-distance matte, no connectivity.
 *
 * `options.protectionMask` is a FLAT Uint8ClampedArray of one byte per pixel,
 * not an ImageData — `protection-mask.js` unpacks alpha into it before calling.
 * The length check below is the only guard, so a wrong-shaped mask is ignored
 * rather than throwing.
 *
 * Mutates and returns `imageData`.
 */
export function applyDirectMatte(imageData, options = {}) {
  const keyColors = Array.isArray(options.keyColors) ? options.keyColors : [];
  if (options.enabled === false || keyColors.length === 0) return imageData;

  const similarity = clamp01(options.similarity ?? 0.55);
  const blend = clamp01(options.blend ?? 0.18);
  const spill = clamp01(options.spill ?? 0.55);
  const subjectProtection = clamp01(options.subjectProtection ?? 0.50);
  const cleanupRadius = Math.max(0, Math.min(3, Math.round(Number(options.cleanupRadius) || 0)));
  const protectionMask = options.protectionMask?.length === (imageData.data.length / 4)
    ? options.protectionMask
    : null;
  const protectedDecontamination = clamp01(options.protectedDecontamination ?? 0.80);
  const keys = keyColors.map(colorMetrics);

  // Non-linear mappings reserve more useful slider travel for clean, narrow
  // mattes while still allowing aggressive removal at the upper end.
  const transparentThreshold = 0.018 + (0.30 * Math.pow(similarity, 1.4));
  const featherWidth = 0.002 + (0.12 * Math.pow(blend, 1.55));
  const spillReach = transparentThreshold + featherWidth + 0.10 + (0.10 * similarity);
  const luminanceWeight = 0.08 + (0.90 * Math.pow(subjectProtection, 1.5));
  const data = imageData.data;
  const sourceAlpha = protectionMask ? new Uint8Array(data.length / 4) : null;
  const effectiveProtection = protectionMask ? new Uint8Array(data.length / 4) : null;

  for (let i = 0; i < data.length; i += 4) {
    const pixelIndex = i / 4;
    const inputAlpha = data[i + 3];
    if (sourceAlpha) sourceAlpha[pixelIndex] = inputAlpha;
    if (inputAlpha === 0) continue;

    const pixel = colorMetrics({ r: data[i], g: data[i + 1], b: data[i + 2] });
    let nearestKey = keys[0];
    let distance = keyDistance(pixel, nearestKey, luminanceWeight);

    for (let k = 1; k < keys.length; k += 1) {
      const candidateDistance = keyDistance(pixel, keys[k], luminanceWeight);
      if (candidateDistance < distance) {
        distance = candidateDistance;
        nearestKey = keys[k];
      }
    }

    const matte = smootherstep(transparentThreshold, transparentThreshold + featherWidth, distance);
    data[i + 3] = Math.round(inputAlpha * matte);

    // A painted area is only restored when its color differs enough from the
    // sampled backdrop to provide evidence of foreground detail. Exact (or
    // nearly exact) key-color pixels remain transparent, so broad brush
    // strokes cannot bring a solid patch of background into the sprite.
    const paintedProtection = protectionMask ? protectionMask[pixelIndex] / 255 : 0;
    const evidenceEnd = Math.max(0.024, transparentThreshold * 0.34);
    const subjectEvidence = smootherstep(0.004, evidenceEnd, distance);
    const protection = paintedProtection * subjectEvidence;
    if (effectiveProtection) effectiveProtection[pixelIndex] = Math.round(protection * 255);

    if (spill > 0 && (matte > 0 || protection > 0)) {
      const proximity = 1 - smootherstep(transparentThreshold + featherWidth, spillReach, distance);
      const edgeWeight = 0.35 + (0.65 * (1 - matte));
      const colorRetention = 1 - (subjectProtection * (0.15 + (0.75 * matte)));
      const regularCleanup = spill * proximity * edgeWeight * colorRetention;
      // Protected translucent pixels need more, not less, backdrop-color
      // cleanup. This removes the key-color component that was mixed through
      // petals, hair, glass, smoke, and other partial-alpha detail.
      const protectedCleanup = spill * protection * protectedDecontamination * (0.45 + (0.55 * (1 - matte)));
      suppressSpill(data, i, pixel, nearestKey, Math.max(regularCleanup, protectedCleanup));
    }
  }

  erodeForegroundAlpha(imageData, cleanupRadius);

  // A painted mask attenuates removal after edge cleanup. The mask already
  // includes brush opacity and the selected preset's residual-keying amount.
  // Blending toward the input alpha preserves soft/translucent subject detail
  // without forcing every protected pixel to be fully opaque.
  if (effectiveProtection && sourceAlpha) {
    for (let pixelIndex = 0; pixelIndex < sourceAlpha.length; pixelIndex += 1) {
      const protection = effectiveProtection[pixelIndex] / 255;
      if (protection <= 0) continue;
      const alphaOffset = (pixelIndex * 4) + 3;
      const keyedAlpha = data[alphaOffset];
      data[alphaOffset] = Math.round(keyedAlpha + ((sourceAlpha[pixelIndex] - keyedAlpha) * protection));
    }
  }

  return imageData;
}

/**
 * Sheet path. Flood fills background from the border plus explicit seeds, so
 * enclosed pockets are kept unless a `matchMode: 'global'` key says otherwise.
 *
 * Mutates `imageData` and returns `{ imageData, keyColors, removedPixels }`.
 */
export function applyConnectedMatte(imageData, options = {}) {
  const { width, height, data } = imageData;
  const detectedColors = options.autoDetect === false ? [] : detectEdgeColors(imageData, options);
  const suppliedColors = Array.isArray(options.keyColors) ? options.keyColors.map(normalizeColor) : [];
  const keyRegions = new Map((Array.isArray(options.keyRegions) ? options.keyRegions : [])
    .map((region) => [String(region?.hex || '').toLowerCase(), region]));
  const keyColors = [...suppliedColors];
  for (const color of detectedColors) {
    if (!keyColors.some((item) => Math.abs(item.r - color.r) + Math.abs(item.g - color.g) + Math.abs(item.b - color.b) < 18)) {
      keyColors.push(color);
    }
  }
  if (!width || !height || keyColors.length === 0) {
    return { imageData, keyColors, removedPixels: 0 };
  }

  const similarity = clamp01(options.similarity ?? 0.48);
  const feather = clamp01(options.feather ?? 0.20);
  const spill = clamp01(options.spill ?? 0.55);
  const subjectProtection = clamp01(options.subjectProtection ?? 0.55);
  const preserveColors = options.preserveColors !== false;
  const cleanupRadius = Math.max(0, Math.min(3, Math.round(options.cleanupRadius || 0)));
  const luminanceWeight = 0.08 + (0.9 * Math.pow(subjectProtection, 1.5));
  const transparentThreshold = 0.015 + (0.28 * Math.pow(similarity, 1.4));
  const featherWidth = 0.003 + (0.11 * Math.pow(feather, 1.45));
  const traversalThreshold = transparentThreshold + featherWidth;
  const keyRecords = [
    ...suppliedColors.map((color) => ({ metrics: colorMetrics(color), region: keyRegions.get(color.hex) || null })),
    ...detectedColors.map((color) => ({ metrics: colorMetrics(color), region: null }))
  ];
  const sheetWidth = Math.max(1, Number(options.sheetWidth) || width);
  const sheetHeight = Math.max(1, Number(options.sheetHeight) || height);
  const offsetX = Number(options.offsetX) || 0;
  const offsetY = Number(options.offsetY) || 0;
  const mask = new Uint8Array(width * height);
  const distanceMap = new Float32Array(width * height);
  const keyIndexMap = new Uint16Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;

  const regionAllows = createRegionAllows({ sheetWidth, sheetHeight, offsetX, offsetY });

  const hasAllowedKey = (x, y) => keyRecords.some((record) => regionAllows(record.region, x, y));

  const analyze = (index) => {
    const offset = index * 4;
    if (data[offset + 3] === 0) return { distance: 0, keyIndex: 0, eligible: true };
    const x = index % width;
    const y = Math.floor(index / width);
    const pixel = colorMetrics({ r: data[offset], g: data[offset + 1], b: data[offset + 2] });
    let keyIndex = 0;
    let distance = Infinity;
    for (let recordIndex = 0; recordIndex < keyRecords.length; recordIndex += 1) {
      const record = keyRecords[recordIndex];
      if (!regionAllows(record.region, x, y)) continue;
      const candidateDistance = keyDistance(pixel, record.metrics, luminanceWeight);
      if (candidateDistance < distance) {
        distance = candidateDistance;
        keyIndex = recordIndex;
      }
    }
    distanceMap[index] = distance;
    keyIndexMap[index] = keyIndex;
    return { distance, keyIndex, eligible: distance <= traversalThreshold };
  };

  const enqueue = (index) => {
    if (mask[index]) return;
    const analysis = analyze(index);
    if (!analysis.eligible) return;
    mask[index] = 1;
    queue[tail++] = index;
  };

  for (let x = 0; x < width; x += 1) {
    enqueue(x);
    enqueue(((height - 1) * width) + x);
  }
  for (let y = 1; y < height - 1; y += 1) {
    enqueue(y * width);
    enqueue((y * width) + width - 1);
  }

  // A manually picked pixel is an explicit background seed. This lets users
  // clean isolated cell backgrounds that do not connect to the outer sheet edge.
  const seedPoints = Array.isArray(options.seedPoints) ? options.seedPoints : [];
  for (const point of seedPoints) {
    const x = Math.max(0, Math.min(width - 1, Math.round(Number(point?.x) || 0)));
    const y = Math.max(0, Math.min(height - 1, Math.round(Number(point?.y) || 0)));
    enqueue((y * width) + x);
  }

  // Manual chroma picks behave like Video → Sprite: the sampled color is
  // matched across every frame, while an optional region still limits where
  // alpha may change (for example, the lower half of each sprite cell).
  const hasGlobalMatches = keyRecords.some((record) => record.region?.matchMode === 'global');
  if (hasGlobalMatches) {
    for (let index = 0; index < mask.length; index += 1) {
      if (mask[index] || data[(index * 4) + 3] === 0) continue;
      const x = index % width;
      const y = Math.floor(index / width);
      const pixel = colorMetrics({
        r: data[index * 4],
        g: data[(index * 4) + 1],
        b: data[(index * 4) + 2]
      });
      let nearestIndex = 0;
      let nearestDistance = Infinity;
      for (let recordIndex = 0; recordIndex < keyRecords.length; recordIndex += 1) {
        const record = keyRecords[recordIndex];
        if (record.region?.matchMode !== 'global' || !regionAllows(record.region, x, y)) continue;
        const candidateDistance = keyDistance(pixel, record.metrics, luminanceWeight);
        if (candidateDistance < nearestDistance) {
          nearestDistance = candidateDistance;
          nearestIndex = recordIndex;
        }
      }
      if (nearestDistance <= traversalThreshold) {
        mask[index] = 1;
        distanceMap[index] = nearestDistance;
        keyIndexMap[index] = nearestIndex;
        queue[tail++] = index;
      }
    }
  }

  while (head < tail) {
    const index = queue[head++];
    const x = index % width;
    const y = Math.floor(index / width);
    for (let ny = Math.max(0, y - 1); ny <= Math.min(height - 1, y + 1); ny += 1) {
      for (let nx = Math.max(0, x - 1); nx <= Math.min(width - 1, x + 1); nx += 1) {
        if (nx === x && ny === y) continue;
        enqueue((ny * width) + nx);
      }
    }
  }

  const cleanupMask = cleanupRadius ? dilateMask(mask, width, height, cleanupRadius) : mask;
  let removedPixels = 0;
  for (let index = 0; index < mask.length; index += 1) {
    const offset = index * 4;
    const sourceAlpha = data[offset + 3];
    if (sourceAlpha === 0) continue;
    if (cleanupMask[index] && !mask[index]) {
      const x = index % width;
      const y = Math.floor(index / width);
      if (!hasAllowedKey(x, y)) continue;
      data[offset + 3] = 0;
      removedPixels += 1;
      continue;
    }
    if (!mask[index]) continue;

    const distance = distanceMap[index];
    const foregroundMatte = smootherstep(transparentThreshold, transparentThreshold + featherWidth, distance);
    data[offset + 3] = Math.round(sourceAlpha * foregroundMatte);
    if (data[offset + 3] < sourceAlpha) removedPixels += 1;

    if (!preserveColors && spill > 0 && foregroundMatte > 0) {
      const pixel = colorMetrics({ r: data[offset], g: data[offset + 1], b: data[offset + 2] });
      const proximity = 1 - smootherstep(transparentThreshold, traversalThreshold + 0.08, distance);
      suppressSpill(data, offset, pixel, keyRecords[keyIndexMap[index]].metrics, spill * proximity * (1 - (subjectProtection * 0.45)));
    }
  }

  return { imageData, keyColors, removedPixels };
}

/**
 * Linear-light keying for float buffers (Phase 3+).
 *
 * Input buffer: { r, g, b, a, width, height } where RGB and alpha are Float32Array,
 * RGB in linear 0–1, alpha in linear 0–1.
 *
 * Mutates the buffer and returns it. Mirrors applyDirectMatte logic but operates
 * on linear float buffers. Threshold constants kept numerically unchanged from
 * the gamma-space version during Phase 3 step 4; Phase 3 step 5 will retune them
 * if needed.
 *
 * `options.decisionRgb` (phase 4) supplies a *separate* linear RGB source for
 * the keying decision — the chroma-smoothed copy. Alpha and despill still read
 * and write the buffer's own RGB, so smoothed chroma can never reach the
 * exported colour. The phase 4 file calls that separation the whole point and
 * forbids collapsing it; without this parameter the only way to smooth is in
 * place, which collapses it.
 */
export function keyBufferLinear(buffer, options = {}) {
  const { r, g, b, a, width, height } = buffer;
  const decision = options.decisionRgb ?? null;
  const dr = decision ? decision.r : r;
  const dg = decision ? decision.g : g;
  const db = decision ? decision.b : b;
  const keyColors = Array.isArray(options.keyColors) ? options.keyColors : [];
  if (options.enabled === false || keyColors.length === 0) return buffer;

  const similarity = clamp01(options.similarity ?? 0.55);
  const blend = clamp01(options.blend ?? 0.18);
  const spill = clamp01(options.spill ?? 0.55);
  const subjectProtection = clamp01(options.subjectProtection ?? 0.50);
  const cleanupRadius = Math.max(0, Math.min(3, Math.round(Number(options.cleanupRadius) || 0)));
  const protectionMask = options.protectionMask?.length === a.length ? options.protectionMask : null;
  const protectedDecontamination = clamp01(options.protectedDecontamination ?? 0.80);

  // Convert 8-bit key colors to linear for comparison
  const keys = keyColors.map(color => colorMetricsLinear(
    SRGB_TO_LINEAR[color.r],
    SRGB_TO_LINEAR[color.g],
    SRGB_TO_LINEAR[color.b]
  ));

  // Phase 3: Constants numerically unchanged - re-tuning deferred to real footage
  const transparentThreshold = 0.018 + (0.30 * Math.pow(similarity, 1.4));
  const featherWidth = 0.002 + (0.12 * Math.pow(blend, 1.55));
  const spillReach = transparentThreshold + featherWidth + 0.10 + (0.10 * similarity);
  const luminanceWeight = 0.08 + (0.90 * Math.pow(subjectProtection, 1.5));

  const sourceAlpha = protectionMask ? new Float32Array(a.length) : null;
  const effectiveProtection = protectionMask ? new Float32Array(a.length) : null;

  for (let i = 0; i < a.length; i++) {
    const inputAlpha = a[i];
    if (sourceAlpha) sourceAlpha[i] = inputAlpha;
    if (inputAlpha === 0) continue;

    const pixel = colorMetricsLinear(dr[i], dg[i], db[i]);
    // Despill rewrites exported colour, so it must act on the buffer's own RGB,
    // not on the smoothed copy the decision was taken from.
    const outPixel = decision ? colorMetricsLinear(r[i], g[i], b[i]) : pixel;
    let nearestKey = keys[0];
    let distance = keyDistance(pixel, nearestKey, luminanceWeight);

    for (let k = 1; k < keys.length; k++) {
      const candidateDistance = keyDistance(pixel, keys[k], luminanceWeight);
      if (candidateDistance < distance) {
        distance = candidateDistance;
        nearestKey = keys[k];
      }
    }

    const matte = smootherstep(transparentThreshold, transparentThreshold + featherWidth, distance);
    a[i] = inputAlpha * matte;

    // Protection logic (same as video path)
    const paintedProtection = protectionMask ? protectionMask[i] : 0;
    const evidenceEnd = Math.max(0.024, transparentThreshold * 0.34);
    const subjectEvidence = smootherstep(0.004, evidenceEnd, distance);
    const protection = paintedProtection * subjectEvidence;
    if (effectiveProtection) effectiveProtection[i] = protection;

    // Spill suppression: remove only the key-color component
    if (spill > 0 && (matte > 0 || protection > 0)) {
      const proximity = 1 - smootherstep(transparentThreshold + featherWidth, spillReach, distance);
      const edgeWeight = 0.35 + (0.65 * (1 - matte));
      const colorRetention = 1 - (subjectProtection * (0.15 + (0.75 * matte)));
      const regularCleanup = spill * proximity * edgeWeight * colorRetention;
      const protectedCleanup = spill * protection * protectedDecontamination * (0.45 + (0.55 * (1 - matte)));

      const strength = Math.max(regularCleanup, protectedCleanup);
      if (strength > 0) {
        // Directional chroma suppression: remove only the component pointing toward key
        const keyChromaR = nearestKey.r - nearestKey.y;
        const keyChromaG = nearestKey.g - nearestKey.y;
        const keyChromaB = nearestKey.b - nearestKey.y;
        const magnitude = Math.sqrt((keyChromaR * keyChromaR) + (keyChromaG * keyChromaG) + (keyChromaB * keyChromaB));

        if (magnitude >= 0.02) {
          const dirR = keyChromaR / magnitude;
          const dirG = keyChromaG / magnitude;
          const dirB = keyChromaB / magnitude;

          const pixelChromaR = outPixel.r - outPixel.y;
          const pixelChromaG = outPixel.g - outPixel.y;
          const pixelChromaB = outPixel.b - outPixel.y;
          const projection = (pixelChromaR * dirR) + (pixelChromaG * dirG) + (pixelChromaB * dirB);

          if (projection > 0) {
            const removal = projection * clamp01(strength);
            r[i] = clamp01(outPixel.r - (dirR * removal));
            g[i] = clamp01(outPixel.g - (dirG * removal));
            b[i] = clamp01(outPixel.b - (dirB * removal));
          }
        }
      }
    }
  }

  // Edge cleanup: erode foreground alpha
  if (cleanupRadius > 0) {
    erodeForegroundAlphaLinear(a, width, height, cleanupRadius);
  }

  // Protection blending
  if (effectiveProtection && sourceAlpha) {
    for (let i = 0; i < sourceAlpha.length; i++) {
      const protection = effectiveProtection[i];
      if (protection <= 0) continue;
      const keyedAlpha = a[i];
      a[i] = keyedAlpha + ((sourceAlpha[i] - keyedAlpha) * protection);
    }
  }

  return buffer;
}

/**
 * Edge cleanup for linear alpha buffer. Erodes the opaque region by `radius`
 * passes of 8-neighbour growth, same logic as erodeForegroundAlpha but for
 * Float32Array alpha values.
 */
function erodeForegroundAlphaLinear(alpha, width, height, radius) {
  if (!width || !height || radius <= 0) return;

  let transparent = new Uint8Array(width * height);
  for (let index = 0; index < transparent.length; index += 1) {
    if (alpha[index] <= 0.031) transparent[index] = 1;  // ~8/255 in linear
  }

  for (let pass = 0; pass < radius; pass += 1) {
    const expanded = transparent.slice();
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = (y * width) + x;
        if (transparent[index]) continue;
        for (let ny = Math.max(0, y - 1); ny <= Math.min(height - 1, y + 1) && !expanded[index]; ny += 1) {
          for (let nx = Math.max(0, x - 1); nx <= Math.min(width - 1, x + 1); nx += 1) {
            if (transparent[(ny * width) + nx]) {
              expanded[index] = 1;
              break;
            }
          }
        }
      }
    }
    transparent = expanded;
  }

  for (let index = 0; index < transparent.length; index += 1) {
    if (transparent[index]) alpha[index] = 0;
  }
}
