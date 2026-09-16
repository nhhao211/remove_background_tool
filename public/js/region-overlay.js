/**
 * Drawing and editing of colour regions, shared by every surface that hosts one.
 *
 * There are four of them: the Source Video, the sprite Preview, and the
 * `Original` and `Transparent result` canvases of Clean Sprite Sheet. Hit
 * testing, dragging, resizing and the dashed-ring rendering are identical on
 * all four; only the mapping between a pixel on that surface and a normalised
 * source coordinate differs. So that mapping is the *only* thing a caller
 * supplies — `toSource` / `toCanvas` / `scaleToCanvas` — and everything else
 * lives here once, instead of four times across `app.js` (6 500 lines) and
 * `sprite-remover.js`.
 *
 * The maths is exported separately from the DOM wiring so it can be tested in
 * Node, the same split `preview-erase-map.js` and `stroke-mask.js` use.
 *
 * Dependency direction is one way: `app.js` and `sprite-remover.js` import this;
 * this imports neither.
 */

export const MIN_REGION_RADIUS = 0.002;
export const EDGE_TOLERANCE_PX = 6;

const clamp01 = (value) => Math.min(1, Math.max(0, Number(value) || 0));

/* ------------------------------------------------------------------ *
 * Pure geometry — tested by test/region-overlay.test.mjs
 * ------------------------------------------------------------------ */

/**
 * Finds the region under `point`.
 *
 * `regions` are already projected to overlay pixels (`{ id, cx, cy, rx, ry }`),
 * because that is the space the 6-pixel grab tolerance is meaningful in — a
 * tolerance in normalised units would be a different number of pixels at every
 * zoom level.
 *
 * Nested regions resolve to the *smallest* one containing the point. Picking
 * the first match instead would make a small region drawn inside a large one
 * unreachable, which is exactly the case a user hits when refining a detail.
 *
 * @returns {{ id: string|null, part: 'body'|'edge'|null }}
 */
export function hitTestRegion(regions, point, tolerancePx = EDGE_TOLERANCE_PX) {
  if (!Array.isArray(regions) || !point) return { id: null, part: null };
  const tolerance = Math.max(0, Number(tolerancePx) || 0);
  let best = null;

  for (const region of regions) {
    const rx = Number(region?.rx);
    const ry = Number(region?.ry);
    if (!(rx > 0) || !(ry > 0)) continue;
    const dx = point.x - region.cx;
    const dy = point.y - region.cy;
    const t = Math.hypot(dx / rx, dy / ry);
    // First-order distance to the ellipse: |t - 1| divided by the gradient of
    // the same implicit function. Scaling by the shorter semi-axis instead
    // would be wrong on any elongated region — on a 80x20 ellipse it puts the
    // grab band 24 px deep along the long axis, so the body cannot be dragged.
    const gradient = t > 0 ? Math.hypot(dx / (rx * rx), dy / (ry * ry)) / t : 0;
    const edgeDistance = gradient > 0 ? (Math.abs(t - 1) / gradient) : Infinity;
    const onEdge = edgeDistance <= tolerance;
    if (t > 1 && !onEdge) continue;
    const area = rx * ry;
    if (best && best.area <= area) continue;
    best = { id: region.id ?? null, part: onEdge ? 'edge' : 'body', area };
  }

  return best ? { id: best.id, part: best.part } : { id: null, part: null };
}

/**
 * Turns a centre-out drag into region geometry, in normalised source space.
 *
 * Drawing from the centre rather than corner-to-corner is deliberate: the user
 * is looking straight at the detail they want gone, so that is where the
 * pointer already is.
 *
 * `aspect` is `sourceWidth / sourceHeight`. Without it, `Shift` would equalise
 * normalised radii and produce a visible oval on any non-square source.
 */
export function dragToRegion(anchor, current, options = {}) {
  const aspect = Number(options.aspect) > 0 ? Number(options.aspect) : 1;
  const dx = current.x - anchor.x;
  const dy = current.y - anchor.y;
  let rx;
  let ry;
  if (options.shiftKey) {
    const radius = Math.hypot(dx, dy / aspect);
    rx = radius;
    ry = radius * aspect;
  } else {
    rx = Math.abs(dx);
    ry = Math.abs(dy);
  }
  return clampRegion({ cx: anchor.x, cy: anchor.y, rx, ry });
}

/** Keeps a region inside the source and above the "this was a stray click" floor. */
export function clampRegion(region) {
  return {
    ...region,
    cx: clamp01(region?.cx),
    cy: clamp01(region?.cy),
    rx: Math.min(2, Math.max(MIN_REGION_RADIUS, Number(region?.rx) || 0)),
    ry: Math.min(2, Math.max(MIN_REGION_RADIUS, Number(region?.ry) || 0))
  };
}

/* ------------------------------------------------------------------ *
 * DOM wiring
 * ------------------------------------------------------------------ */

const ACCENT = '#38bdf8';

/**
 * @param {object} options
 * @param {HTMLCanvasElement} options.canvas overlay sitting on top of the surface
 * @param {() => Array} options.getRegions normalised regions, read fresh every time
 * @param {() => string|null} [options.getSelectedId]
 * @param {(px:number, py:number, event:PointerEvent) => ({x:number,y:number}|null)} options.toSource
 * @param {(sx:number, sy:number) => ({x:number,y:number})} options.toCanvas
 * @param {(rx:number, ry:number) => ({rx:number,ry:number})} options.scaleToCanvas
 * @param {() => number} [options.getAspect] sourceWidth / sourceHeight
 * @param {(region:object, event:PointerEvent) => void} [options.onCreate]
 * @param {(id:string, patch:object) => void} [options.onChange]
 * @param {(id:string|null) => void} [options.onSelect]
 * @param {(id:string) => void} [options.onDelete]
 * @param {(id:string|null, point:{x:number,y:number}, event:PointerEvent) => void} [options.onPickRequest]
 * @param {(region:object) => boolean} [options.isRegionDimmed] bound to another frame
 * @param {() => void} [options.onEscape]
 */
export function createRegionOverlay(options) {
  const canvas = options.canvas;
  if (!canvas) throw new Error('createRegionOverlay: canvas is required');
  const ctx = canvas.getContext('2d');

  const call = (name, ...args) => (typeof options[name] === 'function' ? options[name](...args) : undefined);
  const getRegions = () => (typeof options.getRegions === 'function' ? options.getRegions() || [] : []);
  const getSelectedId = () => call('getSelectedId') ?? null;
  const getAspect = () => {
    const aspect = call('getAspect');
    return Number(aspect) > 0 ? Number(aspect) : 1;
  };

  let mode = 'off';
  let drag = null;
  let pointerId = null;
  let draft = null;

  const project = (region) => {
    const centre = options.toCanvas(region.cx, region.cy);
    const radii = options.scaleToCanvas(region.rx, region.ry);
    return { id: region.id, cx: centre.x, cy: centre.y, rx: radii.rx, ry: radii.ry, region };
  };

  const localPoint = (event) => {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    // The rect already includes any CSS transform on the surface, so zoom and
    // pan need no separate handling here — the same property the Erase Brush
    // overlay on the Preview relies on.
    return {
      x: (event.clientX - rect.left) * (canvas.width / rect.width),
      y: (event.clientY - rect.top) * (canvas.height / rect.height)
    };
  };

  function render() {
    if (canvas.width < 1 || canvas.height < 1) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // The rings belong to the tool, not to the picture. With the tool off they
    // are cleared away completely, so nothing of the editing UI is left lying on
    // top of the sprite sheet the user is judging.
    if (mode === 'off') return;

    const selectedId = getSelectedId();
    for (const region of getRegions()) {
      if (!region) continue;
      const shape = project(region);
      if (!(shape.rx > 0) || !(shape.ry > 0)) continue;
      const dimmed = call('isRegionDimmed', region) === true;
      drawRegion(shape, {
        selected: region.id != null && region.id === selectedId,
        dimmed,
        softness: Number(region.softness) || 0,
        disabled: region.enabled === false
      });
    }
    if (draft) drawRegion(project(draft), { selected: true, dimmed: false, softness: 0, disabled: false });
  }

  function drawRegion(shape, style) {
    ctx.save();
    // A region bound to a frame other than the one on screen is drawn faintly
    // rather than hidden: it does not apply here, but the user still needs to
    // see that it exists. Same convention as framed erase strokes.
    ctx.globalAlpha = style.dimmed ? 0.4 : 1;
    ctx.lineWidth = 2;
    ctx.setLineDash(style.disabled ? [2, 6] : [6, 4]);
    ctx.strokeStyle = ACCENT;
    ctx.beginPath();
    ctx.ellipse(shape.cx, shape.cy, shape.rx, shape.ry, 0, 0, Math.PI * 2);
    ctx.stroke();

    if (style.softness > 0) {
      const inner = 1 - style.softness;
      ctx.globalAlpha *= 0.45;
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.ellipse(shape.cx, shape.cy, shape.rx * inner, shape.ry * inner, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha /= 0.45;
    }

    if (style.selected) {
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(56, 189, 248, 0.12)';
      ctx.beginPath();
      ctx.ellipse(shape.cx, shape.cy, shape.rx, shape.ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = ACCENT;
      for (const [hx, hy] of [[shape.cx, shape.cy - shape.ry], [shape.cx, shape.cy + shape.ry],
        [shape.cx - shape.rx, shape.cy], [shape.cx + shape.rx, shape.cy]]) {
        ctx.beginPath();
        ctx.arc(hx, hy, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function cursorFor(point) {
    if (mode === 'off') return '';
    if (mode === 'pick') return 'crosshair';
    const hit = hitTestRegion(getRegions().map(project), point);
    if (hit.part === 'edge') return 'nwse-resize';
    if (hit.part === 'body') return 'move';
    return mode === 'draw' ? 'crosshair' : 'default';
  }

  function onPointerDown(event) {
    if (mode === 'off' || event.button !== 0) return;
    const point = localPoint(event);
    if (!point) return;
    const source = options.toSource(point.x, point.y, event);
    // Outside the actual content (letterbox bars, empty cells at the end of the
    // last row): refuse rather than create a region nobody can reach.
    if (!source) return;

    const hit = hitTestRegion(getRegions().map(project), point);

    if (mode === 'pick') {
      call('onPickRequest', hit.id, source, event);
      return;
    }

    event.preventDefault();
    canvas.setPointerCapture?.(event.pointerId);
    pointerId = event.pointerId;

    if (hit.id != null) {
      const region = getRegions().find((item) => item.id === hit.id);
      call('onSelect', hit.id);
      drag = hit.part === 'edge'
        ? { kind: 'resize', id: hit.id, origin: { cx: region.cx, cy: region.cy } }
        : { kind: 'move', id: hit.id, grab: source, origin: { cx: region.cx, cy: region.cy } };
      render();
      return;
    }

    if (mode !== 'draw') {
      call('onSelect', null);
      render();
      return;
    }

    drag = { kind: 'create', anchor: source, shiftKey: event.shiftKey };
    draft = { ...clampRegion({ cx: source.x, cy: source.y, rx: MIN_REGION_RADIUS, ry: MIN_REGION_RADIUS }), softness: 0 };
    render();
  }

  function onPointerMove(event) {
    const point = localPoint(event);
    if (!point) return;
    if (!drag) {
      canvas.style.cursor = cursorFor(point);
      return;
    }
    if (pointerId != null && event.pointerId !== pointerId) return;
    const source = options.toSource(point.x, point.y, event);
    if (!source) return;

    if (drag.kind === 'create') {
      draft = { ...dragToRegion(drag.anchor, source, { shiftKey: event.shiftKey, aspect: getAspect() }), softness: 0 };
      render();
      return;
    }
    if (drag.kind === 'move') {
      const patch = clampRegion({
        cx: drag.origin.cx + (source.x - drag.grab.x),
        cy: drag.origin.cy + (source.y - drag.grab.y),
        rx: MIN_REGION_RADIUS,
        ry: MIN_REGION_RADIUS
      });
      call('onChange', drag.id, { cx: patch.cx, cy: patch.cy });
      render();
      return;
    }
    if (drag.kind === 'resize') {
      const next = dragToRegion(drag.origin
        ? { x: drag.origin.cx, y: drag.origin.cy }
        : source, source, { shiftKey: event.shiftKey, aspect: getAspect() });
      call('onChange', drag.id, { rx: next.rx, ry: next.ry });
      render();
    }
  }

  function onPointerUp(event) {
    if (!drag) return;
    if (pointerId != null && event?.pointerId != null && event.pointerId !== pointerId) return;
    try { canvas.releasePointerCapture?.(pointerId); } catch (_) { /* optional */ }
    const finished = drag;
    drag = null;
    pointerId = null;

    if (finished.kind === 'create') {
      const created = draft;
      draft = null;
      // A click with no drag is not a region; it would be a MIN_REGION_RADIUS
      // dot the user cannot see, let alone grab again.
      if (created && (created.rx > MIN_REGION_RADIUS * 1.5 || created.ry > MIN_REGION_RADIUS * 1.5)) {
        call('onCreate', created, event);
      }
    }
    render();
  }

  function onKeyDown(event) {
    if (mode === 'off') return;
    const target = event.target;
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName || '')) return;
    if (event.key === 'Escape') {
      setMode('off');
      call('onEscape');
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      const selectedId = getSelectedId();
      if (selectedId == null) return;
      event.preventDefault();
      call('onDelete', selectedId);
      render();
    }
  }

  const onContextMenu = (event) => {
    if (mode !== 'off') event.preventDefault();
  };

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('keydown', onKeyDown);

  function setMode(next) {
    const value = ['draw', 'edit', 'pick'].includes(next) ? next : 'off';
    if (value === mode) return;
    mode = value;
    if (mode === 'off') {
      drag = null;
      draft = null;
      pointerId = null;
    }
    canvas.classList.toggle('active', mode !== 'off');
    canvas.style.cursor = mode === 'off' ? '' : 'crosshair';
    render();
  }

  return {
    setMode,
    getMode: () => mode,
    render,
    destroy() {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('keydown', onKeyDown);
    }
  };
}
