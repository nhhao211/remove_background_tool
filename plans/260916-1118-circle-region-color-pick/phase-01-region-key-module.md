# Phase 1 — Module `public/js/region-key.js` + test

**Effort:** 7h · **Phụ thuộc:** —

## Mục tiêu

Một module thuần tuý, không DOM, chạy được trong Node, nhận `ImageData` đã qua keyer và một
danh sách vùng, rồi hạ alpha của những pixel **vừa nằm trong vùng vừa khớp màu**.

Đặt ngoài `public/js/keyer/` theo đúng tiền lệ `erase-mask.js` / `edge-refine.js`: keyer có
baseline byte-identical và `assertOptions()` chặn option lạ, module này không cần chạm vào
cả hai.

## API

```js
import { applyRegionKeys, normalizeRegion, normalizeRegions } from './region-key.js';

const { removedPixels, regionsApplied } = applyRegionKeys(imageData, regions, geometry);
```

### `geometry`

Cùng shape với option của `rasterizeStrokeMask` trong `stroke-mask.js`, để hai hệ dùng chung
một phép ánh xạ:

```js
{ sourceWidth, sourceHeight, cropX, cropY, cropWidth, cropHeight }
```

`imageData.width/height` là kích thước đích. Thiếu field nào thì mặc định về "không crop,
không scale", giống `rasterizeStrokeMask`.

### `region` (sau `normalizeRegion`)

```js
{
  shape: 'ellipse',
  cx, cy, rx, ry,             // 0..1 theo source; rx/ry > 0
  colors: [{ r, g, b, hex }], // 0..8 màu
  tolerance: 0..1,            // mặc định 0.30
  feather: 0..1,              // mặc định 0.20
  subjectProtection: 0..1,    // mặc định 0.55
  softness: 0..1,             // mặc định 0.12
  despill: 0..1,              // mặc định 0
  connected: false,
  seed: { x, y } | null,      // 0..1
  enabled: true,
  frame: null, frameTime: null
}
```

`normalizeRegion` trả `null` cho vùng hỏng (thiếu toạ độ, `rx <= 0`, không màu nào hợp lệ).
`normalizeRegions` map + filter + `slice(-100)`.

**Cẩn thận `Number(null) === 0`** — đúng cái bẫy đã ghi trong `stroke-mask.js`: `frame` và
`frameTime` thiếu phải trả `null`, nếu không mọi vùng global hoá thành vùng của frame 0. Dùng
lại cùng helper `missing()`.

## Thuật toán

Cho mỗi vùng `enabled` có ít nhất một màu:

1. **Ánh xạ hình về pixel đích** qua `geometry` (đúng công thức `mapPoint` của `stroke-mask.js`):
   ```
   cxPx = ((cx * sourceWidth) - cropX) * (targetWidth / cropWidth)
   rxPx = rx * sourceWidth * (targetWidth / cropWidth)
   ```
   Duyệt **chỉ** bounding box `[cx±rx, cy±ry]` đã clamp vào ảnh.

2. **Trọng số hình** — `t = hypot((x+0.5-cx)/rx, (y+0.5-cy)/ry)`; `t >= 1` ⇒ bỏ qua.
   ```
   shapeWeight = softness <= 0 ? 1 : 1 - smootherstep(1 - softness, 1, t)
   ```

3. **Ngưỡng màu** — sao chép **y hệt** `applyConnectedMatte` (`keyer/matte.js:160-166`) để
   slider có cùng ý nghĩa với `Similarity`:
   ```
   luminanceWeight = 0.08 + 0.9 * tolerance? → 0.08 + 0.9 * subjectProtection^1.5
   threshold       = 0.015 + 0.28 * tolerance^1.4
   featherWidth    = 0.003 + 0.11 * feather^1.45
   ```

4. **Khớp màu** — `distance = min(keyDistance(pixel, key, luminanceWeight))` trên `colors`,
   `matte = smootherstep(threshold, threshold + featherWidth, distance)`.

5. **Hạ alpha**:
   ```
   removal = shapeWeight * (1 - matte)
   alpha  *= (1 - removal)
   ```

6. **Despill** (nếu `despill > 0` và alpha còn lại > 0): `suppressSpill(data, offset, pixel,
   nearestKey, despill * removal)` — dùng lại `keyer/spill.js`, không viết lại.

### Chế độ `connected`

Khi bật, thay bước 4–5 bằng BFS 8-láng-giềng **bắt đầu từ `seed`**, chỉ đi qua pixel thoả
`t < 1` và `distance <= threshold + featherWidth`. Alpha vẫn hạ theo `matte` như trên cho
đúng những pixel BFS chạm tới. Không có `seed` ⇒ coi như `connected: false`.

BFS dùng `Int32Array` queue kích thước bounding box, không phải `Array.push` — sheet 50 MP.

## Bất biến (phải có test riêng cho từng cái)

- `regions` rỗng / toàn vùng `enabled: false` ⇒ `imageData` **không đổi một byte**.
- Alpha **không bao giờ tăng**.
- Pixel ngoài bounding box của mọi vùng **không được đọc cũng không được ghi** — test bằng
  `Proxy` trên `data` hoặc bằng sentinel value quanh vùng.
- `despill: 0` ⇒ kênh RGB không đổi.
- Vùng hỏng ⇒ bỏ qua, **không throw** (degrade như mask lệch kích thước ở `applyEraseMask`).
- Chạy hai lần liên tiếp với cùng input ⇒ cùng output (không có state ẩn).

## Test — `test/region-key.test.mjs`

Theo đúng khuôn `test/erase-mask.test.mjs`: dựng `{ data, width, height }` bằng tay, không
cần browser.

Unit:
1. Vùng rỗng ⇒ byte-identical.
2. Alpha không tăng, kể cả khi alpha vào là 0.
3. Ngoài bounding box không bị ghi (sentinel).
4. `softness` cho falloff đơn điệu từ tâm ra mép.
5. Ánh xạ qua crop: vùng vẽ trên "video" đầy đủ rơi đúng chỗ trong một cell đã crop + scale.
6. Nhiều màu trong một vùng ⇒ lấy khoảng cách **nhỏ nhất**.
7. `connected` không nhảy qua khe hở 1 px.
8. `connected` không thoát ra ngoài vòng tròn dù màu vẫn khớp.
9. `despill: 0` không đụng RGB; `despill: 1` chỉ đổi RGB của pixel đã bị hạ alpha.
10. `normalizeRegion`: vùng thiếu `frame` ⇒ `frame === null` (bẫy `Number(null) === 0`);
    `rx <= 0` ⇒ `null`; toạ độ ngoài 0..1 bị clamp; round-trip JSON giữ nguyên.

Integration (dùng harness sẵn có `test/keyer/png.mjs` + `image.mjs`):
11. Trên `fixtures/clip-08/sheet.png`, sau `runKeyer(connected)` với key `#18c63e`: một vùng
    tròn `cx/cy = (383.5, 367.5)/512`, `r = 31/512`, màu `#60be68`, tolerance 0.30 phải xoá
    ≥ 1 900 / 1 936 px của chi tiết và đổi **0** pixel ngoài vòng tròn.
12. Cũng fixture đó, so sánh với pick global: pick global đổi ≥ 12 000 px ngoài chi tiết. Test
    này khoá lại chính lý do tồn tại của feature.

Benchmark gate: sheet 4096×4096, 8 vùng r≈100px ⇒ < 200 ms.

## Definition of done

- [ ] `public/js/region-key.js` tồn tại, không import gì từ DOM.
- [ ] Chỉ import `clamp01`, `colorMetrics`, `keyDistance`, `smootherstep` từ `keyer/color.js`
      và `suppressSpill` từ `keyer/spill.js`; **không sửa** file nào trong `keyer/`.
- [ ] `test/region-key.test.mjs` xanh, phủ đủ 12 ca trên.
- [ ] `npm test` xanh, `test/keyer/baseline/` không đổi.
- [ ] `node --check public/js/region-key.js`.
