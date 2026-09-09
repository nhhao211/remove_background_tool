import test from 'node:test';
import assert from 'node:assert/strict';

import { drawSubImageSafe } from '../public/js/subject-alignment.js';

/** Records the arguments of the single drawImage call, if any. */
function recorder() {
  const calls = [];
  return { ctx: { drawImage: (...args) => calls.push(args) }, calls };
}

const source = { width: 100, height: 100 };

test('drawSubImageSafe: an in-bounds rect is drawn untouched', () => {
  const { ctx, calls } = recorder();
  drawSubImageSafe(ctx, source, 10, 20, 40, 40, 0, 0, 80, 80);
  assert.deepEqual(calls, [[source, 10, 20, 40, 40, 0, 0, 80, 80]]);
});

test('drawSubImageSafe: clipping on the left keeps the scale intact', () => {
  // sx = -10 of a 40-wide read at 2x: 10 source columns are unavailable, so the
  // draw starts 20 destination px in and is 20 px narrower.
  const { ctx, calls } = recorder();
  drawSubImageSafe(ctx, source, -10, 0, 40, 40, 0, 0, 80, 80);
  const [, sx, sy, sw, sh, dx, dy, dw, dh] = calls[0];
  assert.deepEqual([sx, sy, sw, sh], [0, 0, 30, 40]);
  assert.deepEqual([dx, dy, dw, dh], [20, 0, 60, 80]);
  assert.equal(dw / sw, 2, 'horizontal scale preserved');
});

test('drawSubImageSafe: clipping on the top shrinks the destination, not grows it', () => {
  // Regression: validDh was incremented instead of decremented, so a top-clipped
  // frame was drawn taller than its cell and the subject came out stretched and
  // running past the bottom edge.
  const { ctx, calls } = recorder();
  drawSubImageSafe(ctx, source, 0, -10, 40, 40, 0, 0, 80, 80);
  const [, sx, sy, sw, sh, dx, dy, dw, dh] = calls[0];
  assert.deepEqual([sx, sy, sw, sh], [0, 0, 40, 30]);
  assert.deepEqual([dx, dy, dw, dh], [0, 20, 80, 60]);
  assert.equal(dh / sh, 2, 'vertical scale preserved');
  assert.equal(dy + dh, 80, 'draw stays inside the destination cell');
});

test('drawSubImageSafe: top and left clipping behave symmetrically', () => {
  const { ctx, calls } = recorder();
  drawSubImageSafe(ctx, source, -10, -10, 40, 40, 0, 0, 80, 80);
  const [, , , sw, sh, dx, dy, dw, dh] = calls[0];
  assert.equal(sw, sh);
  assert.equal(dx, dy);
  assert.equal(dw, dh);
});

test('drawSubImageSafe: clipping on the right and bottom trims the destination', () => {
  const { ctx, calls } = recorder();
  drawSubImageSafe(ctx, source, 80, 80, 40, 40, 0, 0, 80, 80);
  const [, sx, sy, sw, sh, dx, dy, dw, dh] = calls[0];
  assert.deepEqual([sx, sy, sw, sh], [80, 80, 20, 20]);
  assert.deepEqual([dx, dy, dw, dh], [0, 0, 40, 40]);
});

test('drawSubImageSafe: a fully out-of-bounds rect draws nothing', () => {
  const { ctx, calls } = recorder();
  drawSubImageSafe(ctx, source, 200, 200, 40, 40, 0, 0, 80, 80);
  drawSubImageSafe(ctx, source, -100, 0, 40, 40, 0, 0, 80, 80);
  assert.equal(calls.length, 0);
});

test('drawSubImageSafe: degenerate arguments are ignored', () => {
  const { ctx, calls } = recorder();
  drawSubImageSafe(null, source, 0, 0, 10, 10, 0, 0, 10, 10);
  drawSubImageSafe(ctx, null, 0, 0, 10, 10, 0, 0, 10, 10);
  drawSubImageSafe(ctx, source, 0, 0, 0, 10, 0, 0, 10, 10);
  drawSubImageSafe(ctx, source, 0, 0, 10, 10, 0, 0, 10, 0);
  assert.equal(calls.length, 0);
});
