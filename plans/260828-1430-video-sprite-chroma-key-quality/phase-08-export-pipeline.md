---
phase: 8
title: "Export pipeline: alpha bleed and format"
status: pending
priority: P1
effort: "5h"
dependencies: [7]
---

# Phase 8: Export pipeline: alpha bleed and format

## Overview

The keyed sprite is correct in memory but degrades on export and at render time.

- **No alpha bleed.** GPU bilinear filtering samples RGB from fully transparent pixels.
  Those pixels carry near-black RGB, so scaling a sprite up produces a dark halo.
- **Lossy default.** `app.js:4814` calls `toBlob(mime, 0.95)` with WebP selected by default
  in the UI. Every sprite currently ships through lossy compression.

Gutter/extrude is explicitly **out of scope** (scope challenge, 2026-08-28) — it changes
cell geometry and would force a lockstep change to Android sprite frame maths.

## Key insights

- Alpha bleed writes RGB into transparent pixels while **keeping α at 0**. It changes
  nothing visually at α = 0 but everything under bilinear interpolation.
- This must run on the **assembled sheet**, after `blitFrame` from phase 3, so bleeding
  crosses nothing it should not — cells are adjacent, so bleed radius must stay below the
  gap between subjects, or be run per-cell before assembly. Per-cell is safer.
- WebP lossless via `toBlob` is an **assumption to verify, not a fact**. Chromium's encoder
  is reported to select lossless at `quality === 1.0`, but that is an implementation
  detail, not a specified guarantee, and Safari's WebP encode support is inconsistent.
  Ship PNG default regardless of the result.

## Requirements

Functional:
- Alpha bleed, 3–4 dilation passes, RGB only, α preserved at 0.
- PNG becomes the default export format.
- WebP offered only if the lossless assertion passes, labelled as such.
- Bleed radius exposed as an advanced setting.

Non-functional:
- Runs at export time only, not on every preview frame.
- ≤ 1 s added to a 24-frame 512 px sheet export.

## Architecture

Iterative dilation of RGB into transparent pixels, per cell, before assembly:

```js
function alphaBleed(buf, passes) {
  for (let p = 0; p < passes; p++) {
    const src = { r: buf.r.slice(), g: buf.g.slice(), b: buf.b.slice() };
    const filled = buf.a.map(a => a > 0 ? 1 : 0);   // from previous pass
    for each pixel i with filled[i] === 0:
      average src RGB over 8-neighbours where filled === 1
      if any neighbour: write buf.r/g/b[i], mark newly filled
      // alpha is NEVER written
  }
}
```

Track a separate `filled` mask so each pass expands the frontier by exactly one ring and
already-bled pixels act as sources for the next pass. Alpha is never touched — that
invariant is the whole point and deserves an explicit test.

A jump-flood variant gives exact nearest-opaque colour in O(N log N) if 3–4 rings prove
insufficient; not expected at 512 px.

## Related code files

- Create: `js/keyer/bleed.js` — `alphaBleed`
- Modify: `js/app.js:3800-3806` — bleed each cell before `blitFrame`
- Modify: `js/app.js:4788-4815` — `downloadSpriteSheet`, format handling
- Modify: `js/app.js:4875-4881` — the second export path (`toDataURL`) has the same 0.95
- Modify: `js/sprite-remover.js:729` — sheet path export
- Modify: `js/sprite-reframe.js:258` — third export path, check quality param
- Modify: `index.html` — format select default PNG; advanced bleed radius

## Implementation steps

1. Implement `alphaBleed` in `keyer/bleed.js`. Unit-test: alpha array bit-identical before
   and after; RGB changed only where α === 0.
2. Wire per-cell bleed ahead of `blitFrame`.
3. Change the format select default to PNG in `index.html`. Audit **all three** export call
   sites (`app.js:4814`, `app.js:4881`, `sprite-remover.js:729`) plus `sprite-reframe.js:258`
   — the 0.95 constant appears in more than one place.
4. **Resolve the open question.** Write a test that encodes a known sprite via
   `toBlob('image/webp', 1.0)`, decodes it back, and asserts byte-exact RGBA against the
   source. Run in the browsers the team actually uses.
5. If step 4 passes: offer "WebP (lossless)" as an option, labelled, non-default. If it
   fails: remove the WebP option or label it "WebP (lossy)" honestly.
6. Add advanced bleed-radius control.
7. Harness: run the phase-1 bilinear 4× halo check on the *exported* file, decoded back
   from PNG/WebP, so the assertion covers the encoder as well as the bleed.

## Todo list

- [ ] `alphaBleed` + alpha-invariant unit test
- [ ] Per-cell bleed before `blitFrame`
- [ ] PNG default; all 4 export call sites audited for the 0.95 constant
- [ ] WebP lossless round-trip assertion executed and recorded
- [ ] WebP option labelled honestly per the result
- [ ] Advanced bleed radius control
- [ ] Bilinear-scaling halo check run on the decoded exported file

## Success criteria

- [ ] Alpha channel bit-identical before and after bleed. Hard gate.
- [ ] Exported sprite passes the phase-1 halo check on black and white after a full
      encode/decode round trip.
- [ ] Default export is PNG; no lossy path is reachable without explicit user choice.
- [ ] WebP lossless claim resolved with recorded evidence either way.
- [ ] Export time increase ≤ 1 s for a 24-frame 512 px sheet.

## Risk assessment

| Risk | L×I | Mitigation |
|---|---|---|
| Bleed crosses between adjacent cells | Med × High | Bleed per-cell before assembly, not on the sheet |
| A fourth export path is missed and still ships 0.95 | Med × Med | Step 3 greps for `toBlob\|toDataURL` across `js/`; four known sites listed above |
| PNG default increases file size beyond what the pipeline tolerates | Med × Low | PNG is ~1.4× WebP lossless; sprite sheets are already committed as PNG elsewhere in the repo |
| Bleed radius too large softens the visible edge | Low × Med | Only α === 0 pixels are written; visible pixels cannot change by construction |
| `sprite-reframe.js` export has different semantics | Low × Med | Read it before changing; may not need bleed at all |

## Security considerations

None.

## Next steps

Core work (phases 1–8) complete. Evaluate whether flicker justifies
[Phase 9](./phase-09-temporal-stability.md); most likely it does not.
