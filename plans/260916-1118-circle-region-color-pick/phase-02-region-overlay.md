# Phase 2 — `public/js/region-overlay.js`: lớp tương tác vẽ/sửa vùng dùng chung

**Effort:** 5h · **Phụ thuộc:** Phase 1

## Vì sao tách module

`app.js` đã 6 548 dòng và `sprite-remover.js` 1 238 dòng. Vùng tròn cần vẽ được trên **bốn**
bề mặt: Source Video, khung Preview, khung `Original`, khung `Transparent result`. Nhân bốn
lần logic hit-test + kéo thả + vẽ vòng nét đứt là khoảng 250 dòng lặp lại ở hai file khác nhau
— đúng cái đã xảy ra với hai bản keyer trước khi gộp thành `keyer/`.

Module này giữ toàn bộ toán tương tác; hai file gọi chỉ cung cấp phép ánh xạ toạ độ của bề
mặt mình và nhận callback.

## API

```js
import { createRegionOverlay } from './region-overlay.js';

const overlay = createRegionOverlay({
  canvas,                        // <canvas> phủ lên bề mặt
  getRegions: () => state.colorRegions,
  getSelectedId: () => state.selectedRegionId,
  // Ánh xạ hai chiều giữa pixel trên canvas overlay và toạ độ source 0..1.
  // Đây là toàn bộ phần mỗi bề mặt phải tự khai báo.
  toSource: (px, py) => ({ x, y }) | null,
  toCanvas: (sx, sy) => ({ x, y }),
  scaleToCanvas: (rx, ry) => ({ rx, ry }),
  onCreate: (region) => {},      // vẽ xong một vùng mới
  onChange: (id, patch) => {},   // dời / đổi kích thước
  onSelect: (id) => {},
  onDelete: (id) => {},
  onPickRequest: (id, sourcePoint) => {}  // click trong vùng khi đang ở chế độ pick
});

overlay.setMode('draw' | 'edit' | 'off');
overlay.render();                // vẽ lại (gọi mỗi khi zoom/pan/transform đổi)
overlay.destroy();
```

## Hành vi

| Thao tác | Kết quả |
|---|---|
| `pointerdown` trên nền, mode `draw` | Bắt đầu vùng mới: điểm nhấn = tâm |
| Kéo | Bán kính = khoảng cách; giữ `Shift` ⇒ `rx === ry` (tròn đều) |
| `pointerup` | `onCreate`, chuyển mode `edit`, chọn vùng vừa tạo |
| `pointerdown` trong ruột vùng | Dời vùng (`onChange` với `cx`/`cy`) |
| `pointerdown` trên vành (±6 px) | Đổi kích thước (`onChange` với `rx`/`ry`) |
| `pointerdown` trong vùng, mode `pick` | `onPickRequest` — không dời, không resize |
| `Delete` / `Backspace` | `onDelete` vùng đang chọn |
| `Escape` | `setMode('off')` |

Con trỏ đổi theo vùng đang hover: `crosshair` (draw), `move` (ruột), `nwse-resize` (vành).

## Vẽ

- Vòng nét đứt 2 px, màu `#38bdf8` (đồng bộ với accent của cleaner sidebar), vùng đang chọn
  thêm vòng trong mờ và 4 chấm handle.
- `softness > 0` ⇒ vẽ thêm một vòng nét đứt mờ ở `t = 1 - softness` để thấy được dải mềm.
- Vùng có binding `frame` ⇒ vẽ mờ hơn (`globalAlpha = 0.4`) khi đang xem frame khác, **đúng
  quy ước overlay Bút Xóa trên Source Video** đã mô tả trong AGENTS.md.
- Tất cả vẽ bằng path, không `getImageData` ⇒ hover không tốn readback.

## Ràng buộc kỹ thuật

- Bắt `pointerdown/move/up/cancel` với `setPointerCapture` — kéo ra ngoài canvas vẫn theo.
- Chặn `contextmenu` trên overlay, và chặn pan chuột trái của viewport khi mode ≠ `off`
  (đúng cách `spriteViewport` guard `mousedown` cho Bút Xóa: `pointerdown` không chặn được
  `mousedown`).
- `toSource` trả `null` khi điểm nằm ngoài nội dung ⇒ bỏ qua thao tác, không tạo vùng lơ lửng.
- Overlay bám `getBoundingClientRect()` của canvas đích (đã gồm CSS transform), nên zoom/pan
  không cần code riêng — mỗi lần `applyTransform()` chỉ gọi `overlay.render()`.
- Không giữ tham chiếu tới `state`; mọi thứ đọc qua `getRegions()` để không phải đồng bộ hai bản.

## Test — `test/region-overlay.test.mjs`

Phần thuần tuý được tách thành hàm export riêng để test ngoài browser:

- `hitTestRegion(regions, point, tolerancePx)` ⇒ `{ id, part: 'body' | 'edge' | null }`.
- `dragToRegion(anchor, current, { shiftKey })` ⇒ `{ cx, cy, rx, ry }`, kiểm `Shift` ép tròn đều.
- `clampRegion(region)` ⇒ giữ vùng trong 0..1 và `rx, ry >= minRadius`.
- Vùng lồng nhau: hit-test trả vùng **nhỏ nhất** chứa điểm, không phải vùng đầu danh sách.

Phần DOM (`createRegionOverlay`) không test tự động — kiểm bằng tay theo checklist ở phase 3/4.

## Definition of done

- [ ] `public/js/region-overlay.js` export `createRegionOverlay` + 3 helper thuần tuý.
- [ ] `test/region-overlay.test.mjs` xanh.
- [ ] `node --check public/js/region-overlay.js`.
- [ ] Không import `app.js` / `sprite-remover.js` (một chiều: hai file kia import module này).
