---
phase: 1
title: "Regression harness and test corpus"
status: pending
priority: P1
effort: "10h"
dependencies: []
---

# Phase 1: Regression harness and test corpus

## Overview

Nothing below is safe to land without this. The tool is 9.4k lines of untested JS driving
two code paths; phases 2–4 are refactors whose entire success criterion is "output did not
change", which is unprovable without a baseline.

## Key insights

- Fringe regressions are invisible on the default checkerboard preview. They only show
  when the sprite is composited over black, white, grey, and a colour opposite the key.
  Build the multi-background preview here, not in phase 7.
- The Sprite Sheet Remover path (`sprite-remover.js:507` → `background-removal.js`) carries
  per-cell logic, `regionAllows` gating, and `matchMode: 'global'` behaviour that the video
  path never exercises. It must be in the corpus before phase 2 touches it.

## Requirements

Functional:
- Deterministic re-run producing byte-comparable outputs for a fixed corpus + settings.
- Preview modes: Result, Alpha, Black, White, Grey, Colour.
- Side-by-side / diff view against a stored baseline.

Non-functional:
- Runs headless (node script) so it can gate commits, not only in-browser.
- Fast enough to run per phase — under 2 minutes for the whole corpus.

## Architecture

Keying is pure `ImageData → ImageData`. Extract nothing yet; just call the existing
entry points from Node with a canvas shim.

**Location matters.** The harness lives at `website/tests/remove-background/`, **not** under
`website/public/`. Anything under `public/` is served statically over HTTP with no auth, so
committing fixtures there would publish the test corpus — and any Bloom Realms source
footage in it — to anyone who guesses the path. The harness imports the tool's ES modules
by relative path (`../../public/tools/remove-background/js/...`); only the fixtures and
outputs move.

```
website/tests/remove-background/fixtures/{clip}/frame-NNN.png   source frames, lossless
website/tests/remove-background/fixtures/{clip}/settings.json   slider values for that clip
website/tests/remove-background/baseline/{clip}/frame-NNN.png   committed expected output
website/tests/remove-background/run.mjs                         renders corpus, diffs, reports
website/tests/remove-background/report/index.html               visual diff, multi-bg composite
```

Add `website/tests/remove-background/report/` and any scratch output to `.gitignore`;
commit only `fixtures/` and `baseline/`.

Use `@napi-rs/canvas` or `canvas` for `ImageData` in Node; both expose the exact
`Uint8ClampedArray` layout the tool uses. Avoid a headless browser — the modules are plain
ES modules with no DOM dependency inside the keying functions.

**Neither package is currently a dependency** — `website/package.json` has no `canvas`
entry. Step 0 is `npm i -D @napi-rs/canvas`. Prefer `@napi-rs/canvas`: it ships prebuilt
binaries, whereas `canvas` needs node-gyp plus Cairo system libraries and will fail to
install on a clean macOS or Windows machine without Homebrew/MSVC set up.

`protection-mask.js` does need a canvas (`createRadialGradient`), so the shim must provide
`canvasFactory`. It already takes one as a parameter (`protection-mask.js:26`) — pass the
Node canvas.

## Related code files

- Create: `website/tests/remove-background/run.mjs`
- Create: `website/tests/remove-background/fixtures/**`
- Create: `website/tests/remove-background/baseline/**`
- Create: `website/tests/remove-background/report-template.html`
- Modify: `website/package.json` — add `@napi-rs/canvas` devDependency + `test:keyer` script
- Modify: `website/.gitignore` — ignore `tests/remove-background/report/`
- Modify: `website/public/tools/remove-background/index.html` — add preview mode selector
- Modify: `website/public/tools/remove-background/js/app.js` — wire preview modes to canvas

## Test corpus

Eight clips. Extract 4–6 frames each as lossless PNG so the corpus is stable and does not
depend on video seek behaviour.

| # | Clip | Exercises |
|---|---|---|
| 1 | Hair / leaves / 1–2 px detail | Edge detail retention (phases 6, 7) |
| 2 | Motion blur + semi-transparent object | Partial alpha (phases 6, 7) |
| 3 | Subject colour ≈ key colour | Colour eating (phases 5, 7) |
| 4 | Uneven screen, shadows, compression noise | Background model (phase 5) |
| 5 | Same shot, H.264 yuv420p **and** lossless control | Isolates subsampling damage (phase 4) |
| 6 | Multiple key colours | Multi-cluster model (phase 5) |
| 7 | Subject with enclosed key-coloured region (ring, limb gap, leaf hole) | Flood-fill decision (phase 5) |
| 8 | Existing sprite sheet, per-cell + region mode | Sprite Sheet Remover path (phase 2) |

Clip 5's lossless control is the only way to tell "the algorithm failed" apart from
"the codec destroyed the chroma". Clip 7 is the direct test for the interior-hole bug.

**Clip 8 is not a video and does not follow the frame-extraction rule.** The Sprite Sheet
Remover path takes a finished sheet PNG as input, so clip 8 is a single
`fixtures/clip-08/sheet.png` plus a `settings.json` carrying `rows`, `cols`, `keyRegions`,
`seedPoints`, `matchMode`, and `perCell`. Source it by exporting one sheet from the tool on
current `develop` from any clip 1–7 source, then committing that sheet as the fixture — this
guarantees it has the compression characteristics and cell geometry of real output rather
than a synthetic grid. `run.mjs` dispatches clip 8 to `processSpriteSheet`, every other clip
to `applyChromaKey`; `settings.json` carries a `path: 'video' | 'sheet'` field so the
dispatch is explicit rather than inferred from the filename.

### Corpus sourcing

This is real work, not a footnote, and it is why this phase is 10h rather than 6h. There is
no video in the repo — `assets/bloom/` holds stills and audio only. Acquisition plan, in
preference order:

1. **Reuse existing production footage.** The green-screen clips already shot for the
   `bloom-*-combat-assets` skills are the ideal source and already cover several rows above.
2. **Shoot the gaps.** Clips 4 (uneven screen) and 5 (yuv420p vs lossless control) most
   likely need capturing: record once, export twice — `libx264 -pix_fmt yuv420p` and
   `-c:v ffv1` — from the identical source.
3. Extract 4–6 frames per clip with `ffmpeg -vf select` at lossless PNG.

Budget: 4 h of the 10 h is sourcing, extraction, and ground-truth matte authoring. Keep
frames ≤ 512 px so the whole committed corpus stays under ~5 MB; if it exceeds 10 MB, move
fixtures to a downloadable tarball and keep only `baseline/` in git.

## Metrics

Emitted per frame by `run.mjs`:

All metrics are computed by `run.mjs` on **unpremultiplied RGBA output buffers**, in sRGB
8-bit space, using BT.709 luma. Compositing is done arithmetically in the harness
(`out = α·F + (1−α)·bg`), never by drawing to a canvas — a canvas composite would
premultiply and quantise, which is exactly the error phase 3 exists to remove.

| Metric | Definition | Gate |
|---|---|---|
| `alphaSAD` | Σ\|α − α_baseline\| / N | Phases 2–4: must be 0 |
| `coreRGBDelta` | mean \|RGB − source\| where α = 255 | Phase 7: must approach 0 |
| `fringeContrast` | see below | Phase 7: must drop |
| `alphaVariance` | frame-to-frame α variance over the clip | Phase 9 only |
| `bandSAD` | Σ\|α − α_truth\| / N restricted to the ground-truth unknown band | Phase 6: must drop |

**`fringeContrast` replaces the earlier `fringeScore`.** Compositing the same pixel over
white and over black *always* differs by `(1−α)`, so a raw white-vs-black luma delta
measures transparency, not fringe, and a legitimately dark subject scores as badly as a
real dark rim. What actually identifies a fringe is that the recovered foreground colour
differs from the colour of the subject immediately inside it:

```
for each pixel p where 0.05 < α < 0.95:
    F_p       = unpremultiplied RGB at p
    F_inside  = mean RGB of pixels within radius 3 where α > 0.95
    if no such neighbour: skip p
    d_p       = luma(F_p) − luma(F_inside)      // signed
fringeContrast = mean(d_p) over all counted p
```

Signed on purpose. A negative mean is a dark rim, positive is a light one, and ~0 is a
clean edge. It is independent of α, so it does not reward crisping, and it has an
unambiguous target rather than "smaller is better".

**`detailRetention` is dropped.** It counted pixels with α∈(0.05,0.95), which a uniformly
half-transparent frame maximises — it rewarded softening, the exact failure phase 6 must
avoid, and it would have flagged a correctly crisped edge as a regression. Ground-truth
`bandSAD` measures what it was reaching for and cannot be gamed the same way.

Hand-authored ground-truth mattes are **not** required for phases 2–4 (baseline is the
current output). They are required for clips 1, 2, 7 before phase 5 changes matte
generation — budget that authoring time here.

### The halo criterion is measurable, so measure it

"No visible grey rim" cannot gate anything. Define it once, here, and reuse it in phases 7
and 8: render the output at 4× with bilinear filtering over white and over black, then
assert `|fringeContrast|` on the upscaled result stays under the threshold recorded when
the corpus is first authored. Phase 8's bilinear-halo check calls this same function.

## Implementation steps

0. `npm i -D @napi-rs/canvas` in `website/`; add a `test:keyer` script. Verify it installs
   clean on both a macOS and a Windows machine before building on it.
1. Add `website/tests/remove-background/` with a Node canvas shim exposing `ImageData` and
   `canvasFactory`. **Not** under `public/`.
2. Source and extract the corpus (see Corpus sourcing above). Do this before writing
   metrics — the metric thresholds are only meaningful against real frames.
3. Write `run.mjs`: load fixtures → dispatch on `settings.path` to `applyChromaKey` or
   `processSpriteSheet` → write output PNGs.
4. Implement arithmetic compositing (`composite(buf, bgColour)`) and the metrics above.
   `fringeContrast` needs the radius-3 inside-neighbour search — unit-test it on a synthetic
   frame with a known-width rim.
5. Add diff: per-frame metrics table + PNG diff images.
6. Generate and commit the baseline from current `develop` code. This is the "before".
7. Author ground-truth mattes for clips 1, 2, 7.
8. Build the HTML report — grid of frames × background colours.
9. Add preview mode selector to the tool UI (`index.html` + `app.js`); reuse the same
   composite code as the report so preview and test agree.
10. **Snapshot the option shape of all 7 `applyChromaKey` call sites** into
    `fixtures/call-sites.json` — the literal keys each site passes today. Phase 2 asserts
    against this, which is what makes its migration checkable rather than eyeballed.
11. Document how to run in `README.md`.

## Todo list

- [ ] `@napi-rs/canvas` devDependency added; installs clean on macOS and Windows
- [ ] Harness scaffolded under `website/tests/`, **not** `website/public/`
- [ ] Corpus clips 1–7 sourced/extracted; clip 8 sheet exported from current `develop`
- [ ] Node canvas shim
- [ ] `run.mjs` dispatches on `settings.path` for both code paths
- [ ] Arithmetic compositing (no canvas round trip) + `fringeContrast` unit-tested
- [ ] Metrics emitted as JSON; `detailRetention` deliberately absent
- [ ] Baseline generated from current `develop`
- [ ] Ground-truth mattes for clips 1, 2, 7
- [ ] Bilinear 4× halo check implemented as a reusable function
- [ ] HTML visual diff report
- [ ] In-tool preview modes: Result / Alpha / Black / White / Grey / Colour
- [ ] `fixtures/call-sites.json` snapshot of all 7 call-site option shapes
- [ ] `README.md`

## Success criteria

- [ ] `npm run test:keyer` completes in under 2 minutes.
- [ ] Re-running against unmodified code reports zero diff on every clip.
- [ ] Report renders each output over 4 background colours.
- [ ] Sprite Sheet Remover path (clip 8) covered, including per-cell and region modes.
- [ ] Every metric is a number with a stated target — no criterion in this plan reads
      "no visible X" without a function behind it.
- [ ] No fixture, baseline, or report file is reachable under `website/public/`.

## Risk assessment

| Risk | L×I | Mitigation |
|---|---|---|
| Node canvas `ImageData` differs subtly from browser | Med × High | Assert on a fixed input that Node and browser produce identical bytes before trusting the baseline |
| Corpus sourcing overruns the estimate | High × Med | 4 h explicitly budgeted; reuse `bloom-*-combat-assets` footage first; only clips 4–5 likely need shooting |
| Corpus clips are large binaries in git | High × Low | Store 4–6 PNG frames per clip, not the videos; keep cells ≤512 px; tarball escape hatch above 10 MB |
| Baseline captures existing bugs as "correct" | High × Med | Intended for phases 2–4. Phases 5+ compare against ground-truth mattes instead, not the baseline |
| `@napi-rs/canvas` fails to build on a teammate's machine | Med × Med | Prebuilt binaries; verified on macOS + Windows in step 0 before anything depends on it |
| Fixture licensing / source availability | Low × Med | Self-shot footage or existing project assets only |

## Security considerations

**Fixture placement is the security decision in this phase.** `website/public/` is served
statically with no authentication, so the original plan's
`public/tools/remove-background/tests/fixtures/**` would have made every committed test
frame fetchable by anyone who guessed the path — including any unreleased Bloom Realms
footage used as a source clip. The harness therefore lives at `website/tests/`.

- Fixtures and baselines: committed, but outside any served directory.
- Report output: gitignored.
- No network access, no credentials, no user input — `run.mjs` reads only local files.
- Do not add unreleased character or boss art to the corpus even under `tests/`; prefer
  footage of already-shipped assets.

## Next steps

Phase 2 cannot start until the baseline is committed and reproduces clean.
