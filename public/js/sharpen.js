/**
 * Alpha-aware unsharp mask.
 * Video Background Remover & Sprite Sheet Studio
 *
 * A sprite loses acutance twice over: the source is usually chroma-subsampled
 * H.264, and the cell is a downscale of the keyed full-res frame. Both are
 * low-pass filters, and neither is recoverable by grading. This adds the high
 * frequencies back.
 *
 * The critical detail is the blur. A naive blur of a keyed sprite averages the
 * subject against the transparent void around it, so the "blurred" edge is
 * darker than the real one, the detail signal spikes there, and unsharp masking
 * paints a bright rim on the outside of the subject and a dark one just inside
 * — a halo that reads as exactly the chewed, broken outline sharpening was
 * supposed to fix. So the blur is alpha-normalised: blur(a*Y) / blur(a), which
 * asks "what is the average of the pixels that actually exist here" instead of
 * letting nonexistent pixels vote for black.
 *
 * Gain is applied to luma and carried to RGB as a ratio, which sharpens
 * structure without pushing hue or saturation around.
 *
 * Pure and DOM-free so it can be tested under `node --test`.
 */

import { boxBlurSeparable } from './keyer/color.js';

const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;

// Below this coverage a pixel has too few real neighbours for the normalised
// average to mean anything, so it is left alone rather than amplified.
const MIN_COVERAGE = 1e-3;

export const SHARPEN_DEFAULTS = Object.freeze({
  enabled: false,
  amount: 0,     // 0..2, how much of the detail signal to add back
  radius: 1,     // 1..3 px
  threshold: 0   // 0..1, detail below this is treated as noise
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));

export function isSharpenIdentity(options) {
  if (!options || !options.enabled) return true;
  return clamp(options.amount, 0, 2) === 0 || clamp(options.radius, 1, 3) < 1;
}

/**
 * Sharpens an RGBA surface in place. Alpha is never modified.
 *
 * @param {ImageData|{data: Uint8ClampedArray, width: number, height: number}} imageData
 * @param {object} options - See SHARPEN_DEFAULTS.
 * @returns {boolean} Whether any pixel was touched.
 */
export function applySharpen(imageData, options) {
  if (!imageData || !imageData.data || !imageData.width || !imageData.height) return false;
  if (isSharpenIdentity(options)) return false;

  const { data, width, height } = imageData;
  const pixelCount = width * height;
  if (pixelCount === 0) return false;

  const amount = clamp(options.amount, 0, 2);
  const radius = Math.round(clamp(options.radius, 1, 3));
  // Threshold is expressed 0..1 on the slider but compared against 8-bit luma.
  const threshold = clamp(options.threshold, 0, 1) * 255;

  const luma = new Float32Array(pixelCount);
  const coverage = new Float32Array(pixelCount);
  const weighted = new Float32Array(pixelCount);

  for (let p = 0; p < pixelCount; p++) {
    const o = p * 4;
    const y = (LUMA_R * data[o]) + (LUMA_G * data[o + 1]) + (LUMA_B * data[o + 2]);
    const a = data[o + 3] / 255;
    luma[p] = y;
    coverage[p] = a;
    weighted[p] = y * a;
  }

  // Two box passes approximate a triangle kernel, which has no ringing of its
  // own — important when the whole point is to amplify what the blur missed.
  for (let pass = 0; pass < 2; pass++) {
    boxBlurSeparable(weighted, width, height, radius);
    boxBlurSeparable(coverage, width, height, radius);
  }

  for (let p = 0; p < pixelCount; p++) {
    const o = p * 4;
    if (data[o + 3] === 0) continue;

    const cover = coverage[p];
    if (cover < MIN_COVERAGE) continue;

    const blurred = weighted[p] / cover;
    const detail = luma[p] - blurred;
    if (detail > -threshold && detail < threshold) continue;

    const target = luma[p] + (amount * detail);
    if (target <= 0) {
      data[o] = 0;
      data[o + 1] = 0;
      data[o + 2] = 0;
      continue;
    }

    if (luma[p] > 1) {
      // Scale the pixel toward its new luma, preserving the ratios between
      // channels and therefore hue and saturation.
      const gain = target / luma[p];
      data[o] = data[o] * gain;
      data[o + 1] = data[o + 1] * gain;
      data[o + 2] = data[o + 2] * gain;
    } else {
      // Near black there is no ratio to preserve, so add the detail directly
      // rather than multiplying up rounding noise.
      const lift = target - luma[p];
      data[o] = data[o] + lift;
      data[o + 1] = data[o + 1] + lift;
      data[o + 2] = data[o + 2] + lift;
    }
  }

  return true;
}
