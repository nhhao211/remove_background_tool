---
phase: 3
title: "Pick Color trên khung Transparent result + phạm vi edge"
status: pending
priority: P1
effort: "5h"
dependencies: []
---

# Phase 3: Pick trên Result

## Hành vi mong muốn

- Khi Pick đang bật, **cả hai** stage (`Original` và `Transparent result`) đều nhận hover,
  loupe, click, phím mũi tên và Enter.
- Pick trên **Result** mặc định phạm vi **`edge`**: màu chỉ bị xoá ở pixel nằm trong
  `edgeReach` px (mặc định 2) tính từ vùng nền đã xoá. Giữ `Shift` khi click → `global`
  (giống cách Bút Xóa dùng `Shift` đảo phạm vi, `AGENTS.md` mục 6b).
- Pick trên **Original** giữ nguyên hành vi hiện tại (`full` / `lower`).
- Màu luôn lấy từ **`state.original`** tại cùng toạ độ sheet, không phải từ pixel Result —
  keyer so khớp trên original, còn pixel Result có thể đã bị khử màu.
- Pixel Result đã `alpha < 10` → từ chối, toast "Pixel này đã trong suốt trên Result".
- Loupe hiển thị ảnh phóng to của canvas đang trỏ, hex là màu original; thêm nhãn
  `edge` / `global`.
- Swatch hiển thị hậu tố `⌇ edge`.

## Thay đổi keyer — `public/js/keyer/matte.js` (`applyConnectedMatte`)

`keyRegions` đã được whitelist; thêm giá trị `matchMode: 'edge'` và field `edgeReach`.

1. Tách `keyRecords` thành hai nhóm: `edgeRecords` (`region?.matchMode === 'edge'`) và phần còn lại.
2. `analyze()` của BFS chính và nhánh `hasGlobalMatches` (`:230-259`) **bỏ qua** `edgeRecords`.
   Đây là chốt an toàn: màu viền thường gần màu nhân vật, nếu lọt vào BFS chính nó sẽ loang
   xuyên nhân vật.
3. Sau vòng BFS chính (`:261-271`), nếu có `edgeRecords`: BFS phụ nhiều nguồn từ mọi pixel
   `mask == 1` có láng giềng `mask == 0`, lan sang pixel `mask == 0` khớp một edge key trong
   `traversalThreshold` và `regionAllows`, dừng ở độ sâu `edgeReach` (clamp 1–4). Ghi
   `distanceMap`/`keyIndexMap` như nhánh global để vòng alpha `:275-299` xử lý như cũ.
4. Không đổi gì khi không có edge key → `test/keyer/keyer.test.mjs` và baseline giữ nguyên.

Test mới trong `test/keyer/edge-match.test.mjs`:
- Nhân vật có mảng màu X ở lõi và dải viền màu X sát nền: key X `edge` xoá dải viền,
  **giữ nguyên** mảng lõi. Cùng key X `global` thì xoá cả hai (đối chứng).
- Edge key không tạo đường loang qua một eo hẹp màu X dài > `edgeReach`.
- Không có edge key → output byte-identical với lần chạy không có `keyRegions`.

## Thay đổi UI — `public/js/sprite-remover.js`

1. `state.pickSurface = 'original' | 'result'`.
2. Tổng quát hoá theo canvas:
   `canvasCoordinates(event, canvas)`, `updatePickerByPoint(point, surface)`,
   `movePickerPoint` dùng `state.pickSurface`. Hai canvas có cùng kích thước và transform
   (`updateTransform` `:542-548`) nên `displayPointToSheet` dùng chung được.
3. Handler `pointermove` / `pointerleave` / `click` gắn cho **cả** `resultStage`; đặt
   `state.pickSurface` theo stage đang hover. Loupe (`position: fixed`) dùng chung.
4. Gộp logic click (`:990-1012`) và `confirmPickerSelection` (`:646-668`) vào một hàm
   `commitPick(point, { surface, shiftKey })` để khỏi lặp code lần ba.
5. Surface `result`: scope = `shiftKey ? 'full' : 'edge'`; bỏ kiểm tra `lower` split; kiểm tra
   `state.result.data[offset+3] < 10`.
6. `addManualColor(color, { point, scope })`: với `scope === 'edge'` **không** push
   `seedPoints` (seed là hạt giống nền, sẽ loang), và không tắt auto-detect.
7. `processOptions` (`:461-486`): `scope === 'edge'` → `{ hex, matchMode: 'edge', edgeReach: 2 }`.
8. `pickBannerText`: "Pick trên Result · chỉ xoá ở viền · Shift+Click = mọi nơi · Esc thoát".
9. `resultStage` thêm class `is-picking` khi active (CSS `crosshair` có sẵn ở `style.css:584`).
   `pointerdown` pan đã bị chặn khi `state.isPicking` (`:968`), không cần sửa.
10. Nếu `state.pickScope === 'lower'` đang bật: chỉ Original nhận pick (giữ đường chia),
    Result bỏ qua.

## `public/index.html`

- Subtitle card Result: `Pick viền còn sót ở đây · wheel to zoom · drag to pan`.
- Có thể thêm nút `btnSpritePickResult` "Pick on Result / Edge" trong `.cleaner-pick-actions`
  để người dùng khám phá được; nó gọi `activatePicker('edge')` và làm nổi Result stage.
- Thêm `#spriteResultPickBanner` (copy `cleaner-pick-banner`) trong `#spriteResultStage`.

## Kiểm thử thủ công

- `Anim` và `Sheet`, zoom 25 %–800 %, pan rồi pick: toạ độ loupe `X/Y` khớp với cùng điểm bên Original.
- Pick một pixel viền xanh còn sót → vệt biến mất, màu tương tự ở lõi nhân vật không bị ăn.
- Shift+Click cùng pixel → hành vi global như pick bên Original.
- Phím mũi tên sau khi hover Result: di chuyển trên Result; Enter chọn.
- Xoá swatch `edge` bằng × → kết quả trở lại.

## Tiêu chí xong

- [ ] `npm test` xanh, baseline không đổi, test `edge-match` mới xanh.
