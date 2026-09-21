import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ANCHOR_RATIOS,
  getSubjectPivot,
  getCellTargetPoint,
  computeTransformCoords,
  calculateMatchFrame1Scale,
  calculateCircleCropParams,
} from '../public/js/sprite-transform-math.js';

test('ANCHOR_RATIOS: covers 9 points on a 3x3 grid', () => {
  const keys = Object.keys(ANCHOR_RATIOS);
  assert.equal(keys.length, 9);
  assert.deepEqual(ANCHOR_RATIOS['center'], [0.5, 0.5]);
  assert.deepEqual(ANCHOR_RATIOS['bottom-center'], [0.5, 1]);
  assert.deepEqual(ANCHOR_RATIOS['top-left'], [0, 0]);
  assert.deepEqual(ANCHOR_RATIOS['bottom-right'], [1, 1]);
});

test('getSubjectPivot: calculates pivot coordinates based on subject bounds', () => {
  const bounds = {
    minX: 100,
    maxX: 199,
    minY: 50,
    maxY: 149,
    width: 100,
    height: 100,
    centerX: 150,
    centerY: 100,
  };

  // Center pivot
  const centerPivot = getSubjectPivot(bounds, 300, 300, 'center');
  assert.equal(centerPivot.px, 150);
  assert.equal(centerPivot.py, 100);
  assert.equal(centerPivot.relX, 50);
  assert.equal(centerPivot.relY, 50);

  // Bottom-center pivot
  const bottomCenterPivot = getSubjectPivot(bounds, 300, 300, 'bottom-center');
  assert.equal(bottomCenterPivot.px, 150);
  assert.equal(bottomCenterPivot.py, 150); // minY (50) + height (100) = 150
  assert.equal(bottomCenterPivot.relX, 50);
  assert.equal(bottomCenterPivot.relY, 100);
});

test('getCellTargetPoint: calculates target point with offsets', () => {
  const pt = getCellTargetPoint(1280, 1620, 'center', 10, -20);
  assert.equal(pt.targetX, 640 + 10);
  assert.equal(pt.targetY, 810 - 20);

  const bottomPt = getCellTargetPoint(1280, 1620, 'bottom-center', 0, 0);
  assert.equal(bottomPt.targetX, 640);
  assert.equal(bottomPt.targetY, 1620);
});

test('computeTransformCoords: scales subject centered in cell', () => {
  const bounds = {
    minX: 50,
    maxX: 149,
    minY: 50,
    maxY: 149,
    width: 100,
    height: 100,
    centerX: 100,
    centerY: 100,
  };

  // 100% scale in 200x200 cell, centered
  const res100 = computeTransformCoords({
    bounds,
    sourceCellWidth: 200,
    sourceCellHeight: 200,
    targetCellWidth: 200,
    targetCellHeight: 200,
    scaleX: 1,
    scaleY: 1,
    offsetX: 0,
    offsetY: 0,
    anchor: 'center',
  });

  assert.equal(res100.sw, 100);
  assert.equal(res100.sh, 100);
  assert.equal(res100.dw, 100);
  assert.equal(res100.dh, 100);
  // dx should center the 100px subject in 200px cell: dx = (200/2) - (100/2) = 50
  assert.equal(res100.dx, 50);
  assert.equal(res100.dy, 50);
  assert.equal(res100.isClipped, false);
});

test('computeTransformCoords: detects clipping when scaled content exceeds cell', () => {
  const bounds = {
    minX: 50,
    maxX: 149,
    minY: 50,
    maxY: 149,
    width: 100,
    height: 100,
    centerX: 100,
    centerY: 100,
  };

  // Scale 250% in 200x200 cell -> subject width becomes 250px -> exceeds 200px
  const res250 = computeTransformCoords({
    bounds,
    sourceCellWidth: 200,
    sourceCellHeight: 200,
    targetCellWidth: 200,
    targetCellHeight: 200,
    scaleX: 2.5,
    scaleY: 2.5,
    offsetX: 0,
    offsetY: 0,
    anchor: 'center',
  });

  assert.equal(res250.dw, 250);
  assert.equal(res250.dh, 250);
  assert.equal(res250.dx, -25); // (100) - (125) = -25 < 0
  assert.equal(res250.isClipped, true);
});

test('calculateMatchFrame1Scale: adjusts scale to match Frame 1 height', () => {
  const frame1Bounds = { height: 200 };
  const frame2Bounds = { height: 100 }; // Half height of frame 1

  const matched = calculateMatchFrame1Scale(frame1Bounds, frame2Bounds, 1.5, 1.5);
  // Should scale 2x relative to base scale 1.5 -> 3.0
  assert.equal(matched.scaleX, 3.0);
  assert.equal(matched.scaleY, 3.0);

  // Degenerate / null bounds keep base scale
  const fallback = calculateMatchFrame1Scale(null, frame2Bounds, 1.5, 1.5);
  assert.equal(fallback.scaleX, 1.5);
  assert.equal(fallback.scaleY, 1.5);
});

test('calculateCircleCropParams: computes inner and outer radii correctly', () => {
  // Hard edge (fade 100%)
  const hardCrop = calculateCircleCropParams({
    cellWidth: 1000,
    cellHeight: 800,
    diameter: 600,
    fadeStarts: 100,
  });
  assert.equal(hardCrop.cx, 500);
  assert.equal(hardCrop.cy, 400);
  assert.equal(hardCrop.outerRadius, 300);
  assert.equal(hardCrop.innerRadius, 300);
  assert.equal(hardCrop.isFeathered, false);

  // Feathered edge (fade 75%)
  const featherCrop = calculateCircleCropParams({
    cellWidth: 1000,
    cellHeight: 800,
    diameter: 600,
    fadeStarts: 75,
  });
  assert.equal(featherCrop.outerRadius, 300);
  assert.equal(featherCrop.innerRadius, 225);
  assert.equal(featherCrop.isFeathered, true);
});
