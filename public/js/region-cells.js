/**
 * "Apply to every frame" for a colour region on a sprite sheet.
 *
 * On the Clean Sprite Sheet tab a region lives in absolute sheet coordinates,
 * so by default it touches exactly one spot of one cell. A stray detail that
 * sits at the same place in every frame (a watermark, a leftover guide line, a
 * prop the animation never moves) would otherwise need one circle per cell.
 *
 * A region flagged `allFrames` is instead replicated at the same position
 * *relative to its cell* in every cell of the grid, and each copy is clipped to
 * its own cell: a circle near the edge of a frame must never reach into the
 * neighbouring frame, which is a different pose.
 *
 * The region's "home" cell is the one its centre falls in. Copies are the home
 * geometry translated by the difference between cell origins, so cells that
 * differ by the one pixel `floor()` leaves behind still line up with the
 * content, which is laid out from the same origins.
 *
 * Pure, no DOM; tested by `test/region-cells.test.mjs`.
 */

import { applyRegionKeys, regionIsActive } from './region-key.js';

/** Joins a region id with the cell a surface copy of it was drawn for. */
export const CELL_ID_SEP = '@@';

export const baseRegionId = (id) => (typeof id === 'string' ? id.split(CELL_ID_SEP)[0] : id);

/**
 * Cell rectangles in row-major order. Same formula as `frameRect()` in
 * sprite-remover.js, so a cell here is the cell the preview draws.
 */
export function cellRects(width, height, rows, cols) {
  const rowCount = Math.max(1, Math.floor(Number(rows) || 1));
  const colCount = Math.max(1, Math.floor(Number(cols) || 1));
  const rects = [];
  for (let row = 0; row < rowCount; row += 1) {
    const y0 = Math.floor((row * height) / rowCount);
    const y1 = Math.floor(((row + 1) * height) / rowCount);
    for (let col = 0; col < colCount; col += 1) {
      const x0 = Math.floor((col * width) / colCount);
      const x1 = Math.floor(((col + 1) * width) / colCount);
      rects.push({ x0, y0, width: x1 - x0, height: y1 - y0 });
    }
  }
  return rects;
}

/** Index of the cell containing sheet pixel (px, py), clamped to the grid. */
export function cellIndexAt(cells, px, py) {
  let best = 0;
  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index];
    if (px >= cell.x0 && px < cell.x0 + cell.width && py >= cell.y0 && py < cell.y0 + cell.height) return index;
    if (px >= cell.x0 && py >= cell.y0) best = index;
  }
  return best;
}

/** The cell a region belongs to: the one under its centre. */
export function homeCellIndex(region, cells, width, height) {
  return cellIndexAt(cells, region.cx * width, region.cy * height);
}

/**
 * Normalised offset that carries a point from cell `from` to cell `to`.
 * Add it to go from home to a copy, subtract it to come back.
 */
export function cellShift(cells, from, to, width, height) {
  const a = cells[from];
  const b = cells[to];
  if (!a || !b) return { dx: 0, dy: 0 };
  return { dx: (b.x0 - a.x0) / width, dy: (b.y0 - a.y0) / height };
}

/**
 * The copy of `region` that belongs in cell `index`, or the region itself for
 * its home cell. Copies keep every field and carry `cell`; their id is
 * `id@@index` so a drag or a pick on one can be traced back to the original.
 */
export function regionCopyForCell(region, cells, index, width, height) {
  const home = homeCellIndex(region, cells, width, height);
  if (index === home) return { ...region, cell: index };
  const { dx, dy } = cellShift(cells, home, index, width, height);
  return {
    ...region,
    id: region.id == null ? null : `${region.id}${CELL_ID_SEP}${index}`,
    cx: region.cx + dx,
    cy: region.cy + dy,
    seed: region.seed ? { x: region.seed.x + dx, y: region.seed.y + dy } : null,
    cell: index
  };
}

/** One copy per cell, home cell included, in cell order. */
export function replicateRegion(region, cells, width, height) {
  return cells.map((_, index) => regionCopyForCell(region, cells, index, width, height));
}

/**
 * Clamps a region centre so it stays inside `cellIndex`. Once a copy's centre
 * leaves its cell, "the same place in every frame" stops meaning anything and
 * the home cell would flip mid-drag, so the circle stops at the cell border.
 */
export function clampCentreToCell(cx, cy, cells, cellIndex, width, height) {
  const cell = cells[cellIndex];
  if (!cell) return { cx, cy };
  const minX = cell.x0 / width;
  const maxX = (cell.x0 + cell.width - 0.5) / width;
  const minY = cell.y0 / height;
  const maxY = (cell.y0 + cell.height - 0.5) / height;
  return {
    cx: Math.min(maxX, Math.max(minX, cx)),
    cy: Math.min(maxY, Math.max(minY, cy))
  };
}

function intersect(a, b) {
  const x0 = Math.max(a.x0, b.x0);
  const y0 = Math.max(a.y0, b.y0);
  const x1 = Math.min(a.x0 + a.width, b.x0 + b.width);
  const y1 = Math.min(a.y0 + a.height, b.y0 + b.height);
  return x1 > x0 && y1 > y0 ? { x0, y0, width: x1 - x0, height: y1 - y0 } : null;
}

/**
 * Applies `region` once per cell, each copy fenced by its own cell. In place.
 *
 * Only the intersection of a copy's bounding box with its cell is copied out,
 * keyed and written back, so the cost is the circle's area times the cell
 * count, not the sheet's area. `applyRegionKeys` sees that patch through the
 * same crop geometry it uses for the video tab, which puts the copy's centre at
 * the right local pixel and makes the cell border a hard edge.
 *
 * @returns {number} pixels whose alpha dropped
 */
export function applyRegionAcrossCells(imageData, region, cells) {
  if (!imageData?.data || !regionIsActive(region) || !cells?.length) return 0;
  const { width, height, data } = imageData;
  let removed = 0;
  for (let index = 0; index < cells.length; index += 1) {
    const copy = regionCopyForCell(region, cells, index, width, height);
    const box = {
      x0: Math.floor((copy.cx - copy.rx) * width),
      y0: Math.floor((copy.cy - copy.ry) * height),
      width: 0,
      height: 0
    };
    box.width = Math.ceil((copy.cx + copy.rx) * width) - box.x0 + 1;
    box.height = Math.ceil((copy.cy + copy.ry) * height) - box.y0 + 1;
    const patch = intersect(box, cells[index]);
    if (!patch) continue;

    const rowBytes = patch.width * 4;
    const pixels = new Uint8ClampedArray(patch.height * rowBytes);
    for (let y = 0; y < patch.height; y += 1) {
      const start = (((patch.y0 + y) * width) + patch.x0) * 4;
      pixels.set(data.subarray(start, start + rowBytes), y * rowBytes);
    }
    const local = { data: pixels, width: patch.width, height: patch.height };
    const { removedPixels, regionsApplied } = applyRegionKeys(local, [copy], {
      sourceWidth: width,
      sourceHeight: height,
      cropX: patch.x0,
      cropY: patch.y0,
      cropWidth: patch.width,
      cropHeight: patch.height
    });
    // Despill can touch RGB on a pixel whose alpha rounds back to where it
    // was, so a patch the region ran on is written back even at zero.
    if (regionsApplied === 0) continue;
    removed += removedPixels;
    for (let y = 0; y < patch.height; y += 1) {
      const start = (((patch.y0 + y) * width) + patch.x0) * 4;
      data.set(pixels.subarray(y * rowBytes, (y + 1) * rowBytes), start);
    }
  }
  return removed;
}
