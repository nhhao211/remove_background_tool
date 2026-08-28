/**
 * Sprite-sheet geometry: where on the sheet a given key colour is allowed to
 * act, and how a cell is cut out and pasted back.
 *
 * `createRegionAllows` is the `regionAllows` closure lifted out of
 * removeConnectedBackground. It was already a closure over exactly these four
 * values, so hoisting it into a factory is mechanical.
 *
 * Coordinates arriving at the predicate are cell-local; `offsetX`/`offsetY`
 * translate them back to sheet space, which is what the ratio bounds are
 * expressed in. Getting that translation wrong makes per-cell processing key
 * the wrong band of each cell, so it is worth stating: the predicate is always
 * called with cell-local x/y.
 */
export function createRegionAllows({ sheetWidth, sheetHeight, offsetX, offsetY }) {
  return (region, x, y) => {
    if (!region) return true;
    const globalX = x + offsetX;
    const globalY = y + offsetY;
    if (region.mode === 'cell-lower-half') {
      const rows = Math.max(1, Math.min(100, Math.round(Number(region.rows) || 1)));
      const row = Math.min(rows - 1, Math.floor((globalY * rows) / sheetHeight));
      const cellTop = Math.floor((row * sheetHeight) / rows);
      const cellBottom = Math.floor(((row + 1) * sheetHeight) / rows);
      const splitRatio = Math.max(0.1, Math.min(0.9, Number(region.splitRatio) || 0.5));
      const splitY = cellTop + ((cellBottom - cellTop) * splitRatio);
      return globalY >= splitY && globalY < cellBottom;
    }
    const minX = Number.isFinite(Number(region.minXRatio)) ? Number(region.minXRatio) * sheetWidth : 0;
    const maxX = Number.isFinite(Number(region.maxXRatio)) ? Number(region.maxXRatio) * sheetWidth : sheetWidth;
    const minY = Number.isFinite(Number(region.minYRatio)) ? Number(region.minYRatio) * sheetHeight : 0;
    const maxY = Number.isFinite(Number(region.maxYRatio)) ? Number(region.maxYRatio) * sheetHeight : sheetHeight;
    return globalX >= minX && globalX < maxX && globalY >= minY && globalY < maxY;
  };
}

export function copyRegion(source, x0, y0, width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sourceStart = (((y0 + y) * source.width) + x0) * 4;
    data.set(source.data.subarray(sourceStart, sourceStart + (width * 4)), y * width * 4);
  }
  return { width, height, data };
}

export function pasteRegion(target, source, x0, y0) {
  for (let y = 0; y < source.height; y += 1) {
    const targetStart = (((y0 + y) * target.width) + x0) * 4;
    target.data.set(source.data.subarray(y * source.width * 4, (y + 1) * source.width * 4), targetStart);
  }
}
