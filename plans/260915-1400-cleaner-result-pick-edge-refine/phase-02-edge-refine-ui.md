---
phase: 2
title: "Tích hợp Edge Refine vào Clean Sprite Sheet"
status: pending
priority: P1
effort: "3h"
dependencies: [1]
---

# Phase 2: UI + pipeline Edge Refine

## Thay đổi

### `public/index.html` (sidebar `#spriteCleanerWorkspace`, sau khối slider hiện có)

Section mới `Edge Refine`, dùng lại class `cleaner-control-section`, `slider-group`,
`slider-number-input`:

| id | Loại | Mặc định | Ghi chú |
|---|---|---|---|
| `spriteEdgeRefine` | checkbox | bật | Tắt = hành vi y như hiện tại |
| `spriteEdgeWidth` / `numSpriteEdgeWidth` | range 1–3, step 1 | 1 | px |
| `spriteEdgeSmooth` / `numSpriteEdgeSmooth` | range 0–1, step 0.01 | 0.35 | Chống răng cưa |
| `spriteEdgeDecontaminate` | checkbox | bật | "Khử màu nền ở viền" |
| `spriteEdgePixelArt` | checkbox | tắt | Viền cứng, không bán trong suốt |

Tooltip của `Preserve original subject RGB` bổ sung: "Lõi nhân vật; viền do Edge Refine quyết định".

### `public/js/sprite-remover.js`

1. `import { refineEdges } from './edge-refine.js';`
2. Lấy element theo id; thêm vào mảng binding slider/number ở `:917-949`.
3. `state.keyed = null` (thêm vào `state`, reset trong `loadSpriteSource` và `resetResult`).
4. `runProcessing` (`:505-515`): sau `runKeyer` → `state.keyed = result.imageData`,
   rồi `state.result = applyEdgeRefine(state.keyed)`. Lưu `result.keyColors` vào
   `state.lastKeyColors` (cần cho refine khi auto-detect).
5. `applyEdgeRefine(keyed)`:
   - Checkbox tắt → trả `keyed` (không clone).
   - Clone `keyed`; nếu `perCell` bật → gọi `refineEdges` theo từng `frameRect(i)` với
     option `rect`; ngược lại gọi một lần cho cả sheet.
   - Truyền `similarity/feather/subjectProtection` để tính ngưỡng giống keyer.
6. Listener `input` (debounce ~80 ms) trên các control Edge Refine: nếu có `state.keyed`
   → chạy lại `applyEdgeRefine`, `renderPreview()`. **Không** gọi `runProcessing`.
7. `resultStatus`: nối thêm `· edge refined (N px)` từ `stats.band`.

### `public/css/style.css`

Chỉ cần nếu section mới lệch layout; ưu tiên dùng lại class sẵn có.

## Kiểm thử thủ công

- Load `clip-08/sheet.png`, Pick màu xanh → so sánh bật/tắt Edge Refine ở zoom 400 %,
  nền Checker và Dark BG.
- Kéo `Smooth` khi animation đang chạy: không giật, không chạy lại flood fill (quan sát
  progress bar không hiện).
- `Pixel art edges` bật: soi zoom 800 %, viền không có pixel bán trong suốt.
- Bật/tắt `Sprite grid / per-cell`: không có vệt ở ranh giới ô.
- Move sprite từ tab Video → Sprite sang: refine áp dụng bình thường.

## Tiêu chí xong

- [ ] Tắt Edge Refine → output byte-identical với trước phase này.
- [ ] `node --check public/js/sprite-remover.js`, `npm test` xanh.
