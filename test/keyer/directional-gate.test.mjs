/**
 * Directional gate for phase 3 and later.
 *
 * The byte-for-byte baseline in keyer.test.mjs answers "did anything change".
 * That is the right question for a refactor and the wrong one from phase 3 on,
 * where the whole point is that output *should* change — for the better. This
 * gate answers "did it change in the right direction".
 *
 * Reference values are measured from the frozen reference images rather than
 * pasted in as literals. An earlier version hardcoded three clips' numbers and
 * asserted `toBeCloseTo` against them, which pins the value instead of steering
 * it: an improvement failed exactly as hard as a regression, and the numbers in
 * the test names went stale the moment the golden baseline was regenerated.
 *
 * The metrics are all directional by construction — see metrics.mjs. Their
 * unsigned, whole-frame equivalents are maximised by a uniformly half-
 * transparent frame, so a gate built on those would reward blanket softening,
 * which is the exact regression these phases have to avoid.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';

import { CLIP_NAMES } from './corpus-generator.mjs';
import { fringeContrast, coreRGBDelta, bandSAD, bilinearHaloCheck } from './metrics.mjs';
import { loadKeyer, runClip, loadGroundTruth, REFERENCE_DIR } from './keyer-runner.mjs';
import { loadPNG } from './png.mjs';

/**
 * Slack on each comparison, in the metric's own units.
 *
 * Not a quality budget — a noise floor. A change of a few hundredths in a mean
 * is rounding, not a regression, and gating on exact monotonicity would make the
 * suite flap.
 */
const NOISE_FLOOR = 0.05;

/**
 * Soft-band pixels a clip must have before `fringeContrast` means anything.
 *
 * `fringeContrast` averages over pixels with 0.05 < alpha < 0.95, so its
 * denominator is a property of the matte under test, not of the corpus. On these
 * synthetic clips that denominator is 0, 5, 6, 8, 10 and 16 pixels — small
 * enough that a two-pixel change swings the mean by tens of luma levels, and
 * small enough that two runs are not even averaging the same population.
 *
 * Gating on that produces confident nonsense. It read as a 3x fringe regression
 * on clip-03 and a 4x one on clip-04 when the linear-light path landed; the
 * actual cause was clip-04's soft band going from 10 pixels to 753, i.e. the new
 * path resolving a genuinely anti-aliased edge the old one had clipped square.
 * The metric scored the improvement as a regression.
 *
 * So the metric is not wrong, the corpus is: mattes drawn with hard edges cannot
 * exercise a fringe measure. Real footage is what supplies a soft band with a
 * real population — this is the concrete reason phase 3 step 5 waits on it,
 * recorded here so the number is not mistaken for a quality signal in the
 * meantime. `bandSAD` is unaffected: its population comes from the ground-truth
 * matte, which is fixed, so both runs are scored against the same pixels.
 */
const MIN_SOFT_BAND = 200;

function softBandSize(image) {
  let count = 0;
  for (let offset = 3; offset < image.data.length; offset += 4) {
    const alpha = image.data[offset] / 255;
    if (alpha > 0.05 && alpha < 0.95) count += 1;
  }
  return count;
}

/**
 * How far subject-core colour may drift from the frozen reference.
 *
 * These phases change how the *matte* is computed. The colour of a pixel that is
 * fully opaque in both runs is not their business, so it should barely move.
 * Some movement is expected and legitimate — phase 3 keys in linear light, and
 * despill strength follows the keying decision — but a large number here means
 * the subject itself is being recoloured, which no phase asks for.
 */
const CORE_DRIFT_LIMIT = 4;

const keyer = await loadKeyer();

/** Current output and the frozen reference, measured with the same functions. */
const measured = new Map();

beforeAll(async () => {
  for (const clipName of CLIP_NAMES) {
    const outputs = await runClip(keyer, clipName);
    const output = outputs[0];
    if (!output) continue;

    const referenceImage = await loadPNG(path.join(REFERENCE_DIR, clipName, `${output.name}.png`));
    const groundTruth = await loadGroundTruth(clipName, output.name);

    measured.set(clipName, {
      hasGroundTruth: Boolean(groundTruth),
      // Both runs must clear the bar: a comparison is only as good as its
      // smaller population.
      softBand: Math.min(softBandSize(output.image), softBandSize(referenceImage)),
      current: {
        fringeContrast: fringeContrast(output.image),
        haloCheck: bilinearHaloCheck(output.image),
        bandSAD: groundTruth ? bandSAD(output.image.data, groundTruth) : null
      },
      reference: {
        fringeContrast: fringeContrast(referenceImage),
        haloCheck: bilinearHaloCheck(referenceImage),
        bandSAD: groundTruth ? bandSAD(referenceImage.data, groundTruth) : null
      },
      coreDrift: coreRGBDelta(output.image.data, referenceImage.data)
    });
  }
}, 120_000);

/**
 * Clips whose ground-truth fit the linear-light wiring made worse.
 *
 * Phase 3 moved keying into linear light but kept the threshold constants that
 * were tuned in gamma space — the phase splits those into separate steps on
 * purpose. Across the corpus the wiring is a net win on ground-truth fit (mean
 * bandSAD 90.90 against the reference's 92.66, driven by clip-07 at 104.21 ->
 * 97.58); clip-01 is the one clip that moved the other way, by 1.35.
 *
 * This is `it.fails`, not a skip or a relaxed bound. The assertion still runs
 * and still has to fail; when step 5's re-tuning lands and the metric recovers,
 * this test goes red and forces its own removal. A skip would rot silently.
 */
const KNOWN_REGRESSIONS = new Set(['clip-01:bandSAD']);

const gate = (clipName, metric) =>
  (KNOWN_REGRESSIONS.has(`${clipName}:${metric}`) ? it.fails : it);

describe('directional gate', () => {
  describe('fringeContrast moves toward zero', () => {
    // Signed: negative is a dark rim, positive a light one. Magnitude is what
    // has to shrink, so the comparison is on absolute value.
    for (const clipName of CLIP_NAMES) {
      gate(clipName, 'fringeContrast')(`${clipName}`, ({ skip }) => {
        const { current, reference, softBand } = measured.get(clipName);
        skip(
          softBand < MIN_SOFT_BAND,
          `soft band is ${softBand} px, under the ${MIN_SOFT_BAND} px this metric needs to mean anything`
        );
        expect(Math.abs(current.fringeContrast))
          .toBeLessThanOrEqual(Math.abs(reference.fringeContrast) + NOISE_FLOOR);
      });
    }
  });

  describe('bilinear halo does not worsen', () => {
    // What a downstream consumer sees after scaling the sheet: RGB left in
    // low-alpha pixels blooms into a rim. Phase 6's guided filter is what should
    // move this; here it only has to not get worse.
    //
    // This is `fringeContrast` of the upsampled frame, so it carries the same
    // sign convention and is compared the same way — on magnitude. Comparing it
    // raw scores a dark rim getting lighter as a regression, which is backwards
    // for every clip whose rim happens to be dark.
    for (const clipName of CLIP_NAMES) {
      gate(clipName, 'haloCheck')(`${clipName}`, ({ skip }) => {
        const { current, reference, softBand } = measured.get(clipName);
        // Same denominator problem, inherited: the upsample multiplies the band
        // by the scale factor but cannot create detail that was not there.
        skip(
          softBand < MIN_SOFT_BAND,
          `soft band is ${softBand} px, under the ${MIN_SOFT_BAND} px this metric needs to mean anything`
        );
        expect(Math.abs(current.haloCheck))
          .toBeLessThanOrEqual(Math.abs(reference.haloCheck) + NOISE_FLOOR);
      });
    }
  });

  describe('band-limited fit to ground truth does not worsen', () => {
    // Restricted to the soft-edge band. Measured over the whole frame it would
    // be dominated by the interior, where every implementation agrees, and would
    // move too little to gate on.
    for (const clipName of CLIP_NAMES) {
      gate(clipName, 'bandSAD')(`${clipName}`, () => {
        const { current, reference, hasGroundTruth } = measured.get(clipName);
        if (!hasGroundTruth) {
          expect(current.bandSAD).toBeNull();
          return;
        }
        expect(current.bandSAD).toBeLessThanOrEqual(reference.bandSAD + NOISE_FLOOR);
      });
    }
  });

  describe('subject core colour stays put', () => {
    for (const clipName of CLIP_NAMES) {
      it(`${clipName}`, () => {
        const { coreDrift } = measured.get(clipName);
        expect(coreDrift).toBeLessThan(CORE_DRIFT_LIMIT);
      });
    }
  });
});
