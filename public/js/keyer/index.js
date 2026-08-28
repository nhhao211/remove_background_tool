import { applyConnectedMatte, applyDirectMatte, keyBufferLinear } from './matte.js';
import { toLinearBuffer, toSrgbImageData, chromaSmoothedCopy } from './color.js';
import { copyRegion, pasteRegion } from './regions.js';

export { detectEdgeColors } from './background.js';

/**
 * The single entry point for keying.
 *
 * Before this module there were two independent implementations — one for the
 * video timeline, one for sprite sheets — with duplicated helpers that had
 * already drifted apart in their constants. Callers picked one by importing it,
 * and nothing checked that the options they passed were the ones that path
 * actually reads.
 *
 * This phase moved both implementations here without changing any arithmetic.
 * The regression harness asserts byte-identical output against the committed
 * baseline, so anything that shifted here is a bug, not a decision.
 *
 * Phase 3 moves the video path to linear-light float buffers for precision.
 * Phase 4 adds chroma smoothing for 4:2:0 H.264 sources.
 */

const COMMON_OPTIONS = new Set([
  'connected',
  'thresholdProfile',
  'keyColors',
  'similarity',
  'spill',
  'subjectProtection',
  'cleanupRadius'
]);

const VIDEO_OPTIONS = new Set([
  'enabled',
  'blend',
  'protectionMask',
  'protectedDecontamination',
  'chromaSmoothRadius',
  'chromaSmoothEnabled'
]);

const SHEET_OPTIONS = new Set([
  'feather',
  'autoDetect',
  'keyRegions',
  'preserveColors',
  'seedPoints',
  'maxColors',
  'edgeDepth',
  'rows',
  'cols',
  'perCell',
  'sheetWidth',
  'sheetHeight',
  'offsetX',
  'offsetY'
]);

const NUMERIC_OPTIONS = new Set([
  'similarity',
  'blend',
  'feather',
  'spill',
  'subjectProtection',
  'cleanupRadius',
  'protectedDecontamination',
  'maxColors',
  'edgeDepth',
  'rows',
  'cols',
  'sheetWidth',
  'sheetHeight',
  'offsetX',
  'offsetY',
  'chromaSmoothRadius'
]);

/**
 * Rejects options the chosen path does not read, and numbers that are not
 * numbers.
 *
 * Both failures used to be silent. Passing `blend` to the sheet path did
 * nothing at all, because that path reads `feather` — the slider moved and the
 * output did not change. And a bare `parseFloat('')` from an empty input
 * produced NaN, which `clamp01` turned into 0, which keyed nothing while
 * reporting success. Callers now hear about it.
 */
export function assertOptions(options, { connected }) {
  const allowed = connected ? SHEET_OPTIONS : VIDEO_OPTIONS;
  const pathName = connected ? 'connected' : 'direct';
  for (const key of Object.keys(options)) {
    if (COMMON_OPTIONS.has(key) || allowed.has(key)) continue;
    const otherPath = connected ? VIDEO_OPTIONS : SHEET_OPTIONS;
    const hint = otherPath.has(key)
      ? ` — that option belongs to the ${connected ? 'direct' : 'connected'} path`
      : '';
    throw new TypeError(`runKeyer: unknown option "${key}" for the ${pathName} path${hint}`);
  }
  for (const key of NUMERIC_OPTIONS) {
    if (options[key] === undefined) continue;
    if (!Number.isFinite(Number(options[key]))) {
      throw new TypeError(`runKeyer: option "${key}" must be a finite number, received ${JSON.stringify(options[key])}`);
    }
  }
}

function runSheet(imageData, options) {
  const rows = Math.max(1, Math.min(100, Math.round(options.rows || 1)));
  const cols = Math.max(1, Math.min(100, Math.round(options.cols || 1)));
  if (!options.perCell || (rows === 1 && cols === 1)) {
    return applyConnectedMatte(imageData, options);
  }

  const allColors = [];
  let removedPixels = 0;
  for (let row = 0; row < rows; row += 1) {
    const y0 = Math.floor((row * imageData.height) / rows);
    const y1 = Math.floor(((row + 1) * imageData.height) / rows);
    for (let col = 0; col < cols; col += 1) {
      const x0 = Math.floor((col * imageData.width) / cols);
      const x1 = Math.floor(((col + 1) * imageData.width) / cols);
      const region = copyRegion(imageData, x0, y0, x1 - x0, y1 - y0);
      const seedPoints = (Array.isArray(options.seedPoints) ? options.seedPoints : [])
        .filter((point) => point.x >= x0 && point.x < x1 && point.y >= y0 && point.y < y1)
        .map((point) => ({ x: point.x - x0, y: point.y - y0 }));
      const result = applyConnectedMatte(region, {
        ...options,
        seedPoints,
        sheetWidth: imageData.width,
        sheetHeight: imageData.height,
        offsetX: x0,
        offsetY: y0
      });
      pasteRegion(imageData, result.imageData, x0, y0);
      removedPixels += result.removedPixels;
      for (const color of result.keyColors) {
        if (!allColors.some((item) => Math.abs(item.r - color.r) + Math.abs(item.g - color.g) + Math.abs(item.b - color.b) < 18)) {
          allColors.push(color);
        }
      }
    }
  }
  return { imageData, keyColors: allColors.slice(0, 12), removedPixels };
}

/**
 * Keys `imageData` in place and returns it alongside what was used and removed.
 *
 * `connected: true` selects border-connected flood fill (sprite sheets, where
 * an enclosed pocket of backdrop inside the subject must survive). The default
 * is the direct colour-distance matte used by the video timeline, which keys
 * such a pocket out.
 *
 * `thresholdProfile` names which constant set applies. It is redundant with
 * `connected` today and only the matching pair is defined, but the two are
 * separate concepts — connectivity is a strategy, the constants are tuning —
 * and phase 3 reconciles the constants without touching connectivity. Passing a
 * mismatched pair throws rather than silently picking one.
 *
 * @returns {{ imageData: ImageData, keyColors: Array, removedPixels: number }}
 */
export function runKeyer(imageData, options = {}) {
  const connected = options.connected === true;
  assertOptions(options, { connected });

  const expectedProfile = connected ? 'sheet' : 'video';
  const thresholdProfile = options.thresholdProfile ?? expectedProfile;
  if (thresholdProfile !== expectedProfile) {
    throw new TypeError(
      `runKeyer: thresholdProfile "${thresholdProfile}" has no defined constants with connected=${connected}; `
      + `expected "${expectedProfile}"`
    );
  }

  if (connected) return runSheet(imageData, options);

  // Phase 3: Linear-light keying with linear float buffers
  // Phase 4: Chroma smoothing for 4:2:0 subsampling artifacts
  const buffer = toLinearBuffer(imageData);

  // Phase 4: smoothed chroma feeds the keying *decision* only. The phase file
  // requires output colour to come from the unsmoothed buffer, so the smoothing
  // runs on a copy and is handed to the keyer as `decisionRgb`. Smoothing in
  // place would collapse that separation and bake 4:2:0 upsampling error into
  // every exported pixel.
  //
  // Smoothing corrects 4:2:0 chroma subsampling, which only H.264/VP9 sources
  // have. On a PNG sprite sheet there is nothing to correct and the blur is pure
  // loss — it softened otherwise-exact edges across the whole corpus. So this is
  // opt-in, and the caller declares the source: app.js enables it for video.
  //
  // `Number(undefined)` is NaN rather than undefined, so `??` cannot supply the
  // radius default: reading it that way yielded NaN, `NaN > 0` was false, and
  // the feature was silently off even where it was asked for.
  const rawRadius = Number(options.chromaSmoothRadius);
  const chromaSmoothRadius = Number.isFinite(rawRadius) ? Math.max(0, rawRadius) : 1;
  const chromaSmoothEnabled = options.chromaSmoothEnabled === true;

  let decisionRgb = null;
  if (chromaSmoothEnabled && chromaSmoothRadius > 0) {
    decisionRgb = chromaSmoothedCopy(buffer, chromaSmoothRadius);
  }

  keyBufferLinear(buffer, decisionRgb ? { ...options, decisionRgb } : options);
  const result = toSrgbImageData(buffer);

  return {
    imageData: result,
    keyColors: Array.isArray(options.keyColors) ? options.keyColors : [],
    removedPixels: 0
  };
}
