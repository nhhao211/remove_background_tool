/**
 * Maps a point on the sprite preview back into normalized source-video space.
 *
 * The Erase Brush stores its strokes in 0..1 coordinates of the *source video*,
 * not of a sprite cell, so the same mask survives a change of crop, cell size or
 * frame count. Painting on the Source Video is therefore a direct measurement;
 * painting on the Preview is not — the preview shows cells that have already
 * been cropped, downscaled and (with Subject Alignment on) individually shifted,
 * so a click there has to be run backwards through that layout to land on the
 * pixel of the video the user actually pointed at.
 *
 * This module owns that inverse. It is deliberately DOM-free: the layout it
 * needs is the same record `generateSpriteSheet` already keeps in
 * `state.sheetLayout`, and the per-frame origins it consults are the very
 * `sourceX`/`sourceY` the generator drew each cell from, so preview painting
 * cannot drift away from what was rendered without the generator changing too.
 */

const finite = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const clamp01 = (value) => Math.min(1, Math.max(0, value));

/**
 * Validates a sheet layout and returns it with numbers coerced, or null when it
 * cannot describe a grid (no cells, degenerate crop). Callers treat null as
 * "the preview is not paintable yet".
 *
 * @param {object|null} layout
 * @returns {{cellW:number, cellH:number, cellsAcross:number, cropX:number, cropY:number, cropWidth:number, cropHeight:number}|null}
 */
export function normalizeSheetLayout(layout) {
  if (!layout) return null;
  const cellW = Math.round(finite(layout.cellW));
  const cellH = Math.round(finite(layout.cellH));
  const cellsAcross = Math.round(finite(layout.cellsAcross));
  const cropWidth = finite(layout.cropWidth);
  const cropHeight = finite(layout.cropHeight);
  if (cellW < 1 || cellH < 1 || cellsAcross < 1 || cropWidth <= 0 || cropHeight <= 0) return null;
  return {
    cellW,
    cellH,
    cellsAcross,
    cropX: finite(layout.cropX),
    cropY: finite(layout.cropY),
    cropWidth,
    cropHeight
  };
}

/**
 * Source pixels -> cell pixels, matching the `sizeScale` inside
 * `rasterizeStrokeMask`. The brush Size slider is measured in source-video
 * pixels, so the ring drawn over the preview must be scaled by this or it lies
 * about how much a stroke will cover on a downscaled sheet.
 *
 * @returns {number} 0 when the layout is unusable
 */
export function cellBrushScale(layout) {
  const safe = normalizeSheetLayout(layout);
  if (!safe) return 0;
  return ((safe.cellW / safe.cropWidth) + (safe.cellH / safe.cropHeight)) / 2;
}

/**
 * Which cell a preview-bitmap point falls in, and where inside that cell.
 *
 * In `play` mode the preview *is* one cell, so the answer is the frame being
 * animated. In `sheet` mode the grid is read out of the layout rather than the
 * Rows/Cols inputs, because those inputs can be edited after a Generate and the
 * pixels on screen still belong to the old grid.
 *
 * The returned `frameIndex` may point past the last frame: the trailing cells of
 * the bottom row are empty, and painting there is still legal — the mask is
 * global, so the stroke simply applies to every frame like any other.
 *
 * @returns {{frameIndex:number, column:number, row:number, localX:number, localY:number}|null}
 */
export function locatePreviewCell({ px, py, mode = 'play', frameIndex = 0, layout }) {
  const safe = normalizeSheetLayout(layout);
  if (!safe) return null;
  const x = finite(px, -1);
  const y = finite(py, -1);
  if (x < 0 || y < 0) return null;

  if (mode !== 'sheet') {
    if (x > safe.cellW || y > safe.cellH) return null;
    return {
      frameIndex: Math.max(0, Math.round(finite(frameIndex))),
      column: 0,
      row: 0,
      localX: Math.min(x, safe.cellW),
      localY: Math.min(y, safe.cellH)
    };
  }

  const column = Math.min(safe.cellsAcross - 1, Math.floor(x / safe.cellW));
  const row = Math.floor(y / safe.cellH);
  return {
    frameIndex: (row * safe.cellsAcross) + column,
    column,
    row,
    localX: Math.min(safe.cellW, x - (column * safe.cellW)),
    localY: Math.min(safe.cellH, y - (row * safe.cellH))
  };
}

/**
 * The crop rectangle a given cell was drawn from, in source-video pixels.
 *
 * Without Subject Alignment every cell shares the crop window, so this is the
 * crop itself. With alignment on, the generator slides the extraction rectangle
 * per frame to park the subject on the guideline, and `frameOrigins` carries
 * exactly those slid positions.
 */
export function cellSourceOrigin(layout, frameOrigins, frameIndex) {
  const safe = normalizeSheetLayout(layout);
  if (!safe) return null;
  const origin = Array.isArray(frameOrigins) ? frameOrigins[frameIndex] : null;
  if (origin && Number.isFinite(Number(origin.x)) && Number.isFinite(Number(origin.y))) {
    return { x: Number(origin.x), y: Number(origin.y) };
  }
  return { x: safe.cropX, y: safe.cropY };
}

/**
 * Full inverse: a preview-bitmap pixel to a normalized source-video point, ready
 * to be pushed onto a stroke.
 *
 * `videoWidth`/`videoHeight` are what the 0..1 range is measured against — the
 * same denominators `rasterizeStrokeMask` multiplies back out — so a point that
 * maps outside the frame (possible when alignment shifts a cell past the video
 * edge) is clamped rather than dropped: the pointer is still over a real cell,
 * and refusing the point mid-stroke would break the polyline in half.
 *
 * @returns {{x:number, y:number, frameIndex:number}|null}
 */
export function mapPreviewPointToSource({
  px,
  py,
  mode = 'play',
  frameIndex = 0,
  layout,
  frameOrigins = null,
  videoWidth,
  videoHeight
}) {
  const safe = normalizeSheetLayout(layout);
  if (!safe) return null;
  const width = finite(videoWidth);
  const height = finite(videoHeight);
  if (width < 1 || height < 1) return null;

  const cell = locatePreviewCell({ px, py, mode, frameIndex, layout: safe });
  if (!cell) return null;

  const origin = cellSourceOrigin(safe, frameOrigins, cell.frameIndex);
  const sourceX = origin.x + ((cell.localX / safe.cellW) * safe.cropWidth);
  const sourceY = origin.y + ((cell.localY / safe.cellH) * safe.cropHeight);

  return {
    x: clamp01(sourceX / width),
    y: clamp01(sourceY / height),
    frameIndex: cell.frameIndex
  };
}
