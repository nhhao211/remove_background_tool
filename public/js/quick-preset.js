/**
 * Quick preset for the Video → Sprite tab: one checkbox that drops a handful of
 * chroma / grade sliders onto values the user has found work well, and puts
 * them back when unchecked.
 *
 * DOM-free on purpose so it can be tested outside a browser — `app.js` owns the
 * wiring (which element each field maps to, the snapshot, the Settings form).
 *
 * The preset is a per-machine preference, not clip state: it lives in its own
 * localStorage key, so changing it never touches `schemaVersion` and a clip
 * saved before this existed loads exactly as it did.
 */

export const QUICK_PRESET_STORAGE_KEY = 'video-editor:quick-preset';

/**
 * One entry per slider the preset drives. `min`/`max`/`step` mirror the range of
 * the slider it targets in `index.html`, so a stored value can never be one the
 * slider would silently clamp to something else.
 *
 * Spill Suppression is the 0–1 slider (0.65 reads as "65 %"); the other
 * fields are in the same units as their sliders.
 */
export const QUICK_PRESET_FIELDS = [
  { key: 'blend', label: 'Blend', hint: 'Feather biên alpha', min: 0, max: 1, step: 0.01, decimals: 2, fallback: 0.25 },
  { key: 'spill', label: 'Spill Suppression', hint: 'Khử halo màu key (0–1)', min: 0, max: 1, step: 0.01, decimals: 2, fallback: 0.65 },
  { key: 'edgeCleanup', label: 'Edge Cleanup (px)', hint: 'Bào viền màu 0–3 px', min: 0, max: 3, step: 1, decimals: 0, fallback: 1 },
  { key: 'chromaSmooth', label: 'Chroma Smoothing', hint: 'Bán kính làm mịn 1–2', min: 1, max: 2, step: 1, decimals: 0, fallback: 2 },
  { key: 'vibrance', label: 'Vibrance', hint: 'Color & Detail, −1…1', min: -1, max: 1, step: 0.01, decimals: 2, fallback: 0.03 },
  { key: 'saturation', label: 'Saturation', hint: 'Color & Detail, −1…1', min: -1, max: 1, step: 0.01, decimals: 2, fallback: 0.05 },
  { key: 'temperature', label: 'Temperature', hint: 'Color & Detail, −1…1', min: -1, max: 1, step: 0.01, decimals: 2, fallback: 0.05 },
  { key: 'sharpenAmount', label: 'Sharpen amount', hint: 'Color & Detail, 0…2', min: 0, max: 2, step: 0.05, decimals: 2, fallback: 0.05 }
];

export const QUICK_PRESET_DEFAULTS = Object.freeze(
  Object.fromEntries(QUICK_PRESET_FIELDS.map((field) => [field.key, field.fallback]))
);

function clampField(field, raw) {
  // Number(null) and Number('') are 0, which would silently turn a missing
  // field into "off" instead of the preset's own value.
  if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) return field.fallback;
  const num = Number(raw);
  if (!Number.isFinite(num)) return field.fallback;
  const clamped = Math.min(field.max, Math.max(field.min, num));
  if (field.decimals === 0) return Math.round(clamped);
  // Round to the field's own precision so 0.1 + 0.2 style noise never reaches a slider.
  return Number(clamped.toFixed(field.decimals));
}

/**
 * Coerces anything into a complete, in-range preset. Missing, non-numeric or
 * out-of-range fields fall back / clamp per field, so a half-corrupt stored
 * value keeps its good fields instead of resetting the lot.
 */
export function normalizeQuickPreset(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const result = {};
  for (const field of QUICK_PRESET_FIELDS) {
    result[field.key] = clampField(field, source[field.key]);
  }
  return result;
}

/** Reads whatever localStorage returned (string, null, garbage) into a preset. */
export function parseQuickPreset(raw) {
  if (typeof raw !== 'string' || raw === '') return normalizeQuickPreset(null);
  try {
    return normalizeQuickPreset(JSON.parse(raw));
  } catch (_) {
    return normalizeQuickPreset(null);
  }
}

export function serializeQuickPreset(preset) {
  return JSON.stringify(normalizeQuickPreset(preset));
}

export function isDefaultQuickPreset(preset) {
  const normalized = normalizeQuickPreset(preset);
  return QUICK_PRESET_FIELDS.every((field) => normalized[field.key] === field.fallback);
}
