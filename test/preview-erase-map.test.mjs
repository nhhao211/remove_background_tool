import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeSheetLayout,
  cellBrushScale,
  locatePreviewCell,
  cellSourceOrigin,
  mapPreviewPointToSource
} from '../public/js/preview-erase-map.js';

// A 1920x1080 video, cropped 100px off the left and 40px off the top, packed
// four cells across at half the crop resolution.
const layout = {
  cellW: 400,
  cellH: 250,
  cellsAcross: 4,
  cropX: 100,
  cropY: 40,
  cropWidth: 800,
  cropHeight: 500
};
const video = { videoWidth: 1920, videoHeight: 1080 };

test('a degenerate layout is rejected rather than producing NaN coordinates', () => {
  assert.equal(normalizeSheetLayout(null), null);
  assert.equal(normalizeSheetLayout({ ...layout, cellW: 0 }), null);
  assert.equal(normalizeSheetLayout({ ...layout, cropWidth: 0 }), null);
  assert.equal(cellBrushScale({ ...layout, cellsAcross: 0 }), 0);
  assert.equal(mapPreviewPointToSource({ px: 10, py: 10, layout: null, ...video }), null);
  assert.equal(mapPreviewPointToSource({ px: 10, py: 10, layout, videoWidth: 0, videoHeight: 0 }), null);
});

test('brush size scales from source pixels down into the cell', () => {
  // 400/800 and 250/500 are both 0.5, so a 80px brush covers 40px of a cell.
  assert.equal(cellBrushScale(layout), 0.5);
});

test('anim mode maps the cell straight through the crop window', () => {
  const topLeft = mapPreviewPointToSource({ px: 0, py: 0, mode: 'play', layout, ...video });
  assert.deepEqual(topLeft, { x: 100 / 1920, y: 40 / 1080, frameIndex: 0 });

  const middle = mapPreviewPointToSource({ px: 200, py: 125, mode: 'play', layout, ...video });
  assert.equal(middle.x, (100 + 400) / 1920);
  assert.equal(middle.y, (40 + 250) / 1080);
});

test('sheet mode resolves the cell under the pointer and maps within it', () => {
  // Column 2, row 1, dead centre of that cell.
  const point = mapPreviewPointToSource({
    px: (2 * 400) + 200,
    py: (1 * 250) + 125,
    mode: 'sheet',
    layout,
    ...video
  });
  assert.equal(point.frameIndex, 6);
  // Every cell shows the same crop window, so the centre of any of them is the
  // centre of the crop.
  assert.equal(point.x, (100 + 400) / 1920);
  assert.equal(point.y, (40 + 250) / 1080);
});

test('sheet mode uses the layout grid, not the current Rows/Cols inputs', () => {
  const cell = locatePreviewCell({ px: 1599, py: 0, mode: 'sheet', layout });
  assert.equal(cell.column, 3);
  assert.equal(cell.frameIndex, 3);
  // A point past the right edge stays in the last column instead of wrapping
  // into a phantom fifth cell.
  const clamped = locatePreviewCell({ px: 5000, py: 0, mode: 'sheet', layout });
  assert.equal(clamped.column, 3);
  assert.equal(clamped.localX, 400);
});

test('a trailing empty cell is still paintable and falls back to the crop origin', () => {
  const origin = cellSourceOrigin(layout, [{ x: 7, y: 9 }], 5);
  assert.deepEqual(origin, { x: 100, y: 40 });
});

test('per-frame origins follow Subject Alignment shifts', () => {
  const frameOrigins = [{ x: 100, y: 40 }, { x: 300, y: 140 }];
  const first = mapPreviewPointToSource({ px: 0, py: 0, mode: 'sheet', layout, frameOrigins, ...video });
  const second = mapPreviewPointToSource({ px: 400, py: 0, mode: 'sheet', layout, frameOrigins, ...video });
  assert.equal(first.x, 100 / 1920);
  // Cell 1 was extracted from further right, so its top-left is a different
  // pixel of the video even though it is the same corner of the cell.
  assert.equal(second.x, 300 / 1920);
  assert.equal(second.y, 140 / 1080);
});

test('anim mode reads the origin of the frame currently on screen', () => {
  const frameOrigins = [{ x: 100, y: 40 }, { x: 300, y: 140 }];
  const point = mapPreviewPointToSource({
    px: 0,
    py: 0,
    mode: 'play',
    frameIndex: 1,
    layout,
    frameOrigins,
    ...video
  });
  assert.equal(point.frameIndex, 1);
  assert.equal(point.x, 300 / 1920);
});

test('a point pushed outside the video by alignment is clamped, not dropped', () => {
  const frameOrigins = [{ x: -200, y: -100 }];
  const point = mapPreviewPointToSource({ px: 0, py: 0, mode: 'play', layout, frameOrigins, ...video });
  assert.deepEqual(point, { x: 0, y: 0, frameIndex: 0 });

  const farOrigins = [{ x: 1900, y: 1070 }];
  const far = mapPreviewPointToSource({ px: 400, py: 250, mode: 'play', layout, frameOrigins: farOrigins, ...video });
  assert.deepEqual(far, { x: 1, y: 1, frameIndex: 0 });
});

test('negative preview pixels are rejected', () => {
  assert.equal(locatePreviewCell({ px: -1, py: 10, mode: 'sheet', layout }), null);
  assert.equal(locatePreviewCell({ px: 10, py: -1, mode: 'play', layout }), null);
});
