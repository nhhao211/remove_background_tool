import { clamp01, colorMetrics, keyDistance, normalizeColor } from './keyer/color.js';

/**
 * Edge Refine — a post-pass over the connected keyer's output.
 *
 * The connected matte is a binary flood fill: a pixel joins the background
 * mask only when its colour is within `traversalThreshold` of a key. Edge
 * pixels are a *mix* of subject and backdrop, so they miss the threshold and
 * stay fully opaque with the backdrop still blended into them. That is both the
 * halo and the stair-stepping. This pass revisits only the pixels next to the
 * removed background and re-estimates their coverage and colour from the
 * untouched original.
 *
 * It lives outside `keyer/` on purpose, like `erase-mask.js`: the keyer has a
 * byte-identical baseline and `assertOptions()` rejects unknown options, and
 * nothing here needs to change either.
 *
 * Invariants the callers rely on:
 * - alpha never increases (`α = min(α_refine, α_keyer)`), so the keyer's
 *   decisions, seed points and Edge Cleanup are respected;
 * - only pixels within `edgeWidth` of an alpha-0 pixel are written, so the
 *   subject core is byte-identical to the input;
 * - pixels outside `rect` are neither read nor written, so per-cell calls
 *   cannot bleed across a grid line.
 */

/** Foreground samples come from this far inside the edge band. Four pixels
 *  reaches past a 1–3 px band into solid subject without crossing thin gaps. */
const FG_RADIUS = 4;

/** Background samples. A band pixel is at most `edgeWidth` (≤ 3) from alpha 0,
 *  so this radius always finds at least one background pixel. */
const BG_RADIUS = 3;

/** Below this RGB distance between the local foreground and background
 *  estimates, projecting onto the F–B line amplifies noise more than it
 *  recovers coverage (subject hue close to the key, clip-03). */
const MIN_FB_CONTRAST = 40;

/** A near-neutral backdrop (white, black, grey) has no chroma axis to measure
 *  against, so the colour-difference fallback would divide by ~0. */
const MIN_KEY_CHROMA = 8;

/** Unmixing divides by alpha; below this the recovered colour is noise. */
const MIN_UNMIX_ALPHA = 0.02;

/** A foreground sample this close to a key colour is spill or backdrop, not
 *  subject — the multiplier is applied to the keyer's traversal threshold. */
const FG_KEY_EXCLUSION = 3;

const MAX_EDGE_WIDTH = 3;
const FAR = 255;

/** Same formula as `applyConnectedMatte` in `keyer/matte.js`, with the same
 *  defaults, so "close to the key" means what it means to the keyer. */
function keyerThresholds(options) {
  const similarity = clamp01(options.similarity ?? 0.48);
  const feather = clamp01(options.feather ?? 0.20);
  const subjectProtection = clamp01(options.subjectProtection ?? 0.55);
  const luminanceWeight = 0.08 + (0.9 * Math.pow(subjectProtection, 1.5));
  const transparentThreshold = 0.015 + (0.28 * Math.pow(similarity, 1.4));
  const featherWidth = 0.003 + (0.11 * Math.pow(feather, 1.45));
  return { luminanceWeight, traversalThreshold: transparentThreshold + featherWidth };
}

function resolveRect(rect, width, height) {
  if (!rect) return { x0: 0, y0: 0, width, height };
  const x0 = Math.max(0, Math.min(width, Math.floor(Number(rect.x0) || 0)));
  const y0 = Math.max(0, Math.min(height, Math.floor(Number(rect.y0) || 0)));
  const x1 = Math.max(x0, Math.min(width, x0 + Math.floor(Number(rect.width) || 0)));
  const y1 = Math.max(y0, Math.min(height, y0 + Math.floor(Number(rect.height) || 0)));
  return { x0, y0, width: x1 - x0, height: y1 - y0 };
}

/**
 * Chessboard distance to the nearest alpha-0 pixel, capped at `limit`
 * (anything farther reads `FAR`). Multi-source BFS seeded only from alpha-0
 * pixels that touch a visible pixel — the nearest zero to any visible pixel is
 * always such a boundary zero — so the queue stays proportional to the band
 * rather than to the backdrop.
 */
function distanceToClear(data, imageWidth, rect, limit) {
  const { x0, y0, width, height } = rect;
  const count = width * height;
  const dist = new Uint8Array(count).fill(FAR);
  const queue = new Int32Array(count);
  let head = 0;
  let tail = 0;

  for (let y = 0; y < height; y += 1) {
    const rowOffset = ((y0 + y) * imageWidth) + x0;
    for (let x = 0; x < width; x += 1) {
      if (data[((rowOffset + x) * 4) + 3] === 0) dist[(y * width) + x] = 0;
    }
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width) + x;
      if (dist[index] !== 0) continue;
      let touchesVisible = false;
      for (let ny = Math.max(0, y - 1); ny <= Math.min(height - 1, y + 1) && !touchesVisible; ny += 1) {
        for (let nx = Math.max(0, x - 1); nx <= Math.min(width - 1, x + 1); nx += 1) {
          if (dist[(ny * width) + nx] !== 0) { touchesVisible = true; break; }
        }
      }
      if (touchesVisible) queue[tail++] = index;
    }
  }

  while (head < tail) {
    const index = queue[head++];
    const next = dist[index] + 1;
    if (next > limit) continue;
    const x = index % width;
    const y = (index - x) / width;
    for (let ny = Math.max(0, y - 1); ny <= Math.min(height - 1, y + 1); ny += 1) {
      for (let nx = Math.max(0, x - 1); nx <= Math.min(width - 1, x + 1); nx += 1) {
        const neighbour = (ny * width) + nx;
        if (dist[neighbour] <= next) continue;
        dist[neighbour] = next;
        queue[tail++] = neighbour;
      }
    }
  }

  return dist;
}

function sampleWeights(radius) {
  const size = (2 * radius) + 1;
  const weights = new Float32Array(size * size);
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      weights[((dy + radius) * size) + dx + radius] = 1 / (1 + (dx * dx) + (dy * dy));
    }
  }
  return weights;
}

const FG_WEIGHTS = sampleWeights(FG_RADIUS);
const BG_WEIGHTS = sampleWeights(BG_RADIUS);

/**
 * Refines the edge band of `keyed` in place.
 *
 * @param {ImageData} keyed     output of `runKeyer` (mutated)
 * @param {ImageData} original  the same sheet before keying, same size
 * @param {object}    options   { keyColors, edgeWidth=1, smooth=0.35,
 *   decontaminate=true, pixelArt=false, rect=null, similarity, feather,
 *   subjectProtection }
 * @returns {{ imageData: ImageData, stats: { band, unmixed, colorDiff, keptKeyer } }}
 */
export function refineEdges(keyed, original, options = {}) {
  const stats = { band: 0, unmixed: 0, colorDiff: 0, keptKeyer: 0 };
  const imageWidth = keyed?.width | 0;
  const imageHeight = keyed?.height | 0;
  if (!imageWidth || !imageHeight || !original
    || original.width !== imageWidth || original.height !== imageHeight) {
    return { imageData: keyed, stats };
  }

  const rect = resolveRect(options.rect, imageWidth, imageHeight);
  if (!rect.width || !rect.height) return { imageData: keyed, stats };

  const edgeWidth = Math.max(1, Math.min(MAX_EDGE_WIDTH, Math.round(Number(options.edgeWidth) || 1)));
  const smooth = clamp01(options.smooth ?? 0.35);
  const decontaminate = options.decontaminate !== false;
  const pixelArt = options.pixelArt === true;
  const { luminanceWeight, traversalThreshold } = keyerThresholds(options);
  const keyExclusion = FG_KEY_EXCLUSION * traversalThreshold;
  const keys = (Array.isArray(options.keyColors) ? options.keyColors : [])
    .map(normalizeColor)
    .map((color) => ({ color, metrics: colorMetrics(color) }));

  const out = keyed.data;
  const src = original.data;
  const { x0, y0, width, height } = rect;
  const dist = distanceToClear(out, imageWidth, rect, edgeWidth + FG_RADIUS + 1);

  // 0 = not yet classified, 1 = usable foreground sample, 2 = not usable.
  const fgClass = new Uint8Array(width * height);
  const isForegroundSample = (localIndex, offset) => {
    if (fgClass[localIndex] === 0) {
      let usable = src[offset + 3] > 0;
      if (usable && keys.length) {
        const pixel = colorMetrics({ r: src[offset], g: src[offset + 1], b: src[offset + 2] });
        for (const key of keys) {
          if (keyDistance(pixel, key.metrics, luminanceWeight) < keyExclusion) { usable = false; break; }
        }
      }
      fgClass[localIndex] = usable ? 1 : 2;
    }
    return fgClass[localIndex] === 1;
  };

  let bandCount = 0;
  for (let index = 0; index < dist.length; index += 1) {
    if (dist[index] >= 1 && dist[index] <= edgeWidth) bandCount += 1;
  }
  stats.band = bandCount;
  if (bandCount === 0) return { imageData: keyed, stats };

  const bandIndices = new Int32Array(bandCount);
  const bandAlpha = new Float32Array(bandCount);
  // Refined alpha by local index, read by the smoothing pass for neighbours.
  const alphaAt = new Float32Array(width * height);
  let cursor = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const localIndex = (y * width) + x;
      const d = dist[localIndex];
      if (d < 1 || d > edgeWidth) continue;
      const offset = ((((y0 + y) * imageWidth) + x0 + x) * 4);
      const keyerAlpha = out[offset + 3] / 255;
      const cr = src[offset];
      const cg = src[offset + 1];
      const cb = src[offset + 2];
      let alpha = keyerAlpha;
      let fr = -1;
      let fg = 0;
      let fb = 0;

      // A pixel that was already translucent in the source carries no backdrop
      // mix we can model; leave it to the keyer.
      const modelled = src[offset + 3] === 255;

      // Local background: original colour of nearby cleared pixels.
      let br = 0;
      let bg = 0;
      let bb = 0;
      let bgWeight = 0;
      if (modelled) {
        for (let dy = -BG_RADIUS; dy <= BG_RADIUS; dy += 1) {
          const ny = y + dy;
          if (ny < 0 || ny >= height) continue;
          for (let dx = -BG_RADIUS; dx <= BG_RADIUS; dx += 1) {
            const nx = x + dx;
            if (nx < 0 || nx >= width || dist[(ny * width) + nx] !== 0) continue;
            const sampleOffset = ((((y0 + ny) * imageWidth) + x0 + nx) * 4);
            // A pixel transparent in the source has no meaningful RGB.
            if (src[sampleOffset + 3] === 0) continue;
            const weight = BG_WEIGHTS[((dy + BG_RADIUS) * ((2 * BG_RADIUS) + 1)) + dx + BG_RADIUS];
            br += src[sampleOffset] * weight;
            bg += src[sampleOffset + 1] * weight;
            bb += src[sampleOffset + 2] * weight;
            bgWeight += weight;
          }
        }
      }
      let haveBackground = bgWeight > 0;
      if (haveBackground) {
        br /= bgWeight;
        bg /= bgWeight;
        bb /= bgWeight;
      } else if (modelled && keys.length) {
        const pixel = colorMetrics({ r: cr, g: cg, b: cb });
        let nearest = keys[0];
        let nearestDistance = Infinity;
        for (const key of keys) {
          const candidate = keyDistance(pixel, key.metrics, luminanceWeight);
          if (candidate < nearestDistance) { nearestDistance = candidate; nearest = key; }
        }
        br = nearest.color.r;
        bg = nearest.color.g;
        bb = nearest.color.b;
        haveBackground = true;
      }

      // Local foreground: original colour of solid subject just inside the band.
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let fgWeight = 0;
      // Solid pixels turned away only for looking like the key. A subject whose
      // own hue sits near the key (clip-03) has nothing else to offer.
      let rr = 0;
      let rg = 0;
      let rb = 0;
      let rejectedWeight = 0;
      if (haveBackground) {
        for (let dy = -FG_RADIUS; dy <= FG_RADIUS; dy += 1) {
          const ny = y + dy;
          if (ny < 0 || ny >= height) continue;
          for (let dx = -FG_RADIUS; dx <= FG_RADIUS; dx += 1) {
            const nx = x + dx;
            if (nx < 0 || nx >= width) continue;
            const sampleIndex = (ny * width) + nx;
            if (dist[sampleIndex] <= edgeWidth) continue;
            const sampleOffset = ((((y0 + ny) * imageWidth) + x0 + nx) * 4);
            if (src[sampleOffset + 3] === 0) continue;
            const weight = FG_WEIGHTS[((dy + FG_RADIUS) * ((2 * FG_RADIUS) + 1)) + dx + FG_RADIUS];
            if (!isForegroundSample(sampleIndex, sampleOffset)) {
              rr += src[sampleOffset] * weight;
              rg += src[sampleOffset + 1] * weight;
              rb += src[sampleOffset + 2] * weight;
              rejectedWeight += weight;
              continue;
            }
            sr += src[sampleOffset] * weight;
            sg += src[sampleOffset + 1] * weight;
            sb += src[sampleOffset + 2] * weight;
            fgWeight += weight;
          }
        }
      }

      if (haveBackground && fgWeight === 0 && rejectedWeight > 0) {
        // Key-like subject still counts as foreground when it stands clearly
        // apart from the local backdrop; otherwise it is spill, and colour
        // difference below handles it.
        const dr = (rr / rejectedWeight) - br;
        const dg = (rg / rejectedWeight) - bg;
        const db = (rb / rejectedWeight) - bb;
        if ((dr * dr) + (dg * dg) + (db * db) >= MIN_FB_CONTRAST * MIN_FB_CONTRAST) {
          sr = rr;
          sg = rg;
          sb = rb;
          fgWeight = rejectedWeight;
        }
      }

      if (!haveBackground) {
        stats.keptKeyer += 1;
      } else if (fgWeight > 0) {
        sr /= fgWeight;
        sg /= fgWeight;
        sb /= fgWeight;
        const dr = sr - br;
        const dg = sg - bg;
        const db = sb - bb;
        const contrastSquared = (dr * dr) + (dg * dg) + (db * db);
        if (contrastSquared >= MIN_FB_CONTRAST * MIN_FB_CONTRAST) {
          const estimate = clamp01((((cr - br) * dr) + ((cg - bg) * dg) + ((cb - bb) * db)) / contrastSquared);
          alpha = Math.min(estimate, keyerAlpha);
          if (estimate > MIN_UNMIX_ALPHA) {
            fr = br + ((cr - br) / estimate);
            fg = bg + ((cg - bg) / estimate);
            fb = bb + ((cb - bb) / estimate);
          } else {
            fr = sr;
            fg = sg;
            fb = sb;
          }
          stats.unmixed += 1;
        } else {
          stats.keptKeyer += 1;
        }
      } else {
        // No solid subject nearby: a 1–2 px strand or a soft region. Measure how
        // much of the backdrop's chroma the pixel carries instead.
        const bMean = (br + bg + bb) / 3;
        const kr = br - bMean;
        const kg = bg - bMean;
        const kb = bb - bMean;
        const keyChromaSquared = (kr * kr) + (kg * kg) + (kb * kb);
        if (keyChromaSquared >= MIN_KEY_CHROMA * MIN_KEY_CHROMA) {
          const cMean = (cr + cg + cb) / 3;
          const p = (((cr - cMean) * kr) + ((cg - cMean) * kg) + ((cb - cMean) * kb)) / keyChromaSquared;
          alpha = Math.min(clamp01(1 - p), keyerAlpha);
          const removed = Math.max(0, p);
          fr = cr - (removed * kr);
          fg = cg - (removed * kg);
          fb = cb - (removed * kb);
          stats.colorDiff += 1;
        } else {
          stats.keptKeyer += 1;
        }
      }

      if (decontaminate && fr >= 0) {
        out[offset] = Math.round(Math.min(255, Math.max(0, fr)));
        out[offset + 1] = Math.round(Math.min(255, Math.max(0, fg)));
        out[offset + 2] = Math.round(Math.min(255, Math.max(0, fb)));
      }

      bandIndices[cursor] = localIndex;
      bandAlpha[cursor] = alpha;
      alphaAt[localIndex] = alpha;
      cursor += 1;
    }
  }

  for (let i = 0; i < bandCount; i += 1) {
    const localIndex = bandIndices[i];
    const x = localIndex % width;
    const y = (localIndex - x) / width;
    const offset = ((((y0 + y) * imageWidth) + x0 + x) * 4);
    const keyerAlpha = out[offset + 3];
    let alpha = bandAlpha[i];

    if (pixelArt) {
      // Hard edges only. Snapping up to 255 could raise a pixel the keyer made
      // translucent, so the "on" state is the keyer's own alpha.
      out[offset + 3] = alpha >= 0.5 ? keyerAlpha : 0;
      continue;
    }

    if (smooth > 0) {
      // 3×3 tent. Neighbours outside the band contribute their keyer alpha
      // (0 for backdrop, the untouched value for core).
      let sum = 0;
      let total = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const neighbour = (ny * width) + nx;
          const d = dist[neighbour];
          const value = d >= 1 && d <= edgeWidth
            ? alphaAt[neighbour]
            : out[((((y0 + ny) * imageWidth) + x0 + nx) * 4) + 3] / 255;
          const weight = (dx === 0 ? 2 : 1) * (dy === 0 ? 2 : 1);
          sum += value * weight;
          total += weight;
        }
      }
      alpha = Math.min(alpha, ((1 - smooth) * alpha) + (smooth * (sum / total)));
    }

    out[offset + 3] = Math.min(keyerAlpha, Math.round(alpha * 255));
  }

  return { imageData: keyed, stats };
}
