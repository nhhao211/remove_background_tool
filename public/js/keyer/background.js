import { colorMetrics, keyDistance, normalizeColor } from './color.js';

/**
 * Samples the frame border and clusters it into candidate key colours.
 *
 * Sheet-path only today — the video path has never auto-detected. Moved
 * verbatim from background-removal.js; the one edit is calling the merged
 * `keyDistance` rather than the local `colorDistance` alias.
 *
 * The clustering is greedy single-pass with a fixed 0.055 merge radius and a
 * 48-cluster cap, which is why an unevenly lit screen reports several near
 * duplicates rather than one colour. Phase 5's background model is what fixes
 * that; this stays as-is so the baseline holds.
 */
export function detectEdgeColors(imageData, options = {}) {
  const { width, height, data } = imageData;
  if (!width || !height || !data?.length) return [];

  const maxColors = Math.max(1, Math.min(12, Math.round(options.maxColors || 6)));
  const depth = Math.max(1, Math.min(Math.floor(Math.min(width, height) / 4), Math.round(options.edgeDepth || Math.max(1, Math.min(width, height) * 0.012))));
  const perimeterPixels = Math.max(1, ((width + height) * 2 * depth));
  const stride = Math.max(1, Math.floor(Math.sqrt(perimeterPixels / 12000)));
  const clusters = [];

  const addSample = (x, y) => {
    const offset = ((y * width) + x) * 4;
    if (data[offset + 3] < 24) return;
    const raw = { r: data[offset], g: data[offset + 1], b: data[offset + 2] };
    const metrics = colorMetrics(raw);
    let nearest = null;
    let nearestDistance = Infinity;
    for (const cluster of clusters) {
      const distance = keyDistance(metrics, cluster.metrics, 0.25);
      if (distance < nearestDistance) {
        nearest = cluster;
        nearestDistance = distance;
      }
    }
    if (nearest && nearestDistance < 0.055) {
      nearest.count += 1;
      nearest.r += raw.r;
      nearest.g += raw.g;
      nearest.b += raw.b;
      nearest.metrics = colorMetrics({
        r: nearest.r / nearest.count,
        g: nearest.g / nearest.count,
        b: nearest.b / nearest.count
      });
    } else if (clusters.length < 48) {
      clusters.push({ count: 1, r: raw.r, g: raw.g, b: raw.b, metrics });
    }
  };

  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < depth; x += stride) {
      addSample(x, y);
      addSample(width - 1 - x, y);
    }
  }
  for (let x = 0; x < width; x += stride) {
    for (let y = 0; y < depth; y += stride) {
      addSample(x, y);
      addSample(x, height - 1 - y);
    }
  }

  const minimumSupport = Math.max(2, Math.floor(perimeterPixels / (stride * stride) * 0.008));
  return clusters
    .filter((cluster) => cluster.count >= minimumSupport)
    .sort((a, b) => b.count - a.count)
    .slice(0, maxColors)
    .map((cluster) => normalizeColor({
      r: cluster.r / cluster.count,
      g: cluster.g / cluster.count,
      b: cluster.b / cluster.count
    }));
}
