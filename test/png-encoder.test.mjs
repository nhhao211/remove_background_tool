import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';

import { encodePNG, canEncodePNG } from '../public/js/png-encoder.js';
import { applyAlphaBleed } from '../public/js/alpha-bleed.js';

/**
 * Minimal PNG reader, independent of the encoder under test: it re-implements
 * the spec's five unfilters rather than reusing anything from `png-encoder.js`,
 * so a matching round-trip proves the bytes are really PNG and not just
 * self-consistent.
 */
function decodePNG(bytes) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  assert.deepEqual([...bytes.subarray(0, 8)], signature, 'PNG signature');

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let header = null;
  const idatParts = [];
  const chunkTypes = [];

  while (offset < bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    chunkTypes.push(type);

    if (type === 'IHDR') {
      header = {
        width: view.getUint32(offset + 8),
        height: view.getUint32(offset + 12),
        depth: body[8],
        colorType: body[9],
        interlace: body[12]
      };
    } else if (type === 'IDAT') {
      idatParts.push(Buffer.from(body));
    }

    offset += 12 + length;
  }

  assert.ok(header, 'IHDR present');
  assert.equal(header.depth, 8);
  assert.equal(header.colorType, 6);
  assert.equal(header.interlace, 0);

  const raw = zlib.inflateSync(Buffer.concat(idatParts));
  const { width, height } = header;
  const stride = width * 4;
  const out = new Uint8ClampedArray(stride * height);
  let prev = new Uint8Array(stride);

  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    return pb <= pc ? b : c;
  };

  for (let y = 0; y < height; y++) {
    const filterType = raw[y * (stride + 1)];
    const line = raw.subarray((y * (stride + 1)) + 1, ((y + 1) * (stride + 1)));
    const cur = new Uint8Array(stride);

    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? cur[i - 4] : 0;
      const b = prev[i];
      const c = i >= 4 ? prev[i - 4] : 0;
      let value;
      if (filterType === 0) value = line[i];
      else if (filterType === 1) value = line[i] + a;
      else if (filterType === 2) value = line[i] + b;
      else if (filterType === 3) value = line[i] + ((a + b) >> 1);
      else if (filterType === 4) value = line[i] + paeth(a, b, c);
      else throw new Error(`unknown filter ${filterType}`);
      cur[i] = value & 0xFF;
    }

    out.set(cur, y * stride);
    prev = cur;
  }

  return { width, height, data: out, chunkTypes };
}

function makeImage(width, height, fill) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const px = fill(x, y);
      const o = ((y * width) + x) * 4;
      data[o] = px[0];
      data[o + 1] = px[1];
      data[o + 2] = px[2];
      data[o + 3] = px[3];
    }
  }
  return { data, width, height };
}

async function encodeToBytes(image) {
  const blob = await encodePNG(image);
  assert.equal(blob.type, 'image/png');
  return new Uint8Array(await blob.arrayBuffer());
}

test('png encoder: is available on this runtime', () => {
  assert.equal(canEncodePNG(), true);
});

test('png encoder: round-trips every byte of a noisy image', async () => {
  // Pseudo-random content defeats any filter that happens to look lossless on
  // flat colour, and pushes different rows onto different filter types.
  let seed = 12345;
  const rand = () => {
    seed = ((seed * 1103515245) + 12345) & 0x7FFFFFFF;
    return seed % 256;
  };
  const source = makeImage(37, 23, () => [rand(), rand(), rand(), rand()]);

  const decoded = decodePNG(await encodeToBytes(source));

  assert.equal(decoded.width, 37);
  assert.equal(decoded.height, 23);
  assert.deepEqual([...decoded.data], [...source.data]);
});

test('png encoder: emits IHDR, IDAT and IEND in order', async () => {
  const source = makeImage(4, 4, () => [1, 2, 3, 255]);
  const decoded = decodePNG(await encodeToBytes(source));
  assert.deepEqual(decoded.chunkTypes, ['IHDR', 'IDAT', 'IEND']);
});

test('png encoder: preserves colour hidden under alpha 0', async () => {
  // The whole point of bypassing the canvas: a canvas would premultiply these
  // away, and a GPU sampling the sprite would pull black into the edge instead.
  const source = makeImage(8, 8, (x, y) => (
    (x >= 3 && x <= 4 && y >= 3 && y <= 4)
      ? [220, 30, 40, 255]
      : [0, 0, 0, 0]
  ));
  applyAlphaBleed(source, 2);

  const decoded = decodePNG(await encodeToBytes(source));

  const at = (x, y) => [...decoded.data.subarray(((y * 8) + x) * 4, (((y * 8) + x) * 4) + 4)];
  assert.deepEqual(at(2, 3), [220, 30, 40, 0], 'bled colour survives with alpha 0');
  assert.deepEqual(at(4, 4), [220, 30, 40, 255], 'opaque subject untouched');
  assert.deepEqual(at(0, 0), [0, 0, 0, 0], 'far transparent stays clear');
});

test('png encoder: handles single-pixel and single-row images', async () => {
  const dot = makeImage(1, 1, () => [9, 8, 7, 6]);
  assert.deepEqual([...decodePNG(await encodeToBytes(dot)).data], [9, 8, 7, 6]);

  const row = makeImage(5, 1, (x) => [x * 10, 0, 0, 255]);
  const decoded = decodePNG(await encodeToBytes(row));
  assert.deepEqual([...decoded.data], [...row.data]);
});

test('png encoder: rejects an empty image', async () => {
  await assert.rejects(() => encodePNG({ data: new Uint8ClampedArray(0), width: 0, height: 0 }));
});
