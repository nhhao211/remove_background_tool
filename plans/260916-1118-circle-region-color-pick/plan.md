---
title: "Vùng chọn tròn + Pick màu — xoá chi tiết cục bộ mà không đụng màu toàn nhân vật"
description: "Cho phép kéo một vùng tròn/elip trên Source Video, Preview và Clean Sprite Sheet, rồi pick màu cần xoá bên trong vùng đó. Màu chỉ bị xoá trong phạm vi vùng chọn, nên một màu trùng với màu nhân vật vẫn được giữ nguyên ở mọi nơi khác."
status: pending
priority: P1
effort: 24h
branch: feature/circle-region-color-pick
tags: [frontend, keyer, ux]
blockedBy: []
blocks: []
created: 2026-09-16
---

# Vùng chọn tròn + Pick màu (Circle Region Pick)

## Yêu cầu

Kéo một hình tròn để chọn vùng, sau đó pick màu cần remove **bên trong vùng đó**. Mục tiêu:
xoá được những chi tiết nhỏ trên nhân vật mà chroma key không xử lý được, **mà không làm
thay đổi màu sắc của nhân vật ở những chỗ khác**. Chức năng nằm ở **cả hai** tab
`Video → Sprite` và `Clean Sprite Sheet`.

## Nghiên cứu — vì sao pick màu hiện tại phá nhân vật (đã đo)

Hiện tại mọi màu pick đều có phạm vi **toàn ảnh**:

- Tab Clean Sprite Sheet: `processOptions()` (`sprite-remover.js:502`) gắn
  `matchMode: 'global'` cho mọi màu không phải `edge`/`lower`. Trong `applyConnectedMatte`
  (`keyer/matte.js:242-278`) nhánh `hasGlobalMatches` quét **toàn bộ** pixel của sheet.
- Tab Video → Sprite: `applyDirectMatte` / `keyBufferLinear` so màu từng pixel với toàn bộ
  `state.keyColors`, **không có khái niệm vùng nào cả** (`keyer/index.js` `VIDEO_OPTIONS`
  không có `keyRegions`).

Phạm vi duy nhất đang có là `cell-lower-half` và rect ratio trong `keyer/regions.js`
(`Pick Below Line`), chỉ dùng được ở tab Clean Sprite Sheet.

### Đo thật trên `test/keyer/fixtures/clip-08/sheet.png`

Sheet 512×512, 4 ô. Ô dưới-phải là **chủ thể xanh lá trên nền xanh lá** — đúng ca khó nhất:
vuông ngoài `#48a858` (72,168,88), vuông trong `#60be68` (96,190,104), key nền `#18c63e`
(24,198,62).

Kịch bản: người dùng muốn xoá **vuông trong 44×44 px = 1 936 px** (một chi tiết thừa trên
nhân vật). Chạy `runKeyer(connected)` đúng `settings.json` của fixture:

| Cấu hình | Xoá trong chi tiết | Chi tiết còn sót | Pixel bị ảnh hưởng **ngoài** chi tiết | …nằm ngoài vòng tròn | Phân bố theo ô (1/2/3/4) |
|---|---|---|---|---|---|
| **Pick global (hôm nay)** | 1 936 | 0 | **12 392** | — | 188 / 3 584 / 0 / 8 620 |
| Vòng tròn r=31px, tolerance 0.20 | 1 568 | 376 | **0** | 0 | 0 / 0 / 0 / 0 |
| Vòng tròn r=31px, tolerance 0.25 | 1 935 | 368 | **1 030** | **0** | 0 / 0 / 0 / 1 030 |
| Vòng tròn r=31px, tolerance 0.30 | 1 935 | 41 | **1 030** | **0** | 0 / 0 / 0 / 1 030 |
| Vòng tròn r=24px, tolerance 0.48 | 1 691 | 463 | **90** | **0** | 0 / 0 / 0 / 90 |

Đọc bảng:

1. **Pick global làm hỏng 12 392 px trên cả 3 ô khác** để xoá 1 936 px — đúng nguyên văn
   khiếu nại "ảnh hưởng đến màu sắc toàn bộ của nhân vật". Chủ thể sau key có 43 872 px
   ⇒ mất **28 %** chủ thể.
2. Vùng tròn hạ ảnh hưởng ngoài chi tiết xuống **1 030 px** (−92 %), và **100 % số đó nằm
   trong chính vòng tròn người dùng vẽ** — tức là nằm trong phạm vi người dùng đã chủ động
   đồng ý. Ngoài vòng tròn: **0 pixel, đảm bảo bởi thuật toán**, không phải bởi tolerance.
3. Tolerance vẫn là công cụ tinh chỉnh **bên trong** vùng: `keyDistance` giữa hai màu xanh
   là **0.0628**, còn ngưỡng theo tolerance là 0.0444 (0.20) → 0.0669 (0.30). Nên 0.20 tách
   được hai màu, 0.30 thì không. Người dùng có cả hai nút vặn: bán kính và tolerance.
4. Vùng tròn nhỏ hơn (r=24) hạ ảnh hưởng xuống 90 px nhưng để sót viền anti-alias của chi
   tiết (463 px) → cần `Softness` mép vùng + feather màu, không nên ép người dùng vẽ chính xác.

**Kết luận thiết kế:** vòng tròn là cơ chế an toàn *chính* (bảo đảm cứng), tolerance là cơ
chế *phụ*, và tuỳ chọn "chỉ vùng liền kề" (flood fill từ điểm click, chặn trong vòng tròn)
là cơ chế *thứ ba* cho trường hợp phải vẽ vòng tròn to.

## Quyết định kiến trúc

### Một module chung, chạy **sau** keyer — không đụng vào `public/js/keyer/`

| Quyết định | Lý do |
|---|---|
| Module mới `public/js/region-key.js`, **ngoài** `keyer/` | Giống hệt tiền lệ `erase-mask.js` và `edge-refine.js` (AGENTS.md): keyer có baseline byte-identical và `assertOptions()` chặn option lạ. Ngoài keyer ⇒ không phải regenerate `test/keyer/baseline/`, không mở whitelist. |
| **Không** mở rộng `keyer/regions.js` thêm `mode: 'ellipse'` | Đường đó chỉ chạy được ở nhánh `connected` (Clean Sprite Sheet). Tab Video → Sprite dùng `applyDirectMatte`/`keyBufferLinear`, hoàn toàn không có `keyRegions` — muốn dùng chung phải thêm option vào `VIDEO_OPTIONS`, tức sửa whitelist và chấp nhận rủi ro baseline. Một module hậu xử lý phục vụ **cả hai tab với đúng một đoạn code**. |
| Chạy sau keyer, cạnh `applyEraseMask` | Xoá chi tiết là **compositing**, không phải matting — như Bút Xóa. Hệ quả có lợi: vẫn hoạt động khi tắt `Transparent WebP/PNG`. |
| Toạ độ vùng chuẩn hoá 0..1 của **source** | Giống nét Bút Xóa: vùng bám nội dung khi đổi crop / cell size / rows / cols. Dùng lại đúng `geometry` mà `rasterizeStrokeMask` đang nhận. |
| Dùng lại `colorMetrics` / `keyDistance` / `smootherstep` / `suppressSpill` từ `keyer/` | Import thuần tuý, không đổi hành vi keyer. Công thức ngưỡng sao chép **y hệt** `applyConnectedMatte` nên slider `Tolerance` có cùng ý nghĩa với `Similarity` người dùng đã quen. |
| Gắn binding `frame` / `frameTime` như nét vẽ | Vùng vẽ trên một ô Preview chỉ áp cho ô đó; vùng vẽ trên Source Video áp cho mọi frame. Dùng lại nguyên `erase-frames.js`. |

### Pipeline mục tiêu

**Video → Sprite** (`app.js`) — chèn ngay **trước** erase, ở cả hai nhánh:

```
runKeyer → colorReplace → colorGrade
  → applyRegionKeys          ← MỚI
  → applyEraseMask
  → (detectSubjectBounds nếu bật alignment) → crossfade → sharpen
```

Đặt trước `detectSubjectBounds` vì lý do y hệt Bút Xóa: chi tiết đã xoá không được kéo lệch
canh chủ thể. Nhánh không-alignment vẫn xử lý sau vòng lặp, từ `state.rawFrames`, nên
`reapplyEraseMaskLive()` (đổi tên `reapplyLocalEditsLive()`) cho **live preview**: kéo slider
tolerance thấy kết quả ngay, không cần seek lại clip.

**Clean Sprite Sheet** (`sprite-remover.js`) — chèn **sau** Edge Refine:

```
state.original → runKeyer(connected) → state.keyed (cache)
  → applyEdgeRefine() → state.refined (cache MỚI)
  → applyRegionKeys() → state.result → hiển thị
  → export PNG: clone → applyAlphaBleed(3) → encodePNG
```

Sau Edge Refine, không phải trước: `refineEdges()` unmix dải viền dựa trên `state.lastKeyColors`.
Màu của một vùng tròn **không** nằm trong danh sách đó, nên nếu vùng chạy trước, refine sẽ
"khử nhiễm" mép lỗ mới bằng sai màu nền. Vùng tròn tự có `Softness` + feather riêng nên mép
của nó đã mềm sẵn. Cache `state.refined` để kéo slider của vùng chỉ chạy lại pass rẻ nhất.

## Mô hình dữ liệu

```js
{
  shape: 'ellipse',              // chừa chỗ cho 'rect' sau này
  cx, cy, rx, ry,                // 0..1 theo source (video hoặc sheet)
  colors: [{ r, g, b, hex }],    // nhiều màu trong cùng một vùng
  tolerance,                     // 0..1, cùng công thức với Similarity của keyer
  feather,                       // 0..1, độ mềm theo *màu*
  softness,                      // 0..1, độ mềm theo *mép vùng*
  despill,                       // 0..1, khử ám màu cho pixel còn lại
  connected,                     // true = flood fill từ seed, chặn trong vùng
  seed: { x, y } | null,         // 0..1, chỉ có nghĩa khi connected
  enabled,                       // tắt tạm để so sánh trước/sau
  frame, frameTime               // binding như nét vẽ; null = mọi frame
}
```

## Thiết kế UI (chung cho cả hai tab)

1. Nút **`Vùng tròn`** (icon `circle-dashed`) trong khối màu nền của mỗi tab.
2. Bật lên → kéo trên bề mặt: **điểm nhấn = tâm, kéo ra = bán kính**. Giữ `Shift` = tròn đều,
   thả `Shift` = elip. Vẽ từ tâm vì người dùng đang nhìn chính chi tiết cần xoá.
3. Thả chuột → eyedropper tự bật, **chỉ nhận pixel bên trong vùng** (loupe hiện nhãn `trong vùng`).
   Click → màu vào vùng đó → reprocess.
4. Vùng hiện thành chip trong danh sách swatch: `◯ #60be68 · r=31px`, có nút × để xoá, click để chọn lại.
5. Vùng đang chọn mở hàng slider riêng: `Tolerance`, `Softness`, `Despill`, checkbox
   `Chỉ vùng liền kề`, và (như Bút Xóa) `Chỉ frame này / Mọi frame`.
6. Overlay: vòng nét đứt; kéo vành để đổi bán kính, kéo trong ruột để dời, `Delete` xoá,
   `Esc` thoát tool. Hỗ trợ nhiều vùng cùng lúc.
7. Bề mặt vẽ được:
   - Video → Sprite: Source Video (overlay đặt bằng `getVideoRenderBox()`, y như `eraseBrushCanvas`)
     **và** khung Preview (ánh xạ ngược bằng `mapPreviewPointToSource()` có sẵn).
   - Clean Sprite Sheet: khung `Original` **và** khung `Transparent result` (hai canvas cùng
     kích thước và transform, tiền lệ Pick-trên-Result đã dựa vào đúng tính chất này).

## Phases

| Phase | Tên | Effort | Phụ thuộc |
|---|---|---|---|
| 1 | [Module `region-key.js` + test](./phase-01-region-key-module.md) | 7h | — |
| 2 | [`region-overlay.js` — lớp tương tác vẽ/sửa vùng dùng chung](./phase-02-region-overlay.md) | 5h | 1 |
| 3 | [Tích hợp vào Clean Sprite Sheet](./phase-03-cleaner-integration.md) | 4h | 1, 2 |
| 4 | [Tích hợp vào Video → Sprite](./phase-04-video-integration.md) | 6h | 1, 2 |
| 5 | [Tài liệu `AGENTS.md` / `README.md`](./phase-05-docs.md) | 1h | 1–4 |

**Thứ tự khuyến nghị: 1 → 2 → 3 → 4 → 5.** Làm Clean Sprite Sheet trước vì ảnh tĩnh: không
có chuyển động, không có seek, không có live-cache — nghĩa là kiểm chứng được thuật toán và
tương tác trước khi đụng vào vòng lặp Generate phức tạp hơn nhiều của tab video.

## Rủi ro

| Rủi ro | Giảm thiểu |
|---|---|
| **Nhân vật di chuyển, vòng tròn đứng yên** (tab video) | Đúng giới hạn Bút Xóa đang có và đã ship. Ba lối thoát: (a) phạm vi `Chỉ frame này`, vẽ vùng riêng cho từng ô ngay trên Preview; (b) vẽ vòng tròn rộng hơn và siết bằng tolerance; (c) *ngoài phạm vi v1* — neo tâm vùng theo `detectSubjectBounds` để vùng bám chủ thể. Banner phải nói rõ vùng thuộc phạm vi nào. |
| Vùng tròn ăn luôn màu giống nó nằm cạnh trong vùng (đo được: 1 030 px ở r=31) | Slider `Tolerance` (0.20 tách được hai màu cách nhau 0.0628) + checkbox `Chỉ vùng liền kề` + kéo nhỏ bán kính. Cả ba đều nằm trong tay người dùng và có phản hồi tức thì. |
| Người dùng tưởng vùng tròn "bảo vệ" phần bên ngoài | Nhãn và banner nói đúng nghĩa: vùng tròn là **phạm vi được phép xoá**, không phải mặt nạ bảo vệ. Ngoài vùng giữ nguyên **từng byte** — có test. |
| Vùng cũ trong localStorage không khớp geometry mới | `normalizeRegions()` clamp về 0..1 và bỏ vùng hỏng, giống `normalizeStrokes()`. Vùng sai hình → bỏ qua, không throw (degrade như mask lệch kích thước). |
| Hiệu năng khi có nhiều vùng trên sheet 50 MP | Mỗi vùng chỉ duyệt bounding box của chính nó, O(π·rx·ry). Gate benchmark ở phase 1. |
| Edge Refine hiểu sai mép lỗ mới | Vùng chạy **sau** refine; refine không bao giờ nhìn thấy lỗ đó. Ghi rõ trong AGENTS.md như một bất biến thứ tự. |
| Phình `app.js` (đang 6 548 dòng) | Toàn bộ toán và toàn bộ tương tác chuột nằm ở hai module mới; `app.js`/`sprite-remover.js` chỉ giữ phần nối dây và state. |

## Tiêu chí thành công

- [ ] `regions` rỗng ⇒ output **giống hệt từng byte** so với hiện tại, ở cả hai tab.
- [ ] Không pixel nào ngoài bounding box của vùng bị **đọc hoặc ghi** (test trực tiếp).
- [ ] Alpha không bao giờ tăng.
- [ ] Trên fixture clip-08: xoá ≥ 95 % chi tiết mục tiêu với **0** pixel bị đổi ngoài vòng tròn.
- [ ] `npm test` xanh; `test/keyer/baseline/` **không** phải regenerate.
- [ ] Vẽ/di chuyển/đổi kích thước vùng chạy được trên Source Video, Preview, `Original`, `Transparent result`.
- [ ] Vùng sống sót qua localStorage, qua đổi crop / rows / cols / cell size.
- [ ] Kéo slider tolerance cập nhật preview mà không cần seek lại clip (nhánh không-alignment).
- [ ] Vẫn hoạt động khi tắt `Transparent WebP/PNG`.
- [ ] Sheet 4096×4096 với 8 vùng: < 200 ms.

## Ngoài phạm vi

- Vùng đa giác / lasso tự do (dữ liệu đã chừa chỗ qua `shape`).
- Neo vùng theo chủ thể chuyển động (`detectSubjectBounds`) — ghi nhận là hướng phase sau.
- Đảo vùng ("chỉ giữ màu này, xoá phần còn lại trong vùng").
- Undo/redo cho danh sách vùng (v1 xoá bằng nút × như swatch màu hiện tại).
- Áp vùng lên `keyer/` như một `keyRegions` mode.
