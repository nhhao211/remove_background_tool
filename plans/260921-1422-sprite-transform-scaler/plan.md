---
title: "Sprite Transform & Scaler — tăng giảm kích thước và căn chỉnh toạ độ nhân vật trên lưới Grid"
description: "Tab mới trên thanh Navigation cho phép scale (phóng to/thu nhỏ) nhân vật, căn chỉnh toạ độ X/Y, neo anchor 3x3, match chiều cao Frame 1, circle crop và preview animation theo đúng thiết kế tham khảo, trong khi vẫn giữ nguyên kích thước cell ban đầu."
status: completed
priority: P1
effort: 16h
branch: feature/sprite-transform-scaler
tags: [frontend, canvas, sprite, animation, ux]
blockedBy: []
blocks: []
created: 2026-09-21
---

# Sprite Transform & Scaler

## Yêu cầu người dùng
1. Tăng/giảm kích thước nhân vật trong sprite sheet sau khi đã remove nền.
2. Nằm ở một trang Tab khác trên thanh Navigation.
3. Nhân vật có toạ độ, nằm trên ô lưới Grid để user có thể tăng giảm kích thước và dịch chuyển toạ độ.
4. **Giữ nguyên kích thước cell ban đầu của từng cell trong sprite sheet** (hoặc tuỳ chỉnh kích thước output cell nếu muốn).
5. Giao diện bám sát 100% bản thiết kế mẫu:
   - Cột trái: Frames list dạng lưới 2 cột, chỉ số `23/24`, thumbnail có số frame, highlight frame active.
   - Top bar: View modes (`Frame`, `Animate`, `Sheet`), nút Play/Pause, Background selector (`Checker`, `Black`, `White`, `Green`), nút bật/tắt `Grid`.
   - Vùng giữa: Canvas hiển thị cell boundary viền đỏ, lưới grid nét đứt xanh lá, trục vàng X-center, trục xanh dương Y-center, badge `⚠️ Content is clipped`, kéo chuột trực tiếp `Drag to position`, thanh điều khiển `< Frame X of Y >`, `FPS`.
   - Cột phải:
     - `APPLY TO ALL FRAMES`, `Transform`, nút Reset `[↺]`.
     - `SCALE`: Presets (50%, 75%, 100%, 125%, 150%), Scale X slider & input, `Proportions linked`, `Match Frame 1 height`.
     - `POSITION`: X offset, Y offset, D-pad 4 hướng, lưới 9 điểm neo (3x3 Anchor).
     - `CIRCLE CROP`: Checkbox `Crop from frame center`, Diameter slider & presets, `Fade starts` slider.
   - Bottom bar: `OUTPUT FRAME: W x H`, `Use source cell size`, `Smooth` checkbox, status text, `Download WebP/PNG`.

## Kế hoạch triển khai
- **Phase 1**: Thuật toán hình học & xử lý ảnh thuần túy `public/js/sprite-transform-math.js` + unit tests `test/sprite-transform-math.test.mjs`.
- **Phase 2**: HTML layout trong `public/index.html` + CSS styling trong `public/css/style.css`.
- **Phase 3**: Logic điều khiển & Render engine `public/js/sprite-transform.js`.
- **Phase 4**: Tích hợp Workspace Navigation & nút liên thông từ các tab khác.
- **Phase 5**: Kiểm thử toàn diện (`npm test`, syntax check, API health, chạy thử).
