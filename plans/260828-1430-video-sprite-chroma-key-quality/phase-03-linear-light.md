---
phase: 3
title: "Linear light and premultiply-safe composition"
status: pending
priority: P1
effort: "10h"
dependencies: [2]
---

# Phase 3: Linear light and premultiply-safe composition

## Overview

Two independent causes of dark edges, fixed together because both are about colour
precision through the pipeline.

1. All keying maths runs in gamma-encoded sRGB (`chroma-key.js:9-22`, now
   `keyer/color.js`). Compositing `C = αF + (1−α)B` is only valid in linear light.
2. Keyed pixels pass through **four** canvas hops before reaching the sheet. Canvas 2D
   stores premultiplied; `getImageData` returns unpremultiplied. Every hop is
   `premultiply → 8-bit quantise → unpremultiply`, which destroys RGB precision exactly
   where alpha is low.

Phase 7 invests in recovering colour at low alpha. Without fixing (2), phase 7's work is
quantised away before it is ever exported.

### The full hop inventory

The earlier draft counted one hop (`app.js:3800-3806`). There are four on the guideline
path, and fixing only the last one leaves the damage already done upstream:

| # | Site | Operation | Fix |
|---|---|---|---|
| 1 | `app.js:3734` | `fullFrameCtx.putImageData(fullImgData, 0, 0)` — keyed result back to canvas | Keep the float buffer; do not write back |
| 2 | `app.js:3763` | `drawSubImageSafe(frameCtx, fullFrameCanvas, …)` — reads via `drawImage`, and **also rescales** (`cropW×cropH → cellW×cellH`) | Buffer-space crop + resample |
| 3 | `app.js:3797` | `singleCtx.drawImage(frameCanvas, 0, 0)` — copy for the animation preview | Preview only; may keep, but source it from the buffer |
| 4 | `app.js:3806` | `sheetCtx.drawImage(frameCanvas, destX, destY)` — sheet composition | `blitFrame` |

Hop 2 is the worst of the four: it is a *scaling* `drawImage`, so it interpolates
premultiplied values and then unpremultiplies, which smears background colour into
low-alpha pixels rather than merely quantising them. The non-guideline branch
(`app.js:3766-3789`) is cheaper — `drawImage` from the video, then `putImageData`, then
hops 3 and 4 — but still loses precision at 3 and 4.

Additionally `subject-alignment.js:152-162` (`alignFrameCanvas`) does
`tempCtx.drawImage(frameCanvas, 0, 0)` followed by `ctx.drawImage(tempCanvas, shiftX, 0)`
— two more hops, on already-keyed frames. Step 7 below settles whether it runs pre- or
post-keying; if post, it must move to buffer space or the whole phase is undermined.

The target is that keyed pixels live in one float buffer from `getImageData` on the decoded
video frame until a single `putImageData` on the finished sheet.

## Key insights

- 50 % white over black is linear 0.5 → sRGB ≈ 0.735. The same blend done in sRGB yields
  0.5 — visibly darker. That is the fringe mechanism.
- At α = 8/255 the premultiply round trip leaves ~3 bits of RGB. At α = 1/255 it leaves
  nothing.
- Both `Math.pow` directions can be table-driven. sRGB→linear input is 8-bit so a
  256-entry `Float32Array` is **exact**. Linear→sRGB needs ~4096 entries plus
  interpolation. Cost becomes negligible.
- Thresholds tuned in gamma space will not transfer. **This phase is therefore not a
  refactor.** It changes slider semantics and produces different pixels by design. Calling
  it one alongside phase 2 was the plan's own error; `plan.md` now groups phase 2 alone as
  the zero-diff phase and phase 3 as the first behavioural change. The consequence is
  concrete: saved user settings need migrating (step 1), and the phase-1 baseline stops
  being the comparison target from here on — phases 3+ compare against ground-truth mattes
  and the directional metric gates, not against "unchanged".

## Requirements

Functional:
- Keying, despill, and all future compositing operate on linear `Float32Array`.
- Sheet composition preserves per-pixel RGBA exactly, including at α → 0.
- Existing slider values map to visually equivalent results, or are migrated.

Non-functional:
- No more than ~1.5× slowdown versus phase 2 (LUTs, not `Math.pow` per pixel).
- Memory: one `Float32Array(w·h·3)` + `Float32Array(w·h)` alpha per frame, not per sheet.

## Architecture

```js
// keyer/color.js
const SRGB_TO_LINEAR = new Float32Array(256);   // exact, built once
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  SRGB_TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

const LINEAR_TO_SRGB_LUT = new Float32Array(4097);  // interpolate on lookup
```

**Linear→sRGB lookup, specified.** The output is 8-bit, so the LUT stores *already-encoded*
sRGB in 0..255 float and the caller rounds. Linear interpolation between neighbouring
entries is sufficient: the transfer function's worst curvature is near 0, and with 4096
intervals the maximum interpolation error there is well under 0.1/255 — an order of
magnitude inside the rounding step.

```js
for (let i = 0; i <= 4096; i++) {
  const x = i / 4096;
  const s = x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
  LINEAR_TO_SRGB_LUT[i] = s * 255;
}

function linearToSrgb8(x) {
  if (x <= 0) return 0;
  if (x >= 1) return 255;
  const f = x * 4096;
  const i = f | 0;
  const t = f - i;
  return (LINEAR_TO_SRGB_LUT[i] * (1 - t) + LINEAR_TO_SRGB_LUT[i + 1] * t + 0.5) | 0;
}
```

Values outside 0..1 clamp; phase 7's unpremultiply can produce them and must not index out
of bounds. The unit test asserts `linearToSrgb8(SRGB_TO_LINEAR[i] ) === i` for all 256 `i`
— an exact round trip, not merely a bounded error.

Frame buffer becomes a struct of arrays, not interleaved `Uint8ClampedArray`:

```js
{ r: Float32Array, g: Float32Array, b: Float32Array, a: Float32Array, width, height }
```

Alpha stays 0..1 linear (alpha is not gamma-encoded). Convert in at `getImageData`, out at
`putImageData`.

Sheet composition replaces `drawImage`:

```js
// app.js — write frame RGBA rows directly into the sheet's ImageData
function blitFrame(sheetData, frameData, destX, destY) {
  for (let y = 0; y < frameData.height; y++) {
    const srcStart  = y * frameData.width * 4;
    const destStart = ((destY + y) * sheetData.width + destX) * 4;
    sheetData.data.set(
      frameData.data.subarray(srcStart, srcStart + frameData.width * 4),
      destStart
    );
  }
}
```

Same pattern as the existing `pasteRegion` (`background-removal.js:330-335`) — proven code.

## Related code files

- Modify: `js/keyer/color.js` — LUTs, `toLinearBuffer` / `toSrgbImageData`
- Modify: `js/keyer/index.js` — operate on the float buffer
- Modify: `js/keyer/spill.js` — despill maths now in linear
- Modify: `js/app.js:3712-3763` — guideline branch, hops 1–2; buffer-space crop/resample
- Modify: `js/app.js:3766-3789` — standard branch, keep the buffer instead of `putImageData`
- Modify: `js/app.js:3792-3806` — hops 3–4; `blitFrame` for the sheet
- Modify: `js/app.js:3625-3631` — cell sizing unaffected, verify no canvas hop added
- Modify: `js/app.js:449` — `CLIP_STATE_KEY`, bump `:v1` → `:v2`
- Modify: `js/app.js:482-486` — persisted chroma slider values
- Modify: `js/app.js:964-968` — slider restore path; add migration
- Modify: `js/subject-alignment.js:152-162` — `alignFrameCanvas` double canvas hop
- Modify: `js/subject-alignment.js:219-223` — `drawSubImageSafe`, the scaling hop

## Implementation steps

1. **Settings migration — the open question is now answered, and the answer is yes.**
   Slider values *are* persisted: `app.js:482-486` writes `chromaSimilarity`, `chromaBlend`,
   `chromaSpill`, `chromaSubjectProtection`, `chromaEdgeCleanup` into
   `localStorage['video-editor:clip-states:v1']` (`app.js:449`), and `app.js:964-968`
   restores them on load. Re-tuning the threshold curves in step 5 changes what those
   numbers mean, so every saved clip would silently re-key differently.

   Fortunately the key is already versioned. Bump `CLIP_STATE_KEY` to
   `'video-editor:clip-states:v2'` and write a migration that reads any `:v1` entry, maps
   its five chroma values through the step-5 mapping, and writes the result to `:v2`.
   Leave the `:v1` entry in place — it costs nothing and lets a user roll back the tool
   without losing their setup.

   The mapping cannot be written until step 5 produces it, so this step is split: do the
   key bump and the migration *scaffold* first (so nothing loads `:v1` values into the new
   keyer), and fill in the numeric mapping at the end of step 5. Non-chroma fields
   (guideline, watermark, loop) copy across unchanged.

2. Build both LUTs in `keyer/color.js`; unit-test the exact 8-bit round trip.
3. Add `toLinearBuffer(imageData)` and `toSrgbImageData(buffer)`.
4. Convert `keyer/index.js` to the float buffer. Keep threshold constants numerically
   unchanged for now — the harness will show how much they must move.
5. Re-tune `transparentThreshold` / `featherWidth` curves so default slider positions give
   visually equivalent mattes to phase 2. **Record the exact old→new constant mapping in
   this file**, then implement it as the `:v1` → `:v2` migration from step 1.
6. Eliminate hops 1–4. Order matters: hop 4 (`blitFrame`) first since it is isolated, then
   hop 3, then the guideline branch's hops 1–2, which need a buffer-space crop-and-resample
   to replace the scaling `drawSubImageSafe`. Use box or bilinear resampling on
   *unpremultiplied* RGB weighted by alpha — the standard `Σ(α·C)/Σα` form — so low-alpha
   pixels do not pull background colour into their neighbours.
7. Determine whether `subject-alignment.js` runs before or after keying by reading the call
   order in `app.js`. If after, port `alignFrameCanvas` (`subject-alignment.js:152-162`) and
   `drawSubImageSafe` (`:219-223`) to operate on the float buffer. `detectSubjectBounds`
   (`subject-alignment.js:18-118`) reads alpha only and needs no colour-space change, but it
   currently takes `ImageData` — give it a buffer overload rather than converting back.
8. Add the canvas-size guard: refuse or warn above ~4096×4096 per frame before allocating
   float buffers (see Risk assessment).
9. Harness: expect `alphaSAD` small but non-zero; `fringeContrast` must move **toward 0**;
   `coreRGBDelta` must not worsen.

## Todo list

- [ ] `CLIP_STATE_KEY` bumped to `:v2`; migration scaffold in place before any maths change
- [ ] LUTs + exact 8-bit round-trip unit test
- [ ] `toLinearBuffer` / `toSrgbImageData`
- [ ] Keyer operates on float buffer
- [ ] Threshold curves re-tuned; **old→new mapping written into this file**
- [ ] `:v1` → `:v2` numeric migration implemented from that mapping
- [ ] Hop 4 eliminated (`blitFrame`)
- [ ] Hop 3 eliminated (preview copy sourced from buffer)
- [ ] Hops 1–2 eliminated; buffer-space alpha-weighted crop/resample replaces `drawSubImageSafe`
- [ ] `subject-alignment.js` pre/post-keying determined; ported if post
- [ ] Canvas-size guard before float allocation
- [ ] Harness: fringe improved, core RGB not worse

## Success criteria

- [ ] LUT round trip is **exact**: `linearToSrgb8(SRGB_TO_LINEAR[i]) === i` for all 256 `i`.
- [ ] `fringeContrast` moves toward 0 versus phase 2 baseline on clips 1, 2.
- [ ] `coreRGBDelta` does not increase on any clip.
- [ ] A frame with α = 1/255 pixels survives the **entire** path — key → align → cell →
      sheet — with RGB intact. Explicit unit test; this is the premultiply fix's proof and
      it must exercise the guideline branch, where the scaling hop was.
- [ ] Export time within 1.5× of phase 2.
- [ ] `grep -n "drawImage\|putImageData" js/app.js js/subject-alignment.js` shows no hop
      carrying keyed pixels between the initial decode and the final sheet write.
- [ ] Loading a `:v1` saved clip produces a visually equivalent matte to what it produced
      before this phase. Verify on at least two real saved clips, not synthetic values.

## Risk assessment

| Risk | L×I | Mitigation |
|---|---|---|
| Slider re-tuning is subjective, drifts quality | High × Med | Tune against clips 1–4 with the harness open; document the exact constant mapping in this file when done |
| Persisted user settings silently change meaning | **High × High** | Confirmed present at `app.js:482-486`. Key bump + migration, scaffolded in step 1 before any maths change |
| Migration mapping is wrong, so saved clips shift subtly | Med × High | Verify on real saved clips (success criteria), not synthetic values; `:v1` retained so rollback is possible |
| Buffer-space resample differs from canvas `drawImage` quality | Med × Med | Alpha-weighted `Σ(α·C)/Σα`; compare against the canvas result on an opaque frame where both must agree |
| Memory blowup on "Keep Source Size" 1080p | Med × Med | Float buffers are per-frame, released after blit; 1080p = ~33 MB transient. Step 8 adds a hard guard above ~4096×4096 (~200 MB/frame) rather than letting the tab die |
| `subject-alignment.js` reintroduces a canvas hop | Med × High | Step 7 audit; the low-alpha survival test above runs through alignment, so a reintroduced hop fails the gate |
| Performance regression from float maths | Low × Med | LUTs remove all `pow`; measure in step 9 |

## Security considerations

One, and it is availability rather than confidentiality. Float buffers are allocated from
user-controlled dimensions: "Keep Source Size" on a large input means
`Float32Array(w·h·3) + Float32Array(w·h)` = 16 bytes/pixel. At 1080p that is a harmless
33 MB, but an 8K frame is ~530 MB per frame and will either throw or hang the tab.

Add an explicit dimension check before allocation (step 8) with a clear message rather than
an out-of-memory crash. This is a local admin tool with no untrusted input, so the concern
is a user accidentally wedging their own browser, not an attacker — a guard and a warning
are proportionate. No server-side change is in scope.

## Next steps

Phase 4 is a small, isolated addition to the same buffer pipeline.
