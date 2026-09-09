/**
 * Minimal RGBA PNG encoder for the browser.
 * Video Background Remover & Sprite Sheet Studio
 *
 * Why this exists instead of `canvas.toBlob('image/png')`:
 *
 * A canvas 2D backing store is premultiplied. Writing a pixel with alpha 0 and
 * any colour stores (0,0,0,0), and every read-back — `getImageData`, `toBlob`,
 * `toDataURL` — reports it back as fully black. That is fine for compositing,
 * but it destroys the colour carried in fully transparent pixels, and that
 * colour is exactly what `alpha-bleed.js` puts there so a GPU sampling the
 * sprite with bilinear filtering does not pull black into every edge texel.
 *
 * So the bled sheet never goes back through a canvas: it stays as an ImageData
 * and is encoded here, straight to PNG bytes.
 *
 * Deflate comes from `CompressionStream('deflate')`, which emits the zlib
 * wrapper (RFC 1950) that PNG's IDAT stream expects — no Adler-32 of our own.
 */

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const BYTES_PER_PIXEL = 4;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function writeU32BE(target, offset, value) {
  target[offset] = (value >>> 24) & 0xFF;
  target[offset + 1] = (value >>> 16) & 0xFF;
  target[offset + 2] = (value >>> 8) & 0xFF;
  target[offset + 3] = value & 0xFF;
}

/** Builds one length-tag-data-CRC chunk. */
function buildChunk(type, data) {
  const chunk = new Uint8Array(12 + data.length);
  writeU32BE(chunk, 0, data.length);
  chunk[4] = type.charCodeAt(0);
  chunk[5] = type.charCodeAt(1);
  chunk[6] = type.charCodeAt(2);
  chunk[7] = type.charCodeAt(3);
  chunk.set(data, 8);
  writeU32BE(chunk, 8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
  return chunk;
}

const paeth = (a, b, c) => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
};

/**
 * Filters one scanline with all five PNG filter types and keeps whichever gives
 * the smallest sum of absolute signed differences — the heuristic from the PNG
 * spec. Sprite sheets are mostly flat transparent gutters with hard subject
 * edges, and the right filter per row is worth a large fraction of the file
 * size, so this pays for itself even though it costs five passes per row.
 */
function filterScanline(raw, prev, width, out) {
  const stride = width * BYTES_PER_PIXEL;
  let bestType = 0;
  let bestScore = Infinity;
  const candidate = new Uint8Array(stride);

  for (let type = 0; type < 5; type++) {
    let score = 0;
    for (let i = 0; i < stride; i++) {
      const a = i >= BYTES_PER_PIXEL ? raw[i - BYTES_PER_PIXEL] : 0;
      const b = prev[i];
      const c = i >= BYTES_PER_PIXEL ? prev[i - BYTES_PER_PIXEL] : 0;
      const x = raw[i];

      let value;
      if (type === 0) value = x;
      else if (type === 1) value = x - a;
      else if (type === 2) value = x - b;
      else if (type === 3) value = x - ((a + b) >> 1);
      else value = x - paeth(a, b, c);

      value &= 0xFF;
      candidate[i] = value;
      score += value < 128 ? value : 256 - value;

      // Abandon a filter as soon as it cannot win; most rows settle on the
      // first or second candidate.
      if (score >= bestScore) break;
    }

    if (score < bestScore) {
      bestScore = score;
      bestType = type;
      out.set(candidate, 1);
    }
  }

  out[0] = bestType;
}

async function deflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * True when this browser can run the encoder at all. `CompressionStream` is the
 * only exotic dependency; without it the caller must fall back to `toBlob`.
 */
export function canEncodePNG() {
  return typeof CompressionStream === 'function';
}

/**
 * Encodes 8-bit RGBA ImageData as a PNG Blob, preserving the colour of fully
 * transparent pixels.
 *
 * @param {ImageData} imageData - Unpremultiplied RGBA source.
 * @returns {Promise<Blob>} An `image/png` blob.
 */
export async function encodePNG(imageData) {
  const { width, height, data } = imageData;
  if (!width || !height) throw new Error('encodePNG: empty image');

  const ihdr = new Uint8Array(13);
  writeU32BE(ihdr, 0, width);
  writeU32BE(ihdr, 4, height);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // colour type: truecolour with alpha
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter: adaptive
  ihdr[12] = 0; // interlace: none

  const stride = width * BYTES_PER_PIXEL;
  const rawStream = new Uint8Array(height * (stride + 1));
  let prev = new Uint8Array(stride);
  const scanline = new Uint8Array(stride + 1);

  for (let y = 0; y < height; y++) {
    const row = data.subarray(y * stride, (y + 1) * stride);
    filterScanline(row, prev, width, scanline);
    rawStream.set(scanline, y * (stride + 1));
    prev = row;
  }

  const compressed = await deflate(rawStream);

  return new Blob([
    PNG_SIGNATURE,
    buildChunk('IHDR', ihdr),
    buildChunk('IDAT', compressed),
    buildChunk('IEND', new Uint8Array(0))
  ], { type: 'image/png' });
}
