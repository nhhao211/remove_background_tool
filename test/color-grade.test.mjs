import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyColorGrade,
  isColorGradeIdentity,
  COLOR_GRADE_DEFAULTS
} from '../public/js/color-grade.js';

function surface(pixels) {
  const data = new Uint8ClampedArray(pixels.length * 4);
  pixels.forEach((px, i) => data.set(px, i * 4));
  return { data, width: pixels.length, height: 1 };
}

const px = (img, i) => [...img.data.subarray(i * 4, (i * 4) + 4)];

const saturationOf = ([r, g, b]) => {
  const max = Math.max(r, g, b);
  return max > 0 ? (max - Math.min(r, g, b)) / max : 0;
};

const opts = (over) => ({ ...COLOR_GRADE_DEFAULTS, enabled: true, ...over });

test('color grade: defaults are a no-op', () => {
  assert.equal(isColorGradeIdentity(COLOR_GRADE_DEFAULTS), true);
  assert.equal(isColorGradeIdentity(opts({})), true, 'enabled but all-zero is still identity');
  assert.equal(isColorGradeIdentity(opts({ vibrance: 0.5 })), false);

  const img = surface([[120, 90, 60, 255]]);
  assert.equal(applyColorGrade(img, opts({})), false);
  assert.deepEqual(px(img, 0), [120, 90, 60, 255]);
});

test('color grade: alpha is never modified', () => {
  const img = surface([[10, 20, 30, 7], [200, 100, 50, 128], [0, 0, 0, 255]]);
  applyColorGrade(img, opts({ exposure: 1, contrast: 0.5, saturation: 0.5, vibrance: 0.5, temperature: 0.5 }));
  assert.deepEqual([px(img, 0)[3], px(img, 1)[3], px(img, 2)[3]], [7, 128, 255]);
});

test('color grade: fully transparent pixels are skipped', () => {
  const img = surface([[90, 40, 20, 0]]);
  applyColorGrade(img, opts({ exposure: 2, saturation: 1 }));
  assert.deepEqual(px(img, 0), [90, 40, 20, 0]);
});

test('color grade: exposure moves in stops, not in code values', () => {
  // sRGB 128 decodes to linear 0.216; +1 stop doubles it to 0.432, which
  // re-encodes to 176. Adding a stop must not simply scale the 8-bit value.
  const img = surface([[128, 128, 128, 255]]);
  applyColorGrade(img, opts({ exposure: 1 }));
  const [r, g, b] = px(img, 0);
  assert.equal(r, g);
  assert.equal(g, b);
  assert.ok(Math.abs(r - 176) <= 1, `expected ~176, got ${r}`);

  const down = surface([[128, 128, 128, 255]]);
  applyColorGrade(down, opts({ exposure: -1 }));
  assert.ok(px(down, 0)[0] < 128, 'negative exposure darkens');
});

test('color grade: contrast pivots around mid-grey', () => {
  const img = surface([[128, 128, 128, 255], [30, 30, 30, 255], [220, 220, 220, 255]]);
  const before = [px(img, 0), px(img, 1), px(img, 2)];
  applyColorGrade(img, opts({ contrast: 0.5 }));

  // Display mid-grey is the pivot, so it must not drift at all.
  assert.ok(Math.abs(px(img, 0)[0] - before[0][0]) <= 1, 'mid-grey stays put');
  assert.ok(px(img, 1)[0] < before[1][0], 'shadows go down');
  assert.ok(px(img, 2)[0] > before[2][0], 'highlights go up');
});

test('color grade: saturation scales colour away from luma', () => {
  const img = surface([[160, 100, 80, 255]]);
  const before = px(img, 0);
  applyColorGrade(img, opts({ saturation: 0.6 }));
  assert.ok(saturationOf(px(img, 0)) > saturationOf(before));

  const down = surface([[160, 100, 80, 255]]);
  applyColorGrade(down, opts({ saturation: -1 }));
  const [r, g, b] = px(down, 0);
  assert.ok(Math.abs(r - g) <= 1 && Math.abs(g - b) <= 1, `-1 should be greyscale, got ${r},${g},${b}`);
});

test('color grade: vibrance lifts muted colour more than vivid colour', () => {
  // The whole reason vibrance exists: a washed-out pixel should gain far more
  // than one that is already near-saturated, so strong hues do not clip.
  const muted = surface([[140, 120, 110, 255]]);
  const vivid = surface([[240, 30, 20, 255]]);
  const mutedBefore = saturationOf(px(muted, 0));
  const vividBefore = saturationOf(px(vivid, 0));

  applyColorGrade(muted, opts({ vibrance: 1 }));
  applyColorGrade(vivid, opts({ vibrance: 1 }));

  const mutedGain = saturationOf(px(muted, 0)) - mutedBefore;
  const vividGain = saturationOf(px(vivid, 0)) - vividBefore;
  assert.ok(mutedGain > vividGain, `muted ${mutedGain} should beat vivid ${vividGain}`);
});

test('color grade: vibrance leaves neutral grey neutral', () => {
  const img = surface([[128, 128, 128, 255]]);
  applyColorGrade(img, opts({ vibrance: 1 }));
  const [r, g, b] = px(img, 0);
  assert.deepEqual([r, g], [128, 128]);
  assert.equal(b, 128);
});

test('color grade: temperature warms and cools without shifting green', () => {
  const warm = surface([[128, 128, 128, 255]]);
  const cool = surface([[128, 128, 128, 255]]);
  applyColorGrade(warm, opts({ temperature: 1 }));
  applyColorGrade(cool, opts({ temperature: -1 }));

  const [wr, wg, wb] = px(warm, 0);
  const [cr, cg, cb] = px(cool, 0);
  assert.ok(wr > 128 && wb < 128, `warm should raise red, lower blue: ${wr},${wb}`);
  assert.ok(cr < 128 && cb > 128, `cool should do the reverse: ${cr},${cb}`);
  assert.equal(wg, 128, 'green carries luma and must not move');
  assert.equal(cg, 128);
});

test('color grade: values stay in range at extremes', () => {
  const img = surface([[255, 255, 255, 255], [0, 0, 0, 255], [255, 0, 0, 255]]);
  applyColorGrade(img, opts({ exposure: 2, contrast: 1, saturation: 1, vibrance: 1, temperature: 1 }));
  for (let i = 0; i < 3; i++) {
    for (const channel of px(img, i)) {
      assert.ok(channel >= 0 && channel <= 255, `channel out of range: ${channel}`);
    }
  }
});

test('color grade: out-of-range options are clamped, not trusted', () => {
  const wild = surface([[100, 90, 80, 255]]);
  const capped = surface([[100, 90, 80, 255]]);
  applyColorGrade(wild, opts({ saturation: 99 }));
  applyColorGrade(capped, opts({ saturation: 1 }));
  assert.deepEqual(px(wild, 0), px(capped, 0));
});

test('color grade: degenerate input is handled', () => {
  assert.equal(applyColorGrade(null, opts({ saturation: 1 })), false);
  assert.equal(applyColorGrade({ data: new Uint8ClampedArray(0), width: 0, height: 0 }, opts({ saturation: 1 })), false);
});
