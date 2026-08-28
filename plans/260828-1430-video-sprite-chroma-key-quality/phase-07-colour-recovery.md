---
phase: 7
title: "Foreground colour recovery and edge-only despill"
status: pending
priority: P1
effort: "12h"
dependencies: [6]
---

# Phase 7: Foreground colour recovery and edge-only despill

## Overview

Fixes the two remaining colour symptoms.

- **Grey/dark fringe:** the code only subtracts spill; it never solves `C = αF + (1−α)B`
  for `F`. Edge pixels keep a background-darkened RGB.
- **Subject colour eaten:** `suppressSpill` runs on every pixel with `matte > 0`
  (`chroma-key.js:145`), not only the edge band.

Also splits Subject Protection into two independent controls, because the current
`colorRetention` line (`chroma-key.js:148`) fuses matte protection and colour protection
into one slider.

## Key insights

- The despill *algorithm* is fine — projecting the pixel's chroma onto the key's chroma
  direction is hue-agnostic and beats the common `g = min(g, (r+b)/2)` clamp, which is
  green-only and shifts neutrals. **Only the gating changes.**
- Order matters: despill **after** linear conversion, **before** unpremultiply.
- **Never touch RGB where α = 1.** This is the single most important guardrail for
  protecting the subject's own colours, and it is directly measurable as `coreRGBDelta`.
- Below `α_min ≈ 0.05` the division explodes. Take `F` from the nearest pixel with
  `α > 0.5` instead.
- This is a local-neighbourhood reduction of Nuke's IBK: instead of a separately shot clean
  plate, estimate `B̂` from nearby definite-background pixels.

## Requirements

Functional:
- Local background estimate `B̂` per unknown-band pixel.
- Unpremultiply `F = (C − (1−α)·B̂) / α` for `α > α_min`; nearest-opaque fallback below.
- Despill gated by `(1−α)²` and by background-model confidence.
- Subject Protection split into **Matte Protection** and **Colour Protection**.
- Presets: Clean Screen, Fine Detail, Motion Blur.

Non-functional:
- Colour recovery is O(r²) per unknown-band pixel; band is a few percent of the frame.
  Budget ≤ 5 ms per 512 px cell.

## Architecture

**Local background estimate.** Distance-weighted mean over definite-BG neighbours:

```js
function estimateLocalBackground(buf, trimap, x, y, radius) {
  let sr = 0, sg = 0, sb = 0, wsum = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const j = idx(x + dx, y + dy);
      if (trimap[j] !== DEFINITE_BG) continue;
      const w = 1 / (1 + dx * dx + dy * dy);
      sr += buf.r[j] * w; sg += buf.g[j] * w; sb += buf.b[j] * w; wsum += w;
    }
  }
  return wsum > 0 ? [sr / wsum, sg / wsum, sb / wsum] : clusterMean();  // fall back to μ_k
}
```

Radius 8, matching the unknown-band cap phase 5 enforces. Because no unknown pixel is more
than 8 px from a definite-BG pixel, the search is guaranteed to find at least one and the
cluster-mean fallback becomes a genuine edge case rather than the normal path for wide soft
edges. Diagonal neighbours count; the weight `1/(1+dx²+dy²)` already handles the distance.

If the fallback does fire, clamp the resulting `F` to [0,1] and count the occurrence — the
harness fails the phase if it fires on more than a negligible fraction of band pixels,
which would mean phase 5's band cap is not holding.

**Despill, re-gated.**

```js
const despillWeight = spillStrength
                    * (1 - alpha) * (1 - alpha)      // edge-only ramp
                    * backgroundConfidence           // from Mahalanobis distance
                    * (1 - colourProtection[i]);     // painted mask
if (alpha < 1) suppressSpill(buf, i, key, despillWeight);
```

`backgroundConfidence` prevents desaturating a genuinely green subject. Replaces the
`matte > 0` gate and the fused `colorRetention` term entirely.

**Unpremultiply.**

```js
if (alpha > ALPHA_MIN) {
  F = (C - (1 - alpha) * Bhat) / alpha;
} else {
  F = nearestOpaqueColour(x, y);   // BFS from α > 0.5, precomputed per frame
}
```

Clamp `F` to [0,1] after division. Note the output stays **unpremultiplied** RGBA, matching
what `putImageData` expects.

**Protection split.** `protection-mask.js` already rasterises strokes; add a second mask
layer rather than a second brush system.

| Control | Effect |
|---|---|
| Matte Protection | Excludes region from keying — alpha forced toward source |
| Colour Protection | Excludes region from despill and recovery — RGB left alone |

The existing `subjectEvidence` guard (`chroma-key.js:139-142`), which stops a broad brush
stroke dragging solid background into the sprite, applies to Matte Protection only.

## Related code files

- Modify: `js/keyer/spill.js` — `estimateLocalBackground`, `unpremultiply`,
  `nearestOpaqueColour`, re-gated `suppressSpill`
- Modify: `js/keyer/index.js` — ordering: despill → unpremultiply → linear→sRGB
- Modify: `js/protection-mask.js` — second mask layer
- Modify: `js/app.js` — two protection masks, preset application
- Modify: `index.html` — Colour Recovery, Despill, Matte/Colour Protection, presets

## Implementation steps

1. Precompute `nearestOpaqueColour` per frame via BFS from `α > 0.5`. O(N).
2. Implement `estimateLocalBackground` with cluster-mean fallback.
3. Implement unpremultiply with `α_min` guard and clamping.
4. Re-gate `suppressSpill`; delete the `colorRetention` line and the `matte > 0` gate.
5. Assert in the harness that RGB is untouched where `α == 1` — make it a hard test, not an
   eyeball check.
6. Split the protection mask into two layers; keep `subjectEvidence` on the matte layer.
7. Add Colour Recovery (`α_min`, radius) and Despill sliders; rename protection controls.
8. Define the three presets as slider tuples; tune each against its corpus clip
   (Clean Screen → clip 4, Fine Detail → clip 1, Motion Blur → clip 2).
9. Harness: `fringeContrast` must move toward 0 and `coreRGBDelta` must drop. Assert the
   `estimateLocalBackground` fallback counter stays near zero.

## Todo list

- [ ] `nearestOpaqueColour` BFS
- [ ] `estimateLocalBackground` + cluster-mean fallback
- [ ] Unpremultiply with `α_min` guard
- [ ] Despill re-gated by `(1−α)²` and confidence; `colorRetention` deleted
- [ ] Hard test: RGB untouched where `α == 1`
- [ ] Protection mask split into matte / colour layers
- [ ] UI: Colour Recovery, Despill, Matte Protection, Colour Protection
- [ ] Presets: Clean Screen, Fine Detail, Motion Blur
- [ ] Harness: fringe and core-RGB both improved; fallback counter near zero

## Success criteria

- [ ] `coreRGBDelta` ≈ 0 on every clip — subject core colour provably untouched. Hard gate.
- [ ] `fringeContrast` moves substantially toward 0 versus phase 6 on clips 1, 2, 3 —
      neither a dark rim (negative) nor a light one (positive).
- [ ] The phase-1 bilinear 4× halo check passes on every clip, using the same function
      phase 8 reuses. This is the measurable form of "no visible rim".
- [ ] **Clip 3** (subject colour ≈ key colour) keeps subject saturation; confidence gating
      demonstrably prevents desaturation.
- [ ] No NaN or clipped-white artefacts at very low alpha.
- [ ] Colour recovery ≤ 5 ms per 512 px cell.

## Risk assessment

| Risk | L×I | Mitigation |
|---|---|---|
| Division by small alpha produces fireflies / blown pixels | High × High | `α_min` guard + nearest-opaque fallback + clamp; explicit low-alpha corpus assertions |
| `B̂` wrong deep inside a thick unknown band | Med × Med | Phase 5's 8 px band cap makes this unreachable in normal operation; fallback is counted and gated, not assumed harmless |
| Confidence gating too aggressive → spill survives on real spill | Med × Med | Expose the gate as part of the Despill slider curve; tune on clips 1 and 3 together |
| Two protection masks confuse users | Med × Low | Default both to the same painted region; advanced users unlink |
| Presets encode values that later phases invalidate | Low × Med | Presets defined last, after all sliders exist; re-verify if phase 9 lands |
| Interaction with `preserveColors` option on the sheet path | Med × Med | Sheet path currently skips despill when `preserveColors`; map it to Colour Protection = 1 |

## Security considerations

None.

## Next steps

Phase 8 exports what this phase produces. Re-check phase 3's premultiply fix is holding —
this phase produces exactly the low-alpha pixels that fix protects.
