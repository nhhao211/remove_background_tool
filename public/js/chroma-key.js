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

function keyDistance(pixel, key) {
  const dCb = pixel.cb - key.cb;
  const dCr = pixel.cr - key.cr;
  const dY = pixel.y - key.y;

  // Chroma carries most of the keying decision. A small luminance component
  // still separates similarly hued foreground details from the backdrop.
  return Math.sqrt((dCb * dCb) + (dCr * dCr) + (0.08 * dY * dY));
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

function applyChromaKey(imageData, options = {}) {
  const keyColors = Array.isArray(options.keyColors) ? options.keyColors : [];
  if (options.enabled === false || keyColors.length === 0) return imageData;

  const similarity = clamp01(options.similarity ?? 0.55);
  const blend = clamp01(options.blend ?? 0.18);
  const spill = clamp01(options.spill ?? 0.55);
  const keys = keyColors.map(colorMetrics);

  // Non-linear mappings reserve more useful slider travel for clean, narrow
  // mattes while still allowing aggressive removal at the upper end.
  const transparentThreshold = 0.018 + (0.30 * Math.pow(similarity, 1.4));
  const featherWidth = 0.002 + (0.12 * Math.pow(blend, 1.55));
  const spillReach = transparentThreshold + featherWidth + 0.10 + (0.10 * similarity);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    const sourceAlpha = data[i + 3];
    if (sourceAlpha === 0) continue;

    const pixel = colorMetrics({ r: data[i], g: data[i + 1], b: data[i + 2] });
    let nearestKey = keys[0];
    let distance = keyDistance(pixel, nearestKey);

    for (let k = 1; k < keys.length; k += 1) {
      const candidateDistance = keyDistance(pixel, keys[k]);
      if (candidateDistance < distance) {
        distance = candidateDistance;
        nearestKey = keys[k];
      }
    }

    const matte = smootherstep(transparentThreshold, transparentThreshold + featherWidth, distance);
    data[i + 3] = Math.round(sourceAlpha * matte);

    if (spill > 0 && matte > 0) {
      const proximity = 1 - smootherstep(transparentThreshold + featherWidth, spillReach, distance);
      const edgeWeight = 0.35 + (0.65 * (1 - matte));
      suppressSpill(data, i, pixel, nearestKey, spill * proximity * edgeWeight);
    }
  }

  return imageData;
}

export { applyChromaKey };
