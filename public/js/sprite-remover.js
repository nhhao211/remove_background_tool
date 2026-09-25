import { runKeyer } from './keyer/index.js';
import { refineEdges } from './edge-refine.js';
import { applySubjectGuard, luminanceWeightFor } from './subject-guard.js';
import { applyAlphaBleed } from './alpha-bleed.js';
import { encodePNG, canEncodePNG } from './png-encoder.js';
import { applyRegionKeys, normalizeRegion, regionIsActive } from './region-key.js';
import { createRegionOverlay } from './region-overlay.js';
import { initCollapsibleSections } from './sidebar-sections.js';

document.addEventListener('DOMContentLoaded', () => {
  const byId = (id) => document.getElementById(id);
  // Fold the sidebar's sections before anything reads their layout: the column
  // is taller than any viewport with all of them open.
  initCollapsibleSections(byId('cleanerSidebar'), { storagePrefix: 'cleaner.section' });
  const tabVideo = byId('tabVideoWorkspace');
  const tabCleaner = byId('tabSpriteCleaner');
  const tabReframe = byId('tabSpriteReframe');
  const tabTransform = byId('tabSpriteTransform');
  const videoWorkspace = byId('videoWorkspace');
  const cleanerWorkspace = byId('spriteCleanerWorkspace');
  const reframeWorkspace = byId('spriteReframeWorkspace');
  const transformWorkspace = byId('spriteTransformWorkspace');
  const videoHeaderActions = byId('videoHeaderActions');
  const fullPageDropOverlay = byId('fullPageDropOverlay');
  const fullPageDropTitle = byId('fullPageDropTitle');
  const fullPageDropHint = byId('fullPageDropHint');

  const imageInput = byId('spriteImageInput');
  const dropZone = byId('spriteDropZone');
  const dropTitle = byId('spriteDropTitle');
  const dropHint = byId('spriteDropHint');
  const originalCanvas = byId('spriteOriginalCanvas');
  const resultCanvas = byId('spriteResultCanvas');
  const originalStage = byId('spriteOriginalStage');
  const resultStage = byId('spriteResultStage');
  const fileLabel = byId('spriteFileLabel');
  const imageInfo = byId('spriteImageInfo');
  const resultStatus = byId('spriteResultStatus');
  const btnAuto = byId('btnSpriteAutoRemove');
  const btnApply = byId('btnSpriteApply');
  const btnReset = byId('btnSpriteReset');
  const btnPick = byId('btnSpritePickColor');
  const btnPickLower = byId('btnSpritePickLower');
  const adjustSplit = byId('spriteAdjustSplit');
  const splitValue = byId('spriteSplitValue');
  const manualColor = byId('spriteManualColor');
  const btnAddColor = byId('btnSpriteAddColor');
  const btnClearColors = byId('btnSpriteClearColors');
  const colorSwatches = byId('spriteColorSwatches');
  const colorCount = byId('spriteColorCount');
  const similarity = byId('spriteSimilarity');
  const feather = byId('spriteFeather');
  const spill = byId('spriteSpill');
  const preserveColors = byId('spritePreserveColors');
  const protection = byId('spriteProtection');
  const cleanup = byId('spriteCleanup');
  const subjectGuardSection = byId('spriteSubjectGuardSection');
  const subjectGuard = byId('spriteSubjectGuard');
  const subjectGuardStrength = byId('spriteSubjectGuardStrength');
  const subjectGuardLeak = byId('spriteSubjectGuardLeak');
  const edgeRefineSection = byId('spriteEdgeRefineSection');
  const edgeRefine = byId('spriteEdgeRefine');
  const edgeWidth = byId('spriteEdgeWidth');
  const edgeSmooth = byId('spriteEdgeSmooth');
  const edgeDecontaminate = byId('spriteEdgeDecontaminate');
  const edgePixelArt = byId('spriteEdgePixelArt');
  const perCell = byId('spritePerCell');
  const rows = byId('spriteRows');
  const cols = byId('spriteCols');
  const gridInputs = byId('spriteGridInputs');
  const downloadName = byId('spriteDownloadName');
  const outputFormat = byId('spriteOutputFormat');
  const btnDownload = byId('btnSpriteDownload');
  const btnSendToTransform = byId('btnCleanerSendToTransform');
  const progress = byId('spriteProcessProgress');
  const btnZoomOut = byId('btnCleanerZoomOut');
  const btnZoomIn = byId('btnCleanerZoomIn');
  const btnZoomFit = byId('btnCleanerZoomFit');
  const btnPreviewPlay = byId('btnCleanerPlay');
  const btnPreviewMode = byId('btnCleanerMode');
  const frameCounter = byId('cleanerFrameCounter');
  const previewFps = byId('cleanerPreviewFps');
  const zoomLevel = byId('cleanerZoomLevel');
  const btnToggleBg = byId('btnCleanerToggleBg');
  const pickBanner = byId('spritePickBanner');
  const pickBannerText = byId('spritePickBannerText');
  const resultPickBanner = byId('spriteResultPickBanner');
  const lowerHalfGuide = byId('spriteLowerHalfGuide');
  const protectedRegionLabel = byId('spriteProtectedRegionLabel');
  const splitHandle = byId('spriteSplitHandle');
  const pickerLoupe = byId('spritePickerLoupe');
  const pickerCanvas = byId('spritePickerCanvas');
  const pickerHex = byId('spritePickerHex');
  const spritePickerCoord = byId('spritePickerCoord');
  const pickerScope = byId('spritePickerScope');
  const btnRegionPick = byId('btnSpriteRegionPick');
  const regionControls = byId('spriteRegionControls');
  const regionLabel = byId('spriteRegionLabel');
  const btnRegionPickColor = byId('btnSpriteRegionPickColor');
  const btnRegionDrawNew = byId('btnSpriteRegionDrawNew');
  const regionTolerance = byId('spriteRegionTolerance');
  const regionSoftness = byId('spriteRegionSoftness');
  const regionDespill = byId('spriteRegionDespill');
  const regionConnected = byId('spriteRegionConnected');
  const regionOverlayOriginal = byId('spriteRegionOverlayOriginal');
  const regionOverlayResult = byId('spriteRegionOverlayResult');
  const regionBanner = byId('spriteRegionBanner');
  const regionBannerText = byId('spriteRegionBannerText');
  const regionBannerResult = byId('spriteRegionBannerResult');
  const regionBannerResultText = byId('spriteRegionBannerResultText');
  // A Result pick removes its colour only this many px from removed background.
  const EDGE_REACH = 2;

  const state = {
    original: null,
    keyed: null,
    // Keyer output after Subject Guard, cached so the guard sliders rerun only
    // the guard and what follows it, never the flood fill.
    guarded: null,
    subjectGuardStats: null,
    subjectGuardTimer: null,
    // Cached between Edge Refine and the region pass, for the same reason
    // `keyed` is cached before refine: dragging a region slider must rerun only
    // the cheapest stage, not the flood fill and not the edge unmix.
    refined: null,
    result: null,
    lastKeyColors: [],
    keyerTuning: null,
    edgeRefineStats: null,
    edgeRefineTimer: null,
    resultStatusBase: '',
    fileName: '',
    manualColors: [],
    seedPoints: [],
    detectedColors: [],
    autoEnabled: false,
    isProcessing: false,
    isPicking: false,
    pickerPoint: null,
    pickScope: 'full',
    pickSurface: 'original',
    pickShift: false,
    hoverPick: null,
    colorRegions: [],
    selectedRegionId: null,
    regionMode: 'off',
    regionPicking: false,
    regionStats: null,
    regionTimer: null,
    lowerSplitRatio: 0.5,
    splitDragPointerId: null,
    splitReprocessTimer: null,
    previewMode: 'anim',
    currentFrameIndex: 0,
    previewTimer: null,
    isPreviewPlaying: false,
    zoom: 1,
    panX: 0,
    panY: 0,
    drag: null,
    checker: true
  };

  const originalContext = originalCanvas.getContext('2d', { willReadFrequently: true });
  const resultContext = resultCanvas.getContext('2d', { willReadFrequently: true });
  const pickerContext = pickerCanvas.getContext('2d', { willReadFrequently: true });

  function isCleanerActive() {
    return document.body.dataset.activeWorkspace === 'sprite-cleaner';
  }

  function setWorkspace(name, { focus = false } = {}) {
    const cleanerActive = name === 'sprite-cleaner';
    const reframeActive = name === 'sprite-reframe';
    const transformActive = name === 'sprite-transform';
    const activeName = cleanerActive ? 'sprite-cleaner' : reframeActive ? 'sprite-reframe' : transformActive ? 'sprite-transform' : 'video';
    document.body.dataset.activeWorkspace = activeName;
    videoWorkspace.hidden = activeName !== 'video';
    cleanerWorkspace.hidden = !cleanerActive;
    reframeWorkspace.hidden = !reframeActive;
    if (transformWorkspace) transformWorkspace.hidden = !transformActive;
    videoHeaderActions.hidden = activeName !== 'video';
    tabVideo.classList.toggle('active', activeName === 'video');
    tabCleaner.classList.toggle('active', cleanerActive);
    tabReframe.classList.toggle('active', reframeActive);
    if (tabTransform) tabTransform.classList.toggle('active', transformActive);
    tabVideo.setAttribute('aria-selected', String(activeName === 'video'));
    tabCleaner.setAttribute('aria-selected', String(cleanerActive));
    tabReframe.setAttribute('aria-selected', String(reframeActive));
    if (tabTransform) tabTransform.setAttribute('aria-selected', String(transformActive));
    tabVideo.tabIndex = activeName === 'video' ? 0 : -1;
    tabCleaner.tabIndex = cleanerActive ? 0 : -1;
    tabReframe.tabIndex = reframeActive ? 0 : -1;
    if (tabTransform) tabTransform.tabIndex = transformActive ? 0 : -1;
    if (activeName === 'video') {
      fullPageDropTitle.textContent = 'Thả file Video vào đây';
      fullPageDropHint.textContent = 'Hỗ trợ các định dạng .mp4, .webm, .mov, .avi, .mkv';
    } else if (activeName === 'sprite-transform') {
      fullPageDropTitle.textContent = 'Thả Sprite Sheet vào đây để Transform & Scale';
      fullPageDropHint.textContent = 'Hỗ trợ ảnh tĩnh .png, .webp';
    } else {
      fullPageDropTitle.textContent = reframeActive ? 'Thả Sprite Sheet 4×6 vào đây' : 'Thả Sprite Sheet vào đây';
      fullPageDropHint.textContent = 'Hỗ trợ ảnh tĩnh .png, .webp, .jpg, .jpeg';
    }
    if (!cleanerActive) {
      deactivatePicker();
      stopPreviewAnimation();
    }
    if (cleanerActive && state.original) requestAnimationFrame(fitToView);
    window.dispatchEvent(new CustomEvent('workspacechange', { detail: { workspace: activeName } }));
    if (focus) {
      const tabs = { video: tabVideo, 'sprite-cleaner': tabCleaner, 'sprite-reframe': tabReframe, 'sprite-transform': tabTransform };
      tabs[activeName]?.focus();
    }
  }

  window.switchStudioWorkspace = setWorkspace;

  tabVideo.addEventListener('click', () => setWorkspace('video'));
  tabCleaner.addEventListener('click', () => setWorkspace('sprite-cleaner'));
  tabReframe.addEventListener('click', () => setWorkspace('sprite-reframe'));
  if (tabTransform) tabTransform.addEventListener('click', () => setWorkspace('sprite-transform'));
  const allWorkspaceTabs = [tabVideo, tabCleaner, tabReframe, tabTransform].filter(Boolean);
  allWorkspaceTabs.forEach((tab, index, tabs) => {
    tab.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      let nextIndex = index;
      if (event.key === 'Home') nextIndex = 0;
      else if (event.key === 'End') nextIndex = tabs.length - 1;
      else nextIndex = (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      const targetTab = tabs[nextIndex];
      const nextName = targetTab === tabCleaner ? 'sprite-cleaner' : targetTab === tabReframe ? 'sprite-reframe' : targetTab === tabTransform ? 'sprite-transform' : 'video';
      setWorkspace(nextName, { focus: true });
    });
  });
  setWorkspace('video');

  function showToast(message, type = 'info') {
    const container = byId('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icon = document.createElement('i');
    icon.setAttribute('data-lucide', type === 'success' ? 'check-circle' : type === 'error' ? 'alert-triangle' : 'info');
    icon.style.width = '16px';
    icon.style.height = '16px';
    const text = document.createElement('span');
    text.textContent = message;
    toast.append(icon, text);
    container.appendChild(toast);
    window.lucide?.createIcons({ root: toast });
    setTimeout(() => toast.remove(), 3600);
  }

  function hexColor(color) {
    return color.hex || `#${[color.r, color.g, color.b].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
  }

  function colorFromHex(value) {
    const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(value || '');
    if (!match) return null;
    return {
      r: parseInt(match[1], 16),
      g: parseInt(match[2], 16),
      b: parseInt(match[3], 16),
      hex: `#${match[1]}${match[2]}${match[3]}`.toLowerCase()
    };
  }

  function allColors() {
    const colors = [...state.manualColors];
    for (const color of state.detectedColors) {
      if (!colors.some((item) => Math.abs(item.r - color.r) + Math.abs(item.g - color.g) + Math.abs(item.b - color.b) < 18)) {
        colors.push(color);
      }
    }
    return colors;
  }

  function addManualColor(color, { process = true, point = null, scope = 'full' } = {}) {
    if (!color) return false;
    const existingIndex = state.manualColors.findIndex((item) => Math.abs(item.r - color.r) + Math.abs(item.g - color.g) + Math.abs(item.b - color.b) < 10);
    const duplicate = existingIndex >= 0;
    // An edge pick adds nothing to a colour already keyed everywhere, and must
    // not narrow that key down to the edge.
    if (duplicate && scope === 'edge' && state.manualColors[existingIndex].scope !== 'edge') {
      showToast('Màu này đã được xoá ở mọi nơi.', 'info');
      return false;
    }
    // A seed floods background from its point; an edge key must never flood.
    if (point && scope !== 'edge' && !state.seedPoints.some((item) => item.x === point.x && item.y === point.y)) {
      state.seedPoints.push({ x: point.x, y: point.y, hex: color.hex, scope });
    }
    if (duplicate && !point) {
      showToast('Màu này đã có trong danh sách.', 'info');
      return false;
    }
    if (!duplicate) state.manualColors.push({ ...color, scope });
    else if (point) state.manualColors[existingIndex].scope = scope;
    if (scope === 'lower') {
      state.autoEnabled = false;
      state.detectedColors = [];
    }
    renderColors();
    if (process && state.original) runProcessing({ autoDetect: state.autoEnabled });
    return true;
  }

  function renderColors() {
    colorSwatches.replaceChildren();
    const colors = allColors();
    colorCount.textContent = `${colors.length} color${colors.length === 1 ? '' : 's'}`;
    colors.forEach((color) => {
      const manualIndex = state.manualColors.findIndex((item) => item.hex === color.hex);
      const swatch = document.createElement('div');
      swatch.className = `color-swatch cleaner-swatch${manualIndex >= 0 ? '' : ' auto-color'}`;
      const scopeLabel = color.scope === 'lower'
        ? ' · lower half of each sprite cell only'
        : (color.scope === 'edge' ? ` · edge only, within ${EDGE_REACH} px of removed background` : '');
      swatch.title = `${hexColor(color)}${manualIndex >= 0 ? ' · picked' : ' · auto detected'}${scopeLabel}`;
      const chip = document.createElement('span');
      chip.style.background = hexColor(color);
      const label = document.createElement('small');
      label.textContent = `${hexColor(color)}${color.scope === 'lower' ? ' ↓½' : ''}${color.scope === 'edge' ? ' ⌇ edge' : ''}`;
      swatch.append(chip, label);
      if (manualIndex >= 0) {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = '×';
        remove.setAttribute('aria-label', `Remove ${hexColor(color)}`);
        remove.addEventListener('click', () => {
          state.seedPoints = state.seedPoints.filter((point) => point.hex !== color.hex);
          state.manualColors.splice(manualIndex, 1);
          renderColors();
          runProcessing({ autoDetect: state.autoEnabled });
        });
        swatch.appendChild(remove);
      }
      colorSwatches.appendChild(swatch);
    });
    renderRegionChips();
    btnClearColors.disabled = !state.original || (colors.length === 0 && state.colorRegions.length === 0);
  }

  /**
   * Regions are listed next to the colours but are deliberately NOT merged into
   * `state.manualColors`: a region colour must never reach `processOptions()`,
   * or it would become a global key (or worse, a seed point) and flood the
   * whole sheet — the exact failure this feature exists to avoid.
   */
  function renderRegionChips() {
    for (const region of state.colorRegions) {
      const swatch = document.createElement('div');
      swatch.className = 'color-swatch cleaner-swatch cleaner-region-chip';
      swatch.classList.toggle('is-selected', region.id === state.selectedRegionId);
      const radiusPx = Math.round(region.rx * (state.original?.width || 0));
      const hex = region.colors[0] ? hexColor(region.colors[0]) : 'chưa pick màu';
      swatch.title = `Vùng tròn · chỉ xoá bên trong vòng tròn · r≈${radiusPx}px`
        + (region.frame === null ? '' : ` · vẽ trên ô #${region.frame + 1}`);
      const chip = document.createElement('span');
      chip.style.background = region.colors[0] ? hexColor(region.colors[0]) : 'transparent';
      chip.style.border = '1px dashed #38bdf8';
      const label = document.createElement('small');
      label.textContent = `◯ ${hex} · r=${radiusPx}px`;
      swatch.append(chip, label);
      swatch.addEventListener('click', (event) => {
        if (event.target.tagName === 'BUTTON') return;
        selectRegion(region.id);
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `Remove region ${hex}`);
      remove.addEventListener('click', () => deleteRegion(region.id));
      swatch.appendChild(remove);
      colorSwatches.appendChild(swatch);
    }
  }

  function cloneImageData(source) {
    return new ImageData(new Uint8ClampedArray(source.data), source.width, source.height);
  }

  function drawImageData(canvas, context, imageData) {
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    context.putImageData(imageData, 0, 0);
  }

  function gridDefinition() {
    const rowCount = perCell.checked ? Math.max(1, Math.min(100, Math.round(Number(rows.value) || 1))) : 1;
    const colCount = perCell.checked ? Math.max(1, Math.min(100, Math.round(Number(cols.value) || 1))) : 1;
    return { rows: rowCount, cols: colCount, total: rowCount * colCount };
  }

  function frameRect(index) {
    const grid = gridDefinition();
    const safeIndex = Math.max(0, Math.min(grid.total - 1, index));
    const row = Math.floor(safeIndex / grid.cols);
    const col = safeIndex % grid.cols;
    const x0 = Math.floor((col * state.original.width) / grid.cols);
    const x1 = Math.floor(((col + 1) * state.original.width) / grid.cols);
    const y0 = Math.floor((row * state.original.height) / grid.rows);
    const y1 = Math.floor(((row + 1) * state.original.height) / grid.rows);
    return { x0, y0, width: x1 - x0, height: y1 - y0 };
  }

  function extractRegion(source, rect) {
    const data = new Uint8ClampedArray(rect.width * rect.height * 4);
    for (let y = 0; y < rect.height; y += 1) {
      const sourceStart = ((((rect.y0 + y) * source.width) + rect.x0) * 4);
      data.set(source.data.subarray(sourceStart, sourceStart + (rect.width * 4)), y * rect.width * 4);
    }
    return new ImageData(data, rect.width, rect.height);
  }

  function updatePreviewButtons() {
    const grid = gridDefinition();
    const animMode = state.previewMode === 'anim' && perCell.checked;
    frameCounter.textContent = state.original
      ? `${animMode ? state.currentFrameIndex + 1 : grid.total}/${grid.total}`
      : '0/0';
    btnPreviewMode.querySelector('span').textContent = animMode ? 'Sheet' : 'Anim';
    btnPreviewPlay.disabled = !state.original || !animMode;
    const icon = btnPreviewPlay.querySelector('[data-lucide]');
    if (icon) icon.setAttribute('data-lucide', state.isPreviewPlaying ? 'pause' : 'play');
    btnPreviewPlay.querySelector('span').textContent = state.isPreviewPlaying ? 'Pause' : 'Play';
    btnPreviewPlay.classList.toggle('active', state.isPreviewPlaying);
    window.lucide?.createIcons({ root: btnPreviewPlay });
  }

  function renderPreview({ fit = false } = {}) {
    if (!state.original || !state.result) return;
    const grid = gridDefinition();
    state.currentFrameIndex = Math.max(0, Math.min(grid.total - 1, state.currentFrameIndex));
    if (state.previewMode === 'anim' && perCell.checked) {
      const rect = frameRect(state.currentFrameIndex);
      drawImageData(originalCanvas, originalContext, extractRegion(state.original, rect));
      drawImageData(resultCanvas, resultContext, extractRegion(state.result, rect));
    } else {
      drawImageData(originalCanvas, originalContext, state.original);
      drawImageData(resultCanvas, resultContext, state.result);
    }
    updatePreviewButtons();
    syncRegionOverlays();
    if (fit) requestAnimationFrame(fitToView);
    if (state.isPicking && state.pickScope === 'lower') requestAnimationFrame(updateLowerHalfGuide);
  }

  function stopPreviewAnimation() {
    if (state.previewTimer) clearInterval(state.previewTimer);
    state.previewTimer = null;
    state.isPreviewPlaying = false;
    if (btnPreviewPlay) updatePreviewButtons();
  }

  function startPreviewAnimation() {
    if (!state.original || !perCell.checked || state.previewMode !== 'anim') return;
    stopPreviewAnimation();
    state.isPreviewPlaying = true;
    const fps = Math.max(1, Math.min(60, Number(previewFps.value) || 12));
    state.previewTimer = setInterval(() => {
      const grid = gridDefinition();
      state.currentFrameIndex = (state.currentFrameIndex + 1) % grid.total;
      renderPreview();
    }, 1000 / fps);
    updatePreviewButtons();
  }

  function setControlsEnabled(enabled) {
    [btnAuto, btnApply, btnReset, btnPick, btnPickLower, btnRegionPick, adjustSplit, btnAddColor, btnDownload, btnSendToTransform, btnZoomOut, btnZoomIn, btnZoomFit, btnPreviewMode, previewFps]
      .filter(Boolean)
      .forEach((button) => { button.disabled = !enabled; });
    btnPreviewPlay.disabled = !enabled || state.previewMode !== 'anim' || !perCell.checked;
  }

  async function loadSpriteSource(source, { fileName = 'sprite_sheet.png', fileSize = null, rowsCount = null, colsCount = null, fpsValue = null, downloadNameVal = null, showSuccessToast = true } = {}) {
    if (!source) return;
    try {
      stopPreviewAnimation();
      dropTitle.textContent = 'Loading image…';

      let width = 0;
      let height = 0;

      if (source instanceof HTMLCanvasElement || (typeof OffscreenCanvas !== 'undefined' && source instanceof OffscreenCanvas)) {
        width = source.width;
        height = source.height;
        if (width * height > 50_000_000) {
          throw new Error('Sprite sheet vượt quá giới hạn 50 megapixels.');
        }
        originalCanvas.width = width;
        originalCanvas.height = height;
        originalContext.clearRect(0, 0, width, height);
        originalContext.drawImage(source, 0, 0);
        state.original = originalContext.getImageData(0, 0, width, height);
      } else if (source instanceof ImageData) {
        width = source.width;
        height = source.height;
        if (width * height > 50_000_000) {
          throw new Error('Sprite sheet vượt quá giới hạn 50 megapixels.');
        }
        originalCanvas.width = width;
        originalCanvas.height = height;
        originalContext.clearRect(0, 0, width, height);
        originalContext.putImageData(source, 0, 0);
        state.original = cloneImageData(source);
      } else if (source instanceof Blob || source instanceof File) {
        const bitmap = await createImageBitmap(source);
        width = bitmap.width;
        height = bitmap.height;
        if (width * height > 50_000_000) {
          bitmap.close();
          throw new Error('Sprite sheet vượt quá giới hạn 50 megapixels.');
        }
        originalCanvas.width = width;
        originalCanvas.height = height;
        originalContext.clearRect(0, 0, width, height);
        originalContext.drawImage(bitmap, 0, 0);
        state.original = originalContext.getImageData(0, 0, width, height);
        bitmap.close();
      } else {
        throw new Error('Nguồn ảnh không hợp lệ.');
      }

      state.keyed = null;
      state.guarded = null;
      state.subjectGuardStats = null;
      state.refined = null;
      state.result = cloneImageData(state.original);
      state.fileName = fileName || 'sprite_sheet.png';
      clearRegions();
      state.manualColors = [];
      state.seedPoints = [];
      state.detectedColors = [];
      state.autoEnabled = false;

      if (rowsCount && Number(rowsCount) > 0) {
        rows.value = String(Math.max(1, Math.min(100, Math.round(Number(rowsCount)))));
      }
      if (colsCount && Number(colsCount) > 0) {
        cols.value = String(Math.max(1, Math.min(100, Math.round(Number(colsCount)))));
      }
      if (fpsValue && Number(fpsValue) > 0) {
        previewFps.value = String(Math.max(1, Math.min(60, Math.round(Number(fpsValue)))));
      }

      state.previewMode = perCell.checked ? 'anim' : 'sheet';
      state.currentFrameIndex = 0;
      state.lowerSplitRatio = 0.5;
      adjustSplit.checked = false;
      syncSplitControl();
      preserveColors.checked = true;
      syncPreserveColorControl();
      originalStage.classList.add('has-image');
      resultStage.classList.add('has-image');
      fileLabel.textContent = state.fileName;
      const sizeText = fileSize ? ` · ${(fileSize / 1024 / 1024).toFixed(2)} MB` : '';
      imageInfo.textContent = `${state.original.width} × ${state.original.height}${sizeText}`;
      resultStatus.textContent = 'Ready · choose Auto Remove or Pick Color';
      dropTitle.textContent = state.fileName;
      dropHint.textContent = 'Click to replace sprite sheet';
      downloadName.value = downloadNameVal || (state.fileName.replace(/\.[^/.]+$/, '') || 'sprite_sheet') + '_clean';
      setControlsEnabled(true);
      renderColors();
      renderPreview({ fit: true });
      if (perCell.checked) startPreviewAnimation();
      if (showSuccessToast) {
        showToast(`Đã tải sprite sheet: ${state.fileName}`, 'success');
      }
    } catch (error) {
      dropTitle.textContent = 'Drop sprite sheet here';
      dropHint.textContent = 'PNG, WebP or JPEG · up to 50 megapixels';
      showToast(error.message || 'Không thể đọc ảnh.', 'error');
    } finally {
      if (imageInput) imageInput.value = '';
    }
  }

  async function loadImageFile(file) {
    if (!file) return;
    const validExtension = /\.(png|webp|jpe?g)$/i.test(file.name);
    const validMime = /^image\/(png|webp|jpeg)$/i.test(file.type || '');
    if (!validMime && !validExtension) {
      showToast(`Tệp "${file.name}" không phải PNG, WebP hoặc JPEG hợp lệ.`, 'error');
      return;
    }
    await loadSpriteSource(file, { fileName: file.name, fileSize: file.size });
  }

  function processOptions(autoDetect) {
    return {
      autoDetect,
      keyColors: state.manualColors,
      keyRegions: state.manualColors.map((color) => (color.scope === 'edge' ? {
        hex: color.hex,
        matchMode: 'edge',
        edgeReach: EDGE_REACH
      } : {
        hex: color.hex,
        matchMode: 'global',
        ...(color.scope === 'lower' ? {
          mode: 'cell-lower-half',
          rows: Number(rows.value),
          cols: Number(cols.value),
          splitRatio: state.lowerSplitRatio
        } : {})
      })),
      similarity: Number(similarity.value),
      feather: Number(feather.value),
      spill: Number(spill.value),
      preserveColors: preserveColors.checked,
      subjectProtection: Number(protection.value),
      cleanupRadius: Number(cleanup.value),
      seedPoints: state.seedPoints,
      perCell: perCell.checked,
      rows: Number(rows.value),
      cols: Number(cols.value)
    };
  }

  /**
   * Subject Guard, between the keyer and Edge Refine: refine then works on a
   * body that has its holes filled, instead of unmixing the rim of every hole.
   * Off returns the keyer's own ImageData, so the output is exactly the keyer's.
   *
   * `minPocket: 1` — on a sheet a backdrop-coloured pocket of any size is the
   * backdrop: pixel art has one-pixel gaps between an arm and the body, and a
   * manual pick is meant to remove its colour everywhere. What the guard gives
   * back here is only what is further from the key than the backdrop is.
   */
  function applySubjectGuardPass(keyed) {
    state.subjectGuardStats = null;
    if (!subjectGuard.checked || !state.original) return keyed;
    const guarded = cloneImageData(keyed);
    const options = {
      keyColors: state.lastKeyColors,
      strength: Number(subjectGuardStrength.value),
      leakGuard: Number(subjectGuardLeak.value),
      luminanceWeight: luminanceWeightFor(state.keyerTuning?.subjectProtection ?? Number(protection.value)),
      seedPoints: state.seedPoints,
      minPocket: 1
    };
    const cells = perCell.checked ? gridDefinition().total : 1;
    let restoredPixels = 0;
    for (let index = 0; index < cells; index += 1) {
      const rect = perCell.checked ? frameRect(index) : null;
      restoredPixels += applySubjectGuard(guarded, state.original, { ...options, rect }).restoredPixels;
    }
    state.subjectGuardStats = { restoredPixels };
    return guarded;
  }

  // Off returns the keyer's own ImageData, so the output is exactly the keyer's.
  function applyEdgeRefine(keyed) {
    state.edgeRefineStats = null;
    if (!edgeRefine.checked || !state.original) return keyed;
    const refined = cloneImageData(keyed);
    const options = {
      keyColors: state.lastKeyColors,
      edgeWidth: Number(edgeWidth.value),
      smooth: Number(edgeSmooth.value),
      decontaminate: edgeDecontaminate.checked,
      pixelArt: edgePixelArt.checked,
      ...state.keyerTuning
    };
    const cells = perCell.checked ? gridDefinition().total : 1;
    let band = 0;
    for (let index = 0; index < cells; index += 1) {
      const rect = perCell.checked ? frameRect(index) : null;
      band += refineEdges(refined, state.original, { ...options, rect }).stats.band;
    }
    state.edgeRefineStats = { band };
    return refined;
  }

  /* ---------------------------------------------------------------- *
   * Colour regions
   *
   * They run AFTER Edge Refine, never before. `refineEdges()` unmixes the
   * fringe against `state.lastKeyColors`, and a region's colour is by
   * definition not in that list — so a hole punched before refine would get
   * its rim "decontaminated" with the wrong background colour. A region
   * carries its own softness and feather, so its rim is already soft.
   *
   * Region coordinates are absolute, normalised against the whole sheet, in
   * both preview modes. A region drawn on one cell in `Anim` therefore lands
   * on that cell and nowhere else, without needing a per-cell geometry pass.
   * ---------------------------------------------------------------- */

  const activeRegions = () => state.colorRegions.filter(regionIsActive);

  const selectedRegion = () => state.colorRegions.find((region) => region.id === state.selectedRegionId) || null;

  function applyRegions(base) {
    state.regionStats = null;
    const regions = activeRegions();
    // No regions means the result is exactly what came out of Edge Refine —
    // byte for byte, which is the invariant the whole feature rests on.
    if (regions.length === 0) return base === state.original ? cloneImageData(base) : base;
    const out = cloneImageData(base);
    const { removedPixels } = applyRegionKeys(out, regions, {
      sourceWidth: state.original.width,
      sourceHeight: state.original.height,
      cropX: 0,
      cropY: 0,
      cropWidth: state.original.width,
      cropHeight: state.original.height
    });
    state.regionStats = { removedPixels, count: regions.length };
    return out;
  }

  function recomposeResult() {
    if (!state.original) return;
    state.result = applyRegions(state.refined || state.original);
  }

  // Dragging a region slider reruns only the region pass over the cached
  // refined image, the same bargain scheduleEdgeRefine() strikes with keyed.
  function scheduleRegionUpdate() {
    clearTimeout(state.regionTimer);
    state.regionTimer = setTimeout(() => {
      if (state.isProcessing || !state.original) return;
      recomposeResult();
      renderPreview();
      resultStatus.textContent = resultStatusText();
    }, 60);
  }

  function resultStatusText() {
    const guard = state.subjectGuardStats;
    const guarded = guard?.restoredPixels
      ? `${state.resultStatusBase} · subject guard giữ lại ${guard.restoredPixels.toLocaleString()} px`
      : state.resultStatusBase;
    const stats = state.edgeRefineStats;
    const base = stats ? `${guarded} · edge refined (${stats.band.toLocaleString()} px)` : guarded;
    const region = state.regionStats;
    return region ? `${base} · ${region.count} vùng (${region.removedPixels.toLocaleString()} px)` : base;
  }

  async function runProcessing({ autoDetect = state.autoEnabled } = {}) {
    if (!state.original || state.isProcessing) return;
    if (!autoDetect && state.manualColors.length === 0) {
      showToast('Hãy Pick Color hoặc dùng Auto Remove trước.', 'error');
      return;
    }
    const resumePreview = state.isPreviewPlaying;
    stopPreviewAnimation();
    state.isProcessing = true;
    state.autoEnabled = autoDetect;
    deactivatePicker();
    progress.classList.add('active');
    progress.setAttribute('aria-hidden', 'false');
    resultStatus.textContent = 'Analyzing background…';
    [btnAuto, btnApply, btnReset, btnDownload].forEach((button) => { button.disabled = true; });
    await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

    try {
      const working = cloneImageData(state.original);
      const options = processOptions(autoDetect);
      const result = runKeyer(working, { connected: true, ...options });
      state.keyed = result.imageData;
      state.lastKeyColors = result.keyColors;
      state.keyerTuning = {
        similarity: options.similarity,
        feather: options.feather,
        subjectProtection: options.subjectProtection
      };
      state.guarded = applySubjectGuardPass(state.keyed);
      state.refined = applyEdgeRefine(state.guarded);
      recomposeResult();
      state.detectedColors = autoDetect
        ? result.keyColors.filter((color) => !state.manualColors.some((manual) => manual.hex === color.hex))
        : [];
      renderPreview();
      renderColors();
      state.resultStatusBase = `${result.removedPixels.toLocaleString()} pixels cleaned · edge-connected mask${preserveColors.checked ? ' · RGB preserved' : ''}`;
      resultStatus.textContent = resultStatusText();
      showToast(`Đã làm sạch ${result.removedPixels.toLocaleString()} pixels nền.`, 'success');
    } catch (error) {
      resultStatus.textContent = 'Processing failed';
      showToast(error.message || 'Không thể xử lý sprite sheet.', 'error');
    } finally {
      state.isProcessing = false;
      progress.classList.remove('active');
      progress.setAttribute('aria-hidden', 'true');
      setControlsEnabled(true);
      if (resumePreview && state.previewMode === 'anim' && perCell.checked) startPreviewAnimation();
    }
  }

  function resetResult() {
    if (!state.original) return;
    state.keyed = null;
    state.guarded = null;
    state.subjectGuardStats = null;
    state.refined = null;
    state.edgeRefineStats = null;
    state.result = cloneImageData(state.original);
    clearRegions();
    state.manualColors = [];
    state.seedPoints = [];
    state.detectedColors = [];
    state.autoEnabled = false;
    renderPreview();
    renderColors();
    resultStatus.textContent = 'Reset to original';
    deactivatePicker();
    setRegionMode('off');
    showToast('Đã reset kết quả về ảnh gốc.', 'info');
  }

  function updateTransform() {
    const transform = `translate(-50%, -50%) translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
    originalCanvas.style.transform = transform;
    resultCanvas.style.transform = transform;
    state.hoverPick = null;
    zoomLevel.textContent = `${Math.round(state.zoom * 100)}%`;
    syncRegionOverlays();
    if (state.isPicking && state.pickScope === 'lower') requestAnimationFrame(updateLowerHalfGuide);
  }

  function updateLowerHalfGuide() {
    if (!state.original || state.pickScope !== 'lower') return;
    const stageRect = originalStage.getBoundingClientRect();
    const canvasRect = originalCanvas.getBoundingClientRect();
    lowerHalfGuide.style.left = `${canvasRect.left - stageRect.left}px`;
    lowerHalfGuide.style.top = `${canvasRect.top - stageRect.top}px`;
    lowerHalfGuide.style.width = `${canvasRect.width}px`;
    lowerHalfGuide.style.height = `${canvasRect.height * state.lowerSplitRatio}px`;
    const percent = Math.round(state.lowerSplitRatio * 100);
    protectedRegionLabel.textContent = `Protected upper region · ${percent}%`;
  }

  function fitToView() {
    if (!state.original) return;
    const stageWidth = Math.min(originalStage.clientWidth, resultStage.clientWidth) - 32;
    const stageHeight = Math.min(originalStage.clientHeight, resultStage.clientHeight) - 32;
    state.zoom = Math.max(0.02, Math.min(1, stageWidth / originalCanvas.width, stageHeight / originalCanvas.height));
    state.panX = 0;
    state.panY = 0;
    updateTransform();
  }

  function zoomBy(factor, clientX = null, clientY = null, stage = originalStage) {
    if (!state.original) return;
    const oldZoom = state.zoom;
    const nextZoom = Math.max(0.02, Math.min(8, oldZoom * factor));
    if (clientX !== null && clientY !== null) {
      const rect = stage.getBoundingClientRect();
      const mx = clientX - rect.left - (rect.width / 2);
      const my = clientY - rect.top - (rect.height / 2);
      state.panX = mx - ((mx - state.panX) * (nextZoom / oldZoom));
      state.panY = my - ((my - state.panY) * (nextZoom / oldZoom));
    }
    state.zoom = nextZoom;
    updateTransform();
  }

  // Both canvases share size and transform, so a point means the same pixel on either.
  function surfaceCanvas(surface) {
    return surface === 'result' ? resultCanvas : originalCanvas;
  }

  // The lower-half pick needs the split line, which only Original draws.
  function resultPickable() {
    return Boolean(state.result) && state.pickScope !== 'lower';
  }

  function canvasCoordinates(event, canvas = originalCanvas) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * canvas.width);
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * canvas.height);
    if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return null;
    return { x, y };
  }

  function displayPointToSheet(point) {
    if (state.previewMode !== 'anim' || !perCell.checked) return point;
    const rect = frameRect(state.currentFrameIndex);
    return { x: rect.x0 + point.x, y: rect.y0 + point.y };
  }

  function updatePickerScopeLabel() {
    if (!pickerScope) return;
    if (state.regionPicking) {
      pickerScope.textContent = 'vùng';
      pickerScope.classList.remove('is-edge');
      return;
    }
    const label = state.pickSurface === 'result'
      ? (state.pickShift ? 'global' : 'edge')
      : (state.pickScope === 'lower' ? 'lower' : 'global');
    pickerScope.textContent = label;
    pickerScope.classList.toggle('is-edge', label === 'edge');
  }

  function updatePickerByPoint(point, surface = state.pickSurface) {
    // The region tool runs its own pick session, so the loupe must work while
    // the global picker is off.
    if ((!state.isPicking && !state.regionPicking) || !state.original || !point) return;
    state.pickerPoint = point;
    state.pickSurface = surface;
    const canvas = surfaceCanvas(surface);
    const sheetPoint = displayPointToSheet(point);
    const offset = ((sheetPoint.y * state.original.width) + sheetPoint.x) * 4;
    const data = state.original.data;
    const color = { r: data[offset], g: data[offset + 1], b: data[offset + 2] };
    const hex = hexColor(color);

    const rect = canvas.getBoundingClientRect();
    const clientX = rect.left + ((point.x + 0.5) / canvas.width) * rect.width;
    const clientY = rect.top + ((point.y + 0.5) / canvas.height) * rect.height;

    pickerContext.imageSmoothingEnabled = false;
    pickerContext.clearRect(0, 0, 72, 72);
    pickerContext.drawImage(canvas, point.x - 4, point.y - 4, 9, 9, 0, 0, 72, 72);
    pickerHex.textContent = hex;
    updatePickerScopeLabel();
    if (spritePickerCoord) spritePickerCoord.textContent = `X: ${sheetPoint.x}, Y: ${sheetPoint.y}`;
    pickerLoupe.style.display = 'block';
    pickerLoupe.style.left = `${clientX + 18}px`;
    pickerLoupe.style.top = `${clientY + 18}px`;
  }

  function updatePicker(event, surface) {
    if (!state.isPicking || !state.original) return;
    state.pickShift = event.shiftKey;
    const point = surface === 'result' && !resultPickable()
      ? null
      : canvasCoordinates(event, surfaceCanvas(surface));
    state.hoverPick = point ? { surface, point, clientX: event.clientX, clientY: event.clientY } : null;
    if (!point) {
      pickerLoupe.style.display = 'none';
      return;
    }
    updatePickerByPoint(point, surface);
  }

  function movePickerPoint(dx, dy) {
    if (!state.isPicking || !state.original) return false;
    const canvas = surfaceCanvas(state.pickSurface);
    const cur = state.pickerPoint || { x: Math.floor(canvas.width / 2), y: Math.floor(canvas.height / 2) };
    const next = {
      x: Math.max(0, Math.min(canvas.width - 1, cur.x + dx)),
      y: Math.max(0, Math.min(canvas.height - 1, cur.y + dy))
    };
    updatePickerByPoint(next);
    return true;
  }

  // Click and Enter both land here. A Result pick is an edge-only key unless
  // Shift is held; its colour still comes from the original, which is what the
  // keyer matches against (the Result pixel may already be decontaminated).
  function commitPick(point, { surface = 'original', shiftKey = false } = {}) {
    if (!state.isPicking || !state.original || !point) return false;
    const onResult = surface === 'result';
    if (onResult && !resultPickable()) return false;
    if (!onResult && state.pickScope === 'lower' && point.y < Math.floor(originalCanvas.height * state.lowerSplitRatio)) {
      showToast(`Chỉ nhận pixel nằm dưới đường chia ${Math.round(state.lowerSplitRatio * 100)}% của sprite.`, 'info');
      return false;
    }
    const sheetPoint = displayPointToSheet(point);
    const offset = ((sheetPoint.y * state.original.width) + sheetPoint.x) * 4;
    if (onResult && state.result.data[offset + 3] < 10) {
      showToast('Pixel này đã trong suốt trên Result', 'info');
      return false;
    }
    if (!onResult && state.original.data[offset + 3] < 10) {
      showToast('Pixel này đã trong suốt, hãy chọn màu nền nhìn thấy được.', 'info');
      return false;
    }
    const color = {
      r: state.original.data[offset],
      g: state.original.data[offset + 1],
      b: state.original.data[offset + 2]
    };
    color.hex = hexColor(color);
    const scope = onResult ? (shiftKey ? 'full' : 'edge') : state.pickScope;
    deactivatePicker();
    addManualColor(color, { point: sheetPoint, scope });
    return true;
  }

  function confirmPickerSelection(shiftKey = false) {
    if (!state.isPicking || !state.original) return false;
    const canvas = surfaceCanvas(state.pickSurface);
    const point = state.pickerPoint || { x: Math.floor(canvas.width / 2), y: Math.floor(canvas.height / 2) };
    return commitPick(point, { surface: state.pickSurface, shiftKey });
  }

  function activatePicker(scope = 'full') {
    if (!state.original) return;
    stopPreviewAnimation();
    if (scope === 'lower') {
      if (!perCell.checked) {
        perCell.checked = true;
        rows.disabled = false;
        cols.disabled = false;
        gridInputs.setAttribute('aria-disabled', 'false');
      }
      state.previewMode = 'anim';
      state.currentFrameIndex = Math.min(state.currentFrameIndex, gridDefinition().total - 1);
      renderPreview({ fit: true });
    }
    state.isPicking = true;
    state.pickScope = scope;
    btnPick.classList.toggle('active', scope === 'full');
    btnPickLower.classList.toggle('active', scope === 'lower');
    pickBanner.classList.add('active');
    originalStage.classList.add('is-picking');
    resultStage.classList.toggle('is-picking', resultPickable());
    resultPickBanner?.classList.toggle('active', resultPickable());
    originalStage.classList.toggle('pick-lower-half', scope === 'lower');
    originalStage.classList.toggle('adjust-split-line', scope === 'lower' && adjustSplit.checked);
    splitHandle.disabled = !(scope === 'lower' && adjustSplit.checked);
    pickBannerText.textContent = scope === 'lower'
      ? `Pick dưới đường ${Math.round(state.lowerSplitRatio * 100)}% · Click hoặc dùng phím Mũi tên (↑ ↓ ← →) · Enter chọn`
      : 'Pick màu nền · Click hoặc dùng phím Mũi tên (↑ ↓ ← →) · Enter chọn · Esc thoát';
    if (scope === 'lower') requestAnimationFrame(updateLowerHalfGuide);

    // Initialize sampling point at center of canvas for keyboard navigation
    state.pickerPoint = {
      x: Math.floor(originalCanvas.width / 2),
      y: scope === 'lower'
        ? Math.floor(originalCanvas.height * ((state.lowerSplitRatio + 1) / 2))
        : Math.floor(originalCanvas.height / 2)
    };
    state.pickShift = false;
    updatePickerByPoint(state.pickerPoint, 'original');
  }

  function deactivatePicker() {
    state.isPicking = false;
    state.pickerPoint = null;
    state.pickSurface = 'original';
    state.pickShift = false;
    state.hoverPick = null;
    resultStage?.classList.remove('is-picking');
    resultPickBanner?.classList.remove('active');
    btnPick?.classList.remove('active');
    btnPickLower?.classList.remove('active');
    pickBanner?.classList.remove('active');
    originalStage?.classList.remove('is-picking', 'pick-lower-half', 'adjust-split-line');
    splitHandle.disabled = true;
    if (pickerLoupe) pickerLoupe.style.display = 'none';
  }

  /* ---------------------------------------------------------------- *
   * Region tool: draw, pick, edit
   * ---------------------------------------------------------------- */

  let regionSequence = 0;

  const cellOffset = () => (state.previewMode === 'anim' && perCell.checked
    ? frameRect(state.currentFrameIndex)
    : { x0: 0, y0: 0 });

  // Overlay pixels are sheet pixels one for one, so the only thing that shifts
  // between Sheet and Anim is the origin of the cell on screen.
  function makeSurfaceMapping(canvas) {
    return {
      toSource(px, py) {
        if (!state.original || px < 0 || py < 0 || px > canvas.width || py > canvas.height) return null;
        const origin = cellOffset();
        return {
          x: (origin.x0 + px) / state.original.width,
          y: (origin.y0 + py) / state.original.height
        };
      },
      toCanvas(sx, sy) {
        const origin = cellOffset();
        return {
          x: (sx * (state.original?.width || 1)) - origin.x0,
          y: (sy * (state.original?.height || 1)) - origin.y0
        };
      },
      scaleToCanvas(rx, ry) {
        return { rx: rx * (state.original?.width || 1), ry: ry * (state.original?.height || 1) };
      }
    };
  }

  function buildOverlay(canvas, surface) {
    const mapping = makeSurfaceMapping(canvas);
    return createRegionOverlay({
      canvas,
      ...mapping,
      getRegions: () => state.colorRegions,
      getSelectedId: () => state.selectedRegionId,
      getAspect: () => (state.original ? state.original.width / state.original.height : 1),
      // A region drawn on another cell does not apply here, but hiding it would
      // leave the user hunting for a region they know they made.
      isRegionDimmed: (region) => region.frame !== null
        && state.previewMode === 'anim' && perCell.checked
        && region.frame !== state.currentFrameIndex,
      onCreate: (geometry) => createRegion(geometry),
      onChange: (id, patch) => patchRegion(id, patch),
      onSelect: (id) => selectRegion(id, { render: false }),
      onDelete: (id) => deleteRegion(id),
      onPickRequest: (id, point, event) => commitRegionPick(id, event, surface),
      onEscape: () => setRegionMode('off')
    });
  }

  let regionOverlaysCache = null;

  // Built on first use: renderPreview() sits above this point in the file and
  // must not trip over a half-initialised module.
  function regionOverlayEntries() {
    if (!regionOverlaysCache) {
      regionOverlaysCache = [
        { overlay: buildOverlay(regionOverlayOriginal, 'original'), canvas: regionOverlayOriginal, target: originalCanvas },
        { overlay: buildOverlay(regionOverlayResult, 'result'), canvas: regionOverlayResult, target: resultCanvas }
      ];
    }
    return regionOverlaysCache;
  }

  function syncRegionOverlays() {
    const transform = originalCanvas.style.transform;
    for (const entry of regionOverlayEntries()) {
      if (entry.canvas.width !== entry.target.width) entry.canvas.width = entry.target.width;
      if (entry.canvas.height !== entry.target.height) entry.canvas.height = entry.target.height;
      entry.canvas.style.width = `${entry.target.width}px`;
      entry.canvas.style.height = `${entry.target.height}px`;
      entry.canvas.style.transform = transform;
      entry.overlay.render();
    }
  }

  function setRegionMode(mode) {
    let next = ['draw', 'pick', 'edit'].includes(mode) ? mode : 'off';
    if (next !== 'off' && !state.original) return;
    // Step 2 has no meaning without step 1: there is no circle to put the colour
    // in, so a click would sample the sheet and silently do nothing.
    if (next === 'pick' && !selectedRegion()) next = state.colorRegions.length > 0 ? 'edit' : 'draw';
    state.regionMode = next;
    state.regionPicking = next === 'pick';
    if (next !== 'off') deactivatePicker();
    if (next === 'off') {
      state.regionPicking = false;
      if (pickerLoupe) pickerLoupe.style.display = 'none';
    }
    for (const entry of regionOverlayEntries()) entry.overlay.setMode(next === 'off' ? 'off' : next);
    btnRegionPick?.classList.toggle('active', next !== 'off');
    btnRegionPickColor?.classList.toggle('active', next === 'pick');
    btnRegionDrawNew?.classList.toggle('active', next === 'draw');
    updateRegionBanner();
    syncRegionOverlays();
  }

  function updateRegionBanner() {
    const active = state.regionMode !== 'off';
    [regionBanner, regionBannerResult].forEach((banner) => banner?.classList.toggle('active', active));
    if (!active) return;
    // The circle is the area the colour is ALLOWED to be removed from — not a
    // mask that protects what is outside it. Say so, because the opposite
    // reading is the natural one.
    const text = state.regionMode === 'draw'
      ? 'Bước 1 — Kéo từ tâm chi tiết cần xoá · Shift = tròn đều · Vùng tròn là phạm vi ĐƯỢC PHÉP xoá'
      : (state.regionMode === 'pick'
        ? 'Bước 2 — Click vào màu cần xoá BÊN TRONG vùng · chỉ vùng này bị ảnh hưởng · Esc thoát'
        : 'Kéo ruột để dời · kéo vành để đổi bán kính · Bấm "Pick màu trong vùng" để chọn màu · Delete xoá vùng · Esc thoát');
    if (regionBannerText) regionBannerText.textContent = text;
    if (regionBannerResultText) regionBannerResultText.textContent = text;
  }

  function clearRegions() {
    state.colorRegions = [];
    state.selectedRegionId = null;
    state.regionStats = null;
    renderRegionControls();
  }

  function createRegion(geometry) {
    const region = normalizeRegion({
      ...geometry,
      id: `region-${++regionSequence}`,
      colors: [],
      tolerance: Number(regionTolerance.value),
      feather: 0.20,
      softness: Number(regionSoftness.value),
      despill: Number(regionDespill.value),
      connected: regionConnected.checked,
      frame: state.previewMode === 'anim' && perCell.checked ? state.currentFrameIndex : null
    });
    if (!region) return;
    state.colorRegions.push(region);
    state.selectedRegionId = region.id;
    renderColors();
    renderRegionControls();
    // Step 1 is done; step 2 is a deliberate press. The circle is almost never
    // where the user wants it on the first drag, so they get to move and resize
    // it before a colour is committed to it.
    setRegionMode('edit');
    showToast('Đã có vòng tròn. Chỉnh vị trí/bán kính nếu cần, rồi bấm "Pick màu trong vùng".', 'info');
  }

  function selectRegion(id, { render = true } = {}) {
    state.selectedRegionId = id;
    if (state.regionMode === 'off' && id != null) setRegionMode('edit');
    renderRegionControls();
    if (render) {
      renderColors();
      syncRegionOverlays();
    }
  }

  function deleteRegion(id) {
    const before = state.colorRegions.length;
    state.colorRegions = state.colorRegions.filter((region) => region.id !== id);
    if (state.colorRegions.length === before) return;
    if (state.selectedRegionId === id) state.selectedRegionId = null;
    renderColors();
    renderRegionControls();
    recomposeResult();
    renderPreview();
    resultStatus.textContent = resultStatusText();
  }

  function patchRegion(id, patch) {
    const index = state.colorRegions.findIndex((region) => region.id === id);
    if (index < 0) return;
    const merged = normalizeRegion({ ...state.colorRegions[index], ...patch });
    if (!merged) return;
    state.colorRegions[index] = merged;
    renderRegionControls();
    scheduleRegionUpdate();
  }

  function renderRegionControls() {
    const region = selectedRegion();
    if (regionControls) regionControls.hidden = !region;
    if (!region) return;
    regionTolerance.value = String(region.tolerance);
    regionSoftness.value = String(region.softness);
    regionDespill.value = String(region.despill);
    regionConnected.checked = region.connected;
    [['numSpriteRegionTolerance', region.tolerance, 'spriteRegionToleranceValue'],
      ['numSpriteRegionSoftness', region.softness, 'spriteRegionSoftnessValue'],
      ['numSpriteRegionDespill', region.despill, 'spriteRegionDespillValue']].forEach(([numId, value, labelId]) => {
      const numInput = byId(numId);
      if (numInput && document.activeElement !== numInput) numInput.value = value.toFixed(2);
      const label = byId(labelId);
      if (label) label.textContent = value.toFixed(2);
    });
    if (regionLabel) {
      const radiusPx = Math.round(region.rx * (state.original?.width || 0));
      regionLabel.textContent = `${region.colors[0] ? hexColor(region.colors[0]) : 'chưa pick'} · r=${radiusPx}px`;
    }
  }

  /**
   * A pick inside a region. The colour always comes from `state.original`, the
   * same rule a Result pick follows: the Result pixel has already been scaled
   * by alpha and possibly decontaminated, so it is not the colour the matcher
   * is comparing against.
   */
  function commitRegionPick(id, event, surface) {
    if (!state.original) return;
    const region = state.colorRegions.find((item) => item.id === id) || null;
    if (!region) {
      showToast('Hãy click bên trong vùng tròn.', 'info');
      return;
    }
    const canvas = surfaceCanvas(surface);
    const hover = state.hoverPick;
    // Commit the pixel the loupe is showing, for the reason spelled out on the
    // Original/Result pick path: pointer coordinates are fractional and a
    // recomputed integer can land one pixel over.
    const point = hover && hover.surface === surface ? hover.point : canvasCoordinates(event, canvas);
    if (!point) return;
    const sheetPoint = displayPointToSheet(point);
    const offset = ((sheetPoint.y * state.original.width) + sheetPoint.x) * 4;
    if (surface === 'result' && state.result && state.result.data[offset + 3] < 10) {
      showToast('Pixel này đã trong suốt trên Result', 'info');
      return;
    }
    const color = {
      r: state.original.data[offset],
      g: state.original.data[offset + 1],
      b: state.original.data[offset + 2]
    };
    color.hex = hexColor(color);
    const duplicate = region.colors.some((item) => Math.abs(item.r - color.r) + Math.abs(item.g - color.g) + Math.abs(item.b - color.b) < 10);
    if (duplicate) {
      showToast('Màu này đã có trong vùng.', 'info');
      return;
    }
    region.colors.push(color);
    region.seed = { x: sheetPoint.x / state.original.width, y: sheetPoint.y / state.original.height };
    state.selectedRegionId = region.id;
    setRegionMode('edit');
    renderColors();
    renderRegionControls();
    recomposeResult();
    renderPreview();
    resultStatus.textContent = resultStatusText();
  }

  btnRegionPick?.addEventListener('click', () => {
    setRegionMode(state.regionMode === 'off' ? 'draw' : 'off');
  });

  btnRegionPickColor?.addEventListener('click', () => {
    if (!selectedRegion()) return;
    setRegionMode('pick');
  });

  btnRegionDrawNew?.addEventListener('click', () => setRegionMode('draw'));

  [[regionOverlayOriginal, 'original'], [regionOverlayResult, 'result']].forEach(([canvas, surface]) => {
    canvas.addEventListener('pointermove', (event) => {
      if (!state.regionPicking || !state.original) return;
      const point = canvasCoordinates(event, surfaceCanvas(surface));
      state.hoverPick = point ? { surface, point, clientX: event.clientX, clientY: event.clientY } : null;
      if (!point) {
        pickerLoupe.style.display = 'none';
        return;
      }
      updatePickerByPoint(point, surface);
    });
    canvas.addEventListener('pointerleave', () => {
      if (state.regionPicking) pickerLoupe.style.display = 'none';
    });
  });

  [[regionTolerance, 'tolerance'], [regionSoftness, 'softness'], [regionDespill, 'despill']].forEach(([input, key]) => {
    input.addEventListener('input', () => {
      const region = selectedRegion();
      if (!region) return;
      patchRegion(region.id, { [key]: Number(input.value) });
    });
  });
  [['numSpriteRegionTolerance', regionTolerance], ['numSpriteRegionSoftness', regionSoftness],
    ['numSpriteRegionDespill', regionDespill]].forEach(([numId, input]) => {
    const numInput = byId(numId);
    numInput?.addEventListener('input', () => {
      if (numInput.value === '' || numInput.value === '-') return;
      input.value = numInput.value;
      input.dispatchEvent(new Event('input'));
    });
  });
  regionConnected.addEventListener('change', () => {
    const region = selectedRegion();
    if (!region) return;
    patchRegion(region.id, { connected: regionConnected.checked, seed: region.seed });
  });

  function sanitizeName(value) {
    return (value || 'clean_sprite_sheet').replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_');
  }

  // Same as the Video → Sprite export (app.js ALPHA_BLEED_PASSES, WEBP_QUALITY_DEFAULT).
  const ALPHA_BLEED_PASSES = 3;
  const WEBP_QUALITY = 0.9;

  async function encodeResultBlob(format) {
    // PNG skips the canvas: its premultiplied backing store would quantise the
    // decontaminated colour of low-alpha edge pixels and erase the bleed.
    if (format === 'png' && canEncodePNG()) {
      const out = cloneImageData(state.result);
      applyAlphaBleed(out, ALPHA_BLEED_PASSES);
      return encodePNG(out);
    }
    const exportCanvas = document.createElement('canvas');
    drawImageData(exportCanvas, exportCanvas.getContext('2d'), state.result);
    return new Promise((resolve) => {
      exportCanvas.toBlob(resolve, `image/${format}`, format === 'webp' ? WEBP_QUALITY : undefined);
    });
  }

  async function downloadResult() {
    if (!state.result) return;
    const format = outputFormat.value === 'webp' ? 'webp' : 'png';
    let blob = null;
    try {
      blob = await encodeResultBlob(format);
    } catch {
      blob = null;
    }
    if (!blob) {
      showToast('Trình duyệt không thể tạo file output.', 'error');
      return;
    }
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${sanitizeName(downloadName.value)}.${format}`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(`Đã tải ${anchor.download}`, 'success');
  }

  dropZone.addEventListener('click', () => imageInput.click());
  imageInput.addEventListener('change', () => loadImageFile(imageInput.files?.[0]));
  dropZone.addEventListener('dragover', (event) => {
    event.preventDefault();
    event.stopPropagation();
    dropZone.classList.add('dragover');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', (event) => {
    event.preventDefault();
    event.stopPropagation();
    dropZone.classList.remove('dragover');
    loadImageFile(event.dataTransfer?.files?.[0]);
  });

  window.addEventListener('drop', (event) => {
    if (!isCleanerActive()) return;
    event.preventDefault();
    fullPageDropOverlay?.classList.remove('active');
    loadImageFile(event.dataTransfer?.files?.[0]);
  });
  window.addEventListener('dragenter', (event) => {
    if (!isCleanerActive() || !Array.from(event.dataTransfer?.types || []).includes('Files')) return;
    event.preventDefault();
    fullPageDropOverlay?.classList.add('active');
  });
  window.addEventListener('dragleave', (event) => {
    if (!isCleanerActive() || event.relatedTarget) return;
    fullPageDropOverlay?.classList.remove('active');
  });

  btnAuto.addEventListener('click', () => runProcessing({ autoDetect: true }));
  btnApply.addEventListener('click', () => runProcessing({ autoDetect: state.autoEnabled }));
  btnReset.addEventListener('click', resetResult);
  btnPick.addEventListener('click', () => state.isPicking && state.pickScope === 'full' ? deactivatePicker() : activatePicker('full'));
  btnPickLower.addEventListener('click', () => state.isPicking && state.pickScope === 'lower' ? deactivatePicker() : activatePicker('lower'));
  btnAddColor.addEventListener('click', () => addManualColor(colorFromHex(manualColor.value)));
  btnClearColors.addEventListener('click', resetResult);
  btnDownload.addEventListener('click', downloadResult);
  if (btnSendToTransform) {
    btnSendToTransform.addEventListener('click', () => {
      const targetCanvas = state.resultCanvas || state.original;
      if (!targetCanvas) return;
      const r = Math.max(1, parseInt(rows.value, 10) || 4);
      const c = Math.max(1, parseInt(cols.value, 10) || 6);
      window.openInSpriteTransform?.({
        canvas: targetCanvas,
        rows: r,
        cols: c,
        fileName: state.fileName ? state.fileName.replace(/\.[^/.]+$/, '') : 'clean_sprite',
      });
    });
  }
  perCell.addEventListener('change', () => {
    rows.disabled = !perCell.checked;
    cols.disabled = !perCell.checked;
    gridInputs.setAttribute('aria-disabled', String(!perCell.checked));
    stopPreviewAnimation();
    state.previewMode = perCell.checked ? 'anim' : 'sheet';
    state.currentFrameIndex = 0;
    if (state.original) renderPreview({ fit: true });
  });

  [rows, cols].forEach((input) => {
    input.addEventListener('change', () => {
      input.value = String(Math.max(1, Math.min(100, Math.round(Number(input.value) || 1))));
      stopPreviewAnimation();
      state.currentFrameIndex = 0;
      if (state.original) renderPreview({ fit: true });
    });
  });

  btnPreviewPlay.addEventListener('click', () => {
    if (state.isPreviewPlaying) stopPreviewAnimation();
    else startPreviewAnimation();
  });

  btnPreviewMode.addEventListener('click', () => {
    stopPreviewAnimation();
    if (!perCell.checked) {
      perCell.checked = true;
      rows.disabled = false;
      cols.disabled = false;
      gridInputs.setAttribute('aria-disabled', 'false');
    }
    state.previewMode = state.previewMode === 'anim' ? 'sheet' : 'anim';
    if (state.original) renderPreview({ fit: true });
  });

  previewFps.addEventListener('change', () => {
    previewFps.value = String(Math.max(1, Math.min(60, Math.round(Number(previewFps.value) || 12))));
    if (state.isPreviewPlaying) startPreviewAnimation();
  });

  function scheduleSplitReprocess() {
    clearTimeout(state.splitReprocessTimer);
    if (!state.original || !state.manualColors.some((color) => color.scope === 'lower')) return;
    if (state.isPicking) {
      resultStatus.textContent = `Split line ${Math.round(state.lowerSplitRatio * 100)}% · pick a color or press Apply`;
      return;
    }
    state.splitReprocessTimer = setTimeout(() => runProcessing({ autoDetect: false }), 120);
  }

  function setSplitRatio(value, { reprocess = false } = {}) {
    state.lowerSplitRatio = Math.max(0.1, Math.min(0.9, Number(value) || 0.5));
    const percent = Math.round(state.lowerSplitRatio * 100);
    splitValue.textContent = `${percent}%`;
    splitHandle.setAttribute('aria-valuenow', String(percent));
    if (state.isPicking && state.pickScope === 'lower') {
      pickBannerText.textContent = `Pick below the ${percent}% line · applies to every frame`;
      requestAnimationFrame(updateLowerHalfGuide);
    }
    if (reprocess) scheduleSplitReprocess();
  }

  function syncSplitControl() {
    if (!adjustSplit.checked) setSplitRatio(0.5);
    const adjustable = adjustSplit.checked && state.isPicking && state.pickScope === 'lower';
    splitHandle.disabled = !adjustable;
    originalStage.classList.toggle('adjust-split-line', adjustable);
  }

  adjustSplit.addEventListener('change', () => {
    syncSplitControl();
    if (!adjustSplit.checked) scheduleSplitReprocess();
    if (state.isPicking && state.pickScope === 'lower') requestAnimationFrame(updateLowerHalfGuide);
  });

  splitHandle.addEventListener('pointerdown', (event) => {
    if (splitHandle.disabled) return;
    event.preventDefault();
    event.stopPropagation();
    state.splitDragPointerId = event.pointerId;
    splitHandle.setPointerCapture(event.pointerId);
  });

  splitHandle.addEventListener('pointermove', (event) => {
    if (state.splitDragPointerId !== event.pointerId) return;
    event.preventDefault();
    const rect = originalCanvas.getBoundingClientRect();
    setSplitRatio((event.clientY - rect.top) / rect.height);
  });

  const finishSplitDrag = (event) => {
    if (state.splitDragPointerId !== event.pointerId) return;
    event.stopPropagation();
    state.splitDragPointerId = null;
    if (splitHandle.hasPointerCapture(event.pointerId)) splitHandle.releasePointerCapture(event.pointerId);
    scheduleSplitReprocess();
  };
  splitHandle.addEventListener('pointerup', finishSplitDrag);
  splitHandle.addEventListener('pointercancel', finishSplitDrag);
  splitHandle.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  splitHandle.addEventListener('keydown', (event) => {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Home') setSplitRatio(0.1, { reprocess: true });
    else if (event.key === 'End') setSplitRatio(0.9, { reprocess: true });
    else setSplitRatio(state.lowerSplitRatio + (event.key === 'ArrowDown' ? 0.01 : -0.01), { reprocess: true });
  });

  function syncPreserveColorControl() {
    spill.disabled = preserveColors.checked;
    spill.setAttribute('aria-disabled', String(preserveColors.checked));
    spill.title = preserveColors.checked
      ? 'Disabled because Preserve original subject RGB is active'
      : 'Removes key-color spill from visible edge pixels';
  }

  preserveColors.addEventListener('change', () => {
    syncPreserveColorControl();
    if (state.original && (state.autoEnabled || state.manualColors.length)) {
      runProcessing({ autoDetect: state.autoEnabled });
    }
  });
  syncPreserveColorControl();

  const numSpriteSimilarity = byId('numSpriteSimilarity');
  const numSpriteFeather = byId('numSpriteFeather');
  const numSpriteSpill = byId('numSpriteSpill');
  const numSpriteProtection = byId('numSpriteProtection');
  const numSpriteCleanup = byId('numSpriteCleanup');

  [
    [similarity, numSpriteSimilarity, byId('spriteSimilarityValue'), 2],
    [feather, numSpriteFeather, byId('spriteFeatherValue'), 2],
    [spill, numSpriteSpill, byId('spriteSpillValue'), 2],
    [protection, numSpriteProtection, byId('spriteProtectionValue'), 2],
    [cleanup, numSpriteCleanup, byId('spriteCleanupValue'), 0],
    [subjectGuardStrength, byId('numSpriteSubjectGuardStrength'), byId('spriteSubjectGuardStrengthValue'), 2],
    [subjectGuardLeak, byId('numSpriteSubjectGuardLeak'), byId('spriteSubjectGuardLeakValue'), 0],
    [edgeWidth, byId('numSpriteEdgeWidth'), byId('spriteEdgeWidthValue'), 0],
    [edgeSmooth, byId('numSpriteEdgeSmooth'), byId('spriteEdgeSmoothValue'), 2]
  ].forEach(([input, numInput, label, decimals]) => {
    function update(val, fromNum = false) {
      let num = parseFloat(val);
      const min = parseFloat(input.min) || 0;
      const max = parseFloat(input.max) || 1;
      if (isNaN(num)) num = min;
      num = Math.max(min, Math.min(max, num));
      const formatted = decimals === 0 ? String(Math.round(num)) : num.toFixed(decimals);
      input.value = String(num);
      if (numInput && (!fromNum || document.activeElement !== numInput)) {
        numInput.value = formatted;
      }
      if (label) {
        label.textContent = decimals === 0 ? `${formatted} px` : formatted;
      }
    }

    input.addEventListener('input', () => update(input.value));
    if (numInput) {
      numInput.addEventListener('input', () => {
        if (numInput.value === '' || numInput.value === '-') return;
        update(numInput.value, true);
      });
      numInput.addEventListener('change', () => update(numInput.value));
      numInput.addEventListener('blur', () => update(numInput.value));
    }
  });

  function syncEdgeRefineControls() {
    const off = !edgeRefine.checked;
    [edgeWidth, byId('numSpriteEdgeWidth'), edgeDecontaminate, edgePixelArt].forEach((control) => { control.disabled = off; });
    [edgeSmooth, byId('numSpriteEdgeSmooth')].forEach((control) => { control.disabled = off || edgePixelArt.checked; });
  }

  // Refine only: the guarded keyer result in state.guarded is reused as is.
  function scheduleEdgeRefine() {
    syncEdgeRefineControls();
    clearTimeout(state.edgeRefineTimer);
    state.edgeRefineTimer = setTimeout(() => {
      if (!state.guarded || state.isProcessing) return;
      state.refined = applyEdgeRefine(state.guarded);
      recomposeResult();
      renderPreview();
      resultStatus.textContent = resultStatusText();
    }, 80);
  }

  function syncSubjectGuardControls() {
    const off = !subjectGuard.checked;
    [subjectGuardStrength, byId('numSpriteSubjectGuardStrength'), subjectGuardLeak, byId('numSpriteSubjectGuardLeak')]
      .forEach((control) => { control.disabled = off; });
  }

  // Guard and what follows it; the flood fill result in state.keyed is reused.
  function scheduleSubjectGuard() {
    syncSubjectGuardControls();
    clearTimeout(state.subjectGuardTimer);
    state.subjectGuardTimer = setTimeout(() => {
      if (!state.keyed || state.isProcessing) return;
      state.guarded = applySubjectGuardPass(state.keyed);
      state.refined = applyEdgeRefine(state.guarded);
      recomposeResult();
      renderPreview();
      resultStatus.textContent = resultStatusText();
    }, 80);
  }

  subjectGuardSection.addEventListener('input', scheduleSubjectGuard);
  subjectGuardSection.addEventListener('change', scheduleSubjectGuard);
  syncSubjectGuardControls();

  edgeRefineSection.addEventListener('input', scheduleEdgeRefine);
  edgeRefineSection.addEventListener('change', scheduleEdgeRefine);
  syncEdgeRefineControls();

  btnZoomOut.addEventListener('click', () => zoomBy(0.8));
  btnZoomIn.addEventListener('click', () => zoomBy(1.25));
  btnZoomFit.addEventListener('click', fitToView);
  btnToggleBg.addEventListener('click', () => {
    state.checker = !state.checker;
    [originalStage, resultStage].forEach((stage) => stage.classList.toggle('checkerboard-bg', state.checker));
    btnToggleBg.classList.toggle('active', state.checker);
    btnToggleBg.querySelector('span').textContent = state.checker ? 'Checker' : 'Dark BG';
  });

  [originalStage, resultStage].forEach((stage) => {
    stage.addEventListener('wheel', (event) => {
      if (!state.original) return;
      event.preventDefault();
      zoomBy(event.deltaY < 0 ? 1.12 : 0.89, event.clientX, event.clientY, stage);
    }, { passive: false });
    stage.addEventListener('pointerdown', (event) => {
      if (!state.original || state.isPicking) return;
      // While the region tool owns the left button, only middle/right pans.
      if (state.regionMode !== 'off' && event.button === 0) return;
      state.drag = { id: event.pointerId, x: event.clientX, y: event.clientY, panX: state.panX, panY: state.panY };
      stage.setPointerCapture(event.pointerId);
      stage.classList.add('is-panning');
    });
    stage.addEventListener('pointermove', (event) => {
      if (!state.drag || state.drag.id !== event.pointerId) return;
      state.panX = state.drag.panX + event.clientX - state.drag.x;
      state.panY = state.drag.panY + event.clientY - state.drag.y;
      updateTransform();
    });
    const finishPan = (event) => {
      if (!state.drag || state.drag.id !== event.pointerId) return;
      state.drag = null;
      stage.classList.remove('is-panning');
    };
    stage.addEventListener('pointerup', finishPan);
    stage.addEventListener('pointercancel', finishPan);
  });

  [[originalStage, 'original'], [resultStage, 'result']].forEach(([stage, surface]) => {
    stage.addEventListener('pointermove', (event) => updatePicker(event, surface));
    stage.addEventListener('pointerleave', () => { pickerLoupe.style.display = 'none'; });
    stage.addEventListener('click', (event) => {
      if (!state.isPicking || !state.original) return;
      // Commit the pixel the loupe shows. Click coordinates are whole CSS pixels
      // while pointermove can be fractional, so at 100 % zoom and above the click
      // can land one pixel over — on a 1 px fringe, usually its transparent neighbour.
      const hover = state.hoverPick;
      const point = hover && hover.surface === surface
        && Math.abs(hover.clientX - event.clientX) < 1 && Math.abs(hover.clientY - event.clientY) < 1
        ? hover.point
        : canvasCoordinates(event, surfaceCanvas(surface));
      commitPick(point, { surface, shiftKey: event.shiftKey });
    });
  });

  window.addEventListener('keydown', (event) => {
    if (isCleanerActive() && state.isPicking) {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
      const step = event.shiftKey ? 10 : (event.altKey ? 5 : 1);
      if (event.key === 'Shift') {
        state.pickShift = true;
        updatePickerScopeLabel();
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        movePickerPoint(0, -step);
        return;
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        movePickerPoint(0, step);
        return;
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        movePickerPoint(-step, 0);
        return;
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        movePickerPoint(step, 0);
        return;
      } else if (event.key === 'Enter' || event.code === 'Space') {
        event.preventDefault();
        confirmPickerSelection(event.shiftKey);
        return;
      } else if (event.key === 'Escape') {
        event.preventDefault();
        deactivatePicker();
        return;
      }
    } else if (event.key === 'Escape' && state.isPicking) {
      deactivatePicker();
    }
  });
  window.addEventListener('keyup', (event) => {
    if (event.key !== 'Shift' || !state.isPicking) return;
    state.pickShift = false;
    updatePickerScopeLabel();
  });
  window.addEventListener('resize', () => {
    if (isCleanerActive() && state.original) fitToView();
  });

  window.addEventListener('movespritetocleaner', async (event) => {
    const { canvas, imageData, blob, fileName, rows: rowsCount, cols: colsCount, fps: fpsValue, downloadName: dlName } = event.detail || {};
    const source = canvas || imageData || blob;
    if (!source) return;
    setWorkspace('sprite-cleaner');
    await loadSpriteSource(source, {
      fileName: fileName || 'sprite_sheet.png',
      rowsCount,
      colsCount,
      fpsValue,
      downloadNameVal: dlName,
      showSuccessToast: false
    });
    showToast(`Đã chuyển sprite sheet sang Clean Sprite Sheet: ${fileName || 'sprite_sheet'}`, 'success');
  });
});
