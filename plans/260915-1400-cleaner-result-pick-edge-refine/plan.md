---
title: "Clean Sprite Sheet — Pick màu trên khung Result và Edge Refine làm mịn viền"
description: "Cho phép Pick Color trực tiếp trên khung Transparent result (có phạm vi chỉ-ở-viền), và thêm bước Edge Refine (unmix màu + khử nhiễm màu nền + chống răng cưa) chạy sau keyer trên màn hình Clean Sprite Sheet."
status: pending
priority: P1
effort: 16h
branch: feature/cleaner-edge-refine
tags: [frontend, keyer, ux]
blockedBy: []
blocks: []
created: 2026-09-15
---

# Clean Sprite Sheet — Pick trên Result + Edge Refine

## Bối cảnh

Hai yêu cầu:

1. **Pick Color cần Remove ngay trên khung Preview** (card `Transparent result`,
   `#spriteResultStage`). Hiện chỉ pick được trên card `Original`
   (`sprite-remover.js:988-1012` chỉ gắn handler vào `originalStage`), nên người dùng
   thấy vệt màu nền còn sót trên Result nhưng phải dò lại vị trí đó bên Original.
2. **Viền nhân vật còn màu nền và bị vỡ nét** sau khi remove.

> Giả định: "khung Preview" = card **Transparent result** của tab Clean Sprite Sheet.

## Nghiên cứu — nguyên nhân gốc (đã đo)

Chạy keyer thật (`runKeyer`, `connected: true`) trên `test/keyer/fixtures/clip-08/sheet.png`
với đúng `settings.json`, đo trên dải viền (pixel alpha > 0 kề pixel alpha 0):

| Chỉ số | Kết quả hiện tại |
|---|---|
| Pixel viền có alpha = 255 | **96.7 %** → viền nhị phân, bậc thang → "vỡ nét" |
| Pixel viền alpha ≥ 200 mà màu vẫn gần màu key (< 3× traversal) | **34.0 %** → "còn màu nền" |
| Tổng pixel alpha bán phần trong cả sheet | 281 (ground truth có ~4 100) |
| `bandSAD` so với matte chuẩn (clip-01 / clip-07 / clip-02) | **108.9 / 107.9 / 77.9** (thang 0–255) |

Đọc code giải thích đúng các con số đó (`public/js/keyer/matte.js:134-302`):

1. **Mask flood-fill là nhị phân.** Pixel chỉ vào mask khi `distance ≤ traversalThreshold`.
   Pixel viền là *hỗn hợp* nền + nhân vật nên distance lớn hơn ngưỡng → không vào mask →
   giữ nguyên `alpha = 255` **và** giữ nguyên màu đã lẫn nền. Đó là cả halo lẫn răng cưa.
2. **`preserveColors` mặc định bật** (`index.html`, `sprite-remover.js:423`) → nhánh despill
   (`matte.js:294`) không bao giờ chạy trên Clean Sprite Sheet.
3. **`Edge Cleanup` là dilate vuông 8-láng giềng rồi set alpha = 0 cứng**
   (`matte.js:273-285`, `refine.js:52`) → gặm viền theo bậc, càng vỡ nét.
4. **Export đi qua canvas** (`sprite-remover.js:723-742`, `toBlob`): backing store
   premultiplied làm mất màu ở alpha thấp; WebP lossy 0.96 phá thêm viền. Tab Video → Sprite
   đã giải quyết bằng `applyAlphaBleed` + `encodePNG` (`app.js:6387-6388`) nhưng tab này chưa dùng.

## Prototype thuật toán (đã chạy, số liệu thật)

Bước hậu xử lý chỉ trên dải viền, chạy sau keyer, cùng fixture:

| Cấu hình | Viền alpha 255 | Viền còn màu nền | bandSAD c1 / c7 / c2 | Pixel lõi bị đổi |
|---|---|---|---|---|
| Hiện tại | 96.7 % | 34.0 % | 108.9 / 107.9 / 77.9 | — |
| Unmix theo F/B (band 2px) | 65.5 % | 23.7 % | 76.9 / 2.6 / 70.9 | 0 |
| + làm mịn alpha 0.5 | 0.0 % | 21.9 % | 54.7 / 10.0 / 70.4 | 0 |
| + fallback color-difference, band 1px, smooth 0.35 | **0.0 %** | **0.0 %** | **24.5 / 8.3 / 69.1** | **0** |
| như trên nhưng smooth 0 | 33.3 % | 0.1 % | 30.4 / 3.2 / 66.8 | 0 |

Kết luận rút ra:

- **Fallback color-difference là mảnh quyết định.** 1 918 / ~4 800 pixel viền không có mẫu
  foreground đục ở gần (sợi mảnh 1–2 px, vùng mờ). Không có fallback thì đúng những pixel
  đó giữ màu nền.
- Ước lượng nền cục bộ không đổi gì trên nền sạch, nhưng cần cho nền gradient/bóng đổ (clip-04), chi phí thấp.
- Làm mịn đổi một chút độ chính xác ở cạnh thẳng (c7: 3.2 → 8.3) lấy việc hết răng cưa → phải là slider, và tắt được cho pixel art.
- **Giới hạn đã biết:** clip-02 (vật thể trong mờ/motion blur) chỉ 77.9 → 69. Độ trong mờ *bên trong*
  vùng flood-fill cho là "không phải nền" cần matte mềm ở cấp keyer (phase 5–7 của plan
  `260828-1430-video-sprite-chroma-key-quality`), nằm ngoài phạm vi plan này.

## Phases

| Phase | Tên | Effort | Phụ thuộc |
|---|---|---|---|
| 1 | [Module `edge-refine.js` + test](./phase-01-edge-refine-module.md) | 6h | — |
| 2 | [Tích hợp Edge Refine vào Clean Sprite Sheet](./phase-02-edge-refine-ui.md) | 3h | 1 |
| 3 | [Pick Color trên khung Result + phạm vi `edge`](./phase-03-result-pick.md) | 5h | — (nên sau 2) |
| 4 | [Export không mất màu viền](./phase-04-export.md) | 1.5h | 1 |
| 5 | Cập nhật `AGENTS.md` / `README.md` | 0.5h | 1–4 |

**Thứ tự khuyến nghị: 1 → 2 → 4 → 3 → 5.** Edge Refine sửa nguyên nhân gốc cho phần lớn halo.
Pick trên Result là để dọn phần còn lại, và chỉ an toàn khi có phạm vi `edge`: pick một
màu viền (vốn gần màu nhân vật) theo kiểu `global` hiện tại sẽ ăn luôn màu đó ở giữa nhân vật.

## Pipeline mục tiêu (tab Clean Sprite Sheet)

```
state.original (ImageData, sRGB 8-bit)
  → runKeyer(connected)                     [giữ nguyên, baseline byte-identical]
      + keyRegions matchMode 'edge'         [phase 3, chỉ khi người dùng pick trên Result]
  → state.keyed  (cache)                    [phase 2]
  → refineEdges(keyed, original, keyColors) [phase 1–2, chỉ dải viền]
  → state.result → hiển thị
  → export: clone → applyAlphaBleed → encodePNG   [phase 4]
```

## Quyết định kiến trúc

| Quyết định | Lý do |
|---|---|
| `edge-refine.js` nằm **ngoài** `public/js/keyer/` | `AGENTS.md`: keyer có baseline byte-identical và `assertOptions()` chặn option lạ. Đặt ngoài giống `erase-mask.js` → không phải regenerate baseline, không mở whitelist. |
| Refine không bao giờ **tăng** alpha (`α = min(α_refine, α_keyer)`) | Tôn trọng quyết định của keyer, seed point và `Edge Cleanup`; lõi đảm bảo không đổi. |
| Refine chỉ ghi RGB trong dải viền | `Preserve original subject RGB` vẫn đúng nghĩa cho lõi nhân vật. |
| Cache `state.keyed` | Kéo slider Edge Refine chỉ chạy lại refine (rẻ), không chạy lại flood fill. |
| `matchMode: 'edge'` đi trong `keyRegions` | `keyRegions` đã được whitelist; field bên trong không bị `assertOptions` kiểm → không đổi baseline khi không dùng. |
| Không đụng Video → Sprite | Module thuần tuý nên tái dùng được về sau; ngoài phạm vi. |

## Rủi ro

| Rủi ro | Giảm thiểu |
|---|---|
| Màu pick trên Result (màu viền) lọt vào BFS chính và loang vào nhân vật | Key `edge` bị **loại khỏi** điều kiện `eligible` của BFS chính và không tạo seed point; chỉ chạy BFS phụ giới hạn `edgeReach` px. Có test. |
| Nền trung tính (trắng/đen/xám) — color-difference vô nghĩa khi chroma key ≈ 0 | Nhánh fallback bỏ qua khi `|chroma(B̂)| < 8`, giữ alpha keyer; vẫn còn nhánh unmix F/B. Có test. |
| Nhân vật cùng tông màu nền (clip-03) | Unmix cần `|F̂ − B̂| ≥ 40`; dưới ngưỡng → fallback / giữ alpha keyer. Có test "không làm tệ hơn". |
| Pixel art bị làm mờ viền | Checkbox `Pixel art edges`: bỏ smoothing, lượng tử alpha về {0, 255}, chỉ khử màu. |
| Hiệu năng sheet lớn (tới 50 MP) | Chỉ duyệt dải viền; distance transform BFS O(N). Gate benchmark ở phase 1. |
| Ô grid kế bên lọt vào cửa sổ lấy mẫu | Khi `perCell` bật, refine chạy theo từng ô (cùng công thức `frameRect`). |

## Tiêu chí thành công

- [ ] clip-08, cấu hình mặc định: viền alpha 255 ≤ 5 %, viền còn màu nền ≤ 1 %.
- [ ] `bandSAD` clip-01 ≤ 30, clip-07 ≤ 10, clip-02 không tệ hơn hiện tại (≤ 78).
- [ ] 0 pixel lõi (cách alpha 0 hơn `edgeWidth`) thay đổi RGBA.
- [ ] `npm test` xanh, baseline `test/keyer/baseline/` **không** phải regenerate.
- [ ] Pick trên Result ở cả `Anim` và `Sheet`, cả chuột lẫn phím mũi tên/Enter.
- [ ] PNG tải về giữ nguyên RGB đã khử nhiễm ở pixel alpha thấp (round-trip byte-exact).
- [ ] Refine sheet 4096×4096 < 1.5 s trên máy dev.

## Ngoài phạm vi

- Matte mềm cấp keyer cho vật thể trong mờ (xem plan 260828, phase 5–7).
- Áp Edge Refine cho tab Video → Sprite.
- Undo/redo cho danh sách màu (hiện xoá bằng nút × trên swatch).
- Lưu slider Edge Refine vào localStorage.
