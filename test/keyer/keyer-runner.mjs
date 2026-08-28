/**
 * Runs the keyer over the corpus.
 *
 * Keying is a pure `ImageData -> ImageData` transform and `js/keyer/` touches
 * no DOM, so it imports directly into Node. No browser is involved and none is
 * needed — a harness that cannot run the keyer cannot gate anything.
 *
 * Phase 2 ran two implementations through this interface at once, A/B in one
 * process, to prove the unified module matched the pair it replaced. That pair
 * is now deleted and the committed baseline is the reference: it was generated
 * from the pre-refactor code, so `unified vs baseline` asserts exactly what
 * `unified vs legacy` did, without keeping a second copy of the keyer alive to
 * drift against the first.
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { cloneImageData } from './image.mjs';
import { loadPNG, exists } from './png.mjs';
import { FRAMES_PER_CLIP } from './corpus-generator.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const JS_DIR = path.resolve(here, '../../public/tools/remove-background/js');
export const FIXTURES_DIR = path.join(here, 'fixtures');
/** Golden output. Regenerated deliberately; guards against unintended drift. */
export const BASELINE_DIR = path.join(here, 'baseline');

/**
 * Frozen quality reference, captured at the end of phase 2.
 *
 * Deliberately not the same directory as the baseline. The baseline tracks
 * current output and gets regenerated whenever a phase changes it on purpose; a
 * quality gate measured against it would be comparing each run to itself and
 * would pass unconditionally. This copy never moves, so "did quality go
 * backwards" stays answerable across every later phase.
 */
export const REFERENCE_DIR = path.join(here, 'reference');

const moduleUrl = (file) => new URL(`file://${path.join(JS_DIR, file)}`).href;

/**
 * The shipping keyer. Throws rather than returning null if the module is
 * missing: a loader that degrades to null is how a suite ends up asserting
 * nothing while still reporting green.
 */
export async function loadKeyer() {
  const indexPath = path.join(JS_DIR, 'keyer/index.js');
  if (!(await exists(indexPath))) {
    throw new Error(`keyer module not found at ${indexPath}`);
  }
  const { runKeyer } = await import(moduleUrl('keyer/index.js'));
  return {
    name: 'keyer',
    runKeyer,
    runVideo(image, options) {
      return runKeyer(image, options).imageData;
    },
    runSheet(image, options) {
      return runKeyer(image, { ...options, connected: true, thresholdProfile: 'sheet' }).imageData;
    }
  };
}

export async function readSettings(clipName) {
  const raw = await fs.readFile(path.join(FIXTURES_DIR, clipName, 'settings.json'), 'utf8');
  return JSON.parse(raw);
}

/**
 * Produces one named output per unit of work in a clip: one per frame for a
 * video clip, one per variant for a sheet. The keyer mutates in place, so each
 * unit starts from a fresh clone of the decoded source.
 */
export async function runClip(keyer, clipName) {
  const settings = await readSettings(clipName);
  const clipDir = path.join(FIXTURES_DIR, clipName);
  const outputs = [];

  if (settings.path === 'video') {
    for (let frameIndex = 0; frameIndex < FRAMES_PER_CLIP; frameIndex += 1) {
      const suffix = String(frameIndex).padStart(3, '0');
      const source = await loadPNG(path.join(clipDir, `frame-${suffix}.png`));
      const options = { ...settings.options, keyColors: settings.keyColors };
      outputs.push({
        name: `frame-${suffix}`,
        image: keyer.runVideo(cloneImageData(source), options)
      });
    }
    return outputs;
  }

  if (settings.path === 'sheet') {
    const source = await loadPNG(path.join(clipDir, 'sheet.png'));
    for (const variant of settings.variants) {
      const { name, keyColors: variantColors, ...variantOptions } = variant;
      const options = {
        ...settings.options,
        ...variantOptions,
        keyColors: variantColors ?? settings.keyColors
      };
      outputs.push({
        name,
        image: keyer.runSheet(cloneImageData(source), options)
      });
    }
    return outputs;
  }

  throw new Error(`clip ${clipName}: unknown path "${settings.path}"`);
}

/** Ground-truth mattes exist only for the clips drawn from analytic coverage. */
export async function loadGroundTruth(clipName, outputName) {
  const matchesFrame = /^frame-(\d{3})$/.exec(outputName);
  if (!matchesFrame) return null;
  const mattePath = path.join(FIXTURES_DIR, clipName, `matte-${matchesFrame[1]}.png`);
  if (!(await exists(mattePath))) return null;
  const matte = await loadPNG(mattePath);
  // The matte is drawn as white-on-black coverage; alpha lives in the red channel.
  const alpha = new Uint8ClampedArray(matte.data.length);
  for (let offset = 0; offset < matte.data.length; offset += 4) {
    alpha[offset + 3] = matte.data[offset];
  }
  return alpha;
}
