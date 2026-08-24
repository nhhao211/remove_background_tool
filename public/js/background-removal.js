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
  return { r, g, b, y, cb: b - y, cr: r - y };
}

function colorDistance(a, b, luminanceWeight = 0.35) {
  const dCb = a.cb - b.cb;
  const dCr = a.cr - b.cr;
  const dY = a.y - b.y;
  return Math.sqrt((dCb * dCb) + (dCr * dCr) + (luminanceWeight * dY * dY));
}

function normalizeColor(color) {
  const r = Math.round(Math.min(255, Math.max(0, Number(color?.r) || 0)));
  const g = Math.round(Math.min(255, Math.max(0, Number(color?.g) || 0)));
  const b = Math.round(Math.min(255, Math.max(0, Number(color?.b) || 0)));
  return { r, g, b, hex: `#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('')}` };
}

function detectEdgeColors(imageData, options = {}) {
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
      const distance = colorDistance(metrics, cluster.metrics, 0.25);
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

function dilateMask(mask, width, height, radius) {
  let current = mask;
  for (let pass = 0; pass < radius; pass += 1) {
    const next = current.slice();
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = (y * width) + x;
        if (current[index]) continue;
        for (let ny = Math.max(0, y - 1); ny <= Math.min(height - 1, y + 1) && !next[index]; ny += 1) {
          for (let nx = Math.max(0, x - 1); nx <= Math.min(width - 1, x + 1); nx += 1) {
            if (current[(ny * width) + nx]) {
              next[index] = 1;
              break;
            }
          }
        }
      }
    }
    current = next;
  }
  return current;
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
  const removal = projection * clamp01(strength);
  data[offset] = Math.round(clamp01(pixel.r - (direction[0] * removal)) * 255);
  data[offset + 1] = Math.round(clamp01(pixel.g - (direction[1] * removal)) * 255);
  data[offset + 2] = Math.round(clamp01(pixel.b - (direction[2] * removal)) * 255);
}

function removeConnectedBackground(imageData, options = {}) {
  const { width, height, data } = imageData;
  const detectedColors = options.autoDetect === false ? [] : detectEdgeColors(imageData, options);
  const suppliedColors = Array.isArray(options.keyColors) ? options.keyColors.map(normalizeColor) : [];
  const keyRegions = new Map((Array.isArray(options.keyRegions) ? options.keyRegions : [])
    .map((region) => [String(region?.hex || '').toLowerCase(), region]));
  const keyColors = [...suppliedColors];
  for (const color of detectedColors) {
    if (!keyColors.some((item) => Math.abs(item.r - color.r) + Math.abs(item.g - color.g) + Math.abs(item.b - color.b) < 18)) {
      keyColors.push(color);
    }
  }
  if (!width || !height || keyColors.length === 0) {
    return { imageData, keyColors, removedPixels: 0 };
  }

  const similarity = clamp01(options.similarity ?? 0.48);
  const feather = clamp01(options.feather ?? 0.20);
  const spill = clamp01(options.spill ?? 0.55);
  const subjectProtection = clamp01(options.subjectProtection ?? 0.55);
  const preserveColors = options.preserveColors !== false;
  const cleanupRadius = Math.max(0, Math.min(3, Math.round(options.cleanupRadius || 0)));
  const luminanceWeight = 0.08 + (0.9 * Math.pow(subjectProtection, 1.5));
  const transparentThreshold = 0.015 + (0.28 * Math.pow(similarity, 1.4));
  const featherWidth = 0.003 + (0.11 * Math.pow(feather, 1.45));
  const traversalThreshold = transparentThreshold + featherWidth;
  const keyRecords = [
    ...suppliedColors.map((color) => ({ metrics: colorMetrics(color), region: keyRegions.get(color.hex) || null })),
    ...detectedColors.map((color) => ({ metrics: colorMetrics(color), region: null }))
  ];
  const sheetWidth = Math.max(1, Number(options.sheetWidth) || width);
  const sheetHeight = Math.max(1, Number(options.sheetHeight) || height);
  const offsetX = Number(options.offsetX) || 0;
  const offsetY = Number(options.offsetY) || 0;
  const mask = new Uint8Array(width * height);
  const distanceMap = new Float32Array(width * height);
  const keyIndexMap = new Uint16Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;

  const regionAllows = (region, x, y) => {
    if (!region) return true;
    const globalX = x + offsetX;
    const globalY = y + offsetY;
    if (region.mode === 'cell-lower-half') {
      const rows = Math.max(1, Math.min(100, Math.round(Number(region.rows) || 1)));
      const row = Math.min(rows - 1, Math.floor((globalY * rows) / sheetHeight));
      const cellTop = Math.floor((row * sheetHeight) / rows);
      const cellBottom = Math.floor(((row + 1) * sheetHeight) / rows);
      const splitRatio = Math.max(0.1, Math.min(0.9, Number(region.splitRatio) || 0.5));
      const splitY = cellTop + ((cellBottom - cellTop) * splitRatio);
      return globalY >= splitY && globalY < cellBottom;
    }
    const minX = Number.isFinite(Number(region.minXRatio)) ? Number(region.minXRatio) * sheetWidth : 0;
    const maxX = Number.isFinite(Number(region.maxXRatio)) ? Number(region.maxXRatio) * sheetWidth : sheetWidth;
    const minY = Number.isFinite(Number(region.minYRatio)) ? Number(region.minYRatio) * sheetHeight : 0;
    const maxY = Number.isFinite(Number(region.maxYRatio)) ? Number(region.maxYRatio) * sheetHeight : sheetHeight;
    return globalX >= minX && globalX < maxX && globalY >= minY && globalY < maxY;
  };

  const hasAllowedKey = (x, y) => keyRecords.some((record) => regionAllows(record.region, x, y));

  const analyze = (index) => {
    const offset = index * 4;
    if (data[offset + 3] === 0) return { distance: 0, keyIndex: 0, eligible: true };
    const x = index % width;
    const y = Math.floor(index / width);
    const pixel = colorMetrics({ r: data[offset], g: data[offset + 1], b: data[offset + 2] });
    let keyIndex = 0;
    let distance = Infinity;
    for (let recordIndex = 0; recordIndex < keyRecords.length; recordIndex += 1) {
      const record = keyRecords[recordIndex];
      if (!regionAllows(record.region, x, y)) continue;
      const candidateDistance = colorDistance(pixel, record.metrics, luminanceWeight);
      if (candidateDistance < distance) {
        distance = candidateDistance;
        keyIndex = recordIndex;
      }
    }
    distanceMap[index] = distance;
    keyIndexMap[index] = keyIndex;
    return { distance, keyIndex, eligible: distance <= traversalThreshold };
  };

  const enqueue = (index) => {
    if (mask[index]) return;
    const analysis = analyze(index);
    if (!analysis.eligible) return;
    mask[index] = 1;
    queue[tail++] = index;
  };

  for (let x = 0; x < width; x += 1) {
    enqueue(x);
    enqueue(((height - 1) * width) + x);
  }
  for (let y = 1; y < height - 1; y += 1) {
    enqueue(y * width);
    enqueue((y * width) + width - 1);
  }

  // A manually picked pixel is an explicit background seed. This lets users
  // clean isolated cell backgrounds that do not connect to the outer sheet edge.
  const seedPoints = Array.isArray(options.seedPoints) ? options.seedPoints : [];
  for (const point of seedPoints) {
    const x = Math.max(0, Math.min(width - 1, Math.round(Number(point?.x) || 0)));
    const y = Math.max(0, Math.min(height - 1, Math.round(Number(point?.y) || 0)));
    enqueue((y * width) + x);
  }

  // Manual chroma picks behave like Video → Sprite: the sampled color is
  // matched across every frame, while an optional region still limits where
  // alpha may change (for example, the lower half of each sprite cell).
  const hasGlobalMatches = keyRecords.some((record) => record.region?.matchMode === 'global');
  if (hasGlobalMatches) {
    for (let index = 0; index < mask.length; index += 1) {
      if (mask[index] || data[(index * 4) + 3] === 0) continue;
      const x = index % width;
      const y = Math.floor(index / width);
      const pixel = colorMetrics({
        r: data[index * 4],
        g: data[(index * 4) + 1],
        b: data[(index * 4) + 2]
      });
      let nearestIndex = 0;
      let nearestDistance = Infinity;
      for (let recordIndex = 0; recordIndex < keyRecords.length; recordIndex += 1) {
        const record = keyRecords[recordIndex];
        if (record.region?.matchMode !== 'global' || !regionAllows(record.region, x, y)) continue;
        const candidateDistance = colorDistance(pixel, record.metrics, luminanceWeight);
        if (candidateDistance < nearestDistance) {
          nearestDistance = candidateDistance;
          nearestIndex = recordIndex;
        }
      }
      if (nearestDistance <= traversalThreshold) {
        mask[index] = 1;
        distanceMap[index] = nearestDistance;
        keyIndexMap[index] = nearestIndex;
        queue[tail++] = index;
      }
    }
  }

  while (head < tail) {
    const index = queue[head++];
    const x = index % width;
    const y = Math.floor(index / width);
    for (let ny = Math.max(0, y - 1); ny <= Math.min(height - 1, y + 1); ny += 1) {
      for (let nx = Math.max(0, x - 1); nx <= Math.min(width - 1, x + 1); nx += 1) {
        if (nx === x && ny === y) continue;
        enqueue((ny * width) + nx);
      }
    }
  }

  const cleanupMask = cleanupRadius ? dilateMask(mask, width, height, cleanupRadius) : mask;
  let removedPixels = 0;
  for (let index = 0; index < mask.length; index += 1) {
    const offset = index * 4;
    const sourceAlpha = data[offset + 3];
    if (sourceAlpha === 0) continue;
    if (cleanupMask[index] && !mask[index]) {
      const x = index % width;
      const y = Math.floor(index / width);
      if (!hasAllowedKey(x, y)) continue;
      data[offset + 3] = 0;
      removedPixels += 1;
      continue;
    }
    if (!mask[index]) continue;

    const distance = distanceMap[index];
    const foregroundMatte = smootherstep(transparentThreshold, transparentThreshold + featherWidth, distance);
    data[offset + 3] = Math.round(sourceAlpha * foregroundMatte);
    if (data[offset + 3] < sourceAlpha) removedPixels += 1;

    if (!preserveColors && spill > 0 && foregroundMatte > 0) {
      const pixel = colorMetrics({ r: data[offset], g: data[offset + 1], b: data[offset + 2] });
      const proximity = 1 - smootherstep(transparentThreshold, traversalThreshold + 0.08, distance);
      suppressSpill(data, offset, pixel, keyRecords[keyIndexMap[index]].metrics, spill * proximity * (1 - (subjectProtection * 0.45)));
    }
  }

  return { imageData, keyColors, removedPixels };
}

function copyRegion(source, x0, y0, width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sourceStart = (((y0 + y) * source.width) + x0) * 4;
    data.set(source.data.subarray(sourceStart, sourceStart + (width * 4)), y * width * 4);
  }
  return { width, height, data };
}

function pasteRegion(target, source, x0, y0) {
  for (let y = 0; y < source.height; y += 1) {
    const targetStart = (((y0 + y) * target.width) + x0) * 4;
    target.data.set(source.data.subarray(y * source.width * 4, (y + 1) * source.width * 4), targetStart);
  }
}

function processSpriteSheet(imageData, options = {}) {
  const rows = Math.max(1, Math.min(100, Math.round(options.rows || 1)));
  const cols = Math.max(1, Math.min(100, Math.round(options.cols || 1)));
  if (!options.perCell || (rows === 1 && cols === 1)) {
    return removeConnectedBackground(imageData, options);
  }

  const allColors = [];
  let removedPixels = 0;
  for (let row = 0; row < rows; row += 1) {
    const y0 = Math.floor((row * imageData.height) / rows);
    const y1 = Math.floor(((row + 1) * imageData.height) / rows);
    for (let col = 0; col < cols; col += 1) {
      const x0 = Math.floor((col * imageData.width) / cols);
      const x1 = Math.floor(((col + 1) * imageData.width) / cols);
      const region = copyRegion(imageData, x0, y0, x1 - x0, y1 - y0);
      const seedPoints = (Array.isArray(options.seedPoints) ? options.seedPoints : [])
        .filter((point) => point.x >= x0 && point.x < x1 && point.y >= y0 && point.y < y1)
        .map((point) => ({ x: point.x - x0, y: point.y - y0 }));
      const result = removeConnectedBackground(region, {
        ...options,
        seedPoints,
        sheetWidth: imageData.width,
        sheetHeight: imageData.height,
        offsetX: x0,
        offsetY: y0
      });
      pasteRegion(imageData, result.imageData, x0, y0);
      removedPixels += result.removedPixels;
      for (const color of result.keyColors) {
        if (!allColors.some((item) => Math.abs(item.r - color.r) + Math.abs(item.g - color.g) + Math.abs(item.b - color.b) < 18)) {
          allColors.push(color);
        }
      }
    }
  }
  return { imageData, keyColors: allColors.slice(0, 12), removedPixels };
}

export { detectEdgeColors, processSpriteSheet, removeConnectedBackground };
