# Chroma-key regression harness

Gates the keyer work planned in `plans/260828-1430-video-sprite-chroma-key-quality/`.

## Why it lives here and not under `public/`

Everything under `website/public/` is served over HTTP without authentication.
Fixtures, baselines and reports are test data, so they stay outside it.

## Running

```bash
npm run test:keyer        # the suite
npm run keyer:corpus      # regenerate fixtures (rarely needed)
npm run keyer:baseline    # regenerate the golden baseline
```

No browser and no headless Chrome. Keying is a pure `ImageData -> ImageData`
transform and both keyer modules import straight into Node.

## What each part is for

| File | Role |
|---|---|
| `image.mjs` | Deterministic raster primitives, seeded PRNG |
| `png.mjs` | PNG decode/encode via `sharp`, raw unpremultiplied RGBA |
| `corpus-generator.mjs` | The 8-clip synthetic corpus and its ground-truth mattes |
| `keyer-runner.mjs` | Runs the keyer over a clip |
| `metrics.mjs` | `alphaSAD`, `coreRGBDelta`, `fringeContrast`, `bandSAD`, `bilinearHaloCheck` |
| `keyer.test.mjs` | Zero-diff baseline regression and option validation |
| `metrics.test.mjs` | Tests for the metrics themselves |
| `fixtures/` | Committed corpus, byte-reproducible from the generator |
| `baseline/` | Committed golden output of the pre-refactor keyer |

## Rules the harness depends on

**The baseline is committed, not generated per machine.** It is the reference a
refactor is proved against. When a phase changes output deliberately, regenerate
it as its own commit so the pixel diff is reviewable on its own.

**The corpus is a pure function of its seeds.** `npm run keyer:corpus` on
unchanged code must leave `git status` clean. A corpus drawn through a canvas
library would break this the first time that library changed its rasteriser, and
every baseline with it. `corpus` asserts this in the suite.

**Nothing in here may be stubbed.** A placeholder that returns its input makes
the suite pass while the tool is broken. If a module cannot be exercised yet, its
test must be skipped visibly, never faked.

**`fringeContrast` is signed and `bandSAD` is band-limited on purpose.** An
unsigned edge score and a whole-frame detail score are both maximised by a
uniformly half-transparent frame, so they reward blanket softening — the exact
regression the refinement phases must avoid. `metrics.test.mjs` pins that.

## Corpus status

`fixtures/` is synthetic. That is sufficient for the zero-diff phases, where the
claim is "output did not change" and what matters is covering every code path
deterministically, not photorealism.

It is **not** sufficient from phase 3 onward, where defaults get tuned against
real footage. See `fixtures/real/README.md` for what still has to be shot.

## Ground-truth mattes

Clips 1, 2 and 7 ship `matte-NNN.png` alongside each frame, because their
subjects are drawn from known analytic coverage. Alpha is carried in the red
channel. These are what `bandSAD` scores against in phases 6 and 7 — a real
corpus cannot supply them, which is why the synthetic corpus stays useful even
after real footage lands.
