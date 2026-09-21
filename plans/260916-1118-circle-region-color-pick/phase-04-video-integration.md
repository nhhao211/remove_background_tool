# Phase 4 — Tích hợp vào tab Video → Sprite

**Effort:** 6h · **Phụ thuộc:** Phase 1, 2

Tab này khó hơn tab cleaner ở ba điểm: có vòng lặp Generate với seek, có hai nhánh
alignment/không-alignment, và có live-cache để preview không phải seek lại.

## Vị trí trong pipeline

```
runKeyer → colorReplace → colorGrade
  → applyRegionKeys          ← MỚI
  → applyEraseMask
  → (detectSubjectBounds nếu bật alignment) → crossfade → sharpen
```

Đặt **trước** erase và **trước** `detectSubjectBounds` vì lý do y hệt Bút Xóa đã ghi trong
AGENTS.md: chi tiết đã xoá không được kéo lệch canh chủ thể.

Vùng **không** gate theo `chkTransparentFormat`, cũng đúng lý do của Bút Xóa: đây là lệnh xoá
tường minh, không phải một tinh chỉnh matting. "Xoá cái logo này" vẫn hợp lý trên bản xuất đục.

## Hai nhánh, hai geometry

Sao chép đúng cấu trúc `eraseMaskFor` / `eraseMaskFullFor` trong `generateSpriteSheet()`:

| Nhánh | Geometry | Thời điểm |
|---|---|---|
| Alignment bật | full-res (`cropX/Y = 0`, `cropWidth/Height = fullW/fullH`) | trong vòng lặp, trước `detectSubjectBounds` |
| Alignment tắt | cell (`cropX = cLeft`, …, `targetWidth = cellW`) | sau vòng lặp, từ `state.rawFrames` |

Nhánh alignment tắt chạy sau vòng lặp là cái cho phép **live preview**: `state.rawFrames` đang
là bản "trước erase"; sau phase này nó thành bản "trước erase **và** trước vùng". Đổi tên
`reapplyEraseMaskLive()` → `reapplyLocalEditsLive()` và cho nó áp cả hai, theo đúng thứ tự
`region → erase`. Kéo slider `Tolerance` của một vùng ⇒ preview cập nhật ngay, không seek lại clip.

`discardLiveEraseCache()` không cần đổi (nó đã xoá `rawFrames`, `sheetLayout`, `frameOrigins`,
`frameTimes` — tất cả đều là thứ vùng cũng cần).

## Binding theo frame

Dùng lại **nguyên** `erase-frames.js`: `frame` + `frameTime`, gắn lại theo **thời gian** khi số
frame đổi, binding hỏng thành `ORPHAN_FRAME` và không áp ở đâu cả. Vùng và nét vẽ chia sẻ cùng
quy tắc nên không phát sinh khái niệm mới.

Cần một `makeRegionProvider(geometry, frameCount, frameTimes)` song song với
`makeEraseMaskProvider`, nhưng rẻ hơn nhiều: vùng không phải rasterize, chỉ cần **lọc danh sách**
theo frame. Không cần cache shared mask.

Sau mỗi lần Generate phải gọi `markEraseStrokesChanged()` như hiện tại — overlay vùng theo frame
cũng đọc binding đó.

## Bề mặt vẽ

**Source Video** — overlay `#regionOverlayCanvas` đặt bằng `getVideoRenderBox()`, y hệt
`eraseBrushCanvas` (`parentLeft`/`parentTop`/`width`/`height`). Vùng vẽ ở đây mặc định phạm vi
**mọi frame**.

**Khung Preview** — dùng lại `mapPreviewPointToSource()` trong `preview-erase-map.js` không sửa
một dòng: nó đã đi từ pixel canvas preview → ô → gốc crop của đúng frame đó → toạ độ chuẩn hoá
0..1 của source. Vùng vẽ ở đây mặc định phạm vi **chỉ frame này**, `Shift` đảo tạm thời.

Hai ràng buộc đã biết từ Bút Xóa, áp dụng y nguyên:

- Chặn pan chuột trái của `spriteViewport` khi tool vùng đang bật (`mousedown` guard, vì
  `pointerdown` không chặn được `mousedown`); pan bằng chuột giữa/phải.
- Không cho bắt đầu vẽ trên các ô trống ở cuối hàng cuối
  (`frameIndex >= state.generatedFrames.length`).

Khác với overlay đỏ của Bút Xóa: overlay vùng chỉ là vài đường path, **không** rasterize tile,
nên không cần `PREVIEW_TINT_PIXEL_BUDGET` và chạy được cả khi animation đang phát.

## DOM mới

Trong panel chroma key, dưới hàng swatch màu:

```html
<button id="btnRegionPick" class="eyedropper-trigger-btn region-pick-btn" type="button">
  <i data-lucide="circle-dashed" style="width: 14px; height: 14px;"></i>
  <span>Vùng tròn + Pick</span>
</button>
```

Panel `#regionControls` (Tolerance / Softness / Despill / `Chỉ vùng liền kề` / `Chỉ frame này ·
Mọi frame`) theo khuôn `syncSliderAndNumber` đang dùng khắp `app.js`.

Danh sách vùng hiện cạnh swatch màu key, mỗi chip có nhãn phạm vi (`mọi frame` hoặc `frame #N`).

## Lưu trạng thái

`saveClipState()` thêm `colorRegions: normalizeRegions(state.colorRegions)` và bump
`schemaVersion` 4 → 5. Đọc lại trong `loadClipState()` qua `normalizeRegions()` — vùng hỏng bị
bỏ, không throw. Không xoá dữ liệu của schema 4: thiếu `colorRegions` ⇒ `[]`.

## Kiểm tra bằng tay

- [ ] Vẽ vùng trên Source Video, pick màu ⇒ Generate ⇒ chi tiết biến mất ở mọi frame, phần còn
      lại của nhân vật giữ nguyên màu.
- [ ] Vẽ vùng trên một ô Preview ⇒ chỉ ô đó đổi; các ô khác byte-identical.
- [ ] Giữ `Shift` lúc vẽ trên Preview ⇒ đảo phạm vi, banner phản ánh đúng.
- [ ] Kéo `Tolerance` sau khi Generate (alignment tắt) ⇒ preview cập nhật không seek lại.
- [ ] Bật Subject Alignment ⇒ Generate lại ⇒ vùng vẫn đúng chỗ và không kéo lệch canh chủ thể.
- [ ] Tắt `Transparent WebP/PNG` ⇒ vùng vẫn xoá được.
- [ ] Đổi crop / rows / cols / cell size ⇒ vùng bám đúng nội dung.
- [ ] Đổi số frame rồi Generate lại ⇒ vùng theo frame gắn lại theo **thời gian**, không theo chỉ số.
- [ ] Reload trang ⇒ vùng khôi phục từ localStorage.
- [ ] Không có vùng nào ⇒ sprite sheet xuất ra giống hệt trước khi có feature (`cmp`).
- [ ] Download ZIP bundle và MP3 vẫn chạy.

## Giới hạn đã biết — phải nói rõ trong banner

Nhân vật di chuyển thì vòng tròn đứng yên. Đây đúng là giới hạn Bút Xóa đang có và đã ship.
Ba lối thoát cho người dùng, xếp theo thứ tự nên thử:

1. Vẽ vùng riêng cho từng ô ngay trên Preview (phạm vi `Chỉ frame này`).
2. Vẽ vòng tròn rộng hơn và siết bằng `Tolerance` + `Chỉ vùng liền kề`.
3. *(ngoài phạm vi v1)* Neo tâm vùng theo `detectSubjectBounds` để vùng bám chủ thể — rẻ trên
   nhánh alignment vì bounds đã được tính sẵn mỗi frame.
