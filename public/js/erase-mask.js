/**
 * Applies a painted erase mask to keyed pixels.
 *
 * This is deliberately NOT a keyer option. The keyer decides which pixels are
 * background by looking at colour; the erase mask is a direct instruction from
 * the user that a region must go, whatever the colour says. Keeping it outside
 * `runKeyer` means it needs no entry in the option whitelist, does not touch the
 * byte-identical keyer baselines, and — the reason that matters to users — still
 * works with `Transparent WebP/PNG` switched off, where the keyer is disabled
 * entirely but "remove this logo" is still a reasonable thing to ask for.
 *
 * `mask` is one byte per pixel, 0 = untouched, 255 = fully erased, matching the
 * layout `rasterizeStrokeMask` returns. Alpha is scaled rather than clamped to
 * zero so a feathered brush edge fades out instead of cutting a hard step.
 */

/**
 * Multiplies the alpha channel of `imageData` down by `mask`, in place.
 *
 * A mask whose length does not match the pixel count is ignored rather than
 * throwing — the same tolerance the keyer applies to a wrong-shaped protection
 * mask, so a stale mask from a previous sheet geometry degrades to a no-op
 * instead of corrupting a frame.
 *
 * @param {{ data: Uint8ClampedArray }} imageData
 * @param {Uint8ClampedArray|Uint8Array|null} mask
 * @returns {boolean} whether the mask was applied
 */
export function applyEraseMask(imageData, mask) {
  if (!imageData?.data || !mask) return false;
  const pixelCount = imageData.data.length / 4;
  if (mask.length !== pixelCount) return false;

  const data = imageData.data;
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const erase = mask[pixel];
    if (erase === 0) continue;
    const alphaOffset = (pixel * 4) + 3;
    data[alphaOffset] = erase >= 255 ? 0 : Math.round(data[alphaOffset] * (1 - (erase / 255)));
  }
  return true;
}
