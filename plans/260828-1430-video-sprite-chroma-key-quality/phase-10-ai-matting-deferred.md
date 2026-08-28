---
phase: 10
title: "AI matting escape hatch (deferred)"
status: deferred
priority: P3
effort: "16h (if activated)"
dependencies: [8]
---

# Phase 10: AI matting escape hatch (deferred)

## Overview

**Deferred, deliberately.** Recorded here so the decision is documented rather than
rediscovered later.

AI matting solves a different problem from the one this plan addresses: footage shot
**without** a chroma screen. It does not improve chroma-screen footage, and it does not fix
fringe or spill — it produces a soft mask with no colour recovery, so phases 6–7 would
still be needed on top of it.

## Activation condition

Open this phase only if **all** of these become true:

1. A real, recurring source of non-chroma-screen footage exists in the asset pipeline.
2. Phases 1–8 have shipped and the chroma path is not the bottleneck.
3. Someone has confirmed the models work on **this project's actual subjects** — plants,
   fruit, fish, creatures, projectiles — not on the human portraits they were trained for.

Condition 3 is the one most likely to fail. RVM and MODNet are human-trained. U²-Net is
general-purpose but weaker at thin structures, which is precisely what Bloom Realms
sprites are full of.

## Options if activated

| Model | ONNX size | Subject | Note |
|---|---|---|---|
| MODNet | 40–50 MB | Portraits | Fast, wrong domain |
| U²-Netp | ~40 MB | General | Lightweight variant; the realistic candidate |
| U²-Net | ~168 MB | General | Heavy for a browser tool |
| RVM | ~15 MB | Humans + motion | Smallest, most domain-limited |
| BiRefNet | ~973 MB | High-res general | Not browser-viable |

Runtime: ONNX Runtime Web. WebGPU where available (roughly an order of magnitude over
WASM); WASM fallback.

**Model delivery is a supply-chain decision, not a detail.** A 40–170 MB binary pulled at
runtime and fed to an inference engine is the largest trust boundary this tool would ever
have. If this phase is ever activated: self-host the model rather than fetching from a
third-party CDN, pin a SHA-256 of the exact file, verify the hash after download and before
handing it to the runtime, and pin the ONNX Runtime Web version with subresource integrity.
A model swapped in transit runs arbitrary computation over every frame the user keys.

## Architecture sketch

AI would replace **only** phase 5's trimap generation, feeding the existing pipeline:

```
frame → U²-Netp → coarse mask → erode/dilate → trimap
      → phase 6 guided filter → phase 7 colour recovery → phase 8 export
```

This is the correct integration point. It reuses phases 6–8 rather than bypassing them,
which is why those phases are worth building first regardless.

## Why not now

- 40–170 MB download in an admin tool that currently ships zero dependencies.
- Unverified on non-human subjects — the project's entire subject matter.
- Produces alpha only; fringe and spill remain, so it is additive work, not a replacement.
- The chroma-screen pipeline being upgraded in phases 1–8 is lighter, more controllable,
  and better at preserving detail for the sources actually in use.

## Related code files

- Would create: `js/keyer/ai-matte.js`
- Would modify: `js/keyer/matte.js` — alternative trimap source
- Would add: ONNX Runtime Web dependency, model hosting

## Success criteria (if activated)

- [ ] Model runs in-browser under 500 ms per 512 px frame.
- [ ] Produces usable mattes on ≥ 3 real Bloom Realms non-chroma subjects.
- [ ] Falls back cleanly to the chroma path when confidence is low.
- [ ] Model download is lazy — never fetched unless the user selects AI mode.
- [ ] Model is self-hosted, SHA-256 pinned, and hash-verified before inference; ONNX
      Runtime Web loaded with subresource integrity.

## Risk assessment

| Risk | L×I | Mitigation |
|---|---|---|
| Poor quality on non-human subjects | High × High | Validate on real assets before any integration work |
| Bundle/download size | High × Med | Lazy load; never on the default path |
| Maintenance burden of a second matte source | Med × Med | Only integrate at the trimap boundary; share everything downstream |
| Compromised or substituted model binary | Low × High | Self-host, SHA-256 pin, verify before inference; SRI on the runtime |

## Next steps

None. Revisit only under the activation condition above.
