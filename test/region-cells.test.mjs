import test from 'node:test';
import assert from 'node:assert/strict';

import { applyRegionKeys, normalizeRegion } from '../public/js/region-key.js';
import {
  applyRegionAcrossCells, baseRegionId, cellIndexAt, cellRects, cellShift,
  clampCentreToCell, homeCellIndex, regionCopyForCell, replicateRegion
} from '../public/js/region-cells.js';

const GREEN = { r: 96, g: 190, b: 104, hex: '#60be68' };
const GREY = { r: 130, g: 130, b: 130 };

// 3 cols × 2 rows of 20×20 cells.
const W = 60;
const H = 40;
const ROWS = 2;
const COLS = 3;

function makeImage(width, height, color) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    data.set([color.r, color.g, color.b, 255], index * 4);
  }
  return { data, width, height };
}

function fillRect(image, x0, y0, w, h, color) {
  for (let y = y0; y < y0 + h; y += 1) {
    for (let x = x0; x < x0 + w; x += 1) image.data.set([color.r, color.g, color.b, 255], ((y * image.width) + x) * 4);
  }
}

const alphaAt = (image, x, y) => image.data[((y * image.width) + x) * 4 + 3];
const clone = (image) => ({ ...image, data: new Uint8ClampedArray(image.data) });

// A 4×4 green detail at (5,5) of every cell and a green "costume" pixel block
// at (14,14) of every cell. The circle covers the detail, not the costume.
function sheet() {
  const image = makeImage(W, H, GREY);
  for (const cell of cellRects(W, H, ROWS, COLS)) {
    fillRect(image, cell.x0 + 5, cell.y0 + 5, 4, 4, GREEN);
    fillRect(image, cell.x0 + 14, cell.y0 + 14, 3, 3, GREEN);
  }
  return image;
}

const region = (overrides = {}) => normalizeRegion({
  id: 'region-1',
  cx: 7 / W,
  cy: 7 / H,
  rx: 4 / W,
  ry: 4 / H,
  colors: [GREEN],
  tolerance: 0.3,
  softness: 0,
  allFrames: true,
  ...overrides
});

test('normalizeRegion carries allFrames and defaults it to false', () => {
  assert.equal(region().allFrames, true);
  assert.equal(normalizeRegion({ cx: 0.5, cy: 0.5, rx: 0.1, colors: [GREEN] }).allFrames, false);
  const round = normalizeRegion(JSON.parse(JSON.stringify(region())));
  assert.deepEqual(round, region(), 'survives a JSON round-trip');
});

test('cellRects matches the preview frameRect formula, uneven widths included', () => {
  const cells = cellRects(61, 40, 2, 3);
  assert.equal(cells.length, 6);
  assert.deepEqual(cells.map((cell) => cell.x0).slice(0, 3), [0, 20, 40]);
  assert.deepEqual(cells.map((cell) => cell.width).slice(0, 3), [20, 20, 21]);
  assert.deepEqual(cells.map((cell) => cell.y0), [0, 0, 0, 20, 20, 20]);
  assert.equal(cells.reduce((sum, cell) => sum + (cell.width * cell.height), 0), 61 * 40, 'cells tile the sheet');
  assert.equal(cellIndexAt(cells, 45, 25), 5);
  assert.equal(cellIndexAt(cells, 60.9, 39.9), 5);
});

test('copies sit at the same place of every cell and point back to the region', () => {
  const cells = cellRects(W, H, ROWS, COLS);
  const copies = replicateRegion(region(), cells, W, H);
  assert.equal(copies.length, 6);
  assert.equal(copies[0].id, 'region-1', 'the home copy is the region itself');
  copies.forEach((copy, index) => {
    assert.ok(Math.abs((copy.cx * W) - (cells[index].x0 + 7)) < 1e-9);
    assert.ok(Math.abs((copy.cy * H) - (cells[index].y0 + 7)) < 1e-9);
    assert.equal(baseRegionId(copy.id), 'region-1');
    assert.equal(copy.rx, region().rx);
  });
  assert.equal(copies[4].id, 'region-1@@4');

  // Drawn in cell 4: that is home, and cell 0 gets the shifted copy.
  const drawnInFour = region({ cx: (20 + 7) / W, cy: (20 + 7) / H });
  assert.equal(homeCellIndex(drawnInFour, cells, W, H), 4);
  const back = regionCopyForCell(drawnInFour, cells, 0, W, H);
  assert.ok(Math.abs((back.cx * W) - 7) < 1e-9 && Math.abs((back.cy * H) - 7) < 1e-9);
  assert.deepEqual(cellShift(cells, 4, 0, W, H), { dx: -20 / W, dy: -20 / H });
});

test('the detail goes in every frame, the costume and backdrop stay', () => {
  const image = sheet();
  const removed = applyRegionAcrossCells(image, region(), cellRects(W, H, ROWS, COLS));
  assert.equal(removed, 6 * 16);
  for (const cell of cellRects(W, H, ROWS, COLS)) {
    for (let y = 5; y < 9; y += 1) {
      for (let x = 5; x < 9; x += 1) assert.equal(alphaAt(image, cell.x0 + x, cell.y0 + y), 0);
    }
    assert.equal(alphaAt(image, cell.x0 + 15, cell.y0 + 15), 255, 'same colour outside the circle survives');
  }
  const opaque = Array.from({ length: W * H }, (_, index) => image.data[(index * 4) + 3]).filter((a) => a === 255).length;
  assert.equal(opaque, (W * H) - (6 * 16));
});

test('the home cell comes out byte-identical to a plain region pass', () => {
  const plain = sheet();
  applyRegionKeys(plain, [region({ allFrames: false })], {});
  const across = sheet();
  applyRegionAcrossCells(across, region(), cellRects(W, H, ROWS, COLS));
  for (let y = 0; y < 20; y += 1) {
    for (let x = 0; x < 20; x += 1) {
      const offset = ((y * W) + x) * 4;
      assert.deepEqual(across.data.subarray(offset, offset + 4), plain.data.subarray(offset, offset + 4));
    }
  }
});

test('a copy never reaches into the neighbouring frame', () => {
  // Centre on the right border of cell 0, radius 5: the plain region would
  // bite x = 20..23 of cell 1. Each copy must stop at its own cell.
  const image = makeImage(W, H, GREEN);
  const edge = region({ cx: 19 / W, rx: 5 / W, ry: 5 / H });
  applyRegionAcrossCells(image, edge, cellRects(W, H, ROWS, COLS));
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      if ((x % 20) < 10) assert.equal(alphaAt(image, x, y), 255, `pixel ${x},${y} is in another frame's half`);
    }
  }
  assert.equal(alphaAt(image, 19, 7), 0);
  assert.equal(alphaAt(image, 39, 27), 0);
});

test('connected mode floods from the seed in every frame', () => {
  const image = sheet();
  // The circle covers both the detail and a separate green pixel at (9,9)+1;
  // only the blob under the seed goes.
  for (const cell of cellRects(W, H, ROWS, COLS)) fillRect(image, cell.x0 + 11, cell.y0 + 7, 1, 1, GREEN);
  const connected = region({ rx: 6 / W, ry: 6 / H, connected: true, seed: { x: 6.5 / W, y: 6.5 / H } });
  applyRegionAcrossCells(image, connected, cellRects(W, H, ROWS, COLS));
  for (const cell of cellRects(W, H, ROWS, COLS)) {
    assert.equal(alphaAt(image, cell.x0 + 6, cell.y0 + 6), 0);
    assert.equal(alphaAt(image, cell.x0 + 11, cell.y0 + 7), 255, 'not touching the seeded blob');
  }
});

test('inactive regions and missing grids are byte-identical no-ops', () => {
  const image = sheet();
  const before = new Uint8ClampedArray(image.data);
  const cells = cellRects(W, H, ROWS, COLS);
  assert.equal(applyRegionAcrossCells(image, region({ colors: [] }), cells), 0);
  assert.equal(applyRegionAcrossCells(image, region({ enabled: false }), cells), 0);
  assert.equal(applyRegionAcrossCells(image, region(), []), 0);
  assert.deepEqual(image.data, before);

  // One cell covering the sheet is exactly a plain region.
  const single = clone(sheet());
  const plain = clone(sheet());
  applyRegionAcrossCells(single, region(), cellRects(W, H, 1, 1));
  applyRegionKeys(plain, [region()], {});
  assert.deepEqual(single.data, plain.data);
});

test('clampCentreToCell keeps a dragged centre inside its cell', () => {
  const cells = cellRects(W, H, ROWS, COLS);
  const inside = clampCentreToCell(7 / W, 7 / H, cells, 0, W, H);
  assert.deepEqual(inside, { cx: 7 / W, cy: 7 / H });
  const past = clampCentreToCell(30 / W, 50 / H, cells, 0, W, H);
  assert.equal(homeCellIndex({ cx: past.cx, cy: past.cy }, cells, W, H), 0);
  assert.ok(past.cx * W < 20 && past.cy * H < 20);
});
