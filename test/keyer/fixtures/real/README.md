# Real footage still needed

The committed corpus is synthetic. It covers every code path deterministically,
which is what the zero-diff phases need, but it cannot stand in for real capture
once defaults are being tuned — phase 3 onward.

Drop clips here as `clip-NN/frame-NNN.png` plus a `settings.json` matching the
shape in `../clip-01/settings.json`, then extend `CLIP_NAMES` in
`corpus-generator.mjs`.

| # | What to capture | Why it matters |
|---|---|---|
| 1 | Hair, fur or fine leaf detail against an evenly lit screen | 1–2 px structures are what erosion destroys and the guided filter has to keep |
| 2 | Fast motion producing genuine blur, plus a translucent prop (glass, smoke, thin fabric) | Graduated alpha must survive; today's keyer binarises it |
| 3 | Subject wearing a colour close to the screen hue | Where a per-key Euclidean `min()` eats the subject |
| 4 | **Unevenly lit screen with visible shadow falloff** | A single global threshold cannot serve both corners; drives the phase 5 background model |
| 5 | **One scene exported twice** — `ffmpeg -c:v libx264 -pix_fmt yuv420p` and `ffmpeg -c:v ffv1` | Isolates 4:2:0 chroma-subsampling damage from keyer error. Same source, two encodes, nothing else different |
| 6 | Blue screen as well as green | Confirms nothing is hardcoded to green |
| 7 | Subject with a genuine enclosed gap — a handle, a loop, a gap under an arm | Connectivity case; a hole that should stay keyed versus one that should not |
| 8 | A real exported sprite sheet | The sheet path, end to end |

Clips 4 and 5 are the two that cannot be approximated and are the reason this
list exists. Everything else has a usable synthetic stand-in.

## What is blocked right now, concretely

Clip 1 turned out to be the binding one, ahead of 4 and 5. Measured 2026-08-28:

The synthetic mattes are effectively binary. Per frame, the number of pixels with
`0.05 < α < 0.95` is **0, 5, 6, 8, 10 and 16** across the seven video clips, and
`generate-baseline.mjs` reports "0.0 % partial" for nearly every frame. Two clips
have literally no partial pixels at all.

`fringeContrast` and `bilinearHaloCheck` average over exactly that population, so
on this corpus they are averages of five to sixteen pixels. They are not stable
enough to tune against, and worse, they are not comparable between runs: a change
that resolves a genuinely soft edge grows the population and scores as a
regression. That is not hypothetical — it read the linear-light path as a 3×
fringe regression on clip-03 and 4× on clip-04, when the real cause was clip-04's
soft band growing from 10 pixels to 753.

The directional gate therefore skips both metrics below a 200-pixel band. Until a
clip arrives with real soft edges, **only `bandSAD` and `coreRGBDelta` gate
anything**, and phase 3 step 5's threshold re-tuning has no objective target.

Any clip with genuine anti-aliased or motion-blurred edges unblocks this — row 1
is the cheapest to shoot. It does not need to be the full list.

Prefer footage already shot for the `bloom-*-combat-assets` skills where it fits
the row, rather than shooting from scratch.

Keep clips short — 8 to 16 frames is plenty. The harness reads frames, not video,
so extract with:

```bash
ffmpeg -i source.mov -vf "select=lt(n\,16)" -vsync 0 frame-%03d.png
```
