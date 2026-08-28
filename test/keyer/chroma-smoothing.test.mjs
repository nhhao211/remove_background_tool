import { describe, it, expect } from 'vitest';
import { JS_DIR, loadKeyer, readSettings, FIXTURES_DIR } from './keyer-runner.mjs';
import { coreRGBDelta } from './metrics.mjs';
import { cloneImageData } from './image.mjs';
import { loadPNG } from './png.mjs';
import path from 'node:path';

const color = await import(new URL(`file://${JS_DIR}/keyer/color.js`).href);
const { chromaSmoothedCopy, toLinearBuffer } = color;

const VIDEO_CLIPS = ['clip-01', 'clip-02', 'clip-07'];

function makeImageData(width, height, fill) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const [r, g, b, a] = fill(i % width, (i / width) | 0);
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = a;
  }
  return { data, width, height };
}

async function loadFrame(clipName) {
  return loadPNG(path.join(FIXTURES_DIR, clipName, 'frame-000.png'));
}

describe('chroma smoothing (phase 4)', () => {
  describe('chromaSmoothedCopy leaves its input alone', () => {
    it('returns a distinct buffer and does not touch the source RGB', () => {
      const image = makeImageData(16, 16, (x, y) => [x * 15, 255 - (y * 15), (x ^ y) * 15, 255]);
      const buffer = toLinearBuffer(image);
      const before = {
        r: Float32Array.from(buffer.r),
        g: Float32Array.from(buffer.g),
        b: Float32Array.from(buffer.b)
      };

      const smoothed = chromaSmoothedCopy(buffer, 2);

      expect(smoothed.r).not.toBe(buffer.r);
      expect(smoothed.g).not.toBe(buffer.g);
      expect(smoothed.b).not.toBe(buffer.b);
      expect(Array.from(buffer.r)).toEqual(Array.from(before.r));
      expect(Array.from(buffer.g)).toEqual(Array.from(before.g));
      expect(Array.from(buffer.b)).toEqual(Array.from(before.b));
    });

    it('actually changes chroma at a hard colour boundary', () => {
      // Left half pure green, right half pure magenta: the sharpest possible
      // chroma step. If the blur ran, the columns either side of the seam move.
      const image = makeImageData(16, 16, (x) => (x < 8 ? [0, 255, 0, 255] : [255, 0, 255, 255]));
      const buffer = toLinearBuffer(image);
      const smoothed = chromaSmoothedCopy(buffer, 2);

      const seam = 8;
      const index = (8 * 16) + seam;
      expect(smoothed.g[index]).not.toBeCloseTo(buffer.g[index], 5);
    });

    it('is a no-op at radius 0, but still a copy', () => {
      const image = makeImageData(8, 8, (x, y) => [x * 30, y * 30, 120, 255]);
      const buffer = toLinearBuffer(image);
      const smoothed = chromaSmoothedCopy(buffer, 0);

      expect(smoothed.r).not.toBe(buffer.r);
      expect(Array.from(smoothed.r)).toEqual(Array.from(buffer.r));
      expect(Array.from(smoothed.g)).toEqual(Array.from(buffer.g));
      expect(Array.from(smoothed.b)).toEqual(Array.from(buffer.b));
    });
  });

  describe('runKeyer wiring', () => {
    it('is off unless the caller asks for it', async () => {
      // The plan defaults smoothing off for image sources and on for video, and
      // requires that off reproduces phase 3 byte for byte. The keyer cannot
      // know the source type, so silence means off and app.js opts video in.
      const keyer = await loadKeyer();
      for (const clipName of VIDEO_CLIPS) {
        const settings = await readSettings(clipName);
        const source = await loadFrame(clipName);
        const options = { ...settings.options, keyColors: settings.keyColors };

        const silent = keyer.runVideo(cloneImageData(source), options);
        const explicitlyOff = keyer.runVideo(cloneImageData(source), {
          ...options,
          chromaSmoothEnabled: false
        });

        expect(Array.from(silent.data), `${clipName}: default differs from explicit off`)
          .toEqual(Array.from(explicitlyOff.data));
      }
    });

    it('changes the matte when it is switched on', async () => {
      // Guards against the defect this test was written for: the radius default
      // was read as `Number(options.chromaSmoothRadius) ?? 1`, which is NaN, so
      // `NaN > 0` was false and the feature never ran while reporting enabled.
      const keyer = await loadKeyer();
      const settings = await readSettings('clip-01');
      const source = await loadFrame('clip-01');
      const options = { ...settings.options, keyColors: settings.keyColors };

      const off = keyer.runVideo(cloneImageData(source), options);
      const onDefaultRadius = keyer.runVideo(cloneImageData(source), {
        ...options,
        chromaSmoothEnabled: true
      });

      let alphaDiff = 0;
      for (let offset = 3; offset < off.data.length; offset += 4) {
        alphaDiff += Math.abs(off.data[offset] - onDefaultRadius.data[offset]);
      }
      expect(alphaDiff, 'enabling smoothing without a radius did nothing').toBeGreaterThan(0);
    });

    it('honours an explicit radius of 0 as off', async () => {
      const keyer = await loadKeyer();
      const settings = await readSettings('clip-01');
      const source = await loadFrame('clip-01');
      const options = { ...settings.options, keyColors: settings.keyColors };

      const off = keyer.runVideo(cloneImageData(source), options);
      const zeroRadius = keyer.runVideo(cloneImageData(source), {
        ...options,
        chromaSmoothEnabled: true,
        chromaSmoothRadius: 0
      });

      expect(Array.from(zeroRadius.data)).toEqual(Array.from(off.data));
    });
  });

  describe('smoothed chroma never reaches the exported colour', () => {
    // Phase 4's stated proof. Smoothing exists to steady the keying *decision*
    // where 4:2:0 upsampling smeared the chroma edge; if it also rewrote output
    // colour, every pixel would carry the blur and the phase would be a net loss.
    // A previous implementation smoothed the buffer in place and handed the same
    // one to both the matte and the encoder, which is exactly that failure.
    //
    // Despill has to be held out to see this cleanly. It reads the unsmoothed
    // buffer for the colour it writes, but its *strength* comes from the spill
    // band, and the band is a decision — so a better decision legitimately moves
    // it. With despill off there is no such path, and the two runs must agree to
    // the byte.
    it.each(VIDEO_CLIPS)('%s: identical core colour with despill held out', async (clipName) => {
      const keyer = await loadKeyer();
      const settings = await readSettings(clipName);
      const source = await loadFrame(clipName);
      const options = { ...settings.options, spill: 0, keyColors: settings.keyColors };

      const off = keyer.runVideo(cloneImageData(source), options);
      const on = keyer.runVideo(cloneImageData(source), {
        ...options,
        chromaSmoothEnabled: true,
        chromaSmoothRadius: 1
      });

      expect(coreRGBDelta(on.data, off.data)).toBe(0);
    });

    // And with despill live, the movement it is allowed must stay far below a
    // single 8-bit step on average. A leak of the blur itself would not: the
    // smoothed and unsmoothed buffers differ by whole levels at a chroma edge.
    it.each(VIDEO_CLIPS)('%s: despill drift stays under one 8-bit level', async (clipName) => {
      const keyer = await loadKeyer();
      const settings = await readSettings(clipName);
      const source = await loadFrame(clipName);
      const options = { ...settings.options, keyColors: settings.keyColors };

      const off = keyer.runVideo(cloneImageData(source), options);
      const on = keyer.runVideo(cloneImageData(source), {
        ...options,
        chromaSmoothEnabled: true,
        chromaSmoothRadius: 1
      });

      const delta = coreRGBDelta(on.data, off.data);
      expect(delta).toBeGreaterThan(0);
      expect(delta).toBeLessThan(1);
    });
  });
});
