import test from 'node:test';
import assert from 'node:assert/strict';
import { applyColorReplacement } from '../public/js/color-replace.js';

function replacePixel(rgba, options = {}) {
  const imageData = { data: new Uint8ClampedArray(rgba) };
  applyColorReplacement(imageData, options);
  return Array.from(imageData.data);
}

test('an exact sampled color maps to the requested target color', () => {
  const result = replacePixel([200, 40, 40, 255], {
    sourceColor: { r: 200, g: 40, b: 40 },
    targetColor: { r: 30, g: 100, b: 220 },
    tolerance: 0.25,
    strength: 1
  });
  assert.ok(Math.abs(result[0] - 30) <= 1);
  assert.ok(Math.abs(result[1] - 100) <= 1);
  assert.ok(Math.abs(result[2] - 220) <= 1);
  assert.equal(result[3], 255);
});

test('distant colors and transparent pixels are unchanged', () => {
  const distant = replacePixel([20, 210, 60, 255], {
    sourceColor: { r: 200, g: 40, b: 40 },
    targetColor: { r: 30, g: 100, b: 220 },
    tolerance: 0.12,
    strength: 1
  });
  const transparent = replacePixel([200, 40, 40, 0], {
    sourceColor: { r: 200, g: 40, b: 40 },
    targetColor: { r: 30, g: 100, b: 220 },
    tolerance: 1,
    strength: 1
  });
  assert.deepEqual(distant, [20, 210, 60, 255]);
  assert.deepEqual(transparent, [200, 40, 40, 0]);
});

test('strength blends the replacement and never changes alpha', () => {
  const result = replacePixel([200, 40, 40, 128], {
    sourceColor: { r: 200, g: 40, b: 40 },
    targetColor: { r: 40, g: 80, b: 200 },
    tolerance: 0.25,
    strength: 0.5
  });
  assert.ok(result[0] >= 119 && result[0] <= 121);
  assert.ok(result[1] >= 59 && result[1] <= 61);
  assert.ok(result[2] >= 119 && result[2] <= 121);
  assert.equal(result[3], 128);
});
