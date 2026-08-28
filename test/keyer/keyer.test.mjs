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
import test from 'node:test';
import assert from 'node:assert/strict';

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

// Setup hook for all tests
test.before(async () => {
  outputs = new Map();
  for (const clipName of CLIP_NAMES) {
    outputs.set(clipName, await runClip(keyer, clipName));
  }
});

await test('corpus', async (t) => {
  await t.test('is deterministic — regeneration reproduces the committed fixtures', async () => {
    const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'keyer-corpus-'));
    try {
      await generateCorpus(scratch);
      for (const relative of ['clip-01/frame-002.png', 'clip-04/frame-000.png', 'clip-08/sheet.png']) {
        const regenerated = await fs.readFile(path.join(scratch, relative));
        const committed = await fs.readFile(path.join(FIXTURES_DIR, relative));
        assert.ok(regenerated.equals(committed), `${relative} is not reproducible`);
      }
    } finally {
      await fs.rm(scratch, { recursive: true, force: true });
    }
  });

  await t.test('ships ground-truth mattes for the clips that need them', async () => {
    for (const clipName of ['clip-01', 'clip-02', 'clip-07']) {
      const truth = await loadGroundTruth(clipName, 'frame-000');
      assert.ok(truth !== null, `${clipName} is missing a ground-truth matte`);
    }
  });

  await t.test('declares option names the keyer actually reads', async () => {
    const video = await readSettings('clip-01');
    assert.deepEqual(Object.keys(video.options).sort(),
      ['blend', 'cleanupRadius', 'enabled', 'similarity', 'spill', 'subjectProtection'].sort());
    // The sheet path spells the same control `feather`, not `blend`. Passing
    // `blend` here would silently fall back to the 0.20 default.
    const sheet = await readSettings('clip-08');
    assert.ok('feather' in sheet.options, 'sheet options must have feather');
    assert.ok(!('blend' in sheet.options), 'sheet options must not have blend');
  });
});

// The zero-diff gate. The baseline was generated from the two modules the
// unified keyer replaced, so byte equality here is the same claim the phase 2
// A/B made — and it keeps making it after those modules are gone.
await test('keyer versus committed baseline', async (t) => {
  await t.test('has a baseline on disk', async () => {
    assert.ok(await exists(BASELINE_DIR), 'baseline directory must exist');
  });

  for (const clipName of CLIP_NAMES) {
    await t.test(`${clipName} reproduces its baseline byte for byte`, async () => {
      const clipOutputs = outputs.get(clipName);
      assert.ok(clipOutputs.length > 0, `${clipName} must have outputs`);
      for (const output of clipOutputs) {
        const baselinePath = path.join(BASELINE_DIR, clipName, `${output.name}.png`);
        assert.ok(await exists(baselinePath), `missing baseline ${baselinePath}`);
        const expected = await loadPNG(baselinePath);
        const label = `${clipName}/${output.name}`;

        const sad = alphaSAD(output.image.data, expected.data);
        assert.equal(sad, 0, `${label}: alpha differs by ${sad}`);

        const diff = rgbaDiff(output.image.data, expected.data);
        assert.equal(
          diff.differing,
          0,
          `${label}: ${diff.differing} channels differ, max delta ${diff.maxDelta}`
        );

        assert.equal(coreRGBDelta(output.image.data, expected.data), 0, `${label}: core RGB moved`);
      }
    });
  }
});

await test('keyer does real work', async (t) => {
  await t.test('removes background and keeps the subject on every clip', () => {
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
        assert.ok(clear / total > 0.2, `${label}: nothing was keyed out`);
        assert.ok(opaque / total > 0.02, `${label}: the subject was erased`);
      }
    }
  });

  await t.test('keeps the enclosed hole in clip 7 keyed on the unconnected video path', async () => {
    // Today the video path has no flood fill, so the hole punches through. This
    // is a characterisation test: phase 5 turns connectivity on and this
    // expectation flips, deliberately and visibly.
    const clipOutputs = outputs.get('clip-07');
    const image = clipOutputs[0].image;
    const centre = (((128 * image.width) + 128) * 4) + 3;
    assert.equal(image.data[centre], 0, 'enclosed hole must be keyed transparent');
  });
});

/**
 * These are the failures that used to be silent. Before assertOptions, each of
 * them produced a plausible-looking image and no complaint anywhere.
 */
await test('assertOptions rejects what used to fail quietly', async (t) => {
  const frame = () => ({
    width: 4,
    height: 4,
    data: new Uint8ClampedArray(4 * 4 * 4).fill(255)
  });
  const green = [{ r: 24, g: 198, b: 62 }];

  await t.test('rejects a video option handed to the sheet path', () => {
    // `blend` is the video path's spelling; the sheet path reads `feather`.
    // This used to leave the sheet path silently on its 0.20 default.
    assert.throws(() => keyer.runKeyer(frame(), {
      connected: true, keyColors: green, blend: 0.4
    }), /blend/);
  });

  await t.test('rejects a sheet option handed to the video path', () => {
    assert.throws(() => keyer.runKeyer(frame(), { keyColors: green, feather: 0.4 }), /feather/);
  });

  await t.test('names the path an option does belong to', () => {
    assert.throws(() => keyer.runKeyer(frame(), {
      connected: true, keyColors: green, blend: 0.4
    }), /direct path/);
  });

  await t.test('rejects NaN from an empty slider read', () => {
    // parseFloat('') is NaN; clamp01(NaN) is 0; a 0 threshold keys nothing.
    assert.throws(() => keyer.runKeyer(frame(), {
      keyColors: green, similarity: parseFloat('')
    }), /finite number/);
  });

  await t.test('rejects a thresholdProfile that does not match the strategy', () => {
    assert.throws(() => keyer.runKeyer(frame(), {
      keyColors: green, thresholdProfile: 'sheet'
    }), /thresholdProfile/);
  });

  await t.test('accepts the option sets the real call sites build', async () => {
    const videoSettings = await readSettings('clip-01');
    assert.doesNotThrow(() => keyer.runKeyer(frame(), {
      ...videoSettings.options, keyColors: green
    }));

    const sheetSettings = await readSettings('clip-08');
    assert.doesNotThrow(() => keyer.runKeyer(frame(), {
      ...sheetSettings.options, keyColors: green, connected: true, thresholdProfile: 'sheet'
    }));
  });
});
