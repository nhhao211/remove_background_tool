import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applySubjectProtect, bandRects, buildProtectionMask, normalizeProtectStroke,
  planProtectionWindows, protectionThresholdFor
} from '../public/js/subject-protect.js';
import { cellRects } from '../public/js/region-cells.js';

// 3 cols × 2 rows of 20×20 cells.
const W = 60;
const H = 40;
const CELLS = cellRects(W, H, 2, 3);

/** Hard-edged stand-in for rasterizeStrokeMask: a disk per point, honours crop and modes. */
function fakeRasterize(strokes, o) {
  const mask = new Uint8ClampedArray(o.targetWidth * o.targetHeight);
  for (const stroke of strokes) {
    for (const point of stroke.points) {
      const cx = (point.x * o.sourceWidth) - o.cropX;
      const cy = (point.y * o.sourceHeight) - o.cropY;
      const r = stroke.size / 2;
      for (let y = 0; y < o.targetHeight; y += 1) {
        for (let x = 0; x < o.targetWidth; x += 1) {
          if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r) {
            mask[(y * o.targetWidth) + x] = stroke.mode === 'subtract' ? 0 : Math.round(stroke.strength * 255);
          }
        }
      }
    }
  }
  return { mask };
}

const stroke = (x, y, extra = {}) => ({ mode: 'add', points: [{ x: x / W, y: y / H }], size: 6, strength: 1, hardness: 1, ...extra });
const at = (mask, x, y) => mask[(y * W) + x];
const build = (strokes, cells = CELLS) => buildProtectionMask(strokes, { width: W, height: H, cells, rasterize: fakeRasterize });

test('no strokes ⇒ no mask', () => {
  assert.equal(build([]), null);
  assert.equal(build(null), null);
});

test('single-frame stroke lands only in its own cell', () => {
  const { mask } = build([stroke(5, 5)]);
  assert.equal(at(mask, 5, 5), 255);
  for (const [x, y] of [[25, 5], [45, 5], [5, 25], [25, 25]]) assert.equal(at(mask, x, y), 0);
});

test('single-frame stroke is fenced by its cell even when the brush overlaps the border', () => {
  // Centre 2 px from the right edge of cell 0, radius 3: would reach into cell 1.
  const { mask } = build([stroke(18, 10)]);
  assert.equal(at(mask, 19, 10), 255);
  assert.equal(at(mask, 20, 10), 0);
  assert.equal(at(mask, 21, 10), 0);
});

test('allFrames stroke is repeated at the same place in every cell', () => {
  const { mask } = build([stroke(5, 5, { allFrames: true })]);
  for (const cell of CELLS) assert.equal(at(mask, cell.x0 + 5, cell.y0 + 5), 255, `cell at ${cell.x0},${cell.y0}`);
  assert.equal(at(mask, 15, 15), 0);
});

test('allFrames copies are fenced by their own cell', () => {
  const { mask } = build([stroke(18, 10, { allFrames: true })]);
  assert.equal(at(mask, 19, 10), 255);
  assert.equal(at(mask, 20, 10), 0, 'did not leak from cell 0 into cell 1');
  assert.equal(at(mask, 39, 10), 255);
  assert.equal(at(mask, 40, 10), 0);
});

test('home cell comes from the first point, so a stroke made in cell 4 repeats relative to cell 4', () => {
  const { mask } = build([stroke(25, 30, { allFrames: true })]);
  for (const cell of CELLS) assert.equal(at(mask, cell.x0 + 5, cell.y0 + 10), 255);
});

test('painting order is kept: a later subtract stroke rubs an earlier add stroke out', () => {
  const { mask } = build([
    stroke(5, 5, { allFrames: true }),
    stroke(5, 5, { mode: 'subtract', size: 2 })
  ]);
  assert.equal(at(mask, 5, 5), 0, 'rubbed out in the cell it was made in');
  assert.equal(at(mask, 25, 5), 255, 'an all-frames stroke elsewhere is untouched by a single-frame rubber');
});

test('without a grid every stroke is whole-sheet, allFrames or not', () => {
  for (const allFrames of [false, true]) {
    const { mask } = build([stroke(5, 5, { allFrames })], null);
    assert.equal(at(mask, 5, 5), 255);
    assert.equal(at(mask, 25, 5), 0);
  }
});

test('planProtectionWindows only lists cells that have strokes', () => {
  assert.deepEqual(planProtectionWindows([stroke(5, 5)], { width: W, height: H, cells: CELLS }).map((w) => w.cell), [0]);
  assert.equal(planProtectionWindows([stroke(5, 5, { allFrames: true })], { width: W, height: H, cells: CELLS }).length, 6);
});

test('banding gives the same mask as one pass', () => {
  const strokes = [stroke(5, 5, { allFrames: true }), stroke(30, 30, { size: 9 })];
  const whole = build(strokes).mask;
  const banded = buildProtectionMask(strokes, { width: W, height: H, cells: CELLS, rasterize: fakeRasterize, maxBandPixels: 40 }).mask;
  assert.deepEqual(banded, whole);
});

test('bandRects covers the rectangle exactly once', () => {
  const bands = bandRects({ x0: 4, y0: 10, width: 30, height: 25 }, 100);
  assert.equal(bands.reduce((total, band) => total + band.height, 0), 25);
  assert.equal(bands[0].y0, 10);
  assert.equal(bands.at(-1).y0 + bands.at(-1).height, 35);
  assert.ok(bands.every((band) => band.width * band.height <= 100));
});

test('legacy protect/erase mode names and a missing flag normalise sanely', () => {
  assert.equal(normalizeProtectStroke({ mode: 'erase', points: [{ x: 0.1, y: 0.1 }] }).mode, 'subtract');
  const s = normalizeProtectStroke({ mode: 'protect', points: [{ x: 0.1, y: 0.1 }], frame: null, frameTime: null });
  assert.equal(s.allFrames, false);
  assert.equal(s.frame, null, 'Number(null) must not become frame 0');
  assert.equal(normalizeProtectStroke({ points: [] }), null);
});

/* ------------------------------------------------------------------ */

const GREEN = { r: 0, g: 255, b: 0 };
const image = (width, height, fill) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) data.set(fill, i * 4);
  return { data, width, height };
};
const px = (img, x, y) => Array.from(img.data.slice(((y * img.width) + x) * 4, ((y * img.width) + x) * 4 + 4));

test('applySubjectProtect: no mask or empty mask returns the input object untouched', () => {
  const base = image(4, 4, [10, 20, 30, 0]);
  const original = image(4, 4, [200, 100, 50, 255]);
  assert.equal(applySubjectProtect(base, original, null).imageData, base);
  assert.equal(applySubjectProtect(base, original, new Uint8ClampedArray(16)).imageData, base);
  assert.equal(applySubjectProtect(base, original, new Uint8ClampedArray(3)).imageData, base, 'wrong-shaped mask ignored');
});

test('applySubjectProtect: painted pixels get original colour and alpha back; others are untouched', () => {
  const base = image(4, 1, [90, 90, 90, 0]);
  const original = image(4, 1, [200, 100, 50, 255]);
  const mask = new Uint8ClampedArray([255, 255, 0, 0]);
  const before = Array.from(base.data);
  const { imageData, changedPixels } = applySubjectProtect(base, original, mask, { keyColors: [GREEN] });
  assert.deepEqual(px(imageData, 0, 0), [200, 100, 50, 255]);
  assert.deepEqual(px(imageData, 1, 0), [200, 100, 50, 255]);
  assert.deepEqual(px(imageData, 2, 0), [90, 90, 90, 0]);
  assert.equal(changedPixels, 2);
  assert.deepEqual(Array.from(base.data), before, 'input not mutated');
});

test('applySubjectProtect: despilled colour of an opaque pixel is restored', () => {
  const base = image(1, 1, [180, 100, 50, 255]);
  const original = image(1, 1, [200, 100, 50, 255]);
  const { imageData } = applySubjectProtect(base, original, new Uint8ClampedArray([255]), { keyColors: [GREEN] });
  assert.deepEqual(px(imageData, 0, 0), [200, 100, 50, 255]);
});

test('applySubjectProtect: half-strength brush blends halfway', () => {
  const base = image(1, 1, [100, 100, 100, 0]);
  const original = image(1, 1, [200, 200, 200, 200]);
  const base2 = image(1, 1, [100, 100, 100, 100]);
  const { imageData } = applySubjectProtect(base2, original, new Uint8ClampedArray([128]));
  assert.deepEqual(px(imageData, 0, 0), [150, 150, 150, 150]);
  const { imageData: fromGone } = applySubjectProtect(base, original, new Uint8ClampedArray([128]));
  assert.deepEqual(px(fromGone, 0, 0), [200, 200, 200, 100], 'colour taken outright, alpha blended');
});

test('applySubjectProtect: painting onto pure backdrop does not bring it back', () => {
  const base = image(2, 1, [0, 0, 0, 0]);
  const original = image(2, 1, [0, 255, 0, 255]);
  original.data.set([20, 235, 40, 255], 4); // costume green, clearly off the key
  const { imageData } = applySubjectProtect(base, original, new Uint8ClampedArray([255, 255]), {
    keyColors: [GREEN], transparentThreshold: protectionThresholdFor(0.48)
  });
  assert.equal(px(imageData, 0, 0)[3], 0, 'exact key colour stays transparent');
  assert.ok(px(imageData, 1, 0)[3] > 0, 'a pixel off the key colour is restored');
});

test('applySubjectProtect: fully transparent source pixels are left alone', () => {
  const base = image(1, 1, [0, 0, 0, 0]);
  const original = image(1, 1, [9, 9, 9, 0]);
  const { imageData, changedPixels } = applySubjectProtect(base, original, new Uint8ClampedArray([255]));
  assert.deepEqual(px(imageData, 0, 0), [0, 0, 0, 0]);
  assert.equal(changedPixels, 0);
});
