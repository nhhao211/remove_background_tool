---
phase: 5
title: "Background model, trimap, connected components"
status: pending
priority: P1
effort: "12h"
dependencies: [4]
---

# Phase 5: Background model, trimap, connected components

## Overview

The largest visible win and the first phase a user notices. Three changes:

1. Replace per-key-colour `min()` Euclidean distance with a small set of Gaussian clusters
   using Mahalanobis distance — handles uneven screens, shadows, compression noise.
2. Classify into a three-region trimap instead of a single soft threshold.
3. Turn on connectivity for the video path: BFS flood fill from border + seeds, restricted
   to definite-background. A definite-background pixel the flood never reaches is *inside*
   the subject and stays opaque.

Fixes both "interior key-coloured region destroyed" and a large share of "colour eating".

## Key insights

- **Items 2 and 5 of the original Stage 1 already exist.** `detectEdgeColors`
  (`background-removal.js:31-93`) does border clustering; the BFS
  (`background-removal.js:226-288`) does border+seed flood fill. Phase 2 already moved both
  into `keyer/`. This phase turns them on for video and adds covariance on top.
- Existing chroma axes are **unnormalised** (`cb = b − y`, `cr = r − y`). Cb spans ≈ ±0.93,
  Cr ≈ ±0.79, so a circular threshold is really an ellipse and tolerance is
  direction-dependent. Phase 4 introduced the 0.564 / 0.713 normalisation; this phase
  depends on it.
- Keep Mahalanobis **2D over (Cb, Cr) only**. Full 3D including luma is wrong here: screen
  shading moves luma a lot, so inflating luma variance would admit dark subject pixels.
  Luma keeps its current fixed weight as a separate guard.
- This is where `thresholdProfile` from phase 2 is deleted and the two constant sets are
  deliberately unified, with the harness watching clip 8.

## Requirements

Functional:
- 2D Gaussian per background cluster, seeded from `detectEdgeColors` + user picks.
- Trimap: definite-BG / unknown / definite-FG.
- BFS flood fill from frame border + user seed points, over definite-BG only.
- Connected-component cleanup: drop foreground specks < N px, fill background pinholes.
- `connected: true` becomes the default for the video path.

Non-functional:
- O(N) per frame. Union-find for components.

## Architecture

**Model.** Accumulate mean and covariance per cluster in the same border pass that already
computes cluster means:

```
μ_k  = (mean Cb, mean Cr)
Σ_k  = [[var_cb, cov], [cov, var_cr]]      // 2×2, closed-form inverse
d_M(x)² = (x − μ_k)ᵀ Σ_k⁻¹ (x − μ_k)
d(x)  = min over k of d_M(x)
```

**Regularisation and clamping, specified.** "ε small" and "clamp the ellipse" are not
implementable as written, and both directly control the threshold surface, so they get
concrete values here and are tuned in step 1 rather than discovered during debugging.

Work in normalised chroma units from phase 4, where the full Cb/Cr range is ≈ ±0.5.

```js
const EPSILON      = 1e-4;   // ≈ (1/100 of chroma range)² — floors σ at ~0.01
const MIN_SIGMA    = 0.01;   // no axis may be tighter than this
const MAX_SIGMA    = 0.15;   // no axis may be looser than this
const MAX_ANISO    = 4.0;    // λ_max / λ_min

Σ += EPSILON * I;
// eigendecompose the 2×2 (closed form), then clamp each eigenvalue:
λ = clamp(λ, MIN_SIGMA², MAX_SIGMA²);
if (λ_max / λ_min > MAX_ANISO) λ_min = λ_max / MAX_ANISO;
// recompose
```

The three clamps do different jobs and all three are needed:

- `MIN_SIGMA` stops a flat, noise-free screen from producing a near-zero-variance cluster
  whose Mahalanobis distance explodes, which would make the tolerance slider useless.
- `MAX_SIGMA` stops a cluster that accidentally absorbed subject pixels from growing until
  it keys the whole frame — the failure mode where auto-detect eats the subject.
- `MAX_ANISO` stops a long thin ellipse from reaching far along one chroma axis. Without
  it, a screen with a strong lighting gradient produces a cluster elongated toward the
  subject's hue.

Starting values above are for 8-bit H.264 sources; tune `MIN_SIGMA` on clip 4 (uneven
screen, where variance is genuinely large) and `MAX_SIGMA`/`MAX_ANISO` on clip 3 (subject
colour ≈ key colour, where an over-grown cluster is most damaging). Record the final values
in this file. Expose none of them in the UI — they are model guardrails, not user controls.

**Trimap.**

```
d < t_bg                 → definite background
d > t_bg + w             → definite foreground
otherwise                → unknown band  (phase 6 refines, phase 7 recovers colour)
```

`t_bg` is the **Screen Tolerance** slider. `w` is derived, widened slightly by Edge Detail
in phase 6.

**The unknown band has a hard width cap of 8 px**, enforced here by morphological
constraint after classification: dilate definite-BG and definite-FG toward each other until
no unknown pixel is more than 8 px from a definite-BG neighbour. Phase 7 depends on this.
Its `estimateLocalBackground` searches a radius-8 neighbourhood for definite-BG pixels to
estimate `B̂`, and its fallback when it finds none — the global cluster mean — is a poor
estimate that feeds a division by small alpha and produces fireflies. Capping the band here
means the fallback is a genuine edge case rather than the normal path for any subject with
a wide soft edge. A pixel that would otherwise sit deep inside a thick band is instead
classified definite-FG, which is the safe direction: it keeps its own colour untouched.

**Connectivity.** Reuse the existing BFS verbatim, enqueueing only definite-BG pixels.
Seeds: all border pixels + `seedPoints`. Unreached definite-BG → reclassify as foreground.
This single rule is the interior-hole fix.

Cost is O(N) in time but the queue is the thing to watch: a `Uint32Array` ring buffer sized
to the pixel count is 4 bytes/pixel — 8 MB at 1080p, trivial — but a naive JS array of
pushed indices will box every entry and can exceed 100 MB on a large frame. Preallocate the
typed ring buffer once per frame size and reuse it across frames in the export loop, since
every frame in a sheet shares dimensions. The `visited` mask is a `Uint8Array` of the same
length. At 512 px this is ~330 KB total and disappears into the noise; at 1080p "Keep
Source Size" it is ~10 MB alongside phase 3's 33 MB float buffers, which the phase 3
dimension guard already bounds.

**Components.** Union-find over the final binary mask. Two passes: remove FG islands below
`minForegroundArea`, fill BG holes below `minBackgroundArea`. Both derived from frame area,
both overridable.

## Related code files

- Modify: `js/keyer/background.js` — covariance accumulation, `mahalanobis`, regularisation
- Modify: `js/keyer/matte.js` — trimap, BFS default-on, union-find components
- Modify: `js/keyer/index.js` — remove `thresholdProfile`, unify constants
- Modify: `js/app.js` — pass `connected: true`; expose seed-point picking for video path
- Modify: `index.html` — rename Similarity → **Screen Tolerance**; add seed-pick affordance

## Implementation steps

1. Add covariance accumulation to the existing border clustering. Unit-test the 2×2 inverse
   and the regularisation floor.
2. Add `mahalanobis(pixel, cluster)`; keep Euclidean available behind a flag for A/B during
   tuning.
3. Replace the single `smootherstep` classification with the three-region trimap.
4. Turn on BFS for the video path. Add the "unreached definite-BG → foreground" rule.
5. Union-find component cleanup, both directions.
6. Delete `thresholdProfile`; unify the video/sheet constants. This changes the Sprite Sheet
   Remover's output — see "Sheet path: what changing means" below for the decision rule that
   governs whether the diff is acceptable. Its own commit, reviewable and revertable alone.
7. Expose seed-point picking in the video UI (the sheet path already has it).
8. Rename the slider to Screen Tolerance; retune its curve against clips 3, 4, 6.
9. Harness against **ground-truth mattes** for clips 1, 2, 7 — not the phase 1 baseline.

### Sheet path: what "reviewed and accepted" means

The earlier draft said to accept "a documented, reviewed diff" on clip 8. That is not a
decision rule — it permits any regression as long as somebody looked at it, which sits badly
next to the plan's HOLD scope. Replace it with a gate that can actually fail:

The sheet path's constants are **within 10 % of the video path's** on every term
(`0.015 + 0.28·s^1.4` vs `0.018 + 0.30·s^1.4`; feather `0.003 + 0.11·f^1.45` vs
`0.002 + 0.12·b^1.55`). There is no recorded reason for the difference; it reads as drift
between two copies rather than deliberate tuning. Unifying is therefore expected to be
near-invisible, and the gate says so:

- **Accept** if clip 8's `alphaSAD` against its phase-4 output is below the threshold
  recorded when the corpus is authored, and `fringeContrast` does not worsen. Expected case.
- **Investigate** if the diff is larger. A visible change means the two constant sets were
  compensating for something else — most likely that the sheet path's auto-detect produces
  different clusters than the video path's user-picked colours. Fix the cause; do not widen
  the tolerance.
- **Escalate** if it cannot be brought under the threshold. Then the sheet path genuinely
  needs different tuning, and the correct answer is a per-path *preset* — a named default
  for Screen Tolerance and Edge Detail — not a hidden constant fork. Presets are already
  arriving in phase 7, so this costs nothing structurally.

Under no branch does the plan ship a silent sheet-path regression, and under no branch does
`thresholdProfile` survive.

## Todo list

- [ ] Covariance + 2×2 inverse + regularisation, unit-tested
- [ ] `MIN_SIGMA` / `MAX_SIGMA` / `MAX_ANISO` clamps implemented and tuned; values recorded
- [ ] Mahalanobis distance with Euclidean A/B flag
- [ ] Trimap three-region classification
- [ ] Unknown band capped at 8 px (phase 7 depends on this)
- [ ] BFS default-on for video; unreached-BG → FG rule
- [ ] Preallocated `Uint32Array` BFS queue reused across frames
- [ ] Union-find speck and pinhole cleanup
- [ ] `thresholdProfile` deleted; clip 8 diff meets the accept gate, or cause fixed
- [ ] Seed-point picking in video UI
- [ ] Screen Tolerance slider retuned
- [ ] Ground-truth comparison for clips 1, 2, 7

## Success criteria

- [ ] **Clip 7:** enclosed key-coloured region inside the subject survives. This is the
      headline fix.
- [ ] **Clip 4:** uneven/shadowed screen keys cleanly at one tolerance setting where the
      Euclidean model needed per-shot fiddling.
- [ ] **Clip 3:** subject colour near key colour retains its core; `coreRGBDelta` improves.
- [ ] **Clip 6:** multiple key colours handled by multi-cluster model.
- [ ] **Clip 8:** sheet path meets the accept gate above, or the underlying cause is fixed,
      or a documented per-path preset exists. Not "reviewed and waved through".
- [ ] `alphaSAD` vs ground truth improves on clips 1, 2, 7.
- [ ] No unknown-band pixel is further than 8 px from a definite-BG pixel — asserted, since
      phase 7 relies on it.
- [ ] Covariance clamps hold on a synthetic flat screen and on clip 4; final constant values
      written into this file.
- [ ] Per-frame cost still within budget (< 10 s for a 24-frame 512 px sheet).

## Risk assessment

| Risk | L×I | Mitigation |
|---|---|---|
| Unifying video/sheet constants regresses the sheet path | High × High | Three-branch accept gate above with a numeric threshold; constants differ by <10 % so a large diff means a real cause to fix, not a tolerance to widen |
| Singular / degenerate covariance on a flat screen | Med × High | `EPSILON` + eigenvalue clamps with named starting values; unit-tested on synthetic flat input; tuned on clips 3 and 4 |
| Thick unknown band starves phase 7's background estimate | Med × High | 8 px cap enforced here and asserted in success criteria |
| BFS queue allocation on large frames | Low × Med | Preallocated typed ring buffer reused across frames; bounded by phase 3's dimension guard |
| BFS reclassification opens a hole where subject touches frame edge | Med × High | Subject touching the border is legitimately connected; add a corpus case and consider an explicit "subject may touch edge" option |
| Component cleanup deletes genuine thin detail (a whisker, a stem) | High × High | Thresholds derived from area and conservative by default; validate on clip 1 which is exactly this case |
| Mahalanobis is slower than budget | Low × Med | 2D closed-form is ~6 flops/cluster/pixel; measure, fall back to Euclidean flag if needed |
| Auto-detected clusters pick up subject colour at the border | Med × High | Support threshold already exists in `detectEdgeColors`; add a max-cluster-count and let user delete a detected cluster |

## Security considerations

None.

## Next steps

Phase 6 refines the unknown band this phase produces.
