# Phase 5 — Tài liệu

**Effort:** 1h · **Phụ thuộc:** Phase 1–4

## `AGENTS.md`

1. **Mục "Các file chính"** — thêm hai dòng, đặt cạnh `erase-mask.js` / `edge-refine.js` để
   nhóm "module hậu xử lý ngoài keyer" nằm liền nhau:
   - `public/js/region-key.js`: hạ alpha của pixel vừa nằm trong một vùng tròn/elip vừa khớp
     màu người dùng pick. Nằm **ngoài** `keyer/` như `erase-mask.js` — không đụng whitelist
     option, không đụng baseline. Toạ độ vùng chuẩn hoá 0..1 theo source, cùng hệ với nét vẽ.
     Thuần tuý, test bằng `test/region-key.test.mjs`.
   - `public/js/region-overlay.js`: phần tương tác (vẽ, hit-test, dời, đổi kích thước) dùng
     chung cho bốn bề mặt ở hai tab. Helper thuần tuý test bằng `test/region-overlay.test.mjs`.

2. **Mục mới `6c. Vùng tròn + Pick màu`** (sau `6b. Bút Xóa`), mô tả: cách vẽ, `Shift` ép tròn
   đều, `Shift` lúc `pointerdown` đảo phạm vi frame, các slider, checkbox `Chỉ vùng liền kề`,
   bốn bề mặt vẽ được, và quy tắc "vùng tròn là **phạm vi được phép xoá**, không phải mặt nạ
   bảo vệ".

3. **Mục 10 (Clean Sprite Sheet)** — cập nhật sơ đồ pipeline thành
   `keyed → refined → result`, ghi rõ vùng chạy **sau** Edge Refine và vì sao (refine unmix
   theo `state.lastKeyColors`, không biết màu của vùng).

4. **Mục "Quy tắc khi thay đổi code"** — thêm ba bất biến:
   - Vùng phải giữ vị trí `keyer → color replace → **region** → erase → bounds → crossfade`.
     Không đẩy vào `public/js/keyer/`.
   - Không có vùng nào ⇒ output **giống hệt từng byte** ở cả hai tab.
   - `applyRegionKeys` không bao giờ tăng alpha và không đọc/ghi ngoài bounding box của vùng.

5. Ghi lại bẫy `Number(null) === 0` cho `frame`/`frameTime` của vùng, trỏ về cùng ghi chú đã
   có ở `stroke-mask.js`.

## `README.md`

Thêm vào danh sách tính năng, mô tả hướng người dùng chứ không hướng kiến trúc:

> **Vùng tròn + Pick màu** — kéo một vòng tròn quanh chi tiết cần xoá rồi bấm vào màu bên
> trong. Màu đó chỉ bị xoá trong vòng tròn, nên một màu trùng với màu áo/da nhân vật vẫn giữ
> nguyên ở mọi nơi khác. Có ở cả `Video → Sprite` và `Clean Sprite Sheet`; vẽ được trên video
> gốc, trên khung preview, và trên cả hai khung của tab làm sạch.

Kèm một dòng số đo để người đọc biết vì sao nó đáng có: trên sheet mẫu, xoá một chi tiết
1 936 px bằng pick thường làm hỏng 12 392 px khác của nhân vật; bằng vùng tròn thì 0 pixel nào
ngoài vòng tròn bị đụng tới.

## Definition of done

- [ ] `AGENTS.md` cập nhật đủ 5 điểm trên.
- [ ] `README.md` có mục tính năng mới.
- [ ] Chạy lại flow demo end-to-end: load video → trim → vẽ vùng → pick → Generate → preview →
      download; và load sheet → vẽ vùng → pick → export.
- [ ] `npm test` xanh, `node --check server.js`, `node --check public/js/app.js`,
      server chạy và `GET /api/health` trả `ok`.
