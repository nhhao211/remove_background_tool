/**
 * Quality metrics for the chroma-key harness.
 *
 * All metrics read unpremultiplied 8-bit sRGB RGBA — the shape canvas
 * `getImageData` returns and the shape the keyer works in. Compositing is done
 * arithmetically here rather than through a canvas: a canvas composite
 * premultiplies, which destroys low-alpha RGB, and low-alpha RGB is precisely
 * what these metrics are trying to measure.
 */

export function luma(r, g, b) {
  return (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
}

/** out = a*F + (1-a)*bg, per channel, no premultiplied round trip. */
export function composite(image, [bgR, bgG, bgB]) {
  const source = image.data;
  const out = new Uint8ClampedArray(source.length);
  for (let offset = 0; offset < source.length; offset += 4) {
    const alpha = source[offset + 3] / 255;
    out[offset] = Math.round((source[offset] * alpha) + (bgR * (1 - alpha)));
    out[offset + 1] = Math.round((source[offset + 1] * alpha) + (bgG * (1 - alpha)));
    out[offset + 2] = Math.round((source[offset + 2] * alpha) + (bgB * (1 - alpha)));
    out[offset + 3] = 255;
  }
  return out;
}

/**
 * Total absolute alpha difference. Zero is the only passing value for a phase
 * that claims to be a pure refactor.
 */
export function alphaSAD(current, baseline) {
  if (current.length !== baseline.length) return Infinity;
  let sad = 0;
  for (let offset = 3; offset < current.length; offset += 4) {
    sad += Math.abs(current[offset] - baseline[offset]);
  }
  return sad;
}

/**
 * Mean per-channel RGB deviation over pixels that are fully opaque in *both*
 * buffers. Restricting to the intersection matters: comparing a pixel that is
 * opaque in one and transparent in the other measures the alpha change twice
 * and says nothing about colour.
 */
export function coreRGBDelta(current, baseline) {
  if (current.length !== baseline.length) return Infinity;
  let sum = 0;
  let count = 0;
  for (let offset = 0; offset < current.length; offset += 4) {
    if (current[offset + 3] !== 255 || baseline[offset + 3] !== 255) continue;
    sum += Math.abs(current[offset] - baseline[offset]);
    sum += Math.abs(current[offset + 1] - baseline[offset + 1]);
    sum += Math.abs(current[offset + 2] - baseline[offset + 2]);
    count += 3;
  }
  return count > 0 ? sum / count : 0;
}

/**
 * Signed luma difference between recovered edge colour and the subject interior
 * next to it. Negative means a dark rim, positive a light rim, near zero a clean
 * edge.
 *
 * The sign is the point. An unsigned "how different is the edge" score is
 * maximised by a frame that is uniformly half transparent, so it rewards
 * softening — the exact regression the refinement phases must avoid.
 */
export function fringeContrast(image) {
  const { data, width, height } = image;
  let total = 0;
  let counted = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = ((y * width) + x) * 4;
      const alpha = data[offset + 3] / 255;
      if (alpha <= 0.05 || alpha >= 0.95) continue;

      let interiorLuma = 0;
      let interiorCount = 0;
      for (let radius = 1; radius <= 3 && interiorCount === 0; radius += 1) {
        for (let dy = -radius; dy <= radius; dy += 1) {
          for (let dx = -radius; dx <= radius; dx += 1) {
            if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const neighbour = ((ny * width) + nx) * 4;
            if (data[neighbour + 3] / 255 <= 0.95) continue;
            interiorLuma += luma(data[neighbour], data[neighbour + 1], data[neighbour + 2]);
            interiorCount += 1;
          }
        }
      }
      if (interiorCount === 0) continue;

      total += luma(data[offset], data[offset + 1], data[offset + 2]) - (interiorLuma / interiorCount);
      counted += 1;
    }
  }

  return counted > 0 ? total / counted : 0;
}

/**
 * Mean absolute alpha difference restricted to the ground-truth soft band.
 *
 * This replaces a whole-frame "detail retention" score, which a uniformly
 * half-transparent frame maximises. Scoring only where the truth is genuinely
 * partial means crisping a soft edge correctly registers as an improvement
 * instead of a regression.
 */
export function bandSAD(current, groundTruthAlpha) {
  if (current.length !== groundTruthAlpha.length) return Infinity;
  let sum = 0;
  let count = 0;
  for (let offset = 3; offset < current.length; offset += 4) {
    const truth = groundTruthAlpha[offset];
    if (truth <= 12 || truth >= 242) continue;
    sum += Math.abs(current[offset] - truth);
    count += 1;
  }
  return count > 0 ? sum / count : 0;
}

/**
 * Fringe measured after a 4x bilinear upsample.
 *
 * A matte can look clean at native size and still show a grey rim once a GPU
 * filters it, because interpolation mixes RGB from pixels whose alpha is zero.
 * Sprites are always sampled filtered, so this is the condition that matters.
 */
export function bilinearHaloCheck(image, scale = 4) {
  const { data, width, height } = image;
  const outWidth = width * scale;
  const outHeight = height * scale;
  const out = new Uint8ClampedArray(outWidth * outHeight * 4);

  for (let y = 0; y < outHeight; y += 1) {
    const sy = ((y + 0.5) / scale) - 0.5;
    const y0 = Math.max(0, Math.min(height - 1, Math.floor(sy)));
    const y1 = Math.min(height - 1, y0 + 1);
    const fy = Math.max(0, Math.min(1, sy - y0));

    for (let x = 0; x < outWidth; x += 1) {
      const sx = ((x + 0.5) / scale) - 0.5;
      const x0 = Math.max(0, Math.min(width - 1, Math.floor(sx)));
      const x1 = Math.min(width - 1, x0 + 1);
      const fx = Math.max(0, Math.min(1, sx - x0));

      const p00 = ((y0 * width) + x0) * 4;
      const p10 = ((y0 * width) + x1) * 4;
      const p01 = ((y1 * width) + x0) * 4;
      const p11 = ((y1 * width) + x1) * 4;
      const target = ((y * outWidth) + x) * 4;

      for (let channel = 0; channel < 4; channel += 1) {
        const top = (data[p00 + channel] * (1 - fx)) + (data[p10 + channel] * fx);
        const bottom = (data[p01 + channel] * (1 - fx)) + (data[p11 + channel] * fx);
        out[target + channel] = Math.round((top * (1 - fy)) + (bottom * fy));
      }
    }
  }

  return fringeContrast({ data: out, width: outWidth, height: outHeight });
}
