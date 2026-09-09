/**
 * Which erase strokes belong to which sprite frame.
 *
 * The Erase Brush paints two kinds of stroke:
 *
 *   - **Global** (`frame === null`) — everything painted on the source video.
 *     The video has no notion of a cell, and the historical behaviour of the
 *     brush is "this area is gone from the whole clip", so that is what a stroke
 *     painted there still means.
 *   - **Frame-bound** (`frame` is an index) — painted on one cell of the sprite
 *     preview. This is the Paint-style eraser: a smudge that only exists on the
 *     frame where the problem is, so removing a stray highlight from frame 7
 *     does not punch a hole through the other twenty-three.
 *
 * A frame index alone is a fragile binding: change Rows/Cols or FPS and the same
 * index is a different moment of the clip, so the erased spot would silently
 * jump to unrelated content. Strokes therefore also carry `frameTime`, the video
 * time they were painted at, and are re-bound to the frame nearest that time
 * whenever the timestamps of the current sheet are known. The index is the
 * fallback for strokes that predate a timestamp (or for a sheet generated before
 * this module existed).
 *
 * A stroke whose binding cannot be honoured — an index past the end of a sheet
 * that has no timestamps to re-bind against — resolves to `ORPHAN_FRAME` and is
 * applied to no frame at all. Dropping it is the safe failure: the alternative,
 * clamping it onto the last frame, would erase content the user never pointed
 * at, in a place they are not looking.
 *
 * Pure and DOM-free so the binding rules can be tested outside a browser.
 */

/** Resolution result for a stroke bound to a frame that no longer exists. */
export const ORPHAN_FRAME = -1;

/** Whether `stroke` applies to every frame rather than to one cell. */
export function isGlobalStroke(stroke) {
  return !stroke || stroke.frame === null || stroke.frame === undefined;
}

function frameCountOf(value) {
  const count = Math.floor(Number(value) || 0);
  return count > 0 ? count : 0;
}

/**
 * The frame `stroke` applies to.
 *
 * @returns {number|null} `null` for a global stroke, a frame index, or
 *   `ORPHAN_FRAME` when the binding points outside the current sheet.
 */
export function resolveStrokeFrame(stroke, frameTimes, frameCount) {
  if (isGlobalStroke(stroke)) return null;
  const count = frameCountOf(frameCount);
  if (count === 0) return ORPHAN_FRAME;

  // Re-bind by time whenever the sheet can say when its frames were taken. This
  // is what keeps a per-cell erase welded to the content across a regenerate
  // with a different frame count.
  const times = Array.isArray(frameTimes) ? frameTimes : [];
  // `Number(null)` is 0, not NaN, so an absent timestamp would otherwise re-bind
  // every legacy stroke to the first frame of the clip.
  const paintedAt = stroke.frameTime === null || stroke.frameTime === undefined
    ? NaN
    : Number(stroke.frameTime);
  if (Number.isFinite(paintedAt) && times.length >= count) {
    let best = ORPHAN_FRAME;
    let bestDelta = Infinity;
    for (let index = 0; index < count; index += 1) {
      const time = Number(times[index]);
      if (!Number.isFinite(time)) continue;
      const delta = Math.abs(time - paintedAt);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = index;
      }
    }
    if (best !== ORPHAN_FRAME) return best;
  }

  const frame = Math.floor(Number(stroke.frame));
  return frame >= 0 && frame < count ? frame : ORPHAN_FRAME;
}

/**
 * The strokes that must be rasterized for one frame, in paint order.
 *
 * Order is the whole point of returning a filtered list rather than two lists:
 * a Restore stroke rubs out whatever was laid down *before* it, so a frame-bound
 * Restore has to stay in its original position relative to the global strokes it
 * is meant to cancel.
 */
export function strokesForFrame(strokes, frameIndex, frameTimes, frameCount) {
  if (!Array.isArray(strokes) || strokes.length === 0) return [];
  return strokes.filter((stroke) => {
    const frame = resolveStrokeFrame(stroke, frameTimes, frameCount);
    return frame === null || frame === frameIndex;
  });
}

/**
 * Splits `strokes` into the part every frame shares and the set of frames that
 * additionally need a mask of their own.
 *
 * Callers use `frameIndices` to avoid the expensive half of the work: a frame
 * absent from it gets the one global mask, rasterized once and reused, instead
 * of its own rasterization pass.
 *
 * @returns {{ globalStrokes: Array, frameIndices: Set<number>, boundCount: number, orphanCount: number }}
 */
export function eraseStrokePlan(strokes, frameTimes, frameCount) {
  const globalStrokes = [];
  const frameIndices = new Set();
  let boundCount = 0;
  let orphanCount = 0;

  for (const stroke of Array.isArray(strokes) ? strokes : []) {
    const frame = resolveStrokeFrame(stroke, frameTimes, frameCount);
    if (frame === null) {
      globalStrokes.push(stroke);
      continue;
    }
    boundCount += 1;
    if (frame === ORPHAN_FRAME) orphanCount += 1;
    else frameIndices.add(frame);
  }

  return { globalStrokes, frameIndices, boundCount, orphanCount };
}
