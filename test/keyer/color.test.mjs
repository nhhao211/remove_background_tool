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

import test from 'node:test';
import assert from 'node:assert/strict';

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

function assertCloseTo(actual, expected, epsilon, msg) {
  assert.ok(Math.abs(actual - expected) < epsilon, msg || `${actual} ≈ ${expected} ±${epsilon}`);
}

await test('sRGB <-> linear LUTs', async (t) => {
  await t.test('SRGB_TO_LINEAR matches the transfer function at every 8-bit input', () => {
    assert.equal(SRGB_TO_LINEAR.length, 256);
    for (let i = 0; i < 256; i += 1) {
      assertCloseTo(SRGB_TO_LINEAR[i], srgbToLinearExact(i / 255), 1e-6,
        `SRGB_TO_LINEAR[${i}] correct`);
    }
  });

  await t.test('anchors at both ends', () => {
    assert.equal(SRGB_TO_LINEAR[0], 0);
    assertCloseTo(SRGB_TO_LINEAR[255], 1, 1e-6);
    assert.equal(linearToSrgb8(0), 0);
    assert.equal(linearToSrgb8(1), 255);
  });

  await t.test('round trips exactly for all 256 8-bit values', () => {
    const broken = [];
    for (let i = 0; i < 256; i += 1) {
      const back = linearToSrgb8(SRGB_TO_LINEAR[i]);
      if (back !== i) broken.push(`${i} -> ${back}`);
    }
    assert.deepEqual(broken, [], `round trip is not exact for: ${broken.join(', ')}`);
  });

  await t.test('clamps outside 0..1 rather than indexing past the table', () => {
    // Phase 7's unpremultiply can produce these; an out-of-bounds read would
    // yield NaN and poison the frame silently.
    assert.equal(linearToSrgb8(-0.5), 0);
    assert.equal(linearToSrgb8(1.5), 255);
    assert.ok(Number.isFinite(linearToSrgb8(1 - 1e-9)));
  });
});

await test('float buffer conversion', async (t) => {
  await t.test('carries 8-bit RGBA through linear and back unchanged', () => {
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

    assert.deepEqual(Array.from(back.data), Array.from(data));
  });

  await t.test('keeps alpha linear and unpremultiplied', () => {
    const data = new Uint8ClampedArray([200, 100, 50, 8]);
    const buffer = toLinearBuffer({ data, width: 1, height: 1 });
    // Alpha is not gamma encoded: 8/255 stays 8/255, and RGB is untouched by it.
    assertCloseTo(buffer.a[0], 8 / 255, 1e-6);
    assertCloseTo(buffer.r[0], SRGB_TO_LINEAR[200], 1e-6);
    assert.equal(toSrgbImageData(buffer).data[3], 8);
  });
});

await test('YCbCr with normalised axes', async (t) => {
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

  await t.test('uses BT.709 luma', () => {
    const buffer = makeBuffer([[0.25, 0.5, 0.75]]);
    const { y } = rgbToYCbCr(buffer);
    assertCloseTo(y[0], (0.2126 * 0.25) + (0.7152 * 0.5) + (0.0722 * 0.75), 1e-6);
  });

  await t.test('normalises the chroma axes by 0.564 and 0.713', () => {
    const buffer = makeBuffer([[0.25, 0.5, 0.75]]);
    const { y, cb, cr } = rgbToYCbCr(buffer);
    assertCloseTo(cb[0], (0.75 - y[0]) * 0.564, 1e-6);
    assertCloseTo(cr[0], (0.25 - y[0]) * 0.713, 1e-6);
  });

  await t.test('round trips back to the original linear RGB', () => {
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
      assertCloseTo(target.r[i], r, 1e-5, `pixel ${i} red`);
      assertCloseTo(target.g[i], g, 1e-5, `pixel ${i} green`);
      assertCloseTo(target.b[i], b, 1e-5, `pixel ${i} blue`);
    });
  });
});

await test('separable box blur', async (t) => {
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

  await t.test('matches the naive implementation at radius 1 and 2', () => {
    for (const radius of [1, 2]) {
      const width = 9;
      const height = 7;
      const source = seeded(width, height);
      const actual = Float32Array.from(source);
      boxBlurSeparable(actual, width, height, radius);
      const expected = naiveBlur(source, width, height, radius);

      for (let i = 0; i < expected.length; i += 1) {
        assertCloseTo(actual[i], expected[i], 1e-5, `radius ${radius}, index ${i}`);
      }
    }
  });

  await t.test('leaves the channel untouched at radius 0', () => {
    const source = seeded(5, 5);
    const actual = Float32Array.from(source);
    boxBlurSeparable(actual, 5, 5, 0);
    assert.deepEqual(Array.from(actual), Array.from(source));
  });

  await t.test('stays finite when the radius exceeds the image', () => {
    // The internal radius cap is derived from the image size. If that cap is
    // ever fractional, the sliding window indexes at a non-integer offset,
    // reads `undefined`, and turns the whole channel into NaN.
    const width = 5;
    const height = 5;
    const actual = seeded(width, height);
    boxBlurSeparable(actual, width, height, 3);
    for (let i = 0; i < actual.length; i += 1) {
      assert.ok(Number.isFinite(actual[i]), `index ${i} is not finite`);
    }
  });
});
