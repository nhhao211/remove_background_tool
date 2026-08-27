/**
 * Subject Alignment & Stabilization module for Video Background Remover
 * Detects subject bounds after chroma key and calculates translation offsets
 * to align subjects against a customizable vertical guideline.
 */

/**
 * Detects the bounding box of solid/opaque subject pixels in an ImageData.
 * Filters out minor chroma noise using column/row pixel count thresholds.
 *
 * @param {ImageData} imageData - The frame's ImageData after background removal
 * @param {Object} options - Detection parameters
 * @param {number} [options.alphaThreshold=25] - Minimum alpha (0-255) to consider as subject pixel
 * @param {number} [options.minPixelsPerCol=3] - Minimum solid pixels required in a column to register as edge
 * @param {number} [options.minPixelsPerRow=3] - Minimum solid pixels required in a row to register as edge
 * @returns {Object|null} Bounding box coordinates { minX, maxX, minY, maxY, width, height, centerX, centerY } or null if empty
 */
function detectSubjectBounds(imageData, options = {}) {
  const width = Number(imageData?.width) || 0;
  const height = Number(imageData?.height) || 0;
  const data = imageData?.data;
  if (!width || !height || !data || data.length === 0) return null;

  const alphaThreshold = Math.max(1, Math.min(255, Math.round(Number(options.alphaThreshold) || 25)));
  const minPixelsPerCol = Math.max(1, Math.min(height, Math.round(Number(options.minPixelsPerCol) || 3)));
  const minPixelsPerRow = Math.max(1, Math.min(width, Math.round(Number(options.minPixelsPerRow) || 3)));

  let minX = -1;
  let maxX = -1;
  let minY = -1;
  let maxY = -1;

  // Scan columns from Left to Right -> Find minX
  for (let x = 0; x < width; x++) {
    let solidCount = 0;
    for (let y = 0; y < height; y++) {
      const alpha = data[((y * width) + x) * 4 + 3];
      if (alpha >= alphaThreshold) {
        solidCount++;
        if (solidCount >= minPixelsPerCol) {
          minX = x;
          break;
        }
      }
    }
    if (minX !== -1) break;
  }

  // If no columns met threshold, frame is empty
  if (minX === -1) {
    return null;
  }

  // Scan columns from Right to Left -> Find maxX
  for (let x = width - 1; x >= minX; x--) {
    let solidCount = 0;
    for (let y = 0; y < height; y++) {
      const alpha = data[((y * width) + x) * 4 + 3];
      if (alpha >= alphaThreshold) {
        solidCount++;
        if (solidCount >= minPixelsPerCol) {
          maxX = x;
          break;
        }
      }
    }
    if (maxX !== -1) break;
  }
  if (maxX === -1) maxX = minX;

  // Scan rows from Top to Bottom -> Find minY
  for (let y = 0; y < height; y++) {
    let solidCount = 0;
    for (let x = minX; x <= maxX; x++) {
      const alpha = data[((y * width) + x) * 4 + 3];
      if (alpha >= alphaThreshold) {
        solidCount++;
        if (solidCount >= minPixelsPerRow) {
          minY = y;
          break;
        }
      }
    }
    if (minY !== -1) break;
  }
  if (minY === -1) minY = 0;

  // Scan rows from Bottom to Top -> Find maxY
  for (let y = height - 1; y >= minY; y--) {
    let solidCount = 0;
    for (let x = minX; x <= maxX; x++) {
      const alpha = data[((y * width) + x) * 4 + 3];
      if (alpha >= alphaThreshold) {
        solidCount++;
        if (solidCount >= minPixelsPerRow) {
          maxY = y;
          break;
        }
      }
    }
    if (maxY !== -1) break;
  }
  if (maxY === -1) maxY = height - 1;

  const bboxWidth = Math.max(1, maxX - minX + 1);
  const bboxHeight = Math.max(1, maxY - minY + 1);

  return {
    minX,
    maxX,
    minY,
    maxY,
    width: bboxWidth,
    height: bboxHeight,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2
  };
}

/**
 * Calculates horizontal shift required to align subject against guideline target X.
 *
 * @param {Object} bounds - Bounding box from detectSubjectBounds
 * @param {number} targetCellX - Target X coordinate within the cell
 * @param {string} [mode='left'] - Alignment mode: 'left' | 'center' | 'right'
 * @returns {number} shiftX - Horizontal offset in pixels
 */
function calculateGuidelineShift(bounds, targetCellX, mode = 'left') {
  if (!bounds || !Number.isFinite(targetCellX)) return 0;

  let shift = 0;
  if (mode === 'center') {
    shift = targetCellX - bounds.centerX;
  } else if (mode === 'right') {
    shift = targetCellX - bounds.maxX;
  } else {
    // Default 'left' (Left-Flush)
    shift = targetCellX - bounds.minX;
  }

  return Math.round(shift);
}

/**
 * Shifts the contents of a frame canvas horizontally by shiftX pixels.
 *
 * @param {HTMLCanvasElement} frameCanvas - The canvas containing the frame
 * @param {number} shiftX - Horizontal shift in pixels
 * @param {number} cellW - Width of the cell
 * @param {number} cellH - Height of the cell
 */
function alignFrameCanvas(frameCanvas, shiftX, cellW, cellH) {
  if (!frameCanvas || shiftX === 0 || !cellW || !cellH) return;

  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = cellW;
  tempCanvas.height = cellH;
  const tempCtx = tempCanvas.getContext('2d');
  tempCtx.drawImage(frameCanvas, 0, 0);

  const ctx = frameCanvas.getContext('2d');
  ctx.clearRect(0, 0, cellW, cellH);
  ctx.drawImage(tempCanvas, shiftX, 0);
}

/**
 * Safely draws a sub-rectangle from sourceCanvas to target context,
 * handling out-of-bound or negative source coordinates without crashing or clipping.
 * Preserves the exact destination cell dimensions (dw x dh).
 */
function drawSubImageSafe(ctx, sourceCanvas, sx, sy, sw, sh, dx, dy, dw, dh) {
  if (!ctx || !sourceCanvas || sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) return;

  const srcW = sourceCanvas.width;
  const srcH = sourceCanvas.height;

  const scaleX = dw / sw;
  const scaleY = dh / sh;

  let validSx = sx;
  let validSy = sy;
  let validSw = sw;
  let validSh = sh;

  let validDx = dx;
  let validDy = dy;
  let validDw = dw;
  let validDh = dh;

  if (validSx < 0) {
    const trimLeft = -validSx;
    validSx = 0;
    validSw -= trimLeft;
    validDx += trimLeft * scaleX;
    validDw -= trimLeft * scaleX;
  }

  if (validSy < 0) {
    const trimTop = -validSy;
    validSy = 0;
    validSh -= trimTop;
    validDy += trimTop * scaleY;
    validDh += trimTop * scaleY;
  }

  if (validSx + validSw > srcW) {
    const excessRight = (validSx + validSw) - srcW;
    validSw -= excessRight;
    validDw -= excessRight * scaleX;
  }

  if (validSy + validSh > srcH) {
    const excessBottom = (validSy + validSh) - srcH;
    validSh -= excessBottom;
    validDh -= excessBottom * scaleY;
  }

  if (validSw > 0 && validSh > 0 && validDw > 0 && validDh > 0) {
    ctx.drawImage(
      sourceCanvas,
      validSx, validSy, validSw, validSh,
      validDx, validDy, validDw, validDh
    );
  }
}

export {
  detectSubjectBounds,
  calculateGuidelineShift,
  alignFrameCanvas,
  drawSubImageSafe
};
