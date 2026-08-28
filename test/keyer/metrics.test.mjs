/**
 * The metrics gate every later phase, so they need their own gate. Two of them
 * are here specifically because an earlier draft of this harness shipped scores
 * that a uniformly half-transparent frame maximised — a metric that rewards
 * softening would have flagged correct edge work as a regression.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { ImageData, fillRect, fillCircle } from './image.mjs';
import {
  alphaSAD,
  coreRGBDelta,
  fringeContrast,
  bandSAD,
  composite,
  bilinearHaloCheck
} from './metrics.mjs';

function solid(width, height, [r, g, b, a]) {
  const image = new ImageData(width, height);
  for (let offset = 0; offset < image.data.length; offset += 4) {
    image.data[offset] = r;
    image.data[offset + 1] = g;
    image.data[offset + 2] = b;
    image.data[offset + 3] = a;
  }
  return image;
}

function assertCloseTo(actual, expected, epsilon, msg) {
  assert.ok(Math.abs(actual - expected) < epsilon, msg || `${actual} ≈ ${expected} ±${epsilon}`);
}

await test('alphaSAD', async (t) => {
  await t.test('is zero for identical buffers', () => {
    const a = solid(8, 8, [10, 20, 30, 128]);
    const b = solid(8, 8, [90, 90, 90, 128]);
    assert.equal(alphaSAD(a.data, b.data), 0);
  });

  await t.test('counts only alpha, and counts every differing pixel', () => {
    const a = solid(4, 4, [0, 0, 0, 200]);
    const b = solid(4, 4, [0, 0, 0, 190]);
    assert.equal(alphaSAD(a.data, b.data), 16 * 10);
  });

  await t.test('is infinite for mismatched sizes rather than silently passing', () => {
    assert.equal(alphaSAD(solid(4, 4, [0, 0, 0, 0]).data, solid(8, 8, [0, 0, 0, 0]).data), Infinity);
  });
});

await test('coreRGBDelta', async (t) => {
  await t.test('ignores pixels that are not opaque in both buffers', () => {
    const a = solid(4, 4, [200, 200, 200, 255]);
    const b = solid(4, 4, [0, 0, 0, 254]);
    assert.equal(coreRGBDelta(a.data, b.data), 0);
  });

  await t.test('averages per channel over opaque pixels', () => {
    const a = solid(4, 4, [100, 100, 100, 255]);
    const b = solid(4, 4, [90, 100, 110, 255]);
    assertCloseTo(coreRGBDelta(a.data, b.data), (10 + 0 + 10) / 3, 10);
  });
});

await test('composite', async (t) => {
  await t.test('blends arithmetically without a premultiplied round trip', () => {
    const image = solid(2, 2, [255, 0, 0, 128]);
    const out = composite(image, [0, 0, 255]);
    const alpha = 128 / 255;
    assert.equal(out[0], Math.round(255 * alpha));
    assert.equal(out[2], Math.round(255 * (1 - alpha)));
    assert.equal(out[3], 255);
  });

  await t.test('preserves colour at very low alpha, where a canvas would quantise it away', () => {
    const image = solid(2, 2, [255, 128, 64, 1]);
    const out = composite(image, [0, 0, 0]);
    // 255 * 1/255 == 1: the channel survives. A premultiplied canvas hop would
    // round this to 0 and lose the edge colour entirely.
    assert.equal(out[0], 1);
  });
});

await test('fringeContrast', async (t) => {
  await t.test('is zero when the edge matches the interior', () => {
    const image = new ImageData(32, 32);
    fillRect(image, 0, 0, 32, 32, [0, 0, 0]);
    for (let offset = 3; offset < image.data.length; offset += 4) image.data[offset] = 0;
    // Opaque interior block with a one-pixel half-transparent border of the
    // same colour.
    for (let y = 8; y < 24; y += 1) {
      for (let x = 8; x < 24; x += 1) {
        const offset = ((y * 32) + x) * 4;
        image.data[offset] = 200;
        image.data[offset + 1] = 200;
        image.data[offset + 2] = 200;
        const border = x === 8 || x === 23 || y === 8 || y === 23;
        image.data[offset + 3] = border ? 128 : 255;
      }
    }
    assertCloseTo(fringeContrast(image), 0, 1e-6);
  });

  await t.test('reports a negative value for a dark rim and a positive one for a light rim', () => {
    const build = (rimLuma) => {
      const image = new ImageData(32, 32);
      for (let y = 8; y < 24; y += 1) {
        for (let x = 8; x < 24; x += 1) {
          const offset = ((y * 32) + x) * 4;
          const border = x === 8 || x === 23 || y === 8 || y === 23;
          const value = border ? rimLuma : 200;
          image.data[offset] = value;
          image.data[offset + 1] = value;
          image.data[offset + 2] = value;
          image.data[offset + 3] = border ? 128 : 255;
        }
      }
      return image;
    };
    assert.ok(fringeContrast(build(40)) < -100, 'dark rim must be negative');
    assert.ok(fringeContrast(build(255)) > 30, 'light rim must be positive');
  });

  await t.test('is not maximised by a uniformly half-transparent frame', () => {
    // No pixel has an opaque neighbour, so there is nothing to compare against
    // and the score stays at zero instead of rewarding blanket softening.
    assert.equal(fringeContrast(solid(16, 16, [128, 128, 128, 128])), 0);
  });
});

await test('bandSAD', async (t) => {
  await t.test('scores only where the ground truth is genuinely partial', () => {
    const truth = new Uint8ClampedArray(4 * 4 * 4);
    const current = new Uint8ClampedArray(4 * 4 * 4);
    for (let pixel = 0; pixel < 16; pixel += 1) {
      const offset = (pixel * 4) + 3;
      truth[offset] = pixel < 4 ? 128 : 255;
      current[offset] = pixel < 4 ? 148 : 0;
    }
    // The eight fully opaque truth pixels are ignored even though they differ
    // by 255; only the four soft ones count, at 20 each.
    assert.equal(bandSAD(current, truth), 20);
  });

  await t.test('rewards a crisper matte that matches a crisp truth', () => {
    const truth = new Uint8ClampedArray(8 * 4);
    const soft = new Uint8ClampedArray(8 * 4);
    const crisp = new Uint8ClampedArray(8 * 4);
    for (let pixel = 0; pixel < 8; pixel += 1) {
      const offset = (pixel * 4) + 3;
      truth[offset] = 40;
      soft[offset] = 128;
      crisp[offset] = 48;
    }
    assert.ok(bandSAD(crisp, truth) < bandSAD(soft, truth),
      'crisper must score better than soft');
  });
});

await test('bilinearHaloCheck', async (t) => {
  await t.test('exposes a rim that only appears once the matte is filtered', () => {
    // Opaque white disc on transparent black. At native size there is no
    // partial alpha at all, so fringeContrast sees nothing.
    const image = new ImageData(24, 24);
    fillCircle(image, 12, 12, 7, [255, 255, 255]);
    for (let offset = 0; offset < image.data.length; offset += 4) {
      const inside = image.data[offset] > 200;
      image.data[offset + 3] = inside ? 255 : 0;
      if (!inside) {
        image.data[offset] = 0;
        image.data[offset + 1] = 0;
        image.data[offset + 2] = 0;
      }
    }
    assert.equal(fringeContrast(image), 0);
    // Upsampling mixes the black, zero-alpha surround into the edge, which is
    // the grey rim users report. The signed score must be clearly negative.
    assert.ok(bilinearHaloCheck(image) < -20, 'halo must be clearly negative');
  });
});
