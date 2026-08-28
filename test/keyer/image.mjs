/**
 * Deterministic raster primitives for the chroma-key regression corpus.
 *
 * The corpus is drawn procedurally rather than through a canvas library so that
 * fixture bytes depend only on this file. A canvas rasteriser would let an
 * upstream version bump silently change every fixture, which would invalidate
 * committed baselines without any change to the keyer.
 */

export class ImageData {
  constructor(a, b, c) {
    if (typeof a === 'number') {
      this.width = a;
      this.height = b;
      this.data = new Uint8ClampedArray(a * b * 4);
    } else {
      this.data = a;
      this.width = b;
      this.height = c;
    }
  }
}

export function cloneImageData(image) {
  return new ImageData(new Uint8ClampedArray(image.data), image.width, image.height);
}

/** mulberry32 — small, fast, fully reproducible across Node versions. */
export function createRng(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (value) => Math.min(1, Math.max(0, value));

/** Source-over blend of one opaque colour at fractional coverage. */
function blendPixel(image, x, y, [r, g, b], coverage) {
  if (coverage <= 0) return;
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return;
  const offset = ((y * image.width) + x) * 4;
  const data = image.data;
  const weight = clamp01(coverage);
  data[offset] = Math.round((data[offset] * (1 - weight)) + (r * weight));
  data[offset + 1] = Math.round((data[offset + 1] * (1 - weight)) + (g * weight));
  data[offset + 2] = Math.round((data[offset + 2] * (1 - weight)) + (b * weight));
  data[offset + 3] = 255;
}

export function fillRect(image, x0, y0, width, height, color) {
  const xEnd = Math.min(image.width, x0 + width);
  const yEnd = Math.min(image.height, y0 + height);
  for (let y = Math.max(0, y0); y < yEnd; y += 1) {
    for (let x = Math.max(0, x0); x < xEnd; x += 1) {
      blendPixel(image, x, y, color, 1);
    }
  }
}

/**
 * Analytic coverage antialiasing: coverage falls off across one pixel at the
 * boundary. This is what produces the soft edges the keyer is measured on.
 */
export function fillCircle(image, cx, cy, radius, color) {
  const x0 = Math.max(0, Math.floor(cx - radius - 1));
  const x1 = Math.min(image.width - 1, Math.ceil(cx + radius + 1));
  const y0 = Math.max(0, Math.floor(cy - radius - 1));
  const y1 = Math.min(image.height - 1, Math.ceil(cy + radius + 1));
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const dx = (x + 0.5) - cx;
      const dy = (y + 0.5) - cy;
      const distance = Math.sqrt((dx * dx) + (dy * dy));
      blendPixel(image, x, y, color, clamp01(radius + 0.5 - distance));
    }
  }
}

export function drawLine(image, x0, y0, x1, y1, thickness, color) {
  const half = thickness / 2;
  const minX = Math.max(0, Math.floor(Math.min(x0, x1) - half - 1));
  const maxX = Math.min(image.width - 1, Math.ceil(Math.max(x0, x1) + half + 1));
  const minY = Math.max(0, Math.floor(Math.min(y0, y1) - half - 1));
  const maxY = Math.min(image.height - 1, Math.ceil(Math.max(y0, y1) + half + 1));
  const dx = x1 - x0;
  const dy = y1 - y0;
  const lengthSquared = (dx * dx) + (dy * dy);

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const px = (x + 0.5) - x0;
      const py = (y + 0.5) - y0;
      const t = lengthSquared > 0 ? clamp01(((px * dx) + (py * dy)) / lengthSquared) : 0;
      const ox = px - (dx * t);
      const oy = py - (dy * t);
      const distance = Math.sqrt((ox * ox) + (oy * oy));
      blendPixel(image, x, y, color, clamp01(half + 0.5 - distance));
    }
  }
}

/** Blend an opaque colour over the whole image at a constant weight. */
export function fillRectTranslucent(image, x0, y0, width, height, color, alpha) {
  const xEnd = Math.min(image.width, x0 + width);
  const yEnd = Math.min(image.height, y0 + height);
  for (let y = Math.max(0, y0); y < yEnd; y += 1) {
    for (let x = Math.max(0, x0); x < xEnd; x += 1) {
      blendPixel(image, x, y, color, alpha);
    }
  }
}

export function verticalGradient(image, colorTop, colorBottom) {
  for (let y = 0; y < image.height; y += 1) {
    const t = image.height > 1 ? y / (image.height - 1) : 0;
    const color = [
      Math.round(colorTop[0] + ((colorBottom[0] - colorTop[0]) * t)),
      Math.round(colorTop[1] + ((colorBottom[1] - colorTop[1]) * t)),
      Math.round(colorTop[2] + ((colorBottom[2] - colorTop[2]) * t))
    ];
    fillRect(image, 0, y, image.width, 1, color);
  }
}

/** Symmetric grain. The original harness used Math.random, which made every
 *  regeneration produce different fixtures and no baseline could hold. */
export function addNoise(image, amplitude, rng) {
  const data = image.data;
  for (let offset = 0; offset < data.length; offset += 4) {
    const noise = (rng() - 0.5) * 2 * amplitude * 255;
    data[offset] = Math.round(Math.min(255, Math.max(0, data[offset] + noise)));
    data[offset + 1] = Math.round(Math.min(255, Math.max(0, data[offset + 1] + noise)));
    data[offset + 2] = Math.round(Math.min(255, Math.max(0, data[offset + 2] + noise)));
  }
}

export function blitInto(target, source, x0, y0) {
  for (let y = 0; y < source.height; y += 1) {
    const targetY = y0 + y;
    if (targetY < 0 || targetY >= target.height) continue;
    for (let x = 0; x < source.width; x += 1) {
      const targetX = x0 + x;
      if (targetX < 0 || targetX >= target.width) continue;
      const from = ((y * source.width) + x) * 4;
      const to = ((targetY * target.width) + targetX) * 4;
      target.data[to] = source.data[from];
      target.data[to + 1] = source.data[from + 1];
      target.data[to + 2] = source.data[from + 2];
      target.data[to + 3] = source.data[from + 3];
    }
  }
}
