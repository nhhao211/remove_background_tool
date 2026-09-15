---
phase: 1
title: "Module edge-refine.js + test"
status: done
priority: P1
effort: "6h"
dependencies: []
---

# Phase 1: Module `public/js/edge-refine.js`

## Overview

Hàm thuần tuý, không DOM, chạy được trong Node:

```js
export function refineEdges(keyed, original, options) // mutates & returns keyed
// options: { keyColors, edgeWidth=1, smooth=0.35, decontaminate=true,
//            pixelArt=false, rect=null /* {x0,y0,width,height} */ }
// returns { imageData, stats: { band, unmixed, colorDiff, keptKeyer } }
```

`keyed` là output của `runKeyer`, `original` là `state.original` (màu chưa bị keyer đụng).

## Thuật toán (đã prototype, xem số liệu trong plan.md)

Với mỗi pixel `i` trong `rect`:

1. **Distance transform** (chessboard, BFS từ mọi pixel `alpha == 0`, giới hạn
   `edgeWidth + FG_RADIUS + 1`). Dải viền = `1 ≤ dist ≤ edgeWidth`.
2. **Nền cục bộ B̂**: trung bình có trọng số `1/(1+dx²+dy²)` màu *original* của các pixel
   `dist == 0` trong bán kính 3. Không có → màu key gần nhất (`keyDistance`).
3. **Foreground cục bộ F̂**: trung bình có trọng số màu original của pixel `dist > edgeWidth`
   trong bán kính `FG_RADIUS = 4`, bỏ những pixel có `keyDistance < 3 × traversalThreshold`
   (tính cùng công thức `matte.js:156-159` từ `similarity/feather/subjectProtection`).
4. **Alpha**
   - Có F̂ và `|F̂ − B̂| ≥ 40`: `α = clamp((C−B̂)·(F̂−B̂) / |F̂−B̂|²)`.
     Khử nhiễm: `F = B̂ + (C − B̂)/α` (khi `α > 0.02`).
   - Mọi pixel lõi gần đó đều bị loại vì giống key nhưng trung bình của chúng cách B̂ ≥ 40
     (nhân vật cùng tông nền, clip-03): dùng chính chúng làm F̂ rồi unmix như trên.
   - Không có F̂ (sợi mảnh, vùng mờ): **color-difference** theo trục chroma của B̂:
     `k = chroma(B̂)`, `p = chroma(C)·k / |k|²`, `α = clamp(1 − p)`.
     Khử nhiễm: `F = C − max(0, p)·k`. Bỏ qua nếu `|k| < 8` (nền trung tính).
   - Còn lại: giữ alpha keyer.
   - Luôn `α = min(α, α_keyer)`.
5. **Làm mịn** (khi `smooth > 0` và `!pixelArt`): tent 3×3 trên alpha, chỉ trong dải viền,
   `α' = min(α, (1−smooth)·α + smooth·blur(α))`.
6. **Pixel art**: bỏ bước 5, `α = α ≥ 0.5 ? 1 : 0`; RGB vẫn khử nhiễm.
7. `decontaminate === false` → chỉ ghi alpha.

Làm tròn và kẹp về 0..255 đúng một lần khi ghi ra `Uint8ClampedArray`.

## Các bước

1. Tạo `public/js/edge-refine.js` theo trên. Hằng số đặt tên (`FG_RADIUS`, `BG_RADIUS`,
   `MIN_FB_CONTRAST = 40`, `MIN_KEY_CHROMA = 8`) kèm comment lý do, giống phong cách `keyer/`.
2. Tái dùng `colorMetrics`, `keyDistance`, `normalizeColor` từ `keyer/color.js` (import, không copy).
3. Preallocate typed arrays theo `rect`; hàng đợi BFS dùng `Int32Array` như `matte.js:171`.
4. Tạo `test/edge-refine.test.mjs` (dùng `loadPNG` của `test/keyer/png.mjs`):
   - **Gate chất lượng trên clip-08** (ghép matte clip-01/07/02 vào đúng ô như prototype):
     viền alpha 255 ≤ 5 %, viền còn màu nền ≤ 1 %, `bandSAD` c1 ≤ 30, c7 ≤ 10, c2 ≤ 78.
     "Còn màu nền" chỉ đếm trên 3 ô có matte: màu thật của nhân vật clip-03 (72,168,88) đã nằm
     trong 3× traversal của key nên viền đúng ở ô đó vẫn bị tính là nhiễm (đã chốt với người dùng).
   - **Lõi bất biến**: mọi pixel `dist > edgeWidth` giống byte với input.
   - **Không tăng alpha** ở bất kỳ pixel nào.
   - **Nền trung tính** (key trắng, nhân vật đỏ khử răng cưa): không NaN, không tệ hơn keyer.
   - **Nhân vật cùng tông nền** (clip-03 cell): `bandSAD` không tăng.
   - **Pixel art**: mọi alpha ∈ {0, 255}.
   - **`rect`**: pixel ngoài rect không đổi (cho per-cell).
   - Ảnh 1×1, ảnh toàn trong suốt, ảnh toàn đục: không throw.
5. Benchmark (test bị skip mặc định, bật bằng env `EDGE_REFINE_BENCH=1`): sheet tổng hợp
   4096×4096 < 1.5 s. Nếu vượt: gộp vòng lấy mẫu F̂/B̂ bằng box-sum trên ảnh tích luỹ có mask.

## Tiêu chí xong

- [x] `node --test test/edge-refine.test.mjs` xanh; `npm test` xanh.
- [x] `test/keyer/baseline/` không đổi (`git status` sạch ở đó).
