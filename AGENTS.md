# AGENTS.md

## Tổng quan dự án

Đây là web app chạy local tên `Video Background Remover & Sprite Sheet Studio`. Ứng dụng nhận video, cho phép chọn đoạn cần xử lý, loại nền bằng chroma key trong trình duyệt, lấy các frame mẫu để tạo sprite sheet, preview animation và tải kết quả xuống.

## Công nghệ và cấu trúc

- Backend: Node.js ES modules + Express (`server.js`).
- Upload multipart: Multer, giới hạn mỗi file 500 MB.
- Xử lý audio: gọi lệnh `ffmpeg` từ backend và mã hóa MP3 bằng `libmp3lame`.
- Tạo ZIP: `archiver`.
- Frontend: HTML/CSS/JavaScript thuần trong `public/`; xử lý frame và chroma key bằng `<video>`, Canvas 2D và `ImageData` ngay trên browser.
- Icon UI: Lucide từ CDN `https://unpkg.com/lucide@latest`.
- Các file chính:
  - `server.js`: static server, upload, audio extraction, ZIP export và cleanup.
  - `public/index.html`: layout, controls, input và các vùng preview.
  - `public/js/app.js`: state, event handlers, trim editor, eyedropper, chroma key, sprite generation, preview và download.
  - `public/css/style.css`: giao diện và trạng thái tương tác.
  - `public/samples/sample_blue_flower.mp4`: video demo được tự động load khi mở app.

## Chạy và kiểm tra

Yêu cầu Node.js >= 18 và `ffmpeg` phải có trong `PATH`.

```bash
npm install
npm start
npm run dev
```

- Mặc định mở `http://localhost:3000`.
- Nếu port đang bận, server tự thử port kế tiếp.
- `npm run dev` dùng `node --watch server.js`.
- Repo hiện không khai báo test, lint hoặc build script. Khi thay đổi code, tối thiểu kiểm tra cú pháp bằng `node --check server.js` và `node --check public/js/app.js`, sau đó chạy server và gọi `GET /api/health`.
- Không commit `uploads/`, `temp/` hoặc các file phát sinh khi chạy local.

## Danh mục đầy đủ chức năng hiện có

### 1. Nạp video

- Tự động load video demo `/samples/sample_blue_flower.mp4` khi khởi động.
- Nút `Load Demo Video` để load lại video mẫu.
- Chọn file qua nút `Browse` ở action bar hoặc trong drop zone.
- Kéo thả video ở cấp toàn trang, tại source-video viewport hoặc tại drop zone; có overlay báo vị trí thả.
- Chấp nhận video theo MIME `video/*` hoặc phần mở rộng `.mp4`, `.webm`, `.mov`, `.avi`, `.mkv`, `.m4v`, `.ogv`, `.flv`.
- Hiển thị tên file, kích thước native và thời lượng sau `loadedmetadata`.
- Tên file được dùng để gợi ý `Download name`.
- Tạo object URL cho file local và revoke object URL cũ khi load file mới.

### 2. Điều khiển source video

- Play/pause tại header source video và trong editor.
- Phím tắt `Space` play/pause, `Left Arrow` lùi 1/24 giây, `Right Arrow` tiến 1/24 giây; không bắt phím khi đang nhập form.
- Nút step frame trước/sau ở header.
- Nút skip trước/sau 1 giây trong toolbar editor.
- Hiển thị current time / total time với độ chính xác đến centisecond.
- Play trong editor lặp trong vùng trim; playback tự dừng khi chạm `Trim End`.
- Mute/unmute source video.
- Toast notification cho trạng thái load, lỗi và thao tác chính.

### 3. Trim và timeline editor

- Chọn `Trim Start` và `Trim End` bằng input số.
- Nút `Set Start` / `Set End` lấy thời điểm playhead hiện tại.
- Nút `Reset` đưa vùng trim về toàn bộ video.
- Timeline có ruler tự chọn bước tick theo thời lượng video.
- Sinh filmstrip 12 thumbnail từ toàn bộ video để hiển thị trong clip.
- Kéo handle trái/phải để thay đổi đầu/cuối vùng trim; luôn giữ khoảng tối thiểu 0.05 giây.
- Click/drag nền timeline hoặc playhead để scrub.
- Kéo phần thân clip để dịch cả cửa sổ trim trong video nhưng giữ nguyên độ dài.
- Vùng ngoài trim được làm mờ, vùng trim được highlight.
- `Split` cắt tại playhead và giữ đoạn bên trái.
- `Duplicate` sau Split chuyển vùng chọn sang đoạn bên phải; nếu không có split trước đó thì chỉ reselect/flash vùng hiện tại.
- `Delete` trong editor hiện reset vùng trim về full video; đây không phải xóa file hay xóa clip thật khỏi project.
- Crop overlay trên source video phản ánh crop top/bottom/left/right theo đúng vùng render `object-fit: contain`.

### 4. Tốc độ phát và FPS preview

- Preset tốc độ phát và input tốc độ tùy chỉnh đồng bộ giữa editor/settings.
- Giới hạn tốc độ 0.1x–16x; cập nhật `video.playbackRate` và nhãn tốc độ.
- Tự tính FPS từ số frame, độ dài vùng trim và tốc độ: `frames / (trimDuration / speed)`, clamp trong 1–60 FPS.
- Nút `Auto FPS` cập nhật FPS và hiển thị toast.
- Thay đổi FPS khi animation đang chạy sẽ restart timer preview.

### 5. Cấu hình sprite sheet

- Chọn tổng số frame cần lấy, giới hạn UI 1–500.
- Chọn số `Rows` và `Cols`; nếu grid không đủ chỗ, `Rows` tự tăng để chứa hết frame.
- `Keep source size`: giữ kích thước sau crop theo native video.
- Nếu tắt `Keep source size`, đặt chiều rộng cell bằng `Cell (native)` và tự tính chiều cao để giữ aspect ratio; giới hạn UI 16–4096 px.
- Crop pixel theo bốn cạnh: top, bottom, left, right; crop được clamp nội bộ để kích thước còn lại tối thiểu 1 px.
- Đặt tên file output; ký tự ngoài `[a-zA-Z0-9_-]` được thay bằng `_`.
- Chọn định dạng output `WebP` hoặc `PNG`.
- Checkbox `Transparent WebP/PNG` bật/tắt việc áp dụng chroma key; tên nhãn thay đổi theo format đang chọn.

### 6. Chroma key / remove background

- Có màu key mặc định xanh dương `#0024F5`.
- Thêm nhiều màu nền, phù hợp nền gradient, bóng đổ hoặc nhiều sắc độ.
- Lấy màu bằng eyedropper trực tiếp từ source video.
- Lấy màu bằng eyedropper từ sprite preview sau khi đã generate.
- Eyedropper có loupe phóng đại, hiển thị HEX/RGB và màu pixel đang trỏ tới.
- Khi eyedropper active, video/animation tạm dừng để lấy pixel ổn định.
- Cuộn để zoom eyedropper; kéo để pan khi zoom; có nút reset zoom và phím `Escape`/nút thoát.
- Eyedropper preview cũng hỗ trợ zoom/pan riêng và từ chối lấy pixel trong suốt.
- Thêm màu thủ công qua color input; xóa từng màu trong danh sách swatches.
- Màu gần trùng trong ngưỡng khoảng cách RGB cộng < 10 sẽ không bị thêm lặp.
- `Similarity` điều chỉnh tolerance màu.
- `Blend` tạo feather alpha bằng smoothstep để làm mềm biên.
- `Spill Suppression` khử halo màu key ở cạnh foreground; nhận diện channel chính blue/green/red từ màu key đầu tiên.
- Thuật toán tính khoảng cách màu weighted Euclidean/redmean trên từng pixel và lấy khoảng cách nhỏ nhất tới toàn bộ key colors.

### 7. Generate sprite sheet

- Nút `Generate` seek video tới các thời điểm phân bố đều trong vùng trim.
- Với mỗi frame: crop theo bốn cạnh, resize vào cell, đọc `ImageData`, áp dụng chroma key, lưu bản frame riêng và vẽ vào canvas sprite sheet lớn.
- Lưu `generatedFrames` để chạy animation và `fullSheetCanvas` để preview/download.
- Hiển thị progress bar theo số frame đã xử lý.
- Tự disable nút Generate trong lúc xử lý và tự khởi động animation preview khi xong.
- Việc tạo sprite sheet hoàn toàn chạy ở client; backend không có endpoint generate sprite.

### 8. Sprite preview

- Play/pause animation bằng interval theo `Preview FPS`.
- Hiển thị frame counter dạng `current/total`.
- Hai chế độ: `Anim` hiển thị từng cell đang chạy, `Sheet` hiển thị toàn bộ grid và đường kẻ cell.
- Nút `Zoom In`, `Zoom Out`, `Fit to View`.
- Cuộn chuột để zoom và kéo chuột để pan canvas.
- Nút `Grid / Dark BG` đổi nền checkerboard trong suốt và nền tối.
- Eyedropper trên preview tạm thời chiếm thao tác zoom/pan để phục vụ lấy màu.

### 9. Download/export

- Download sprite sheet riêng bằng WebP hoặc PNG từ `fullSheetCanvas`.
- Download audio riêng dạng MP3, cắt theo `Trim Start`/`Trim End` bằng FFmpeg.
- Download bundle ZIP gồm sprite sheet và MP3 tương ứng.
- Tên file được áp dụng cho image, audio và tên ZIP.
- Khi tạo bundle lỗi, frontend fallback sang download sprite sheet và audio riêng.
- Menu download tự đóng khi click bên ngoài.

## API backend

### `GET /api/health`

Trả JSON `{ status: "ok", uptime }`.

### `POST /api/upload-video`

- Multipart field: `video`.
- Lưu file vào `uploads/` với prefix timestamp/random và tên đã sanitize.
- Trả filename lưu trên server, originalName, public path và size.
- Endpoint tồn tại để upload server-side nhưng frontend hiện tại chủ yếu giữ file bằng object URL và gửi raw file trực tiếp cho các endpoint export/audio.

### `POST /api/extract-audio`

- Multipart field: `video`, hoặc body `videoFilename` trỏ tới file trong `uploads/`.
- Body hỗ trợ `startTime`, `endTime`, `downloadName`.
- Chạy FFmpeg với `-vn`, `libmp3lame`, VBR quality `2`, trả `audio/mpeg` dạng attachment.
- Xóa input upload tạm và MP3 tạm sau khi stream đóng; trả lỗi nếu không có audio stream.

### `POST /api/export-bundle`

- Multipart field: `video` và body `spriteDataUrl`, `spriteFormat`, `downloadName`, `startTime`, `endTime`.
- Nhúng sprite image từ data URL vào ZIP.
- Nếu video có sẵn, gọi FFmpeg để tạo MP3 theo vùng trim rồi thêm vào ZIP.
- Trả `application/zip` với tên `<downloadName>_bundle.zip` và cleanup file tạm sau khi archive kết thúc.

## Runtime và lưu trữ tạm

- Server tự tạo `uploads/`, `temp/`, `public/` nếu thiếu.
- `uploads/` và `temp/` được quét mỗi 15 phút; file cũ hơn 1 giờ bị xóa.
- Không dùng đường dẫn file do client cung cấp trực tiếp: backend dùng `path.basename` cho `videoFilename`.
- CORS đang bật toàn cục và JSON/urlencoded body limit là 100 MB.
- Upload Multer có giới hạn 500 MB, nhưng chưa có filter MIME ở backend; validation loại file chủ yếu nằm ở frontend.

## Quy tắc khi thay đổi code

- Giữ frontend xử lý sprite/chroma key trên Canvas trừ khi có yêu cầu kiến trúc mới; thay đổi backend không tự làm sprite generation server-side.
- Khi thêm/sửa control, đồng bộ cả `public/index.html`, `public/js/app.js` và `public/css/style.css`; kiểm tra id vì `app.js` lấy DOM element bằng id khi `DOMContentLoaded`.
- Giữ các giới hạn trim, rows/cols, crop, speed, FPS và quy tắc sanitize tên file nhất quán với UI hiện tại.
- Nếu sửa pipeline audio hoặc ZIP, kiểm tra cả trường hợp input là file local và trường hợp video demo URL.
- Nếu sửa Canvas/chroma key, kiểm tra cả hai format PNG/WebP, trạng thái transparent bật/tắt, nhiều key colors, alpha edge và preview mode `Anim`/`Sheet`.
- Không coi `Split`, `Duplicate`, `Delete` là hệ thống timeline nhiều clip: hiện chúng chỉ thao tác trên `trimStart`/`trimEnd` và state backup.
- Sau thay đổi lớn, chạy kiểm tra cú pháp, khởi động server, kiểm tra `/api/health`, rồi thử flow demo: load video → trim → generate → preview → download.
