const clamp01 = (value) => Math.min(1, Math.max(0, Number(value) || 0));

function normalizePoint(point) {
  if (!point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) return null;
  return { x: clamp01(point.x), y: clamp01(point.y) };
}

function normalizeProtectionStroke(stroke) {
  if (!stroke || !Array.isArray(stroke.points)) return null;
  const points = stroke.points.map(normalizePoint).filter(Boolean).slice(-5000);
  if (points.length === 0) return null;
  return {
    mode: stroke.mode === 'erase' ? 'erase' : 'protect',
    points,
    size: Math.max(1, Math.min(2000, Number(stroke.size) || 80)),
    strength: clamp01(stroke.strength ?? 0.8),
    hardness: clamp01(stroke.hardness ?? 0.55)
  };
}

function normalizeProtectionStrokes(strokes) {
  if (!Array.isArray(strokes)) return [];
  return strokes.map(normalizeProtectionStroke).filter(Boolean).slice(-500);
}

function createBrushStamp(radius, hardness, strength, color, canvasFactory) {
  const diameter = Math.max(2, Math.ceil(radius * 2) + 2);
  const canvas = canvasFactory();
  canvas.width = diameter;
  canvas.height = diameter;
  const ctx = canvas.getContext('2d');
  const center = diameter / 2;
  const innerRadius = Math.max(0, radius * clamp01(hardness));
  const gradient = ctx.createRadialGradient(center, center, innerRadius, center, center, Math.max(innerRadius + 0.01, radius));
  gradient.addColorStop(0, color.replace('{alpha}', String(clamp01(strength))));
  gradient.addColorStop(1, color.replace('{alpha}', '0'));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, diameter, diameter);
  return canvas;
}

function rasterizeProtectionMask(strokes, options = {}) {
  const targetWidth = Math.max(1, Math.round(Number(options.targetWidth) || 1));
  const targetHeight = Math.max(1, Math.round(Number(options.targetHeight) || 1));
  const sourceWidth = Math.max(1, Number(options.sourceWidth) || targetWidth);
  const sourceHeight = Math.max(1, Number(options.sourceHeight) || targetHeight);
  const cropX = Math.max(0, Number(options.cropX) || 0);
  const cropY = Math.max(0, Number(options.cropY) || 0);
  const cropWidth = Math.max(1, Number(options.cropWidth) || sourceWidth);
  const cropHeight = Math.max(1, Number(options.cropHeight) || sourceHeight);
  const canvasFactory = options.canvasFactory || (() => document.createElement('canvas'));
  const canvas = options.canvas || canvasFactory();
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, targetWidth, targetHeight);

  const normalized = normalizeProtectionStrokes(strokes);
  const scaleX = targetWidth / cropWidth;
  const scaleY = targetHeight / cropHeight;
  const sizeScale = (scaleX + scaleY) / 2;
  const color = options.color || 'rgba(0,0,0,{alpha})';

  const mapPoint = (point) => ({
    x: ((point.x * sourceWidth) - cropX) * scaleX,
    y: ((point.y * sourceHeight) - cropY) * scaleY
  });

  for (const stroke of normalized) {
    if (stroke.strength <= 0) continue;
    const radius = Math.max(0.75, (stroke.size * sizeScale) / 2);
    const stamp = createBrushStamp(radius, stroke.hardness, stroke.strength, color, canvasFactory);
    const halfW = stamp.width / 2;
    const halfH = stamp.height / 2;
    const spacing = Math.max(0.75, radius * 0.22);
    ctx.globalCompositeOperation = stroke.mode === 'erase' ? 'destination-out' : 'source-over';

    let previous = mapPoint(stroke.points[0]);
    ctx.drawImage(stamp, previous.x - halfW, previous.y - halfH);
    for (let index = 1; index < stroke.points.length; index += 1) {
      const current = mapPoint(stroke.points[index]);
      const dx = current.x - previous.x;
      const dy = current.y - previous.y;
      const distance = Math.hypot(dx, dy);
      const steps = Math.max(1, Math.ceil(distance / spacing));
      for (let step = 1; step <= steps; step += 1) {
        const t = step / steps;
        ctx.drawImage(stamp, previous.x + (dx * t) - halfW, previous.y + (dy * t) - halfH);
      }
      previous = current;
    }
  }
  ctx.globalCompositeOperation = 'source-over';

  const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);
  const mask = new Uint8ClampedArray(targetWidth * targetHeight);
  for (let index = 0; index < mask.length; index += 1) {
    mask[index] = imageData.data[(index * 4) + 3];
  }
  return { canvas, mask };
}

export { normalizeProtectionStroke, normalizeProtectionStrokes, rasterizeProtectionMask };
