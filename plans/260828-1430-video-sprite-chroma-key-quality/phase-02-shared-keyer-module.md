---
phase: 2
title: "Shared keyer module"
status: pending
priority: P1
effort: "8h"
dependencies: [1]
---

# Phase 2: Shared keyer module

## Overview

Collapse `chroma-key.js` and `background-removal.js` into one module both consumers call.
No behaviour change intended. This is the refactor that stops every later fix from having
to be written twice, and it hands the video path the flood-fill and auto-detect code that
already exists on the sheet path.

## Key insights

- The two modules already share `clamp01`, `smootherstep`, `colorMetrics`, and
  `suppressSpill` as near-identical copies (`chroma-key.js:1-53` vs
  `background-removal.js:1-29`). Deduplication is mechanical. Note that
  `detectEdgeColors` (`background-removal.js:31-93`) is *not* duplicated — it exists only
  on the sheet path, which is precisely the capability the video path is missing.
- They differ meaningfully in only three places: connectivity (BFS vs none), background
  sampling (auto-detect vs user-picked only), and region/per-cell gating. All three become
  **options**, not separate modules.
- Threshold constants differ slightly between the two (`0.018 + 0.30·s^1.4` vs
  `0.015 + 0.28·s^1.4`; feather `0.002 + 0.12·b^1.55` vs `0.003 + 0.11·f^1.45`). These must
  stay per-path during this phase or the golden baseline breaks. Unify them in phase 5,
  deliberately, with the harness watching.

## Requirements

Functional:
- Single entry point covering both call patterns.
- Video path behaviour byte-identical to before, for valid slider input.
- Sheet path behaviour byte-identical to before.
- Runtime validation of the options object (see below).

**The `legacyKeyer` flag is dropped.** The earlier draft kept the old modules behind a flag
until phase 8, which does not survive contact with the sequence: phases 3–7 each change the
keyer's internals, so a "legacy" path frozen at phase 2 stops being a meaningful fallback
after phase 3 and becomes dead code carrying a maintenance cost and a divergence risk —
the same divergence this phase exists to end.

Rollback is by git revert of a phase's commits, which works because every phase is an
isolated commit range gated by the harness. That means the constraint is on *sequencing*,
not on flags: **phases must be reverted in reverse order**. Reverting phase 5 while 6 and 7
are still applied leaves the guided filter reading a trimap that no longer exists. This is
stated once in `plan.md` and is why phase ordering is a dependency chain rather than a
suggestion.

Non-functional:
- Module boundaries anticipate phases 3–7: colour space, background model, matte, refine,
  colour, all separable.

## Architecture

```
js/keyer/
├── index.js          runKeyer(imageData, options) — single entry point
├── color.js          clamp01, smootherstep, colorMetrics, distance   (phase 3 adds LUTs)
├── background.js     detectEdgeColors, cluster model                 (phase 5 adds Σ)
├── matte.js          threshold → trimap, BFS flood fill, components  (phase 5)
├── refine.js         erosion today; guided filter + Edge Bias        (phase 6)
├── spill.js          suppressSpill; colour recovery                  (phase 7)
└── regions.js        regionAllows, per-cell split/merge
```

`runKeyer` options, superset of both current signatures:

```js
runKeyer(imageData, {
  keyColors, keyRegions, seedPoints,        // sampling
  autoDetect,                               // background.js
  connected,                                // false = video today, true = sheet today
  perCell, rows, cols,                      // regions.js
  sheetWidth, sheetHeight, offsetX, offsetY,
  similarity, blend, spill, subjectProtection, cleanupRadius,
  protectionMask, protectedDecontamination,
  preserveColors,
  thresholdProfile: 'video' | 'sheet',      // TEMPORARY, removed in phase 5
})
// → { imageData, keyColors, removedPixels }
```

`connected: false` reproduces today's video path exactly. Phase 5 flips the default.

### Why one entry point and not two

A reasonable objection: this options bag carries sheet-only keys (`perCell`, `rows`,
`cols`, `keyRegions`, `sheetWidth`…) that the video path never sets, and splitting into
`runKeyerVideo` / `runKeyerSheet` would make each path's surface explicit.

Rejected, because that is the bug this plan exists to remove. Two entry points is how the
codebase arrived at two keyers that drifted apart until the video path lost flood-fill and
auto-detection entirely. Re-establishing the split at the API boundary re-establishes the
drift pressure. The legitimate concern underneath it — a call site silently getting the
wrong defaults — is handled by validation instead:

```js
// keyer/index.js — dev-mode guard, stripped in production
function assertOptions(o) {
  for (const k of Object.keys(o)) if (!KNOWN_OPTIONS.has(k)) throw new Error(`unknown keyer option: ${k}`);
  if (o.perCell && !o.connected) throw new Error('perCell requires connected');
  if (o.perCell && !(o.rows > 0 && o.cols > 0)) throw new Error('perCell requires rows/cols');
  for (const k of NUMERIC_OPTIONS) if (o[k] !== undefined && !Number.isFinite(o[k])) throw new Error(`${k} is not finite`);
}
```

Every option gets an explicit default in one place, so "forgot to pass `connected: false`"
is impossible — the default *is* the video behaviour, and the sheet path opts in.

### Call sites do not share a shape today

They are not seven copies of the same object, and migrating them mechanically will change
behaviour:

| Sites | `protectionMask` | Slider read |
|---|---|---|
| `app.js:3718`, `app.js:3773` | passed | `U.clampNumber(v, 0, 1, default)` (via shared locals) |
| `app.js:2241` | **absent** | `U.clampNumber(v, 0, 1, default)` |
| `app.js:4314`, `4336`, `4402`, `4476` | **absent** | `parseFloat(v)` / `parseInt(v, 10)` — **no clamp, no default** |

The last row is a latent bug independent of this plan: an empty or non-numeric slider value
yields `NaN`, which propagates through `keyDistance` and makes every comparison false, so
the seam-inspection and loop-preview paths silently key nothing. Fix it during the migration
by extracting a single reader:

```js
function buildChromaOptions(extra = {}) {
  return {
    enabled: chkTransparentFormat.checked,
    similarity:        U.clampNumber(sliderSimilarity.value, 0, 1, 0.55),
    blend:             U.clampNumber(sliderBlend.value, 0, 1, 0.18),
    spill:             U.clampNumber(sliderSpill.value, 0, 1, 0.55),
    subjectProtection: U.clampNumber(sliderSubjectProtection.value, 0, 1, 0.50),
    cleanupRadius: Math.round(U.clampNumber(sliderEdgeCleanup.value, 0, 3, 0)),
    keyColors: state.keyColors,
    ...extra,
  };
}
```

All seven sites then call `runKeyer(imgData, buildChromaOptions())`, with `3718`/`3773`
passing `{ protectionMask: … }` as `extra`. This is the one intentional behaviour change in
the phase, and it only fires on input that is currently broken — assert in the harness that
clips 1–7 are still zero-diff for valid slider values, and add a case with an empty slider
that fails before the change and passes after.

## Related code files

- Create: `website/public/tools/remove-background/js/keyer/{index,color,background,matte,refine,spill,regions}.js`
- Modify: `website/public/tools/remove-background/js/app.js` — 7 `applyChromaKey` call sites
  (`app.js:2241, 3718, 3773, 4314, 4336, 4402, 4476`)
- Modify: `website/public/tools/remove-background/js/loop-optimizer.js:279`
- Modify: `website/public/tools/remove-background/js/sprite-remover.js:507`
- Delete (end of phase): `js/chroma-key.js`, `js/background-removal.js`

## Implementation steps

1. Create `js/keyer/` and move the shared helpers into `color.js` verbatim. No maths
   changes. Run harness — expect zero diff.
2. Move `detectEdgeColors` into `background.js` verbatim. Harness.
3. Move `regionAllows` + `copyRegion` / `pasteRegion` / `processSpriteSheet` cell loop into
   `regions.js`. Harness.
4. Write `matte.js` with both classification paths behind `connected`. Port the BFS from
   `background-removal.js:226-288` unchanged.
5. Write `index.js` `runKeyer` dispatching on options. Keep `thresholdProfile` so the two
   constant sets survive.
6. Add `assertOptions` + the `KNOWN_OPTIONS` set and defaults table. Unit-test that an
   unknown key and a `NaN` numeric both throw.
7. Repoint `sprite-remover.js:507` → `runKeyer({connected:true, perCell, thresholdProfile:'sheet'})`.
   Harness clip 8 — **must be zero diff**.
8. Extract `buildChromaOptions()` in `app.js` and repoint all 7 call sites through it;
   verify each against `fixtures/call-sites.json` from phase 1. Harness clips 1–7 —
   **zero diff for valid slider values**, plus the new empty-slider case.
9. Repoint `loop-optimizer.js:279`. **Build the options object inside the frame loop, not
   above it** — `loop-optimizer.js:209` currently constructs one `chromaOptions` and reuses
   it by reference for every frame at lines 266–294. That is safe only while `runKeyer`
   treats options as read-only, which phases 5 and 9 will stop doing (the background model
   and the clip-wide cache both want to attach state to the options object). Either
   construct per frame, or pass the model explicitly as a second argument and freeze the
   options object with `Object.freeze` in dev mode.
10. Enumerate and verify every caller is migrated: `grep -rn "applyChromaKey\|processSpriteSheet\|removeConnectedBackground\|detectEdgeColors" js/`.
    Expect exactly 8 hits for `applyChromaKey` before migration — 7 call sites plus the
    `import` on `app.js:6`. Do not mistake the import for an eighth site.
11. Delete the two old modules once the grep is clean and harness is green.

Steps 1–4 are internal moves; commit each separately so a bad move is trivially bisectable.

## Todo list

- [ ] `keyer/color.js` extracted, harness green
- [ ] `keyer/background.js` extracted, harness green
- [ ] `keyer/regions.js` extracted, harness green
- [ ] `keyer/matte.js` with `connected` switch
- [ ] `keyer/index.js` `runKeyer` entry point
- [ ] `assertOptions` + defaults table; unknown-key and NaN cases throw
- [ ] `sprite-remover.js` migrated, clip 8 zero diff
- [ ] `buildChromaOptions()` extracted; 7 call sites verified against `call-sites.json`
- [ ] Empty-slider regression case added (fails before, passes after)
- [ ] `loop-optimizer.js` migrated with per-frame options construction
- [ ] Caller grep clean (8 hits = 7 sites + 1 import)
- [ ] Old modules deleted

## Success criteria

- [ ] Harness reports `alphaSAD == 0` on all 8 clips versus phase 1 baseline, for the
      corpus `settings.json` values. This is the last phase where zero-diff is achievable;
      see the sequencing note in `plan.md`.
- [ ] `grep -rn "applyChromaKey" js/` returns nothing.
- [ ] No duplicate implementation of `smootherstep`, `colorMetrics`, `suppressSpill`.
- [ ] `js/chroma-key.js` and `js/background-removal.js` deleted.
- [ ] Every `runKeyer` call site goes through `buildChromaOptions()` or an equivalent
      single reader — no raw `parseFloat(slider.value)` remains.
- [ ] `assertOptions` rejects an unknown key, and a `NaN` slider value throws rather than
      silently keying nothing.

## Risk assessment

| Risk | L×I | Mitigation |
|---|---|---|
| The 7 `app.js` call sites pass subtly different option objects | High × High | Shape table above; `call-sites.json` snapshot from phase 1; `buildChromaOptions()` collapses them to one reader |
| `loop-optimizer.js:209` reuses one `chromaOptions` by reference across the loop | Med × High | Construct per frame (step 9); `Object.freeze` in dev so a future phase attaching state fails loudly |
| The `parseFloat` fix changes behaviour, breaking the zero-diff promise | Med × Med | It only differs on input that is already broken (NaN); corpus uses valid values, so zero-diff holds and the new case documents the fix |
| `sprite-remover.js` relies on `removedPixels` for UI feedback | Med × Low | Keep the return shape identical |
| Silent behaviour drift from "harmless" cleanup during the move | High × High | Rule: this phase changes no arithmetic. Any constant change is deferred to phase 5 |
| Deleting the old modules removes the fallback | Med × Med | Rollback is reverse-order git revert, not a flag — see Requirements |

## Security considerations

None.

## Next steps

Phase 3 works entirely inside `keyer/color.js` and the `app.js` sheet composition.
