/**
 * Regenerates the synthetic corpus in place.
 *
 * Fixtures are committed, so this only needs running when the generator itself
 * changes. Output is deterministic: rerunning on unchanged code leaves the
 * working tree clean, and `git status` is the check that determinism still holds.
 */

import { generateCorpus } from './corpus-generator.mjs';
import { FIXTURES_DIR } from './keyer-runner.mjs';

const result = await generateCorpus(FIXTURES_DIR);
console.log(
  `corpus: ${result.videoClips} video clips x ${result.framesPerClip} frames + ${result.sheets} sheet -> ${FIXTURES_DIR}`
);
