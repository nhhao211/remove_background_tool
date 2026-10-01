import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { PythonWorker, decodeBody, encodeBody, defaultPythonBin } from '../python-bridge.js';

const probe = spawnSync(defaultPythonBin(), ['-c', 'import numpy, cv2'], { encoding: 'utf8' });
const pythonReady = probe.status === 0;
const skip = pythonReady ? false : 'Python 3 with numpy + OpenCV not available';

test('body framing round-trips header and payload', () => {
  const payload = Buffer.from([1, 2, 3, 4]);
  const { header, payload: back } = decodeBody(encodeBody({ op: 'x', n: [1] }, payload));
  assert.deepEqual(header, { op: 'x', n: [1] });
  assert.deepEqual([...back], [1, 2, 3, 4]);
  assert.throws(() => decodeBody(Buffer.from([255, 0, 0, 0, 1])), /exceeds/);
  assert.throws(() => decodeBody(encodeBody([])), /object/);
});

test('a missing interpreter is reported, not thrown at startup', async () => {
  const worker = new PythonWorker({ pythonBin: 'definitely-not-python-xyz', log: null });
  await assert.rejects(worker.request({ op: 'ping' }), /Không tìm thấy Python/);
  worker.stop();
});

test('worker answers ping and refines a keyed frame', { skip }, async () => {
  const worker = new PythonWorker({ log: null });
  try {
    const { header } = await worker.request({ op: 'ping' });
    assert.equal(header.ok, true);
    assert.match(header.opencv, /^\d/);

    // 32x32 blue backdrop with an orange square whose rim is half-keyed.
    const w = 32;
    const h = 32;
    const original = Buffer.alloc(w * h * 4);
    const keyed = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const inside = x >= 8 && x < 24 && y >= 8 && y < 24;
        const rim = inside && (x === 8 || x === 23 || y === 8 || y === 23);
        const rgb = inside ? (rim ? [110, 78, 150] : [220, 120, 40]) : [0, 36, 245];
        original.set([...rgb, 255], i);
        keyed.set([...rgb, inside ? (rim ? 200 : 255) : 0], i);
      }
    }
    const result = await worker.request(
      { op: 'refine', width: w, height: h, options: { keyColors: ['#0024F5'], band: 2 } },
      Buffer.concat([original, keyed])
    );
    assert.equal(result.payload.length, w * h * 4);
    assert.ok(result.header.stats.bandPixels > 0);
    const at = (x, y) => result.payload[(y * w + x) * 4 + 3];
    assert.equal(at(1, 1), 0, 'backdrop stays transparent');
    assert.equal(at(16, 16), 255, 'interior stays opaque');
    assert.ok(at(8, 16) > 60 && at(8, 16) < 200, `half-mixed rim gets a partial alpha (${at(8, 16)})`);

    await assert.rejects(worker.request({ op: 'refine', width: 4, height: 4 }, Buffer.alloc(3)), /shorter/);
    // The worker survives a bad request.
    assert.equal((await worker.request({ op: 'ping' })).header.ok, true);
  } finally {
    worker.stop();
  }
});
