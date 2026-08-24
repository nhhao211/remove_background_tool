import test from 'node:test';
import assert from 'node:assert/strict';
import { detectEdgeColors, processSpriteSheet, removeConnectedBackground } from '../public/js/background-removal.js';

function solidImage(width, height, color) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    data.set([color.r, color.g, color.b, color.a ?? 255], index * 4);
  }
  return { width, height, data };
}

function setPixel(image, x, y, color) {
  image.data.set([color.r, color.g, color.b, color.a ?? 255], ((y * image.width) + x) * 4);
}

function alphaAt(image, x, y) {
  return image.data[(((y * image.width) + x) * 4) + 3];
}

test('detects the dominant opaque background color from image edges', () => {
  const image = solidImage(20, 20, { r: 10, g: 210, b: 40 });
  for (let y = 5; y < 15; y += 1) {
    for (let x = 5; x < 15; x += 1) setPixel(image, x, y, { r: 220, g: 30, b: 20 });
  }
  const colors = detectEdgeColors(image);
  assert.equal(colors[0].hex, '#0ad228');
});

test('removes edge-connected key color while protecting enclosed matching detail', () => {
  const image = solidImage(9, 9, { r: 0, g: 255, b: 0 });
  for (let y = 2; y <= 6; y += 1) {
    for (let x = 2; x <= 6; x += 1) setPixel(image, x, y, { r: 200, g: 40, b: 30 });
  }
  setPixel(image, 4, 4, { r: 0, g: 255, b: 0 });
  removeConnectedBackground(image, {
    autoDetect: false,
    keyColors: [{ r: 0, g: 255, b: 0 }],
    similarity: 0.5,
    feather: 0
  });
  assert.equal(alphaAt(image, 0, 0), 0);
  assert.equal(alphaAt(image, 4, 4), 255);
});

test('preserves source dimensions and existing transparent pixels', () => {
  const image = solidImage(7, 5, { r: 0, g: 0, b: 255 });
  setPixel(image, 3, 2, { r: 255, g: 0, b: 0, a: 0 });
  const result = processSpriteSheet(image, { autoDetect: true });
  assert.equal(result.imageData.width, 7);
  assert.equal(result.imageData.height, 5);
  assert.equal(alphaAt(result.imageData, 3, 2), 0);
});

test('feathers a connected near-key halo without affecting the subject', () => {
  const image = solidImage(7, 7, { r: 0, g: 255, b: 0 });
  for (let y = 2; y <= 4; y += 1) {
    for (let x = 2; x <= 4; x += 1) setPixel(image, x, y, { r: 220, g: 30, b: 30 });
  }
  setPixel(image, 1, 3, { r: 5, g: 245, b: 5 });
  removeConnectedBackground(image, {
    autoDetect: false,
    keyColors: [{ r: 0, g: 255, b: 0 }],
    similarity: 0.1,
    feather: 0.8
  });
  assert.ok(alphaAt(image, 1, 3) > 0 && alphaAt(image, 1, 3) < 255);
  assert.equal(alphaAt(image, 2, 3), 255);
});

test('per-cell processing removes independently detected cell backgrounds', () => {
  const image = solidImage(12, 6, { r: 0, g: 255, b: 0 });
  for (let y = 0; y < 6; y += 1) {
    for (let x = 6; x < 12; x += 1) setPixel(image, x, y, { r: 0, g: 20, b: 240 });
  }
  setPixel(image, 3, 3, { r: 255, g: 0, b: 0 });
  setPixel(image, 9, 3, { r: 255, g: 0, b: 0 });
  processSpriteSheet(image, { autoDetect: true, perCell: true, rows: 1, cols: 2 });
  assert.equal(alphaAt(image, 0, 0), 0);
  assert.equal(alphaAt(image, 11, 0), 0);
  assert.equal(alphaAt(image, 3, 3), 255);
  assert.equal(alphaAt(image, 9, 3), 255);
});
