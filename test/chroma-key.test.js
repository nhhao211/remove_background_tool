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
    subjectProtection: 0.50,
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

test('subject protection preserves similarly hued details with different luminance', () => {
  const unprotected = keyPixel(0, 20, 180, { similarity: 0.72, blend: 0, spill: 0, subjectProtection: 0 });
  const protectedPixel = keyPixel(0, 20, 180, { similarity: 0.72, blend: 0, spill: 0, subjectProtection: 1 });
  assert.ok(protectedPixel[3] > unprotected[3]);
  assert.equal(protectedPixel[3], 255);
});

test('subject protection retains more original color during spill suppression', () => {
  const unprotected = keyPixel(15, 55, 225, { similarity: 0.2, blend: 0, spill: 1, subjectProtection: 0 });
  const protectedPixel = keyPixel(15, 55, 225, { similarity: 0.2, blend: 0, spill: 1, subjectProtection: 1 });
  assert.ok(protectedPixel[2] > unprotected[2]);
  assert.ok(Math.abs(225 - protectedPixel[2]) < Math.abs(225 - unprotected[2]));
});

test('disabled keying preserves every channel', () => {
  assert.deepEqual(keyPixel(0, 36, 245, { enabled: false }), [0, 36, 245, 255]);
});

test('edge cleanup erodes the keyed foreground boundary by the requested radius', () => {
  const imageData = {
    width: 3,
    height: 1,
    data: new Uint8ClampedArray([
      0, 36, 245, 255,
      220, 70, 45, 255,
      220, 70, 45, 255
    ])
  };
  applyChromaKey(imageData, {
    similarity: 0.55,
    blend: 0,
    spill: 0,
    cleanupRadius: 1,
    keyColors: [blue]
  });
  assert.equal(imageData.data[3], 0);
  assert.equal(imageData.data[7], 0);
  assert.equal(imageData.data[11], 255);
});

test('a soft protection mask restores alpha in proportion to brush strength', () => {
  const options = { similarity: 0.72, blend: 0 };
  const unprotected = keyPixel(10, 50, 235, { ...options, protectionMask: new Uint8ClampedArray([0]) });
  const halfProtected = keyPixel(10, 50, 235, { ...options, protectionMask: new Uint8ClampedArray([128]) });
  const protectedPixel = keyPixel(10, 50, 235, { ...options, protectionMask: new Uint8ClampedArray([255]) });
  assert.equal(unprotected[3], 0);
  assert.ok(halfProtected[3] >= 127 && halfProtected[3] <= 129);
  assert.equal(protectedPixel[3], 255);
});

test('painting over the exact background color never restores a solid background patch', () => {
  const protectedBackground = keyPixel(0, 36, 245, {
    protectionMask: new Uint8ClampedArray([255])
  });
  assert.equal(protectedBackground[3], 0);
});

test('protection is restored after edge cleanup and does not change pixels outside the mask', () => {
  const imageData = {
    width: 3,
    height: 1,
    data: new Uint8ClampedArray([
      0, 36, 245, 255,
      220, 70, 45, 255,
      220, 70, 45, 255
    ])
  };
  applyChromaKey(imageData, {
    similarity: 0.55,
    blend: 0,
    spill: 0,
    cleanupRadius: 1,
    protectionMask: new Uint8ClampedArray([0, 204, 0]),
    keyColors: [blue]
  });
  assert.equal(imageData.data[3], 0);
  assert.ok(imageData.data[7] >= 203 && imageData.data[7] <= 205);
  assert.equal(imageData.data[11], 255);
});

test('a protected pixel receives stronger key-color decontamination', () => {
  const unprotected = keyPixel(15, 55, 225, {
    similarity: 0.2,
    blend: 0,
    spill: 1,
    protectionMask: new Uint8ClampedArray([0])
  });
  const protectedPixel = keyPixel(15, 55, 225, {
    similarity: 0.2,
    blend: 0,
    spill: 1,
    protectionMask: new Uint8ClampedArray([255])
  });
  assert.ok(protectedPixel[2] < unprotected[2]);
  assert.ok(protectedPixel[2] < 190);
});
