/**
 * `matchMode: 'edge'` keys (Clean Sprite Sheet, pick on Result).
 *
 * An edge key may only remove pixels within `edgeReach` steps of background the
 * connected fill already found. It must never join the fill itself, or a fringe
 * colour close to the subject's own would flood through the subject.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { runKeyer } from '../../public/js/keyer/index.js';
import { loadPNG } from './png.mjs';
import { FIXTURES_DIR } from './keyer-runner.mjs';

const BACKGROUND = { r: 24, g: 198, b: 62, hex: '#18c63e' };
const SUBJECT = [180, 60, 50];
const FRINGE = { r: 120, g: 120, b: 60, hex: '#78783c' };
const SIZE = 40;

function image(paint) {
  const data = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let p = 0; p < SIZE * SIZE; p++) data.set([BACKGROUND.r, BACKGROUND.g, BACKGROUND.b, 255], p * 4);
  const set = (x, y, rgb) => data.set([...rgb, 255], ((y * SIZE) + x) * 4);
  paint(set);
  return { width: SIZE, height: SIZE, data };
}

const fringeRgb = [FRINGE.r, FRINGE.g, FRINGE.b];
const alphaAt = (result, x, y) => result.imageData.data[(((y * SIZE) + x) * 4) + 3];

function key(source, fringeMode) {
  const keyColors = fringeMode ? [BACKGROUND, FRINGE] : [BACKGROUND];
  const keyRegions = fringeMode ? [{ hex: FRINGE.hex, matchMode: fringeMode, edgeReach: 2 }] : [];
  return runKeyer({ ...source, data: new Uint8ClampedArray(source.data) }, {
    connected: true,
    autoDetect: false,
    keyColors,
    keyRegions,
    similarity: 0.48,
    feather: 0.2,
    spill: 0.55,
    preserveColors: true,
    subjectProtection: 0.55,
    cleanupRadius: 0,
    seedPoints: []
  });
}

// Subject 10..29 square, a 1 px fringe column on its left side touching the
// background, and a 4×4 patch of the same colour deep in the core.
const fringedSubject = image((set) => {
  for (let y = 10; y < 30; y++) {
    for (let x = 10; x < 30; x++) set(x, y, SUBJECT);
  }
  for (let y = 10; y < 30; y++) set(10, y, fringeRgb);
  for (let y = 18; y < 22; y++) {
    for (let x = 18; x < 22; x++) set(x, y, fringeRgb);
  }
});

test('edge-match: without a fringe key the fringe and core patch stay opaque (control)', () => {
  const result = key(fringedSubject, null);
  assert.equal(alphaAt(result, 5, 5), 0, 'background removed');
  assert.equal(alphaAt(result, 10, 20), 255, 'fringe is not background-coloured');
  assert.equal(alphaAt(result, 19, 19), 255);
});

test('edge-match: an edge key removes the fringe strip and keeps the same colour in the core', () => {
  const result = key(fringedSubject, 'edge');
  for (let y = 10; y < 30; y++) assert.equal(alphaAt(result, 10, y), 0, `fringe at y=${y}`);
  for (let y = 18; y < 22; y++) {
    for (let x = 18; x < 22; x++) assert.equal(alphaAt(result, x, y), 255, `core patch at ${x},${y}`);
  }
  assert.equal(alphaAt(result, 11, 20), 255, 'subject next to the fringe');
});

test('edge-match: the same key as global removes the core patch too', () => {
  const result = key(fringedSubject, 'global');
  assert.equal(alphaAt(result, 10, 20), 0);
  for (let y = 18; y < 22; y++) {
    for (let x = 18; x < 22; x++) assert.equal(alphaAt(result, x, y), 0, `core patch at ${x},${y}`);
  }
});

test('edge-match: an edge key does not tunnel through a neck longer than edgeReach', () => {
  // Fringe-coloured neck from the subject's left side (x=10) to a blob inside.
  const necked = image((set) => {
    for (let y = 10; y < 30; y++) {
      for (let x = 10; x < 30; x++) set(x, y, SUBJECT);
    }
    for (let x = 10; x < 20; x++) set(x, 20, fringeRgb);
    for (let y = 18; y < 23; y++) {
      for (let x = 20; x < 26; x++) set(x, y, fringeRgb);
    }
  });
  const result = key(necked, 'edge');
  assert.equal(alphaAt(result, 10, 20), 0, 'depth 1');
  assert.equal(alphaAt(result, 11, 20), 0, 'depth 2');
  for (let x = 12; x < 20; x++) assert.equal(alphaAt(result, x, 20), 255, `neck beyond reach at x=${x}`);
  for (let y = 18; y < 23; y++) {
    for (let x = 20; x < 26; x++) assert.equal(alphaAt(result, x, y), 255, `blob at ${x},${y}`);
  }
});

test('edge-match: no edge key → byte-identical output on clip-08', async () => {
  const sheet = await loadPNG(`${FIXTURES_DIR}/clip-08/sheet.png`);
  const run = (extra) => runKeyer({ ...sheet, data: new Uint8ClampedArray(sheet.data) }, {
    connected: true,
    autoDetect: true,
    keyColors: [BACKGROUND],
    similarity: 0.48,
    feather: 0.2,
    spill: 0.55,
    preserveColors: true,
    subjectProtection: 0.55,
    cleanupRadius: 1,
    seedPoints: [],
    perCell: true,
    rows: 2,
    cols: 2,
    ...extra
  }).imageData.data;

  const plain = run({});
  assert.deepEqual(run({ keyRegions: [] }), plain, 'empty keyRegions');
  assert.deepEqual(run({ keyRegions: [{ hex: BACKGROUND.hex, matchMode: 'full' }] }), plain, 'non-edge region without a mode');
});

test('edge-match: an edge key that matches nothing at the boundary changes no byte on clip-08', async () => {
  const sheet = await loadPNG(`${FIXTURES_DIR}/clip-08/sheet.png`);
  const magenta = { r: 255, g: 0, b: 255, hex: '#ff00ff' };
  const run = (keyColors, keyRegions) => runKeyer({ ...sheet, data: new Uint8ClampedArray(sheet.data) }, {
    connected: true,
    autoDetect: false,
    keyColors,
    keyRegions,
    similarity: 0.48,
    feather: 0.2,
    spill: 0.55,
    preserveColors: true,
    subjectProtection: 0.55,
    cleanupRadius: 1,
    seedPoints: [],
    perCell: true,
    rows: 2,
    cols: 2
  }).imageData.data;

  const global = [{ hex: BACKGROUND.hex, matchMode: 'global' }];
  assert.deepEqual(
    run([BACKGROUND, magenta], [...global, { hex: magenta.hex, matchMode: 'edge', edgeReach: 2 }]),
    run([BACKGROUND], global)
  );
});
