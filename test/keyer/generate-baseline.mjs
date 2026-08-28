/**
 * Writes the golden baseline by running the keyer over the corpus.
 *
 * The committed baseline is what every later phase is measured against.
 * Regenerate it only when a phase deliberately changes output, and commit that
 * regeneration as its own reviewable diff — never bundled with the change that
 * caused it. A baseline regenerated in the same commit as the change proves
 * nothing: it agrees with whatever the code now does, including a mistake.
 */

import path from 'node:path';

import { savePNG } from './png.mjs';
import { CLIP_NAMES } from './corpus-generator.mjs';
import { loadKeyer, runClip, BASELINE_DIR } from './keyer-runner.mjs';

const keyer = await loadKeyer();

for (const clipName of CLIP_NAMES) {
  const outputs = await runClip(keyer, clipName);
  for (const output of outputs) {
    await savePNG(output.image, path.join(BASELINE_DIR, clipName, `${output.name}.png`));

    let transparent = 0;
    let partial = 0;
    for (let offset = 3; offset < output.image.data.length; offset += 4) {
      const alpha = output.image.data[offset];
      if (alpha === 0) transparent += 1;
      else if (alpha < 255) partial += 1;
    }
    const total = output.image.data.length / 4;
    const pct = (value) => `${((value / total) * 100).toFixed(1)}%`;
    console.log(
      `  ${clipName}/${output.name}: ${pct(transparent)} clear, ${pct(partial)} partial`
    );
  }
}

console.log(`baseline written to ${BASELINE_DIR}`);
