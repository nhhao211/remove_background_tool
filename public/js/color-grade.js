/**
 * Subject colour grading.
 * Video Background Remover & Sprite Sheet Studio
 *
 * Runs after the keyer, on the pixels that survived it. Keying is subtractive by
 * nature — it removes the backdrop's contribution from every edge and, with
 * despill, some of the subject's own chroma too — so a keyed sprite lands
 * flatter than the source even when the matte is perfect. This is the pass that
 * puts colour back deliberately, instead of hoping the keyer under-corrects.
 *
 * Tone lives in linear light and colour lives in gamma space, which is not an
 * inconsistency: exposure and contrast are statements about light, and doubling
 * light means doubling a linear value, while saturation is a statement about
 * appearance, and Photoshop-style saturation is defined on the gamma-encoded
 * values people actually see. Doing either in the other space is what makes
 * naive grading look muddy.
 *
 * Pure and DOM-free so it can be tested under `node --test`.
 */

import { SRGB_TO_LINEAR, linearToSrgb8 } from './keyer/color.js';

// BT.709 luma weights, applied to gamma-encoded values — luma, not luminance.
// That is deliberate: it is the same quantity Photoshop's saturation works on.
const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;

// Contrast rotates tones around a pivot that must not move. Photography's
// classic pivot is 18% linear, but that decodes to sRGB 118, so dragging
// contrast would visibly brighten everything above it — not what someone
// expects from a Contrast slider. Pivoting on the linear value of sRGB 128
// (about 0.216) keeps display mid-grey exactly where it was, which is the
// Photoshop behaviour, while the arithmetic still happens in linear light.
const CONTRAST_PIVOT = SRGB_TO_LINEAR[128];

export const COLOR_GRADE_DEFAULTS = Object.freeze({
  enabled: false,
  exposure: 0,     // stops, -2..+2
  contrast: 0,     // -1..+1
  saturation: 0,   // -1..+1
  vibrance: 0,     // -1..+1
  temperature: 0   // -1 (cool) .. +1 (warm)
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));

/**
 * True when the options would leave every pixel untouched, so the caller can
 * skip a full-frame pass.
 */
export function isColorGradeIdentity(options) {
  if (!options || !options.enabled) return true;
  return clamp(options.exposure, -2, 2) === 0
    && clamp(options.contrast, -1, 1) === 0
    && clamp(options.saturation, -1, 1) === 0
    && clamp(options.vibrance, -1, 1) === 0
    && clamp(options.temperature, -1, 1) === 0;
}

/**
 * Grades an RGBA surface in place. Alpha is never modified.
 *
 * @param {ImageData|{data: Uint8ClampedArray, width: number, height: number}} imageData
 * @param {object} options - See COLOR_GRADE_DEFAULTS.
 * @returns {boolean} Whether any pixel was touched.
 */
export function applyColorGrade(imageData, options) {
  if (!imageData || !imageData.data || imageData.data.length === 0) return false;
  if (isColorGradeIdentity(options)) return false;

  const data = imageData.data;

  const exposureGain = Math.pow(2, clamp(options.exposure, -2, 2));
  const contrast = clamp(options.contrast, -1, 1);
  const saturation = clamp(options.saturation, -1, 1);
  const vibrance = clamp(options.vibrance, -1, 1);
  const temperature = clamp(options.temperature, -1, 1);

  // Slope around the pivot: -1 collapses to flat mid-grey, 0 is unchanged,
  // +1 doubles the separation between shadows and highlights.
  const contrastGain = 1 + contrast;

  // Warmth as a simple red/blue gain pair around unity, so the green channel —
  // which carries most of the luma — is left alone and the image does not shift
  // exposure as it shifts temperature.
  const warmR = 1 + (temperature * 0.18);
  const warmB = 1 - (temperature * 0.18);

  const satGain = 1 + saturation;

  for (let i = 0; i < data.length; i += 4) {
    // A fully transparent pixel shows nothing; whatever colour sits under it is
    // either keyed-out backdrop or, later, alpha bleed sourced from graded
    // neighbours. Either way there is nothing here worth grading.
    if (data[i + 3] === 0) continue;

    // --- Tone, in linear light ---
    let r = SRGB_TO_LINEAR[data[i]];
    let g = SRGB_TO_LINEAR[data[i + 1]];
    let b = SRGB_TO_LINEAR[data[i + 2]];

    if (exposureGain !== 1) {
      r *= exposureGain;
      g *= exposureGain;
      b *= exposureGain;
    }

    if (contrastGain !== 1) {
      r = ((r - CONTRAST_PIVOT) * contrastGain) + CONTRAST_PIVOT;
      g = ((g - CONTRAST_PIVOT) * contrastGain) + CONTRAST_PIVOT;
      b = ((b - CONTRAST_PIVOT) * contrastGain) + CONTRAST_PIVOT;
    }

    if (temperature !== 0) {
      r *= warmR;
      b *= warmB;
    }

    // --- Colour, in gamma space ---
    let r8 = linearToSrgb8(r);
    let g8 = linearToSrgb8(g);
    let b8 = linearToSrgb8(b);

    if (saturation !== 0 || vibrance !== 0) {
      const luma = (LUMA_R * r8) + (LUMA_G * g8) + (LUMA_B * b8);

      let gain = satGain;

      if (vibrance !== 0) {
        // Vibrance is saturation weighted by how unsaturated the pixel already
        // is, so washed-out midtones lift while colours that are already vivid
        // barely move. That is what stops it from turning skin orange and
        // clipping the subject's strongest hues the way flat saturation does.
        const max = r8 > g8 ? (r8 > b8 ? r8 : b8) : (g8 > b8 ? g8 : b8);
        const min = r8 < g8 ? (r8 < b8 ? r8 : b8) : (g8 < b8 ? g8 : b8);
        const currentSat = max > 0 ? (max - min) / max : 0;
        const headroom = 1 - currentSat;
        gain += vibrance * headroom * headroom;
      }

      if (gain !== 1) {
        r8 = luma + ((r8 - luma) * gain);
        g8 = luma + ((g8 - luma) * gain);
        b8 = luma + ((b8 - luma) * gain);
      }
    }

    // Uint8ClampedArray clamps and rounds on assignment.
    data[i] = r8;
    data[i + 1] = g8;
    data[i + 2] = b8;
    // Alpha deliberately untouched.
  }

  return true;
}
