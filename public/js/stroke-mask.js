/**
 * Freehand stroke rasterizer shared by every painted mask in the app.
 *
 * A "mask" here is one byte per pixel, 0..255, produced by stamping a soft
 * radial brush along each stroke's polyline. What the byte *means* is the
 * caller's business:
 *   - Subject Protect Brush reads it as "keep the source alpha here".
 *   - Erase Brush reads it as "drive the alpha to zero here".
 *
 * The two modes are therefore named for what they do to the mask, not for what
 * the mask does to the image:
 *   - `add`      paints into the mask (`source-over`)
 *   - `subtract` rubs the mask back out (`destination-out`)
 *
 * Legacy protection strokes persisted in localStorage used `protect`/`erase`
 * for exactly this pair, so those two names are still accepted on read and
 * normalized to `add`/`subtract`. Note that `erase` means SUBTRACT — the Erase
 * Brush's painting mode is `add`, because it adds to the erase mask.
 *
 * A stroke may also be bound to a single sprite frame (`frame`, plus the
 * `frameTime` it was painted at so the binding survives a change in frame
 * count). `null` means the stroke belongs to every frame, which is what every
 * stroke painted on the source video is and what every stroke saved before the
 * per-cell eraser existed becomes on read. The rasterizer ignores both fields —
 * deciding which strokes a given frame gets is `erase-frames.js`'s job — but
 * they have to survive normalization or they would be dropped on every save.
 */

const clamp01 = (value) => Math.min(1, Math.max(0, Number(value) || 0));

// `erase` is the legacy spelling of `subtract` (Subject Protect Brush's rubber).
const SUBTRACTIVE_MODES = new Set(['subtract', 'erase']);

function normalizePoint(point) {
  if (!point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) return null;
  return { x: clamp01(point.x), y: clamp01(point.y) };
}

// `Number(null)` is 0, not NaN, so an absent binding has to be rejected before
// the numeric check or every global stroke would come back bound to frame 0.
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

function normalizeStroke(stroke) {
  if (!stroke || !Array.isArray(stroke.points)) return null;
  const points = stroke.points.map(normalizePoint).filter(Boolean).slice(-5000);
  if (points.length === 0) return null;
  const frame = normalizeFrameIndex(stroke.frame);
  return {
    mode: SUBTRACTIVE_MODES.has(stroke.mode) ? 'subtract' : 'add',
    points,
    size: Math.max(1, Math.min(2000, Number(stroke.size) || 80)),
    strength: clamp01(stroke.strength ?? 0.8),
    hardness: clamp01(stroke.hardness ?? 0.55),
    frame,
    // Only meaningful next to a frame index; carrying it on a global stroke
    // would invite code to read it as a binding that is not there.
    frameTime: frame === null ? null : normalizeFrameTime(stroke.frameTime)
  };
}

function normalizeStrokes(strokes) {
  if (!Array.isArray(strokes)) return [];
  return strokes.map(normalizeStroke).filter(Boolean).slice(-500);
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

/**
 * Rasterizes `strokes` (normalized 0..1 source coordinates) into `targetWidth`
 * x `targetHeight`, mapping through the crop window so a mask painted on the
 * full video lands correctly inside a cropped sprite cell.
 *
 * @returns {{ canvas: HTMLCanvasElement, mask: Uint8ClampedArray }}
 */
function rasterizeStrokeMask(strokes, options = {}) {
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

  const normalized = normalizeStrokes(strokes);
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
    ctx.globalCompositeOperation = stroke.mode === 'subtract' ? 'destination-out' : 'source-over';

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

export { normalizeStroke, normalizeStrokes, rasterizeStrokeMask };
