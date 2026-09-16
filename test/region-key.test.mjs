import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyRegionKeys, normalizeRegion, normalizeRegions } from '../public/js/region-key.js';
import { loadPNG } from './keyer/png.mjs';
import { cloneImageData } from './keyer/image.mjs';
import { loadKeyer, readSettings } from './keyer/keyer-runner.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

const GREEN = { r: 96, g: 190, b: 104, hex: '#60be68' };
const GREY = { r: 130, g: 130, b: 130 };

function makeImage(width, height, color = GREEN, alpha = 255) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    data[(index * 4) + 0] = color.r;
    data[(index * 4) + 1] = color.g;
    data[(index * 4) + 2] = color.b;
    data[(index * 4) + 3] = alpha;
  }
  return { data, width, height };
}

function setPixel(image, x, y, color, alpha = 255) {
  const offset = ((y * image.width) + x) * 4;
  image.data[offset] = color.r;
  image.data[offset + 1] = color.g;
  image.data[offset + 2] = color.b;
  image.data[offset + 3] = alpha;
}

const alphaAt = (image, x, y) => image.data[((y * image.width) + x) * 4 + 3];

const fullCircle = (overrides = {}) => ({
  shape: 'ellipse',
  cx: 0.5,
  cy: 0.5,
  rx: 0.5,
  ry: 0.5,
  colors: [GREEN],
  tolerance: 0.30,
  feather: 0.20,
  softness: 0,
  despill: 0,
  ...overrides
});

test('1. no regions leaves the image byte-identical', () => {
  const image = makeImage(16, 16);
  const before = Uint8ClampedArray.from(image.data);

  assert.deepEqual(applyRegionKeys(image, [], {}), { removedPixels: 0, regionsApplied: 0 });
  assert.deepEqual(image.data, before);

  applyRegionKeys(image, null, {});
  applyRegionKeys(image, [fullCircle({ enabled: false })], {});
  applyRegionKeys(image, [fullCircle({ colors: [] })], {});
  applyRegionKeys(image, [{ cx: 0.5, cy: 0.5, rx: 0, ry: 0, colors: [GREEN] }], {});
  assert.deepEqual(image.data, before, 'disabled, colourless and broken regions are all no-ops');
});

test('2. alpha never rises, including from zero', () => {
  const image = makeImage(9, 9);
  for (let y = 0; y < 9; y += 1) {
    for (let x = 0; x < 9; x += 1) {
      setPixel(image, x, y, GREEN, (x + y) % 2 === 0 ? 0 : 40);
    }
  }
  const before = Array.from({ length: 81 }, (_, i) => image.data[(i * 4) + 3]);

  applyRegionKeys(image, [fullCircle({ softness: 0.5 })], {});

  for (let index = 0; index < 81; index += 1) {
    assert.ok(image.data[(index * 4) + 3] <= before[index], `pixel ${index} alpha rose`);
  }
});

test('3. nothing outside the bounding box is read or written', () => {
  const image = makeImage(32, 32, GREEN);
  const touched = new Set();
  const proxied = {
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
  };

  // Centre (16, 16), radius 4 px: box is x,y in 12..20 inclusive.
  applyRegionKeys(proxied, [fullCircle({ cx: 0.5, cy: 0.5, rx: 4 / 32, ry: 4 / 32 })], {});

  assert.ok(touched.size > 0, 'the region did touch something');
  for (const pixel of touched) {
    const x = pixel % 32;
    const y = Math.floor(pixel / 32);
    assert.ok(x >= 12 && x <= 20 && y >= 12 && y <= 20, `pixel (${x},${y}) is outside the bounding box`);
  }
});

test('4. softness falls off monotonically from centre to rim', () => {
  const image = makeImage(41, 41);
  applyRegionKeys(image, [fullCircle({ rx: 20 / 41, ry: 20 / 41, softness: 1 })], {});

  const row = [];
  for (let x = 20; x <= 40; x += 1) row.push(alphaAt(image, x, 20));

  assert.equal(row[0], 0, 'the centre is fully removed');
  for (let index = 1; index < row.length; index += 1) {
    assert.ok(row[index] >= row[index - 1], `alpha dipped at x=${20 + index}: ${row[index - 1]} -> ${row[index]}`);
  }
  assert.equal(row[row.length - 1], 255, 'the rim is untouched');
});

test('5. a region drawn on the full source lands correctly inside a cropped, scaled cell', () => {
  // Source 100x100. The cell is the top-right quadrant, rendered at 2x into 100x100.
  const image = makeImage(100, 100, GREY);
  for (let y = 0; y < 100; y += 1) {
    for (let x = 0; x < 100; x += 1) setPixel(image, x, y, GREEN);
  }
  const geometry = { sourceWidth: 100, sourceHeight: 100, cropX: 50, cropY: 0, cropWidth: 50, cropHeight: 50 };

  // Source point (75, 25) -> cell point ((75-50)*2, (25-0)*2) = (50, 50); r 5 src -> 10 px.
  applyRegionKeys(image, [fullCircle({ cx: 0.75, cy: 0.25, rx: 0.05, ry: 0.05 })], geometry);

  assert.equal(alphaAt(image, 50, 50), 0, 'the mapped centre is removed');
  assert.equal(alphaAt(image, 50, 41), 0, 'still inside the mapped 10 px radius');
  assert.equal(alphaAt(image, 50, 39), 255, 'just outside the mapped radius');
  assert.equal(alphaAt(image, 20, 20), 255, 'the rest of the cell is untouched');
});

test('6. several colours in one region use the nearest distance', () => {
  const blue = { r: 40, g: 70, b: 200 };
  const image = makeImage(21, 21, GREY);
  setPixel(image, 10, 10, GREEN);
  setPixel(image, 11, 10, blue);
  setPixel(image, 12, 10, { r: 200, g: 40, b: 40 });

  applyRegionKeys(image, [fullCircle({ colors: [GREEN, blue], tolerance: 0.05, feather: 0 })], {});

  assert.equal(alphaAt(image, 10, 10), 0, 'first colour matched');
  assert.equal(alphaAt(image, 11, 10), 0, 'second colour matched');
  assert.equal(alphaAt(image, 12, 10), 255, 'an unlisted colour is left alone');
  assert.equal(alphaAt(image, 5, 5), 255, 'the grey background is left alone');
});

test('7. connected mode does not jump a one-pixel gap', () => {
  const image = makeImage(13, 5, GREY);
  for (const x of [1, 2, 3, 5, 6, 7, 8]) setPixel(image, x, 2, GREEN);

  applyRegionKeys(image, [fullCircle({
    cx: 0.5, cy: 0.5, rx: 0.5, ry: 0.5,
    connected: true,
    seed: { x: 2 / 13, y: 2 / 5 }
  })], {});

  for (const x of [1, 2, 3]) assert.equal(alphaAt(image, x, 2), 0, `x=${x} is on the seeded run`);
  for (const x of [5, 6, 7, 8]) assert.equal(alphaAt(image, x, 2), 255, `x=${x} is across the gap`);
  assert.equal(alphaAt(image, 4, 2), 255, 'the gap pixel itself does not match');
});

test('8. connected mode cannot escape the ellipse even when the colour keeps matching', () => {
  const image = makeImage(41, 9, GREY);
  for (let x = 0; x < 41; x += 1) setPixel(image, x, 4, GREEN);

  applyRegionKeys(image, [fullCircle({
    cx: 0.5, cy: 0.5, rx: 5 / 41, ry: 4 / 9,
    connected: true,
    seed: { x: 0.5, y: 0.5 }
  })], {});

  for (let x = 0; x < 41; x += 1) {
    const inside = Math.abs(x + 0.5 - 20.5) < 5;
    if (!inside) assert.equal(alphaAt(image, x, 4), 255, `x=${x} is outside the ellipse and must be untouched`);
  }
  assert.equal(alphaAt(image, 20, 4), 0, 'the seed itself went');
});

test('9. despill 0 leaves RGB alone; despill 1 only recolours pixels whose alpha dropped', () => {
  const build = () => makeImage(21, 21, GREEN);
  const rgbOf = (image, index) => Array.from(image.data.slice(index * 4, (index * 4) + 3));

  const plain = build();
  applyRegionKeys(plain, [fullCircle({ rx: 10 / 21, ry: 10 / 21, softness: 0.8, despill: 0 })], {});
  for (let index = 0; index < 21 * 21; index += 1) {
    assert.deepEqual(rgbOf(plain, index), [GREEN.r, GREEN.g, GREEN.b], `despill 0 changed RGB at ${index}`);
  }

  const spilled = build();
  applyRegionKeys(spilled, [fullCircle({ rx: 10 / 21, ry: 10 / 21, softness: 0.8, despill: 1 })], {});
  let changed = 0;
  for (let index = 0; index < 21 * 21; index += 1) {
    const rgb = rgbOf(spilled, index);
    if (rgb[0] === GREEN.r && rgb[1] === GREEN.g && rgb[2] === GREEN.b) continue;
    changed += 1;
    const alpha = spilled.data[(index * 4) + 3];
    assert.ok(alpha > 0 && alpha < 255, `recoloured pixel ${index} should be partly removed, alpha=${alpha}`);
  }
  assert.ok(changed > 0, 'despill 1 recoloured something');
});

test('10. normalizeRegion drops broken regions and keeps null bindings null', () => {
  const region = normalizeRegion({ cx: 0.5, cy: 0.5, rx: 0.2, colors: [GREEN] });
  assert.equal(region.frame, null, 'Number(null) === 0 must not turn a global region into frame 0');
  assert.equal(region.frameTime, null);
  assert.equal(region.ry, 0.2, 'ry falls back to rx');

  assert.equal(normalizeRegion({ cx: 0.5, cy: 0.5, rx: 0, colors: [GREEN] }), null);
  assert.equal(normalizeRegion({ cx: 0.5, rx: 0.2, colors: [GREEN] }), null);
  assert.equal(normalizeRegion(null), null);

  const clamped = normalizeRegion({ cx: 4, cy: -3, rx: 0.2, ry: 0.2, colors: [GREEN] });
  assert.equal(clamped.cx, 1);
  assert.equal(clamped.cy, 0);

  const framed = normalizeRegion({ cx: 0.5, cy: 0.5, rx: 0.2, colors: [GREEN], frame: 3, frameTime: 1.25 });
  assert.equal(framed.frame, 3);
  assert.equal(framed.frameTime, 1.25);
  assert.deepEqual(normalizeRegion(JSON.parse(JSON.stringify(framed))), framed, 'a JSON round-trip is stable');

  assert.equal(normalizeRegion({ cx: 0.5, cy: 0.5, rx: 0.2, colors: [GREEN], seed: { x: 0.5, y: 0.5 } }).seed, null,
    'a seed without connected mode is meaningless and dropped');
  assert.deepEqual(normalizeRegions([null, { cx: 0.5, cy: 0.5, rx: 0.2, colors: [GREEN] }]).length, 1);
});

/* ------------------------------------------------------------------ *
 * Integration: the measurement that justifies the whole feature.
 * ------------------------------------------------------------------ */

const DETAIL = { minX: 362, minY: 346, maxX: 405, maxY: 389 };
const DETAIL_PIXELS = ((DETAIL.maxX - DETAIL.minX) + 1) * ((DETAIL.maxY - DETAIL.minY) + 1);
const CIRCLE = { cx: 383.5, cy: 367.5, r: 31 };

const inDetail = (x, y) => x >= DETAIL.minX && x <= DETAIL.maxX && y >= DETAIL.minY && y <= DETAIL.maxY;
const inCircle = (x, y) => Math.hypot(x + 0.5 - CIRCLE.cx, y + 0.5 - CIRCLE.cy) < CIRCLE.r;

async function keyedSheet(extra = {}) {
  const keyer = await loadKeyer();
  const settings = await readSettings('clip-08');
  const source = await loadPNG(path.join(here, 'keyer/fixtures/clip-08/sheet.png'));
  const image = keyer.runSheet(cloneImageData(source), {
    ...settings.options,
    perCell: false,
    keyColors: settings.keyColors,
    ...extra
  });
  return image;
}

test('11. on clip-08 a circle removes the detail and changes nothing outside itself', async () => {
  const keyed = await keyedSheet();
  const before = Uint8ClampedArray.from(keyed.data);

  applyRegionKeys(keyed, [{
    shape: 'ellipse',
    cx: CIRCLE.cx / 512,
    cy: CIRCLE.cy / 512,
    rx: CIRCLE.r / 512,
    ry: CIRCLE.r / 512,
    colors: [GREEN],
    tolerance: 0.30,
    feather: 0.20,
    softness: 0
  }], {});

  let removedInDetail = 0;
  let changedOutsideCircle = 0;
  for (let y = 0; y < 512; y += 1) {
    for (let x = 0; x < 512; x += 1) {
      const offset = ((y * 512) + x) * 4;
      const changed = keyed.data[offset + 3] !== before[offset + 3];
      if (changed && inDetail(x, y) && before[offset + 3] > 0 && keyed.data[offset + 3] === 0) removedInDetail += 1;
      if (changed && !inCircle(x, y)) changedOutsideCircle += 1;
    }
  }

  assert.equal(changedOutsideCircle, 0, 'not one pixel outside the circle may change');
  assert.ok(removedInDetail >= DETAIL_PIXELS * 0.95,
    `expected >= 95% of the ${DETAIL_PIXELS} px detail removed, got ${removedInDetail}`);
});

test('12. the same pick made global wrecks thousands of pixels elsewhere', async () => {
  const keyed = await keyedSheet();
  const global = await keyedSheet({
    keyColors: [{ r: 24, g: 198, b: 62 }, GREEN],
    keyRegions: [{ hex: GREEN.hex, matchMode: 'global' }]
  });

  let changedOutsideDetail = 0;
  for (let y = 0; y < 512; y += 1) {
    for (let x = 0; x < 512; x += 1) {
      const offset = ((y * 512) + x) * 4;
      if (inDetail(x, y)) continue;
      if (global.data[offset + 3] !== keyed.data[offset + 3]) changedOutsideDetail += 1;
    }
  }

  assert.ok(changedOutsideDetail >= 12000,
    `a global pick is expected to wreck >= 12000 px outside the detail, measured ${changedOutsideDetail}`);
});

test('13. eight regions on a 4096x4096 sheet stay under 200 ms', () => {
  const size = 4096;
  const image = makeImage(size, size, GREEN);
  const regions = Array.from({ length: 8 }, (_, index) => fullCircle({
    cx: (500 + (index * 400)) / size,
    cy: (500 + (index * 400)) / size,
    rx: 100 / size,
    ry: 100 / size,
    softness: 0.2
  }));

  const started = performance.now();
  applyRegionKeys(image, regions, {});
  const elapsed = performance.now() - started;

  assert.ok(elapsed < 200, `eight regions took ${elapsed.toFixed(1)} ms`);
});
