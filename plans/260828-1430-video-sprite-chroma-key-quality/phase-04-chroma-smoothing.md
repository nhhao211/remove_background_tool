---
phase: 4
title: "Chroma smoothing for 4:2:0 sources"
status: pending
priority: P2
effort: "2h"
dependencies: [3]
---

# Phase 4: Chroma smoothing for 4:2:0 sources

## Overview

H.264 `yuv420p` stores one Cb/Cr sample per 2×2 luma block. After the browser upsamples to
RGB for `drawImage`, chroma edges are smeared across a 2 px block while luma stays sharp.
The keyer computes its decision almost entirely from chroma, so it inherits the smear as
stair-stepped, noisy alpha.

Cheap fix, large downstream leverage: blur **only** Cb/Cr before computing key distance,
keep Y at full resolution. Every later phase gets a cleaner input.

Not in the original 5-stage brief; added on research evidence.

## Key insights

- This must run **before** the background model (phase 5), because the model's covariance
  would otherwise fit the subsampling noise rather than the real screen variation.
- The guided filter in phase 6 uses **luma** as its guide. Luma is untouched here, so edge
  sharpness is restored downstream — the blur costs nothing in final detail.
- Clip 5 in the corpus (same shot, H.264 and lossless control) is the isolation test. If
  the smoothed H.264 result approaches the lossless control's result, the fix works.

## Requirements

Functional:
- Box blur radius 1–2 px applied to Cb/Cr channels only.
- Toggle in UI, default **on** for `.mp4` / `.webm` input, **off** for PNG sprite sheets.
- Radius exposed as an advanced setting, not a primary slider.

Non-functional:
- O(N) separable box blur, negligible against the rest of the pipeline.

## Architecture

Insert between linear conversion and background modelling:

```js
// keyer/color.js
function chromaSmooth(buf, radius) {
  // buf is linear RGB float. Convert to Y/Cb/Cr in place, blur Cb/Cr, convert back.
  const { y, cb, cr } = rgbToYCbCr(buf);          // BT.709, normalised axes (phase 5)
  boxBlurSeparable(cb, buf.width, buf.height, radius);
  boxBlurSeparable(cr, buf.width, buf.height, radius);
  return { y, cb, cr };                            // hand YCbCr straight to the model
}
```

Return YCbCr rather than converting back to RGB — phase 5 consumes YCbCr anyway, and the
original linear RGB is retained separately for colour recovery in phase 7. Keying operates
on the smoothed chroma; **colour output always comes from the unsmoothed RGB buffer.**
That separation is the whole point and must not be collapsed.

Separable box blur, two passes, sliding-window accumulator: 2 adds + 1 subtract per pixel
per axis.

## Related code files

- Modify: `js/keyer/color.js` — `chromaSmooth`, `boxBlurSeparable`, `rgbToYCbCr`
- Modify: `js/keyer/index.js` — call site, plumb `chromaSmoothRadius` option
- Modify: `index.html` — advanced settings: "Chroma Smoothing" toggle + radius
- Modify: `js/app.js` — default on for video input, off for image input

## Implementation steps

1. Implement `boxBlurSeparable(channel, w, h, r)` with a sliding accumulator; unit-test
   against a naive implementation.
2. Implement `rgbToYCbCr` / `yCbCrToRgb` with normalised axes (Cb × 0.564, Cr × 0.713) —
   see phase 5, which depends on the normalisation.
3. Wire `chromaSmooth` into `keyer/index.js` ahead of classification. Ensure the RGB buffer
   used for output is the **unsmoothed** one.
4. Add UI toggle + radius, default radius 1, on for video sources.
5. Harness clip 5: compare smoothed-H.264 vs lossless control.

## Todo list

- [ ] `boxBlurSeparable` + unit test
- [ ] `rgbToYCbCr` with normalised chroma axes
- [ ] Wired ahead of classification, unsmoothed RGB preserved for output
- [ ] UI toggle + radius, correct defaults per source type
- [ ] Clip 5 comparison recorded

## Success criteria

- [ ] On clip 5, `alphaSAD` between smoothed-H.264 output and lossless-control output drops
      by a measurable margin versus unsmoothed.
- [ ] `coreRGBDelta` unchanged — proves output colour still comes from unsmoothed RGB.
- [ ] Added cost under 5 % of total export time.
- [ ] Toggling off reproduces phase 3 behaviour exactly.

## Risk assessment

| Risk | L×I | Mitigation |
|---|---|---|
| Smoothed chroma leaks into output colour | Med × High | Explicit success criterion on `coreRGBDelta`; keep two buffers, never write back |
| Blur softens genuinely fine chroma detail (thin coloured strands) | Med × Med | Radius 1 default, expose control, guided filter restores edges from luma |
| Wrong default on PNG sprite sheet input (no subsampling) | Med × Low | Default off for image sources; step 4 |

## Security considerations

None.

## Next steps

Phase 5 consumes the YCbCr output of this phase directly.
