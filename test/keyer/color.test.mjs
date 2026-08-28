/**
 * Unit tests for the phase 3/4 colour primitives in `js/keyer/color.js`.
 *
 * Phase 3's first success criterion is that the sRGB round trip is *exact*:
 * `linearToSrgb8(SRGB_TO_LINEAR[i]) === i` for all 256 i, not merely bounded
 * error. Three delegated attempts reported this criterion as met without a test
 * existing anywhere in `tests/`, which is why it is pinned here first.
 *
 * These functions are pure and take no DOM, so they import straight into Node.
 */

import { describe, it, expect } from 'vitest';

import { JS_DIR } from './keyer-runner.mjs';

const color = await import(new URL(`file://${JS_DIR}/keyer/color.js`).href);

const {
  SRGB_TO_LINEAR,
  linearToSrgb8,
  toLinearBuffer,
  toSrgbImageData,
  rgbToYCbCr,
  yCbCrToRgb,
  boxBlurSeparable
} = color;

/** Reference sRGB transfer function, used to check the LUT is what it claims. */
function srgbToLinearExact(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

describe('sRGB <-> linear LUTs', () => {
  it('SRGB_TO_LINEAR matches the transfer function at every 8-bit input', () => {
    expect(SRGB_TO_LINEAR).toHaveLength(256);
    for (let i = 0; i < 256; i += 1) {
      expect(SRGB_TO_LINEAR[i]).toBeCloseTo(srgbToLinearExact(i / 255), 6);
    }
  });

  it('anchors at both ends', () => {
    expect(SRGB_TO_LINEAR[0]).toBe(0);
    expect(SRGB_TO_LINEAR[255]).toBeCloseTo(1, 6);
    expect(linearToSrgb8(0)).toBe(0);
    expect(linearToSrgb8(1)).toBe(255);
  });

  it('round trips exactly for all 256 8-bit values', () => {
    const broken = [];
    for (let i = 0; i < 256; i += 1) {
      const back = linearToSrgb8(SRGB_TO_LINEAR[i]);
      if (back !== i) broken.push(`${i} -> ${back}`);
    }
    expect(broken, `round trip is not exact for: ${broken.join(', ')}`).toEqual([]);
  });

  it('clamps outside 0..1 rather than indexing past the table', () => {
    // Phase 7's unpremultiply can produce these; an out-of-bounds read would
    // yield NaN and poison the frame silently.
    expect(linearToSrgb8(-0.5)).toBe(0);
    expect(linearToSrgb8(1.5)).toBe(255);
    expect(Number.isFinite(linearToSrgb8(1 - 1e-9))).toBe(true);
  });
});

describe('float buffer conversion', () => {
  it('carries 8-bit RGBA through linear and back unchanged', () => {
    const width = 16;
    const height = 16;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i += 1) {
      data[i * 4] = i % 256;
      data[i * 4 + 1] = (i * 7) % 256;
      data[i * 4 + 2] = (i * 13) % 256;
      data[i * 4 + 3] = (i * 3) % 256;
    }

    const buffer = toLinearBuffer({ data, width, height });
    const back = toSrgbImageData(buffer);

    expect(Array.from(back.data)).toEqual(Array.from(data));
  });

  it('keeps alpha linear and unpremultiplied', () => {
    const data = new Uint8ClampedArray([200, 100, 50, 8]);
    const buffer = toLinearBuffer({ data, width: 1, height: 1 });
    // Alpha is not gamma encoded: 8/255 stays 8/255, and RGB is untouched by it.
    expect(buffer.a[0]).toBeCloseTo(8 / 255, 6);
    expect(buffer.r[0]).toBeCloseTo(SRGB_TO_LINEAR[200], 6);
    expect(toSrgbImageData(buffer).data[3]).toBe(8);
  });
});

describe('YCbCr with normalised axes', () => {
  const makeBuffer = (pixels) => {
    const width = pixels.length;
    const buffer = {
      r: new Float32Array(width),
      g: new Float32Array(width),
      b: new Float32Array(width),
      a: new Float32Array(width).fill(1),
      width,
      height: 1
    };
    pixels.forEach(([r, g, b], i) => {
      buffer.r[i] = r;
      buffer.g[i] = g;
      buffer.b[i] = b;
    });
    return buffer;
  };

  it('uses BT.709 luma', () => {
    const buffer = makeBuffer([[0.25, 0.5, 0.75]]);
    const { y } = rgbToYCbCr(buffer);
    expect(y[0]).toBeCloseTo((0.2126 * 0.25) + (0.7152 * 0.5) + (0.0722 * 0.75), 6);
  });

  it('normalises the chroma axes by 0.564 and 0.713', () => {
    const buffer = makeBuffer([[0.25, 0.5, 0.75]]);
    const { y, cb, cr } = rgbToYCbCr(buffer);
    expect(cb[0]).toBeCloseTo((0.75 - y[0]) * 0.564, 6);
    expect(cr[0]).toBeCloseTo((0.25 - y[0]) * 0.713, 6);
  });

  it('round trips back to the original linear RGB', () => {
    // The inverse must undo the *same* primaries the forward transform used.
    // Mixing BT.601 coefficients into the inverse of a BT.709 forward shifts
    // green, which would land as a colour cast on every keyed frame in phase 4.
    const pixels = [
      [0.25, 0.5, 0.75],
      [0.0, 0.0, 0.0],
      [1.0, 1.0, 1.0],
      [0.9, 0.1, 0.35],
      [0.02, 0.78, 0.24]
    ];
    const buffer = makeBuffer(pixels);
    const ycbcr = rgbToYCbCr(buffer);
    const target = makeBuffer(pixels.map(() => [0, 0, 0]));
    yCbCrToRgb(ycbcr, target);

    pixels.forEach(([r, g, b], i) => {
      expect(target.r[i], `pixel ${i} red`).toBeCloseTo(r, 5);
      expect(target.g[i], `pixel ${i} green`).toBeCloseTo(g, 5);
      expect(target.b[i], `pixel ${i} blue`).toBeCloseTo(b, 5);
    });
  });
});

describe('separable box blur', () => {
  /** Naive two-pass reference, window clipped at the borders. */
  function naiveBlur(source, width, height, radius) {
    const horizontal = new Float32Array(source.length);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let sum = 0;
        let count = 0;
        for (let dx = -radius; dx <= radius; dx += 1) {
          const sx = x + dx;
          if (sx < 0 || sx >= width) continue;
          sum += source[y * width + sx];
          count += 1;
        }
        horizontal[y * width + x] = sum / count;
      }
    }

    const out = new Float32Array(source.length);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let sum = 0;
        let count = 0;
        for (let dy = -radius; dy <= radius; dy += 1) {
          const sy = y + dy;
          if (sy < 0 || sy >= height) continue;
          sum += horizontal[sy * width + x];
          count += 1;
        }
        out[y * width + x] = sum / count;
      }
    }
    return out;
  }

  const seeded = (width, height) => {
    const channel = new Float32Array(width * height);
    let seed = 12345;
    for (let i = 0; i < channel.length; i += 1) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      channel[i] = (seed % 1000) / 1000;
    }
    return channel;
  };

  it('matches the naive implementation at radius 1 and 2', () => {
    for (const radius of [1, 2]) {
      const width = 9;
      const height = 7;
      const source = seeded(width, height);
      const actual = Float32Array.from(source);
      boxBlurSeparable(actual, width, height, radius);
      const expected = naiveBlur(source, width, height, radius);

      for (let i = 0; i < expected.length; i += 1) {
        expect(actual[i], `radius ${radius}, index ${i}`).toBeCloseTo(expected[i], 5);
      }
    }
  });

  it('leaves the channel untouched at radius 0', () => {
    const source = seeded(5, 5);
    const actual = Float32Array.from(source);
    boxBlurSeparable(actual, 5, 5, 0);
    expect(Array.from(actual)).toEqual(Array.from(source));
  });

  it('stays finite when the radius exceeds the image', () => {
    // The internal radius cap is derived from the image size. If that cap is
    // ever fractional, the sliding window indexes at a non-integer offset,
    // reads `undefined`, and turns the whole channel into NaN.
    const width = 5;
    const height = 5;
    const actual = seeded(width, height);
    boxBlurSeparable(actual, width, height, 3);
    for (let i = 0; i < actual.length; i += 1) {
      expect(Number.isFinite(actual[i]), `index ${i} is not finite`).toBe(true);
    }
  });
});
