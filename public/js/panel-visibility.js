/**
 * Panel visibility registry for the Video → Sprite workspace.
 *
 * This is a pure UI concern: hiding a panel never changes the pipeline, it only
 * takes the controls off the screen, and the values they hold keep being used
 * exactly as before. Hiding "Erase Brush" does not erase the strokes already
 * painted; it hides the sliders that made them.
 *
 * DOM-free on purpose so it can be tested outside a browser — `app.js` owns the
 * wiring and the `deactivate` hooks.
 *
 * The stored value is the list of **hidden** ids, not a full map: a panel added
 * later is then visible by default for someone who has already saved a layout,
 * which is the only sane default for a control they have never seen.
 */

export const PANEL_STORAGE_KEY = 'video-editor:panels:hidden';

export const PANEL_GROUPS = [
  {
    key: 'sprite',
    label: 'Sprite sheet settings',
    hint: 'Cột cài đặt bên trái',
    panels: [
      { id: 'frames', label: 'Frames', hint: 'Số frame lấy từ vùng trim', elements: ['panelFrames'] },
      { id: 'resolution', label: 'Original resolution & Cell size', hint: 'Keep source size + Cell (native)', elements: ['panelKeepSourceSize', 'panelCellNative'] },
      { id: 'grid', label: 'Rows & Cols', hint: 'Lưới của sprite sheet', elements: ['panelRows', 'panelCols'] },
      { id: 'crop', label: 'Crop 4 cạnh', hint: 'Crop top / bottom / left / right', elements: ['panelCropTop', 'panelCropBottom', 'panelCropLeft', 'panelCropRight'] },
      { id: 'watermark', label: 'Watermark eraser', hint: 'Chọn vùng watermark trên source', elements: ['groupWatermarkEraser'], deactivate: 'watermark' },
      { id: 'alignment', label: 'Subject Alignment', hint: 'Trục gióng X & Y', elements: ['groupSubjectAlignment'] },
      { id: 'loop', label: 'Loop Mode & Seam Smoothing', hint: 'Closed loop, crossfade, ping-pong', elements: ['groupLoopSettings'] },
      { id: 'download-name', label: 'Download name', hint: 'Tên file xuất ra', elements: ['panelDownloadName'] },
      { id: 'speed', label: 'Video Speed', hint: 'Tốc độ phát nguồn', elements: ['panelVideoSpeed'] },
      { id: 'fps', label: 'Preview FPS', hint: 'FPS của animation preview', elements: ['panelPreviewFps'] }
    ]
  },
  {
    key: 'chroma',
    label: 'Chroma key & Effects',
    hint: 'Panel phía dưới',
    panels: [
      { id: 'similarity', label: 'Similarity', hint: 'Color tolerance của keyer', elements: ['panelSimilarity'] },
      { id: 'blend', label: 'Blend', hint: 'Feather biên alpha', elements: ['panelBlend'] },
      { id: 'spill', label: 'Spill Suppression', hint: 'Khử halo màu key ở viền', elements: ['panelSpill'] },
      { id: 'subject-protection', label: 'Subject Color Protection', hint: 'Giữ màu chủ thể gần màu key', elements: ['panelSubjectProtection'] },
      { id: 'edge-cleanup', label: 'Edge Cleanup', hint: 'Bào 0–3 px viền màu', elements: ['panelEdgeCleanup'] },
      { id: 'chroma-smooth', label: 'Chroma Smoothing', hint: 'Làm mịn 4:2:0 trước khi khóa', elements: ['panelChromaSmooth'] },
      { id: 'subject-guard', label: 'Subject Guard', hint: 'Lấp lỗ thủng giữa thân, giữ màu gốc chủ thể', elements: ['panelSubjectGuard'] },
      { id: 'protect-brush', label: 'Subject Protect Brush', hint: 'Bôi bảo vệ chủ thể', elements: ['groupProtectionBrush'], deactivate: 'protectionBrush' },
      { id: 'erase-brush', label: 'Erase Brush · Bút Xóa', hint: 'Bôi xóa trên video / preview', elements: ['groupEraseBrush'], deactivate: 'eraseBrush' },
      { id: 'color-replace', label: 'Subject Color Replace', hint: 'Đổi màu chi tiết trên chủ thể', elements: ['groupColorReplace'] },
      { id: 'color-grade', label: 'Color & Detail', hint: 'Exposure, contrast, saturation, sharpen', elements: ['groupColorGrade'] },
      { id: 'chroma-key', label: 'Green screen / Chroma key', hint: 'Format, key colors, vùng tròn + pick màu', elements: ['groupChromaKey'], deactivate: 'colorTools' }
    ]
  }
];

export const PANEL_DEFS = PANEL_GROUPS.flatMap((group) => group.panels.map((panel) => ({ ...panel, group: group.key })));

const PANEL_IDS = PANEL_DEFS.map((panel) => panel.id);
const PANEL_ID_SET = new Set(PANEL_IDS);

export function listPanelIds() {
  return PANEL_IDS.slice();
}

export function getPanel(id) {
  return PANEL_DEFS.find((panel) => panel.id === id) || null;
}

/**
 * Accepts whatever came out of localStorage and returns a complete
 * id -> visible map. Unknown ids are dropped (a panel may have been renamed or
 * removed) and anything malformed degrades to "everything visible" rather than
 * throwing — a corrupt preference must never cost someone their controls.
 */
export function parseVisibility(raw) {
  const hidden = new Set();
  let source = raw;
  if (typeof source === 'string') {
    try {
      source = JSON.parse(source);
    } catch (_) {
      source = null;
    }
  }
  if (Array.isArray(source)) {
    for (const id of source) {
      if (PANEL_ID_SET.has(id)) hidden.add(id);
    }
  } else if (source && typeof source === 'object') {
    // Tolerate a full map too, in case an older build wrote one.
    for (const [id, visible] of Object.entries(source)) {
      if (PANEL_ID_SET.has(id) && visible === false) hidden.add(id);
    }
  }
  const state = {};
  for (const id of PANEL_IDS) state[id] = !hidden.has(id);
  return state;
}

export function hiddenIds(state) {
  return PANEL_IDS.filter((id) => state && state[id] === false);
}

export function serializeVisibility(state) {
  return JSON.stringify(hiddenIds(state));
}

export function countHidden(state) {
  return hiddenIds(state).length;
}

export function isPanelVisible(state, id) {
  if (!PANEL_ID_SET.has(id)) return true;
  return !state || state[id] !== false;
}

export function setPanelVisible(state, id, visible) {
  const next = parseVisibility(hiddenIds(state));
  if (PANEL_ID_SET.has(id)) next[id] = Boolean(visible);
  return next;
}

export function allVisible() {
  const state = {};
  for (const id of PANEL_IDS) state[id] = true;
  return state;
}

/** Every panel in one group flipped at once; the other groups keep their state. */
export function setGroupVisible(state, groupKey, visible) {
  const next = parseVisibility(hiddenIds(state));
  const group = PANEL_GROUPS.find((entry) => entry.key === groupKey);
  if (!group) return next;
  for (const panel of group.panels) next[panel.id] = Boolean(visible);
  return next;
}

/**
 * The "Gọn tối đa" preset: what is left when you strip the workspace down to
 * what you cannot make a sprite sheet without — how many frames, how they are
 * laid out, what gets cropped away, and the key colours themselves.
 */
export const MINIMAL_PANEL_IDS = ['frames', 'resolution', 'grid', 'crop', 'chroma-key', 'similarity'];

export function minimalVisibility() {
  const state = {};
  for (const id of PANEL_IDS) state[id] = MINIMAL_PANEL_IDS.includes(id);
  return state;
}
