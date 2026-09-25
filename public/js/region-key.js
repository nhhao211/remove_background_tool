/**
 * Local colour removal inside a user-drawn ellipse.
 *
 * A normal colour pick is global: every pixel in the sheet that resembles the
 * sampled colour loses its alpha. That is the right behaviour for a backdrop
 * and the wrong one for a stray detail *on* the subject, because the subject
 * usually wears the same colour somewhere else. Measured on
 * `test/keyer/fixtures/clip-08/sheet.png`, removing a 1 936 px detail with a
 * global pick also destroys 12 392 px spread over the other three cells.
 *
 * So the region is the hard guarantee and tolerance is the soft one: pixels
 * outside the ellipse's bounding box are never read and never written, whatever
 * their colour. Tolerance only decides what happens *inside*.
 *
 * Like `erase-mask.js` and `edge-refine.js` this lives outside `keyer/` on
 * purpose. The keyer has byte-identical baselines and an `assertOptions()`
 * whitelist; a compositing pass that runs after it needs neither. The practical
 * consequence for users is the same one the Erase Brush has: "remove this
 * detail" still works with `Transparent WebP/PNG` switched off.
 *
 * Coordinates are normalised 0..1 against the *source* (video frame or sheet),
 * the same space strokes live in, and are mapped through the same crop window
 * `rasterizeStrokeMask` uses — so a region survives a change of crop, cell size,
 * rows or cols exactly as a stroke does.
 */

import { clamp01, colorMetrics, keyDistance, smootherstep } from './keyer/color.js';
import { suppressSpill } from './keyer/spill.js';

const MAX_REGIONS = 100;
const MAX_COLORS_PER_REGION = 8;
/** Below this a region is a rounding artefact of a stray click, not a drag. */
const MIN_RADIUS = 0.0005;

// `Number(null)` is 0, not NaN, so an absent binding has to be rejected before
// the numeric check or every global region would come back bound to frame 0.
// Same trap, same fix, as `normalizeStroke` in stroke-mask.js.
const missing = (value) => value === null || value === undefined || value === '';

function normalizeFrameIndex(value) {
  if (missing(value)) return null;
  const frame = Number(value);
  if (!Number.isFinite(frame) || frame < 0) return null;
  return Math.floor(frame);
}

function normalizeFrameTime(value) {
  if (missing(value)) return null;
  const time = Number(value);
  if (!Number.isFinite(time) || time < 0) return null;
  return time;
}

function normalizeColorEntry(color) {
  if (!color) return null;
  const r = Number(color.r);
  const g = Number(color.g);
  const b = Number(color.b);
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return null;
  const clamp255 = (value) => Math.round(Math.min(255, Math.max(0, value)));
  const rr = clamp255(r);
  const gg = clamp255(g);
  const bb = clamp255(b);
  return {
    r: rr,
    g: gg,
    b: bb,
    hex: `#${[rr, gg, bb].map((value) => value.toString(16).padStart(2, '0')).join('')}`
  };
}

function normalizePoint(point) {
  if (!point) return null;
  const x = Number(point.x);
  const y = Number(point.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: clamp01(x), y: clamp01(y) };
}

/**
 * Coerces one persisted region into the canonical shape, or returns `null` if
 * it cannot be salvaged. Broken regions are dropped rather than thrown on: a
 * stale entry in localStorage should degrade to "not there", the same way
 * `applyEraseMask` ignores a mask of the wrong size.
 */
export function normalizeRegion(region) {
  if (!region || typeof region !== 'object') return null;
  const cx = Number(region.cx);
  const cy = Number(region.cy);
  const rx = Number(region.rx);
  const ry = Number(region.ry ?? region.rx);
  if (![cx, cy, rx, ry].every(Number.isFinite)) return null;
  if (rx < MIN_RADIUS || ry < MIN_RADIUS) return null;

  const colors = (Array.isArray(region.colors) ? region.colors : [])
    .map(normalizeColorEntry)
    .filter(Boolean)
    .slice(0, MAX_COLORS_PER_REGION);

  const frame = normalizeFrameIndex(region.frame);
  return {
    id: typeof region.id === 'string' && region.id ? region.id : null,
    shape: 'ellipse',
    cx: clamp01(cx),
    cy: clamp01(cy),
    rx: Math.min(2, rx),
    ry: Math.min(2, ry),
    colors,
    tolerance: clamp01(region.tolerance ?? 0.30),
    feather: clamp01(region.feather ?? 0.20),
    subjectProtection: clamp01(region.subjectProtection ?? 0.55),
    softness: clamp01(region.softness ?? 0.12),
    despill: clamp01(region.despill ?? 0),
    connected: region.connected === true,
    seed: region.connected === true ? normalizePoint(region.seed) : null,
    enabled: region.enabled !== false,
    // Clean Sprite Sheet only: replicate into every cell of the grid
    // (region-cells.js). `applyRegionKeys` itself ignores it.
    allFrames: region.allFrames === true,
    frame,
    // Only meaningful next to a frame index; carrying it on a global region
    // would invite code to read it as a binding that is not there.
    frameTime: frame === null ? null : normalizeFrameTime(region.frameTime)
  };
}

export function normalizeRegions(regions) {
  if (!Array.isArray(regions)) return [];
  return regions.map(normalizeRegion).filter(Boolean).slice(-MAX_REGIONS);
}

/** A region only changes pixels once it has both a colour and the switch on. */
export function regionIsActive(region) {
  return Boolean(region && region.enabled !== false && region.colors?.length);
}

/**
 * Maps a normalised region onto target pixels through the crop window.
 * Mirrors `mapPoint` in stroke-mask.js so both systems agree on where a
 * normalised coordinate lands.
 */
function projectRegion(region, geometry, targetWidth, targetHeight) {
  const sourceWidth = Math.max(1, Number(geometry?.sourceWidth) || targetWidth);
  const sourceHeight = Math.max(1, Number(geometry?.sourceHeight) || targetHeight);
  const cropX = Math.max(0, Number(geometry?.cropX) || 0);
  const cropY = Math.max(0, Number(geometry?.cropY) || 0);
  const cropWidth = Math.max(1, Number(geometry?.cropWidth) || sourceWidth);
  const cropHeight = Math.max(1, Number(geometry?.cropHeight) || sourceHeight);
  const scaleX = targetWidth / cropWidth;
  const scaleY = targetHeight / cropHeight;

  return {
    cx: ((region.cx * sourceWidth) - cropX) * scaleX,
    cy: ((region.cy * sourceHeight) - cropY) * scaleY,
    rx: region.rx * sourceWidth * scaleX,
    ry: region.ry * sourceHeight * scaleY,
    seed: region.seed
      ? {
        x: ((region.seed.x * sourceWidth) - cropX) * scaleX,
        y: ((region.seed.y * sourceHeight) - cropY) * scaleY
      }
      : null
  };
}

/**
 * Drops the alpha of every pixel that is both inside `region` and close enough
 * to one of its colours. In place, on `imageData`.
 *
 * Invariants, each with its own test:
 *  - alpha is only ever multiplied by `1 - removal`, so it never rises;
 *  - no pixel outside the projected bounding box is read or written;
 *  - `despill: 0` leaves RGB untouched;
 *  - a region with no colours, disabled, or unsalvageable is a no-op.
 *
 * @returns {{ removedPixels: number, regionsApplied: number }}
 */
export function applyRegionKeys(imageData, regions, geometry = {}) {
  const result = { removedPixels: 0, regionsApplied: 0 };
  if (!imageData?.data) return result;
  const width = Math.max(0, Number(imageData.width) || 0);
  const height = Math.max(0, Number(imageData.height) || 0);
  if (!width || !height) return result;

  const normalized = normalizeRegions(regions).filter(regionIsActive);
  if (normalized.length === 0) return result;

  const data = imageData.data;
  for (const region of normalized) {
    const applied = applyOneRegion(data, width, height, region, geometry);
    if (applied > 0) result.removedPixels += applied;
    if (applied >= 0) result.regionsApplied += 1;
  }
  return result;
}

function applyOneRegion(data, width, height, region, geometry) {
  const shape = projectRegion(region, geometry, width, height);
  if (!(shape.rx > 0) || !(shape.ry > 0)) return -1;

  // Bounding box in pixels, clamped to the image. Everything below stays inside
  // it — that clamp *is* the guarantee the feature is sold on.
  const minX = Math.max(0, Math.floor(shape.cx - shape.rx));
  const maxX = Math.min(width - 1, Math.ceil(shape.cx + shape.rx));
  const minY = Math.max(0, Math.floor(shape.cy - shape.ry));
  const maxY = Math.min(height - 1, Math.ceil(shape.cy + shape.ry));
  if (minX > maxX || minY > maxY) return -1;

  // Same formulas as `applyConnectedMatte` in keyer/matte.js, so the Tolerance
  // slider means what the Similarity slider already taught the user it means.
  const luminanceWeight = 0.08 + (0.9 * Math.pow(region.subjectProtection, 1.5));
  const threshold = 0.015 + (0.28 * Math.pow(region.tolerance, 1.4));
  const featherWidth = 0.003 + (0.11 * Math.pow(region.feather, 1.45));
  const traversalThreshold = threshold + featherWidth;
  const keys = region.colors.map(colorMetrics);
  const softEdge = region.softness > 0 ? 1 - region.softness : 1;

  const shapeWeightAt = (x, y) => {
    const dx = (x + 0.5 - shape.cx) / shape.rx;
    const dy = (y + 0.5 - shape.cy) / shape.ry;
    const t = Math.hypot(dx, dy);
    if (t >= 1) return 0;
    if (region.softness <= 0) return 1;
    return 1 - smootherstep(softEdge, 1, t);
  };

  const measure = (offset) => {
    const pixel = colorMetrics({ r: data[offset], g: data[offset + 1], b: data[offset + 2] });
    let distance = Infinity;
    let nearest = 0;
    for (let index = 0; index < keys.length; index += 1) {
      const candidate = keyDistance(pixel, keys[index], luminanceWeight);
      if (candidate < distance) {
        distance = candidate;
        nearest = index;
      }
    }
    return { pixel, distance, nearest };
  };

  const removeAt = (x, y, offset, measurement) => {
    const alpha = data[offset + 3];
    if (alpha === 0) return 0;
    const shapeWeight = shapeWeightAt(x, y);
    if (shapeWeight <= 0) return 0;
    const matte = smootherstep(threshold, traversalThreshold, measurement.distance);
    const removal = shapeWeight * (1 - matte);
    if (removal <= 0) return 0;
    const next = Math.round(alpha * (1 - removal));
    data[offset + 3] = Math.min(alpha, next);
    if (region.despill > 0 && data[offset + 3] > 0) {
      suppressSpill(data, offset, measurement.pixel, keys[measurement.nearest], region.despill * removal);
    }
    return data[offset + 3] < alpha ? 1 : 0;
  };

  if (region.connected && shape.seed) {
    return floodFill(data, width, shape, region, {
      minX, maxX, minY, maxY, traversalThreshold, shapeWeightAt, measure, removeAt
    });
  }

  let removed = 0;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const offset = ((y * width) + x) * 4;
      if (data[offset + 3] === 0) continue;
      if (shapeWeightAt(x, y) <= 0) continue;
      const measurement = measure(offset);
      if (measurement.distance > traversalThreshold) continue;
      removed += removeAt(x, y, offset, measurement);
    }
  }
  return removed;
}

/**
 * 8-neighbour flood from the seed, fenced by the ellipse.
 *
 * This is the third safety mechanism after the region itself and tolerance: it
 * lets a user draw a generous circle around a detail and still not take out a
 * same-coloured neighbour that happens to fall inside, as long as the two are
 * not touching.
 *
 * The queue is an `Int32Array` sized to the bounding box rather than a growing
 * `Array` — a sheet can be 50 megapixels and the push path allocates per step.
 */
function floodFill(data, width, shape, region, ctx) {
  const { minX, maxX, minY, maxY, traversalThreshold, shapeWeightAt, measure, removeAt } = ctx;
  const boxWidth = (maxX - minX) + 1;
  const boxHeight = (maxY - minY) + 1;
  const seedX = Math.round(shape.seed.x - 0.5);
  const seedY = Math.round(shape.seed.y - 0.5);
  if (seedX < minX || seedX > maxX || seedY < minY || seedY > maxY) return 0;
  if (shapeWeightAt(seedX, seedY) <= 0) return 0;

  const visited = new Uint8Array(boxWidth * boxHeight);
  const queue = new Int32Array(boxWidth * boxHeight);
  let head = 0;
  let tail = 0;
  let removed = 0;

  const boxIndex = (x, y) => ((y - minY) * boxWidth) + (x - minX);

  const visit = (x, y) => {
    const index = boxIndex(x, y);
    if (visited[index]) return;
    visited[index] = 1;
    if (shapeWeightAt(x, y) <= 0) return;
    const offset = ((y * width) + x) * 4;
    if (data[offset + 3] === 0) return;
    const measurement = measure(offset);
    if (measurement.distance > traversalThreshold) return;
    removed += removeAt(x, y, offset, measurement);
    queue[tail++] = index;
  };

  visit(seedX, seedY);
  while (head < tail) {
    const index = queue[head++];
    const x = (index % boxWidth) + minX;
    const y = Math.floor(index / boxWidth) + minY;
    for (let ny = Math.max(minY, y - 1); ny <= Math.min(maxY, y + 1); ny += 1) {
      for (let nx = Math.max(minX, x - 1); nx <= Math.min(maxX, x + 1); nx += 1) {
        if (nx === x && ny === y) continue;
        visit(nx, ny);
      }
    }
  }
  return removed;
}
