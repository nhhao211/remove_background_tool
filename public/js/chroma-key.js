const clamp01 = (value) => Math.min(1, Math.max(0, Number(value) || 0));

function smootherstep(edge0, edge1, value) {
  if (edge1 <= edge0) return value < edge0 ? 0 : 1;
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function colorMetrics(color) {
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;
  const y = (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
  return {
    r,
    g,
    b,
    y,
    cb: b - y,
    cr: r - y
  };
}

function keyDistance(pixel, key, luminanceWeight) {
  const dCb = pixel.cb - key.cb;
  const dCr = pixel.cr - key.cr;
  const dY = pixel.y - key.y;

  // Chroma carries most of the keying decision. Subject protection increases
  // luminance separation so similarly hued foreground detail is less likely
  // to be mistaken for a differently lit backdrop.
  return Math.sqrt((dCb * dCb) + (dCr * dCr) + (luminanceWeight * dY * dY));
}

function suppressSpill(data, offset, pixel, key, strength) {
  if (strength <= 0) return;

  const keyChroma = [key.r - key.y, key.g - key.y, key.b - key.y];
  const magnitude = Math.hypot(...keyChroma);
  if (magnitude < 0.02) return;

  const direction = keyChroma.map((channel) => channel / magnitude);
  const pixelChroma = [pixel.r - pixel.y, pixel.g - pixel.y, pixel.b - pixel.y];
  const projection = pixelChroma.reduce((sum, channel, index) => sum + (channel * direction[index]), 0);
  if (projection <= 0) return;

  // Removing only the component pointing toward the sampled key hue handles
  // blue, green, red, and custom key colors without shifting neutral detail.
  const removal = projection * clamp01(strength);
  data[offset] = Math.round(clamp01(pixel.r - (direction[0] * removal)) * 255);
  data[offset + 1] = Math.round(clamp01(pixel.g - (direction[1] * removal)) * 255);
  data[offset + 2] = Math.round(clamp01(pixel.b - (direction[2] * removal)) * 255);
}

function erodeForegroundAlpha(imageData, radius) {
  const width = Number(imageData.width) || 0;
  const height = Number(imageData.height) || 0;
  if (!width || !height || radius <= 0) return;
  const data = imageData.data;
  let transparent = new Uint8Array(width * height);
  for (let index = 0; index < transparent.length; index += 1) {
    if (data[(index * 4) + 3] <= 8) transparent[index] = 1;
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
    if (transparent[index]) data[(index * 4) + 3] = 0;
  }
}

function applyChromaKey(imageData, options = {}) {
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

export { applyChromaKey };
