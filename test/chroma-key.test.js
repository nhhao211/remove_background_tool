import test from 'node:test';
import assert from 'node:assert/strict';
import { applyChromaKey } from '../public/js/chroma-key.js';

const blue = { r: 0, g: 36, b: 245 };

function keyPixel(r, g, b, options = {}) {
  const imageData = { data: new Uint8ClampedArray([r, g, b, 255]) };
  applyChromaKey(imageData, {
    similarity: 0.55,
    blend: 0.18,
    spill: 0.55,
    keyColors: [blue],
    ...options
  });
  return Array.from(imageData.data);
}

test('exact key colors become fully transparent while distant detail stays opaque', () => {
  assert.equal(keyPixel(0, 36, 245)[3], 0);
  assert.equal(keyPixel(220, 70, 45)[3], 255);
});

test('higher similarity removes a wider range of background shades', () => {
  const low = keyPixel(15, 55, 225, { similarity: 0.15, blend: 0 });
  const high = keyPixel(15, 55, 225, { similarity: 0.8, blend: 0 });
  assert.equal(low[3], 255);
  assert.equal(high[3], 0);
});

test('blend creates a controlled partial-alpha edge', () => {
  const sharp = keyPixel(15, 55, 225, { similarity: 0.42, blend: 0 });
  const soft = keyPixel(15, 55, 225, { similarity: 0.42, blend: 0.85 });
  assert.equal(sharp[3], 255);
  assert.ok(soft[3] > 0 && soft[3] < 255);
});

test('spill suppression decontaminates opaque edge pixels but leaves distant colors alone', () => {
  const withoutSpill = keyPixel(15, 55, 225, { similarity: 0.2, blend: 0, spill: 0 });
  const withSpill = keyPixel(15, 55, 225, { similarity: 0.2, blend: 0, spill: 1 });
  assert.equal(withSpill[3], 255);
  assert.ok(withSpill[2] < withoutSpill[2]);
  assert.deepEqual(keyPixel(220, 70, 45, { spill: 1 }).slice(0, 3), [220, 70, 45]);
});

test('disabled keying preserves every channel', () => {
  assert.deepEqual(keyPixel(0, 36, 245, { enabled: false }), [0, 36, 245, 255]);
});
