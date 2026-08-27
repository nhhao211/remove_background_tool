const clamp01 = (value) => Math.min(1, Math.max(0, Number(value) || 0));

function smootherstep(edge0, edge1, value) {
  if (edge1 <= edge0) return value < edge0 ? 0 : 1;
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function normalizeColor(color, fallback = { r: 0, g: 0, b: 0 }) {
  const source = color || fallback;
  return {
    r: Math.max(0, Math.min(255, Math.round(Number(source.r) || 0))),
    g: Math.max(0, Math.min(255, Math.round(Number(source.g) || 0))),
    b: Math.max(0, Math.min(255, Math.round(Number(source.b) || 0)))
  };
}

function colorMetrics(color) {
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;
  const y = (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
  return { r, g, b, y, cb: b - y, cr: r - y };
}

function colorDistance(a, b) {
  const dCb = a.cb - b.cb;
  const dCr = a.cr - b.cr;
  const dY = a.y - b.y;
  return Math.sqrt((dCb * dCb) + (dCr * dCr) + (0.22 * dY * dY));
}

function applyColorReplacement(imageData, options = {}) {
  if (options.enabled === false || !imageData?.data?.length) return imageData;
  const source = colorMetrics(normalizeColor(options.sourceColor));
  const target = colorMetrics(normalizeColor(options.targetColor, { r: 255, g: 255, b: 255 }));
  const tolerance = clamp01(options.tolerance ?? 0.28);
  const strength = clamp01(options.strength ?? 1);
  if (strength <= 0) return imageData;

  const outerThreshold = 0.012 + (0.42 * Math.pow(tolerance, 1.35));
  const innerThreshold = outerThreshold * 0.34;
  const luminanceShift = target.y - source.y;
  const data = imageData.data;

  for (let offset = 0; offset < data.length; offset += 4) {
    if (data[offset + 3] === 0) continue;
    const pixel = colorMetrics({ r: data[offset], g: data[offset + 1], b: data[offset + 2] });
    const distance = colorDistance(pixel, source);
    const match = 1 - smootherstep(innerThreshold, outerThreshold, distance);
    const amount = match * strength;
    if (amount <= 0) continue;

    // Shift the matched pixel by the source→target luminance delta, then use
    // the target chroma. This maps the sampled color to the requested color
    // while retaining local highlights and shadows in neighboring shades.
    const desiredY = clamp01(pixel.y + luminanceShift);
    const desiredR = clamp01(desiredY + target.cr);
    const desiredB = clamp01(desiredY + target.cb);
    const desiredG = clamp01((desiredY - (0.2126 * desiredR) - (0.0722 * desiredB)) / 0.7152);
    data[offset] = Math.round(data[offset] + (((desiredR * 255) - data[offset]) * amount));
    data[offset + 1] = Math.round(data[offset + 1] + (((desiredG * 255) - data[offset + 1]) * amount));
    data[offset + 2] = Math.round(data[offset + 2] + (((desiredB * 255) - data[offset + 2]) * amount));
  }
  return imageData;
}

export { applyColorReplacement };
