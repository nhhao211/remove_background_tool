import test from 'node:test';
import assert from 'node:assert/strict';

import { applyEraseMask } from '../public/js/erase-mask.js';
import { normalizeStroke, normalizeStrokes } from '../public/js/stroke-mask.js';

function makeImage(pixels, alpha = 200) {
  const data = new Uint8ClampedArray(pixels * 4);
  for (let index = 0; index < pixels; index += 1) {
    data[(index * 4) + 0] = 10;
    data[(index * 4) + 1] = 20;
    data[(index * 4) + 2] = 30;
    data[(index * 4) + 3] = alpha;
  }
  return { data, width: pixels, height: 1 };
}

const alphaOf = (image) => Array.from({ length: image.data.length / 4 }, (_, i) => image.data[(i * 4) + 3]);

test('a full-strength mask byte clears alpha, a zero byte leaves it alone', () => {
  const image = makeImage(3);
  const applied = applyEraseMask(image, new Uint8ClampedArray([255, 0, 255]));
  assert.equal(applied, true);
  assert.deepEqual(alphaOf(image), [0, 200, 0]);
});

test('feathered mask bytes scale alpha proportionally', () => {
  const image = makeImage(2);
  applyEraseMask(image, new Uint8ClampedArray([128, 64]));
  // 200 * (1 - 128/255) = 99.6 -> 100 ; 200 * (1 - 64/255) = 149.8 -> 150
  assert.deepEqual(alphaOf(image), [100, 150]);
});

test('erasing never touches colour channels', () => {
  const image = makeImage(2);
  applyEraseMask(image, new Uint8ClampedArray([255, 128]));
  assert.deepEqual(Array.from(image.data.slice(0, 3)), [10, 20, 30]);
  assert.deepEqual(Array.from(image.data.slice(4, 7)), [10, 20, 30]);
});

test('erasing an already-transparent pixel stays at zero', () => {
  const image = makeImage(1, 0);
  applyEraseMask(image, new Uint8ClampedArray([200]));
  assert.deepEqual(alphaOf(image), [0]);
});

test('a wrong-shaped or missing mask is a no-op rather than a throw', () => {
  const image = makeImage(3);
  assert.equal(applyEraseMask(image, new Uint8ClampedArray([255, 255])), false);
  assert.equal(applyEraseMask(image, null), false);
  assert.equal(applyEraseMask(null, new Uint8ClampedArray([255])), false);
  assert.deepEqual(alphaOf(image), [200, 200, 200]);
});

test('erase is idempotent at full strength and monotonic below it', () => {
  const once = makeImage(1);
  applyEraseMask(once, new Uint8ClampedArray([180]));
  const first = alphaOf(once)[0];
  applyEraseMask(once, new Uint8ClampedArray([180]));
  const second = alphaOf(once)[0];
  assert.ok(second < first, 'a second pass removes more');
  assert.ok(second >= 0);
});

test('legacy protection stroke modes normalize onto add/subtract', () => {
  assert.equal(normalizeStroke({ points: [{ x: 0, y: 0 }], mode: 'protect' }).mode, 'add');
  assert.equal(normalizeStroke({ points: [{ x: 0, y: 0 }], mode: 'erase' }).mode, 'subtract');
  assert.equal(normalizeStroke({ points: [{ x: 0, y: 0 }], mode: 'add' }).mode, 'add');
  assert.equal(normalizeStroke({ points: [{ x: 0, y: 0 }], mode: 'subtract' }).mode, 'subtract');
  assert.equal(normalizeStroke({ points: [{ x: 0, y: 0 }] }).mode, 'add');
});

test('stroke normalization clamps geometry and drops empty strokes', () => {
  const stroke = normalizeStroke({
    points: [{ x: -2, y: 5 }, { x: 0.5, y: 0.25 }, { x: NaN, y: 0 }],
    size: 9000,
    strength: 3,
    hardness: -1
  });
  assert.deepEqual(stroke.points, [{ x: 0, y: 1 }, { x: 0.5, y: 0.25 }]);
  assert.equal(stroke.size, 2000);
  assert.equal(stroke.strength, 1);
  assert.equal(stroke.hardness, 0);

  assert.equal(normalizeStroke({ points: [] }), null);
  assert.equal(normalizeStroke({ points: [{ x: 'a', y: 'b' }] }), null);
  assert.equal(normalizeStroke(null), null);
});

test('normalizeStrokes filters invalid entries and caps the history', () => {
  assert.deepEqual(normalizeStrokes(null), []);
  assert.deepEqual(normalizeStrokes('nope'), []);
  assert.equal(normalizeStrokes([{ points: [{ x: 0, y: 0 }] }, null, { points: [] }]).length, 1);

  const many = Array.from({ length: 620 }, (_, i) => ({ points: [{ x: i / 620, y: 0 }] }));
  const capped = normalizeStrokes(many);
  assert.equal(capped.length, 500);
  // The cap keeps the most recent strokes, so the oldest 120 are the ones dropped.
  assert.equal(capped[0].points[0].x, 120 / 620);
});
