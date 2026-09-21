/**
 * Sprite Transform & Scaling Mathematical Core
 * Pure functions for subject bounds detection, coordinate calculation,
 * anchor point alignment, clipping detection, and circle crop parameters.
 */

import { detectSubjectBounds } from './subject-alignment.js';

/**
 * 3x3 Anchor Points definition
 * Normalized coordinates [xRatio, yRatio] on a 0..1 scale.
 */
export const ANCHOR_RATIOS = Object.freeze({
  'top-left': [0, 0],
  'top-center': [0.5, 0],
  'top-right': [1, 0],
  'center-left': [0, 0.5],
  'center': [0.5, 0.5],
  'center-right': [1, 0.5],
  'bottom-left': [0, 1],
  'bottom-center': [0.5, 1],
  'bottom-right': [1, 1],
});

/**
 * Calculates the pivot point inside the subject bounds for a given anchor type.
 *
 * @param {Object|null} bounds - Subject bounds { minX, maxX, minY, maxY, width, height, centerX, centerY }
 * @param {number} cellWidth
 * @param {number} cellHeight
 * @param {string} [anchor='center']
 * @returns {{ px: number, py: number, relX: number, relY: number }}
 */
export function getSubjectPivot(bounds, cellWidth, cellHeight, anchor = 'center') {
  const [rx, ry] = ANCHOR_RATIOS[anchor] || ANCHOR_RATIOS['center'];

  if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
    return {
      px: cellWidth * rx,
      py: cellHeight * ry,
      relX: 0,
      relY: 0,
    };
  }

  const px = bounds.minX + bounds.width * rx;
  const py = bounds.minY + bounds.height * ry;
  const relX = px - bounds.minX;
  const relY = py - bounds.minY;

  return { px, py, relX, relY };
}

/**
 * Calculates the destination anchor position on the target cell.
 *
 * @param {number} cellWidth
 * @param {number} cellHeight
 * @param {string} [anchor='center']
 * @param {number} [offsetX=0]
 * @param {number} [offsetY=0]
 * @returns {{ targetX: number, targetY: number }}
 */
export function getCellTargetPoint(cellWidth, cellHeight, anchor = 'center', offsetX = 0, offsetY = 0) {
  const [rx, ry] = ANCHOR_RATIOS[anchor] || ANCHOR_RATIOS['center'];
  return {
    targetX: cellWidth * rx + (Number(offsetX) || 0),
    targetY: cellHeight * ry + (Number(offsetY) || 0),
  };
}

/**
 * Computes draw coordinates for transforming subject inside the cell.
 *
 * @param {Object} params
 * @param {Object|null} params.bounds - Bounding box of the subject in the source cell
 * @param {number} params.sourceCellWidth - Width of source cell
 * @param {number} params.sourceCellHeight - Height of source cell
 * @param {number} params.targetCellWidth - Width of target cell
 * @param {number} params.targetCellHeight - Height of target cell
 * @param {number} [params.scaleX=1] - Scale multiplier for width (e.g. 1.8 for 180%)
 * @param {number} [params.scaleY=1] - Scale multiplier for height
 * @param {number} [params.offsetX=0] - Pixel translation along X axis
 * @param {number} [params.offsetY=0] - Pixel translation along Y axis
 * @param {string} [params.anchor='center'] - 3x3 anchor point name
 * @returns {Object} { sx, sy, sw, sh, dx, dy, dw, dh, isClipped }
 */
export function computeTransformCoords({
  bounds,
  sourceCellWidth,
  sourceCellHeight,
  targetCellWidth,
  targetCellHeight,
  scaleX = 1,
  scaleY = 1,
  offsetX = 0,
  offsetY = 0,
  anchor = 'center',
}) {
  const sW = Math.max(1, Number(sourceCellWidth) || 1);
  const sH = Math.max(1, Number(sourceCellHeight) || 1);
  const tW = Math.max(1, Number(targetCellWidth) || sW);
  const tH = Math.max(1, Number(targetCellHeight) || sH);
  const sX = Math.max(0.01, Number(scaleX) || 1);
  const sY = Math.max(0.01, Number(scaleY) || 1);
  const offX = Math.round(Number(offsetX) || 0);
  const offY = Math.round(Number(offsetY) || 0);

  // If no subject detected, fall back to entire cell
  const validBounds = bounds && bounds.width > 0 && bounds.height > 0
    ? bounds
    : { minX: 0, minY: 0, width: sW, height: sH, centerX: sW / 2, centerY: sH / 2, maxX: sW - 1, maxY: sH - 1 };

  const sx = validBounds.minX;
  const sy = validBounds.minY;
  const sw = validBounds.width;
  const sh = validBounds.height;

  const dw = Math.round(sw * sX);
  const dh = Math.round(sh * sY);

  const { relX, relY } = getSubjectPivot(validBounds, sW, sH, anchor);
  const { targetX, targetY } = getCellTargetPoint(tW, tH, anchor, offX, offY);

  const dx = Math.round(targetX - relX * sX);
  const dy = Math.round(targetY - relY * sY);

  const isClipped = dx < 0 || dy < 0 || (dx + dw) > tW || (dy + dh) > tH;

  return {
    sx,
    sy,
    sw,
    sh,
    dx,
    dy,
    dw,
    dh,
    isClipped,
  };
}

/**
 * Calculates scaling factor to match Frame 1 subject height.
 *
 * @param {Object|null} frame1Bounds - Bounds of subject in Frame 1
 * @param {Object|null} currentBounds - Bounds of subject in current frame
 * @param {number} baseScaleX - Base user scale X
 * @param {number} baseScaleY - Base user scale Y
 * @returns {{ scaleX: number, scaleY: number }}
 */
export function calculateMatchFrame1Scale(frame1Bounds, currentBounds, baseScaleX = 1, baseScaleY = 1) {
  if (
    !frame1Bounds ||
    !currentBounds ||
    frame1Bounds.height <= 0 ||
    currentBounds.height <= 0
  ) {
    return { scaleX: baseScaleX, scaleY: baseScaleY };
  }

  const heightRatio = frame1Bounds.height / currentBounds.height;
  return {
    scaleX: baseScaleX * heightRatio,
    scaleY: baseScaleY * heightRatio,
  };
}

/**
 * Validates and calculates parameters for circular crop mask.
 *
 * @param {Object} params
 * @param {number} params.cellWidth
 * @param {number} params.cellHeight
 * @param {number} params.diameter - In pixels
 * @param {number} [params.fadeStarts=100] - Percentage 0..100 (100 = hard edge)
 * @returns {Object} { cx, cy, outerRadius, innerRadius, isFeathered }
 */
export function calculateCircleCropParams({
  cellWidth,
  cellHeight,
  diameter,
  fadeStarts = 100,
}) {
  const cx = cellWidth / 2;
  const cy = cellHeight / 2;
  const outerRadius = Math.max(1, (Number(diameter) || Math.min(cellWidth, cellHeight)) / 2);
  const fadePercent = Math.max(0, Math.min(100, Number(fadeStarts) || 100));
  const innerRadius = Math.max(0, outerRadius * (fadePercent / 100));
  const isFeathered = fadePercent < 100;

  return {
    cx,
    cy,
    outerRadius,
    innerRadius,
    isFeathered,
  };
}

export { detectSubjectBounds };
