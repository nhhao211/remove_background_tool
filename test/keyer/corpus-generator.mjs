/**
 * Synthetic corpus for the chroma-key regression harness.
 *
 * Every clip is a pure function of its seed and frame index, so regenerating the
 * corpus reproduces the committed fixtures byte for byte. That is what lets a
 * baseline mean anything: a diff can then only come from the keyer.
 *
 * Because each subject is drawn from known analytic coverage, clips 1, 2 and 7
 * also emit a ground-truth matte. Those mattes are what phases 6 and 7 measure
 * `bandSAD` against — a real corpus cannot supply them.
 *
 * This is a bootstrap corpus, not a substitute for footage. See fixtures/real/
 * for the clips that still have to be shot before phase 3 can be tuned.
 */

import path from 'node:path';
import fs from 'node:fs/promises';

import {
  ImageData,
  createRng,
  fillRect,
  fillRectTranslucent,
  fillCircle,
  drawLine,
  verticalGradient,
  addNoise,
  blitInto
} from './image.mjs';
import { savePNG } from './png.mjs';

/** Sampled from real cyclorama footage rather than a pure primary: a saturated
 *  [0,255,0] makes despill degenerate and hides the bugs we care about. */
export const KEY_GREEN = { r: 24, g: 198, b: 62 };
export const KEY_BLUE = { r: 38, g: 72, b: 196 };

const WHITE = [255, 255, 255];
const FRAME_SIZE = 256;

function newFrame(background) {
  const image = new ImageData(FRAME_SIZE, FRAME_SIZE);
  fillRect(image, 0, 0, FRAME_SIZE, FRAME_SIZE, background);
  return image;
}

function newMatte() {
  const matte = new ImageData(FRAME_SIZE, FRAME_SIZE);
  fillRect(matte, 0, 0, FRAME_SIZE, FRAME_SIZE, [0, 0, 0]);
  return matte;
}

const rgb = (color) => [color.r, color.g, color.b];

/** Clip 1 — fine strand detail against a clean screen. The strands are the
 *  1–2 px structures that erosion destroys and the guided filter must keep. */
function drawClip1(frameIndex) {
  const frame = newFrame(rgb(KEY_GREEN));
  const matte = newMatte();
  const rng = createRng(0x51c1 + frameIndex);
  const drift = frameIndex * 1.5;

  const body = [188, 46, 38];
  fillCircle(frame, 128 + drift, 150, 52, body);
  fillCircle(matte, 128 + drift, 150, 52, WHITE);

  for (let i = 0; i < 24; i += 1) {
    const angle = (Math.PI * (0.15 + (0.7 * (i / 23)))) + (rng() * 0.05);
    const length = 34 + (rng() * 26);
    const x0 = 128 + drift + (Math.cos(angle + Math.PI) * 44);
    const y0 = 150 - (Math.sin(angle) * 30);
    const x1 = x0 + (Math.cos(angle + Math.PI) * length * 0.3);
    const y1 = y0 - (Math.sin(angle) * length);
    const thickness = 0.9 + (rng() * 0.8);
    drawLine(frame, x0, y0, x1, y1, thickness, body);
    drawLine(matte, x0, y0, x1, y1, thickness, WHITE);
  }

  return { frame, matte };
}

/** Clip 2 — motion blur and genuine translucency. Graduated alpha here must not
 *  binarise; a keyer that hard-thresholds shows up immediately. */
function drawClip2(frameIndex) {
  const frame = newFrame(rgb(KEY_GREEN));
  const matte = newMatte();
  const shift = frameIndex * 6;

  for (let step = 0; step < 16; step += 1) {
    const alpha = 0.12 + (0.055 * step);
    const x = 62 + shift + (step * 4);
    fillRectTranslucent(frame, x, 96, 18, 64, [40, 60, 200], alpha);
    fillRectTranslucent(matte, x, 96, 18, 64, WHITE, alpha);
  }

  fillCircle(frame, 168 + shift, 128, 26, [40, 60, 200]);
  fillCircle(matte, 168 + shift, 128, 26, WHITE);

  return { frame, matte };
}

/** Clip 3 — subject hue sits close to the key. This is where a per-key
 *  Euclidean min() eats the subject and a covariance model should not. */
function drawClip3(frameIndex) {
  const frame = newFrame(rgb(KEY_GREEN));
  const drift = frameIndex * 2;
  fillCircle(frame, 128, 128 + drift, 58, [72, 168, 88]);
  fillCircle(frame, 128, 108 + drift, 22, [96, 190, 104]);
  return { frame, matte: null };
}

/** Clip 4 — unevenly lit screen with grain and a cast shadow. A single global
 *  threshold cannot serve both corners of this frame. */
function drawClip4(frameIndex) {
  const frame = new ImageData(FRAME_SIZE, FRAME_SIZE);
  verticalGradient(frame, [34, 214, 74], [14, 148, 44]);
  addNoise(frame, 0.05, createRng(0x4a11 + frameIndex));
  fillRectTranslucent(frame, 0, 176, FRAME_SIZE, 80, [0, 0, 0], 0.22);
  fillCircle(frame, 120 + (frameIndex * 3), 126, 50, [206, 132, 48]);
  return { frame, matte: null };
}

/** Clip 5 — clip 1 content under a different seed, reserved as the control pair
 *  for the yuv420p vs lossless comparison once real footage lands. */
function drawClip5(frameIndex) {
  const { frame } = drawClip1(frameIndex);
  addNoise(frame, 0.02, createRng(0x5e5e + frameIndex));
  return { frame, matte: null };
}

/** Clip 6 — two distinct key colours in one frame. */
function drawClip6(frameIndex) {
  const frame = new ImageData(FRAME_SIZE, FRAME_SIZE);
  fillRect(frame, 0, 0, FRAME_SIZE / 2, FRAME_SIZE, rgb(KEY_GREEN));
  fillRect(frame, FRAME_SIZE / 2, 0, FRAME_SIZE / 2, FRAME_SIZE, rgb(KEY_BLUE));
  fillCircle(frame, 128, 128 + (frameIndex * 2), 54, [214, 96, 40]);
  return { frame, matte: null };
}

/** Clip 7 — a key-coloured hole fully enclosed by the subject. Connectivity
 *  decides this one: an unconnected keyer punches the hole through, a
 *  flood-filled keyer keeps it opaque. */
function drawClip7(frameIndex) {
  const frame = newFrame(rgb(KEY_GREEN));
  const matte = newMatte();
  const drift = frameIndex * 2;

  fillCircle(frame, 128, 128 + drift, 72, [222, 108, 36]);
  fillCircle(matte, 128, 128 + drift, 72, WHITE);
  fillCircle(frame, 128, 128 + drift, 34, rgb(KEY_GREEN));
  fillCircle(matte, 128, 128 + drift, 34, WHITE);

  return { frame, matte };
}

const VIDEO_CLIPS = [
  { name: 'clip-01', draw: drawClip1, label: 'Fine strand detail on a clean screen' },
  { name: 'clip-02', draw: drawClip2, label: 'Motion blur and translucency' },
  { name: 'clip-03', draw: drawClip3, label: 'Subject hue close to the key' },
  { name: 'clip-04', draw: drawClip4, label: 'Uneven screen, grain and cast shadow' },
  { name: 'clip-05', draw: drawClip5, label: 'Clip 1 content, compression control pair' },
  { name: 'clip-06', draw: drawClip6, label: 'Two key colours in one frame' },
  { name: 'clip-07', draw: drawClip7, label: 'Enclosed key-coloured hole' }
];

const FRAMES_PER_CLIP = 4;

/**
 * Video-path settings. Mirrors the option names the direct matte actually
 * reads — note `blend`, which the sheet path spells `feather`.
 */
function videoSettings(keyColors, label) {
  return {
    path: 'video',
    label,
    keyColors,
    options: {
      enabled: true,
      similarity: 0.55,
      blend: 0.18,
      spill: 0.55,
      subjectProtection: 0.5,
      cleanupRadius: 0
    }
  };
}

export async function generateCorpus(baseDir) {
  for (const clip of VIDEO_CLIPS) {
    const clipDir = path.join(baseDir, clip.name);
    await fs.mkdir(clipDir, { recursive: true });

    for (let frameIndex = 0; frameIndex < FRAMES_PER_CLIP; frameIndex += 1) {
      const { frame, matte } = clip.draw(frameIndex);
      const suffix = String(frameIndex).padStart(3, '0');
      await savePNG(frame, path.join(clipDir, `frame-${suffix}.png`));
      if (matte) {
        await savePNG(matte, path.join(clipDir, `matte-${suffix}.png`));
      }
    }

    const keyColors = clip.name === 'clip-06'
      ? [{ ...KEY_GREEN }, { ...KEY_BLUE }]
      : [{ ...KEY_GREEN }];

    await fs.writeFile(
      path.join(clipDir, 'settings.json'),
      `${JSON.stringify(videoSettings(keyColors, clip.label), null, 2)}\n`
    );
  }

  // Clip 8 — sprite sheet, 2x2, exercising the connected/per-cell path.
  const sheetDir = path.join(baseDir, 'clip-08');
  await fs.mkdir(sheetDir, { recursive: true });

  const sheet = new ImageData(FRAME_SIZE * 2, FRAME_SIZE * 2);
  fillRect(sheet, 0, 0, sheet.width, sheet.height, rgb(KEY_GREEN));
  blitInto(sheet, drawClip1(0).frame, 0, 0);
  blitInto(sheet, drawClip7(0).frame, FRAME_SIZE, 0);
  blitInto(sheet, drawClip2(1).frame, 0, FRAME_SIZE);
  blitInto(sheet, drawClip3(2).frame, FRAME_SIZE, FRAME_SIZE);
  await savePNG(sheet, path.join(sheetDir, 'sheet.png'));

  const sheetSettings = {
    path: 'sheet',
    label: 'Sprite sheet, 2x2 cells',
    keyColors: [{ ...KEY_GREEN }],
    options: {
      similarity: 0.48,
      feather: 0.2,
      spill: 0.55,
      subjectProtection: 0.55,
      cleanupRadius: 0,
      preserveColors: true,
      autoDetect: false,
      rows: 2,
      cols: 2
    },
    // Both cell modes are covered: `global` keys the sheet in one pass,
    // `per-cell` runs the cell loop. The cell loop is the path that silently
    // does nothing if the sheet dispatch is ever stubbed out.
    variants: [
      { name: 'global', perCell: false },
      { name: 'per-cell', perCell: true },
      { name: 'auto-detect', perCell: false, autoDetect: true, keyColors: [] }
    ]
  };

  await fs.writeFile(
    path.join(sheetDir, 'settings.json'),
    `${JSON.stringify(sheetSettings, null, 2)}\n`
  );

  return { videoClips: VIDEO_CLIPS.length, framesPerClip: FRAMES_PER_CLIP, sheets: 1 };
}

export const CLIP_NAMES = [...VIDEO_CLIPS.map((clip) => clip.name), 'clip-08'];
export { FRAMES_PER_CLIP };
