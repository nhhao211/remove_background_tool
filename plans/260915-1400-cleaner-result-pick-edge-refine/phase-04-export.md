---
phase: 4
title: "Export không mất màu viền"
status: pending
priority: P2
effort: "1.5h"
dependencies: [1]
---

# Phase 4: Export Clean Sprite Sheet

## Vấn đề

`downloadResult` (`sprite-remover.js:723-742`) vẽ `state.result` lên canvas rồi `toBlob`.
Backing store canvas premultiplied → RGB ở alpha thấp bị lượng tử hoá/xoá, đúng phần Edge
Refine vừa khử màu. Không có alpha bleed → engine scale sprite sẽ hút màu đen vào viền.

## Thay đổi

1. `import { applyAlphaBleed } from './alpha-bleed.js'` và
   `import { encodePNG, canEncodePNG } from './png-encoder.js'`.
2. PNG: `const out = cloneImageData(state.result); applyAlphaBleed(out, 3); blob = await encodePNG(out);`
   — cùng đường với `app.js:6387-6388`. `canEncodePNG()` false → fallback canvas như hiện tại.
3. WebP: giữ đường canvas nhưng dùng cùng chất lượng với tab Video → Sprite (commit `067ed85`
   đổi mặc định thành 90) thay cho hằng `0.96` riêng; đặt tên hằng dùng chung nếu app.js đã có.
4. Clone trước khi bleed — `state.result` đang hiển thị không được đổi.

## Test

Thêm vào `test/export-pipeline.test.mjs` (hoặc file mới): ImageData có pixel alpha 16 với
RGB đã khử màu → `applyAlphaBleed` + `encodePNG` → decode → RGB/alpha của pixel đó byte-exact.

## Tiêu chí xong

- [ ] PNG tải về mở lại trong tab Clean Sprite Sheet cho kết quả giống hệt preview.
- [ ] `npm test` xanh.
