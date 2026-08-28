/**
 * Chroma-key regression suite.
 *
 * The suite exists to answer one question per phase: did this change move
 * pixels it was not supposed to move? Every assertion therefore runs the real
 * keyer over the real corpus. Nothing here is stubbed — a stub would make the
 * suite pass while the tool is broken, which is the exact failure this file
 * replaces.
 */

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { describe, it, expect, beforeAll } from 'vitest';

import { CLIP_NAMES, generateCorpus } from './corpus-generator.mjs';
import { loadPNG, exists } from './png.mjs';
import { alphaSAD, coreRGBDelta } from './metrics.mjs';
import {
  loadKeyer,
  runClip,
  loadGroundTruth,
  readSettings,
  BASELINE_DIR,
  FIXTURES_DIR
} from './keyer-runner.mjs';

function rgbaDiff(current, expected) {
  if (current.length !== expected.length) {
    return { differing: Infinity, maxDelta: 255, firstIndex: 0 };
  }
  let differing = 0;
  let maxDelta = 0;
  let firstIndex = -1;
  for (let i = 0; i < current.length; i += 1) {
    const delta = Math.abs(current[i] - expected[i]);
    if (delta !== 0) {
      differing += 1;
      if (delta > maxDelta) maxDelta = delta;
      if (firstIndex < 0) firstIndex = i;
    }
  }
  return { differing, maxDelta, firstIndex };
}

// Loaded at collection time so a missing module fails the file outright rather
// than leaving suites registered against an undefined keyer.
const keyer = await loadKeyer();

let outputs;

beforeAll(async () => {
  outputs = new Map();
  for (const clipName of CLIP_NAMES) {
    outputs.set(clipName, await runClip(keyer, clipName));
  }
}, 120_000);

describe('corpus', () => {
  it('is deterministic — regeneration reproduces the committed fixtures', async () => {
    const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'keyer-corpus-'));
    try {
      await generateCorpus(scratch);
      for (const relative of ['clip-01/frame-002.png', 'clip-04/frame-000.png', 'clip-08/sheet.png']) {
        const regenerated = await fs.readFile(path.join(scratch, relative));
        const committed = await fs.readFile(path.join(FIXTURES_DIR, relative));
        expect(regenerated.equals(committed), `${relative} is not reproducible`).toBe(true);
      }
    } finally {
      await fs.rm(scratch, { recursive: true, force: true });
    }
  }, 60_000);

  it('ships ground-truth mattes for the clips that need them', async () => {
    for (const clipName of ['clip-01', 'clip-02', 'clip-07']) {
      const truth = await loadGroundTruth(clipName, 'frame-000');
      expect(truth, `${clipName} is missing a ground-truth matte`).not.toBeNull();
    }
  });

  it('declares option names the keyer actually reads', async () => {
    const video = await readSettings('clip-01');
    expect(Object.keys(video.options).sort()).toEqual(
      ['blend', 'cleanupRadius', 'enabled', 'similarity', 'spill', 'subjectProtection'].sort()
    );
    // The sheet path spells the same control `feather`, not `blend`. Passing
    // `blend` here would silently fall back to the 0.20 default.
    const sheet = await readSettings('clip-08');
    expect(sheet.options).toHaveProperty('feather');
    expect(sheet.options).not.toHaveProperty('blend');
  });
});

// The zero-diff gate. The baseline was generated from the two modules the
// unified keyer replaced, so byte equality here is the same claim the phase 2
// A/B made — and it keeps making it after those modules are gone.
describe('keyer versus committed baseline', () => {
  it('has a baseline on disk', async () => {
    expect(await exists(BASELINE_DIR)).toBe(true);
  });

  for (const clipName of CLIP_NAMES) {
    it(`${clipName} reproduces its baseline byte for byte`, async () => {
      const clipOutputs = outputs.get(clipName);
      expect(clipOutputs.length).toBeGreaterThan(0);
      for (const output of clipOutputs) {
        const baselinePath = path.join(BASELINE_DIR, clipName, `${output.name}.png`);
        expect(await exists(baselinePath), `missing baseline ${baselinePath}`).toBe(true);
        const expected = await loadPNG(baselinePath);
        const label = `${clipName}/${output.name}`;

        const sad = alphaSAD(output.image.data, expected.data);
        expect(sad, `${label}: alpha differs by ${sad}`).toBe(0);

        const diff = rgbaDiff(output.image.data, expected.data);
        expect(
          diff.differing,
          `${label}: ${diff.differing} channels differ, max delta ${diff.maxDelta}`
        ).toBe(0);

        expect(coreRGBDelta(output.image.data, expected.data), `${label}: core RGB moved`).toBe(0);
      }
    }, 60_000);
  }
});

describe('keyer does real work', () => {
  it('removes background and keeps the subject on every clip', () => {
    for (const clipName of CLIP_NAMES) {
      for (const output of outputs.get(clipName)) {
        const data = output.image.data;
        let clear = 0;
        let opaque = 0;
        for (let offset = 3; offset < data.length; offset += 4) {
          if (data[offset] === 0) clear += 1;
          else if (data[offset] === 255) opaque += 1;
        }
        const total = data.length / 4;
        const label = `${clipName}/${output.name}`;
        expect(clear / total, `${label}: nothing was keyed out`).toBeGreaterThan(0.2);
        expect(opaque / total, `${label}: the subject was erased`).toBeGreaterThan(0.02);
      }
    }
  });

  it('keeps the enclosed hole in clip 7 keyed on the unconnected video path', async () => {
    // Today the video path has no flood fill, so the hole punches through. This
    // is a characterisation test: phase 5 turns connectivity on and this
    // expectation flips, deliberately and visibly.
    const clipOutputs = outputs.get('clip-07');
    const image = clipOutputs[0].image;
    const centre = (((128 * image.width) + 128) * 4) + 3;
    expect(image.data[centre]).toBe(0);
  });
});

/**
 * These are the failures that used to be silent. Before assertOptions, each of
 * them produced a plausible-looking image and no complaint anywhere.
 */
describe('assertOptions rejects what used to fail quietly', () => {
  const frame = () => ({
    width: 4,
    height: 4,
    data: new Uint8ClampedArray(4 * 4 * 4).fill(255)
  });
  const green = [{ r: 24, g: 198, b: 62 }];

  it('rejects a video option handed to the sheet path', () => {
    // `blend` is the video path's spelling; the sheet path reads `feather`.
    // This used to leave the sheet path silently on its 0.20 default.
    expect(() => keyer.runKeyer(frame(), {
      connected: true, keyColors: green, blend: 0.4
    })).toThrow(/blend/);
  });

  it('rejects a sheet option handed to the video path', () => {
    expect(() => keyer.runKeyer(frame(), { keyColors: green, feather: 0.4 })).toThrow(/feather/);
  });

  it('names the path an option does belong to', () => {
    expect(() => keyer.runKeyer(frame(), {
      connected: true, keyColors: green, blend: 0.4
    })).toThrow(/direct path/);
  });

  it('rejects NaN from an empty slider read', () => {
    // parseFloat('') is NaN; clamp01(NaN) is 0; a 0 threshold keys nothing.
    expect(() => keyer.runKeyer(frame(), {
      keyColors: green, similarity: parseFloat('')
    })).toThrow(/finite number/);
  });

  it('rejects a thresholdProfile that does not match the strategy', () => {
    expect(() => keyer.runKeyer(frame(), {
      keyColors: green, thresholdProfile: 'sheet'
    })).toThrow(/thresholdProfile/);
  });

  it('accepts the option sets the real call sites build', async () => {
    const videoSettings = await readSettings('clip-01');
    expect(() => keyer.runKeyer(frame(), {
      ...videoSettings.options, keyColors: green
    })).not.toThrow();

    const sheetSettings = await readSettings('clip-08');
    expect(() => keyer.runKeyer(frame(), {
      ...sheetSettings.options, keyColors: green, connected: true, thresholdProfile: 'sheet'
    })).not.toThrow();
  });
});
