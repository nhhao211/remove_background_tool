import test from 'node:test';
import assert from 'node:assert/strict';

import { applyAlphaBleed } from '../public/js/alpha-bleed.js';

/** Builds a blank RGBA surface the module accepts (ImageData-shaped duck type). */
function surface(width, height) {
  return { data: new Uint8ClampedArray(width * height * 4), width, height };
}

function setPixel(img, x, y, [r, g, b, a]) {
  const o = ((y * img.width) + x) * 4;
  img.data[o] = r;
  img.data[o + 1] = g;
  img.data[o + 2] = b;
  img.data[o + 3] = a;
}

function getPixel(img, x, y) {
  const o = ((y * img.width) + x) * 4;
  return [img.data[o], img.data[o + 1], img.data[o + 2], img.data[o + 3]];
}

test('alpha bleed: colour spreads into transparent neighbours', () => {
  const img = surface(3, 3);
  setPixel(img, 1, 1, [200, 40, 10, 255]);

  const rings = applyAlphaBleed(img, 1);

  assert.equal(rings, 1);
  for (let y = 0; y < 3; y++) {
    for (let x = 0; x < 3; x++) {
      assert.deepEqual(getPixel(img, x, y).slice(0, 3), [200, 40, 10], `pixel ${x},${y}`);
    }
  }
});

test('alpha bleed: alpha is never modified', () => {
  const img = surface(4, 4);
  setPixel(img, 0, 0, [255, 255, 255, 255]);
  setPixel(img, 3, 3, [10, 20, 30, 128]);
  const alphaBefore = [];
  for (let i = 3; i < img.data.length; i += 4) alphaBefore.push(img.data[i]);

  applyAlphaBleed(img, 4);

  const alphaAfter = [];
  for (let i = 3; i < img.data.length; i += 4) alphaAfter.push(img.data[i]);
  assert.deepEqual(alphaAfter, alphaBefore);
});

test('alpha bleed: grows one even ring per pass, not a scan-direction smear', () => {
  // A single lit pixel at the centre of a 7x7 field. After one pass exactly the
  // 8 immediate neighbours may carry colour; anything further out means the pass
  // read its own output and ran away along the scan direction.
  const img = surface(7, 7);
  setPixel(img, 3, 3, [90, 180, 240, 255]);

  applyAlphaBleed(img, 1);

  for (let y = 0; y < 7; y++) {
    for (let x = 0; x < 7; x++) {
      const withinRing = Math.abs(x - 3) <= 1 && Math.abs(y - 3) <= 1;
      const [r, g, b] = getPixel(img, x, y);
      const painted = r !== 0 || g !== 0 || b !== 0;
      assert.equal(painted, withinRing, `pixel ${x},${y} painted=${painted}`);
    }
  }
});

test('alpha bleed: honours the requested ring count', () => {
  const img = surface(9, 9);
  setPixel(img, 4, 4, [255, 0, 0, 255]);

  applyAlphaBleed(img, 2);

  assert.notDeepEqual(getPixel(img, 2, 4).slice(0, 3), [0, 0, 0], 'ring 2 should be painted');
  assert.deepEqual(getPixel(img, 1, 4).slice(0, 3), [0, 0, 0], 'ring 3 should be untouched');
});

test('alpha bleed: solid neighbours outweigh faint edge neighbours', () => {
  // Target at (1,0): one opaque red neighbour, one barely-there blue one.
  const img = surface(3, 1);
  setPixel(img, 0, 0, [255, 0, 0, 255]);
  setPixel(img, 2, 0, [0, 0, 255, 1]);

  applyAlphaBleed(img, 1);

  const [r, , b] = getPixel(img, 1, 0);
  assert.ok(r > b, `expected red to dominate, got r=${r} b=${b}`);
});

test('alpha bleed: degenerate surfaces are no-ops', () => {
  assert.equal(applyAlphaBleed(null, 3), 0);
  assert.equal(applyAlphaBleed(surface(4, 4), 3), 0, 'fully transparent has no colour to spread');

  const opaque = surface(2, 2);
  for (let i = 3; i < opaque.data.length; i += 4) opaque.data[i] = 255;
  assert.equal(applyAlphaBleed(opaque, 3), 0, 'fully opaque has nowhere to spread');
});

test('alpha bleed: stops early once the surface is saturated', () => {
  const img = surface(3, 3);
  setPixel(img, 1, 1, [1, 2, 3, 255]);

  // One ring already fills every pixel, so passes 2..8 have nothing to do.
  assert.equal(applyAlphaBleed(img, 8), 1);
});
