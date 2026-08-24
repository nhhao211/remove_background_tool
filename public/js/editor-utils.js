const EditorUtils = (() => {
  const MIN_TRIM_DURATION = 0.2;
  const MIN_SPEED = 0.1;
  const MAX_SPEED = 16;

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const finiteOr = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;

  function clampNumber(value, min, max, fallback) {
    return clamp(finiteOr(value, fallback), min, max);
  }

  function clampTrimRange(start, end, duration, minDuration = MIN_TRIM_DURATION) {
    const safeDuration = Math.max(0, finiteOr(duration, 0));
    if (!safeDuration) return { start: 0, end: 0 };
    const minimum = Math.min(Math.max(0, finiteOr(minDuration, MIN_TRIM_DURATION)), safeDuration);
    let nextStart = clamp(finiteOr(start, 0), 0, safeDuration);
    let nextEnd = clamp(finiteOr(end, safeDuration), 0, safeDuration);
    if (nextEnd < nextStart) [nextStart, nextEnd] = [nextEnd, nextStart];
    if (nextEnd - nextStart < minimum) {
      if (nextStart + minimum <= safeDuration) nextEnd = nextStart + minimum;
      else {
        nextEnd = safeDuration;
        nextStart = Math.max(0, safeDuration - minimum);
      }
    }
    return { start: nextStart, end: nextEnd };
  }

  function clampTrimStart(start, end, duration, minDuration = MIN_TRIM_DURATION) {
    const safeDuration = Math.max(0, finiteOr(duration, 0));
    if (!safeDuration) return 0;
    const minimum = Math.min(Math.max(0, finiteOr(minDuration, MIN_TRIM_DURATION)), safeDuration);
    const safeEnd = clamp(finiteOr(end, safeDuration), minimum, safeDuration);
    return clamp(finiteOr(start, 0), 0, safeEnd - minimum);
  }

  function clampTrimEnd(start, end, duration, minDuration = MIN_TRIM_DURATION) {
    const safeDuration = Math.max(0, finiteOr(duration, 0));
    if (!safeDuration) return 0;
    const minimum = Math.min(Math.max(0, finiteOr(minDuration, MIN_TRIM_DURATION)), safeDuration);
    const safeStart = clamp(finiteOr(start, 0), 0, safeDuration - minimum);
    return clamp(finiteOr(end, safeDuration), safeStart + minimum, safeDuration);
  }

  function shiftTrimRange(start, end, delta, duration) {
    const safeDuration = Math.max(0, finiteOr(duration, 0));
    const range = clampTrimRange(start, end, safeDuration, 0);
    const rangeDuration = Math.min(safeDuration, Math.max(0, range.end - range.start));
    const nextStart = clamp(range.start + finiteOr(delta, 0), 0, safeDuration - rangeDuration);
    return { start: nextStart, end: nextStart + rangeDuration };
  }

  function snapTime(value, duration, options = {}) {
    const safeDuration = Math.max(0, Number(duration) || 0);
    const raw = clamp(Number(value) || 0, 0, safeDuration);
    const step = Number(options.step) > 0 ? Number(options.step) : 0.1;
    const threshold = Number(options.threshold) >= 0 ? Number(options.threshold) : step * 0.45;
    const markers = [0, safeDuration, ...(options.markers || [])];
    if (options.playhead != null) markers.push(options.playhead);
    markers.push(Math.round(raw / step) * step);
    let nearest = raw;
    let distance = Infinity;
    for (const marker of markers) {
      const candidate = clamp(Number(marker) || 0, 0, safeDuration);
      const delta = Math.abs(candidate - raw);
      if (delta < distance) { distance = delta; nearest = candidate; }
    }
    return distance <= threshold ? nearest : raw;
  }

  function formatSpeed(speed) {
    const value = clamp(Number(speed) || 1, MIN_SPEED, MAX_SPEED);
    return `${parseFloat(value.toFixed(2))}x`;
  }

  function effectiveDuration(start, end, speed = 1) {
    const range = Math.max(0, (Number(end) || 0) - (Number(start) || 0));
    return range / clamp(Number(speed) || 1, MIN_SPEED, MAX_SPEED);
  }

  function atempoFilter(speed = 1) {
    let value = clamp(Number(speed) || 1, MIN_SPEED, MAX_SPEED);
    const filters = [];
    // FFmpeg atempo accepts values from 0.5 through 2.0. Split extremes into
    // a valid chain while preserving the exact requested tempo.
    while (value > 2) { filters.push('atempo=2'); value /= 2; }
    while (value < 0.5) { filters.push('atempo=0.5'); value /= 0.5; }
    if (Math.abs(value - 1) > 0.0001) filters.push(`atempo=${Number(value.toFixed(6))}`);
    return filters.join(',');
  }

  function normalizeColor(value) {
    if (typeof value !== 'string') return null;
    const input = value.trim().toLowerCase();
    let r; let g; let b;
    const hex = input.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (hex) {
      const digits = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1];
      r = parseInt(digits.slice(0, 2), 16); g = parseInt(digits.slice(2, 4), 16); b = parseInt(digits.slice(4, 6), 16);
    } else {
      const rgb = input.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i);
      if (!rgb) return null;
      [r, g, b] = rgb.slice(1, 4).map(Number);
      if ([r, g, b].some((channel) => channel > 255)) return null;
    }
    return { r, g, b, hex: `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}` };
  }

  function dedupeColor(colors, color, threshold = 10) {
    const value = color && typeof color === 'object' ? color.hex : color;
    const normalized = normalizeColor(value);
    if (!normalized) return Array.isArray(colors) ? colors.slice() : [];
    const list = Array.isArray(colors) ? colors : [];
    const duplicate = list.some((item) => Math.abs(item.r - normalized.r) + Math.abs(item.g - normalized.g) + Math.abs(item.b - normalized.b) < threshold);
    return duplicate ? list.slice() : [...list, normalized];
  }

  function sourceId(source, fileName = '') {
    if (typeof source === 'string') return source;
    if (source && typeof source === 'object') return `${source.name || fileName}:${source.size || 0}:${source.lastModified || 0}`;
    return fileName || 'unknown';
  }

  return {
    MIN_TRIM_DURATION,
    MIN_SPEED,
    MAX_SPEED,
    clampNumber,
    clampTrimRange,
    clampTrimStart,
    clampTrimEnd,
    shiftTrimRange,
    snapTime,
    formatSpeed,
    effectiveDuration,
    atempoFilter,
    normalizeColor,
    dedupeColor,
    sourceId
  };
})();

export { EditorUtils };
