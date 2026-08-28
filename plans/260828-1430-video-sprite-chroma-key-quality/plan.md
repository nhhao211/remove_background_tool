---
title: "Video → Sprite chroma key quality upgrade"
description: "Unify the two keyers into one linear-light pipeline with background modelling, trimap flood fill, guided-filter refinement, foreground colour recovery, and alpha-bled export."
status: pending
priority: P2
effort: 69h
branch: develop
tags: [refactor, frontend, tech-debt]
blockedBy: []
blocks: []
created: 2026-08-28
---

# Video → Sprite chroma key quality upgrade

## Overview

The tool at `website/public/tools/remove-background/` ships two disjoint keyers. The
weaker one drives the primary Video → Sprite path. This plan unifies them onto one
module, moves the pipeline to linear light, and lands the matte/colour/export upgrades
identified in the research report.

Research: [report.md](../260828-1420-research-video-sprite-chroma-key/report.md)

Target symptoms:
- Background-coloured regions inside the subject get destroyed → no connectivity test.
- Subject's own colours get eaten → despill runs globally, not edge-only.
- Grey/dark fringe on edges → no foreground colour recovery + sRGB-space compositing
  + premultiply round trip during sheet composition.
- Hair, leaves, motion blur lost → hard erosion is the only edge tool.

## Scope

**Decided 2026-08-28 (scope challenge):**
- Mode: **HOLD** — all 10 report steps stay in the plan. Phases 9–10 are optional/deferred.
- Primary workflow: **Video → Sprite**. Sprite Sheet Remover must not regress but is not
  the tuning target.
- **Gutter/extrude is out of scope** — alpha bleed alone fixes the GPU-filtering halo, and
  gutter would force a lockstep change to Android sprite frame maths.

### Not in scope

| Item | Why |
|---|---|
| Gutter / extrude between cells | Changes cell geometry; needs Android-side migration |
| WebGL2 / WebGPU rewrite | Workload is 6.3 M px/sheet, ~2–4 s on CPU; no throughput need |
| Cloud/server-side processing | Tool is client-side by design |
| Petting tool paths | Different product; untouched |

## Phases

| Phase | Name | Status | Effort |
|-------|------|--------|--------|
| 1 | [Regression harness and test corpus](./phase-01-regression-harness.md) | Pending | 10h |
| 2 | [Shared keyer module](./phase-02-shared-keyer-module.md) | Pending | 8h |
| 3 | [Linear light and premultiply-safe composition](./phase-03-linear-light.md) | Pending | 10h |
| 4 | [Chroma smoothing for 4:2:0 sources](./phase-04-chroma-smoothing.md) | Pending | 2h |
| 5 | [Background model, trimap, connected components](./phase-05-background-model-trimap.md) | Pending | 12h |
| 6 | [Guided filter refinement and Edge Bias](./phase-06-guided-filter.md) | Pending | 10h |
| 7 | [Foreground colour recovery and edge-only despill](./phase-07-colour-recovery.md) | Pending | 12h |
| 8 | [Export pipeline: alpha bleed and format](./phase-08-export-pipeline.md) | Pending | 5h |
| 9 | [Temporal stability (optional)](./phase-09-temporal-stability.md) | Optional | 4h |
| 10 | [AI matting escape hatch (deferred)](./phase-10-ai-matting-deferred.md) | Deferred | — |

Core = phases 1–8 (69h). Phase 9 only if flicker survives per-frame quality work.
Phase 10 only if non-chroma footage becomes a real requirement.

## Sequencing rationale

**Phase 2 is the only phase that changes no pixels.** An earlier draft grouped phases 1–3
as "refactors with no intended visual change"; that was wrong about phase 3 and the error
mattered, because it implied a zero-diff gate that phase 3 cannot meet and hid the fact
that saved user settings need migrating. The corrected split:

| Phase | Changes output? | Compared against |
|---|---|---|
| 1 | Builds the harness | — (defines the baseline) |
| 2 | **No** — mechanical refactor | Phase 1 baseline, `alphaSAD == 0` |
| 3 | **Yes, by design** — linear light re-tunes every threshold | Directional gates + ground truth |
| 4–8 | Yes | Ground-truth mattes + directional metric gates |

From phase 3 onward the phase-1 baseline is no longer the target — it is only a record of
where the tool started. Quality is measured against hand-authored ground-truth mattes
(clips 1, 2, 7) and against directional gates: `coreRGBDelta` must fall, `fringeContrast`
must move toward zero, `bandSAD` must fall.

Ordering:

- Phase 1 is the only way to prove phase 2 did not regress the Sprite Sheet path.
- Phase 2 removes the duplication that would otherwise force every later fix to be
  written twice.
- Phase 3 must precede all threshold work — thresholds tuned in gamma space do not
  transfer to linear, so doing it later means re-tuning phases 4–7. This is also why its
  settings migration cannot be deferred: the numbers in a user's saved clip change meaning
  the moment this phase lands.

Phase 5 is the largest visible win and the first phase a user would notice.

## Data flow (target)

```
video frame (HTMLVideoElement)
  → drawImage to frame canvas
  → getImageData                          [8-bit sRGB, unpremultiplied — the ONLY decode hop]
  → sRGB→linear LUT                       [Float32Array RGB, phase 3]
  → chroma smooth Cb/Cr only              [phase 4]
  → background model: μ_k, Σ_k            [phase 5]
  → per-pixel Mahalanobis d → trimap      [phase 5]
  → BFS flood fill from border + seeds    [phase 5]
  → connected components cleanup          [phase 5]
  → guided filter on unknown band         [phase 6]
  → Edge Bias (signed alpha offset)       [phase 6]
  → local background estimate B̂           [phase 7]
  → despill, gated (1−α)²                 [phase 7]
  → unpremultiply F = (C − (1−α)B̂)/α      [phase 7]
  → linear→sRGB LUT                       [phase 3]
  → data.set() into sheet buffer          [phase 3 — NOT drawImage]
  → alpha bleed                           [phase 8]
  → putImageData → toBlob PNG             [phase 8]
```

## File ownership

No two phases in flight edit the same file. Sequential execution assumed.

| File | Phases |
|---|---|
| `js/keyer/*` (new) | 2 (create), 3, 4, 5, 6, 7 |
| `js/chroma-key.js` | 2 (delete/shim) |
| `js/background-removal.js` | 2 (absorb into keyer), 5 |
| `js/app.js` | 2, 3, 7, 8 |
| `js/sprite-remover.js` | 2 |
| `js/loop-optimizer.js` | 2 |
| `index.html` | 6, 7, 8 |
| `website/tests/remove-background/` (new) | 1 |
| `js/subject-alignment.js` | 3 |
| `js/sprite-reframe.js` | 8 |

## Dependencies

- No new **runtime** dependencies. The shipped pipeline stays plain ES modules + Canvas 2D.
- One new **dev** dependency: `@napi-rs/canvas`, for the phase 1 Node harness. Prefer it
  over `canvas`, which needs node-gyp and Cairo and will not install cleanly on a fresh
  macOS or Windows machine.
- Phase 1 needs a set of source clips. None exist in the repo today — `assets/bloom/` holds
  stills and audio only — so sourcing is real work and is budgeted inside phase 1's 10h.
- Persisted slider values live in `localStorage['video-editor:clip-states:v1']`
  (`app.js:449, 482-486, 964-968`). Phase 3 bumps the key and migrates.

## Rollback

Every phase is a standalone commit range on a feature branch off `develop`
(`feature/website-chroma-key-quality`). Rollback = revert that range; the harness from
phase 1 confirms what the revert restored.

**Revert in reverse order.** The earlier `legacyKeyer` flag idea is dropped — a fallback
frozen at phase 2 stops being meaningful once phase 3 changes the colour space, and keeping
it alive would recreate exactly the two-implementations-drifting problem this plan exists to
end. The cost of dropping it is that phases form a dependency chain rather than a set of
independent toggles: reverting phase 5 while 6 and 7 are applied leaves the guided filter
reading a trimap that no longer exists.

Practical consequence: land phases in order, and if something must be undone, unwind from
the newest applied phase. Two natural stopping points exist if the work is paused —
after phase 3 (fringe and precision fixed, matte unchanged) and after phase 8 (complete).

## Success criteria (plan level)

- [ ] One keyer module; `chroma-key.js` and `background-removal.js` no longer contain
      duplicate flood-fill or colour-distance code.
- [ ] Sprite Sheet Remover output byte-identical through phase 2, and from phase 3 on,
      changed only in ways that meet phase 5's accept gate — never silently.
- [ ] Mean RGB deviation inside `α = 1` regions is ~0 versus source — subject core colour
      provably untouched.
- [ ] Enclosed key-coloured regions inside a subject survive keying.
- [ ] `fringeContrast` near zero on every clip, and the bilinear 4× halo check passes over
      black and white after a full export round trip.
- [ ] 1–2 px detail (hair, leaves) retained at default settings, measured as `bandSAD`
      against ground truth.
- [ ] Export default is PNG.
- [ ] Saved clips from before the upgrade load and key equivalently after the `:v1` → `:v2`
      settings migration.
- [ ] Full 24-frame 512 px sheet export completes in under 10 s.
- [ ] No test fixture, baseline, or report is reachable under `website/public/`.

## Open questions

| Question | Blocks | Status |
|---|---|---|
| Are slider values persisted anywhere? | Phase 3 | **Resolved — yes.** `app.js:482-486` writes five chroma values to `localStorage['video-editor:clip-states:v1']` (`app.js:449`); `app.js:964-968` restores them. Phase 3 step 1 bumps the key to `:v2` and migrates |
| Does Chromium `toBlob(webp, 1.0)` actually produce lossless? | Phase 8 | Open. Empirical byte-exact round-trip assertion, phase 8 step 4. PNG is the default regardless |
| Does `subject-alignment.js` run before or after keying? | Phase 3 | Open. Determines whether its two canvas hops must move to buffer space. Phase 3 step 7 |
| Is the guided filter within budget at 512 px? | Phase 6 | Open. Benchmark gate at phase 6 step 4 decides plain vs Fast Guided Filter |

## Red team review

Four hostile reviewers (failure-mode, assumption, scope, security) produced 35 findings on
2026-08-28. 15 were accepted and applied to the phase files; 20 were rejected. Findings
without a `file:line` citation were auto-rejected, and three claims were re-verified against
the codebase directly before adjudication.

### Accepted — Critical

| Finding | Applied to |
|---|---|
| The plan counted one canvas premultiply hop; there are four (`app.js:3734, 3763, 3797, 3806`), plus two more in `subject-alignment.js:152-162`. Hop 2 is a *scaling* `drawImage`, which smears background colour into low-alpha pixels rather than merely quantising them | Phase 3 — full hop inventory, all four eliminated |
| Slider values are persisted (`app.js:482-486` → `localStorage['video-editor:clip-states:v1']`, restored at `964-968`). Linear light changes what those numbers mean, so every saved clip would silently re-key | Phase 3 — `:v1` → `:v2` key bump and migration, scaffolded before any maths change |
| "Phases 1–3 are refactors with no visual change" contradicted phase 3's own admission that it re-tunes thresholds, and phase 5's acceptance of a sheet-path diff. Four findings from two independent reviewers | `plan.md` sequencing table; phase 2 and 3 requirements; phase 5 accept gate |

### Accepted — High

| Finding | Applied to |
|---|---|
| The 7 call sites do not share a shape: two pass `protectionMask`, and four use bare `parseFloat` with no clamp or default, so an empty slider yields `NaN` and silently keys nothing | Phase 2 — `buildChromaOptions()`, shape table, `assertOptions` |
| `fringeScore` measured transparency rather than fringe; `detailRetention` was maximised by a uniformly half-transparent frame, rewarding the exact softening phase 6 must avoid | Phase 1 — replaced by `fringeContrast` and `bandSAD` |
| Corpus sourcing was unbudgeted and clip 8 (a sprite sheet, not a video) had no definition | Phase 1 — sourcing plan, clip 8 spec, 6h → 10h |
| Fixtures under `website/public/` would be served over HTTP without auth | Phase 1 — harness moved to `website/tests/` |
| `loop-optimizer.js:209` builds one options object and reuses it by reference across the frame loop | Phase 2 — per-frame construction, dev-mode freeze |
| The `legacyKeyer` rollback story breaks once phase 3 changes the colour space | `plan.md` — reverse-order revert replaces the flag |

### Accepted — Medium

`@napi-rs/canvas` missing from `package.json` (phase 1) · Mahalanobis `ε` and ellipse clamp
unspecified (phase 5 — named constants and tuning targets) · `estimateLocalBackground`
fallback unbounded (phase 5 — 8 px band cap; phase 7 — fallback counter gated) · BFS queue
allocation at 1080p (phase 5 — preallocated typed ring buffer) · linear→sRGB interpolation
unspecified (phase 3 — exact 8-bit round-trip test) · guided filter cost unverified
(phase 6 — benchmark gate before building on it).

### Notable rejections

| Claim | Why rejected |
|---|---|
| "8 `applyChromaKey` call sites, not 7" | Re-grepped: 8 lines, but one is the `import` on `app.js:6`. 7 call sites is correct |
| "The phase 1 baseline is circular" | Evidence cited `docs/bloom-economy-overview.md`, an unrelated file — auto-rejected under the evidence filter. The substance was also already handled: phases 5+ compare against ground truth, not the baseline |
| "Split into `runKeyerVideo` / `runKeyerSheet`" | This is the defect the plan exists to remove. Two entry points is how the codebase arrived at two keyers that drifted until the video path lost flood fill entirely. The real concern — a call site getting wrong defaults — is handled by `assertOptions` instead |
| Server-side path traversal and MIME-regex hardening | Real files cited, but in server code this plan does not touch, with `dir` server-generated. Out of scope; worth a separate ticket if anyone wants it |

One security finding was accepted in a reduced form: the client-side memory bound. Float
buffers are allocated from user-controlled dimensions (16 bytes/pixel), so an 8K frame is
~530 MB and wedges the tab. Phase 3 adds a dimension guard. The reviewer's server-side
upload-limit recommendations were rejected as pre-existing and out of scope.

## Next steps

Implement in Agent mode from this plan path, phase by phase, starting with
[Phase 1](./phase-01-regression-harness.md). Do not start phase 2 before the phase 1
harness produces a baseline.
