# Kế hoạch thực thi cải tiến Video Editor

Nguồn yêu cầu: `VIDEO_EDITOR_IMPROVEMENT_SUMMARY.md`

## 1. Mục tiêu và phạm vi

Kế hoạch này triển khai bốn nhóm cải tiến theo thứ tự:

1. Kéo trim mượt, chính xác và có preview gần realtime.
2. Lưu speed nhất quán và áp dụng speed cho preview lẫn audio export.
3. Sắp xếp lại settings panel để giảm cuộn dọc.
4. Nâng cấp bộ chọn màu theo đúng luồng chroma key hiện có.

Phạm vi giữ nguyên kiến trúc hiện tại: frontend JavaScript thuần xử lý video/sprite bằng Canvas; Express và FFmpeg chỉ phục vụ audio/ZIP. Đợt này không xây timeline nhiều clip, không thêm hệ thống tài khoản/cloud project và không chuyển sprite generation sang backend.

## 2. Các quyết định kỹ thuật trước khi triển khai

### 2.1. Khái niệm clip/project

Ứng dụng hiện chỉ có một video và một vùng trim, chưa có danh sách clip hoặc project model. Vì vậy:

- Giai đoạn này coi video đang mở là một `clipState` duy nhất.
- Lưu cấu hình theo `sourceId`: URL đối với demo; fingerprint `name:size:lastModified` đối với file local.
- `localStorage` chỉ lưu metadata và settings, không lưu video blob.
- Khi reload, demo có thể tự khôi phục đầy đủ; file local chỉ khôi phục settings sau khi người dùng chọn lại đúng file do giới hạn bảo mật của trình duyệt.
- Việc chuyển qua lại giữa nhiều clip và serialize một project nhiều clip được để ngoài phạm vi. Có thể bổ sung sau khi app có clip list thật.

### 2.2. Ý nghĩa của speed khi export

Output chính là sprite sheet, không phải video. Speed sẽ được thể hiện theo hai cách:

- Sprite animation: giữ các frame được lấy đều trong vùng trim và tính FPS theo `frames / effectiveDuration`, trong đó `effectiveDuration = (trimEnd - trimStart) / speed`.
- Audio MP3: trim đúng vùng nguồn, sau đó đổi tempo bằng FFmpeg để thời lượng audio khớp `effectiveDuration`.

Không thay đổi pitch của audio. Với speed ngoài khoảng một filter `atempo` hỗ trợ, backend tạo chuỗi filter hợp lệ, ví dụ `4x -> atempo=2,atempo=2` và `0.25x -> atempo=0.5,atempo=0.5`.

### 2.3. Phạm vi color picker

Các target `background`, `border`, `text`, `shadow` trong summary chưa tồn tại trong sản phẩm. Trong đợt này color picker được nâng cấp thành bộ quản lý nhiều màu chroma key: nhập HEX/RGB, eyedropper, recent colors, copy/paste và swatches. RGBA/opacity không áp dụng cho key color; alpha của output tiếp tục do Similarity/Blend quyết định.

Nếu sản phẩm thực sự cần chỉnh màu background/border/text/shadow, cần đặc tả và thêm các thuộc tính render đó trước; đây là một epic riêng.

## 3. Thứ tự triển khai

### Giai đoạn 0 — Chuẩn hóa state và helper dùng chung

**Mục tiêu:** tạo nền tảng để trim, speed, persistence và export dùng cùng một công thức.

**Công việc**

- Tách các hàm thuần: clamp trim range, snap time, format speed, source duration, effective duration và tạo chuỗi FFmpeg `atempo`.
- Đặt hằng số dùng chung ở frontend: `MIN_TRIM_DURATION = 0.2`, speed `0.1–16`, snap threshold theo pixel/time.
- Thay toàn bộ mốc tối thiểu `0.05s` đang rải trong trim, split và playback bằng cùng một quy tắc `0.2s` hoặc một helper duy nhất.
- Tách cập nhật timeline thành hai mức:
  - `updateTrimGeometry()` chỉ cập nhật handle/clip/dim/input/tooltip.
  - `renderRuler()` chỉ chạy khi load metadata hoặc resize, không chạy trong mỗi drag frame.
- Thêm test runner tối thiểu bằng Node built-in `node:test`; bổ sung script `npm test`.

**File dự kiến**

- `public/js/app.js`
- `public/js/editor-utils.js` (mới)
- `package.json`
- `test/editor-utils.test.js` (mới)

**Hoàn thành khi**

- Các công thức trim/speed chỉ có một nguồn sự thật.
- Test bao phủ clamp biên, gần giao nhau, speed nhỏ/lớn hơn `1x` và chuỗi `atempo`.
- Ruler không bị tạo lại khi kéo handle.

**Ước lượng:** 0.5–1 ngày.

---

### Giai đoạn 1 — Tối ưu trim handle và preview realtime

**Mục tiêu:** kéo hai đầu trim phản hồi mượt, xem đúng frame và không tạo range không hợp lệ.

**Công việc**

1. Chuyển interaction từ `mousedown/mousemove/mouseup` sang Pointer Events và `setPointerCapture()` để hỗ trợ cả chuột lẫn touch.
2. Gom các pointer move bằng một `requestAnimationFrame`; mỗi frame chỉ xử lý vị trí mới nhất.
3. Khi kéo handle:
   - tính raw time từ tọa độ;
   - áp dụng snap;
   - clamp theo `MIN_TRIM_DURATION`;
   - cập nhật geometry, input và tooltip;
   - seek preview tới trim start/end đang kéo.
4. Điều phối seek theo cơ chế “latest request wins”, không xếp hàng nhiều lần seek. Ưu tiên `requestVideoFrameCallback` nếu browser hỗ trợ, fallback về `seeked`/throttle.
5. Thêm tooltip nổi trên handle active, hiển thị `mm:ss.cc`; ẩn khi kết thúc/cancel drag.
6. Snap nhẹ vào:
   - bước `0.1s`;
   - mốc giây nguyên;
   - vị trí playhead;
   - đầu/cuối video.
   Chỉ snap khi mốc nằm trong ngưỡng nhỏ tương đương khoảng 6–8 px để không tạo cảm giác handle bị hút quá mạnh.
7. Trì hoãn thao tác không cần realtime như `autoComputeFPS()`, persistence và tính toán output cho tới cuối drag. Effective-duration text có thể cập nhật nhẹ trong animation frame.
8. Giữ filmstrip trong bộ nhớ theo `sourceId`; không generate lại do trim thay đổi. Hủy job filmstrip cũ nếu người dùng load video khác giữa chừng.
9. Hỗ trợ `pointercancel`, mất focus và phím `Escape` để kết thúc drag sạch, tránh trạng thái `.dragging` bị kẹt.

**Thay đổi UI/CSS**

- Thêm `.trim-handle-tooltip`, trạng thái visible/dragging và vùng hit target đủ lớn.
- Tooltip không tràn khỏi timeline ở hai biên.
- Dùng `will-change: left, width` có chọn lọc cho các phần tử timeline đang chuyển động.

**File dự kiến**

- `public/js/app.js`
- `public/index.html`
- `public/css/style.css`
- `public/js/editor-utils.js`
- `test/editor-utils.test.js`

**Kiểm thử/tiêu chí nghiệm thu**

- Kéo liên tục trên video demo không có giật rõ rệt; mục tiêu UI đạt gần 60 FPS trên máy dev thông thường.
- Ruler và filmstrip không được dựng lại trong drag.
- Preview hiển thị frame tương ứng với đầu trim trái hoặc phải đang kéo.
- Tooltip sai số không quá độ phân giải hiển thị `0.01s`.
- Hai handle không vượt nhau và range không ngắn hơn `0.2s` qua drag, input số, Set Start/End hoặc Split.
- Generate sprite và audio export dùng đúng range cuối cùng trên UI.
- Test thủ công cả mouse, touch/pointer, video ngắn và video dài.

**Ước lượng:** 1.5–2 ngày.

---

### Giai đoạn 2 — Persist speed và đồng bộ export

**Mục tiêu:** speed là một phần của clip state, được khôi phục và cho kết quả audio/sprite nhất quán.

**Công việc frontend**

1. Chuẩn hóa `clipState` tối thiểu:

   ```js
   {
     schemaVersion: 1,
     sourceId,
     trimStart,
     trimEnd,
     playbackSpeed,
     previewFps,
     updatedAt
   }
   ```

2. Thêm `loadClipState()`, `saveClipStateDebounced()` và migration/fallback an toàn khi dữ liệu hỏng hoặc khác version.
3. Gọi save sau khi kết thúc trim drag, đổi input trim, đổi speed, reset và các thao tác Split/Duplicate/Delete hiện có.
4. Khi load metadata:
   - xác định `sourceId`;
   - khôi phục range sau khi clamp theo duration thực;
   - khôi phục speed;
   - đồng bộ cả preset, hai speed input, `video.playbackRate`, FPS và effective-duration label.
5. Thêm nút Reset Speed về `1x` và nhãn thống nhất (`0.5x`, `1x`, `1.25x`, `2x`).
6. Gửi `playbackSpeed` trong request `/api/extract-audio` và `/api/export-bundle`.

**Công việc backend**

1. Parse và validate `playbackSpeed` trong khoảng `0.1–16`; mặc định `1` để tương thích request cũ.
2. Dùng cùng helper tạo filter `atempo` cho cả hai endpoint audio.
3. Đưa `-filter:a` vào FFmpeg sau trim; giữ `libmp3lame` và chất lượng hiện tại.
4. Chuẩn hóa cleanup khi FFmpeg lỗi/connection đóng để file upload và file tạm không bị sót.

**File dự kiến**

- `public/js/app.js`
- `public/index.html`
- `public/css/style.css`
- `server.js`
- `public/js/editor-utils.js`
- `test/editor-utils.test.js`
- `test/server.test.js` hoặc test helper backend phù hợp

**Kiểm thử/tiêu chí nghiệm thu**

- Đổi speed, reload app và chọn lại cùng file: speed/range được khôi phục.
- Demo video tự khôi phục state sau reload.
- File khác không nhận nhầm state của file trước.
- Reset Speed đưa preview, preset, input và state về `1x`.
- Với trim 10 giây: audio xuất ở `2x` dài xấp xỉ 5 giây; ở `0.5x` dài xấp xỉ 20 giây.
- Bundle và download audio riêng tạo cùng kết quả tempo.
- Sprite preview duration khớp audio trong sai số khoảng một frame preview.
- Request không có speed vẫn xuất audio `1x`.

**Ước lượng:** 1.5–2 ngày.

---

### Giai đoạn 3 — Sắp xếp settings panel gọn hơn

**Mục tiêu:** đưa các control thường dùng vào một viewport desktop phổ biến và giảm cuộn trên mobile.

**Cấu trúc đề xuất**

- **Quick controls (luôn mở):** Trim, Speed, Frames, Rows/Cols, Preview FPS, Generate và Download.
- **Size & Crop:** Keep source size, Cell size, Crop top/right/bottom/left.
- **Background removal:** Transparent, format, key colors, Similarity, Blend, Spill.
- **Advanced (mặc định đóng):** các giá trị crop chi tiết hoặc tùy chọn ít dùng sau khi đo usage thực tế.

Không thêm `Position`, opacity, volume hoặc radius chỉ vì summary nhắc tới; các thuộc tính này chưa tồn tại trong pipeline hiện tại.

**Công việc**

1. Loại các inline style của settings và chuyển sang class có thể responsive.
2. Dùng CSS Grid compact cho cặp field ngắn: Rows/Cols, Crop T/B, Crop L/R, Speed/FPS.
3. Tạo section header/accordion có `button`, `aria-expanded`, keyboard focus và trạng thái mở/đóng rõ ràng.
4. Desktop: hai cột theo nhóm, giữ action quan trọng sticky hoặc luôn nhìn thấy trong card.
5. Mobile: một cột, section có thể collapse; Quick controls mặc định mở.
6. Không đổi ID của control nếu không cần; nếu đổi phải cập nhật đồng bộ HTML/JS/CSS.
7. Kiểm tra không layout shift khi swatches tăng, progress chạy hoặc label format thay đổi.

**File dự kiến**

- `public/index.html`
- `public/css/style.css`
- `public/js/app.js`

**Kiểm thử/tiêu chí nghiệm thu**

- Ở viewport desktop mục tiêu `1440x900` và `1366x768`, các thao tác chính không cần cuộn hoặc chỉ cuộn tối thiểu.
- Không overflow/overlap tại các breakpoint `1280`, `1024`, `768`, `390` px.
- Tab order hợp lý; accordion dùng được bằng keyboard và có ARIA đúng.
- Load, trim, chroma key, generate và download vẫn hoạt động sau khi đổi layout.

**Ước lượng:** 1–1.5 ngày.

---

### Giai đoạn 4 — Nâng cấp color picker cho chroma key

**Mục tiêu:** gom thao tác thêm/tái sử dụng màu nền vào một control nhất quán mà không làm thay đổi thuật toán chroma key.

**Công việc**

1. Tạo popover/panel chung gồm:
   - native color input;
   - text input HEX và RGB;
   - Pick from Video/Preview;
   - Add/Replace active swatch;
   - Copy/Paste giá trị;
   - Recent colors.
2. Validate và normalize màu về cấu trúc `{ r, g, b, hex }`; hiển thị lỗi inline, không thêm dữ liệu sai.
3. Giữ dedupe màu gần nhau theo quy tắc hiện tại, nhưng đưa thành helper có test.
4. Lưu tối đa 8–12 recent colors trong `localStorage`; project palette có thể dùng chính `keyColors` của clip state.
5. Đảm bảo eyedropper video/preview đưa màu vào cùng một flow và không bị double event.
6. Hỗ trợ keyboard: Enter để apply, Escape để đóng, focus return về trigger.

**File dự kiến**

- `public/index.html`
- `public/css/style.css`
- `public/js/app.js`
- `public/js/editor-utils.js`
- `test/editor-utils.test.js`

**Kiểm thử/tiêu chí nghiệm thu**

- HEX dạng ngắn/dài và RGB hợp lệ được normalize, áp dụng đúng.
- Giá trị sai không thay đổi key colors.
- Eyedropper, nhập tay, recent color và copy/paste cùng tạo một cấu trúc màu nhất quán.
- Recent colors còn sau reload.
- Nhiều key colors vẫn cho kết quả chroma key giống trước khi refactor.

**Ước lượng:** 1–1.5 ngày.

## 4. Chiến lược kiểm thử và xác minh

### Automated

- `npm test`: helper trim, snapping, duration, speed, color parsing/dedupe và FFmpeg tempo chain.
- `node --check server.js`.
- `node --check public/js/app.js` hoặc kiểm tra import module tương ứng nếu chuyển sang ES module.

Các case tối thiểu:

- Range tại `0`, cuối video, video ngắn hơn `0.2s` và hai handle gần giao nhau.
- Snap vào/ra khỏi threshold; snap không phá min duration.
- Speed `0.1`, `0.25`, `0.5`, `1`, `1.25`, `2`, `4`, `16`.
- State JSON sai, version cũ, duration nguồn thay đổi.
- HEX/RGB hợp lệ, không hợp lệ và màu gần trùng.

### Manual smoke test sau mỗi giai đoạn

1. `npm start` và gọi `GET /api/health`.
2. Load demo và file local.
3. Kéo hai handle, scrub, nhập start/end, Set Start/End, Reset, Split/Duplicate/Delete.
4. Đổi speed và reload/khôi phục.
5. Generate PNG và WebP với transparent bật/tắt.
6. Preview Anim/Sheet, zoom/pan và eyedropper.
7. Download sprite, audio và bundle; nghe/đo duration audio ở speed chậm và nhanh.

## 5. Rollout và quản lý rủi ro

- Mỗi giai đoạn là một thay đổi độc lập, có thể nghiệm thu trước khi sang giai đoạn tiếp theo.
- Ưu tiên hoàn tất Giai đoạn 0–2 trước; đây là phần ảnh hưởng trực tiếp đến tính đúng của editor và export.
- Giữ fallback cho browser không có `requestVideoFrameCallback`.
- Không cache blob/video data trong `localStorage` để tránh quota và rủi ro dữ liệu lớn.
- Giới hạn recent colors và version hóa persisted state để tránh dữ liệu cũ làm app không khởi động.
- Audio `atempo` ở tốc độ cực trị có thể giảm chất lượng; kiểm thử nghe thực tế tại `0.1x` và `16x`, đồng thời hiển thị cảnh báo nếu cần.
- Filmstrip đang seek trên chính `<video>` preview; nếu vẫn gây nhấp nháy hoặc tranh chấp seek, bước tối ưu tiếp theo là dùng một video element ẩn riêng cho thumbnail generation.

## 6. Mốc bàn giao đề xuất

| Mốc | Phạm vi | Kết quả bàn giao | Ước lượng |
|---|---|---|---:|
| M1 | Giai đoạn 0–1 | Trim mượt, tooltip, snap, realtime seek, test helper | 2–3 ngày |
| M2 | Giai đoạn 2 | Persist speed và audio export đồng bộ | 1.5–2 ngày |
| M3 | Giai đoạn 3 | Settings panel compact/responsive | 1–1.5 ngày |
| M4 | Giai đoạn 4 | Color manager cho chroma key | 1–1.5 ngày |
| **Tổng** |  | Chưa gồm buffer QA | **5.5–8 ngày** |

Nên thêm 15–20% buffer cho kiểm thử browser/video codec/FFmpeg, đưa tổng lịch dự kiến lên khoảng **7–10 ngày làm việc** cho một developer.

## 7. Definition of Done chung

- Tất cả acceptance criteria của giai đoạn đạt trên demo và ít nhất một file local có audio.
- Không phát sinh lỗi console trong flow chính.
- `npm test`, syntax check và `/api/health` đều pass.
- PNG/WebP, transparent on/off, audio riêng và bundle ZIP vẫn tải được.
- Persisted state không làm hỏng lần load khi dữ liệu cũ hoặc malformed.
- UI dùng được bằng chuột, touch/pointer cơ bản và keyboard ở các control mới.
- README và `VIDEO_EDITOR_IMPROVEMENT_SUMMARY.md` được cập nhật nếu hành vi cuối cùng khác quyết định ban đầu.
