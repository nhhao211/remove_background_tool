/**
 * Python Precision Matting — browser side.
 *
 * The JS keyer still decides what is background (connectivity, seed points,
 * protection, circle regions all stay in the browser). This module sends the
 * source frame plus that keyed result to `POST /api/python/matte`, where
 * python/rmbg/matting.py re-estimates only the uncertain edge band: local
 * foreground/background plates, alpha by projection, a colour guided filter
 * and foreground unmixing. Pixels outside the band come back byte-identical.
 *
 * Wire format (same as python-bridge.js / python/rmbg/protocol.py):
 *
 *   u32le headerLength | header JSON | payload bytes
 *
 * Everything here degrades gracefully: no server route, no Python, or no
 * numpy/OpenCV is reported as a status and callers fall back to the JS result.
 */

export const PYTHON_MATTING_DEFAULTS = Object.freeze({
  enabled: false,
  band: 4,
  smooth: 0.5,
  spill: 0.6,
  decontaminate: true,
  minIsland: 0,
  maxHole: 0
});

const ENDPOINT_STATUS = '/api/python/status';
const ENDPOINT_MATTE = '/api/python/matte';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function clamp(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Coerces whatever localStorage held into a complete, valid settings object. */
export function normalizePythonSettings(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const d = PYTHON_MATTING_DEFAULTS;
  return {
    enabled: source.enabled === true,
    band: Math.round(clamp(source.band, 1, 12, d.band)),
    smooth: clamp(source.smooth, 0, 1, d.smooth),
    spill: clamp(source.spill, 0, 1, d.spill),
    decontaminate: source.decontaminate !== false,
    minIsland: Math.round(clamp(source.minIsland, 0, 2000, d.minIsland)),
    maxHole: Math.round(clamp(source.maxHole, 0, 2000, d.maxHole))
  };
}

function colorToHex(color) {
  if (typeof color === 'string') return color;
  if (color && typeof color.hex === 'string') return color.hex;
  if (color && Number.isFinite(color.r)) {
    return `#${[color.r, color.g, color.b].map((v) => Math.round(clamp(v, 0, 255, 0)).toString(16).padStart(2, '0')).join('')}`;
  }
  return null;
}

/** Refine options for the worker: panel settings + the key colours in use. */
export function buildRefineOptions(settings, keyColors = []) {
  const s = normalizePythonSettings(settings);
  return {
    band: s.band,
    smooth: s.smooth,
    spill: s.spill,
    decontaminate: s.decontaminate,
    minIsland: s.minIsland,
    maxHole: s.maxHole,
    keyColors: (keyColors || []).map(colorToHex).filter(Boolean)
  };
}

function bytesOf(data) {
  if (data instanceof Uint8Array) return data;
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

/** header object + RGBA buffers → one request body. */
export function encodeMatteRequest(header, ...buffers) {
  const json = textEncoder.encode(JSON.stringify(header));
  const parts = buffers.map(bytesOf);
  const size = 4 + json.length + parts.reduce((sum, part) => sum + part.length, 0);
  const body = new Uint8Array(size);
  new DataView(body.buffer).setUint32(0, json.length, true);
  body.set(json, 4);
  let offset = 4 + json.length;
  for (const part of parts) {
    body.set(part, offset);
    offset += part.length;
  }
  return body;
}

/** Response body → `{ header, payload }`. */
export function decodeMatteResponse(buffer) {
  const bytes = bytesOf(buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer);
  if (bytes.length < 4) throw new Error('Python trả về dữ liệu rỗng');
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
  if (4 + length > bytes.length) throw new Error('Python trả về header hỏng');
  const header = JSON.parse(textDecoder.decode(bytes.subarray(4, 4 + length)));
  return { header, payload: bytes.subarray(4 + length) };
}

let statusPromise = null;
let lastStatus = null;

/** `{ available, version, python, numpy, opencv, error?, hint? }`, cached. */
export function fetchPythonStatus(force = false) {
  if (!force && statusPromise) return statusPromise;
  statusPromise = fetch(ENDPOINT_STATUS, { cache: 'no-store' })
    .then((response) => (response.ok ? response.json() : { available: false, error: `HTTP ${response.status}` }))
    .catch((error) => ({ available: false, error: `Không gọi được server: ${error.message}` }))
    .then((status) => {
      lastStatus = status;
      for (const listener of statusListeners) listener(status);
      return status;
    });
  return statusPromise;
}

export function getCachedPythonStatus() {
  return lastStatus;
}

const statusListeners = new Set();

function markUnavailable(error) {
  lastStatus = { available: false, error: error.message, hint: error.hint };
  statusPromise = Promise.resolve(lastStatus);
  for (const listener of statusListeners) listener(lastStatus);
}

/**
 * Sends `original` (untouched source) and `keyed` (JS keyer output, same size)
 * to the Python worker. Resolves to `{ imageData, stats }`.
 *
 * Errors carry `unavailable: true` when Python cannot run at all (503 / network),
 * so callers can stop trying for the rest of a batch.
 */
export async function pythonRefine(original, keyed, options = {}, { signal } = {}) {
  const { width, height } = original;
  if (keyed.width !== width || keyed.height !== height) {
    throw new Error(`Kích thước khác nhau: ${width}x${height} vs ${keyed.width}x${keyed.height}`);
  }
  const body = encodeMatteRequest({ op: 'refine', width, height, options }, original.data, keyed.data);
  let response;
  try {
    response = await fetch(ENDPOINT_MATTE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body,
      signal
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    const failure = Object.assign(new Error(`Không gọi được server: ${error.message}`), { unavailable: true });
    markUnavailable(failure);
    throw failure;
  }
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    const failure = Object.assign(new Error(detail.error || `HTTP ${response.status}`), {
      status: response.status,
      hint: detail.hint,
      unavailable: response.status === 503 || response.status === 404
    });
    if (failure.unavailable) markUnavailable(failure);
    throw failure;
  }
  const { header, payload } = decodeMatteResponse(await response.arrayBuffer());
  if (payload.length !== width * height * 4) {
    throw new Error(`Python trả về ${payload.length} byte, cần ${width * height * 4}`);
  }
  return {
    imageData: new ImageData(new Uint8ClampedArray(payload), width, height),
    stats: header.stats || {}
  };
}

/** One-line summary of refine stats for status text. */
export function describeRefineStats(stats) {
  if (!stats) return '';
  if (stats.skipped === 'no-foreground') return 'python: bỏ qua — keyer không để lại phần chủ thể đặc nào (key nhầm màu chủ thể?)';
  if (stats.skipped === 'no-background') return 'python: bỏ qua — keyer chưa xoá pixel nền nào';
  if (stats.skipped) return 'python: không có viền cần tinh chỉnh';
  const parts = [`python tinh chỉnh ${Number(stats.changedPixels || 0).toLocaleString()} / ${Number(stats.bandPixels || 0).toLocaleString()} px viền`];
  if (stats.islandPixels) parts.push(`bỏ ${stats.islandPixels} px vụn`);
  if (stats.holePixels) parts.push(`lấp ${stats.holePixels} px lỗ`);
  return parts.join(', ');
}

// --------------------------------------------------------------------------
// Panel
// --------------------------------------------------------------------------

const SLIDERS = [
  { key: 'band', label: 'Dải viền (px)', min: 1, max: 12, step: 1, title: 'Độ rộng dải viền được ước lượng lại. Rộng hơn: sửa được viền mềm/tóc dày hơn, chậm hơn.' },
  { key: 'smooth', label: 'Làm mịn', min: 0, max: 1, step: 0.05, title: 'Guided filter bám cạnh ảnh gốc: 0 = sắc, 1 = mượt.' },
  { key: 'spill', label: 'Khử ám màu', min: 0, max: 1, step: 0.05, title: 'Khử màu nền còn ám trên dải viền.' },
  { key: 'minIsland', label: 'Bỏ vụn < px', min: 0, max: 2000, step: 10, title: 'Xoá các mảng đục rời rạc nhỏ hơn N px. 0 = tắt.' },
  { key: 'maxHole', label: 'Lấp lỗ < px', min: 0, max: 2000, step: 10, title: 'Lấp các lỗ trong suốt kín nhỏ hơn N px. 0 = tắt.' }
];

function readStored(storageKey) {
  try {
    return normalizePythonSettings(JSON.parse(localStorage.getItem(storageKey) || 'null'));
  } catch (_) {
    return normalizePythonSettings(null);
  }
}

function writeStored(storageKey, settings) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(settings));
  } catch (_) {
    /* private mode — settings just won't persist */
  }
}

function formatValue(key, value) {
  return Number.isInteger(SLIDERS.find((s) => s.key === key)?.step) ? String(Math.round(value)) : Number(value).toFixed(2);
}

/**
 * Renders the Python Precision Matting controls into `container`.
 *
 * `onChange(settings, reason)` fires after a debounced edit (`reason` is
 * 'enabled' or 'option'). Returns a small controller.
 */
export function mountPythonMattingPanel(container, { storageKey, idPrefix = 'python', onChange, applyHint = '', compact = false } = {}) {
  if (!container) return null;
  let settings = readStored(storageKey);
  let status = getCachedPythonStatus();
  const id = (name) => `${idPrefix}${name}`;
  // `compact` is the narrow Cleaner sidebar: no card chrome (the section is the
  // card) and two slider columns instead of six.
  const shell = compact
    ? 'relative'
    : 'relative overflow-hidden rounded-xl border border-indigo-400/20 bg-gradient-to-br from-indigo-500/[0.08] via-slate-900/40 to-fuchsia-500/[0.06] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]';
  const grid = compact ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3 xl:grid-cols-6';

  container.innerHTML = `
    <div class="${shell}">
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div class="flex min-w-0 flex-1 items-center gap-2.5">
          <span class="grid size-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white shadow-lg shadow-indigo-500/25">
            <i data-lucide="cpu" style="width: 16px; height: 16px;"></i>
          </span>
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-[0.82rem] font-semibold tracking-tight text-slate-100">Python Precision Matting</span>
              <span id="${id('Status')}" class="inline-flex items-center gap-1.5 rounded-full border border-slate-500/30 bg-slate-500/10 px-2 py-0.5 text-[0.65rem] font-medium text-slate-300">
                <span class="size-1.5 rounded-full bg-slate-400"></span><span data-role="text">Đang kiểm tra…</span>
              </span>
            </div>
            <p class="mt-0.5 text-[0.7rem] leading-snug text-slate-400">Tinh chỉnh dải viền bằng NumPy + OpenCV: tách lại alpha và màu chủ thể khỏi nền, viền tóc/mờ chính xác hơn${applyHint ? ` · ${applyHint}` : ''}.</p>
          </div>
        </div>
        <label class="relative inline-flex cursor-pointer items-center gap-2 select-none" for="${id('Enabled')}">
          <input type="checkbox" id="${id('Enabled')}" class="peer sr-only">
          <span class="h-5 w-9 rounded-full bg-slate-700 ring-1 ring-white/10 transition-colors peer-checked:bg-indigo-500 peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-300 peer-disabled:opacity-40"></span>
          <span class="pointer-events-none absolute left-0.5 top-0.5 size-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4"></span>
          <span class="text-[0.72rem] font-medium text-slate-300">Bật</span>
        </label>
      </div>
      <div id="${id('Body')}" class="mt-3 grid ${grid} gap-x-4 gap-y-2.5">
        ${SLIDERS.map((s) => `
          <label class="flex min-w-0 flex-col gap-1" title="${s.title}">
            <span class="flex items-center justify-between gap-2 text-[0.7rem] font-medium text-slate-300">
              <span class="truncate">${s.label}</span>
              <span id="${id(`${s.key}Value`)}" class="rounded-md bg-slate-950/60 px-1.5 py-px font-mono text-[0.66rem] text-indigo-200 tabular-nums">0</span>
            </span>
            <input type="range" id="${id(s.key)}" min="${s.min}" max="${s.max}" step="${s.step}" class="w-full accent-indigo-500">
          </label>`).join('')}
        <label class="flex items-center gap-2 self-end pb-0.5 text-[0.72rem] text-slate-300 ${compact ? 'col-span-2' : ''}" title="Tính lại màu chủ thể trên viền bằng cách tách màu nền ra khỏi pixel trộn.">
          <input type="checkbox" id="${id('decontaminate')}" class="size-3.5 accent-indigo-500">
          <span>Tách màu nền khỏi viền</span>
        </label>
      </div>
      <div class="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-white/5 pt-2">
        <span id="${id('Report')}" class="min-w-0 truncate text-[0.68rem] text-slate-400"></span>
        <div class="flex items-center gap-1.5">
          <button type="button" id="${id('Reset')}" class="cursor-pointer rounded-md border-0 bg-transparent px-2 py-1 text-[0.68rem] font-medium text-slate-400 transition hover:bg-white/5 hover:text-slate-200">Mặc định</button>
          <button type="button" id="${id('Recheck')}" class="inline-flex cursor-pointer items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[0.68rem] font-medium text-slate-300 transition hover:border-indigo-400/40 hover:text-white">
            <i data-lucide="refresh-cw" style="width: 11px; height: 11px;"></i>Kiểm tra Python
          </button>
        </div>
      </div>
    </div>`;

  const $ = (name) => container.querySelector(`#${id(name)}`);
  const enabledInput = $('Enabled');
  const body = $('Body');
  const statusBadge = $('Status');
  const report = $('Report');
  const decontaminate = $('decontaminate');

  function paintControls() {
    enabledInput.checked = settings.enabled;
    decontaminate.checked = settings.decontaminate;
    for (const s of SLIDERS) {
      $(s.key).value = String(settings[s.key]);
      $(`${s.key}Value`).textContent = formatValue(s.key, settings[s.key]);
    }
    body.classList.toggle('opacity-45', !settings.enabled);
    body.classList.toggle('pointer-events-none', !settings.enabled);
  }

  function paintStatus() {
    const dot = statusBadge.firstElementChild;
    const text = statusBadge.querySelector('[data-role="text"]');
    const tone = !status ? 'slate' : status.available ? 'emerald' : 'rose';
    const tones = {
      slate: ['border-slate-500/30', 'bg-slate-500/10', 'text-slate-300', 'bg-slate-400'],
      emerald: ['border-emerald-400/30', 'bg-emerald-500/10', 'text-emerald-200', 'bg-emerald-400'],
      rose: ['border-rose-400/30', 'bg-rose-500/10', 'text-rose-200', 'bg-rose-400']
    };
    const all = Object.values(tones).flat();
    statusBadge.classList.remove(...all);
    dot.classList.remove(...all);
    const [border, bg, color, dotColor] = tones[tone];
    statusBadge.classList.add(border, bg, color);
    dot.classList.add(dotColor);
    if (!status) {
      text.textContent = 'Đang kiểm tra…';
      statusBadge.title = '';
    } else if (status.available) {
      text.textContent = `Python ${status.python || ''} · OpenCV ${status.opencv || ''}`.trim();
      statusBadge.title = `numpy ${status.numpy || '?'} · engine ${status.version || '?'}`;
    } else {
      text.textContent = 'Python chưa sẵn sàng';
      statusBadge.title = [status.error, status.hint].filter(Boolean).join('\n');
      if (settings.enabled && !report.dataset.sticky) {
        report.textContent = status.hint || status.error || '';
      }
    }
  }

  let debounce = null;
  function commit(reason, immediate = false) {
    writeStored(storageKey, settings);
    paintControls();
    clearTimeout(debounce);
    const fire = () => onChange?.(settings, reason);
    if (immediate) fire();
    else debounce = setTimeout(fire, 250);
  }

  enabledInput.addEventListener('change', () => {
    settings = { ...settings, enabled: enabledInput.checked };
    if (settings.enabled && (!status || !status.available)) fetchPythonStatus(true);
    commit('enabled', true);
  });
  decontaminate.addEventListener('change', () => {
    settings = { ...settings, decontaminate: decontaminate.checked };
    commit('option');
  });
  for (const s of SLIDERS) {
    $(s.key).addEventListener('input', (event) => {
      settings = normalizePythonSettings({ ...settings, [s.key]: Number(event.target.value) });
      commit('option');
    });
  }
  $('Reset').addEventListener('click', () => {
    settings = { ...normalizePythonSettings(null), enabled: settings.enabled };
    commit('option', true);
  });
  $('Recheck').addEventListener('click', () => fetchPythonStatus(true));

  const onStatus = (next) => {
    status = next;
    paintStatus();
  };
  statusListeners.add(onStatus);

  paintControls();
  paintStatus();
  globalThis.lucide?.createIcons?.({ root: container });
  fetchPythonStatus();

  return {
    get settings() {
      return settings;
    },
    /** Enabled in the UI (whether or not Python is reachable). */
    isEnabled() {
      return settings.enabled;
    },
    /** Latest known status, or null while the first check is in flight. */
    get status() {
      return status;
    },
    refineOptions(keyColors) {
      return buildRefineOptions(settings, keyColors);
    },
    setReport(text, { error = false } = {}) {
      report.textContent = text || '';
      report.dataset.sticky = text ? '1' : '';
      report.classList.toggle('text-rose-300', error);
      report.classList.toggle('text-slate-400', !error);
    },
    destroy() {
      statusListeners.delete(onStatus);
    }
  };
}
