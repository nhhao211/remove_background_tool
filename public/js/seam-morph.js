/**
 * Seam Morph — motion-compensated blending for loop seams
 * Video Background Remover & Sprite Sheet Studio
 *
 * The loop crossfade mixes a cell with its periodic twin (the frame one loop
 * length away, see planCrossfadeTwins in frame-grid.js). On a good cycle the
 * two show the same pose a few pixels apart; a plain cross-dissolve of two
 * such frames does not move anything — it shows *both* outlines at partial
 * opacity, the double-image "ghost" that reads as a stutter of its own.
 *
 * This module estimates that small displacement (pyramidal Lucas–Kanade on a
 * low-resolution alpha + luma feature image) and blends the two frames at
 * their *meeting point*: at twin share w, the cell is sampled w of the way
 * along the flow and the twin (1−w) of the way back, so a limb sits at one
 * position partway between the two poses instead of at both. Mixing happens
 * on premultiplied linear light, the same maths the dissolve uses, so a
 * zero flow gives the dissolve's result.
 *
 * Safety: the flow is faded where the forward and backward estimates disagree,
 * and only trusted at all when warping the twin by it removes most of the
 * difference to the cell. Unrelated frames, flat frames and
 * identical frames fall back to the plain dissolve, byte for byte.
 *
 * Pure: takes and mutates ImageData-shaped objects ({ data, width, height }),
 * no DOM. Tested by test/seam-morph.test.mjs.
 */

import { SRGB_TO_LINEAR, boxBlurSeparable, linearToSrgb8 } from './keyer/color.js';

/** Long side of the analysis image the flow is estimated on. */
const ANALYSIS_SIDE = 160;
/** Coarsest pyramid level keeps at least this many pixels on its short side. */
const MIN_LEVEL_SIDE = 10;
const MAX_LEVELS = 5;
/** Lucas–Kanade window radius, in analysis pixels. */
const LK_RADIUS = 2;
const LK_ITERATIONS = 5;
/** Tikhonov term: keeps flat, gradient-free areas at the coarse level's flow. */
const LK_LAMBDA = 1e-3;
/**
 * The flow must shrink the cell↔twin difference by at least this share.
 * Measured: true displacements (translation, scale, one limb moved, opaque
 * texture) land at 0.86–0.95; unrelated poses at 0.32–0.43, because LK will
 * still drag a blob toward the nearest blob and explain part of the error.
 */
const MIN_GAIN = 0.6;
/** Forward–backward disagreement (analysis px) at which flow confidence halves. */
const FB_TOLERANCE = 1;
/** …plus this share of the flow magnitude itself. */
const FB_RELATIVE = 0.5;

/**
 * Cross-dissolve in linear light with premultiplied alpha, in place.
 *
 * Exactly the loop of the historical blendLoopTwin: averaging gamma-encoded
 * values lands darker than the light the two frames carry, so the seam would
 * dip in brightness.
 *
 * @param {{data: Uint8ClampedArray}} target - Cell pixels, modified in place
 * @param {{data: Uint8ClampedArray}} twin - Twin pixels, same size
 * @param {number} weight - Share of the twin, 0..1
 */
export function dissolveImageData(target, twin, weight) {
  const w = Math.max(0, Math.min(1, Number(weight) || 0));
  if (!target || !twin || w <= 0) return;
  const cellData = target.data;
  const twinData = twin.data;
  if (!cellData || !twinData || cellData.length !== twinData.length) return;
  const weightCell = 1 - w;

  for (let i = 0; i < cellData.length; i += 4) {
    const wCell = (cellData[i + 3] / 255) * weightCell;
    const wTwin = (twinData[i + 3] / 255) * w;
    const alphaOut = wCell + wTwin;

    if (alphaOut > 0.001) {
      cellData[i] = linearToSrgb8(
        ((SRGB_TO_LINEAR[cellData[i]] * wCell) + (SRGB_TO_LINEAR[twinData[i]] * wTwin)) / alphaOut
      );
      cellData[i + 1] = linearToSrgb8(
        ((SRGB_TO_LINEAR[cellData[i + 1]] * wCell) + (SRGB_TO_LINEAR[twinData[i + 1]] * wTwin)) / alphaOut
      );
      cellData[i + 2] = linearToSrgb8(
        ((SRGB_TO_LINEAR[cellData[i + 2]] * wCell) + (SRGB_TO_LINEAR[twinData[i + 2]] * wTwin)) / alphaOut
      );
      cellData[i + 3] = Math.round(alphaOut * 255);
    } else {
      cellData[i + 3] = 0;
    }
  }
}

/**
 * Area-averaged two-channel feature image: alpha, and alpha-weighted luma.
 * Alpha carries the silhouette on keyed frames; luma carries the texture on
 * opaque ones (where alpha is a constant 1 and contributes nothing).
 */
function featureImage(img, aw, ah) {
  const { data, width: w, height: h } = img;
  const n = aw * ah;
  const A = new Float32Array(n);
  const L = new Float32Array(n);
  const count = new Float32Array(n);
  const colBin = new Int32Array(w);
  for (let x = 0; x < w; x++) colBin[x] = Math.min(aw - 1, Math.floor((x * aw) / w));
  for (let y = 0; y < h; y++) {
    const row = Math.min(ah - 1, Math.floor((y * ah) / h)) * aw;
    let idx = y * w * 4;
    for (let x = 0; x < w; x++, idx += 4) {
      const cell = row + colBin[x];
      const a = data[idx + 3] / 255;
      const luma = ((0.2126 * data[idx]) + (0.7152 * data[idx + 1]) + (0.0722 * data[idx + 2])) / 255;
      A[cell] += a;
      L[cell] += a * luma;
      count[cell] += 1;
    }
  }
  for (let i = 0; i < n; i++) {
    const c = count[i] || 1;
    A[i] /= c;
    L[i] /= c;
  }
  return { channels: [A, L], width: aw, height: ah };
}

/** 2x box downsample of every channel; odd edges fold into the last cell. */
function downsample(level) {
  const { width: w, height: h } = level;
  const nw = Math.max(1, w >> 1);
  const nh = Math.max(1, h >> 1);
  const channels = level.channels.map((src) => {
    const out = new Float32Array(nw * nh);
    const cnt = new Float32Array(nw * nh);
    for (let y = 0; y < h; y++) {
      const ny = Math.min(nh - 1, y >> 1);
      for (let x = 0; x < w; x++) {
        const o = (ny * nw) + Math.min(nw - 1, x >> 1);
        out[o] += src[(y * w) + x];
        cnt[o] += 1;
      }
    }
    for (let i = 0; i < out.length; i++) out[i] /= cnt[i] || 1;
    return out;
  });
  return { channels, width: nw, height: nh };
}

function buildPyramid(base) {
  const levels = [base];
  while (levels.length < MAX_LEVELS) {
    const top = levels[levels.length - 1];
    if (Math.min(top.width, top.height) >> 1 < MIN_LEVEL_SIDE) break;
    levels.push(downsample(top));
  }
  return levels;
}

/** Bilinear sample with clamp-to-edge. */
function sample(src, w, h, x, y) {
  const fx = x < 0 ? 0 : (x > w - 1 ? w - 1 : x);
  const fy = y < 0 ? 0 : (y > h - 1 ? h - 1 : y);
  const x0 = fx | 0;
  const y0 = fy | 0;
  const x1 = x0 + 1 < w ? x0 + 1 : x0;
  const y1 = y0 + 1 < h ? y0 + 1 : y0;
  const tx = fx - x0;
  const ty = fy - y0;
  const top = (src[(y0 * w) + x0] * (1 - tx)) + (src[(y0 * w) + x1] * tx);
  const bottom = (src[(y1 * w) + x0] * (1 - tx)) + (src[(y1 * w) + x1] * tx);
  return (top * (1 - ty)) + (bottom * ty);
}

function warpChannel(src, w, h, u, v) {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w) + x;
      out[i] = sample(src, w, h, x + u[i], y + v[i]);
    }
  }
  return out;
}

/** Mean absolute difference over all channels (per pixel, summed channels). */
function meanAbsDiff(aChannels, bChannels) {
  let acc = 0;
  const n = aChannels[0].length;
  for (let c = 0; c < aChannels.length; c++) {
    const a = aChannels[c];
    const b = bChannels[c];
    for (let i = 0; i < n; i++) acc += Math.abs(a[i] - b[i]);
  }
  return acc / n;
}

/** Upsamples a flow field to a new size, rescaling the vectors with it. */
function resizeFlow(u, v, w, h, nw, nh) {
  const sx = nw / w;
  const sy = nh / h;
  const nu = new Float32Array(nw * nh);
  const nv = new Float32Array(nw * nh);
  for (let y = 0; y < nh; y++) {
    const fy = ((y + 0.5) / sy) - 0.5;
    for (let x = 0; x < nw; x++) {
      const fx = ((x + 0.5) / sx) - 0.5;
      const i = (y * nw) + x;
      nu[i] = sample(u, w, h, fx, fy) * sx;
      nv[i] = sample(v, w, h, fx, fy) * sy;
    }
  }
  return { u: nu, v: nv };
}

/**
 * One pyramid level of iterative Lucas–Kanade: refines (u, v) so that
 * B(x + u, y + v) ≈ A(x, y). Gradients are taken on the mean of A and the
 * warped B, which keeps the update symmetric and steadier than either alone.
 */
function refineLevel(levelA, levelB, u, v, maxShift) {
  const { width: w, height: h } = levelA;
  const n = w * h;
  const Ixx = new Float32Array(n);
  const Ixy = new Float32Array(n);
  const Iyy = new Float32Array(n);
  const Ixt = new Float32Array(n);
  const Iyt = new Float32Array(n);

  for (let iter = 0; iter < LK_ITERATIONS; iter++) {
    Ixx.fill(0);
    Ixy.fill(0);
    Iyy.fill(0);
    Ixt.fill(0);
    Iyt.fill(0);

    for (let c = 0; c < levelA.channels.length; c++) {
      const A = levelA.channels[c];
      const Bw = warpChannel(levelB.channels[c], w, h, u, v);
      for (let y = 0; y < h; y++) {
        const ym = y > 0 ? y - 1 : y;
        const yp = y < h - 1 ? y + 1 : y;
        const dyScale = yp - ym || 1;
        for (let x = 0; x < w; x++) {
          const xm = x > 0 ? x - 1 : x;
          const xp = x < w - 1 ? x + 1 : x;
          const dxScale = xp - xm || 1;
          const i = (y * w) + x;
          const ix = (((A[(y * w) + xp] + Bw[(y * w) + xp]) - (A[(y * w) + xm] + Bw[(y * w) + xm])) * 0.5) / dxScale;
          const iy = (((A[(yp * w) + x] + Bw[(yp * w) + x]) - (A[(ym * w) + x] + Bw[(ym * w) + x])) * 0.5) / dyScale;
          const it = Bw[i] - A[i];
          Ixx[i] += ix * ix;
          Ixy[i] += ix * iy;
          Iyy[i] += iy * iy;
          Ixt[i] += ix * it;
          Iyt[i] += iy * it;
        }
      }
    }

    for (const field of [Ixx, Ixy, Iyy, Ixt, Iyt]) boxBlurSeparable(field, w, h, LK_RADIUS);

    for (let i = 0; i < n; i++) {
      const a = Ixx[i] + LK_LAMBDA;
      const b = Ixy[i];
      const d = Iyy[i] + LK_LAMBDA;
      const det = (a * d) - (b * b);
      if (!(det > 1e-12)) continue;
      // Solve [a b; b d] [du dv] = -[Ixt Iyt]; a step is capped at one pixel
      // so a bad linearisation cannot fling the field across the frame.
      let du = (-(d * Ixt[i]) + (b * Iyt[i])) / det;
      let dv = ((b * Ixt[i]) - (a * Iyt[i])) / det;
      du = du > 1 ? 1 : (du < -1 ? -1 : du);
      dv = dv > 1 ? 1 : (dv < -1 ? -1 : dv);
      let nu = u[i] + du;
      let nv = v[i] + dv;
      nu = nu > maxShift ? maxShift : (nu < -maxShift ? -maxShift : nu);
      nv = nv > maxShift ? maxShift : (nv < -maxShift ? -maxShift : nv);
      u[i] = nu;
      v[i] = nv;
    }

    // Light regularisation: a seam displacement is a smooth field.
    boxBlurSeparable(u, w, h, 1);
    boxBlurSeparable(v, w, h, 1);
  }
}

/**
 * Estimates how far content moved from `a` to `b`: b(x + u) ≈ a(x).
 *
 * @param {{data: Uint8ClampedArray, width: number, height: number}} a - Cell
 * @param {{data: Uint8ClampedArray, width: number, height: number}} b - Twin, same size
 * @param {{analysisSide?: number}} [options]
 * @returns {{u: Float32Array, v: Float32Array, width: number, height: number,
 *   errorBefore: number, errorAfter: number, gain: number, consistency: number,
 *   meanShift: number}|null}|null}
 *   Flow on the analysis grid, in analysis pixels; null on bad input.
 */
export function estimateSeamFlow(a, b, options = {}) {
  if (!a || !b || !a.data || !b.data) return null;
  const w = a.width;
  const h = a.height;
  if (!(w > 0) || !(h > 0) || b.width !== w || b.height !== h || a.data.length !== b.data.length) return null;

  const side = Math.max(16, Math.round(Number(options.analysisSide) || ANALYSIS_SIDE));
  const scale = Math.min(1, side / Math.max(w, h));
  const aw = Math.max(1, Math.round(w * scale));
  const ah = Math.max(1, Math.round(h * scale));

  const pyrA = buildPyramid(featureImage(a, aw, ah));
  const pyrB = buildPyramid(featureImage(b, aw, ah));
  const base = pyrA[0];
  const errorBefore = meanAbsDiff(base.channels, pyrB[0].channels);

  const forward = pyramidFlow(pyrA, pyrB);
  const backward = pyramidFlow(pyrB, pyrA);
  const { u, v } = forward;

  // Forward–backward consistency. Where a real displacement exists, following
  // the flow from the cell into the twin and the twin's flow back lands where
  // it started. Two unrelated poses still get *a* flow from LK (it will drag a
  // blob toward the nearest blob), but the two directions disagree, so the
  // flow there is faded out and the blend falls back to a dissolve locally.
  let consistent = 0;
  for (let y = 0; y < ah; y++) {
    for (let x = 0; x < aw; x++) {
      const i = (y * aw) + x;
      const tx = x + u[i];
      const ty = y + v[i];
      const ex = u[i] + sample(backward.u, aw, ah, tx, ty);
      const ey = v[i] + sample(backward.v, aw, ah, tx, ty);
      const err = Math.hypot(ex, ey);
      // Textureless interiors only get flow by propagation, so their round trip
      // is loose in proportion to the move; the tolerance scales with it.
      const tol = FB_TOLERANCE + (FB_RELATIVE * Math.hypot(u[i], v[i]));
      const conf = 1 / (1 + ((err / tol) ** 2));
      u[i] *= conf;
      v[i] *= conf;
      if (conf > 0.5) consistent++;
    }
  }
  boxBlurSeparable(u, aw, ah, 1);
  boxBlurSeparable(v, aw, ah, 1);

  const warped = pyrB[0].channels.map((ch) => warpChannel(ch, aw, ah, u, v));
  const errorAfter = meanAbsDiff(base.channels, warped);
  const gain = errorBefore > 1e-9 ? 1 - (errorAfter / errorBefore) : 0;

  let shiftSum = 0;
  for (let i = 0; i < u.length; i++) shiftSum += Math.hypot(u[i], v[i]);

  return {
    u,
    v,
    width: aw,
    height: ah,
    errorBefore,
    errorAfter,
    gain,
    consistency: consistent / u.length,
    meanShift: (shiftSum / u.length) / scale
  };
}

/** Coarse-to-fine flow over two pyramids: pyrB(x + flow) ≈ pyrA(x) at level 0. */
function pyramidFlow(pyrA, pyrB) {
  let top = pyrA[pyrA.length - 1];
  let u = new Float32Array(top.width * top.height);
  let v = new Float32Array(top.width * top.height);
  for (let l = pyrA.length - 1; l >= 0; l--) {
    const levelA = pyrA[l];
    if (levelA.width !== top.width || levelA.height !== top.height) {
      ({ u, v } = resizeFlow(u, v, top.width, top.height, levelA.width, levelA.height));
    }
    // A seam twin is the same pose a little off; anything past a quarter of
    // the frame is not a displacement this blend should act on.
    const maxShift = 0.25 * Math.min(levelA.width, levelA.height);
    refineLevel(levelA, pyrB[l], u, v, maxShift);
    top = levelA;
  }
  return { u, v };
}

/** RGBA8 → premultiplied linear float RGBA. */
function toPremultipliedLinear(data) {
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] / 255;
    out[i] = SRGB_TO_LINEAR[data[i]] * a;
    out[i + 1] = SRGB_TO_LINEAR[data[i + 1]] * a;
    out[i + 2] = SRGB_TO_LINEAR[data[i + 2]] * a;
    out[i + 3] = a;
  }
  return out;
}

/** Bilinear sample of a premultiplied RGBA float buffer, clamp-to-edge, into out[0..3]. */
function samplePremultiplied(buf, w, h, x, y, out) {
  const fx = x < 0 ? 0 : (x > w - 1 ? w - 1 : x);
  const fy = y < 0 ? 0 : (y > h - 1 ? h - 1 : y);
  const x0 = fx | 0;
  const y0 = fy | 0;
  const x1 = x0 + 1 < w ? x0 + 1 : x0;
  const y1 = y0 + 1 < h ? y0 + 1 : y0;
  const tx = fx - x0;
  const ty = fy - y0;
  const w00 = (1 - tx) * (1 - ty);
  const w10 = tx * (1 - ty);
  const w01 = (1 - tx) * ty;
  const w11 = tx * ty;
  const i00 = ((y0 * w) + x0) * 4;
  const i10 = ((y0 * w) + x1) * 4;
  const i01 = ((y1 * w) + x0) * 4;
  const i11 = ((y1 * w) + x1) * 4;
  for (let c = 0; c < 4; c++) {
    out[c] = (buf[i00 + c] * w00) + (buf[i10 + c] * w10) + (buf[i01 + c] * w01) + (buf[i11 + c] * w11);
  }
}

/**
 * Blends a loop cell with its twin at their meeting point, in place.
 *
 * Falls back to dissolveImageData (byte-identical to the plain crossfade) when
 * the flow does not explain the difference between the two frames.
 *
 * @param {{data: Uint8ClampedArray, width: number, height: number}} target - Cell, modified in place
 * @param {{data: Uint8ClampedArray, width: number, height: number}} twin - Twin, same size
 * @param {number} weight - Share of the twin, 0..1
 * @param {{analysisSide?: number, minGain?: number}} [options]
 * @returns {{mode: ('morph'|'dissolve'|'none'), gain: number, meanShift: number}}
 */
export function morphBlendImageData(target, twin, weight, options = {}) {
  const w = Math.max(0, Math.min(1, Number(weight) || 0));
  if (!target || !twin || w <= 0) return { mode: 'none', gain: 0, meanShift: 0 };

  const flow = estimateSeamFlow(target, twin, options);
  const minGain = Number.isFinite(Number(options.minGain)) ? Number(options.minGain) : MIN_GAIN;
  // Below half a pixel the warp is invisible; the dissolve is then exact.
  if (!flow || flow.errorBefore < 1e-4 || flow.gain < minGain || flow.meanShift < 0.5) {
    dissolveImageData(target, twin, w);
    return { mode: 'dissolve', gain: flow ? flow.gain : 0, meanShift: flow ? flow.meanShift : 0 };
  }

  const width = target.width;
  const height = target.height;
  const { u: fu, v: fv } = resizeFlow(flow.u, flow.v, flow.width, flow.height, width, height);
  const cell = toPremultipliedLinear(target.data);
  const other = toPremultipliedLinear(twin.data);
  const out = target.data;
  const sa = new Float32Array(4);
  const sb = new Float32Array(4);
  const wa = 1 - w;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = (y * width) + x;
      const dx = fu[p];
      const dy = fv[p];
      // A feature at x in the cell sits at x + flow in the twin; at twin share
      // w it is drawn w of the way along, so look back w·flow into the cell
      // and forward (1−w)·flow into the twin.
      samplePremultiplied(cell, width, height, x - (w * dx), y - (w * dy), sa);
      samplePremultiplied(other, width, height, x + (wa * dx), y + (wa * dy), sb);
      const alpha = (sa[3] * wa) + (sb[3] * w);
      const i = p * 4;
      if (alpha > 0.001) {
        out[i] = linearToSrgb8(((sa[0] * wa) + (sb[0] * w)) / alpha);
        out[i + 1] = linearToSrgb8(((sa[1] * wa) + (sb[1] * w)) / alpha);
        out[i + 2] = linearToSrgb8(((sa[2] * wa) + (sb[2] * w)) / alpha);
        out[i + 3] = Math.round(alpha * 255);
      } else {
        out[i + 3] = 0;
      }
    }
  }

  return { mode: 'morph', gain: flow.gain, meanShift: flow.meanShift };
}
