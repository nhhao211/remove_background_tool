import { clamp01 } from './color.js';

/**
 * Removes only the component of a pixel's chroma pointing toward the sampled
 * key hue, so blue, green, red, and custom key colours are all handled without
 * shifting neutral detail.
 *
 * Was duplicated verbatim in chroma-key.js and background-removal.js.
 *
 * Writes RGB in place at `offset`. Alpha is untouched — despill and matting are
 * deliberately separate concerns.
 */
export function suppressSpill(data, offset, pixel, key, strength) {
  if (strength <= 0) return;

  const keyChroma = [key.r - key.y, key.g - key.y, key.b - key.y];
  const magnitude = Math.hypot(...keyChroma);
  if (magnitude < 0.02) return;

  const direction = keyChroma.map((channel) => channel / magnitude);
  const pixelChroma = [pixel.r - pixel.y, pixel.g - pixel.y, pixel.b - pixel.y];
  const projection = pixelChroma.reduce((sum, channel, index) => sum + (channel * direction[index]), 0);
  if (projection <= 0) return;

  const removal = projection * clamp01(strength);
  data[offset] = Math.round(clamp01(pixel.r - (direction[0] * removal)) * 255);
  data[offset + 1] = Math.round(clamp01(pixel.g - (direction[1] * removal)) * 255);
  data[offset + 2] = Math.round(clamp01(pixel.b - (direction[2] * removal)) * 255);
}
