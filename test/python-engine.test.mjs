import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PYTHON_MATTING_DEFAULTS,
  normalizePythonSettings,
  buildRefineOptions,
  encodeMatteRequest,
  decodeMatteResponse,
  describeRefineStats
} from '../public/js/python-engine.js';
import { decodeBody, encodeBody } from '../python-bridge.js';

test('settings from localStorage are clamped and default to off', () => {
  assert.deepEqual(normalizePythonSettings(null), { ...PYTHON_MATTING_DEFAULTS });
  assert.deepEqual(normalizePythonSettings('garbage'), { ...PYTHON_MATTING_DEFAULTS });
  const s = normalizePythonSettings({ enabled: 'yes', band: 99, smooth: -1, spill: 'x', decontaminate: false, minIsland: 3.6, maxHole: 1e9 });
  assert.equal(s.enabled, false, 'only a real true enables it');
  assert.equal(s.band, 12);
  assert.equal(s.smooth, 0);
  assert.equal(s.spill, PYTHON_MATTING_DEFAULTS.spill);
  assert.equal(s.decontaminate, false);
  assert.equal(s.minIsland, 4);
  assert.equal(s.maxHole, 2000);
});

test('refine options carry key colours as hex in the worker format', () => {
  const options = buildRefineOptions({ band: 3 }, [{ r: 0, g: 36, b: 245, hex: '#0024f5' }, { r: 255, g: 0, b: 16 }, '#00ff00', null]);
  assert.deepEqual(options.keyColors, ['#0024f5', '#ff0010', '#00ff00']);
  assert.equal(options.band, 3);
  assert.equal('enabled' in options, false);
});

test('request body is what the server decodes, and server replies decode here', () => {
  const original = new Uint8ClampedArray([1, 2, 3, 255]);
  const keyed = new Uint8ClampedArray([1, 2, 3, 0]);
  const body = encodeMatteRequest({ op: 'refine', width: 1, height: 1 }, original, keyed);
  const { header, payload } = decodeBody(Buffer.from(body));
  assert.deepEqual(header, { op: 'refine', width: 1, height: 1 });
  assert.deepEqual([...payload], [1, 2, 3, 255, 1, 2, 3, 0]);

  const reply = encodeBody({ ok: true, stats: { bandPixels: 5 } }, Buffer.from([9, 8, 7, 6]));
  const ab = reply.buffer.slice(reply.byteOffset, reply.byteOffset + reply.length);
  const decoded = decodeMatteResponse(ab);
  assert.equal(decoded.header.stats.bandPixels, 5);
  assert.deepEqual([...decoded.payload], [9, 8, 7, 6]);
  assert.throws(() => decodeMatteResponse(new Uint8Array([200, 0, 0, 0, 1])), /header/);
});

test('stats summary', () => {
  assert.equal(describeRefineStats(null), '');
  assert.match(describeRefineStats({ skipped: 'no-edges' }), /không có viền/);
  assert.match(describeRefineStats({ skipped: 'no-foreground' }), /chủ thể/);
  assert.match(describeRefineStats({ skipped: 'no-background' }), /nền/);
  assert.match(describeRefineStats({ bandPixels: 1200, changedPixels: 800, holePixels: 3 }), /800.*1.?200.*lấp 3 px/);
});
