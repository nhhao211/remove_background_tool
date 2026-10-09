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
- Giao diện: TailwindCSS v4 build bằng `@tailwindcss/cli` (devDependency), **không** dùng preflight. Output `public/css/tailwind.css` (đã minify) được commit nên chạy app không cần build. Font Inter + JetBrains Mono từ Google Fonts.
- Engine Python tuỳ chọn (`python/`, NumPy + OpenCV) để tinh chỉnh viền chính xác hơn; app vẫn chạy đủ khi không có Python (xem mục 6e).
- Các file chính:
  - `server.js`: static server, upload, audio extraction, ZIP export và cleanup.
  - `public/index.html`: layout, controls, input và các vùng preview.
  - `public/js/app.js`: state, event handlers, trim editor, eyedropper, chroma key, sprite generation, preview và download.
  - `public/js/stroke-mask.js`: rasterize nét bút thành mask 1 byte/pixel; dùng chung cho Subject Protect Brush và Bút Xóa. Mode `add`/`subtract` (tên cũ `protect`/`erase` vẫn đọc được từ localStorage).
  - `public/js/erase-mask.js`: nhân alpha của `ImageData` theo mask của Bút Xóa; tách riêng để test được ngoài browser.
  - `public/js/preview-erase-map.js`: ánh xạ ngược điểm bấm trên khung Preview (sprite sheet) về tọa độ chuẩn hóa của source video, để bôi Bút Xóa thẳng trên Preview. Thuần tuý, không dùng DOM; test bằng `test/preview-erase-map.test.mjs`.
  - `public/js/erase-frames.js`: luật gắn nét Bút Xóa vào từng frame — nét *global* (`frame === null`, bôi trên source video) áp cho cả clip, nét *theo frame* (`frame` + `frameTime`, bôi trên một ô Preview) chỉ áp cho đúng ô đó. Gắn lại theo **thời gian** khi số frame đổi; binding không cứu được thì thành `ORPHAN_FRAME` và không áp ở đâu cả. Thuần tuý, không dùng DOM; test bằng `test/erase-frames.test.mjs`.
  - `public/js/color-grade.js`: panel Color & Detail — exposure/contrast chạy ở linear light (pivot là mid-grey sRGB 128 nên không lệch sáng tổng thể), saturation/vibrance chạy ở gamma space giống Photoshop. Vibrance có trọng số theo độ bão hoà sẵn có nên không cháy màu mạnh. Áp ở full-res, ngay sau color replace.
  - `public/js/sharpen.js`: unsharp mask trên luma, làm mờ có chuẩn hoá theo alpha (`blur(a*Y)/blur(a)`) để không hút màu đen từ vùng trong suốt vào viền. Áp trên từng ô **sau** khi thu nhỏ, tức ở đúng độ phân giải xuất.
  - `public/js/alpha-bleed.js`: loang màu RGB ra các pixel alpha 0 quanh chủ thể để GPU lấy mẫu bilinear không hút màu đen vào viền. Không đụng vào alpha.
  - `public/js/png-encoder.js`: encoder PNG RGBA chạy trong browser (`CompressionStream('deflate')`). Cần thiết vì backing store của canvas là premultiplied: `toBlob`/`putImageData` sẽ xoá sạch màu mà `alpha-bleed.js` vừa ghi ở alpha 0. Đường xuất PNG đi thẳng từ `ImageData` sang encoder này, không quay lại canvas.
  - `public/js/loop-analysis.js`: lõi thuật toán tìm chu kỳ lặp (descriptor 32x32, lag profile/autocorrelation, seam cost có cửa sổ, chuẩn hoá tương phản). Có 3 chế độ khớp frame (`exact` khoá độ dài chu kỳ, `speed` giải lại tốc độ phát, `nearest` chấm điểm mềm) để chu kỳ ra đúng số frame mong muốn. `refineSeamOnFrames()` dời đầu/cuối seam trên từng **frame gốc** (±`searchRadius`), chấm bằng cửa sổ cách nhau đúng một bước *xuất* (trọng số 1-2-1) nên khớp cả vận tốc; cặp gốc luôn được chấm cùng thước và thắng khi hoà, nên tinh chỉnh không bao giờ làm tệ hơn. `seamJumpRatio()` đo cú nối *như lúc phát* (ô cuối → ô đầu so với trung vị bước bên trong): `smooth` / `bump` (>1.3) / `jump` (>1.75) / `hold` (<0.35). `seamResidual()` là thước xếp hạng cuối: seam cost có cửa sổ (1-2-1, cách nhau một bước xuất) chia cho trung vị một bước bình thường của chính loop ⇒ "cú nối lệch X bước" — so được giữa các candidate khác độ dài/tốc độ và giữa các clip (`smooth` ≤0.3, `bump` ≤0.75, còn lại `jump`). `seamQualityScore(r) = exp(−(r/0.55)²)`; `recommendCrossfade(r, N)` ra 0/2/3/4 ô, chặn ở `floor(N/4)` và 6. `LOOP_SCORE_WEIGHTS` (seam 0.50, period 0.18, frameFit 0.22, activity 0.10) dùng chung cho search và scanner. Thuần tuý, không dùng DOM, test bằng `test/loop-analysis.test.mjs`.
  - `public/js/loop-optimizer.js`: phần cần DOM của Auto Loop Finder (seek, capture, chroma key, thumbnail) cộng diff heatmap. `detectFrameGrid(video)` đo lưới frame gốc bằng `requestVideoFrameCallback` (6 điểm rải + 2 điểm sát PTS để chốt độ dài frame); trả `null` khi không có rVFC, tab đang ẩn hoặc video VFR. Scanner lấy mẫu trên frame gốc khi có `options.frameGrid`, tinh chỉnh seam trên frame gốc rồi kiểm tra cú nối trên đúng các frame sheet sẽ chứa; candidate mang thêm `startFrame`/`endFrame`/`spanFrames`/`frameGridFps`/`seamJump`/`pacing`/`seamResidual`/`seamVerdict`/`recommendedCrossfade`. `blendLoopTwin(target, twin, weight, { morph })` trộn một ô với frame "sinh đôi" cách đúng một chu kỳ (linear light) — gọi `dissolveImageData` hoặc `morphBlendImageData` của `seam-morph.js` và trả `{ mode }`; `measureLoopSeam(canvases, { nextFrame })` chấm cú nối trên các canvas đã có sẵn (chỉ đọc các ô cần đo), có `nextFrame` thì trả thêm `residual`. `applyLoopCrossfade` cũ (kéo ô cuối về phía ô đầu, làm loop tua ngược ở seam) đã bị bỏ.
  - `public/js/seam-morph.js`: crossfade bù chuyển động cho seam. Ước lượng độ dời giữa ô và twin bằng Lucas–Kanade kim tự tháp trên ảnh đặc trưng 160 px (alpha + alpha·luma), kiểm tra thuận–nghịch (flow hai chiều không khớp thì bị làm mờ dần về 0), rồi hoà ở **điểm gặp**: với tỷ trọng twin `w`, lấy ô tại `x − w·flow` và twin tại `x + (1−w)·flow`, trộn premultiplied linear light. Flow chỉ được tin khi warp twin theo nó xoá được ≥ 60 % khác biệt (`MIN_GAIN`; đo được: dời thật 0.86–0.95, hai pose không liên quan 0.32–0.43) và độ dời trung bình ≥ 0.5 px; không thì rơi về `dissolveImageData` — **giống hệt từng byte** công thức hoà mờ cũ. Thuần tuý, test bằng `test/seam-morph.test.mjs`.
  - `public/js/frame-grid.js`: lưới frame gốc của video (`frameDuration` + `origin`) và mọi phép quy thời gian ↔ frame. `inferFrameGrid()` suy lưới từ các PTS thật (fit tăng dần từ cặp kề nhau, snap về fps chuẩn như 29.97, fallback thử từng fps chuẩn cho PTS WebM làm tròn mili giây); PTS lộn xộn ⇒ `null`. `planLoopFrames()` lập kế hoạch lấy mẫu theo Bresenham trên frame gốc (`k_i = k0 + round(i·K/P)`, `P = N` với loop kín, `N−1` với loop mở) và trả cả `times` (thời gian logic) lẫn `seekTimes` (giữa frame). `planCrossfadeTwins()` chọn twin, `describePacing()` / `evenPacingFpsOptions()` báo và gợi ý FPS cho nhịp đều. Thuần tuý, không dùng DOM, test bằng `test/frame-grid.test.mjs`.
  - `public/js/keyer/`: module matting dùng chung, có baseline byte-identical trong `test/keyer/`. Không sửa nếu chưa cần; `assertOptions()` chặn option lạ. Region `matchMode: 'edge'` (xem mục 10) được thêm mà không đổi baseline; test ở `test/keyer/edge-match.test.mjs`.
  - `public/js/sprite-remover.js`: tab Clean Sprite Sheet (upload ảnh tĩnh, keyer connected, Edge Refine, pick màu trên Original/Result, export).
  - `public/js/region-key.js`: hạ alpha của pixel vừa nằm trong một vùng tròn/elip vừa khớp màu người dùng pick. Nằm **ngoài** `keyer/` giống `erase-mask.js` — không đụng whitelist option, không đụng baseline. Toạ độ vùng chuẩn hoá 0..1 theo source, cùng hệ với nét Bút Xóa, nên đi qua cùng một phép ánh xạ crop. Thuần tuý, test bằng `test/region-key.test.mjs`.
  - `public/js/region-cells.js`: tick `Áp dụng cho mọi frame` của vùng tròn ở tab Clean Sprite Sheet — nhân một vùng ra mọi ô của lưới sprite ở cùng vị trí tương đối, mỗi bản bị chặn trong ô của nó. Thuần tuý, test bằng `test/region-cells.test.mjs`.
  - `public/js/region-overlay.js`: phần tương tác của vùng tròn (vẽ, hit-test, dời, đổi kích thước, vẽ vành nét đứt) dùng chung cho **bốn** bề mặt ở hai tab. Caller chỉ cung cấp `toSource` / `toCanvas` / `scaleToCanvas`; phần hình học thuần tuý test bằng `test/region-overlay.test.mjs`.
  - `public/js/subject-guard.js`: Subject Guard — pass sau keyer (cả direct lẫn connected) trả lại phần chủ thể bị keyer lấy mất chỉ vì màu gần màu nền: lỗ thủng giữa thân và khối gần-màu-key dày dính vào thân. Quyết định bằng **hình dạng** chứ không bằng màu. Nằm **ngoài** `keyer/` giống `edge-refine.js`. Thuần tuý, test bằng `test/subject-guard.test.mjs`.
  - `public/js/edge-refine.js`: Edge Refine — pass sau keyer, ước lượng lại alpha và màu của dải viền từ ảnh gốc (unmix F/B, fallback color-difference, làm mịn, khử màu nền). Nằm **ngoài** `keyer/` giống `erase-mask.js` để không đụng baseline/whitelist. Thuần tuý, test bằng `test/edge-refine.test.mjs`.
  - `public/js/sidebar-sections.js`: gấp/mở các `.cleaner-control-section` ở sidebar của Clean Sprite Sheet và Sprite Reframer. Markup chỉ cần tiêu đề `.cleaner-section-title`; phần thân được bọc vào `.cleaner-section-body` ngay lúc init nên thêm section mới không phải thêm div. Mặc định gấp đặt bằng `data-collapsed="true"`, khoá nhớ trạng thái lấy từ `data-section-key`, lưu ở `localStorage`. Khác với `.collapsible-section` trong `app.js`: bên đó mỗi section có markup và id riêng, bên này các section đồng dạng nên xử lý bằng một vòng lặp.
  - `public/js/sprite-transform-math.js`: lõi toán học thuần túy của tab Sprite Transform (tính bounding box, anchor pivot 3x3, scale X/Y, offset X/Y, match Frame 1 height, phát hiện clipping và circle crop params). Thuần túy, không dùng DOM, test bằng `test/sprite-transform-math.test.mjs`.
  - `public/js/panel-visibility.js`: registry của các khung chức năng bật/tắt được ở tab Video → Sprite (id panel → danh sách id phần tử DOM), cộng phần đọc/ghi/chuẩn hoá trạng thái. Thuần tuý, không dùng DOM; phần wiring (dialog, hook tắt công cụ) nằm ở `app.js`. Test bằng `test/panel-visibility.test.mjs` — test này đọc `public/index.html` để chứng minh mọi id trong registry thật sự tồn tại trong markup.
  - `public/js/sprite-transform.js`: controller UI của tab Sprite Transform (lưới 4 cột 6 hàng, stage canvas tương tác kéo thả toạ độ trực tiếp, preview animation, 3 view modes, circle crop, export PNG/WebP).
  - `public/css/style.css`: giao diện và trạng thái tương tác.
    - **Không** được link trực tiếp: `index.html` import nó vào cascade layer `legacy` bằng một `<style>` inline (`@import url("css/style.css") layer(legacy)`), nên sửa file này không cần build lại CSS.
  - `public/css/tailwind.src.css`: entry của Tailwind. Thứ tự layer `properties, theme, base, legacy, components, utilities` — câu `@layer` này được lặp lại y hệt trong `<style>` của `index.html` và **hai chỗ phải khớp nhau** (khai báo đầu tiên chốt thứ tự). Utility luôn thắng rule của `style.css` bất kể specificity; rule `!important` trong `legacy` (ví dụ `.header-actions[hidden]`, `.panel-hidden`) vẫn thắng utility. Khối `@layer legacy { … }` cuối file là "modern skin": đổi token màu (`--bg-main`, `--accent-blue` …), gradient cho nút `.btn-primary-*`, card, form focus ring, toast, modal — cùng layer với `style.css` nhưng đứng sau nên thắng khi bằng specificity.
    - Không có preflight nên `<button>` dùng class utility phải tự thêm `border-0 bg-transparent cursor-pointer font-sans`, nếu không sẽ hiện nền/viền xám mặc định của trình duyệt.
    - Tailwind quét class trong `public/index.html` và `public/js/**`. Thêm class utility mới ở đó thì **phải** chạy `npm run build:css` (hoặc `npm run watch:css` khi dev) rồi commit `public/css/tailwind.css`; class chưa build sẽ không có tác dụng.
    - Header (logo, tab segmented dùng biến thể `aria-selected:`, `#videoHeaderActions`) viết hoàn toàn bằng utility. Id, `role`, `aria-selected`, `aria-controls` của tab giữ nguyên vì code chuyển tab dựa vào chúng.
  - `public/css/tailwind.css`: output build, đừng sửa tay.
  - `public/js/python-engine.js`: client của engine Python — chuẩn hoá setting (`normalizePythonSettings`, bật chỉ khi giá trị lưu đúng là `true`), đóng/mở gói nhị phân gửi `/api/python/matte`, `fetchPythonStatus()` (có cache), `pythonRefine(original, keyed, options)` và `mountPythonMattingPanel()` dựng panel bằng Tailwind (dùng chung cho hai tab). Phần thuần tuý test bằng `test/python-engine.test.mjs`.
  - `python-bridge.js`: giữ **một** process `python/worker.py` sống lâu, nói chuyện qua stdin/stdout bằng frame có tiền tố độ dài. Chỉ khởi động ở request đầu tiên; worker crash thì request đang chờ bị reject và request sau tự mở worker mới; thiếu interpreter/numpy/OpenCV thì trả về trạng thái "không có" chứ không throw lúc khởi động server. `PYTHON_BIN` chọn interpreter (mặc định `python3`, Windows `python`). Chunk stdout chỉ được gom lại rồi ghép **một lần** khi đủ frame (ghép lại mỗi chunk 64 KB là O(n²), chặn event loop vài giây với frame 4K). `request(header, payload, { signal })` bỏ request đã bị huỷ khi nó còn đang chờ trong hàng đợi; `/api/python/matte` huỷ khi client đóng kết nối, và tab Cleaner abort request của lần chạy cũ (`state.pythonAbort`) nên kéo slider không dồn hàng chục lượt refine. Test: `test/python-bridge.test.mjs` (test cần Python tự skip khi máy không có numpy + OpenCV).
  - `python/rmbg/matting.py`: lõi precision matting (`refine_matte`, `remove_background`). Chi phí của `refine_matte` phải theo **độ dài viền**, không theo kích thước frame: trimap so sánh trên byte alpha, plate lấy bằng `fill_plate(..., at=(ys, xs))` (không dựng plate full-res), alpha/unmix/despill chạy trên mảng 1-D của dải viền, guided filter float64 chỉ chạy trên các tile 128 px có dải viền (`_guided_filter_where`, đệm `2r+1` nên kết quả bằng lọc toàn ảnh). Đừng quay lại tạo mảng float full-frame — ảnh 4096² từng tốn 8 GB RAM và làm treo máy. `python/rmbg/protocol.py`: framing. `python/worker.py`: vòng lặp worker (`ping`, `refine`, `key`). `python/remove_bg.py`: CLI dùng cùng engine ngoài trình duyệt (ảnh, thư mục ảnh, hoặc video → frame/sheet). Test Python ở `python/tests/` (`npm run test:python`).
    - Layout gọn của tab Video → Sprite nằm trong khối `Video → Sprite — compact layout` ở cuối file, mọi selector scope trong `#videoWorkspace` để không đụng 3 tab kia. Sidebar chia thành `.sb-section` (tiêu đề `.sb-heading`, field phẳng, `.sb-inline` = nhãn trái / input phải); section tự ẩn khi mọi panel con mang `.panel-hidden`. `#groupChromaKey` đứng đầu panel chroma, chia 2 cột `.ck-layout` (màu key | định dạng xuất + vùng tròn). Đoạn giải thích dài bọc trong `<details class="help-details">`.
    - Có `#videoWorkspace [hidden] { display: none !important }`: rule `display` của author thắng `[hidden]` của UA, nên thiếu dòng này thì `#regionControls` hiện ra dù đang `hidden`.
    - Các nút trùng chức năng (`#btnVideoPlayPause`, `#videoCurrentTimeDisplay`, `#btnBrowseFile`, `#lblSpeedSettings`, `#activeFilenameLabel`) vẫn còn trong DOM với `hidden` vì `app.js` còn cập nhật chúng; đừng xoá. Đổi thứ tự hiển thị thì cập nhật `applyTabOrder()` trong `app.js`.
  - `public/samples/sample_blue_flower.mp4`: video demo, load khi bấm `Load Demo Video`.

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
- `npm run build:css` build lại `public/css/tailwind.css` từ `tailwind.src.css`; `npm run watch:css` build liên tục khi dev. Chỉ cần khi thêm/đổi class Tailwind; sửa `style.css` thì không cần.
- Engine Python (tuỳ chọn): `pip install -r python/requirements.txt` (Python 3 + `numpy` + `opencv-python-headless`). Không cài thì panel Python báo "không có" và mọi thứ chạy bằng JS như cũ. `npm run test:python` chạy test của `python/tests/`.
- `npm test` chạy `node --test 'test/**/*.test.{mjs,js}'`. Repo không có lint. Khi thay đổi code, tối thiểu kiểm tra cú pháp bằng `node --check server.js` và `node --check public/js/app.js`, chạy `npm test`, sau đó chạy server và gọi `GET /api/health`.
- Không commit `uploads/`, `temp/`, `__pycache__/`, `.venv/` hoặc các file phát sinh khi chạy local.

## Danh mục đầy đủ chức năng hiện có

### 1. Nạp video

- Nút `Load Demo Video` load video mẫu `/samples/sample_blue_flower.mp4` (app không tự load khi khởi động).
- Chọn file qua nút `Browse` ở action bar hoặc trong drop zone.
- Kéo thả video ở cấp toàn trang, tại source-video viewport hoặc tại drop zone; có overlay báo vị trí thả.
- Chấp nhận video theo MIME `video/*` hoặc phần mở rộng `.mp4`, `.webm`, `.mov`, `.avi`, `.mkv`, `.m4v`, `.ogv`, `.flv`.
- Hiển thị tên file, kích thước native và thời lượng sau `loadedmetadata`.
- Tên file được dùng để gợi ý `Download name`.
- Tạo object URL cho file local và revoke object URL cũ khi load file mới.
- Video bị trình duyệt coi là cross-origin (canvas "tainted" — thường do service worker của project khác trên cùng port localhost, proxy/tunnel hoặc extension) thì mọi `getImageData` trên video đều throw. Ở `loadeddata`, `recoverTaintedVideo()` thử đọc 1 pixel; nếu bị chặn thì `rehostVideoAsBlob()` nạp lại **cùng dữ liệu** dưới dạng `blob:` URL (luôn same-origin, service worker không chặn được) mà không reset clip state (`state.rehostingVideo` làm `loadedmetadata` bỏ qua), rồi vẽ lại filmstrip. Generate gọi `ensureReadableVideo()` trước tiên; vẫn không đọc được thì báo lỗi kèm cách khắc phục thay vì lỗi `getImageData` thô. Thêm chỗ đọc pixel video mới thì đừng tự tạo canvas probe dùng lại: canvas đã tainted thì tainted vĩnh viễn.

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

### 6b. Bút Xóa (Erase Brush)

- Bôi trực tiếp trên Source Video để xóa hẳn vùng nền còn sót hoặc chi tiết thừa mà chroma key không xử lý được.
- Bôi được **cả trên khung Preview** (sprite sheet đã tạo), ở cả chế độ `Anim` và `Sheet`, sau khi đã Generate. Overlay `#previewEraseCanvas` phủ lên `#previewCanvas` và bám theo zoom/pan vì bám `getBoundingClientRect()` (đã gồm CSS transform); `applyTransform()` gọi lại `updatePreviewEraseOverlay()`.
- Hai tool: `Erase` (bôi để xóa) và `Restore` (bôi để khôi phục); giữ `Alt` đảo chiều tạm thời trong một nét.
- `Size` 5–500 px, `Strength` 0–1, `Hardness` 0–1; phím `[` / `]` đổi size (`Shift` để nhảy bước lớn), `Esc` thoát.
- Có vòng tròn hiển thị cỡ bút bám theo con trỏ; `Show mask` bật/tắt lớp phủ đỏ, không ảnh hưởng kết quả xuất.
- `Undo` / `Redo` / `Clear` với stack tối đa 100 action; `Clear` cũng undo được.
- Nét vẽ lưu ở tọa độ chuẩn hóa 0..1 của source video nên bám nội dung video kể cả khi đổi crop/cell size; lưu theo từng clip trong localStorage.
- Có **hai loại nét**: nét bôi trên Source Video áp cho **mọi** frame; nét bôi trên một ô của Preview chỉ áp cho **đúng ô đó** — hoạt động như Eraser trong Paint, để dọn chi tiết thừa của riêng một frame.
- Hàng `Bôi trên Preview:` (`#btnEraseScopeFrame` / `#btnEraseScopeAll`) chọn phạm vi mặc định cho nét vẽ trên Preview; `state.eraseScope` (`'frame' | 'all'`) được lưu trong localStorage. Giữ `Shift` lúc `pointerdown` đảo phạm vi tạm thời cho một nét (giống cách `Alt` đảo Erase/Restore).
- Thứ tự vẽ được giữ nguyên: `strokesForFrame()` trả về danh sách đã lọc (global xen kẽ với nét của riêng frame đó) nên một nét `Restore` theo frame vẫn xoá được phần một nét `Erase` global đã phủ lên.
- Erase chạy **sau** keyer như một bước compositing (nhân alpha), không phải một option của keyer — nên vẫn hoạt động khi tắt `Transparent WebP/PNG`.
- Khi bật Subject Alignment, mask được áp ở full-resolution **trước** `detectSubjectBounds` để chi tiết bị xóa không kéo lệch canh chủ thể.
- Sau khi đã Generate, app cache bản frame trước-khi-xóa (`state.rawFrames`) và áp lại mask ngay vào preview mà không cần seek lại video; vượt ngưỡng `LIVE_ERASE_PIXEL_BUDGET` (120e6 pixel) thì bỏ cache và hiện toast nhắc nhấn `Generate`.
- Overlay mask được cache theo `eraseMaskRevision`; mọi thay đổi `state.eraseStrokes` phải gọi `markEraseStrokesChanged()`, nếu không preview sẽ đứng ở mask cũ.

**Bôi trên khung Preview — chi tiết:**

- `state.sheetLayout` (cellW/cellH/cellsAcross/cropX/cropY/cropWidth/cropHeight) và `state.frameOrigins` (điểm `sourceX`/`sourceY` thật của từng frame) được ghi ở **cả hai** nhánh của Generate — có và không có Subject Alignment — vì cả hai đều cần cho ánh xạ ngược. Chỉ phần cache `state.rawFrames` là vẫn chỉ chạy khi tắt alignment. `discardLiveEraseCache()` phải xóa luôn `state.frameOrigins`.
- `mapPreviewPointToSource()` trong `preview-erase-map.js` đi từ pixel trên canvas preview → ô (cell) → gốc crop của đúng frame đó → tọa độ chuẩn hóa 0..1 của source video. Nét từ Preview vì thế vẫn nằm cùng **hệ toạ độ** với nét từ Source Video; thứ duy nhất khác là cái binding đi kèm nó, nên mọi thứ phía sau `state.eraseStrokes` (export, undo/redo, localStorage, re-apply live) chỉ cần hỏi `erase-frames.js` xem nét có thuộc frame đang xử lý không.
- Binding nằm ngay trên nét: `frame` (chỉ số ô) và `frameTime` (giây trong video). `normalizeStroke()` trong `stroke-mask.js` mang hai field này qua localStorage; cẩn thận với `Number(null) === 0` — thiếu binding phải trả `null`, nếu không mọi nét global sẽ hoá thành nét của frame 0.
- `state.frameTimes` (ghi cuối mỗi lần Generate, xoá trong `discardLiveEraseCache()`) là danh sách timestamp của sheet hiện tại. Đổi Rows/Cols hay FPS rồi Generate lại: nét được gắn lại vào frame có timestamp gần `frameTime` nhất, không gắn theo chỉ số. Vì strokes không đổi nên `eraseMaskRevision` cũng không đổi — Generate phải tự gọi `markEraseStrokesChanged()` ở cuối, nếu không lớp phủ đỏ đứng ở binding cũ.
- `makeEraseMaskProvider(geometry, frameCount, frameTimes)` trả về `(frameIndex) => mask`: frame không có nét riêng dùng chung một mask global rasterize **một lần**; chỉ frame nằm trong `plan.frameIndices` mới trả giá rasterize riêng. Dùng ở cả Generate (`eraseMaskFor` cho ô đã thu nhỏ, `eraseMaskFullFor` cho full-res trước `detectSubjectBounds`) lẫn `reapplyEraseMaskLive()`. Trong Generate, `timestamps` phải được tính **trước** khối tạo mask.
- Số cột lấy từ `layout.cellsAcross` (lưới đã dựng), không lấy từ ô nhập Rows/Cols — người dùng có thể đổi số đó sau khi Generate.
- `state.eraseSurface` (`'video' | 'preview'`) quyết định handler nào sở hữu nét đang vẽ; `state.eraseStrokeCell` ghim ô lúc `pointerdown` và `clampPixelToStrokeCell()` kẹp mọi điểm sau đó vào ô đó — nếu không, kéo bút sang ô bên cạnh sẽ nhảy qua mép crop và vạch một đường ngang mask.
- Không cho bắt đầu nét trên các ô trống ở cuối hàng cuối (`frameIndex >= state.generatedFrames.length`): chỗ đó không hiện gì, mà nét vẽ ở đó hoặc xóa thật trên mọi frame (phạm vi `all`) hoặc thành nét mồ côi (phạm vi `frame`).
- Pan bằng chuột trái bị chặn khi bút đang bật (`spriteViewport` mousedown guard) vì `pointerdown` không chặn được `mousedown`; lúc đó pan bằng chuột giữa/phải, và `contextmenu` trên overlay bị chặn.
- Lớp phủ đỏ trên Preview được rasterize ở đúng cỡ ô trên màn hình (làm tròn bước 32 px) và cache theo `(revision, tileWidth, tileHeight, originKey, scopeKey)`: một tile `shared` cho phần global cộng một tile riêng cho mỗi ô có nét của nó. Vì mỗi ô có thể thành một tile nên tổng bị chặn bởi `PREVIEW_TINT_PIXEL_BUDGET` (24e6 pixel) rồi thu nhỏ theo `Math.sqrt`.
- `updatePreviewViewport()` → `applyTransform()` → `updatePreviewEraseOverlay()` chạy **mỗi tick animation**, nên ở chế độ `Anim` chỉ khi đang dừng (`animFrozen`) mới rasterize tile của ô hiện tại; lúc đang phát chỉ vẽ tile `shared` (`scopeKey = 'anim:playing'`) — vẫn đúng với mọi frame, và phần xóa theo frame đã nằm sẵn trong pixel của frame rồi.
- Lớp phủ **không hiện** ở chế độ `Sheet` khi bật alignment vì mỗi ô cắt từ một cửa sổ khác nhau nên một tile không thể đúng cho tất cả; khi bật alignment và đang phát cũng bỏ qua. Bôi vẫn ánh xạ đúng, banner nói rõ điều đó.
- Overlay trên Source Video vẽ hai lớp: nét global đậm bình thường, nét theo frame mờ hơn (`globalAlpha = 0.4`) trong `eraseOverlayCache.framedCanvas` — chúng không áp cho khung video đang xem nhưng vẫn cần thấy được là chúng tồn tại.
- Banner Preview cho biết nét sắp vẽ thuộc phạm vi nào (`Chỉ frame #N/total · Shift = mọi frame` hoặc ngược lại) và ở chế độ `Sheet` có khung nét đứt đỏ quanh ô đang trỏ tới.


### 6c. Vùng tròn + Pick màu (Circle region + colour pick)

Giải quyết đúng một chuyện mà pick màu toàn ảnh không làm được: xoá một màu **chỉ ở một chi tiết**, khi màu đó cũng có trên áo/da nhân vật ở chỗ khác. Đo trên sheet mẫu: xoá một chi tiết 1 936 px bằng pick thường làm hỏng thêm 12 392 px khác của nhân vật; bằng vùng tròn thì **0** pixel nào ngoài vòng tròn bị đụng tới.

- **Vòng tròn là phạm vi ĐƯỢC PHÉP xoá, không phải mặt nạ bảo vệ.** Cách đọc ngược lại là cách đọc tự nhiên hơn và là cách làm người dùng tưởng tool hỏng, nên banner nói thẳng điều này.
- Kéo **từ tâm ra** (tâm là nơi con trỏ đã ở sẵn, vì người dùng đang nhìn thẳng vào chi tiết cần xoá). Giữ `Shift` ép tròn đều — hiệu chỉnh theo aspect của source nên tròn *trên màn hình*, không phải tròn trong hệ chuẩn hoá.
- **Hai bước có thứ tự: vẽ vòng tròn trước, pick màu sau.** Vẽ xong thì vào chế độ `edit` chứ không nhảy thẳng sang `pick` — vòng tròn hiếm khi đúng ngay từ cú kéo đầu, nên người dùng được dời/đổi bán kính trước khi gán màu. Bước 2 là nút `Pick màu trong vùng` (`#btnRegionPickColor` / `#btnSpriteRegionPickColor`), nút `Vẽ vùng mới` quay lại bước 1. `setRegionMode('pick')` tự hạ về `edit`/`draw` khi chưa có vùng nào được chọn: không có vòng tròn thì cú click chỉ lấy màu rồi không biết bỏ vào đâu.
- **Vòng tròn chỉ hiện khi tool đang bật.** `render()` của overlay clear canvas và return ngay khi `mode === 'off'`, và `updateVideoRegionOverlay` / `updatePreviewRegionOverlay` chỉ bật `.visible` khi `regionToolArmed()`. Nét đứt nằm lại trên sprite sheet đã xong thì bị đọc nhầm là một phần của ảnh.
- Bốn bề mặt vẽ được: `Source Video` (`#regionOverlayCanvas`) và khung `Preview` (`#previewRegionCanvas`) ở tab Video → Sprite; `Original` và `Transparent result` (`#spriteRegionOverlayOriginal` / `#spriteRegionOverlayResult`) ở tab Clean Sprite Sheet. Cả bốn đều bám `getBoundingClientRect()` (đã gồm CSS transform) nên zoom/pan không cần code riêng.
- Slider `Tolerance` / `Softness` / `Despill` và checkbox `Chỉ vùng liền kề` áp cho **vùng đang chọn**. `Chỉ vùng liền kề` chạy BFS 8 hướng từ điểm pick, hàng đợi `Int32Array` cỡ bounding box, và không bao giờ ra khỏi ellipse.
- Vùng vẽ trên Source Video áp cho **mọi** frame; vẽ trên một ô Preview mặc định chỉ áp cho **đúng ô đó**. Hàng `Vẽ trên Preview:` (`#btnRegionScopeFrame` / `#btnRegionScopeAll`, lưu ở `state.regionScope`) đặt mặc định, giữ `Shift` lúc `pointerdown` đảo phạm vi cho một vùng — đúng thoả thuận `Alt` với Erase/Restore.
- Binding dùng lại **nguyên** `erase-frames.js`: `frame` + `frameTime`, gắn lại theo **thời gian** khi số frame đổi, binding hỏng thành `ORPHAN_FRAME` và không áp ở đâu cả. Cẩn thận `Number(null) === 0` như ghi chú ở `stroke-mask.js`: `frame`/`frameTime` thiếu phải là `null`, nếu không mọi vùng global hoá thành vùng của frame 0.
- Màu **luôn** lấy từ ảnh gốc (`video` ở tab Video, `state.original` ở tab Cleaner), không lấy từ Result: pixel Result đã bị nhân alpha và có thể đã khử màu nền, không phải màu mà matcher sẽ so sánh.
- Vị trí pipeline ở tab Video: `runKeyer → (python) → subjectGuard → colorReplace → colorGrade → region → erase → (detectSubjectBounds) → crossfade → sharpen`. Region đứng trước `detectSubjectBounds` vì đúng lý do của Bút Xóa: chi tiết đã xoá không được kéo lệch canh chủ thể. Không gate theo `chkTransparentFormat` — đây là lệnh xoá tường minh.
- `makeRegionProvider(frameCount, frameTimes)` trả `(frameIndex) => regions|null`, rẻ hơn `makeEraseMaskProvider` nhiều vì vùng không phải rasterize (chỉ lọc danh sách, không cache). Không có vùng nào ⇒ trả `null` ⇒ mỗi frame đi đúng đường cũ, output **giống hệt từng byte**.
- `reapplyEraseMaskLive()` đã đổi tên thành `reapplyLocalEditsLive()` và áp cả hai theo thứ tự `region → erase`; `state.rawFrames` giờ là bản "trước vùng **và** trước erase". Nhờ vậy kéo `Tolerance` của một vùng cập nhật preview ngay, không seek lại clip (vẫn chỉ khi tắt Subject Alignment).
- `saveClipState()` lưu `colorRegions` + `regionScope`, `schemaVersion` 4 → 5; clip schema 4 đọc lại vẫn chạy, thiếu `colorRegions` ⇒ `[]`. Vùng hỏng bị `normalizeRegions()` bỏ, không throw.
- Trên Preview, một vùng được vẽ lại ở **mọi ô nó áp dụng**: `previewSurfaceRegions()` sinh một bản copy cho từng ô, id ghép `id@@frameIndex` để một cú kéo biết nó đang nắm bản nào. Overlay chỉ làm việc trong *surface space* (canvas chuẩn hoá 0..1); chuyển đổi sang toạ độ source nằm gọn ở `previewRegionToSurface` / `previewSurfaceToSource` / `surfaceRadiiToSource`.
- Pan chuột trái của `spriteViewport` bị chặn khi tool đang bật (`mousedown` guard, vì `pointerdown` không chặn được `mousedown`); pan bằng chuột giữa/phải. Không cho vẽ trên các ô trống ở cuối hàng cuối.
- **Giới hạn đã biết:** nhân vật di chuyển thì vòng tròn đứng yên (đúng giới hạn Bút Xóa đang có). Lối ra: vẽ vùng riêng cho từng ô trên Preview, hoặc vẽ rộng hơn rồi siết bằng `Tolerance` + `Chỉ vùng liền kề`.
- Bất biến của `applyRegionKeys()`: alpha **không bao giờ tăng**; không đọc/ghi ngoài bounding box của vùng (`test/region-key.test.mjs` chứng minh bằng `Proxy` bắt mọi truy cập); vùng không bật/không có màu/hình suy biến là no-op byte-identical.

### 6d. Subject Guard (giữ thân chủ thể)

Cả hai keyer phán theo khoảng cách màu tới key, nên không phân biệt được áo navy với màn xanh: keyer direct (video) đục lỗ ngay giữa thân, keyer connected (sheet) chỉ cần một khe hở trên viền là flood tràn vào trong. Subject Guard là pass chạy **sau** keyer, đọc ảnh gốc, phân loại những gì keyer đã xoá thành ba loại và chỉ giữ loại đầu là nền:

1. **Nền thật.** Pixel gần key đúng bằng mức nền của chính frame đó. Tolerance không lấy từ slider Similarity mà đo từ nền đã chắc chắn: P90 khoảng cách-tới-key của pixel đã xoá và chạm được từ biên, `P90·1.3 + 0.006`, tối đa 0.4, không có mẫu thì 0.03. Chạm được từ biên, hoặc là túi kín đủ lớn (≥ `minPocket`, ví dụ khe giữa tay và thân), thì giữ là nền.
2. **Lỗ thủng.** Pixel bị xoá mà biên không chạm tới được, qua một phép opening `leakGuard` px (erode → flood 4 hướng từ biên → dilate lại), nên khe hở hẹp hơn `2·leakGuard+1` px trên viền không được tính là đường đi. Túi nền đủ lớn bên trong vẫn giữ là nền. Phần còn lại được trả lại.
3. **Khối dày gần màu key.** Pixel chạm được từ biên nhưng xa key hơn nhiễu của nền, sau opening bán kính `floor(minThickness/2)` vẫn còn, **và** dính vào pixel đặc hoặc lỗ vừa trả lại (ví dụ ống quần jeans chạm biên ảnh). Viền anti-alias, sợi mảnh bị opening loại, còn khối đứng riêng (bóng đổ ở góc) không dính vào thân nên cũng không được trả lại.

- Ghi lại theo khoảng cách tới phần vẫn là nền: pixel sát nền giữ nguyên output keyer (viền mềm của keyer là thứ chạm vào nền), pixel kế tiếp lấy nửa, sâu hơn thì lấy lại alpha **và màu** gốc. Bên trong thân (cách nền > `EDGE_BAND` = 2 px), phần đã bị despill cũng được trả lại màu gốc nên thân không bị bạc màu hay ám màu. Pixel được trả lại thì khoảng cách đi xuyên qua pixel không-đặc, băng 1 px.
- Chỉ dùng **một** tolerance chung cho cả frame, không tách theo từng key. Tách theo key đã được thử: một màu của chủ thể tình cờ nằm gần key thứ hai (thêm vào cho bóng gradient) sẽ thừa hưởng độ trải rộng của key đó và không bao giờ được trả lại. Cách này tệ hơn trên mọi cảnh có bóng và không tốt hơn ở cảnh nào.
- Control: `Subject Guard` bật/tắt (mặc định **tắt** ở cả hai tab), `Strength` 0–1 (mặc định 0.5, `minThicknessFor(s) = round(3 + (1−s)·13)`, tức 16 px ở 0 và 3 px ở 1), `Leak guard` 0–3 (mặc định 1). `luminanceWeight` lấy từ `Subject Protection` theo cùng công thức keyer dùng (`luminanceWeightFor`), nên "gần key" có cùng nghĩa với cả hai pass.
- Tab Video → Sprite: panel `#panelSubjectGuard` trong khung chroma (registry id `subject-guard`). Pipeline: `runKeyer → (python) → subjectGuard → colorReplace → colorGrade → region → erase → (detectSubjectBounds) → crossfade → sharpen`. Gọi qua `keyFrameGuarded()`, dùng cả trong Generate lẫn `autoDetectSubjectGuideline`. Không chạy khi tắt `Transparent WebP/PNG` hoặc không có key color (`buildSubjectGuardOptions()` trả `null`). Auto Loop Finder vẫn gọi `runKeyer` trần, vì descriptor so khớp chuyển động, không phải chất lượng matte.
- Tab Clean Sprite Sheet: section `#spriteSubjectGuardSection`, chạy giữa keyer và Edge Refine (`state.keyed → applySubjectGuardPass → state.guarded → applyEdgeRefine`). Dùng `state.lastKeyColors`, `state.seedPoints` (điểm pick nền tường minh luôn là nền, dù nằm sau khe hở) và `minPocket: 1`: sprite sheet là ảnh sạch, không nhiễu, nên mọi túi màu key kín bên trong đều là nền thật. Bật `Analyze each sprite cell` thì chạy riêng từng ô qua `rect`. Kéo slider chỉ chạy lại guard → refine → region trên `state.keyed` đã cache (debounce 80 ms). Trạng thái Result ghi thêm `· subject guard giữ lại N px`.
- Lưu trong clip state: `subjectGuardEnabled`, `subjectGuardStrength`, `subjectGuardLeak`. `schemaVersion` vẫn là 5; clip thiếu field ⇒ tắt (Strength/Leak lấy giá trị mặc định); clip đã lưu `subjectGuardEnabled: true` vẫn bật.
- **Giới hạn đã biết:** nếu chỉ pick một sắc của nền có bóng đổ, keyer có thể để lại một vòng kín của phần bóng chưa xoá, và guard sẽ coi phần bên trong vòng là lỗ thủng rồi trả lại. Lối ra: pick thêm màu của bóng (2–3 sắc đo được 0 lỗ, không tăng rò), đánh dấu điểm nền (Cleaner), hoặc tắt Subject Guard.
- Bất biến của `applySubjectGuard()`: alpha **không bao giờ giảm** và không vượt alpha gốc; không đọc/ghi ngoài `rect`; không có key color, hoặc keyer không xoá/đổi gì ⇒ output **giống hệt từng byte**; tắt checkbox ⇒ pipeline đi đúng đường cũ, byte-identical.

### 6e. Python Precision Matting (tuỳ chọn)

Keyer JS quyết định *cái gì* là nền chỉ từ khoảng cách màu, từng pixel một — nhanh và đúng cho việc quyết định, nhưng ước lượng kém hai thứ mà viền thật sự cần: **alpha** (cùng một pixel trộn 50 % ra alpha khác nhau tuỳ màu chủ thể cách key bao xa; nền gradient thì màu key sai ở chỗ xa điểm pick) và **màu** (despill kẹp channel key nên lệch hue của mọi pixel hơi xanh ở viền). Engine Python giữ nguyên quyết định của keyer JS và chỉ ước lượng lại **dải viền**:

1. Trimap từ matte của keyer: chắc chắn chủ thể (`α ≥ 0.985`), chắc chắn nền (`α ≤ 0.015`), mỗi loại erode `band` px; phần còn lại là dải unknown.
2. Plate nền và plate chủ thể **cục bộ**, đẩy từ các pixel chắc chắn lân cận vào dải (pyramid push-pull) — màu nền ở một pixel viền là màu nền ngay sát nó, nên gradient, vignette, bóng đổ không còn kéo lệch alpha.
3. Alpha bằng phép chiếu `I − B` lên `F − B` (nghiệm đóng của phương trình compositing cho một pixel); chỗ F và B quá giống nhau thì rơi về alpha của keyer.
4. Guided filter màu bám cạnh trên dải (`Làm mịn`), để alpha đi theo cạnh của ảnh chứ không theo nhiễu của ước lượng từng pixel.
5. Màu chủ thể bằng cách unmix `F = (I − (1−α)B) / α` với nền cục bộ, rồi despill nhẹ (`Khử ám màu`) **chỉ trên dải**. Pixel chắc chắn-chủ-thể giữ màu của keyer JS từng byte.
6. Dọn dẹp tuỳ chọn, mặc định tắt: bỏ đốm chủ thể nhỏ hơn `Bỏ vụn` px, lấp lỗ kín nhỏ hơn `Lấp lỗ` px.

Thuần NumPy + OpenCV, không mạng, không tải model.

- **Luồng:** browser gửi `original RGBA + keyed RGBA` dạng nhị phân (`u32le headerLen | header JSON | payload`) tới `POST /api/python/matte` → `python-bridge.js` chuyển nguyên body cho worker → worker trả `RGBA` đã tinh chỉnh + `stats` (`bandPixels`, `changedPixels`, `islandPixels`, `holePixels`, `skipped`). Không có base64, không có JSON chứa pixel.
- **Tab Video → Sprite:** panel `#panelPythonMatting` (mount bằng `mountPythonMattingPanel`, id control có tiền tố `videoPython…`, registry id `python-matting`). Chỉ chạy khi panel bật **và** bật `Transparent WebP/PNG` **và** có key color — giống điều kiện của Subject Guard. `buildPythonSession()` kiểm tra trạng thái một lần cho mỗi lần Generate; `keyFrameRefined()` chạy `runKeyer → pythonRefine → applySubjectGuard` cho từng frame full-res trong `renderCell()` (nên frame twin của crossfade cũng đi qua). Một frame lỗi thì frame đó dùng kết quả JS và đếm `failed`; Python mất kết nối (503/404/network) thì phần còn lại của lần Generate bỏ qua Python. Cuối Generate panel ghi `python tinh chỉnh X / Y px viền · N frame`, có lỗi thì thêm toast. Auto Loop Finder và `autoDetectSubjectGuideline` vẫn chỉ dùng JS.
- **Tab Clean Sprite Sheet:** section `#spritePythonSection` (`#spritePythonMount`, tiền tố `spritePython…`, layout `compact`). `runProcessing()` lưu kết quả keyer vào `state.jsKeyed` rồi `applyPythonPass()` → `state.keyed`; kéo slider Python chỉ chạy lại `rerunFromPython()` (Python → guard → Edge Refine → region) trên `state.jsKeyed` đã cache, không chạy lại flood fill. Token `state.pythonRun` bỏ kết quả của lần chạy cũ về trễ (đổi ảnh, Reset, kéo slider liên tục). Lỗi ⇒ dùng `state.jsKeyed`, report đỏ + toast. Trạng thái Result ghi thêm `· python tinh chỉnh …` trước phần guard. Sheet pixel art (alpha 0/255) nên tắt Python hoặc để `Làm mịn` = 0.
- **Setting là của máy, không của clip:** lưu localStorage `video-editor:python-matting` (tab Video) và `cleaner:python-matting` (tab Cleaner); **không** nằm trong `saveClipState()`, không đổi `schemaVersion`. Mặc định **tắt**. `Dải viền` 1–12 px (mặc định 4), `Làm mịn` 0–1 (0.5), `Khử ám màu` 0–1 (0.6), `Tách màu nền khỏi viền` bật, `Bỏ vụn` / `Lấp lỗ` 0–2000 px (0 = tắt).
- Status pill của panel: xanh `Python x.y · OpenCV a.b` khi worker trả lời `ping`; đỏ kèm hướng dẫn cài khi không có; nút `Kiểm tra Python` hỏi lại (bỏ cache). Report phân biệt lý do bỏ qua: `no-edges` (không có viền), `no-foreground` (keyer không để lại chủ thể đặc nào — thường do key nhầm màu chủ thể), `no-background`. Trimap erode `band` px, nhưng nếu erode làm rỗng vùng chắc-chủ-thể/chắc-nền (sprite mảnh, pixel art) thì `_erode_nonempty` giảm nửa bán kính dần tới 0 thay vì bỏ qua. Ở tab Cleaner, sau `Apply` luôn có toast kết quả Python (`notifyPythonOutcome`): số px viền đã đổi, hoặc lý do không đổi gì — vì hiệu ứng chỉ nằm ở dải viền nên dễ tưởng là không chạy.
- Ẩn panel bằng dialog `Settings` **không** tắt Python (đúng quy tắc chỉ-hiển-thị của mục 9b); không có `deactivate` vì panel không bật công cụ con trỏ nào.
- **Bất biến:** tắt Python, hoặc Python không có ⇒ pipeline đi đúng đường cũ, output **giống hệt từng byte**. Python chạy **sau** keyer và **trước** Subject Guard ở cả hai tab: guard đọc matte đã tinh chỉnh và vẫn so với ảnh gốc, Edge Refine (Cleaner) chạy trên kết quả đó. Python không đụng `public/js/keyer/` hay baseline. Sprite generation vẫn ở client — Python chỉ là một pass tinh chỉnh matte do client gọi, không phải đường generate server-side.
- CLI `python3 python/remove_bg.py` dùng cùng engine cho batch ngoài app (ảnh, thư mục, hoặc video với `--start/--end/--frames/--sheet`; `--key` chọn màu, `--connected` chỉ xoá nền chạm biên); xem docstring đầu file.

### 7. Generate sprite sheet

- Nút `Generate` lấy các frame phân bố đều trong vùng trim, quy về **frame gốc** của video (xem mục 7b); không đo được lưới thì rơi về lấy mẫu theo thời gian như cũ.
- Với mỗi frame: crop theo bốn cạnh, resize vào cell, đọc `ImageData`, áp dụng chroma key, lưu bản frame riêng và vẽ vào canvas sprite sheet lớn. Phần thân này nằm trong `renderCell(seekTime, editIndex)` để dùng lại cho frame twin của crossfade.
- Lưu `generatedFrames` để chạy animation và `fullSheetCanvas` để preview/download.
- Hiển thị progress bar theo số frame đã xử lý.
- Tự disable nút Generate trong lúc xử lý và tự khởi động animation preview khi xong.
- Việc tạo sprite sheet hoàn toàn chạy ở client; backend không có endpoint generate sprite.

### 7b. Lặp mượt: lưới frame gốc, seam loop, crossfade

Loop giật có hai nguồn: lấy nhầm frame (seek trúng mép frame) và cú nối ở seam lệch nhịp. Cả hai được xử lý trên **frame gốc** của video thay vì thời gian liên tục.

- **Luôn seek vào giữa frame, không bao giờ seek đúng PTS.** Video đang dừng hiện frame có PTS lớn nhất ≤ `currentTime`; seek đúng PTS (0.1 s trên clip 30 fps *chính là* PTS của frame 3) thì sai số float quyết định ra frame 3 hay frame 2, và `currentTime` sau seek chỉ là giá trị đã yêu cầu nên không ai thấy lỗi. Mọi chỗ seek để lấy pixel đi qua `plan.seekTimes`, `seekTimeFor()` hoặc `frameSeekTime()` (`SEEK_PHASE = 0.5`).
- **Lưới đo một lần cho mỗi clip.** `ensureFrameGrid()` trong `app.js` gọi `detectFrameGrid()` và cache ở `state.frameGrid` (tối đa 2 lần thử, token chống race, bỏ qua khi tab ẩn). Reset ở `loadedmetadata` nhưng **giữ** qua `rehostVideoAsBlob()` vì dữ liệu không đổi. Generate, mở Loop Finder và Scan đều `await ensureFrameGrid()` trước.
- **Hai loại thời gian trong plan.** `plan.times` là thời gian logic của từng ô — Bút Xóa và vùng tròn gắn `frameTime` theo cái này và `state.frameTimes` lưu cái này. `plan.seekTimes` chỉ dùng để seek. Không trộn hai loại: gắn binding theo `seekTimes` sẽ làm nét đã lưu lệch nửa frame so với clip cũ.
- Số frame gốc mỗi ô không nguyên (ví dụ chu kỳ 47 frame gốc chia 16 ô) thì nhịp là 2–3–3–…; plan dàn đều theo Bresenham nên không bao giờ có hai bước lệch nhau quá 1 frame gốc. Hint của Loop Finder, card candidate và toast sau Generate báo nhịp không đều và gợi ý FPS cho nhịp đều (`evenPacingFpsOptions`). Trim ngắn hơn số ô thì sẽ có ô trùng frame (`duplicateFrames`), có toast báo.
- **Crossfade dùng twin, không kéo đuôi về đầu.** Mỗi ô trong `Loop crossfade` được trộn với frame cách nó đúng một chu kỳ (`planCrossfadeTwins`): ưu tiên biến thể `tail` — các ô cuối trộn với frame chạy ngay **trước** ô 0 trong video, nên cú nối rơi vào đúng chuyển động dẫn vào ô 0; loop bắt đầu sát đầu video thì dùng `head` — các ô đầu trộn với frame chạy ngay **sau** ô cuối. Ô sát seam nghiêng về twin nhiều nhất (smoothstep), trộn ở linear light (`blendLoopTwin`). Checkbox `Bù chuyển động khi crossfade` (`#chkLoopMorph`, `state.loopMorph`, mặc định bật, lưu trong clip state — thiếu field ⇒ bật, `schemaVersion` vẫn 5) cho hoà theo `seam-morph.js`: ô và twin lệch vài pixel thì chi tiết được vẽ **một lần** ở giữa hai pose thay vì hai hình mờ chồng nhau (bóng ma). Tắt checkbox, hoặc morph tự rơi về dissolve ⇒ output byte-identical với crossfade cũ; crossfade = 0 thì checkbox không có tác dụng (row bị làm mờ, class `.is-idle`). Twin được render bằng chính `renderCell()` nên đi qua đủ pipeline (keyer → guard → màu → region → erase …). Không đủ video cho twin thì số ô trộn bị giảm, có toast báo.
- **Xếp hạng bằng residual.** Pass 3 của scanner tinh chỉnh seam cho **mọi** candidate (app truyền `refineCandidates: 6` = `maxCandidates`), pass 4 đo `seamResidual()` trên frame gốc và `seamJumpRatio()` trên đúng các ô sẽ xuất, rồi **tính lại** điểm: seam term = `0.75·seamQuality + 0.25·played` (không có jump ratio ⇒ chỉ seamQuality), ghép với period/frameFit/activity theo `LOOP_SCORE_WEIGHTS`; `visualScore` = seamQuality. Trước đây candidate tinh chỉnh và không tinh chỉnh được chấm trên hai thang khác nhau. Residual bắt được cú nối mà jump ratio bỏ sót: descriptor distance không có hướng, nên một cú nối *tua ngược* một bước vẫn ra ×1.2 "mượt", còn residual ra ~2 bước. Subject gần như đứng yên (không có bước để so) ⇒ residual `null`, giữ điểm của search như cũ.
- **Crossfade tự gợi ý.** Card candidate ghi `⌁ lệch X bước · gợi ý crossfade N ô`; `Áp dụng chu kỳ` đặt luôn slider `Loop crossfade` = `recommendedCrossfade` (0 khi cú nối không nhìn thấy, vì crossfade luôn làm mềm chi tiết một chút). Sau Generate, `measureLoopSeam(state.generatedFrames)` đo cú nối của sheet thật (chỉ khi Closed loop, không ping-pong, ≥ 6 ô) vào `lastGenerateNotes.finalSeam`; còn khựng/giật thì toast gợi ý crossfade (`recommendCrossfade(ratio − 1, N)`) hoặc Loop Finder, đứng hình thì gợi ý lùi Trim End 1 frame.
- **Loop Finder:** badge của inspector ghi `% khớp viền · Nf @ speed · nối mượt/hơi khựng/giật/đứng hình ×ratio · lệch X bước` (residual đo bằng ô đầu và frame `endFrame` cách đúng một chu kỳ); sau khi nudge (`cand.nudged`), residual/gợi ý crossfade của candidate được cập nhật theo số đo mới, chưa nudge thì giữ số đo có cửa sổ của scanner; mini-player ở seam chạy các ô `N−3 … 2` đúng như sheet sẽ phát, không lặp lại frame seam. Nút nudge dời Start/End đúng **1 frame gốc** (0.02 s nếu chưa đo được lưới). Áp candidate vào timeline thì đặt đầu/cuối theo thứ tự không bị kẹp bởi trim cũ và **bật `Closed loop`** — chu kỳ tìm được là loop kín, lấy mẫu loop mở sẽ lặp lại frame đầu ở cuối.
- Test: `test/frame-grid.test.mjs` (suy lưới cho 24/25/29.97/30/60 fps, PTS WebM làm tròn ms, VFR ⇒ `null`, plan Bresenham, twin, gợi ý FPS) các test `refineSeamOnFrames` / `seamJumpRatio` / `seamResidual` / `recommendCrossfade` trong `test/loop-analysis.test.mjs`, và `test/seam-morph.test.mjs` (dissolve khớp công thức cũ, khung giống nhau giữ nguyên, pose dời được vẽ một lần ở giữa, footage đục, pose không liên quan rơi về dissolve byte-identical).

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

### 9b. Dialog `Settings` (bật/tắt panel của tab Video → Sprite)

Màn hình Video → Sprite có hơn 20 khung điều khiển; phần lớn người dùng chỉ đụng vài cái. Nút `Settings` ở header mở một dialog cho tắt bớt những khung không dùng.

- **Chỉ là chuyện hiển thị.** Khung bị ẩn vẫn giữ nguyên giá trị trong state và vẫn được pipeline đọc như cũ: ẩn `Subject Color Replace` **không** tắt việc thay màu, ẩn `Erase Brush` **không** xoá các nét đã bôi. Output không đổi một byte nào. Muốn tắt tác dụng thì vẫn phải đặt giá trị về mặc định như trước giờ.
- **Ẩn thì tắt công cụ.** Trường `deactivate` của panel trỏ tới một hook trong `PANEL_DEACTIVATORS` ở `app.js` (`watermark`, `protectionBrush`, `eraseBrush`, `colorTools`). Một Bút Xóa đang bật mà panel của nó biến mất là cái bẫy: người dùng click lên video và mất pixel, không hiểu vì sao. Hook chỉ chạy khi người dùng tự tắt panel, **không** chạy ở lần áp dụng lúc load.
- Registry nằm ở `panel-visibility.js`, chia hai nhóm theo đúng hai panel trên màn hình: `sprite` (cột sidebar trái) và `chroma` (panel chroma key phía dưới). Một panel ánh xạ tới **nhiều** phần tử DOM (`elements`) — ví dụ `crop` gom 4 ô crop — nên không phải bọc thêm div và không đụng vào layout grid.
- Ẩn bằng class `.panel-hidden` (`display: none !important`, cần `!important` để thắng `style="display: ..."` inline mà vài group đang mang).
- **Lưu danh sách id bị ẩn**, không lưu map đầy đủ (`localStorage`, khoá `video-editor:panels:hidden`). Nhờ vậy một panel thêm về sau mặc định **hiện** với người đã lưu layout — mặc định duy nhất hợp lý cho một control họ chưa từng thấy. `parseVisibility()` nuốt mọi thứ localStorage có thể trả về (null, JSON hỏng, map kiểu cũ, id không còn tồn tại) và suy biến thành "hiện tất cả" thay vì throw.
- Hai preset: `Hiện tất cả` và `Gọn tối đa` (`MINIMAL_PANEL_IDS` — chỉ giữ Frames, lưới, crop, resolution, chroma key, Similarity). Mỗi nhóm còn có `Hiện hết` / `Ẩn hết` riêng, và có ô tìm kiếm lọc theo tên/mô tả.
- Badge tím trên nút header đếm số khung đang ẩn, để không ai ngồi tìm một panel mình đã tự ẩn tháng trước.
- Thêm một panel mới: thêm `id` vào markup, thêm một entry vào `PANEL_GROUPS`. Test tự chặn id gõ sai hoặc một phần tử bị hai panel cùng nhận.

### 10. Clean Sprite Sheet

Tab riêng làm sạch sprite sheet tĩnh (PNG/WebP/JPEG), toàn bộ ở `public/js/sprite-remover.js`. Pipeline:

```
state.original → runKeyer(connected, keyRegions) → state.jsKeyed (cache)
  → applyPythonPass() → state.keyed (cache; tắt Python ⇒ chính là state.jsKeyed)
  → applySubjectGuardPass() → state.guarded (cache)
  → applyEdgeRefine() → state.refined (cache)
  → applyRegionKeys() → state.result → hiển thị
  → export PNG: clone → applyAlphaBleed(3) → encodePNG
```

- **Vùng tròn áp cho mọi frame** (`#spriteRegionAllFrames`, field `allFrames` của vùng; `normalizeRegion()` giữ field này, mặc định `false`, keyer của region bỏ qua nó). Vùng có tick được nhân ra **mọi ô** của lưới `Sprite grid` (Rows × Cols) ở cùng vị trí tương đối so với gốc ô, và mỗi bản bị **chặn trong ô của nó** (`applyRegionAcrossCells()` chỉ cắt phần giao của bounding box với ô rồi gọi `applyRegionKeys` qua crop geometry) — vòng tròn sát mép frame không được ăn sang frame bên cạnh. Ô "gốc" là ô chứa tâm vùng; kéo tâm bị kẹp trong ô gốc (`clampCentreToCell`) để ô gốc không đổi giữa cú kéo. Overlay vẽ một bản cho mỗi ô ở chế độ `Sheet`, và bản của ô đang hiện ở `Anim`; id bản sao là `id@@cell`, `baseRegionId()` dẫn về vùng gốc, `isRegionSelected` của `region-overlay.js` làm mọi bản sáng lên khi vùng được chọn. Pick màu trên một bản sao lưu `seed` đã dịch về ô gốc. Đổi Rows/Cols/`Sprite grid` thì các bản dời theo (`refreshRegionsForGrid()`). Không có lưới (1 ô) ⇒ vùng tick hay không tick đều như nhau; hint `#spriteRegionAllFramesHint` nói rõ cần bật lưới. Không có vùng `allFrames` nào ⇒ output giống hệt từng byte như trước.
- Vùng tròn chạy **sau** Edge Refine, không phải trước: refine unmix dải viền theo `state.lastKeyColors` — nó không biết gì về màu của vùng, nên nếu vùng chạy trước thì refine sẽ đọc một dải viền vừa bị vùng đổi alpha và unmix theo màu key sai. Chạy sau thì vùng chỉ nhìn thấy alpha đã chốt và hạ nó xuống. Không có vùng nào ⇒ `applyRegions()` trả thẳng `state.refined` ⇒ output giống hệt từng byte trước khi có feature.

- **Edge Refine** (`#spriteEdgeRefineSection`): `Refine edges` bật/tắt, `Edge Width` 1–3 px, `Smooth` 0–1, `Decontaminate edge color`, `Pixel art edges` (bỏ smoothing, alpha chỉ còn 0/255; khi bật thì khoá `Smooth`). Tắt `Refine edges` thì `applyEdgeRefine()` trả thẳng `state.keyed` → output **giống hệt từng byte** kết quả keyer.
- Kéo slider Edge Refine chỉ chạy lại refine trên `state.keyed` đã cache (debounce), không chạy lại flood fill. Bật `Analyze each sprite cell` thì refine gọi riêng từng ô với `rect` nên không loang qua đường kẻ ô.
- Bất biến của `refineEdges()`: alpha không bao giờ tăng (`α = min(α_refine, α_keyer)`); chỉ ghi pixel cách pixel alpha 0 tối đa `edgeWidth` → lõi nhân vật giữ nguyên từng byte; không đọc/ghi ngoài `rect`. Trạng thái Result ghi thêm `· edge refined (N px)`.
- **Pick màu trên Result** (khung Transparent): khi Pick đang bật và đang ở phạm vi All Frames (không phải `Pick Below Line`), loupe và click chạy được trên cả Original lẫn Result; hai canvas cùng kích thước và transform nên cùng toạ độ, kể cả ở chế độ `Anim`.
  - Màu luôn lấy từ `state.original`, không lấy từ Result (Result đã bị nhân alpha/khử màu). Pixel đã trong suốt trên Result bị từ chối kèm toast.
  - Click thường → phạm vi `edge` (swatch có nhãn `⌇ edge`); `Shift+Click` hoặc `Shift+Enter` → `global` như pick trên Original. Nhãn phạm vi hiện trong loupe.
  - Click commit đúng pixel loupe đang hiển thị (`state.hoverPick`), không tính lại từ `clientX` của `click` — `click` làm tròn toạ độ nguyên còn `pointermove` có phần lẻ, ở zoom 100 % sẽ lệch sang pixel bên cạnh.
  - Màu `edge` đi vào keyer dưới dạng `keyRegions: [{ hex, matchMode: 'edge', edgeReach: 2 }]` và **không** tạo `seedPoints`. Trong `applyConnectedMatte()` key `edge` bị loại khỏi BFS chính (`analyze`/`hasAllowedKey`); sau BFS chính mới chạy một BFS phụ bắt đầu từ biên mask, chỉ lan tối đa `edgeReach` bước (clamp 1–4) qua pixel khớp key `edge`. Nhờ vậy một màu viền gần màu nhân vật không loang vào giữa nhân vật. Không có region `edge` thì output keyer không đổi byte nào.
  - Pick trùng màu đã có: nếu màu đó đang là `global` thì pick `edge` bị bỏ qua (toast "Màu này đã được xoá ở mọi nơi.").
- **Sidebar**: các `.cleaner-control-section` gấp/mở được (`sidebar-sections.js`). Mọi section phải có `.cleaner-section-title` là **con trực tiếp** — không có tiêu đề thì không có chỗ bấm và section luôn mở. Thân section bị bọc vào `.cleaner-section-body` lúc init, nên đừng viết CSS/JS dựa vào việc con của section nằm trực tiếp dưới section (delegation kiểu `edgeRefineSection.addEventListener('input', …)` vẫn chạy vì event vẫn nổi bọt lên). `Edge Refine` và `Sprite grid` mặc định gấp. Dưới 900 px sidebar bỏ sticky và các section tự dàn thành nhiều cột (`repeat(auto-fit, minmax(255px, 1fr))`) thay vì một dải dọc dài hơn màn hình.
- **Export**: PNG đi thẳng từ `ImageData` qua `applyAlphaBleed` rồi `png-encoder.js`, không qua canvas, để màu đã khử của pixel viền alpha thấp không bị lượng tử hoá bởi backing store premultiplied. WebP vẫn qua canvas `toBlob` với quality 0.9. Test ở `test/export-pipeline.test.mjs`.

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

### `GET /api/python/status`

- Ping worker Python (khởi động nếu chưa chạy). Trả `{ available: true, version, python, numpy, opencv, pythonBin }` hoặc `{ available: false, error, hint, pythonBin }` — luôn HTTP 200.

### `POST /api/python/matte`

- Body `application/octet-stream` (tối đa 600 MB): `u32le headerLength | header JSON {op, width, height, options} | payload`.
- `op: 'refine'`: payload = original RGBA + keyed RGBA; `op: 'key'`: payload = original RGBA (worker tự key bằng engine Python, frontend hiện chưa dùng).
- Kiểm tra `op`, kích thước (≤ 8192×8192) và độ dài payload → 400 nếu sai. Thành công trả body cùng định dạng: header `{ok, stats}` + RGBA kết quả.
- Lỗi do worker xử lý (input hỏng…) ⇒ 422; không có Python / worker chết ⇒ 503 kèm `hint` cài đặt. Frontend coi 503/404 là "Python không có".

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
- Bút Xóa phải giữ nguyên vị trí trong pipeline: keyer → (python) → subject guard → color replace → erase → (bounds detection nếu có alignment) → crossfade. Không đẩy erase vào `public/js/keyer/` vì sẽ phải sửa whitelist option và regenerate baseline.
- Vùng tròn phải giữ nguyên vị trí trong pipeline: keyer → (python) → subject guard → color replace → **region** → erase → (bounds detection nếu có alignment) → crossfade. Không đẩy `region-key.js` vào `public/js/keyer/` vì sẽ phải sửa whitelist option và regenerate baseline. Ở tab Cleaner, region chạy **sau** Edge Refine.
- Không có vùng nào ⇒ output **giống hệt từng byte** với trước khi có feature, ở **cả hai** tab.
- `applyRegionKeys()` không bao giờ tăng alpha và không đọc/ghi ngoài bounding box của vùng.
- `frame`/`frameTime` của vùng (và của nét Bút Xóa) thiếu thì phải là `null`, không phải `0` — `Number(null) === 0` sẽ biến mọi binding global thành frame 0. Xem ghi chú ở `stroke-mask.js` và `erase-frames.js`.
- Subject Guard chạy **ngay sau** keyer, trước mọi bước khác ở cả hai tab (ở Cleaner: trước Edge Refine, vì refine unmix dải viền **cuối cùng**, và guard có thể dời dải viền đó). Giữ `subject-guard.js` ngoài `public/js/keyer/`. Tắt guard ⇒ output byte-identical với trước khi có feature; guard không bao giờ hạ alpha, không vượt alpha gốc, không đọc/ghi ngoài `rect`. Ở tab Video, frame đưa vào guard phải là frame gốc chưa bị keyer sửa — `runKeyer` direct trả `ImageData` mới nên điều này đúng; đổi keyer sang mutate tại chỗ thì phải clone trước.
- Python Precision Matting chạy ngay sau keyer, trước Subject Guard, ở cả hai tab; tắt hoặc không có Python ⇒ output byte-identical. Setting Python là global (localStorage), không lưu vào clip state. Không chuyển sprite generation sang server — Python chỉ tinh chỉnh matte theo yêu cầu của client. Đổi định dạng gói nhị phân thì sửa đồng bộ `python-engine.js`, `python-bridge.js` và `python/rmbg/protocol.py`, rồi chạy cả `npm test` lẫn `npm run test:python`.
- UI: thêm class Tailwind mới thì chạy `npm run build:css` và commit `public/css/tailwind.css`. Giữ câu khai báo thứ tự `@layer` giống nhau ở `index.html` và `tailwind.src.css`.
- Clean Sprite Sheet: giữ Edge Refine ngoài `public/js/keyer/`; tắt Edge Refine phải cho output byte-identical với keyer; refine không được tăng alpha hay đổi pixel lõi. Key `edge` không được tham gia BFS chính và không tạo seed point. Không đổi `test/keyer/baseline/`.
- Dialog `Settings` chỉ được ẩn DOM, không được gate pipeline: ẩn một panel phải cho output **giống hệt từng byte**. Panel nào bật được công cụ thì phải khai `deactivate` để công cụ bị tắt khi panel bị ẩn.
- Thêm panel mới vào registry thì thêm `id` vào `public/index.html` trước — `test/panel-visibility.test.mjs` đọc markup và fail nếu id không tồn tại.
- Thêm chỗ seek video để đọc pixel thì seek vào giữa frame qua helper của `frame-grid.js` (`seekTimeFor`, `frameSeekTime`, `plan.seekTimes`), không seek thẳng tới thời gian trim/timestamp. Binding của Bút Xóa/vùng tròn đi theo `plan.times`, không theo `seekTimes`.
- Crossfade morph (`seam-morph.js`) phải tự rơi về dissolve khi flow không giải thích được khác biệt; tắt `Bù chuyển động khi crossfade` ⇒ output byte-identical với crossfade hoà mờ cũ. Đổi `MIN_GAIN`/kiểm tra thuận–nghịch thì chạy lại `test/seam-morph.test.mjs` — test "pose không liên quan" là cái chặn morph kéo một khối về phía khối khác.
- Không có lưới (`state.frameGrid === null`: không có rVFC, tab ẩn, VFR) thì mọi đường phải chạy như trước khi có lưới — `planLoopFrames()` không có `grid` trả `seekTimes === times`.
- Không coi `Split`, `Duplicate`, `Delete` là hệ thống timeline nhiều clip: hiện chúng chỉ thao tác trên `trimStart`/`trimEnd` và state backup.
- Sau thay đổi lớn, chạy kiểm tra cú pháp, khởi động server, kiểm tra `/api/health`, rồi thử flow demo: load video → trim → generate → preview → download.
