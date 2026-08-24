import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorUtils as U } from '../public/js/editor-utils.js';

test('clampTrimRange enforces bounds and minimum duration', () => {
  assert.deepEqual(U.clampTrimRange(9.9, 10, 10), { start: 9.8, end: 10 });
  assert.deepEqual(U.clampTrimRange(8, 2, 10), { start: 2, end: 8 });
  assert.deepEqual(U.clampTrimRange(0, 0.05, 0.1), { start: 0, end: 0.1 });
  assert.deepEqual(U.clampTrimRange(0, 0, 10), { start: 0, end: 0.2 });
});

test('directional trim clamps prevent handles crossing', () => {
  assert.equal(U.clampTrimStart(9, 5, 10), 4.8);
  assert.equal(U.clampTrimEnd(5, 1, 10), 5.2);
});

test('shifting a trim range preserves its duration at boundaries', () => {
  assert.deepEqual(U.shiftTrimRange(2, 5, 20, 10), { start: 7, end: 10 });
  assert.deepEqual(U.shiftTrimRange(2, 5, -20, 10), { start: 0, end: 3 });
});

test('snapTime only snaps within threshold', () => {
  assert.equal(U.snapTime(1.04, 10, { step: 0.1 }), 1);
  assert.equal(U.snapTime(1.08, 10, { step: 0.1, threshold: 0.01 }), 1.08);
  assert.equal(U.snapTime(4.98, 10, { markers: [5], threshold: 0.05 }), 5);
});

test('speed formatting and effective duration', () => {
  assert.equal(U.formatSpeed(1.25), '1.25x');
  assert.equal(U.formatSpeed(99), '16x');
  assert.equal(U.effectiveDuration(2, 12, 2), 5);
});

test('atempo chains support extreme speeds', () => {
  assert.equal(U.atempoFilter(1), '');
  assert.equal(U.atempoFilter(4), 'atempo=2,atempo=2');
  assert.equal(U.atempoFilter(0.25), 'atempo=0.5,atempo=0.5');
});

test('colors normalize and dedupe', () => {
  assert.deepEqual(U.normalizeColor('#abc'), { r: 170, g: 187, b: 204, hex: '#aabbcc' });
  assert.deepEqual(U.normalizeColor('rgb(1, 2, 3)'), { r: 1, g: 2, b: 3, hex: '#010203' });
  assert.equal(U.normalizeColor('#12') , null);
  assert.equal(U.dedupeColor([{ r: 1, g: 2, b: 3, hex: '#010203' }], '#010204').length, 1);
  assert.equal(U.dedupeColor([], '#ffffff').length, 1);
});

test('clampNumber preserves zero and applies fallback only to invalid values', () => {
  assert.equal(U.clampNumber(0, 0, 1, 0.5), 0);
  assert.equal(U.clampNumber(2, 0, 1, 0.5), 1);
  assert.equal(U.clampNumber('invalid', 0, 1, 0.5), 0.5);
});
