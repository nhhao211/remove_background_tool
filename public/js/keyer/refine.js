/**
 * Morphological cleanup.
 *
 * The two paths refine differently and both behaviours are preserved. The video
 * path erodes the foreground by hard-zeroing alpha near transparency; the sheet
 * path dilates the background mask and lets the caller decide what to do with
 * the newly covered pixels. Neither is a generalisation of the other, so both
 * moved across unchanged.
 *
 * Both are blunt: they discard partial alpha rather than reshaping it, which is
 * why thin structures thin out further at cleanupRadius > 0. Phase 6 replaces
 * the erosion with edge-aware refinement; until then this is the shipped
 * behaviour and the baseline encodes it.
 */

/** Video path. Erodes the opaque region by `radius` passes of 8-neighbour growth. */
export function erodeForegroundAlpha(imageData, radius) {
  const width = Number(imageData.width) || 0;
  const height = Number(imageData.height) || 0;
  if (!width || !height || radius <= 0) return;
  const data = imageData.data;
  let transparent = new Uint8Array(width * height);
  for (let index = 0; index < transparent.length; index += 1) {
    if (data[(index * 4) + 3] <= 8) transparent[index] = 1;
  }

  for (let pass = 0; pass < radius; pass += 1) {
    const expanded = transparent.slice();
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = (y * width) + x;
        if (transparent[index]) continue;
        for (let ny = Math.max(0, y - 1); ny <= Math.min(height - 1, y + 1) && !expanded[index]; ny += 1) {
          for (let nx = Math.max(0, x - 1); nx <= Math.min(width - 1, x + 1); nx += 1) {
            if (transparent[(ny * width) + nx]) {
              expanded[index] = 1;
              break;
            }
          }
        }
      }
    }
    transparent = expanded;
  }

  for (let index = 0; index < transparent.length; index += 1) {
    if (transparent[index]) data[(index * 4) + 3] = 0;
  }
}

/** Sheet path. Grows a binary mask by `radius` passes, returning a new buffer. */
export function dilateMask(mask, width, height, radius) {
  let current = mask;
  for (let pass = 0; pass < radius; pass += 1) {
    const next = current.slice();
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = (y * width) + x;
        if (current[index]) continue;
        for (let ny = Math.max(0, y - 1); ny <= Math.min(height - 1, y + 1) && !next[index]; ny += 1) {
          for (let nx = Math.max(0, x - 1); nx <= Math.min(width - 1, x + 1); nx += 1) {
            if (current[(ny * width) + nx]) {
              next[index] = 1;
              break;
            }
          }
        }
      }
    }
    current = next;
  }
  return current;
}
