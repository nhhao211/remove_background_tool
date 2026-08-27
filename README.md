# Video Background Remover & Sprite Sheet Studio 🎬✨

Một ứng dụng web chạy localhost bằng **NodeJS & Express** cho phép:
1. **Remove background từ video** với tính năng Chroma Key nâng cao, hỗ trợ đa màu sắc (multi-color), có công cụ Eyedropper click-to-detect trực tiếp trên video.
2. **Cắt ngắn video tùy chỉnh (Trim Video)** với thanh timeline trực quan, hỗ trợ thiết lập Start Time và End Time.
3. **Chuyển video thành Sprite Sheet** với số lượng **Columns (Cols)**, **Rows**, **Frames**, **Cell Size (px)** và **Crop (Top, Bottom, Left, Right)** hoàn toàn tùy chỉnh.
4. **Cho phép đặt tên file (Download name)** khi xuất kết quả.
5. **Sprite Sheet Preview Player**: Chạy animation preview trực tiếp với tính năng Play/Pause, Frame counter (VD: `9/24`), chuyển đổi xem Animation vs Full Sheet Grid, Zoom In/Out/Fit và Pan kéo chuột.
6. **Export Audio dưới dạng MP3**: Tự động trích xuất âm thanh tương ứng với đoạn video đã cắt.
7. **Download linh hoạt**: Tải về định dạng WebP / PNG trong suốt + Audio MP3 riêng lẻ hoặc tải trọn bộ gói file `.zip`.
8. **Tốc độ phát nhất quán**: Speed (0.1x–16x) được lưu theo từng video, dùng cho preview/FPS và áp dụng tempo tương ứng khi xuất MP3/ZIP.
9. **Bộ màu chroma key**: Nhập HEX/RGB, copy/paste, dùng lại màu gần đây và eyedropper; màu được lưu an toàn theo video.
10. **Clean Sprite Sheet**: Upload PNG/WebP/JPEG tĩnh ở tab riêng, tự nhận diện nền từ biên ảnh hoặc từng cell, bảo vệ vùng màu bị bao kín trong chủ thể, làm sạch viền và export lại PNG/WebP trong suốt.
11. **Subject Protect Brush**: Vẽ mask mềm trực tiếp trên Source Video để bảo vệ màu và alpha của chủ thể ở những vùng gần màu nền; hỗ trợ bút/tẩy, size, strength, hardness, undo/redo và preset cho chi tiết đặc hoặc bán trong suốt.
12. **Subject Color Replace**: Dùng eyedropper chọn màu chủ thể từ Source Video hoặc Sprite Preview, chọn màu đích, rồi điều chỉnh tolerance/strength để đổi dải màu tương ứng mà vẫn giữ highlight và bóng.

---

## 🚀 Hướng dẫn cài đặt và khởi chạy

### Yêu cầu hệ thống:
- **NodeJS** (>= v18)
- **FFmpeg** (đã được cài đặt trên hệ thống để trích xuất âm thanh MP3 chất lượng cao)

### 1. Cài đặt thư viện:
```bash
npm install
```

### 2. Khởi chạy server:
```bash
npm start
```
Hoặc chế độ phát triển (auto reload):
```bash
npm run dev
```

### 3. Mở trên trình duyệt:
Truy cập: **[http://localhost:3000](http://localhost:3000)**

---

## 🎯 Hướng dẫn sử dụng chi tiết

1. **Tải video lên:**
   - Kéo & thả video (.mp4, .webm, .mov, ...) vào vùng *Drag & drop video* hoặc nhấn nút **Browse**.
   - Có thể nhấn **Load Demo Video** để thử nghiệm ngay lập tức với video mẫu có sẵn.

2. **Cắt ngắn video (Video Trim):**
   - Di chuyển thanh trượt trên Source Video hoặc nhập số giây vào ô **Trim Start** và **Trim End**.
   - Sử dụng các nút `[ Set Start ]` / `[ Set End ]` để gán nhanh thời điểm video đang phát.
   - Kéo handle bằng chuột/touch; vùng cắt tối thiểu là 0.2 giây và có snap nhẹ theo mốc thời gian.

3. **Xóa phông nền (Remove Background / Chroma Key):**
   - Nhấn nút **🎯 Pick Color from Video** và rê chuột lên video -> Một kính lúp phóng to sẽ hiện lên -> Click vào màu nền để tự động phát hiện mã màu và thêm vào danh sách.
   - Có thể click chọn thêm nhiều màu nền khác nhau nếu video có phông nền gradient hoặc bóng đổ.
   - Điều chỉnh thanh trượt **Similarity (Color Tolerance)** để loại bỏ dải màu nền rộng hơn.
   - Điều chỉnh **Blend (Edge Feathering)** để làm mịn rìa ảnh nhân vật, chống răng cưa.
   - Điều chỉnh **Spill Suppression** để khử viền màu ám lên nhân vật.
   - Dùng **Subject Protect Brush → Protect** rồi vẽ lên những vùng chủ thể bị thủng hoặc mất màu. Chỉnh `Size`, `Strength`, `Hardness`; chọn `Translucent` cho hoa mỏng/tóc/kính/khói hoặc `Solid` cho vùng đặc. Mask tĩnh được áp dụng cho mọi frame khi nhấn **Generate**.
   - Dùng **Erase**, **Undo**, **Redo** hoặc **Clear** để sửa mask. `Show mask` chỉ bật/tắt lớp màu tím hướng dẫn, không thay đổi kết quả xuất.
   - Bật **Subject Color Replace**, nhấn **Pick source** và chọn màu trên Source/Preview, sau đó chọn màu ở ô `To`. `Tolerance` quyết định độ rộng dải màu được đổi, `Strength` quyết định mức hòa trộn. Nhấn **Generate** lại để cập nhật toàn bộ frame.

4. **Tùy chỉnh Sprite Sheet:**
   - **Frames**: Số lượng frame cần trích xuất (VD: 24).
   - **Cols & Rows**: Số cột và số hàng của sprite sheet (VD: 6 cột x 4 hàng = 24 frames).
   - **Cell (native)**: Kích thước pixel mỗi ô (VD: 512px).
   - **Crop (top, bottom, left, right)**: Cắt viền thừa xung quanh nhân vật.
   - **Download name**: Đặt tên file xuất ra (VD: `Lily_attack`).
   - **Auto FPS**: Tự động tính toán tốc độ khung hình phù hợp với độ dài video.
   - **Video Speed** và **Reset** điều khiển tốc độ preview; state được khôi phục khi mở lại cùng video.

5. **Tạo và Preview:**
   - Nhấn nút **⚙ Generate** màu xanh dương.
   - Xem chuyển động nhân vật trong khung **Sprite sheet preview** (nút `▶ Play / ⏸ Pause`).
   - Nhấn nút `▦ Sheet` để xem toàn bộ lưới sprite sheet.

6. **Tải về:**
   - Nhấn **📥 Download WebP/PNG + audio** để tải gói `.zip` gồm cả Sprite Sheet và file `.mp3`.
   - Hoặc mở menu thả xuống để tải riêng Sprite Sheet hoặc file Audio MP3.

### Làm sạch sprite sheet có sẵn

1. Chọn tab **Clean Sprite Sheet** trên Header rồi upload hoặc kéo thả ảnh PNG, WebP hay JPEG.
2. Nhấn **Auto Remove** để tự tìm màu nền từ mép ảnh. Bật **Analyze each sprite cell** và nhập Rows/Cols nếu mỗi cell có nền riêng.
3. Dùng **Pick color from Original** hoặc thêm màu thủ công khi cần bổ sung màu gradient/halo còn sót.
   - Khai báo đúng Rows/Cols để preview animation theo từng sprite cell.
   - Màu pick từ frame preview được áp dụng cho toàn bộ frame trong sheet. Dùng **Pick Below Line / All Frames** nếu màu chỉ cần xóa bên dưới đường chia của từng sprite; bật **Adjust split line** để kéo đường chia từ 10%–90% chiều cao frame.
4. Điều chỉnh Similarity, Edge Feather, Spill Suppression, Subject Protection và Edge Cleanup, sau đó nhấn **Apply**.
5. Kiểm tra kết quả trên checkerboard và tải PNG/WebP bằng nút **Download**.
