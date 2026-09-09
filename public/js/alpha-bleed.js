/**
 * Alpha bleed (RGB dilation into transparent pixels).
 * Video Background Remover & Sprite Sheet Studio
 *
 * A keyed sprite stores no meaningful colour where alpha is 0 — normally black.
 * That is invisible in the PNG, but not on a GPU: bilinear filtering, mipmaps
 * and any non-integer scale average a texel against its neighbours *including*
 * the transparent ones, so every silhouette edge picks up a rim of the black
 * that was hiding under alpha 0. That rim is the dark fringe and the "broken",
 * gnawed-looking outline people see once the sprite is scaled in an engine.
 *
 * The fix is to fill the transparent border with the colour of the nearest
 * opaque pixels, so the average the GPU computes stays on-subject no matter how
 * the alpha weighs it. Alpha itself is never touched — the silhouette is
 * identical, only the colour hidden beneath it changes.
 *
 * Three rings covers bilinear plus a couple of mip levels, which is what a
 * sprite sheet actually gets sampled at.
 *
 * IMPORTANT: the result cannot survive a canvas round-trip. Canvas 2D backing
 * stores are premultiplied, so `putImageData` collapses every bled pixel back to
 * (0,0,0,0). Bleed last, on the ImageData that goes straight to
 * `png-encoder.js`.
 */

const MAX_PASSES = 16;

/**
 * Dilates RGB outward into fully transparent pixels, in place.
 *
 * @param {ImageData|{data: Uint8ClampedArray, width: number, height: number}} imageData
 * @param {number} [passes=3] - Rings to grow; clamped to 1..16.
 * @returns {number} How many rings actually had anything to fill.
 */
export function applyAlphaBleed(imageData, passes = 3) {
  if (!imageData || !imageData.data || !imageData.width || !imageData.height) return 0;

  const { data, width, height } = imageData;
  const pixelCount = width * height;
  const ringCount = Math.max(1, Math.min(MAX_PASSES, Math.round(Number(passes) || 0)));

  // filled[i] = this pixel already carries usable colour, either because it was
  // never transparent or because an earlier ring painted it.
  const filled = new Uint8Array(pixelCount);
  let hasSource = false;
  for (let i = 0; i < pixelCount; i++) {
    if (data[(i * 4) + 3] !== 0) {
      filled[i] = 1;
      hasSource = true;
    }
  }

  // An all-transparent sheet has no colour to spread; an all-opaque one has
  // nowhere to spread it.
  if (!hasSource) return 0;

  let ringsGrown = 0;

  for (let pass = 0; pass < ringCount; pass++) {
    // Each ring reads the previous ring's state only. Without the snapshot a
    // single pass would smear colour along the scan direction instead of
    // growing an even ring outward from the silhouette.
    const source = filled.slice();
    let painted = 0;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = (y * width) + x;
        if (source[index]) continue;

        let sumR = 0;
        let sumG = 0;
        let sumB = 0;
        let sumW = 0;

        const yMin = y > 0 ? y - 1 : 0;
        const yMax = y < height - 1 ? y + 1 : height - 1;
        const xMin = x > 0 ? x - 1 : 0;
        const xMax = x < width - 1 ? x + 1 : width - 1;

        for (let ny = yMin; ny <= yMax; ny++) {
          for (let nx = xMin; nx <= xMax; nx++) {
            const neighbour = (ny * width) + nx;
            if (neighbour === index || !source[neighbour]) continue;

            const offset = neighbour * 4;
            // Weight by alpha so a solid neighbour outvotes a faint edge one,
            // with +1 so pixels painted by a previous ring (alpha 0) still
            // count rather than contributing nothing.
            const w = data[offset + 3] + 1;
            sumR += data[offset] * w;
            sumG += data[offset + 1] * w;
            sumB += data[offset + 2] * w;
            sumW += w;
          }
        }

        if (sumW === 0) continue;

        const offset = index * 4;
        data[offset] = Math.round(sumR / sumW);
        data[offset + 1] = Math.round(sumG / sumW);
        data[offset + 2] = Math.round(sumB / sumW);
        // Alpha deliberately untouched: the silhouette must not move.
        filled[index] = 1;
        painted++;
      }
    }

    if (painted === 0) break;
    ringsGrown++;
  }

  return ringsGrown;
}
