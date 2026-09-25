import { clamp01, colorMetrics } from './keyer/color.js';

/**
 * Subject Guard — a post-pass over either keyer's output that gives back the
 * parts of the subject the keyer took only because their colour sat close to
 * the backdrop.
 *
 * Both keyers judge a pixel by colour distance to the key. That cannot tell a
 * navy shirt on a blue screen from the screen, so:
 *
 * - the direct (video) matte punches holes wherever the subject's colour falls
 *   inside the tolerance, including right in the middle of the body;
 * - the connected (sheet) matte floods from the border, and one gap in an
 *   outline, or one run of near-key pixels, lets the fill pour into the body.
 *
 * What colour cannot decide, shape and noise can. The pass classifies what the
 * keyer removed into three kinds and only keeps the first as background:
 *
 * 1. **Backdrop.** Pixels as close to the key as the backdrop itself is — the
 *    tolerance is measured from the frame's own confirmed backdrop (P90 of its
 *    key distance), not from the Similarity slider. Reached from the border, or
 *    an enclosed pocket big enough not to be noise (the gap between an arm and
 *    the torso).
 * 2. **Holes.** Anything removed that the border cannot reach — through
 *    `leakGuard` px of opening, so a 1–2 px crack in an outline does not count
 *    as a path — and is not a backdrop pocket. Restored.
 * 3. **Thick near-key subject.** Removed pixels further from the key than the
 *    backdrop's own noise, touching the solid subject, forming a mass at least
 *    `minThickness` px thick. Anti-aliased rims and thin wisps are thinner than
 *    that and stay with the keyer. Restored.
 *
 * Deep inside the subject (more than `EDGE_BAND` px from anything that stays
 * removed) partially keyed or despilled pixels get their original alpha and
 * colour back, so the body does not come out faded or tinted.
 *
 * Like `edge-refine.js`, it lives outside `keyer/`: the keyer has a
 * byte-identical baseline and a whitelist of options, and nothing here needs
 * either to change.
 *
 * Invariants callers rely on:
 * - alpha never decreases and never exceeds the source alpha;
 * - a pixel within 1 px of kept backdrop keeps the keyer's output, so the
 *   keyer's soft edge is what meets the background;
 * - pixels outside `rect` are neither read nor written;
 * - no key colours, or nothing removed ⇒ the output is byte-identical.
 */

const EDGE_BAND = 2;
const FAR = 0xffff;
const HIST_BINS = 1024;
const HIST_MAX = 1.5;

// Pixel classes.
const SOLID = 1;      // keyer kept at least half of the source alpha
const REMOVED = 2;    // keyer removed more than half
const GONE = 3;       // source alpha 0: nothing to restore

export const SUBJECT_GUARD_DEFAULTS = Object.freeze({ strength: 0.5, leakGuard: 1 });

/** `strength` 0..1 → the thickness a near-key mass needs to count as subject. */
export function minThicknessFor(strength) {
  return Math.round(3 + ((1 - clamp01(strength)) * 13));
}

/** Same formula as both keyers' `luminanceWeight`. */
export function luminanceWeightFor(subjectProtection) {
  return 0.08 + (0.9 * Math.pow(clamp01(subjectProtection ?? 0.5), 1.5));
}

function resolveRect(rect, width, height) {
  if (!rect) return { x0: 0, y0: 0, width, height };
  const x0 = Math.max(0, Math.min(width, Math.floor(Number(rect.x0) || 0)));
  const y0 = Math.max(0, Math.min(height, Math.floor(Number(rect.y0) || 0)));
  const x1 = Math.max(x0, Math.min(width, x0 + Math.floor(Number(rect.width) || 0)));
  const y1 = Math.max(y0, Math.min(height, y0 + Math.floor(Number(rect.height) || 0)));
  return { x0, y0, width: x1 - x0, height: y1 - y0 };
}

function parseKey(color) {
  if (typeof color === 'string') {
    const match = /^#?([0-9a-f]{6})$/i.exec(color.trim());
    if (!match) return null;
    const value = parseInt(match[1], 16);
    return colorMetrics({ r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 });
  }
  if (!color || typeof color !== 'object') return null;
  if (typeof color.hex === 'string' && !Number.isFinite(Number(color.r))) return parseKey(color.hex);
  const r = Number(color.r);
  const g = Number(color.g);
  const b = Number(color.b);
  if (![r, g, b].every(Number.isFinite)) return null;
  return colorMetrics({ r, g, b });
}

/**
 * Multi-source 8-neighbour BFS inside the rect: chessboard distance from every
 * pixel with `source[i]` to every pixel with `enter[i]` (`enter === null`: any
 * pixel), capped at `limit`. Unreached pixels read FAR.
 *
 * Only sources next to an enterable non-source seed the queue — an interior
 * source can never lower anybody's distance, and a backdrop that fills most of
 * a 1080p frame would otherwise put two million pixels through the queue.
 */
function chessboardDistance(w, h, source, enter, limit, queue) {
  const size = w * h;
  const dist = new Uint16Array(size).fill(FAR);
  const open = (n) => source[n] === 0 && (enter === null || enter[n] === 1);
  let tail = 0;
  for (let y = 0; y < h; y += 1) {
    const top = y > 0;
    const bottom = y < h - 1;
    for (let x = 0, i = y * w; x < w; x += 1, i += 1) {
      if (source[i] === 0) continue;
      dist[i] = 0;
      if (limit < 1) continue;
      const left = x > 0;
      const right = x < w - 1;
      if ((left && open(i - 1)) || (right && open(i + 1))
        || (top && (open(i - w) || (left && open(i - w - 1)) || (right && open(i - w + 1))))
        || (bottom && (open(i + w) || (left && open(i + w - 1)) || (right && open(i + w + 1))))) {
        queue[tail++] = i;
      }
    }
  }
  let head = 0;
  while (head < tail) {
    const i = queue[head++];
    const next = dist[i] + 1;
    if (next > limit) continue;
    const x = i % w;
    const left = x > 0;
    const right = x < w - 1;
    const top = i >= w;
    const bottom = i < size - w;
    let n;
    if (left) { n = i - 1; if (dist[n] > next && (enter === null || enter[n] === 1)) { dist[n] = next; queue[tail++] = n; } }
    if (right) { n = i + 1; if (dist[n] > next && (enter === null || enter[n] === 1)) { dist[n] = next; queue[tail++] = n; } }
    if (top) {
      n = i - w; if (dist[n] > next && (enter === null || enter[n] === 1)) { dist[n] = next; queue[tail++] = n; }
      if (left) { n = i - w - 1; if (dist[n] > next && (enter === null || enter[n] === 1)) { dist[n] = next; queue[tail++] = n; } }
      if (right) { n = i - w + 1; if (dist[n] > next && (enter === null || enter[n] === 1)) { dist[n] = next; queue[tail++] = n; } }
    }
    if (bottom) {
      n = i + w; if (dist[n] > next && (enter === null || enter[n] === 1)) { dist[n] = next; queue[tail++] = n; }
      if (left) { n = i + w - 1; if (dist[n] > next && (enter === null || enter[n] === 1)) { dist[n] = next; queue[tail++] = n; } }
      if (right) { n = i + w + 1; if (dist[n] > next && (enter === null || enter[n] === 1)) { dist[n] = next; queue[tail++] = n; } }
    }
  }
  return dist;
}

/**
 * 8-connected flood from `queue[0..tail)` into pixels where `member[n] === from`,
 * relabelling them `to`. Returns the new tail.
 */
function flood8(w, h, member, from, to, queue, tail) {
  let head = 0;
  while (head < tail) {
    const i = queue[head++];
    const x = i % w;
    const y = (i - x) / w;
    const x0 = x > 0 ? x - 1 : x;
    const x1 = x < w - 1 ? x + 1 : x;
    const y0 = y > 0 ? y - 1 : y;
    const y1 = y < h - 1 ? y + 1 : y;
    for (let ny = y0; ny <= y1; ny += 1) {
      for (let n = (ny * w) + x0, end = (ny * w) + x1; n <= end; n += 1) {
        if (member[n] !== from) continue;
        member[n] = to;
        queue[tail++] = n;
      }
    }
  }
  return tail;
}

/**
 * @param {ImageData} keyed   keyer output (mutated)
 * @param {ImageData} source  the same pixels before keying (read only)
 * @param {object} options
 * @param {Array} options.keyColors  `{r,g,b}` / `{hex}` / `'#rrggbb'`
 * @param {number} [options.strength=0.5]   0 = only very thick masses, 1 = 3 px
 * @param {number} [options.leakGuard=1]    outline cracks up to 2·n px are sealed
 * @param {number} [options.luminanceWeight]
 * @param {boolean} [options.restoreColor=true]  also undo despill where restored
 * @param {Array} [options.seedPoints]  explicit background picks, absolute px
 * @param {{x0,y0,width,height}} [options.rect]
 * @param {number} [options.minPocket]  smallest enclosed backdrop pocket kept removed
 * @returns {{ restoredPixels: number, holePixels: number, thickPixels: number, backdropTolerance: number }}
 */
export function applySubjectGuard(keyed, source, options = {}) {
  const stats = { restoredPixels: 0, holePixels: 0, thickPixels: 0, backdropTolerance: 0 };
  const keys = (Array.isArray(options.keyColors) ? options.keyColors : []).map(parseKey).filter(Boolean);
  if (!keys.length || !keyed?.data || !source?.data) return stats;
  if (keyed.width !== source.width || keyed.height !== source.height) return stats;

  const { width: fullWidth } = keyed;
  const rect = resolveRect(options.rect, keyed.width, keyed.height);
  const w = rect.width;
  const h = rect.height;
  if (!w || !h) return stats;
  const size = w * h;

  const out = keyed.data;
  const src = source.data;
  const luminanceWeight = Number.isFinite(Number(options.luminanceWeight))
    ? Number(options.luminanceWeight)
    : luminanceWeightFor(0.5);
  const strength = clamp01(options.strength ?? SUBJECT_GUARD_DEFAULTS.strength);
  const leakGuard = Math.max(0, Math.min(3, Math.round(Number(options.leakGuard ?? SUBJECT_GUARD_DEFAULTS.leakGuard) || 0)));
  const restoreColor = options.restoreColor !== false;
  const rowOffset = (y) => (((y + rect.y0) * fullWidth) + rect.x0) * 4;

  // --- classify, and the key distance of each removed pixel's source colour --
  // `colorMetrics` + `keyDistance` are inlined: this runs on every pixel of
  // every full-resolution video frame.
  const kind = new Uint8Array(size);
  const solid = new Uint8Array(size);
  const notSolid = new Uint8Array(size);
  const dist = new Float32Array(size);
  let removedCount = 0;
  let changedCount = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0, i = y * w, o = rowOffset(y); x < w; x += 1, i += 1, o += 4) {
      const sa = src[o + 3];
      const ka = out[o + 3];
      if (sa === 0) {
        kind[i] = GONE;
        notSolid[i] = 1;
        continue;
      }
      if (ka * 2 >= sa) {
        kind[i] = SOLID;
        solid[i] = 1;
        if (ka !== sa || out[o] !== src[o] || out[o + 1] !== src[o + 1] || out[o + 2] !== src[o + 2]) changedCount += 1;
        continue; // the distance is only ever asked of removed pixels
      }
      kind[i] = REMOVED;
      notSolid[i] = 1;
      removedCount += 1;
      const r = src[o] / 255;
      const g = src[o + 1] / 255;
      const b = src[o + 2] / 255;
      const lum = (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
      const cb = b - lum;
      const cr = r - lum;
      let best = Infinity;
      for (let k = 0; k < keys.length; k += 1) {
        const key = keys[k];
        const dCb = cb - key.cb;
        const dCr = cr - key.cr;
        const dY = lum - key.y;
        const d = (dCb * dCb) + (dCr * dCr) + (luminanceWeight * dY * dY);
        if (d < best) best = d;
      }
      dist[i] = Math.sqrt(best);
    }
  }
  if (removedCount === 0 && changedCount === 0) return stats;

  const queue = new Int32Array(size);

  // --- background reachable from the border, through `leakGuard` of opening --
  // Erode the not-solid set (outside the rect counts as not-solid, so the
  // border does not shrink), flood the eroded set from the border, then grow
  // the flood back by the same radius inside not-solid. A crack narrower than
  // 2·leakGuard+1 px vanishes under the erosion and stops the flood.
  let passable = notSolid;
  if (leakGuard > 0) {
    const toSolid = chessboardDistance(w, h, solid, notSolid, leakGuard, queue);
    passable = new Uint8Array(size);
    for (let i = 0; i < size; i += 1) {
      if (toSolid[i] > leakGuard) passable[i] = 1;
    }
  }
  const reached = new Uint8Array(size);
  let tail = 0;
  const seed = (i) => {
    if (reached[i] || !passable[i]) return;
    reached[i] = 1;
    queue[tail++] = i;
  };
  for (let x = 0; x < w; x += 1) {
    seed(x);
    seed(((h - 1) * w) + x);
  }
  for (let y = 1; y < h - 1; y += 1) {
    seed(y * w);
    seed((y * w) + w - 1);
  }
  // 4-connected: a one-pixel diagonal outline is a closed wall, as drawn.
  const flood4 = (canEnter) => {
    let head = 0;
    while (head < tail) {
      const i = queue[head++];
      const x = i % w;
      if (x > 0 && !reached[i - 1] && canEnter[i - 1]) { reached[i - 1] = 1; queue[tail++] = i - 1; }
      if (x < w - 1 && !reached[i + 1] && canEnter[i + 1]) { reached[i + 1] = 1; queue[tail++] = i + 1; }
      if (i >= w && !reached[i - w] && canEnter[i - w]) { reached[i - w] = 1; queue[tail++] = i - w; }
      if (i + w < size && !reached[i + w] && canEnter[i + w]) { reached[i + w] = 1; queue[tail++] = i + w; }
    }
  };
  flood4(passable);
  if (leakGuard > 0) {
    const grown = chessboardDistance(w, h, reached, notSolid, leakGuard, queue);
    for (let i = 0; i < size; i += 1) {
      if (grown[i] <= leakGuard) reached[i] = 1;
    }
  }
  // An explicit background pick is background wherever it is, crack or not.
  tail = 0;
  for (const point of Array.isArray(options.seedPoints) ? options.seedPoints : []) {
    const x = Math.round(Number(point?.x)) - rect.x0;
    const y = Math.round(Number(point?.y)) - rect.y0;
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= w || y >= h) continue;
    const i = (y * w) + x;
    if (notSolid[i] && !reached[i]) {
      reached[i] = 1;
      queue[tail++] = i;
    }
  }
  flood4(notSolid);

  // --- how close to the key the backdrop itself is --------------------------
  // One measure for the whole frame, over every key. Measuring it per key was
  // tried: a subject colour that happens to sit nearest a second key (added
  // for a gradient shadow) then inherits that key's wide spread and is never
  // given back — worse on every shadow scene, better on none.
  const hist = new Uint32Array(HIST_BINS);
  let samples = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0, i = y * w, o = rowOffset(y); x < w; x += 1, i += 1, o += 4) {
      if (!reached[i] || kind[i] !== REMOVED || out[o + 3] > 8) continue;
      hist[Math.min(HIST_BINS - 1, Math.floor((dist[i] / HIST_MAX) * HIST_BINS))] += 1;
      samples += 1;
    }
  }
  let tolerance = 0.03;
  if (samples > 0) {
    const target = Math.ceil(samples * 0.9);
    let seen = 0;
    let bin = 0;
    for (; bin < HIST_BINS; bin += 1) {
      seen += hist[bin];
      if (seen >= target) break;
    }
    const p90 = ((bin + 1) / HIST_BINS) * HIST_MAX;
    tolerance = Math.min(0.4, (p90 * 1.3) + 0.006);
  }
  stats.backdropTolerance = tolerance;
  const backdropLike = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) {
    if (kind[i] === GONE || (kind[i] === REMOVED && dist[i] <= tolerance)) backdropLike[i] = 1;
  }

  // --- enclosed holes: keep real backdrop pockets, give back the rest --------
  // `stays` marks what remains background. It starts as reachable backdrop
  // and grows as the remaining classes are decided.
  const stays = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) {
    if (reached[i] && backdropLike[i]) stays[i] = 1;
  }
  const minPocket = Number.isFinite(Number(options.minPocket))
    ? Math.max(1, Number(options.minPocket))
    : Math.max(3, Math.round(Math.sqrt(size) * 0.02));
  // label: 1 = enclosed not-solid, 2 = in the component being walked,
  // 3 = backdrop-like candidate inside it, 4 = pocket being walked, 5 = done.
  const label = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) {
    if (!reached[i] && kind[i] !== SOLID) label[i] = 1;
  }
  const restore = new Uint8Array(size); // 1 = hole, 2 = thick
  const pocketQueue = new Int32Array(size);
  for (let start = 0; start < size; start += 1) {
    if (label[start] !== 1) continue;
    // One enclosed not-solid component at a time (8-connected).
    queue[0] = start;
    label[start] = 2;
    const componentEnd = flood8(w, h, label, 1, 2, queue, 1);
    for (let c = 0; c < componentEnd; c += 1) {
      const i = queue[c];
      if (backdropLike[i]) label[i] = 3;
    }
    // Inside it, backdrop-like runs large enough to be a pocket stay out.
    for (let c = 0; c < componentEnd; c += 1) {
      const pocketStart = queue[c];
      if (label[pocketStart] !== 3) continue;
      pocketQueue[0] = pocketStart;
      label[pocketStart] = 4;
      const pocketEnd = flood8(w, h, label, 3, 4, pocketQueue, 1);
      const keep = pocketEnd >= minPocket;
      for (let p = 0; p < pocketEnd; p += 1) {
        label[pocketQueue[p]] = 5;
        if (keep) stays[pocketQueue[p]] = 1;
      }
    }
    for (let c = 0; c < componentEnd; c += 1) {
      const i = queue[c];
      label[i] = 5;
      if (!stays[i] && kind[i] === REMOVED) restore[i] = 1;
    }
  }

  // --- thick near-key masses attached to the subject -------------------------
  // Candidates: reachable, removed, but further from the key than the backdrop
  // ever is. Opening them by `minThickness/2` drops rims and wisps and keeps
  // masses in their full shape.
  const radius = Math.max(1, Math.floor(minThicknessFor(strength) / 2));
  const weak = new Uint8Array(size);
  const notWeak = new Uint8Array(size);
  let weakCount = 0;
  for (let i = 0; i < size; i += 1) {
    if (reached[i] && kind[i] === REMOVED && !stays[i]) {
      weak[i] = 1;
      weakCount += 1;
    } else {
      notWeak[i] = 1;
    }
  }
  if (weakCount > 0) {
    const toNotWeak = chessboardDistance(w, h, notWeak, weak, radius + 1, queue);
    const coreSeed = new Uint8Array(size);
    for (let i = 0; i < size; i += 1) {
      if (weak[i] && toNotWeak[i] > radius) coreSeed[i] = 1;
    }
    const core = chessboardDistance(w, h, coreSeed, weak, radius, queue);
    // Only masses joined to the solid subject: a vignette or a shadow off in a
    // corner is thick too, and is not the subject. `attached`: 1 = opened
    // mass not yet joined, 2 = joined.
    const attached = new Uint8Array(size);
    for (let i = 0; i < size; i += 1) {
      if (weak[i] && core[i] <= radius) attached[i] = 1;
    }
    tail = 0;
    for (let i = 0; i < size; i += 1) {
      if (attached[i] !== 1) continue;
      const x = i % w;
      const y = (i - x) / w;
      const x0 = x > 0 ? x - 1 : x;
      const x1 = x < w - 1 ? x + 1 : x;
      const y0 = y > 0 ? y - 1 : y;
      const y1 = y < h - 1 ? y + 1 : y;
      let touches = false;
      for (let ny = y0; ny <= y1 && !touches; ny += 1) {
        for (let n = (ny * w) + x0, end = (ny * w) + x1; n <= end; n += 1) {
          if (solid[n] || restore[n]) { touches = true; break; }
        }
      }
      if (touches) {
        attached[i] = 2;
        queue[tail++] = i;
      }
    }
    flood8(w, h, attached, 1, 2, queue, tail);
    for (let i = 0; i < size; i += 1) {
      if (!weak[i]) continue;
      if (attached[i] === 2) restore[i] = 2;
      else stays[i] = 1;
    }
  }

  // --- write back ------------------------------------------------------------
  // Distance to whatever stays background decides how much is given back: the
  // pixel touching it keeps the keyer's soft edge, the next one meets halfway.
  // For removed pixels the distance is walked through removed pixels only — a
  // body behind a 1 px outline is not "near the background", the outline is.
  const background = stays;
  for (let i = 0; i < size; i += 1) {
    if (kind[i] === GONE) background[i] = 1;
  }
  const toBackground = chessboardDistance(w, h, background, null, EDGE_BAND + 3, queue);
  const toBackgroundOpen = chessboardDistance(w, h, background, notSolid, 3, queue);
  const weightAt = (d, band) => (d <= band ? 0 : (d === band + 1 ? 0.5 : 1));
  for (let y = 0; y < h; y += 1) {
    for (let x = 0, i = y * w, o = rowOffset(y); x < w; x += 1, i += 1, o += 4) {
      if (background[i]) continue;
      const weight = restore[i] ? weightAt(toBackgroundOpen[i], 1) : weightAt(toBackground[i], EDGE_BAND);
      if (weight <= 0) continue;
      const keyedAlpha = out[o + 3];
      const sourceAlpha = src[o + 3];
      const alpha = Math.round(keyedAlpha + ((sourceAlpha - keyedAlpha) * weight));
      let changed = false;
      if (alpha > keyedAlpha) {
        out[o + 3] = alpha;
        changed = true;
      }
      if (restoreColor) {
        for (let c = 0; c < 3; c += 1) {
          const value = keyedAlpha === 0 ? src[o + c] : Math.round(out[o + c] + ((src[o + c] - out[o + c]) * weight));
          if (value !== out[o + c]) {
            out[o + c] = value;
            changed = true;
          }
        }
      }
      if (!changed) continue;
      stats.restoredPixels += 1;
      if (restore[i] === 1) stats.holePixels += 1;
      else if (restore[i] === 2) stats.thickPixels += 1;
    }
  }
  return stats;
}
