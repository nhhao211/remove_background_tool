import test from 'node:test';
import assert from 'node:assert/strict';

import { applySharpen, isSharpenIdentity, SHARPEN_DEFAULTS } from '../public/js/sharpen.js';

function surface(width, height, fill) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = ((y * width) + x) * 4;
      data.set(fill(x, y), o);
    }
  }
  return { data, width, height };
}

const at = (img, x, y) => [...img.data.subarray(((y * img.width) + x) * 4, (((y * img.width) + x) * 4) + 4)];
const luma = ([r, g, b]) => (0.2126 * r) + (0.7152 * g) + (0.0722 * b);

const opts = (over) => ({ ...SHARPEN_DEFAULTS, enabled: true, amount: 1, radius: 1, ...over });

test('sharpen: defaults and zero amount are no-ops', () => {
  assert.equal(isSharpenIdentity(SHARPEN_DEFAULTS), true);
  assert.equal(isSharpenIdentity(opts({ amount: 0 })), true);
  assert.equal(isSharpenIdentity(opts({})), false);

  const img = surface(4, 4, () => [100, 100, 100, 255]);
  assert.equal(applySharpen(img, opts({ amount: 0 })), false);
});

test('sharpen: a flat region gains no detail', () => {
  const img = surface(8, 8, () => [120, 90, 60, 255]);
  applySharpen(img, opts({ amount: 2 }));
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      assert.deepEqual(at(img, x, y), [120, 90, 60, 255], `pixel ${x},${y} moved`);
    }
  }
});

test('sharpen: an interior step edge gains contrast', () => {
  const img = surface(16, 4, (x) => (x < 8 ? [80, 80, 80, 255] : [180, 180, 180, 255]));
  const darkBefore = luma(at(img, 7, 2));
  const lightBefore = luma(at(img, 8, 2));

  applySharpen(img, opts({ amount: 1.5 }));

  assert.ok(luma(at(img, 7, 2)) < darkBefore, 'dark side of the edge goes darker');
  assert.ok(luma(at(img, 8, 2)) > lightBefore, 'light side goes lighter');
});

test('sharpen: alpha is never modified', () => {
  const img = surface(8, 8, (x, y) => [((x * 31) + (y * 17)) % 256, 90, 60, (x + y) % 2 ? 255 : 90]);
  const alphaBefore = [];
  for (let i = 3; i < img.data.length; i += 4) alphaBefore.push(img.data[i]);

  applySharpen(img, opts({ amount: 2, radius: 2 }));

  const alphaAfter = [];
  for (let i = 3; i < img.data.length; i += 4) alphaAfter.push(img.data[i]);
  assert.deepEqual(alphaAfter, alphaBefore);
});

test('sharpen: does not carve a dark halo along the transparent border', () => {
  // The failure this guards: a naive blur averages the subject against the
  // transparent void, so the blurred edge reads darker than the real one, the
  // detail signal spikes, and the outermost subject pixels get brightened while
  // the ones just inside get gouged dark - a rim that looks like a chewed
  // outline. With an alpha-normalised blur a uniform subject stays uniform all
  // the way to its own border.
  const img = surface(12, 12, (x, y) => {
    const inside = x >= 3 && x <= 8 && y >= 3 && y <= 8;
    return inside ? [150, 150, 150, 255] : [0, 0, 0, 0];
  });

  applySharpen(img, opts({ amount: 2, radius: 2 }));

  for (let y = 3; y <= 8; y++) {
    for (let x = 3; x <= 8; x++) {
      assert.deepEqual(at(img, x, y), [150, 150, 150, 255], `subject pixel ${x},${y} was altered`);
    }
  }
});

test('sharpen: transparent pixels are left alone', () => {
  const img = surface(10, 10, (x, y) => (
    (x >= 4 && x <= 5 && y >= 4 && y <= 5) ? [200, 60, 60, 255] : [7, 8, 9, 0]
  ));
  applySharpen(img, opts({ amount: 2 }));
  assert.deepEqual(at(img, 0, 0), [7, 8, 9, 0]);
  assert.deepEqual(at(img, 9, 9), [7, 8, 9, 0]);
});

test('sharpen: threshold suppresses low-amplitude detail', () => {
  const gentle = (x) => (x < 8 ? [120, 120, 120, 255] : [126, 126, 126, 255]);
  const noThreshold = surface(16, 4, gentle);
  const withThreshold = surface(16, 4, gentle);

  applySharpen(noThreshold, opts({ amount: 2, threshold: 0 }));
  applySharpen(withThreshold, opts({ amount: 2, threshold: 0.2 }));

  assert.notDeepEqual(at(noThreshold, 8, 2), [126, 126, 126, 255], 'without a threshold this edge moves');
  assert.deepEqual(at(withThreshold, 8, 2), [126, 126, 126, 255], 'a 6/255 step is below a 51/255 threshold');
});

test('sharpen: hue survives a luma-scaled boost', () => {
  const img = surface(16, 4, (x) => (x < 8 ? [60, 30, 15, 255] : [200, 100, 50, 255]));
  applySharpen(img, opts({ amount: 1 }));

  const [r, g, b] = at(img, 8, 2);
  // The source ratio is 4:2:1; scaling luma must preserve it.
  assert.ok(Math.abs((r / g) - 2) < 0.12, `r/g drifted: ${r / g}`);
  assert.ok(Math.abs((g / b) - 2) < 0.12, `g/b drifted: ${g / b}`);
});

test('sharpen: degenerate input is handled', () => {
  assert.equal(applySharpen(null, opts({})), false);
  assert.equal(applySharpen({ data: new Uint8ClampedArray(0), width: 0, height: 0 }, opts({})), false);
});
