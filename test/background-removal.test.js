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

test('a picked seed removes an isolated matching background component', () => {
  const image = solidImage(9, 9, { r: 220, g: 30, b: 30 });
  for (let y = 2; y <= 6; y += 1) {
    for (let x = 2; x <= 6; x += 1) setPixel(image, x, y, { r: 0, g: 210, b: 255 });
  }
  removeConnectedBackground(image, {
    autoDetect: false,
    keyColors: [{ r: 0, g: 210, b: 255 }],
    seedPoints: [{ x: 4, y: 4 }],
    similarity: 0.3,
    feather: 0
  });
  assert.equal(alphaAt(image, 4, 4), 0);
  assert.equal(alphaAt(image, 0, 0), 255);
});

test('a lower-half scoped pick cannot remove the same connected color above the image midpoint', () => {
  const image = solidImage(9, 10, { r: 220, g: 30, b: 30 });
  for (let y = 0; y < image.height; y += 1) {
    setPixel(image, 4, y, { r: 0, g: 210, b: 255 });
  }
  removeConnectedBackground(image, {
    autoDetect: false,
    keyColors: [{ r: 0, g: 210, b: 255, hex: '#00d2ff' }],
    keyRegions: [{ hex: '#00d2ff', minYRatio: 0.5, maxYRatio: 1 }],
    seedPoints: [{ x: 4, y: 8 }],
    similarity: 0.3,
    feather: 0,
    cleanupRadius: 2
  });
  assert.equal(alphaAt(image, 4, 8), 0);
  assert.equal(alphaAt(image, 4, 6), 0);
  assert.equal(alphaAt(image, 4, 4), 255);
  assert.equal(alphaAt(image, 4, 1), 255);
});

test('cell lower-half scope protects the upper half inside every sprite row', () => {
  const image = solidImage(5, 8, { r: 220, g: 30, b: 30 });
  for (let y = 0; y < image.height; y += 1) {
    setPixel(image, 2, y, { r: 0, g: 210, b: 255 });
  }
  processSpriteSheet(image, {
    autoDetect: false,
    keyColors: [{ r: 0, g: 210, b: 255, hex: '#00d2ff' }],
    keyRegions: [{ hex: '#00d2ff', mode: 'cell-lower-half', rows: 2, cols: 1 }],
    seedPoints: [{ x: 2, y: 3 }],
    perCell: true,
    rows: 2,
    cols: 1,
    similarity: 0.3,
    feather: 0
  });
  assert.equal(alphaAt(image, 2, 1), 255);
  assert.equal(alphaAt(image, 2, 3), 0);
  assert.equal(alphaAt(image, 2, 5), 255);
  assert.equal(alphaAt(image, 2, 7), 0);
});

test('a picked lower-half color globally matches isolated pixels in every sprite frame', () => {
  const image = solidImage(6, 8, { r: 220, g: 30, b: 30 });
  setPixel(image, 2, 2, { r: 0, g: 210, b: 255 });
  setPixel(image, 2, 6, { r: 0, g: 210, b: 255 });
  setPixel(image, 4, 0, { r: 0, g: 210, b: 255 });
  setPixel(image, 4, 4, { r: 0, g: 210, b: 255 });
  processSpriteSheet(image, {
    autoDetect: false,
    keyColors: [{ r: 0, g: 210, b: 255, hex: '#00d2ff' }],
    keyRegions: [{
      hex: '#00d2ff',
      mode: 'cell-lower-half',
      matchMode: 'global',
      rows: 2,
      cols: 1
    }],
    seedPoints: [{ x: 2, y: 2 }],
    perCell: true,
    rows: 2,
    cols: 1,
    similarity: 0.3,
    feather: 0
  });
  assert.equal(alphaAt(image, 2, 2), 0);
  assert.equal(alphaAt(image, 2, 6), 0);
  assert.equal(alphaAt(image, 4, 0), 255);
  assert.equal(alphaAt(image, 4, 4), 255);
});

test('a custom cell split ratio moves the protected boundary for every frame', () => {
  const image = solidImage(4, 10, { r: 220, g: 30, b: 30 });
  setPixel(image, 1, 6, { r: 0, g: 210, b: 255 });
  setPixel(image, 1, 7, { r: 0, g: 210, b: 255 });
  processSpriteSheet(image, {
    autoDetect: false,
    keyColors: [{ r: 0, g: 210, b: 255, hex: '#00d2ff' }],
    keyRegions: [{
      hex: '#00d2ff',
      mode: 'cell-lower-half',
      matchMode: 'global',
      rows: 1,
      cols: 1,
      splitRatio: 0.7
    }],
    perCell: true,
    rows: 1,
    cols: 1,
    similarity: 0.3,
    feather: 0
  });
  assert.equal(alphaAt(image, 1, 6), 255);
  assert.equal(alphaAt(image, 1, 7), 0);
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

test('preserveColors keeps every RGB channel byte-for-byte while changing alpha', () => {
  const image = solidImage(7, 7, { r: 0, g: 36, b: 245 });
  for (let y = 2; y <= 4; y += 1) {
    for (let x = 2; x <= 4; x += 1) setPixel(image, x, y, { r: 215, g: 65, b: 42 });
  }
  setPixel(image, 1, 3, { r: 5, g: 31, b: 235 });
  const originalRgb = [];
  for (let offset = 0; offset < image.data.length; offset += 4) {
    originalRgb.push(image.data[offset], image.data[offset + 1], image.data[offset + 2]);
  }
  removeConnectedBackground(image, {
    autoDetect: false,
    keyColors: [{ r: 0, g: 36, b: 245 }],
    similarity: 0.3,
    feather: 0.8,
    spill: 1,
    preserveColors: true
  });
  const resultRgb = [];
  for (let offset = 0; offset < image.data.length; offset += 4) {
    resultRgb.push(image.data[offset], image.data[offset + 1], image.data[offset + 2]);
  }
  assert.deepEqual(resultRgb, originalRgb);
  assert.equal(alphaAt(image, 0, 0), 0);
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

test('per-cell processing maps a picked sheet coordinate into the correct cell', () => {
  const image = solidImage(12, 6, { r: 220, g: 30, b: 30 });
  for (let y = 2; y <= 4; y += 1) {
    for (let x = 7; x <= 10; x += 1) setPixel(image, x, y, { r: 0, g: 210, b: 255 });
  }
  processSpriteSheet(image, {
    autoDetect: false,
    keyColors: [{ r: 0, g: 210, b: 255 }],
    seedPoints: [{ x: 8, y: 3 }],
    perCell: true,
    rows: 1,
    cols: 2
  });
  assert.equal(alphaAt(image, 8, 3), 0);
  assert.equal(alphaAt(image, 0, 0), 255);
});
