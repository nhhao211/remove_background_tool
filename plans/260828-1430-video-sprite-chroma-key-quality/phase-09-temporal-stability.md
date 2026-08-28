---
phase: 9
title: "Temporal stability (optional)"
status: optional
priority: P3
effort: "4h"
dependencies: [8]
---

# Phase 9: Temporal stability (optional)

## Overview

**Do not start this phase until phases 1–8 are complete and a reviewer has looked at real
output and judged flicker still objectionable.** Per-frame quality work usually removes the
symptom that motivates this.

Two-step gate:

1. **Cheap fix first:** compute the background model once per clip instead of per frame.
2. **Optical flow only if step 1 is insufficient** — and it probably is not worth it.

## Key insights

- The dominant flicker source is a **per-frame re-estimated threshold**, not per-frame
  noise. `detectEdgeColors` currently re-clusters every frame, so μ and Σ jitter slightly
  frame to frame and the matte boundary breathes. Estimating the model once over the whole
  clip removes that with almost no code and zero ghosting risk.
- Optical-flow-warped alpha ghosts badly at occlusion boundaries and under fast motion —
  exactly what a game attack animation is made of (arXiv:2109.04843 reports artefacts near
  foreground boundaries specifically).
- Sprite sheets render one cell at a time with no temporal integration at playback.
  Flicker that would be obvious in video is far less visible in a 24-frame loop.
- The plan's original Stage 4 warning — "do not average alpha directly" — is correct and
  is why step 2 below is gated rather than assumed.

## Requirements

Functional:
- Pre-pass accumulating μ_k, Σ_k across all sampled frames of the clip.
- Model reused for every frame instead of per-frame re-detection.
- Optical flow: **not implemented unless the gate below is failed.**

Non-functional:
- Pre-pass adds one decode sweep; reuse the frames already extracted by
  `computeLoopTimestamps` rather than seeking twice.

## Architecture

**Step 1 — clip-wide background model.**

```
pass 1: for each sampled frame → accumulate border samples into shared clusters
        → finalise μ_k, Σ_k once
pass 2: for each frame → runKeyer(frame, { backgroundModel: sharedModel })
```

Phase 5's `background.js` already separates accumulation from evaluation, so this is
plumbing: hoist the accumulator out of the per-frame call and pass the finalised model in.

`loop-optimizer.js:279` already iterates frames for its own purposes — check whether its
sweep can be reused rather than adding a third pass.

**Step 2 — optical flow (gated).** Only if step 1 leaves visible flicker:

- Block-matching or Lucas–Kanade on luma, coarse (8–16 px blocks) is enough.
- Warp previous alpha, blend by **confidence**, never by fixed weight.
- Confidence = matching residual; low residual → trust the warp; high → discard it.
- Never blend alpha where the flow residual exceeds a threshold — that is where ghosting
  comes from.

## Related code files

- Modify: `js/keyer/background.js` — expose accumulate / finalise / inject separately
- Modify: `js/keyer/index.js` — accept a prebuilt `backgroundModel`
- Modify: `js/app.js:3701-3830` — add the model pre-pass to the export loop
- Check: `js/loop-optimizer.js:279` — reuse its existing frame sweep if possible
- Create (only if gated step 2 is reached): `js/keyer/temporal.js`

## Implementation steps

1. Measure `alphaVariance` across frames on clips 1, 2, 4 after phase 8. Record it.
2. Hoist background-model accumulation to a clip-level pre-pass; inject into each frame.
3. Re-measure `alphaVariance`. **Gate:** if the drop makes flicker acceptable on visual
   review, stop here and close the phase.
4. Only if the gate fails: implement coarse block-matching flow in `keyer/temporal.js`.
5. Confidence-weighted alpha warp; discard above the residual threshold.
6. Verify no ghosting on the fastest-motion clip specifically.

## Todo list

- [ ] Baseline `alphaVariance` measured and recorded
- [ ] Clip-wide background model pre-pass
- [ ] `alphaVariance` re-measured; gate decision recorded in this file
- [ ] (Gated) block-matching optical flow
- [ ] (Gated) confidence-weighted warp with residual cutoff
- [ ] (Gated) ghosting check on fast-motion clip

## Success criteria

- [ ] `alphaVariance` drops measurably from step 2 alone.
- [ ] Gate decision explicitly recorded — stopped at step 3, or justification for going on.
- [ ] No ghosting introduced on any clip; if any appears, the phase is reverted.
- [ ] Per-frame quality metrics from phases 5–7 do not regress.

## Risk assessment

| Risk | L×I | Mitigation |
|---|---|---|
| Optical flow ghosting on fast motion | High × High | Gate at step 3; confidence cutoff; revert if any ghosting appears |
| Clip-wide model is wrong when lighting changes mid-clip | Med × Med | Detect large per-frame deviation from the shared model and fall back to per-frame for that frame |
| Extra decode pass doubles export time | Med × Med | Reuse the existing frame sweep in `loop-optimizer.js` |
| Phase invalidates phase 7 presets | Low × Low | Re-verify presets if this phase lands |

## Security considerations

None.

## Next steps

If the gate at step 3 passes, close the plan. [Phase 10](./phase-10-ai-matting-deferred.md)
remains deferred.
