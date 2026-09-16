import test from 'node:test';
import assert from 'node:assert/strict';

import {
  hitTestRegion,
  dragToRegion,
  clampRegion,
  MIN_REGION_RADIUS
} from '../public/js/region-overlay.js';

test('hitTestRegion reports the body, the edge, and nothing at all', () => {
  const regions = [{ id: 'a', cx: 100, cy: 100, rx: 40, ry: 40 }];

  assert.deepEqual(hitTestRegion(regions, { x: 100, y: 100 }), { id: 'a', part: 'body' });
  assert.deepEqual(hitTestRegion(regions, { x: 120, y: 100 }), { id: 'a', part: 'body' });
  assert.deepEqual(hitTestRegion(regions, { x: 138, y: 100 }), { id: 'a', part: 'edge' });
  assert.deepEqual(hitTestRegion(regions, { x: 143, y: 100 }), { id: 'a', part: 'edge' },
    'the grab band reaches a few pixels outside the ring too');
  assert.deepEqual(hitTestRegion(regions, { x: 200, y: 100 }), { id: null, part: null });
});

test('hitTestRegion picks the smallest region containing the point, not the first', () => {
  const regions = [
    { id: 'big', cx: 100, cy: 100, rx: 80, ry: 80 },
    { id: 'small', cx: 100, cy: 100, rx: 20, ry: 20 }
  ];
  assert.equal(hitTestRegion(regions, { x: 100, y: 100 }).id, 'small');
  assert.equal(hitTestRegion(regions, { x: 150, y: 100 }).id, 'big',
    'outside the small one the large one still answers');

  // Order must not matter.
  assert.equal(hitTestRegion([...regions].reverse(), { x: 100, y: 100 }).id, 'small');
});

test('hitTestRegion ignores degenerate regions and bad input', () => {
  assert.deepEqual(hitTestRegion([{ id: 'x', cx: 10, cy: 10, rx: 0, ry: 5 }], { x: 10, y: 10 }), { id: null, part: null });
  assert.deepEqual(hitTestRegion(null, { x: 0, y: 0 }), { id: null, part: null });
  assert.deepEqual(hitTestRegion([], null), { id: null, part: null });
});

test('an elliptical region is hit-tested as an ellipse, not a circle', () => {
  const regions = [{ id: 'wide', cx: 100, cy: 100, rx: 80, ry: 20 }];
  assert.equal(hitTestRegion(regions, { x: 160, y: 100 }).part, 'body');
  assert.equal(hitTestRegion(regions, { x: 100, y: 160 }).part, null, 'far outside on the short axis');
});

test('dragToRegion draws from the centre out', () => {
  const region = dragToRegion({ x: 0.5, y: 0.5 }, { x: 0.7, y: 0.6 }, {});
  assert.equal(region.cx, 0.5, 'the anchor stays the centre');
  assert.equal(region.cy, 0.5);
  assert.ok(Math.abs(region.rx - 0.2) < 1e-9);
  assert.ok(Math.abs(region.ry - 0.1) < 1e-9);
});

test('Shift forces a visually round circle, correcting for the source aspect', () => {
  const square = dragToRegion({ x: 0.5, y: 0.5 }, { x: 0.6, y: 0.5 }, { shiftKey: true });
  assert.ok(Math.abs(square.rx - square.ry) < 1e-9, 'a square source needs no correction');

  // 16:9 source: equal *pixel* radii means ry is 16/9 times rx in normalised units.
  const aspect = 16 / 9;
  const wide = dragToRegion({ x: 0.5, y: 0.5 }, { x: 0.6, y: 0.5 }, { shiftKey: true, aspect });
  assert.ok(Math.abs((wide.ry / wide.rx) - aspect) < 1e-9,
    'Shift on a 16:9 source must not produce a visible oval');
  assert.ok(Math.abs(wide.rx - 0.1) < 1e-9);
});

test('dragging in any direction gives a positive radius', () => {
  const back = dragToRegion({ x: 0.5, y: 0.5 }, { x: 0.3, y: 0.2 }, {});
  assert.ok(Math.abs(back.rx - 0.2) < 1e-9);
  assert.ok(Math.abs(back.ry - 0.3) < 1e-9);
});

test('clampRegion keeps the centre in 0..1 and the radius above the floor', () => {
  const clamped = clampRegion({ cx: 1.4, cy: -0.2, rx: 0, ry: 0.3 });
  assert.equal(clamped.cx, 1);
  assert.equal(clamped.cy, 0);
  assert.equal(clamped.rx, MIN_REGION_RADIUS);
  assert.equal(clamped.ry, 0.3);

  assert.equal(clampRegion({ cx: 0.5, cy: 0.5, rx: 40, ry: 40 }).rx, 2, 'a runaway radius is capped');
  assert.equal(clampRegion(null).cx, 0, 'no input degrades instead of throwing');
});

test('clampRegion carries unrelated fields through untouched', () => {
  const clamped = clampRegion({ cx: 0.5, cy: 0.5, rx: 0.1, ry: 0.1, id: 'r1', colors: [{ r: 1, g: 2, b: 3 }], frame: 4 });
  assert.equal(clamped.id, 'r1');
  assert.equal(clamped.frame, 4);
  assert.deepEqual(clamped.colors, [{ r: 1, g: 2, b: 3 }]);
});

test('a drag that never moved stays at the floor, so callers can reject it', () => {
  const dot = dragToRegion({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }, {});
  assert.equal(dot.rx, MIN_REGION_RADIUS);
  assert.equal(dot.ry, MIN_REGION_RADIUS);
});
