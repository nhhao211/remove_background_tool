/**
 * Subject Protect Brush for the Clean Sprite Sheet tab.
 *
 * The user paints over a part of the character that the keyer (or one of the
 * passes after it) damaged — a costume panel close to the backdrop colour, a
 * translucent wing, a rim that Edge Refine decontaminated too hard — and this
 * pass gives that part back its ORIGINAL pixels: colour and alpha.
 *
 * Like the Video tab's brush the paint is only a request, not a command. Where
 * a pixel is as close to the key colour as the backdrop itself, painting over it
 * does not bring it back (`evidence` below, same constants as the video keyer):
 * a broad stroke that strays onto the backdrop must not drag a patch of it into
 * the sprite.
 *
 * Scope. Strokes live in normalised sheet coordinates. Each stroke belongs to
 * the cell its first point falls in (its "home" cell) and is either
 *   - single-frame: applies inside its home cell only, or
 *   - `allFrames`: replicated at the same place relative to the cell in every
 *     cell of the grid, each copy fenced by its own cell — the same contract as
 *     a colour region with `Áp dụng cho mọi frame` (region-cells.js).
 * Without a grid there is one cell and the two are the same thing.
 *
 * Position in the pipeline: after Edge Refine, before the colour regions. The
 * brush has to see the final automatic result to be able to undo it, and an
 * explicit region removal is a deliberate command that still wins over it.
 * No strokes ⇒ the input ImageData is returned as is, byte for byte.
 *
 * Pure, no DOM; tested by `test/subject-protect.test.mjs`.
 */

import { clamp01, colorMetrics, keyDistance, smootherstep } from './keyer/color.js';
import { normalizeStroke, rasterizeStrokeMask } from './stroke-mask.js';
import { cellIndexAt, cellShift } from './region-cells.js';

/** Largest canvas the mask rasterizer is asked for in one go. */
export const MAX_BAND_PIXELS = 4_000_000;

/** Same transparent threshold the sheet keyer derives from `Similarity`. */
export function protectionThresholdFor(similarity) {
  return 0.015 + (0.28 * Math.pow(clamp01(similarity ?? 0.48), 1.4));
}

/**
 * `stroke-mask.js` knows nothing about scope, so the flag is added here. A
 * stroke's frame binding is never stored: the home cell is re-derived from the
 * first point, so editing Rows × Cols moves the stroke with the grid instead of
 * leaving it pinned to a stale index.
 */
export function normalizeProtectStroke(stroke) {
  const base = normalizeStroke(stroke);
  if (!base) return null;
  return { ...base, frame: null, frameTime: null, allFrames: stroke.allFrames === true };
}

export function normalizeProtectStrokes(strokes) {
  if (!Array.isArray(strokes)) return [];
  return strokes.map(normalizeProtectStroke).filter(Boolean);
}

const shiftStroke = (stroke, dx, dy) => ({
  ...stroke,
  points: stroke.points.map((point) => ({ x: point.x + dx, y: point.y + dy }))
});

/**
 * Splits the strokes into one window per cell, each with the strokes that reach
 * it in painting order — order matters, an `Unprotect` stroke rubs out what an
 * earlier `Protect` stroke put there. Windows are disjoint, so a window can be
 * rasterized on its own and clipped to its rectangle for free.
 *
 * @param {Array} strokes
 * @param {{ width: number, height: number, cells: Array|null }} sheet
 * @returns {Array<{ cell: number|null, rect: object|null, strokes: Array }>}
 */
export function planProtectionWindows(strokes, { width, height, cells }) {
  const list = normalizeProtectStrokes(strokes);
  if (list.length === 0) return [];
  if (!cells || cells.length <= 1) return [{ cell: null, rect: null, strokes: list }];

  const homes = list.map((stroke) => cellIndexAt(cells, stroke.points[0].x * width, stroke.points[0].y * height));
  const windows = [];
  for (let cell = 0; cell < cells.length; cell += 1) {
    const inCell = [];
    list.forEach((stroke, index) => {
      if (stroke.allFrames) {
        const { dx, dy } = cellShift(cells, homes[index], cell, width, height);
        inCell.push(dx === 0 && dy === 0 ? stroke : shiftStroke(stroke, dx, dy));
      } else if (homes[index] === cell) {
        inCell.push(stroke);
      }
    });
    if (inCell.length > 0) windows.push({ cell, rect: cells[cell], strokes: inCell });
  }
  return windows;
}

/** Horizontal bands of `rect`, none larger than `maxPixels` (but at least a row). */
export function bandRects(rect, maxPixels = MAX_BAND_PIXELS) {
  if (!(rect.width > 0) || !(rect.height > 0)) return [];
  const rowsPerBand = Math.max(1, Math.floor(maxPixels / rect.width));
  const bands = [];
  for (let y = 0; y < rect.height; y += rowsPerBand) {
    bands.push({ x0: rect.x0, y0: rect.y0 + y, width: rect.width, height: Math.min(rowsPerBand, rect.height - y) });
  }
  return bands;
}

/**
 * Rasterizes the strokes into one byte per sheet pixel.
 *
 * Done per cell (and per band within a cell) so the scratch canvas is the size
 * of a cell, not of a 50-megapixel sheet; a window's strokes are rasterized
 * through that window's crop, which clips them to it.
 *
 * `rasterize` is injectable so the maths can be tested without a canvas.
 *
 * @returns {{ mask: Uint8ClampedArray, windows: number } | null} null ⇒ no strokes
 */
export function buildProtectionMask(strokes, {
  width, height, cells = null, rasterize = rasterizeStrokeMask, canvas = null, maxBandPixels = MAX_BAND_PIXELS
}) {
  const windows = planProtectionWindows(strokes, { width, height, cells });
  if (windows.length === 0) return null;
  const mask = new Uint8ClampedArray(width * height);
  for (const window of windows) {
    const rect = window.rect || { x0: 0, y0: 0, width, height };
    for (const band of bandRects(rect, maxBandPixels)) {
      const { mask: part } = rasterize(window.strokes, {
        canvas: canvas || undefined,
        sourceWidth: width,
        sourceHeight: height,
        cropX: band.x0,
        cropY: band.y0,
        cropWidth: band.width,
        cropHeight: band.height,
        targetWidth: band.width,
        targetHeight: band.height
      });
      for (let y = 0; y < band.height; y += 1) {
        const from = y * band.width;
        mask.set(part.subarray(from, from + band.width), ((band.y0 + y) * width) + band.x0);
      }
    }
  }
  return { mask, windows: windows.length };
}

function makeImage(data, width, height) {
  return typeof ImageData === 'function' ? new ImageData(data, width, height) : { data, width, height };
}

/**
 * Gives painted pixels back their original colour and alpha.
 *
 * For a painted pixel with mask value `m` and evidence `e` the weight is
 * `w = m·e`, and the result is `base + (original − base)·w` per channel. A
 * pixel the keyer made fully transparent has no meaningful colour left, so it
 * takes the original colour outright and only alpha is blended.
 *
 * `evidence` is 0 for a pixel as close to a key colour as the backdrop is and
 * rises to 1 a short way beyond it, using the video keyer's constants.
 *
 * @param {ImageData} base      the pipeline's current result (not modified)
 * @param {ImageData} original  the untouched sheet
 * @param {Uint8ClampedArray|null} mask  one byte per pixel
 * @param {object} [options]
 * @param {Array<{r:number,g:number,b:number}>} [options.keyColors]
 * @param {number} [options.transparentThreshold]
 * @param {number} [options.luminanceWeight]
 * @returns {{ imageData: ImageData, changedPixels: number }}
 */
export function applySubjectProtect(base, original, mask, options = {}) {
  const pixelCount = base.width * base.height;
  if (!mask || mask.length !== pixelCount || original.width !== base.width || original.height !== base.height) {
    return { imageData: base, changedPixels: 0 };
  }
  let painted = false;
  for (let index = 0; index < pixelCount; index += 1) {
    if (mask[index] !== 0) { painted = true; break; }
  }
  if (!painted) return { imageData: base, changedPixels: 0 };

  const keys = (Array.isArray(options.keyColors) ? options.keyColors : []).map(colorMetrics);
  const luminanceWeight = Number.isFinite(options.luminanceWeight) ? options.luminanceWeight : 0.35;
  const threshold = Number.isFinite(options.transparentThreshold) ? options.transparentThreshold : protectionThresholdFor(0.48);
  const evidenceEnd = Math.max(0.024, threshold * 0.34);

  const out = new Uint8ClampedArray(base.data);
  const src = original.data;
  let changedPixels = 0;
  for (let index = 0; index < pixelCount; index += 1) {
    const painter = mask[index];
    if (painter === 0) continue;
    const o = index * 4;
    const sourceAlpha = src[o + 3];
    if (sourceAlpha === 0) continue;

    let weight = painter / 255;
    if (keys.length > 0) {
      const pixel = colorMetrics({ r: src[o], g: src[o + 1], b: src[o + 2] });
      let distance = Infinity;
      for (let k = 0; k < keys.length; k += 1) {
        const candidate = keyDistance(pixel, keys[k], luminanceWeight);
        if (candidate < distance) distance = candidate;
      }
      weight *= smootherstep(0.004, evidenceEnd, distance);
    }
    if (weight <= 0) continue;

    const baseAlpha = out[o + 3];
    let changed = false;
    if (baseAlpha === 0) {
      out[o] = src[o];
      out[o + 1] = src[o + 1];
      out[o + 2] = src[o + 2];
      changed = true;
    } else {
      for (let channel = 0; channel < 3; channel += 1) {
        const next = Math.round(out[o + channel] + ((src[o + channel] - out[o + channel]) * weight));
        if (next !== out[o + channel]) { out[o + channel] = next; changed = true; }
      }
    }
    const nextAlpha = Math.round(baseAlpha + ((sourceAlpha - baseAlpha) * weight));
    if (nextAlpha !== baseAlpha) { out[o + 3] = nextAlpha; changed = true; }
    if (changed) changedPixels += 1;
  }
  return { imageData: makeImage(out, base.width, base.height), changedPixels };
}
