import test from 'node:test';
import assert from 'node:assert/strict';

import { SRGB_TO_LINEAR, linearToSrgb8 } from '../public/js/keyer/color.js';
import { dissolveImageData, estimateSeamFlow, morphBlendImageData } from '../public/js/seam-morph.js';

const W = 96;
const H = 96;

/** Anti-aliased disc on a transparent field, with a little horizontal texture. */
function disc(cx, cy, radius = 14, width = W, height = H, data = new Uint8ClampedArray(width * height * 4)) {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = ((y * width) + x) * 4;
      const a = Math.max(0, Math.min(1, radius + 0.5 - Math.hypot(x - cx, y - cy)));
      if (a > 0) {
        data[i] = 220;
        data[i + 1] = 100 + ((x * 3) % 60);
        data[i + 2] = 40;
        data[i + 3] = Math.max(data[i + 3], Math.round(a * 255));
      }
    }
  }
  return { data, width, height };
}

/** Opaque texture with a bright blob, shifted by (ox, oy). */
function texture(ox, oy, width = W, height = H) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = ((y * width) + x) * 4;
      const X = x - ox;
      const Y = y - oy;
      let v = 90 + (40 * Math.sin(X * 0.25) * Math.cos(Y * 0.2));
      if (Math.hypot(X - 48, Y - 48) < 15) v = 230;
      data[i] = v;
      data[i + 1] = v * 0.9;
      data[i + 2] = v * 0.7;
      data[i + 3] = 255;
    }
  }
  return { data, width, height };
}

const clone = (img) => ({ data: new Uint8ClampedArray(img.data), width: img.width, height: img.height });

/** Pixels that are neither clearly in nor clearly out: the double-image ghost. */
function ghostPixels(img) {
  let n = 0;
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i] > 40 && img.data[i] < 215) n++;
  return n;
}

function alphaCentroidX(img) {
  let sx = 0;
  let s = 0;
  for (let p = 0; p < img.width * img.height; p++) {
    const a = img.data[(p * 4) + 3];
    sx += a * (p % img.width);
    s += a;
  }
  return sx / s;
}

function meanAbs(a, b, channel) {
  let acc = 0;
  for (let i = channel; i < a.data.length; i += 4) acc += Math.abs(a.data[i] - b.data[i]);
  return acc / (a.data.length / 4);
}

test('dissolveImageData matches the historical premultiplied linear-light formula', () => {
  const a = disc(40, 48);
  const b = disc(50, 44, 10);
  const out = clone(a);
  dissolveImageData(out, b, 0.3);
  for (let i = 0; i < a.data.length; i += 4) {
    const wa = (a.data[i + 3] / 255) * 0.7;
    const wb = (b.data[i + 3] / 255) * 0.3;
    const alpha = wa + wb;
    if (alpha > 0.001) {
      for (let c = 0; c < 3; c++) {
        const want = linearToSrgb8(((SRGB_TO_LINEAR[a.data[i + c]] * wa) + (SRGB_TO_LINEAR[b.data[i + c]] * wb)) / alpha);
        assert.equal(out.data[i + c], want);
      }
      assert.equal(out.data[i + 3], Math.round(alpha * 255));
    } else {
      assert.equal(out.data[i + 3], 0);
    }
  }
});

test('weight 0 leaves the cell untouched on both paths', () => {
  const a = disc(40, 48);
  const b = disc(47, 45);
  const d = clone(a);
  dissolveImageData(d, b, 0);
  assert.deepEqual(d.data, a.data);
  const m = clone(a);
  assert.equal(morphBlendImageData(m, b, 0).mode, 'none');
  assert.deepEqual(m.data, a.data);
});

test('identical frames take the dissolve path and stay byte-identical', () => {
  const a = disc(40, 48);
  const out = clone(a);
  const result = morphBlendImageData(out, a, 0.5);
  assert.equal(result.mode, 'dissolve');
  assert.deepEqual(out.data, a.data);
});

test('estimateSeamFlow points from the cell toward the twin', () => {
  const flow = estimateSeamFlow(disc(40, 48), disc(47, 45));
  assert.ok(flow.gain > 0.6, `gain ${flow.gain}`);
  // Median flow inside the cell's disc: right and up.
  const us = [];
  const vs = [];
  const s = flow.width / W;
  for (let y = 0; y < flow.height; y++) {
    for (let x = 0; x < flow.width; x++) {
      if (Math.hypot((x / s) - 40, (y / s) - 48) < 10) {
        us.push(flow.u[(y * flow.width) + x] / s);
        vs.push(flow.v[(y * flow.width) + x] / s);
      }
    }
  }
  us.sort((p, q) => p - q);
  vs.sort((p, q) => p - q);
  assert.ok(us[us.length >> 1] > 1, `u ${us[us.length >> 1]}`);
  assert.ok(vs[vs.length >> 1] < -0.5, `v ${vs[vs.length >> 1]}`);
});

test('a displaced pose is drawn once, between the two, instead of as a ghost', () => {
  const a = disc(40, 48);
  const b = disc(47, 45);
  for (const w of [0.25, 0.5, 0.75]) {
    const m = clone(a);
    const result = morphBlendImageData(m, b, w);
    assert.equal(result.mode, 'morph');
    const d = clone(a);
    dissolveImageData(d, b, w);
    // An anti-aliased disc alone has ~90 partial pixels; the dissolve ~450.
    assert.ok(ghostPixels(m) < 0.4 * ghostPixels(d), `w=${w}: morph ${ghostPixels(m)} vs dissolve ${ghostPixels(d)}`);
    const expected = 40 + (7 * w);
    assert.ok(Math.abs(alphaCentroidX(m) - expected) < 0.6, `w=${w}: centroid ${alphaCentroidX(m)} vs ${expected}`);
  }
  const m = clone(a);
  morphBlendImageData(m, b, 0.5);
  const d = clone(a);
  dissolveImageData(d, b, 0.5);
  const truth = disc(43.5, 46.5);
  assert.ok(meanAbs(m, truth, 3) < 0.3 * meanAbs(d, truth, 3));
});

test('opaque footage: the morph lands closer to the in-between frame than the dissolve', () => {
  const a = texture(0, 0);
  const b = texture(4, 2);
  const truth = texture(2, 1);
  const m = clone(a);
  assert.equal(morphBlendImageData(m, b, 0.5).mode, 'morph');
  const d = clone(a);
  dissolveImageData(d, b, 0.5);
  assert.ok(meanAbs(m, truth, 0) < 0.3 * meanAbs(d, truth, 0));
});

test('unrelated poses fall back to the dissolve, byte for byte', () => {
  for (const [a, b] of [
    [disc(20, 20, 10), disc(75, 70, 10)],
    [disc(30, 48, 10), disc(66, 48, 10)],
    [texture(0, 0), texture(31, 17)]
  ]) {
    const m = clone(a);
    const result = morphBlendImageData(m, b, 0.5);
    assert.equal(result.mode, 'dissolve', `gain ${result.gain}`);
    const d = clone(a);
    dissolveImageData(d, b, 0.5);
    assert.deepEqual(m.data, d.data);
  }
});

test('size mismatch and missing input are rejected without touching the cell', () => {
  const a = disc(40, 48);
  const small = disc(10, 10, 5, 32, 32);
  assert.equal(estimateSeamFlow(a, small), null);
  const m = clone(a);
  morphBlendImageData(m, small, 0.5);
  // Dissolve also refuses mismatched buffers.
  assert.deepEqual(m.data, a.data);
});
