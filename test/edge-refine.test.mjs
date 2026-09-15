import path from 'node:path';
import fs from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import { refineEdges } from '../public/js/edge-refine.js';
import { runKeyer } from '../public/js/keyer/index.js';
import { colorMetrics, keyDistance } from '../public/js/keyer/color.js';
import { loadPNG } from './keyer/png.mjs';
import { ImageData, cloneImageData, fillRect, fillCircle, drawLine } from './keyer/image.mjs';
import { bandSAD } from './keyer/metrics.mjs';

/**
 * Edge Refine runs after the connected keyer on the Clean Sprite Sheet tab.
 * Every quality number here is measured on the real keyer's output over the
 * committed corpus — nothing is stubbed, so a regression in either module
 * shows up.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(here, 'keyer/fixtures');
const CELL = 256;
const WHITE = [255, 255, 255];

const sheetSettings = JSON.parse(await fs.readFile(path.join(FIXTURES, 'clip-08/settings.json'), 'utf8'));
const sheet = await loadPNG(path.join(FIXTURES, 'clip-08/sheet.png'));
const { similarity, feather, subjectProtection } = sheetSettings.options;
const tuning = { similarity, feather, subjectProtection };

function keySheet(source = sheet, overrides = {}) {
  return runKeyer(cloneImageData(source), {
    ...sheetSettings.options,
    keyColors: sheetSettings.keyColors,
    connected: true,
    thresholdProfile: 'sheet',
    ...overrides
  }).imageData;
}

function refined(options = {}, keyed = keySheet()) {
  const before = cloneImageData(keyed);
  const result = refineEdges(keyed, sheet, { keyColors: sheetSettings.keyColors, ...tuning, ...options });
  return { before, after: result.imageData, stats: result.stats };
}

/** Same threshold formula as the connected matte. */
function traversalThreshold() {
  return 0.015 + (0.28 * Math.pow(similarity, 1.4)) + 0.003 + (0.11 * Math.pow(feather, 1.45));
}

/**
 * Visible pixels with an 8-neighbour that is fully transparent.
 * `countsColour(x, y)` limits the key-coloured tally to pixels whose true
 * colour is known not to be key-like.
 */
function edgeStats(image, keyColor, countsColour = () => true) {
  const { data, width, height } = image;
  const luminanceWeight = 0.08 + (0.9 * Math.pow(subjectProtection, 1.5));
  const key = colorMetrics(keyColor);
  const near = 3 * traversalThreshold();
  let band = 0;
  let opaque = 0;
  let colourBand = 0;
  let contaminated = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = ((y * width) + x) * 4;
      if (data[offset + 3] === 0) continue;
      let touchesClear = false;
      for (let dy = -1; dy <= 1 && !touchesClear; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if ((dx === 0 && dy === 0) || nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          if (data[(((ny * width) + nx) * 4) + 3] === 0) { touchesClear = true; break; }
        }
      }
      if (!touchesClear) continue;
      band += 1;
      if (data[offset + 3] === 255) opaque += 1;
      if (!countsColour(x, y)) continue;
      colourBand += 1;
      const pixel = colorMetrics({ r: data[offset], g: data[offset + 1], b: data[offset + 2] });
      if (data[offset + 3] >= 200 && keyDistance(pixel, key, luminanceWeight) < near) contaminated += 1;
    }
  }
  return { band, opaqueRatio: opaque / band, contaminatedRatio: contaminated / colourBand };
}

/** Alpha of one cell, paired with a matte whose red channel is coverage. */
function cellBandSAD(image, x0, y0, matte) {
  const current = new Uint8ClampedArray(CELL * CELL * 4);
  const truth = new Uint8ClampedArray(CELL * CELL * 4);
  for (let y = 0; y < CELL; y += 1) {
    for (let x = 0; x < CELL; x += 1) {
      const i = ((y * CELL) + x) * 4;
      current[i + 3] = image.data[((((y0 + y) * image.width) + x0 + x) * 4) + 3];
      truth[i + 3] = matte.data[i];
    }
  }
  return bandSAD(current, truth);
}

/** True when a pixel is within `radius` (chessboard) of an alpha-0 pixel. */
function nearClear(image, x, y, radius) {
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= image.width || ny >= image.height) continue;
      if (image.data[(((ny * image.width) + nx) * 4) + 3] === 0) return true;
    }
  }
  return false;
}

// Clip-08 cells, as drawn by corpus-generator.mjs.
const clip1Matte = await loadPNG(path.join(FIXTURES, 'clip-01/matte-000.png'));
const clip7Matte = await loadPNG(path.join(FIXTURES, 'clip-07/matte-000.png'));
const clip2Matte = await loadPNG(path.join(FIXTURES, 'clip-02/matte-001.png'));

// The clip-03 cell (bottom right) draws its subject in (72,168,88), which is
// itself within 3× traversal of the key, so a correct edge there reads as
// "still key-coloured". Its quality is covered by its own bandSAD test; the
// colour tally runs on the three cells with a matte, like bandSAD does.
const hasMatte = (x, y) => !(x >= CELL && y >= CELL);

test('edge refine: clip-08 quality gate at default settings', () => {
  const { before, after } = refined();
  const keyerEdges = edgeStats(before, sheetSettings.keyColors[0], hasMatte);
  const edges = edgeStats(after, sheetSettings.keyColors[0], hasMatte);

  // Sanity: the fixture still shows the problem this module exists for.
  assert.ok(keyerEdges.opaqueRatio > 0.9, `keyer edge opaque ratio ${keyerEdges.opaqueRatio}`);

  assert.ok(edges.opaqueRatio <= 0.05, `edge alpha 255: ${(edges.opaqueRatio * 100).toFixed(1)} %`);
  assert.ok(edges.contaminatedRatio <= 0.01, `edge still key-coloured: ${(edges.contaminatedRatio * 100).toFixed(1)} %`);

  const c1 = cellBandSAD(after, 0, 0, clip1Matte);
  const c7 = cellBandSAD(after, CELL, 0, clip7Matte);
  const c2 = cellBandSAD(after, 0, CELL, clip2Matte);
  assert.ok(c1 <= 30, `bandSAD clip-01 ${c1.toFixed(1)}`);
  assert.ok(c7 <= 10, `bandSAD clip-07 ${c7.toFixed(1)}`);
  assert.ok(c2 <= 78, `bandSAD clip-02 ${c2.toFixed(1)}`);
});

test('edge refine: the subject core is byte-identical', () => {
  for (const edgeWidth of [1, 2, 3]) {
    const { before, after } = refined({ edgeWidth });
    let changed = 0;
    for (let y = 0; y < before.height; y += 1) {
      for (let x = 0; x < before.width; x += 1) {
        if (nearClear(before, x, y, edgeWidth)) continue;
        const offset = ((y * before.width) + x) * 4;
        for (let c = 0; c < 4; c += 1) {
          if (after.data[offset + c] !== before.data[offset + c]) { changed += 1; break; }
        }
      }
    }
    assert.equal(changed, 0, `edgeWidth ${edgeWidth}: ${changed} core pixels changed`);
  }
});

test('edge refine: alpha never increases', () => {
  const variants = [{}, { smooth: 0 }, { smooth: 1 }, { edgeWidth: 3 }, { pixelArt: true }, { decontaminate: false }];
  for (const options of variants) {
    for (const cleanupRadius of [0, 2]) {
      const { before, after } = refined(options, keySheet(sheet, { cleanupRadius }));
      for (let offset = 3; offset < before.data.length; offset += 4) {
        assert.ok(after.data[offset] <= before.data[offset],
          `${JSON.stringify(options)} cleanup ${cleanupRadius}: alpha rose at pixel ${(offset - 3) / 4}`);
      }
    }
  }
});

test('edge refine: decontaminate=false writes alpha only', () => {
  const { before, after } = refined({ decontaminate: false });
  let alphaChanged = 0;
  for (let offset = 0; offset < before.data.length; offset += 4) {
    assert.equal(after.data[offset], before.data[offset]);
    assert.equal(after.data[offset + 1], before.data[offset + 1]);
    assert.equal(after.data[offset + 2], before.data[offset + 2]);
    if (after.data[offset + 3] !== before.data[offset + 3]) alphaChanged += 1;
  }
  assert.ok(alphaChanged > 0, 'alpha should still be refined');
});

test('edge refine: neutral backdrop does not break and is no worse than the keyer', () => {
  const size = 128;
  const source = new ImageData(size, size);
  const matte = new ImageData(size, size);
  fillRect(source, 0, 0, size, size, WHITE);
  fillRect(matte, 0, 0, size, size, [0, 0, 0]);
  fillCircle(source, 64, 64, 36, [200, 30, 40]);
  fillCircle(matte, 64, 64, 36, WHITE);
  // A thin strand forces the colour-difference branch, which must stand down
  // on a backdrop with no chroma.
  drawLine(source, 10, 10, 50, 118, 1, [200, 30, 40]);
  drawLine(matte, 10, 10, 50, 118, 1, WHITE);

  const white = [{ r: 255, g: 255, b: 255 }];
  const keyed = runKeyer(cloneImageData(source), {
    ...sheetSettings.options, keyColors: white, connected: true, thresholdProfile: 'sheet'
  }).imageData;
  const keyerSAD = scoreFull(keyed, matte);
  const { stats } = refineEdges(keyed, source, { keyColors: white, ...tuning });

  assert.equal(stats.colorDiff, 0, 'colour difference must not run on a neutral backdrop');
  const refinedSAD = scoreFull(keyed, matte);
  assert.ok(Number.isFinite(refinedSAD));
  assert.ok(refinedSAD <= keyerSAD, `bandSAD ${refinedSAD.toFixed(1)} > keyer ${keyerSAD.toFixed(1)}`);
  assert.ok(keyed.data[((64 * size) + 64) * 4 + 3] === 255, 'subject centre must stay opaque');
});

function scoreFull(image, matte) {
  const truth = new Uint8ClampedArray(matte.data.length);
  for (let offset = 0; offset < matte.data.length; offset += 4) truth[offset + 3] = matte.data[offset];
  return bandSAD(image.data, truth);
}

test('edge refine: subject hue close to the key (clip-03 cell) is no worse', () => {
  // drawClip3(2): drift 4, the inner circle lies inside the outer one.
  const matte = new ImageData(CELL, CELL);
  fillRect(matte, 0, 0, CELL, CELL, [0, 0, 0]);
  fillCircle(matte, 128, 132, 58, WHITE);

  const keyed = keySheet();
  const keyerSAD = cellBandSAD(keyed, CELL, CELL, matte);
  refineEdges(keyed, sheet, { keyColors: sheetSettings.keyColors, ...tuning });
  const refinedSAD = cellBandSAD(keyed, CELL, CELL, matte);
  assert.ok(refinedSAD <= keyerSAD, `bandSAD ${refinedSAD.toFixed(1)} > keyer ${keyerSAD.toFixed(1)}`);
});

test('edge refine: pixel art edges stay hard', () => {
  // A binary keyed input: every alpha must still be 0 or 255 afterwards.
  const size = 96;
  const source = new ImageData(size, size);
  fillRect(source, 0, 0, size, size, [24, 198, 62]);
  fillCircle(source, 48, 48, 30, [188, 46, 38]);
  const keyed = cloneImageData(source);
  for (let offset = 0; offset < keyed.data.length; offset += 4) {
    const isBackdrop = source.data[offset] === 24 && source.data[offset + 1] === 198 && source.data[offset + 2] === 62;
    keyed.data[offset + 3] = isBackdrop ? 0 : 255;
  }
  const before = cloneImageData(keyed);
  refineEdges(keyed, source, { keyColors: sheetSettings.keyColors, ...tuning, pixelArt: true, smooth: 1 });
  let rgbChanged = 0;
  for (let offset = 0; offset < keyed.data.length; offset += 4) {
    assert.ok(keyed.data[offset + 3] === 0 || keyed.data[offset + 3] === 255, `alpha ${keyed.data[offset + 3]}`);
    if (keyed.data[offset] !== before.data[offset] || keyed.data[offset + 1] !== before.data[offset + 1]) rgbChanged += 1;
  }
  assert.ok(rgbChanged > 0, 'pixel art still decontaminates RGB');

  // On the real keyer output a band pixel is either cleared or keeps the
  // keyer's own alpha — never a new translucent value.
  const real = refined({ pixelArt: true });
  for (let offset = 3; offset < real.before.data.length; offset += 4) {
    const value = real.after.data[offset];
    assert.ok(value === 0 || value === real.before.data[offset], `pixel ${(offset - 3) / 4}: ${value}`);
  }
});

test('edge refine: pixels outside rect are untouched', () => {
  const rect = { x0: CELL, y0: 0, width: CELL, height: CELL };
  const { before, after, stats } = refined({ rect });
  assert.ok(stats.band > 0);
  let inside = 0;
  for (let y = 0; y < before.height; y += 1) {
    for (let x = 0; x < before.width; x += 1) {
      const offset = ((y * before.width) + x) * 4;
      const within = x >= rect.x0 && x < rect.x0 + rect.width && y >= rect.y0 && y < rect.y0 + rect.height;
      for (let c = 0; c < 4; c += 1) {
        if (after.data[offset + c] === before.data[offset + c]) continue;
        assert.ok(within, `pixel ${x},${y} outside rect changed`);
        inside += 1;
      }
    }
  }
  assert.ok(inside > 0, 'the rect itself should be refined');
});

test('edge refine: degenerate inputs do not throw', () => {
  const image = (w, h, alpha) => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let offset = 0; offset < data.length; offset += 4) {
      data[offset] = 24; data[offset + 1] = 198; data[offset + 2] = 62; data[offset + 3] = alpha;
    }
    return new ImageData(data, w, h);
  };
  const keys = { keyColors: sheetSettings.keyColors };
  for (const [w, h] of [[1, 1], [8, 8], [1, 9]]) {
    for (const alpha of [0, 255]) {
      const keyed = image(w, h, alpha);
      const before = new Uint8ClampedArray(keyed.data);
      assert.doesNotThrow(() => refineEdges(keyed, image(w, h, 255), keys));
      assert.deepEqual(keyed.data, before, `${w}x${h} alpha ${alpha} should be unchanged`);
    }
  }
  assert.doesNotThrow(() => refineEdges(image(4, 4, 0), image(2, 2, 255), keys));
  assert.doesNotThrow(() => refineEdges(image(4, 4, 0), image(4, 4, 255), { ...keys, rect: { x0: 9, y0: 9, width: 3, height: 3 } }));
  assert.doesNotThrow(() => refineEdges(image(4, 4, 255), image(4, 4, 255), {}));
});

test('edge refine: 4096×4096 sheet refines in under 1.5 s', { skip: process.env.EDGE_REFINE_BENCH !== '1' }, () => {
  const size = 4096;
  const source = new ImageData(size, size);
  fillRect(source, 0, 0, size, size, [24, 198, 62]);
  for (let cy = 64; cy < size; cy += 128) {
    for (let cx = 64; cx < size; cx += 128) fillCircle(source, cx, cy, 44, [188, 46, 38]);
  }
  const keyed = cloneImageData(source);
  for (let offset = 0; offset < keyed.data.length; offset += 4) {
    if (source.data[offset] === 24 && source.data[offset + 1] === 198) keyed.data[offset + 3] = 0;
  }
  const start = performance.now();
  const { stats } = refineEdges(keyed, source, { keyColors: sheetSettings.keyColors, ...tuning });
  const elapsed = performance.now() - start;
  console.log(`edge refine 4096x4096: ${elapsed.toFixed(0)} ms, band ${stats.band}`);
  assert.ok(elapsed < 1500, `took ${elapsed.toFixed(0)} ms`);
});
