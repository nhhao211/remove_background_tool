---
phase: 6
title: "Guided filter refinement and Edge Bias"
status: pending
priority: P1
effort: "10h"
dependencies: [5]
---

# Phase 6: Guided filter refinement and Edge Bias

## Overview

Recover the detail that hard erosion currently destroys. Two changes:

1. Refine alpha inside the unknown band with a guided filter (He/Sun/Tang, ECCV 2010),
   guided by luma so the matte follows real image edges.
2. Replace `erodeForegroundAlpha` (`chroma-key.js:55-87`, now `keyer/refine.js`) — which
   deletes whole pixels — with a soft, signed **Edge Bias** that can shrink *or* grow the
   matte.

Morphological opening/closing survives only for removing isolated specks, which phase 5's
component pass largely already handles.

## Key insights

- Guided filter is the right cost/quality point. Levin closed-form matting is the quality
  ceiling but needs a sparse linear solve per frame — not viable in JS. Joint-bilateral
  costs the same and preserves gradients worse.
- Guide must be **luma at full resolution** — specifically the unsmoothed luma, since
  phase 4 only blurred chroma. This is why chroma smoothing costs nothing in final detail.
- Apply **only inside the unknown band**. Running it over definite regions softens edges
  that phase 5 correctly decided were hard.
- Box filters over integral images make each of the four passes O(1) per pixel, so the
  whole filter is O(N).
- Fast Guided Filter (arXiv:1505.00996) subsamples by `s` before computing coefficients,
  giving O(N/s²). Not needed at 512 px. Implement the plain version; keep subsampling in
  reserve for "Keep Source Size" 1080p.
- The O(N) claim is asymptotic and says nothing about the constant, which here is large:
  four integral images, each a two-pass prefix sum with poor cache locality on the vertical
  pass, plus six per-pixel array reads for the coefficients. This is the single most
  expensive step in the pipeline and the plan's cost estimate for it is unverified — hence
  the benchmark gate in step 4 below, before the rest of the phase is built on top of it.

## Requirements

Functional:
- Guided filter over the unknown band, guide = luma, input = raw alpha.
- **Edge Detail** slider → `ε` (and `r`).
- **Edge Bias** slider → signed alpha offset, negative shrinks, positive grows.
- `cleanupRadius` erosion removed from the UI; behaviour subsumed by Edge Bias.

Non-functional:
- O(N). Budget ≤ 40 % of per-frame keying cost at 512 px.

## Architecture

```
mean_I  = boxfilter(I, r)      mean_p  = boxfilter(p, r)
corr_I  = boxfilter(I·I, r)    corr_Ip = boxfilter(I·p, r)
var_I   = corr_I − mean_I²     cov_Ip  = corr_Ip − mean_I·mean_p
a = cov_Ip / (var_I + ε)       b = mean_p − a·mean_I
q = boxfilter(a, r)·I + boxfilter(b, r)
```

`I` = luma (linear, 0..1), `p` = raw alpha, `q` = refined alpha. Composite back:

```js
alpha[i] = isUnknown[i] ? clamp01(q[i]) : alpha[i];
```

Parameters at 512 px cells, values in linear light so ≤ 1:

| Param | Range | Default |
|---|---|---|
| `r` | 2–12 | 6 |
| `ε` | 1e-5 – 1e-2 (log scale) | 1e-4 |

Edge Detail maps primarily to `ε` on a log scale; larger `ε` = softer, more detail
retained. Expose `r` as advanced only.

**Edge Bias**, replacing erosion:

```js
// bias ∈ [-1, +1]; applied only in the unknown band
alpha[i] = clamp01(alpha[i] + bias * softness(alpha[i]));
// softness peaks at alpha ≈ 0.5 so definite regions are untouched
```

Reuse the same box-filter primitive as phase 4's blur where possible.

## Related code files

- Modify: `js/keyer/refine.js` — guided filter, integral images, Edge Bias; delete
  `erodeForegroundAlpha`
- Modify: `js/keyer/index.js` — call refine after trimap
- Modify: `index.html` — replace "Edge Cleanup (px)" with **Edge Detail** and **Edge Bias**
- Modify: `js/app.js` — plumb new options; drop `cleanupRadius` from the video path

## Implementation steps

1. Implement integral-image box filter over `Float32Array`; unit-test against naive sums,
   including edge clamping.
2. Implement the guided filter; unit-test the local-linear property on a synthetic ramp.
3. Restrict application to the unknown band; verify definite regions are bit-identical.
4. **Benchmark gate.** Measure the filter alone on a 512×512 frame at `r = 6`, and on a
   1080p frame, before tuning or UI work.
   - **≤ 15 ms at 512 px:** proceed with the plain filter as planned.
   - **> 15 ms:** implement Fast Guided Filter (`s = 2` or `4`) now rather than deferring it
     to a hypothetical 1080p follow-up. Subsampling changes the tuned `ε` range, so
     discovering this after step 5 means re-tuning twice.
   Record the measured number in this file either way — the whole-pipeline budget in
   `plan.md` currently rests on an estimate, and this is the term most likely to break it.
   Because the filter runs only inside the unknown band, also record what fraction of the
   frame that band actually covers on clips 1 and 2; if it is much larger than the few
   percent assumed, the budget needs revisiting regardless of the per-pixel cost.
5. Tune `r` / `ε` defaults against clips 1 and 2.
6. Implement Edge Bias with the softness weighting.
7. Remove `erodeForegroundAlpha` and the Edge Cleanup slider. Grep for remaining callers —
   `sprite-remover.js` may pass `cleanupRadius`; `background-removal.js`'s `dilateMask`
   was a different thing and belongs to the sheet path's `regionAllows` logic, so check
   before deleting.
8. Add UI: Edge Detail, Edge Bias; `r` under advanced.
9. Harness: `bandSAD` vs ground truth must fall on clips 1, 2.

## Todo list

- [ ] Integral-image box filter + unit test
- [ ] Benchmark gate passed; measured ms and unknown-band coverage recorded here
- [ ] Guided filter + local-linearity unit test
- [ ] Unknown-band restriction verified
- [ ] `r` / `ε` defaults tuned on clips 1, 2
- [ ] Edge Bias with softness weighting
- [ ] `erodeForegroundAlpha` deleted; callers checked (incl. sheet path `dilateMask`)
- [ ] UI: Edge Detail, Edge Bias, advanced `r`
- [ ] Harness: ground-truth `bandSAD` down

## Success criteria

- [ ] **Clip 1:** 1–2 px hair/leaf detail retained at defaults, measured as `bandSAD`
      against the ground-truth matte rather than a pixel count.
- [ ] **Clip 2:** motion blur and semi-transparent regions keep graduated alpha rather than
      binarising.
- [ ] `bandSAD` vs ground truth improves on clips 1, 2.
- [ ] Definite-FG and definite-BG pixels bit-identical to phase 5 output.
- [ ] Edge Bias at 0 is a no-op; negative reproduces roughly what erosion did.
- [ ] Filter cost ≤ 40 % of per-frame keying time.

## Risk assessment

| Risk | L×I | Mitigation |
|---|---|---|
| Halos around high-contrast edges (large `r`, small `ε`) | High × Med | Constrain slider ranges after tuning; document the safe envelope in this file |
| Unknown band too narrow → filter has nothing to work with | Med × High | Let Edge Detail widen the band slightly as well as raise `ε` — but never past phase 5's 8 px cap, which phase 7's background estimate depends on |
| Removing erosion regresses users who relied on it | Med × Med | Edge Bias negative covers the use case; note the mapping in release notes |
| `dilateMask` in the sheet path deleted by mistake | Med × High | Step 7 explicitly separates the two; they serve different purposes |
| Float precision in integral images over large frames | Low × Med | `Float64Array` for the integral accumulator at 1080p; `Float32Array` is fine at 512 px |
| Guided filter blows the per-frame budget | Med × High | Step 4 benchmark gate before anything is built on top; Fast Guided Filter adopted immediately rather than deferred |

## Security considerations

None.

## Next steps

Phase 7 consumes the refined alpha to recover foreground colour.
