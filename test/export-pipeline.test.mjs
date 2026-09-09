import test from 'node:test';
import assert from 'node:assert/strict';

import { applyColorGrade } from '../public/js/color-grade.js';
import { applySharpen } from '../public/js/sharpen.js';
import { applyAlphaBleed } from '../public/js/alpha-bleed.js';
import { encodePNG } from '../public/js/png-encoder.js';

/**
 * The order these run in during generateSpriteSheet:
 *   keyer -> colour replace -> grade (full res) -> downscale
 *          -> sharpen (cell res) -> ... -> alpha bleed -> PNG (export)
 *
 * Each is unit-tested on its own; this checks they compose without any stage
 * corrupting the next one's assumptions.
 */
function keyedSubject(size = 24) {
  const data = new Uint8ClampedArray(size * size * 4);
  const centre = (size - 1) / 2;
  const radius = size * 0.3;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dist = Math.hypot(x - centre, y - centre);
      // A soft matte edge, the case every stage has to survive.
      const alpha = Math.round(255 * Math.max(0, Math.min(1, (radius + 1.5 - dist) / 3)));
      const o = ((y * size) + x) * 4;
      data[o] = alpha ? 60 + (x * 5) : 0;
      data[o + 1] = alpha ? 110 : 0;
      data[o + 2] = alpha ? 150 - (y * 3) : 0;
      data[o + 3] = alpha;
    }
  }
  return { data, width: size, height: size };
}

test('export pipeline: stages compose without corrupting the matte', async () => {
  const img = keyedSubject();
  const alphaBefore = [...img.data.filter((_, i) => i % 4 === 3)];

  applyColorGrade(img, {
    enabled: true, exposure: 0.4, contrast: 0.25,
    saturation: 0.1, vibrance: 0.6, temperature: 0.15
  });
  applySharpen(img, { enabled: true, amount: 0.8, radius: 1, threshold: 0.01 });
  applyAlphaBleed(img, 3);

  const alphaAfter = [...img.data.filter((_, i) => i % 4 === 3)];
  assert.deepEqual(alphaAfter, alphaBefore, 'no stage may move the silhouette');

  for (const channel of img.data) {
    assert.ok(Number.isFinite(channel) && channel >= 0 && channel <= 255, `bad channel ${channel}`);
  }

  const blob = await encodePNG(img);
  assert.equal(blob.type, 'image/png');
  assert.ok(blob.size > 0);
});

test('export pipeline: grading reaches partially transparent edge pixels', () => {
  // Edge pixels are the ones the keyer damages most, so a grade that skipped
  // them would leave the halo it was meant to correct.
  const img = keyedSubject();
  const edgeIndex = (() => {
    for (let p = 0; p < img.width * img.height; p++) {
      const a = img.data[(p * 4) + 3];
      if (a > 20 && a < 235) return p;
    }
    throw new Error('fixture has no soft edge');
  })();

  const before = [...img.data.subarray(edgeIndex * 4, (edgeIndex * 4) + 4)];
  applyColorGrade(img, { enabled: true, vibrance: 1, saturation: 0.5 });
  const after = [...img.data.subarray(edgeIndex * 4, (edgeIndex * 4) + 4)];

  assert.notDeepEqual(after.slice(0, 3), before.slice(0, 3), 'edge colour should be graded');
  assert.equal(after[3], before[3], 'edge alpha must not move');
});

test('export pipeline: bleed runs last and only fills what alpha hides', () => {
  const img = keyedSubject();
  const visibleBefore = [];
  for (let p = 0; p < img.width * img.height; p++) {
    if (img.data[(p * 4) + 3] > 0) visibleBefore.push([...img.data.subarray(p * 4, (p * 4) + 3)]);
  }

  applyAlphaBleed(img, 3);

  const visibleAfter = [];
  for (let p = 0; p < img.width * img.height; p++) {
    if (img.data[(p * 4) + 3] > 0) visibleAfter.push([...img.data.subarray(p * 4, (p * 4) + 3)]);
  }
  assert.deepEqual(visibleAfter, visibleBefore, 'bleed must not touch a pixel anyone can see');
});
