/**
 * Colour primitives shared by both keying paths.
 *
 * Every function here was byte-identical in chroma-key.js and
 * background-removal.js before the merge, so deduplicating them cannot change
 * behaviour. Anything that differed between the two files stayed where it was.
 *
 * Phase 3: Linear light and premultiply-safe composition.
 * - Added LUTs for sRGB↔linear conversion
 * - Added buffer structure and conversion functions
 * - All keying maths now operates on linear Float32Array
 */

export const clamp01 = (value) => Math.min(1, Math.max(0, Number(value) || 0));

export function smootherstep(edge0, edge1, value) {
  if (edge1 <= edge0) return value < edge0 ? 0 : 1;
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * sRGB → linear lookup table.
 * Input is 8-bit (0–255), output is linear 0–1.
 * Exact: for each i, SRGB_TO_LINEAR[i] = sRgbToLinear(i/255).
 */
export const SRGB_TO_LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  SRGB_TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * Linear → sRGB lookup table with interpolation.
 * Stores the encoded sRGB value (0–255) at 4096 intervals.
 * linearToSrgb8() interpolates between entries.
 */
const LINEAR_TO_SRGB_LUT = new Float32Array(4097);
for (let i = 0; i <= 4096; i++) {
  const x = i / 4096;
  const s = x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
  LINEAR_TO_SRGB_LUT[i] = s * 255;
}

/**
 * Convert a linear-light value (0–1) to 8-bit sRGB.
 * Uses LUT with linear interpolation between entries.
 * Values outside 0–1 clamp; phase 7's unpremultiply can produce them.
 */
export function linearToSrgb8(x) {
  if (x <= 0) return 0;
  if (x >= 1) return 255;
  const f = x * 4096;
  const i = f | 0;
  const t = f - i;
  return (LINEAR_TO_SRGB_LUT[i] * (1 - t) + LINEAR_TO_SRGB_LUT[i + 1] * t + 0.5) | 0;
}

/**
 * Convert ImageData (8-bit sRGB, unpremultiplied) to a float buffer in linear light.
 * Returns { r, g, b, a, width, height } where each channel is Float32Array(width*height).
 */
export function toLinearBuffer(imageData) {
  const { data, width, height } = imageData;
  const r = new Float32Array(width * height);
  const g = new Float32Array(width * height);
  const b = new Float32Array(width * height);
  const a = new Float32Array(width * height);

  for (let i = 0; i < data.length; i += 4) {
    const index = (i / 4) | 0;
    r[index] = SRGB_TO_LINEAR[data[i]];
    g[index] = SRGB_TO_LINEAR[data[i + 1]];
    b[index] = SRGB_TO_LINEAR[data[i + 2]];
    a[index] = data[i + 3] / 255;
  }

  return { r, g, b, a, width, height };
}

/**
 * Convert linear-light float buffer back to ImageData (8-bit sRGB, unpremultiplied).
 * The buffer should be the final result after all keying/compositing.
 * Works in both browser and Node environments.
 */
export function toSrgbImageData(buffer) {
  const { r, g, b, a, width, height } = buffer;
  const data = new Uint8ClampedArray(width * height * 4);

  for (let i = 0; i < width * height; i++) {
    const dataIndex = i * 4;
    data[dataIndex] = linearToSrgb8(r[i]);
    data[dataIndex + 1] = linearToSrgb8(g[i]);
    data[dataIndex + 2] = linearToSrgb8(b[i]);
    data[dataIndex + 3] = Math.round(a[i] * 255);
  }

  // Try to create ImageData if available (browser), otherwise return a compatible object
  try {
    return new ImageData(data, width, height);
  } catch (_) {
    // Fallback for Node environments (tests)
    return { data, width, height };
  }
}

export function colorMetrics(color) {
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;
  const y = (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
  return { r, g, b, y, cb: b - y, cr: r - y };
}

/**
 * Compute colour metrics from linear RGB (0–1).
 * Used for keying on the float buffer path.
 */
export function colorMetricsLinear(r, g, b) {
  const y = (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
  return { r, g, b, y, cb: b - y, cr: r - y };
}

/**
 * Chroma carries most of the keying decision. Subject protection increases
 * luminance separation so similarly hued foreground detail is less likely to be
 * mistaken for a differently lit backdrop.
 *
 * This was `keyDistance` on the video path and `colorDistance` on the sheet
 * path with identical bodies. The 0.35 default comes from the sheet path; the
 * video path always passed the weight explicitly, so the default is unreachable
 * from there and merging the two is safe.
 *
 * Note the axes are unnormalised (`cb = b - y`, `cr = r - y`) rather than scaled
 * by 0.564 / 0.713. That makes the tolerance region an ellipse rather than a
 * circle. It is preserved here deliberately — correcting it is phase 3's job,
 * with the harness watching.
 */
export function keyDistance(pixel, key, luminanceWeight = 0.35) {
  const dCb = pixel.cb - key.cb;
  const dCr = pixel.cr - key.cr;
  const dY = pixel.y - key.y;
  return Math.sqrt((dCb * dCb) + (dCr * dCr) + (luminanceWeight * dY * dY));
}

export function normalizeColor(color) {
  const r = Math.round(Math.min(255, Math.max(0, Number(color?.r) || 0)));
  const g = Math.round(Math.min(255, Math.max(0, Number(color?.g) || 0)));
  const b = Math.round(Math.min(255, Math.max(0, Number(color?.b) || 0)));
  return { r, g, b, hex: `#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('')}` };
}

/**
 * Convert linear RGB to YCbCr with normalised chroma axes.
 * Returns { y, cb, cr } arrays (Float32Array).
 * Cb and Cr are scaled by 0.564 and 0.713 respectively for circular tolerance region.
 */
export function rgbToYCbCr(buffer) {
  const { r, g, b, width, height } = buffer;
  const pixelCount = width * height;
  const y = new Float32Array(pixelCount);
  const cb = new Float32Array(pixelCount);
  const cr = new Float32Array(pixelCount);

  for (let i = 0; i < pixelCount; i++) {
    // Compute luma (BT.709 linear)
    const yi = (0.2126 * r[i]) + (0.7152 * g[i]) + (0.0722 * b[i]);
    y[i] = yi;
    
    // Compute unnormalised chroma
    const cbi = b[i] - yi;
    const cri = r[i] - yi;
    
    // Normalise axes (phase 4: scales to circular tolerance region)
    cb[i] = cbi * 0.564;
    cr[i] = cri * 0.713;
  }

  return { y, cb, cr, width, height };
}

/**
 * Convert YCbCr back to linear RGB.
 *
 * The inverse must undo the same primaries the forward transform used. The
 * forward is BT.709 (`y = 0.2126r + 0.7152g + 0.0722b`, `cb = b - y`,
 * `cr = r - y`), so given denormalised chroma:
 *
 *   b = y + cb
 *   r = y + cr
 *   g = (y - 0.2126r - 0.0722b) / 0.7152
 *
 * An earlier version derived green with BT.601 coefficients (0.299/0.587/0.114)
 * against this BT.709 forward, which left green ~0.019 high on a mid-grey pixel
 * — a colour cast on every frame that passed through phase 4.
 */
export function yCbCrToRgb(ycbcr, targetBuffer) {
  const { y, cb, cr, width, height } = ycbcr;
  const pixelCount = width * height;

  // Denormalise chroma
  for (let i = 0; i < pixelCount; i++) {
    const cbi = cb[i] / 0.564;
    const cri = cr[i] / 0.713;
    const yi = y[i];
    const b = yi + cbi;
    const r = yi + cri;
    targetBuffer.r[i] = clamp01(r);
    targetBuffer.g[i] = clamp01((yi - (0.2126 * r) - (0.0722 * b)) / 0.7152);
    targetBuffer.b[i] = clamp01(b);
  }
}

/**
 * Separable box blur with sliding-window accumulator.
 * Modifies the channel in place.
 * O(N) time complexity, 2 passes (horizontal + vertical).
 */
export function boxBlurSeparable(channel, width, height, radius) {
  if (radius <= 0) return;

  // The cap must stay an integer: the sliding window indexes at `x - r - 1`, so
  // a fractional radius reads a non-integer offset, gets `undefined`, and turns
  // the whole channel into NaN.
  const r = Math.min(Math.floor(radius), Math.floor(Math.max(width, height) / 2));
  if (r <= 0) return;
  const out = new Float32Array(channel.length);

  // Horizontal pass
  for (let y = 0; y < height; y++) {
    let sum = 0;
    let count = 0;

    // Accumulate left edge
    for (let x = 0; x <= r && x < width; x++) {
      sum += channel[y * width + x];
      count++;
    }
    out[y * width + 0] = sum / count;

    // Sliding window across row
    for (let x = 1; x < width; x++) {
      // Remove left pixel that fell out of window
      if (x > r) {
        sum -= channel[y * width + (x - r - 1)];
        count--;
      }
      // Add right pixel entering window
      if (x + r < width) {
        sum += channel[y * width + (x + r)];
        count++;
      }
      out[y * width + x] = sum / count;
    }
  }

  // Vertical pass
  for (let x = 0; x < width; x++) {
    let sum = 0;
    let count = 0;

    // Accumulate top edge
    for (let y = 0; y <= r && y < height; y++) {
      sum += out[y * width + x];
      count++;
    }
    channel[0 * width + x] = sum / count;

    // Sliding window down column
    for (let y = 1; y < height; y++) {
      // Remove top pixel that fell out of window
      if (y > r) {
        sum -= out[(y - r - 1) * width + x];
        count--;
      }
      // Add bottom pixel entering window
      if (y + r < height) {
        sum += out[(y + r) * width + x];
        count++;
      }
      channel[y * width + x] = sum / count;
    }
  }
}

/**
 * Chroma-smoothed *copy* of a linear RGB buffer, for 4:2:0 sources (phase 4).
 *
 * Luma is left alone; only Cb/Cr are blurred, then the pair is converted back to
 * RGB. The result is a separate buffer — the input is never touched.
 *
 * That separation is the point of the phase, not an implementation detail. The
 * smoothed copy exists to steady the *keying decision* where 4:2:0 upsampling
 * put a ragged chroma edge; it must not reach the exported colour, or every
 * pixel carries the blur. An earlier version smoothed in place and handed the
 * same buffer to both the matte and the encoder, which collapsed exactly that.
 *
 * Alpha is shared by reference: the caller owns it and this function has no
 * business in it.
 */
export function chromaSmoothedCopy(buffer, radius) {
  const { r, g, b, a, width, height } = buffer;
  const copy = {
    r: Float32Array.from(r),
    g: Float32Array.from(g),
    b: Float32Array.from(b),
    a,
    width,
    height
  };
  if (radius <= 0) return copy;

  const ycbcr = rgbToYCbCr(buffer);
  boxBlurSeparable(ycbcr.cb, width, height, radius);
  boxBlurSeparable(ycbcr.cr, width, height, radius);
  yCbCrToRgb(ycbcr, copy);

  return copy;
}
