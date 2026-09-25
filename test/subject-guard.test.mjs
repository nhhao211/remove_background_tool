import test from 'node:test';
import assert from 'node:assert/strict';

import { applySubjectGuard, minThicknessFor, luminanceWeightFor } from '../public/js/subject-guard.js';
import { runKeyer } from '../public/js/keyer/index.js';
import { ImageData, cloneImageData, createRng, fillRect, fillCircle, addNoise } from './keyer/image.mjs';

/**
 * Subject Guard runs after either keyer and gives back what the keyer took
 * from inside the subject. Most tests build the "keyed" image by hand so each
 * one isolates a single rule; the last two run the real keyers end to end.
 */

const KEY = [0, 36, 245];
const KEY_COLOR = { r: KEY[0], g: KEY[1], b: KEY[2] };
const SUBJECT = [220, 120, 60];   // far from the key
const NAVY = [20, 40, 140];       // near the key, but not the backdrop
const OPTIONS = { keyColors: [KEY_COLOR], luminanceWeight: luminanceWeightFor(0.5) };

/** Source scene: key backdrop with a little noise and a disc of subject. */
function scene(width = 64, height = 64, seed = 3) {
  const image = new ImageData(width, height);
  fillRect(image, 0, 0, width, height, KEY);
  addNoise(image, 0.02, createRng(seed));
  return image;
}

/**
 * A stand-in keyer: alpha 0 wherever `removed(x, y)` says so, source
 * otherwise. Returns a new image; the source is untouched.
 */
function keyBy(source, removed) {
  const keyed = cloneImageData(source);
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      if (removed(x, y)) keyed.data[(((y * source.width) + x) * 4) + 3] = 0;
    }
  }
  return keyed;
}

/** Keyer that removes exactly the pixels painted with one of `colors`. */
function keyColours(source, painted, colors) {
  return keyBy(source, (x, y) => colors.some((c) => painted(x, y, c)));
}

const alphaAt = (image, x, y) => image.data[(((y * image.width) + x) * 4) + 3];
const rgbAt = (image, x, y) => Array.from(image.data.subarray(((y * image.width) + x) * 4, (((y * image.width) + x) * 4) + 3));

function assertAlphaBounds(keyed, guarded, source) {
  for (let i = 3; i < source.data.length; i += 4) {
    assert.ok(guarded.data[i] >= keyed.data[i], `alpha dropped at pixel ${i >> 2}`);
    assert.ok(guarded.data[i] <= source.data[i], `alpha above source at pixel ${i >> 2}`);
  }
}

/** Disc of subject with a navy patch in the middle, drawn onto `image`. */
function bodyWithPatch(image, { cx = 32, cy = 32, r = 22, patch = 10 } = {}) {
  fillCircle(image, cx, cy, r, SUBJECT);
  const x0 = cx - (patch >> 1);
  const y0 = cy - (patch >> 1);
  fillRect(image, x0, y0, patch, patch, NAVY);
  return {
    inBody: (x, y) => ((x - cx) ** 2) + ((y - cy) ** 2) <= r * r,
    inPatch: (x, y) => x >= x0 && x < x0 + patch && y >= y0 && y < y0 + patch
  };
}

test('1. no key colours or nothing removed: byte-identical, zero stats', () => {
  const source = scene();
  const { inBody, inPatch } = bodyWithPatch(source);
  const keyed = keyBy(source, (x, y) => !inBody(x, y) || inPatch(x, y));

  const noKeys = cloneImageData(keyed);
  const stats = applySubjectGuard(noKeys, source, { ...OPTIONS, keyColors: [] });
  assert.deepEqual(noKeys.data, keyed.data);
  assert.equal(stats.restoredPixels, 0);

  const untouched = cloneImageData(source);
  applySubjectGuard(untouched, source, OPTIONS);
  assert.deepEqual(untouched.data, source.data);

  const mismatched = cloneImageData(keyed);
  applySubjectGuard(mismatched, new ImageData(10, 10), OPTIONS);
  assert.deepEqual(mismatched.data, keyed.data);
});

test('2. an enclosed near-key patch in the body is restored, colour and all', () => {
  const source = scene();
  const { inBody, inPatch } = bodyWithPatch(source);
  const keyed = keyBy(source, (x, y) => !inBody(x, y) || inPatch(x, y));
  const guarded = cloneImageData(keyed);
  const stats = applySubjectGuard(guarded, source, OPTIONS);

  assertAlphaBounds(keyed, guarded, source);
  assert.equal(stats.holePixels, 100);
  for (let y = 27; y < 37; y += 1) {
    for (let x = 27; x < 37; x += 1) {
      assert.equal(alphaAt(guarded, x, y), 255, `patch pixel (${x},${y})`);
      assert.deepEqual(rgbAt(guarded, x, y), rgbAt(source, x, y));
    }
  }
  // The backdrop stays gone.
  for (const [x, y] of [[0, 0], [63, 63], [2, 32], [32, 2]]) assert.equal(alphaAt(guarded, x, y), 0);
});

test('3. an enclosed pocket of backdrop stays removed unless smaller than minPocket', () => {
  // A ring of subject around a pocket of plain key colour: the gap between an
  // arm and the torso, seen from the camera.
  const source = scene();
  fillCircle(source, 32, 32, 22, SUBJECT);
  fillCircle(source, 32, 32, 8, KEY);
  const inPocket = (x, y) => ((x - 32) ** 2) + ((y - 32) ** 2) <= 64;
  const inBody = (x, y) => ((x - 32) ** 2) + ((y - 32) ** 2) <= 22 * 22;
  const keyed = keyBy(source, (x, y) => !inBody(x, y) || inPocket(x, y));

  const guarded = cloneImageData(keyed);
  const stats = applySubjectGuard(guarded, source, OPTIONS);
  assert.equal(stats.holePixels, 0);
  assert.equal(alphaAt(guarded, 32, 32), 0);
  assert.deepEqual(guarded.data, keyed.data);

  // Below minPocket the same pocket is noise, and filled.
  const filled = cloneImageData(keyed);
  applySubjectGuard(filled, source, { ...OPTIONS, minPocket: 10_000 });
  assert.equal(alphaAt(filled, 32, 32), 255);
});

test('4. leakGuard seals a 1 px crack in the outline; leakGuard 0 does not', () => {
  const source = scene();
  const { inBody, inPatch } = bodyWithPatch(source, { patch: 8 });
  // A 1 px crack of key colour from the rim to the patch.
  fillRect(source, 32, 0, 1, 29, KEY);
  const inCrack = (x, y) => x === 32 && y < 29;
  const keyed = keyBy(source, (x, y) => !inBody(x, y) || inPatch(x, y) || inCrack(x, y));

  const sealed = cloneImageData(keyed);
  applySubjectGuard(sealed, source, { ...OPTIONS, leakGuard: 1 });
  assertAlphaBounds(keyed, sealed, source);
  assert.equal(alphaAt(sealed, 32, 32), 255, 'patch behind a 1 px crack is enclosed');

  const open = cloneImageData(keyed);
  applySubjectGuard(open, source, { ...OPTIONS, leakGuard: 0 });
  assert.equal(alphaAt(open, 32, 32), 0, 'with no guard the crack is a path from the border');
});

test('5. a thick near-key limb joined to the body is restored; a thin rim is not', () => {
  const source = scene(96, 96);
  fillCircle(source, 48, 34, 20, SUBJECT);
  // Navy leg: 16 px wide, hanging from the body.
  fillRect(source, 40, 50, 16, 30, NAVY);
  // Navy rim: 2 px, along the top of the body.
  fillRect(source, 34, 12, 28, 2, NAVY);
  const painted = (x, y, c) => rgbAt(source, x, y).every((v, i) => v === c[i]);
  const keyed = keyBy(source, (x, y) => !painted(x, y, SUBJECT));

  const guarded = cloneImageData(keyed);
  const stats = applySubjectGuard(guarded, source, { ...OPTIONS, strength: 0.5 });
  assertAlphaBounds(keyed, guarded, source);
  assert.ok(stats.backdropTolerance < 0.1, 'the backdrop, not the leg, sets the tolerance');
  assert.ok(stats.thickPixels > 0);
  assert.equal(alphaAt(guarded, 48, 66), 255, 'middle of the leg');
  assert.deepEqual(rgbAt(guarded, 48, 66), NAVY);
  assert.equal(alphaAt(guarded, 48, 12), 0, 'thin rim');
  assert.equal(alphaAt(guarded, 48, 13), 0, 'thin rim');

  // Lower strength asks for thicker masses: at 0 (16 px) the leg no longer counts.
  assert.equal(minThicknessFor(0), 16);
  assert.equal(minThicknessFor(1), 3);
  const strict = cloneImageData(keyed);
  applySubjectGuard(strict, source, { ...OPTIONS, strength: 0 });
  assert.equal(alphaAt(strict, 48, 66), 0);
});

test('6. a thick near-key mass off on its own (a shadow) is not the subject', () => {
  const source = scene(96, 96);
  fillCircle(source, 30, 30, 14, SUBJECT);
  fillRect(source, 64, 64, 20, 20, NAVY);
  const keyed = keyBy(source, (x, y) => !(((x - 30) ** 2) + ((y - 30) ** 2) <= 196));
  const guarded = cloneImageData(keyed);
  const stats = applySubjectGuard(guarded, source, { ...OPTIONS, strength: 1 });
  assert.ok(stats.backdropTolerance < 0.1, 'the block is judged as a mass, not as backdrop');
  assert.equal(stats.thickPixels, 0);
  assert.equal(alphaAt(guarded, 74, 74), 0);
});

test('7. rect: pixels outside it are neither read nor written', () => {
  const source = scene(64, 32);
  fillCircle(source, 16, 16, 12, SUBJECT);
  fillRect(source, 13, 13, 6, 6, NAVY);
  fillCircle(source, 48, 16, 12, SUBJECT);
  fillRect(source, 45, 13, 6, 6, NAVY);
  const keyed = keyBy(source, (x, y) => rgbAt(source, x, y).join() !== SUBJECT.join());
  const rect = { x0: 0, y0: 0, width: 32, height: 32 };

  const touched = new Set();
  const spy = (image) => ({
    width: image.width,
    height: image.height,
    data: new Proxy(image.data, {
      get(target, key) {
        if (typeof key === 'string' && /^\d+$/.test(key)) touched.add(Number(key) >> 2);
        return Reflect.get(target, key);
      },
      set(target, key, value) {
        if (typeof key === 'string' && /^\d+$/.test(key)) touched.add(Number(key) >> 2);
        return Reflect.set(target, key, value);
      }
    })
  });
  const guarded = cloneImageData(keyed);
  const stats = applySubjectGuard(spy(guarded), spy(source), { ...OPTIONS, rect });

  assert.ok(stats.holePixels > 0, 'the left cell was worked on');
  for (const pixel of touched) {
    assert.ok(pixel % 64 < 32, `pixel (${pixel % 64},${Math.floor(pixel / 64)}) is outside the rect`);
  }
  assert.equal(alphaAt(guarded, 16, 16), 255);
  assert.equal(alphaAt(guarded, 48, 16), 0, 'the right cell is untouched');
});

test('8. a seed point marks an enclosed pocket as background wherever it is', () => {
  const source = scene();
  const { inBody, inPatch } = bodyWithPatch(source, { patch: 4 });
  fillRect(source, 30, 30, 4, 4, KEY);
  const keyed = keyBy(source, (x, y) => !inBody(x, y) || inPatch(x, y));

  const noSeed = cloneImageData(keyed);
  applySubjectGuard(noSeed, source, { ...OPTIONS, minPocket: 10_000 });
  assert.equal(alphaAt(noSeed, 31, 31), 255);

  const seeded = cloneImageData(keyed);
  applySubjectGuard(seeded, source, { ...OPTIONS, minPocket: 10_000, seedPoints: [{ x: 31, y: 31 }] });
  assert.equal(alphaAt(seeded, 31, 31), 0);
});

test('9. despill deep inside the body is undone; the edge keeps the keyer colour', () => {
  const source = scene();
  fillCircle(source, 32, 32, 22, SUBJECT);
  const inBody = (x, y) => ((x - 32) ** 2) + ((y - 32) ** 2) <= 22 * 22;
  const keyed = keyBy(source, (x, y) => !inBody(x, y));
  // A keyer that despilled the whole body: blue pulled down everywhere.
  for (let i = 0; i < keyed.data.length; i += 4) {
    if (keyed.data[i + 3] > 0) keyed.data[i + 2] = Math.max(0, keyed.data[i + 2] - 30);
  }

  const guarded = cloneImageData(keyed);
  applySubjectGuard(guarded, source, OPTIONS);
  assert.deepEqual(rgbAt(guarded, 32, 32), SUBJECT);
  assert.deepEqual(rgbAt(guarded, 32, 10), rgbAt(keyed, 32, 10), 'rim pixel next to the backdrop');

  const colourOff = cloneImageData(keyed);
  applySubjectGuard(colourOff, source, { ...OPTIONS, restoreColor: false });
  assert.deepEqual(colourOff.data, keyed.data);
});

/** Scene for the video keyer: noisy backdrop, red shirt with a royal-blue logo. */
function realScene() {
  const source = scene(160, 120, 11);
  fillCircle(source, 80, 40, 16, [230, 180, 140]);
  fillRect(source, 55, 55, 50, 50, [200, 60, 50]);
  fillRect(source, 68, 68, 24, 24, [60, 90, 240]); // royal-blue logo on the shirt
  return source;
}

test('10. video keyer: the royal-blue logo punched out of the shirt comes back', () => {
  const source = realScene();
  const keyed = runKeyer(cloneImageData(source), {
    similarity: 0.55, blend: 0.18, spill: 0.55, subjectProtection: 0.5,
    cleanupRadius: 0, chromaSmoothEnabled: false, keyColors: [KEY_COLOR]
  }).imageData;
  assert.ok(alphaAt(keyed, 80, 80) < 128, 'precondition: the keyer takes the logo');

  const guarded = cloneImageData(keyed);
  applySubjectGuard(guarded, source, OPTIONS);
  assertAlphaBounds(keyed, guarded, source);
  assert.equal(alphaAt(guarded, 80, 80), 255);
  assert.deepEqual(rgbAt(guarded, 80, 80), rgbAt(source, 80, 80));
  for (const [x, y] of [[2, 2], [150, 110], [20, 60], [140, 60]]) assert.equal(alphaAt(guarded, x, y), 0);
});

test('11. sheet keyer: the fill that poured through a gap in the outline is taken back', () => {
  // A green slime on a green sheet: a dark outline is all that keeps the
  // connected fill out of a body whose colour sits right next to the key.
  for (const [gap, leakGuard] of [[1, 1], [2, 1], [3, 2]]) {
    const source = new ImageData(64, 64);
    fillRect(source, 0, 0, 64, 64, [0, 255, 0]);
    fillCircle(source, 32, 32, 20, [20, 60, 20]);
    fillCircle(source, 32, 32, 18, [20, 250, 20]);
    fillCircle(source, 25, 26, 3, [255, 255, 255]);
    fillCircle(source, 39, 26, 3, [255, 255, 255]);
    fillRect(source, 11, 32, 4, gap, [20, 250, 20]); // the gap in the outline
    const result = runKeyer(cloneImageData(source), {
      connected: true, autoDetect: true, keyColors: [], similarity: 0.48, feather: 0.2,
      spill: 0.55, preserveColors: true, subjectProtection: 0.55, cleanupRadius: 0
    });
    const keyed = result.imageData;
    assert.ok(alphaAt(keyed, 32, 40) < 128, `precondition (gap ${gap}): the fill reached the body`);

    const options = { keyColors: result.keyColors, luminanceWeight: luminanceWeightFor(0.55), minPocket: 1 };
    const guarded = cloneImageData(keyed);
    applySubjectGuard(guarded, source, { ...options, leakGuard });
    assertAlphaBounds(keyed, guarded, source);
    assert.equal(alphaAt(guarded, 32, 40), 255, `gap ${gap}, leakGuard ${leakGuard}`);
    assert.deepEqual(rgbAt(guarded, 32, 40), [20, 250, 20]);
    assert.equal(alphaAt(guarded, 1, 1), 0);

    // One step less than the gap needs, and the gap is a path again.
    const tooLow = cloneImageData(keyed);
    applySubjectGuard(tooLow, source, { ...options, leakGuard: leakGuard - 1 });
    assert.equal(alphaAt(tooLow, 32, 40), 0, `gap ${gap}, leakGuard ${leakGuard - 1}`);
  }
});
