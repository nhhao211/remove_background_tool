# Phase 3 — Tích hợp vào tab Clean Sprite Sheet

**Effort:** 4h · **Phụ thuộc:** Phase 1, 2

Làm tab này trước tab video: ảnh tĩnh, không seek, không chuyển động, không live-cache — kiểm
chứng được thuật toán và tương tác với ít biến số nhất.

## Pipeline sau thay đổi

```
state.original → runKeyer(connected) → state.keyed   (cache, như cũ)
  → applyEdgeRefine()                → state.refined (cache MỚI)
  → applyRegionKeys()                → state.result  → hiển thị
  → export PNG: clone → applyAlphaBleed(3) → encodePNG   (không đổi)
```

**Vùng chạy sau Edge Refine, không phải trước.** `refineEdges()` unmix dải viền dựa trên
`state.lastKeyColors`; màu của một vùng tròn không nằm trong danh sách đó, nên nếu vùng chạy
trước, refine sẽ khử nhiễm mép lỗ mới bằng sai màu nền. Vùng đã có `softness` + `feather`
riêng nên mép của nó mềm sẵn.

Tách `state.refined` khỏi `state.result` để kéo slider của vùng chỉ chạy lại pass rẻ nhất —
đúng lý do `state.keyed` được cache khi làm Edge Refine.

## State mới trong `sprite-remover.js`

```js
colorRegions: [],        // normalizeRegions() từ region-key.js
selectedRegionId: null,
regionMode: 'off',       // 'off' | 'draw' | 'pick' | 'edit'
refined: null,           // cache giữa Edge Refine và region pass
```

`resetResult()` và `loadSpriteSource()` phải xoá cả ba (và `state.refined`), giống cách chúng
đang xoá `manualColors` / `seedPoints`.

## DOM mới — `public/index.html`

Trong khối `cleaner-pick-actions` (cạnh `#btnSpritePickColor`, `#btnSpritePickLower`):

```html
<button id="btnSpriteRegionPick" class="eyedropper-trigger-btn cleaner-pick-button region" type="button" disabled>
  <i data-lucide="circle-dashed" style="width: 14px; height: 14px;"></i>
  <span>Vùng tròn + Pick</span>
</button>
```

Panel slider của vùng đang chọn (`#spriteRegionControls`, ẩn khi không có vùng nào được chọn):
`Tolerance` / `Softness` / `Despill` + checkbox `Chỉ vùng liền kề` — theo đúng khuôn
`slider-group` + `slider-number-input` đang dùng cho `#spriteSimilarity`.

Overlay trong **cả hai** stage:

```html
<canvas id="spriteRegionOverlayOriginal" class="cleaner-region-overlay"></canvas>   <!-- trong #spriteOriginalStage -->
<canvas id="spriteRegionOverlayResult"   class="cleaner-region-overlay"></canvas>   <!-- trong #spriteResultStage -->
```

Banner `#spriteRegionBanner` mô tả bước đang ở: `Kéo để vẽ vùng` → `Click chọn màu trong vùng`
→ `Kéo vành để đổi kích thước · Delete xoá vùng · Esc thoát`.

## Nối dây

- Hai overlay dùng chung `state.colorRegions`; `toSource` / `toCanvas` khác nhau ở chỗ lấy
  `originalCanvas` hay `resultCanvas` — hai canvas cùng kích thước và cùng transform, đúng
  tính chất mà Pick-trên-Result đã dựa vào.
- Ở chế độ `Anim` (`perCell` bật), `toSource` phải đi qua `displayPointToSheet()` đã có, để
  điểm trên một ô về đúng toạ độ sheet. `updateTransform()` gọi thêm `overlay.render()` cho
  cả hai.
- Pick màu trong vùng: dùng lại `updatePickerByPoint()` / loupe sẵn có, chỉ thêm nhãn phạm vi
  `◯ vùng` vào `#spritePickerScope` (đã có cơ chế nhãn `edge`). Màu **luôn lấy từ
  `state.original`**, y như quy tắc Pick-trên-Result — Result đã bị nhân alpha và khử màu.
- Từ chối pixel đã trong suốt trên Result kèm toast, giống hành vi hiện tại.
- Commit pick phải dùng `state.hoverPick` chứ không tính lại từ `clientX` của `click` — đúng
  cái bug đã ghi trong AGENTS.md: `click` làm tròn toạ độ nguyên còn `pointermove` có phần lẻ.

## Swatch

Vùng hiện trong `#spriteColorSwatches` như một chip riêng, nhãn `◯ #60be68 · r=31px`, tooltip
nói rõ phạm vi. Nút × xoá cả vùng (không chỉ màu). Click chip ⇒ chọn vùng và mở panel slider.

`renderColors()` đang dựng danh sách từ `allColors()`; thêm một vòng lặp thứ hai cho
`state.colorRegions` chứ **không** trộn vùng vào `state.manualColors` — vùng không được đi vào
`processOptions()` và không được thành `seedPoints`, nếu không nó lại loang toàn ảnh đúng như
vấn đề ban đầu.

## Phạm vi theo ô

Ở chế độ `Anim`, vùng vẽ trên một ô mặc định là **`Chỉ ô này`** (`frame` = chỉ số ô hiện tại).
Giữ `Shift` lúc `pointerdown` ⇒ `Mọi ô` (vùng áp cho cùng vị trí tương đối trong mọi ô) — đúng
quy ước `Shift` đảo phạm vi của Bút Xóa. Ở chế độ `Sheet`, vùng luôn là toạ độ sheet tuyệt đối.

Khi `frame` khác `null`, `applyRegionKeys` được gọi riêng cho từng ô với `geometry` của ô đó,
cùng cách `applyEdgeRefine()` đang lặp `frameRect(index)` khi `perCell` bật.

## Kiểm tra bằng tay

- [ ] Vẽ vùng trên `Original`, pick màu ⇒ chỉ trong vùng biến mất; phần còn lại của nhân vật giữ nguyên.
- [ ] Vẽ vùng trên `Transparent result` ⇒ cùng kết quả, cùng toạ độ.
- [ ] Kéo `Tolerance` ⇒ cập nhật trong < 100 ms (chỉ chạy lại region pass).
- [ ] Bật/tắt `Refine edges` không làm vùng nhảy chỗ.
- [ ] Zoom 800 % + pan ⇒ vòng nét đứt bám đúng pixel.
- [ ] `Anim` + `Sheet` ⇒ vùng hiển thị và ánh xạ đúng ở cả hai.
- [ ] Reset / load sheet mới ⇒ vùng bị xoá sạch, không rò sang ảnh mới.
- [ ] Export PNG và WebP ⇒ lỗ do vùng tạo ra có mặt trong file.
- [ ] Không có vùng nào ⇒ output giống hệt trước khi có feature (so bằng `cmp` trên PNG xuất ra).
