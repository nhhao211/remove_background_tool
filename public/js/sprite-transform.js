/**
 * Sprite Transform & Scaler Controller
 * Handles frame slicing, scaling, positioning, 3x3 anchor alignment,
 * circle crop, interactive canvas stage, filmstrip preview, and export.
 */

import {
  computeTransformCoords,
  calculateMatchFrame1Scale,
  calculateCircleCropParams,
  detectSubjectBounds,
} from './sprite-transform-math.js';
import { encodePNG, canEncodePNG } from './png-encoder.js';

document.addEventListener('DOMContentLoaded', () => {
  const byId = (id) => document.getElementById(id);

  // Core containers
  const dropZone = byId('transformEmptyDropZone');
  const mainEditor = byId('transformMainEditor');
  const footerBar = byId('transformFooterBar');
  const fileInput = byId('transformImageInput');
  const btnBrowse = byId('btnTransformBrowse');
  const btnReplaceSheet = byId('btnTransformReplaceSheet');
  const initRowsInput = byId('transformInitRows');
  const initColsInput = byId('transformInitCols');
  const dropTitle = byId('transformDropTitle');

  // Filmstrip (Left panel)
  const framesList = byId('transformFramesList');
  const frameCounter = byId('transformFrameCounter');

  // Top bar controls
  const btnModeFrame = byId('btnTransformModeFrame');
  const btnModeAnimate = byId('btnTransformModeAnimate');
  const btnModeSheet = byId('btnTransformModeSheet');
  const btnPlay = byId('btnTransformPlay');
  const iconPlay = byId('iconTransformPlay');
  const bgSelect = byId('transformBgSelect');
  const btnToggleGrid = byId('btnTransformToggleGrid');
  const editColsInput = byId('transformEditCols');
  const editRowsInput = byId('transformEditRows');

  // Stage & Canvases
  const stage = byId('transformStage');
  const stageInner = byId('transformStageInner');
  const cellBox = byId('transformCellBox');
  const contentCanvas = byId('transformCanvas');
  const overlayCanvas = byId('transformOverlayCanvas');
  const clippedBadge = byId('transformClippedBadge');

  // Timeline / Scrub
  const btnPrevFrame = byId('btnTransformPrevFrame');
  const btnNextFrame = byId('btnTransformNextFrame');
  const currentFrameLabel = byId('transformCurrentFrameLabel');
  const totalFramesLabel = byId('transformTotalFramesLabel');
  const fpsInput = byId('transformFps');

  // Sidebar controls
  const btnResetAll = byId('btnTransformResetAll');
  const scaleXSlider = byId('transformScaleX');
  const scaleXInput = byId('transformScaleXInput');
  const scaleYRow = byId('transformScaleYRow');
  const scaleYSlider = byId('transformScaleY');
  const scaleYInput = byId('transformScaleYInput');
  const btnLinkProportions = byId('btnTransformLinkProportions');
  const iconLink = byId('iconTransformLink');
  const lblLink = byId('lblTransformLink');
  const matchHeightCheckbox = byId('transformMatchHeight');

  // Position controls
  const offsetXInput = byId('transformOffsetX');
  const offsetYInput = byId('transformOffsetY');
  const btnDpadUp = byId('btnDpadUp');
  const btnDpadDown = byId('btnDpadDown');
  const btnDpadLeft = byId('btnDpadLeft');
  const btnDpadRight = byId('btnDpadRight');
  const btnDpadCenter = byId('btnDpadCenter');
  const anchorButtons = document.querySelectorAll('.anchor-btn');

  // Circle crop controls
  const circleCropCheckbox = byId('transformCircleCropEnable');
  const cropControls = byId('transformCropControls');
  const cropDiameterSlider = byId('transformCropDiameter');
  const cropDiameterInput = byId('transformCropDiameterInput');
  const cropFadeSlider = byId('transformCropFade');
  const cropFadeInput = byId('transformCropFadeInput');
  const cropPresets = document.querySelectorAll('.transform-crop-preset');

  // Footer controls
  const cellWidthInput = byId('transformCellWidth');
  const cellHeightInput = byId('transformCellHeight');
  const btnUseSourceCellSize = byId('btnTransformUseSourceCellSize');
  const smoothCheckbox = byId('transformSmooth');
  const statusNotice = byId('transformStatusNotice');
  const outputFormatSelect = byId('transformOutputFormat');
  const btnDownload = byId('btnTransformDownload');
  const lblDownload = byId('lblTransformDownload');

  if (!dropZone || !contentCanvas || !overlayCanvas) return;

  const contentCtx = contentCanvas.getContext('2d', { willReadFrequently: true });
  const overlayCtx = overlayCanvas.getContext('2d');

  // State
  const state = {
    sourceCanvas: null,
    fileName: 'sprite_sheet',
    rows: 6,
    cols: 4,
    frameCount: 24,
    frames: [], // { index, canvas, bounds }
    sourceCellWidth: 1280,
    sourceCellHeight: 1620,
    targetCellWidth: 1280,
    targetCellHeight: 1620,

    activeFrameIndex: 0,
    viewMode: 'animate', // 'frame' | 'animate' | 'sheet'
    isPlaying: true,
    fps: 12,
    animTimer: null,
    lastAnimTick: 0,

    showGrid: true,
    background: 'checker',
    smooth: true,
    zoom: 1,
    panX: 0,
    panY: 0,
    isDragging: false,
    dragMode: null, // 'pan' | 'subject'
    dragStart: { x: 0, y: 0, origOffsetX: 0, origOffsetY: 0, origPanX: 0, origPanY: 0 },

    scaleX: 1.0,
    scaleY: 1.0,
    proportionsLinked: true,
    matchFrame1Height: false,
    offsetX: 0,
    offsetY: 0,
    anchor: 'center',

    circleCropEnabled: false,
    circleCropDiameter: 1280,
    circleCropFade: 100,

    outputFormat: 'webp',
  };

  function isTransformActive() {
    return document.body.dataset.activeWorkspace === 'sprite-transform';
  }

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

  // --- Image & Frame Slicing ---

  async function loadSpriteSheetFile(file) {
    if (!file) return;
    try {
      dropTitle.textContent = 'Đang đọc sprite sheet...';
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext('2d').drawImage(bitmap, 0, 0);
      bitmap.close();

      const baseName = file.name.replace(/\.[^/.]+$/, '') || 'sprite_sheet';
      const r = Math.max(1, parseInt(initRowsInput?.value, 10) || 6);
      const c = Math.max(1, parseInt(initColsInput?.value, 10) || 4);

      setupWithCanvas(canvas, r, c, baseName);
      showToast(`Đã tải sprite sheet: ${file.name} (${c} cột × ${r} hàng)`, 'success');
    } catch (err) {
      dropTitle.textContent = 'Kéo thả Sprite Sheet vào đây hoặc Chọn tệp';
      showToast(err.message || 'Không thể đọc ảnh sprite sheet.', 'error');
    }
  }

  function setupWithCanvas(canvas, rows = 6, cols = 4, fileName = 'sprite_sheet') {
    state.sourceCanvas = canvas;
    state.fileName = fileName;
    state.rows = rows;
    state.cols = cols;
    state.frameCount = rows * cols;

    if (editColsInput) editColsInput.value = state.cols;
    if (editRowsInput) editRowsInput.value = state.rows;

    state.sourceCellWidth = Math.max(1, Math.floor(canvas.width / cols));
    state.sourceCellHeight = Math.max(1, Math.floor(canvas.height / rows));
    state.targetCellWidth = state.sourceCellWidth;
    state.targetCellHeight = state.sourceCellHeight;

    cellWidthInput.value = state.targetCellWidth;
    cellHeightInput.value = state.targetCellHeight;
    state.circleCropDiameter = Math.min(state.targetCellWidth, state.targetCellHeight);
    cropDiameterSlider.max = Math.max(state.targetCellWidth, state.targetCellHeight) * 2;
    cropDiameterSlider.value = state.circleCropDiameter;
    cropDiameterInput.value = state.circleCropDiameter;

    // Slice frames and compute bounds
    sliceFrames();

    // Switch UI from empty dropzone to main editor
    dropZone.style.display = 'none';
    mainEditor.style.display = 'grid';
    footerBar.style.display = 'flex';

    totalFramesLabel.textContent = state.frameCount;
    frameCounter.textContent = `1/${state.frameCount}`;

    renderFilmstrip();
    fitToViewport();
    updateView();
    startAnimationLoop();
  }

  function sliceFrames() {
    state.frames = [];
    const { sourceCanvas, rows, cols, sourceCellWidth, sourceCellHeight } = state;

    for (let i = 0; i < state.frameCount; i++) {
      const r = Math.floor(i / cols);
      const c = i % cols;
      const sx = c * sourceCellWidth;
      const sy = r * sourceCellHeight;

      const fCanvas = document.createElement('canvas');
      fCanvas.width = sourceCellWidth;
      fCanvas.height = sourceCellHeight;
      const fCtx = fCanvas.getContext('2d', { willReadFrequently: true });
      fCtx.drawImage(sourceCanvas, sx, sy, sourceCellWidth, sourceCellHeight, 0, 0, sourceCellWidth, sourceCellHeight);

      const imgData = fCtx.getImageData(0, 0, sourceCellWidth, sourceCellHeight);
      const bounds = detectSubjectBounds(imgData, { alphaThreshold: 20 });

      state.frames.push({
        index: i,
        canvas: fCanvas,
        bounds,
      });
    }
  }

  // Render left filmstrip thumbnails
  function renderFilmstrip() {
    framesList.innerHTML = '';
    state.frames.forEach((frame) => {
      const thumb = document.createElement('div');
      thumb.className = `transform-frame-thumb ${frame.index === state.activeFrameIndex ? 'active' : ''}`;
      thumb.dataset.index = frame.index;

      const thumbCanvas = document.createElement('canvas');
      thumbCanvas.width = state.sourceCellWidth;
      thumbCanvas.height = state.sourceCellHeight;
      thumbCanvas.getContext('2d').drawImage(frame.canvas, 0, 0);

      const numBadge = document.createElement('span');
      numBadge.className = 'transform-frame-num';
      numBadge.textContent = frame.index + 1;

      thumb.append(thumbCanvas, numBadge);
      thumb.addEventListener('click', () => {
        state.activeFrameIndex = frame.index;
        updateActiveFrameUI();
        renderView();
      });

      framesList.appendChild(thumb);
    });
  }

  function updateActiveFrameUI() {
    currentFrameLabel.textContent = state.activeFrameIndex + 1;
    frameCounter.textContent = `${state.activeFrameIndex + 1}/${state.frameCount}`;
    const thumbs = framesList.querySelectorAll('.transform-frame-thumb');
    thumbs.forEach((t) => {
      const idx = parseInt(t.dataset.index, 10);
      t.classList.toggle('active', idx === state.activeFrameIndex);
    });
  }

  // --- Viewport Pan & Zoom ---

  function applyStageTransform() {
    stageInner.style.transform = `translate(-50%, -50%) translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
  }

  function fitToViewport() {
    if (!state.sourceCanvas) return;
    const isSheet = state.viewMode === 'sheet';
    const viewW = isSheet ? state.cols * state.targetCellWidth : state.targetCellWidth;
    const viewH = isSheet ? state.rows * state.targetCellHeight : state.targetCellHeight;

    const availableW = stage.clientWidth - 48;
    const availableH = stage.clientHeight - 48;

    if (availableW <= 0 || availableH <= 0) return;

    state.zoom = Math.max(0.05, Math.min(1.0, availableW / viewW, availableH / viewH));
    state.panX = 0;
    state.panY = 0;
    applyStageTransform();
  }

  // --- Render Core ---

  function updateView() {
    const isSheet = state.viewMode === 'sheet';
    const displayW = isSheet ? state.cols * state.targetCellWidth : state.targetCellWidth;
    const displayH = isSheet ? state.rows * state.targetCellHeight : state.targetCellHeight;

    cellBox.style.width = `${displayW}px`;
    cellBox.style.height = `${displayH}px`;
    contentCanvas.width = displayW;
    contentCanvas.height = displayH;
    overlayCanvas.width = displayW;
    overlayCanvas.height = displayH;

    renderView();
  }

  function renderView() {
    if (!state.sourceCanvas || state.frames.length === 0) return;

    contentCtx.clearRect(0, 0, contentCanvas.width, contentCanvas.height);
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    contentCtx.imageSmoothingEnabled = state.smooth;
    contentCtx.imageSmoothingQuality = 'high';

    let anyClipped = false;

    if (state.viewMode === 'sheet') {
      // Sheet mode: Draw all cells in a grid
      for (let i = 0; i < state.frameCount; i++) {
        const r = Math.floor(i / state.cols);
        const c = i % state.cols;
        const cellX = c * state.targetCellWidth;
        const cellY = r * state.targetCellHeight;

        contentCtx.save();
        contentCtx.beginPath();
        contentCtx.rect(cellX, cellY, state.targetCellWidth, state.targetCellHeight);
        contentCtx.clip();

        const clipped = drawSingleCell(contentCtx, i, cellX, cellY);
        if (clipped) anyClipped = true;
        contentCtx.restore();
      }

      if (state.showGrid) {
        drawSheetGridOverlay(overlayCtx);
      }
    } else {
      // Single Frame or Animate mode: Draw active frame
      const clipped = drawSingleCell(contentCtx, state.activeFrameIndex, 0, 0);
      if (clipped) anyClipped = true;

      if (state.showGrid) {
        drawFrameOverlay(overlayCtx);
      }
    }

    // Update clipping warning badge
    clippedBadge.style.display = anyClipped ? 'flex' : 'none';
    statusNotice.textContent = anyClipped
      ? 'Scaled content extends beyond cell boundaries and will be clipped.'
      : '';
  }

  function drawSingleCell(ctx, frameIndex, cellX, cellY) {
    const frame = state.frames[frameIndex];
    if (!frame) return false;

    let effScaleX = state.scaleX;
    let effScaleY = state.scaleY;

    if (state.matchFrame1Height && state.frames[0]?.bounds) {
      const matchScale = calculateMatchFrame1Scale(
        state.frames[0].bounds,
        frame.bounds,
        state.scaleX,
        state.scaleY
      );
      effScaleX = matchScale.scaleX;
      effScaleY = matchScale.scaleY;
    }

    const transform = computeTransformCoords({
      bounds: frame.bounds,
      sourceCellWidth: state.sourceCellWidth,
      sourceCellHeight: state.sourceCellHeight,
      targetCellWidth: state.targetCellWidth,
      targetCellHeight: state.targetCellHeight,
      scaleX: effScaleX,
      scaleY: effScaleY,
      offsetX: state.offsetX,
      offsetY: state.offsetY,
      anchor: state.anchor,
    });

    // Draw transformed subject
    ctx.drawImage(
      frame.canvas,
      transform.sx, transform.sy, transform.sw, transform.sh,
      cellX + transform.dx, cellY + transform.dy, transform.dw, transform.dh
    );

    // Circle crop pass
    if (state.circleCropEnabled) {
      applyCircleCropToCell(ctx, cellX, cellY, state.targetCellWidth, state.targetCellHeight);
    }

    return transform.isClipped;
  }

  function applyCircleCropToCell(ctx, cellX, cellY, w, h) {
    const params = calculateCircleCropParams({
      cellWidth: w,
      cellHeight: h,
      diameter: state.circleCropDiameter,
      fadeStarts: state.circleCropFade,
    });

    const cx = cellX + params.cx;
    const cy = cellY + params.cy;

    ctx.save();
    ctx.globalCompositeOperation = 'destination-in';

    if (params.isFeathered) {
      const gradient = ctx.createRadialGradient(cx, cy, params.innerRadius, cx, cy, params.outerRadius);
      gradient.addColorStop(0, 'rgba(0, 0, 0, 1)');
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(cx, cy, params.outerRadius, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(cx, cy, params.outerRadius, 0, Math.PI * 2);
      ctx.fillStyle = '#000';
      ctx.fill();
    }

    ctx.restore();
  }

  // --- Overlays (Grid, Axes, Guidelines) ---

  function drawFrameOverlay(ctx) {
    const w = state.targetCellWidth;
    const h = state.targetCellHeight;

    // 1. Light green dashed grid
    ctx.save();
    ctx.strokeStyle = 'rgba(34, 197, 94, 0.25)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);

    const gridSize = 40;
    for (let x = gridSize; x < w; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = gridSize; y < h; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // 2. Yellow vertical centerline (X axis anchor)
    const centerX = w / 2 + state.offsetX;
    ctx.strokeStyle = '#eab308';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(centerX, 0);
    ctx.lineTo(centerX, h);
    ctx.stroke();

    // 3. Blue horizontal centerline (Y axis anchor)
    const centerY = h / 2 + state.offsetY;
    ctx.strokeStyle = '#38bdf8';
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    ctx.lineTo(w, centerY);
    ctx.stroke();

    // 4. Circle crop guide if enabled
    if (state.circleCropEnabled) {
      const params = calculateCircleCropParams({
        cellWidth: w,
        cellHeight: h,
        diameter: state.circleCropDiameter,
        fadeStarts: state.circleCropFade,
      });
      ctx.strokeStyle = 'rgba(234, 179, 8, 0.6)';
      ctx.setLineDash([5, 3]);
      ctx.beginPath();
      ctx.arc(params.cx, params.cy, params.outerRadius, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
  }

  function drawSheetGridOverlay(ctx) {
    const totalW = state.cols * state.targetCellWidth;
    const totalH = state.rows * state.targetCellHeight;

    ctx.save();
    ctx.strokeStyle = 'rgba(244, 63, 94, 0.4)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);

    for (let c = 1; c < state.cols; c++) {
      const x = c * state.targetCellWidth;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, totalH);
      ctx.stroke();
    }
    for (let r = 1; r < state.rows; r++) {
      const y = r * state.targetCellHeight;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(totalW, y);
      ctx.stroke();
    }

    ctx.restore();
  }

  // --- Animation Playback ---

  function startAnimationLoop() {
    if (state.animTimer) cancelAnimationFrame(state.animTimer);

    function loop(now) {
      if (state.isPlaying && state.viewMode === 'animate' && isTransformActive()) {
        const interval = 1000 / state.fps;
        if (!state.lastAnimTick || now - state.lastAnimTick >= interval) {
          state.activeFrameIndex = (state.activeFrameIndex + 1) % state.frameCount;
          state.lastAnimTick = now;
          updateActiveFrameUI();
          renderView();
        }
      }
      state.animTimer = requestAnimationFrame(loop);
    }
    state.animTimer = requestAnimationFrame(loop);
  }

  function togglePlay() {
    state.isPlaying = !state.isPlaying;
    iconPlay.setAttribute('data-lucide', state.isPlaying ? 'pause' : 'play');
    btnPlay.title = state.isPlaying ? 'Pause Animation' : 'Play Animation';
    window.lucide?.createIcons({ root: btnPlay });
  }

  // --- Interactive Dragging & Pan/Zoom ---

  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    const oldZoom = state.zoom;
    const nextZoom = Math.max(0.05, Math.min(8, oldZoom * factor));

    const rect = stage.getBoundingClientRect();
    const mx = e.clientX - rect.left - rect.width / 2;
    const my = e.clientY - rect.top - rect.height / 2;

    state.panX = mx - (mx - state.panX) * (nextZoom / oldZoom);
    state.panY = my - (my - state.panY) * (nextZoom / oldZoom);
    state.zoom = nextZoom;

    applyStageTransform();
  }, { passive: false });

  stage.addEventListener('pointerdown', (e) => {
    if (!state.sourceCanvas) return;
    stage.setPointerCapture(e.pointerId);
    state.isDragging = true;
    stage.classList.add('is-dragging');

    // Middle click or Space held = pan stage; Left click = drag subject to position
    const isPan = e.button === 1 || e.button === 2 || e.altKey;
    state.dragMode = isPan ? 'pan' : 'subject';

    state.dragStart = {
      x: e.clientX,
      y: e.clientY,
      origOffsetX: state.offsetX,
      origOffsetY: state.offsetY,
      origPanX: state.panX,
      origPanY: state.panY,
    };
  });

  stage.addEventListener('pointermove', (e) => {
    if (!state.isDragging) return;
    const dx = e.clientX - state.dragStart.x;
    const dy = e.clientY - state.dragStart.y;

    if (state.dragMode === 'pan') {
      state.panX = state.dragStart.origPanX + dx;
      state.panY = state.dragStart.origPanY + dy;
      applyStageTransform();
    } else if (state.dragMode === 'subject') {
      // Map screen delta to cell pixels (divide by zoom)
      const cellDx = Math.round(dx / state.zoom);
      const cellDy = Math.round(dy / state.zoom);

      state.offsetX = state.dragStart.origOffsetX + cellDx;
      state.offsetY = state.dragStart.origOffsetY + cellDy;

      offsetXInput.value = state.offsetX;
      offsetYInput.value = state.offsetY;

      renderView();
    }
  });

  const stopDrag = (e) => {
    if (!state.isDragging) return;
    state.isDragging = false;
    state.dragMode = null;
    stage.classList.remove('is-dragging');
  };
  stage.addEventListener('pointerup', stopDrag);
  stage.addEventListener('pointercancel', stopDrag);
  stage.addEventListener('contextmenu', (e) => e.preventDefault());

  // --- UI Event Handlers ---

  // Mode buttons
  [btnModeFrame, btnModeAnimate, btnModeSheet].forEach((btn) => {
    btn.addEventListener('click', () => {
      [btnModeFrame, btnModeAnimate, btnModeSheet].forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.viewMode = btn.dataset.mode;
      updateView();
      fitToViewport();
    });
  });

  btnPlay.addEventListener('click', togglePlay);

  // Background selector
  bgSelect.addEventListener('change', () => {
    state.background = bgSelect.value;
    stage.classList.remove('checkerboard-bg');
    stage.style.backgroundColor = '';

    if (state.background === 'checker') {
      stage.classList.add('checkerboard-bg');
    } else if (state.background === 'black') {
      stage.style.backgroundColor = '#000000';
    } else if (state.background === 'white') {
      stage.style.backgroundColor = '#ffffff';
    } else if (state.background === 'green') {
      stage.style.backgroundColor = '#00ff00';
    }
  });

  // Grid toggle
  btnToggleGrid.addEventListener('click', () => {
    state.showGrid = !state.showGrid;
    btnToggleGrid.classList.toggle('active', state.showGrid);
    renderView();
  });

  // Dynamic grid re-slicing (4 Cols x 6 Rows)
  function updateGridDimensions(newCols, newRows) {
    if (!state.sourceCanvas) return;
    state.cols = Math.max(1, Math.min(100, newCols));
    state.rows = Math.max(1, Math.min(100, newRows));
    state.frameCount = state.rows * state.cols;
    state.sourceCellWidth = Math.max(1, Math.floor(state.sourceCanvas.width / state.cols));
    state.sourceCellHeight = Math.max(1, Math.floor(state.sourceCanvas.height / state.rows));
    state.targetCellWidth = state.sourceCellWidth;
    state.targetCellHeight = state.sourceCellHeight;
    cellWidthInput.value = state.targetCellWidth;
    cellHeightInput.value = state.targetCellHeight;
    if (editColsInput) editColsInput.value = state.cols;
    if (editRowsInput) editRowsInput.value = state.rows;
    state.activeFrameIndex = 0;
    totalFramesLabel.textContent = state.frameCount;
    frameCounter.textContent = `1/${state.frameCount}`;
    sliceFrames();
    renderFilmstrip();
    updateView();
    fitToViewport();
    showToast(`Đã chia lại lưới: ${state.cols} cột × ${state.rows} hàng (${state.frameCount} frames)`, 'info');
  }

  editColsInput?.addEventListener('change', () => {
    const val = parseInt(editColsInput.value, 10) || 4;
    updateGridDimensions(val, state.rows);
  });
  editRowsInput?.addEventListener('change', () => {
    const val = parseInt(editRowsInput.value, 10) || 6;
    updateGridDimensions(state.cols, val);
  });

  // Scale Presets
  document.querySelectorAll('.transform-preset-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const scaleVal = parseFloat(btn.dataset.scale);
      setScale(scaleVal, scaleVal);
      document.querySelectorAll('.transform-preset-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  function setScale(sX, sY) {
    state.scaleX = sX;
    state.scaleY = sY;
    const pctX = Math.round(sX * 100);
    const pctY = Math.round(sY * 100);

    scaleXSlider.value = pctX;
    scaleXInput.value = pctX;
    scaleYSlider.value = pctY;
    scaleYInput.value = pctY;

    renderView();
  }

  // Scale X
  scaleXSlider.addEventListener('input', () => {
    const val = parseInt(scaleXSlider.value, 10);
    scaleXInput.value = val;
    state.scaleX = val / 100;
    if (state.proportionsLinked) {
      state.scaleY = state.scaleX;
      scaleYSlider.value = val;
      scaleYInput.value = val;
    }
    renderView();
  });
  scaleXInput.addEventListener('change', () => {
    const val = Math.max(10, Math.min(400, parseInt(scaleXInput.value, 10) || 100));
    scaleXSlider.value = val;
    scaleXInput.value = val;
    state.scaleX = val / 100;
    if (state.proportionsLinked) {
      state.scaleY = state.scaleX;
      scaleYSlider.value = val;
      scaleYInput.value = val;
    }
    renderView();
  });

  // Scale Y
  scaleYSlider.addEventListener('input', () => {
    const val = parseInt(scaleYSlider.value, 10);
    scaleYInput.value = val;
    state.scaleY = val / 100;
    renderView();
  });
  scaleYInput.addEventListener('change', () => {
    const val = Math.max(10, Math.min(400, parseInt(scaleYInput.value, 10) || 100));
    scaleYSlider.value = val;
    scaleYInput.value = val;
    state.scaleY = val / 100;
    renderView();
  });

  // Link Proportions
  btnLinkProportions.addEventListener('click', () => {
    state.proportionsLinked = !state.proportionsLinked;
    btnLinkProportions.classList.toggle('active', state.proportionsLinked);
    scaleYRow.style.display = state.proportionsLinked ? 'none' : 'flex';
    lblLink.textContent = state.proportionsLinked ? 'Proportions linked' : 'Proportions unlinked';
    iconLink.setAttribute('data-lucide', state.proportionsLinked ? 'link' : 'unlink');
    window.lucide?.createIcons({ root: btnLinkProportions });

    if (state.proportionsLinked) {
      state.scaleY = state.scaleX;
      scaleYSlider.value = scaleXSlider.value;
      scaleYInput.value = scaleXInput.value;
      renderView();
    }
  });

  // Match Frame 1 Height
  matchHeightCheckbox.addEventListener('change', () => {
    state.matchFrame1Height = matchHeightCheckbox.checked;
    renderView();
  });

  // Position Offsets
  offsetXInput.addEventListener('change', () => {
    state.offsetX = parseInt(offsetXInput.value, 10) || 0;
    renderView();
  });
  offsetYInput.addEventListener('change', () => {
    state.offsetY = parseInt(offsetYInput.value, 10) || 0;
    renderView();
  });

  // D-pad
  btnDpadUp.addEventListener('click', () => {
    state.offsetY -= 5;
    offsetYInput.value = state.offsetY;
    renderView();
  });
  btnDpadDown.addEventListener('click', () => {
    state.offsetY += 5;
    offsetYInput.value = state.offsetY;
    renderView();
  });
  btnDpadLeft.addEventListener('click', () => {
    state.offsetX -= 5;
    offsetXInput.value = state.offsetX;
    renderView();
  });
  btnDpadRight.addEventListener('click', () => {
    state.offsetX += 5;
    offsetXInput.value = state.offsetX;
    renderView();
  });
  btnDpadCenter.addEventListener('click', () => {
    state.offsetX = 0;
    state.offsetY = 0;
    offsetXInput.value = 0;
    offsetYInput.value = 0;
    renderView();
  });

  // 3x3 Anchors
  anchorButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      anchorButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.anchor = btn.dataset.anchor;
      renderView();
    });
  });

  // Circle Crop
  circleCropCheckbox.addEventListener('change', () => {
    state.circleCropEnabled = circleCropCheckbox.checked;
    cropControls.style.display = state.circleCropEnabled ? 'block' : 'none';
    renderView();
  });

  cropDiameterSlider.addEventListener('input', () => {
    const val = parseInt(cropDiameterSlider.value, 10);
    cropDiameterInput.value = val;
    state.circleCropDiameter = val;
    renderView();
  });
  cropDiameterInput.addEventListener('change', () => {
    const val = Math.max(10, parseInt(cropDiameterInput.value, 10) || 100);
    cropDiameterSlider.value = val;
    state.circleCropDiameter = val;
    renderView();
  });

  cropPresets.forEach((btn) => {
    btn.addEventListener('click', () => {
      cropPresets.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const pct = parseFloat(btn.dataset.percent);
      const diam = Math.round(Math.min(state.targetCellWidth, state.targetCellHeight) * pct);
      cropDiameterSlider.value = diam;
      cropDiameterInput.value = diam;
      state.circleCropDiameter = diam;
      renderView();
    });
  });

  cropFadeSlider.addEventListener('input', () => {
    const val = parseInt(cropFadeSlider.value, 10);
    cropFadeInput.value = val;
    state.circleCropFade = val;
    renderView();
  });
  cropFadeInput.addEventListener('change', () => {
    const val = Math.max(0, Math.min(100, parseInt(cropFadeInput.value, 10) || 100));
    cropFadeSlider.value = val;
    cropFadeInput.value = val;
    state.circleCropFade = val;
    renderView();
  });

  // Reset all
  btnResetAll.addEventListener('click', () => {
    setScale(1.0, 1.0);
    state.offsetX = 0;
    state.offsetY = 0;
    offsetXInput.value = 0;
    offsetYInput.value = 0;

    state.anchor = 'center';
    anchorButtons.forEach((b) => b.classList.toggle('active', b.dataset.anchor === 'center'));

    state.matchFrame1Height = false;
    matchHeightCheckbox.checked = false;

    state.circleCropEnabled = false;
    circleCropCheckbox.checked = false;
    cropControls.style.display = 'none';

    renderView();
    showToast('Đã khôi phục cài đặt gốc.', 'info');
  });

  // Timeline buttons
  btnPrevFrame.addEventListener('click', () => {
    state.activeFrameIndex = (state.activeFrameIndex - 1 + state.frameCount) % state.frameCount;
    updateActiveFrameUI();
    renderView();
  });
  btnNextFrame.addEventListener('click', () => {
    state.activeFrameIndex = (state.activeFrameIndex + 1) % state.frameCount;
    updateActiveFrameUI();
    renderView();
  });

  fpsInput.addEventListener('change', () => {
    state.fps = Math.max(1, Math.min(60, parseInt(fpsInput.value, 10) || 12));
    fpsInput.value = state.fps;
  });

  // Output frame dimensions
  cellWidthInput.addEventListener('change', () => {
    state.targetCellWidth = Math.max(16, parseInt(cellWidthInput.value, 10) || state.sourceCellWidth);
    cellWidthInput.value = state.targetCellWidth;
    updateView();
    fitToViewport();
  });
  cellHeightInput.addEventListener('change', () => {
    state.targetCellHeight = Math.max(16, parseInt(cellHeightInput.value, 10) || state.sourceCellHeight);
    cellHeightInput.value = state.targetCellHeight;
    updateView();
    fitToViewport();
  });

  btnUseSourceCellSize.addEventListener('click', () => {
    state.targetCellWidth = state.sourceCellWidth;
    state.targetCellHeight = state.sourceCellHeight;
    cellWidthInput.value = state.targetCellWidth;
    cellHeightInput.value = state.targetCellHeight;
    updateView();
    fitToViewport();
    showToast(`Đã khôi phục kích thước cell gốc: ${state.targetCellWidth}×${state.targetCellHeight} px`, 'info');
  });

  smoothCheckbox.addEventListener('change', () => {
    state.smooth = smoothCheckbox.checked;
    renderView();
  });

  outputFormatSelect.addEventListener('change', () => {
    state.outputFormat = outputFormatSelect.value;
    lblDownload.textContent = `Download ${state.outputFormat.toUpperCase()}`;
  });

  // --- Export / Download ---

  function exportFullTransformedSheet() {
    if (!state.sourceCanvas || state.frames.length === 0) {
      showToast('Chưa có sprite sheet để xuất.', 'error');
      return;
    }

    const outW = state.cols * state.targetCellWidth;
    const outH = state.rows * state.targetCellHeight;

    const outCanvas = document.createElement('canvas');
    outCanvas.width = outW;
    outCanvas.height = outH;
    const outCtx = outCanvas.getContext('2d', { willReadFrequently: true });
    outCtx.imageSmoothingEnabled = state.smooth;
    outCtx.imageSmoothingQuality = 'high';

    for (let i = 0; i < state.frameCount; i++) {
      const r = Math.floor(i / state.cols);
      const c = i % state.cols;
      const cellX = c * state.targetCellWidth;
      const cellY = r * state.targetCellHeight;

      outCtx.save();
      outCtx.beginPath();
      outCtx.rect(cellX, cellY, state.targetCellWidth, state.targetCellHeight);
      outCtx.clip();

      drawSingleCell(outCtx, i, cellX, cellY);
      outCtx.restore();
    }

    const outFileName = `${state.fileName}_transformed_${state.rows}x${state.cols}`;

    if (state.outputFormat === 'png') {
      try {
        const imgData = outCtx.getImageData(0, 0, outW, outH);
        encodePNG(imgData).then((pngBlob) => {
          triggerDownloadBlob(pngBlob, `${outFileName}.png`);
        }).catch((err) => {
          outCanvas.toBlob((b) => triggerDownloadBlob(b, `${outFileName}.png`), 'image/png');
        });
      } catch (err) {
        outCanvas.toBlob((b) => triggerDownloadBlob(b, `${outFileName}.png`), 'image/png');
      }
    } else {
      outCanvas.toBlob((blob) => {
        triggerDownloadBlob(blob, `${outFileName}.webp`);
      }, 'image/webp', 0.98);
    }
  }

  function triggerDownloadBlob(blob, filename) {
    if (!blob) {
      showToast('Không thể tạo tệp xuất.', 'error');
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    showToast(`Đã tải xuống: ${filename}`, 'success');
  }

  btnDownload.addEventListener('click', exportFullTransformedSheet);

  // File loading
  btnBrowse.addEventListener('click', () => fileInput.click());
  btnReplaceSheet.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => loadSpriteSheetFile(fileInput.files?.[0]));

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    loadSpriteSheetFile(e.dataTransfer?.files?.[0]);
  });

  window.addEventListener('drop', (e) => {
    if (!isTransformActive()) return;
    e.preventDefault();
    loadSpriteSheetFile(e.dataTransfer?.files?.[0]);
  });

  window.addEventListener('resize', () => {
    if (isTransformActive() && state.sourceCanvas) {
      fitToViewport();
    }
  });

  window.addEventListener('workspacechange', (e) => {
    if (e.detail?.workspace === 'sprite-transform' && state.sourceCanvas) {
      requestAnimationFrame(() => {
        fitToViewport();
        updateView();
      });
    }
  });

  // Global Bridge API: Allows other tabs to send sprite sheets directly to Transform tab
  window.openInSpriteTransform = function ({ canvas, rows = 4, cols = 6, fileName = 'sprite_sheet' }) {
    if (!canvas) return;
    window.switchStudioWorkspace?.('sprite-transform');
    setupWithCanvas(canvas, rows, cols, fileName);
    showToast(`Đã mở Sprite Sheet trong Transform: ${rows}×${cols} lưới`, 'success');
  };
});
