import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  QUICK_PRESET_FIELDS,
  QUICK_PRESET_DEFAULTS,
  QUICK_PRESET_STORAGE_KEY,
  normalizeQuickPreset,
  parseQuickPreset,
  serializeQuickPreset,
  isDefaultQuickPreset
} from '../public/js/quick-preset.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(here, '..', 'public', 'index.html'), 'utf8');

test('defaults are the values the preset was specified with', () => {
  assert.deepEqual({ ...QUICK_PRESET_DEFAULTS }, {
    blend: 0.25,
    spill: 0.65,
    edgeCleanup: 1,
    chromaSmooth: 2,
    vibrance: 0.03,
    saturation: 0.05,
    temperature: 0.05,
    sharpenAmount: 0.05
  });
  assert.ok(isDefaultQuickPreset(QUICK_PRESET_DEFAULTS));
});

test('every field range matches the slider it drives in the markup', () => {
  const sliderIds = {
    blend: 'sliderBlend',
    spill: 'sliderSpill',
    edgeCleanup: 'sliderEdgeCleanup',
    chromaSmooth: 'sliderChromaSmooth',
    vibrance: 'sliderGradeVibrance',
    saturation: 'sliderGradeSaturation',
    temperature: 'sliderGradeTemperature',
    sharpenAmount: 'sliderSharpenAmount'
  };
  for (const field of QUICK_PRESET_FIELDS) {
    const id = sliderIds[field.key];
    assert.ok(id, `no slider mapped for ${field.key}`);
    const tag = html.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`))?.[0];
    assert.ok(tag, `${id} missing from index.html`);
    const attr = (name) => Number(tag.match(new RegExp(`${name}="([^"]+)"`))[1]);
    assert.equal(attr('min'), field.min, `${id} min`);
    assert.equal(attr('max'), field.max, `${id} max`);
    assert.equal(attr('step'), field.step, `${id} step`);
  }
});

test('markup has the checkbox, gear button and settings mount', () => {
  for (const id of ['chkQuickPreset', 'btnQuickPresetSettings', 'quickPresetSettings', 'quickPresetSettingsFields', 'btnQuickPresetReset']) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
  // Off by default: a freshly loaded video must never start with it ticked.
  assert.doesNotMatch(html.match(/<input[^>]*id="chkQuickPreset"[^>]*>/)[0], /checked/);
});

test('normalize clamps, rounds and fills in missing fields', () => {
  const preset = normalizeQuickPreset({ blend: 5, spill: -2, edgeCleanup: 1.6, chromaSmooth: 9, vibrance: '0.1', temperature: 'abc' });
  assert.equal(preset.blend, 1);
  assert.equal(preset.spill, 0);
  assert.equal(preset.edgeCleanup, 2);
  assert.equal(preset.chromaSmooth, 2);
  assert.equal(preset.vibrance, 0.1);
  assert.equal(preset.temperature, QUICK_PRESET_DEFAULTS.temperature);
  assert.equal(preset.saturation, QUICK_PRESET_DEFAULTS.saturation);
  assert.equal(preset.sharpenAmount, QUICK_PRESET_DEFAULTS.sharpenAmount);
});

test('empty strings and null fall back instead of becoming 0', () => {
  const preset = normalizeQuickPreset({ blend: '', spill: null, edgeCleanup: undefined });
  assert.equal(preset.blend, QUICK_PRESET_DEFAULTS.blend);
  assert.equal(preset.spill, QUICK_PRESET_DEFAULTS.spill);
  assert.equal(preset.edgeCleanup, QUICK_PRESET_DEFAULTS.edgeCleanup);
});

test('chroma smoothing never leaves 1..2 and keeps float noise out', () => {
  assert.equal(normalizeQuickPreset({ chromaSmooth: 0 }).chromaSmooth, 1);
  assert.equal(normalizeQuickPreset({ vibrance: 0.1 + 0.2 }).vibrance, 0.3);
});

test('parse swallows anything localStorage can hand back', () => {
  for (const raw of [null, undefined, '', 'not json', '[]', '42', 'null', '"x"']) {
    assert.deepEqual(parseQuickPreset(raw), { ...QUICK_PRESET_DEFAULTS }, String(raw));
  }
});

test('serialize → parse round-trips and keeps good fields of a damaged value', () => {
  const custom = normalizeQuickPreset({ blend: 0.4, spill: 0.8, edgeCleanup: 2, chromaSmooth: 1, vibrance: -0.2, saturation: 0.1, temperature: -0.05, sharpenAmount: 0.3 });
  assert.deepEqual(parseQuickPreset(serializeQuickPreset(custom)), custom);
  assert.equal(isDefaultQuickPreset(custom), false);
  const damaged = parseQuickPreset(JSON.stringify({ blend: 0.4, spill: 'x' }));
  assert.equal(damaged.blend, 0.4);
  assert.equal(damaged.spill, QUICK_PRESET_DEFAULTS.spill);
});

test('storage key is its own, not part of the clip state', () => {
  assert.equal(QUICK_PRESET_STORAGE_KEY, 'video-editor:quick-preset');
});
