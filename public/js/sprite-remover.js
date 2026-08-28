import { runKeyer } from './keyer/index.js';

document.addEventListener('DOMContentLoaded', () => {
  const byId = (id) => document.getElementById(id);
  const tabVideo = byId('tabVideoWorkspace');
  const tabCleaner = byId('tabSpriteCleaner');
  const tabReframe = byId('tabSpriteReframe');
  const videoWorkspace = byId('videoWorkspace');
  const cleanerWorkspace = byId('spriteCleanerWorkspace');
  const reframeWorkspace = byId('spriteReframeWorkspace');
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
  const perCell = byId('spritePerCell');
  const rows = byId('spriteRows');
  const cols = byId('spriteCols');
  const gridInputs = byId('spriteGridInputs');
  const downloadName = byId('spriteDownloadName');
  const outputFormat = byId('spriteOutputFormat');
  const btnDownload = byId('btnSpriteDownload');
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
  const lowerHalfGuide = byId('spriteLowerHalfGuide');
  const protectedRegionLabel = byId('spriteProtectedRegionLabel');
  const splitHandle = byId('spriteSplitHandle');
  const pickerLoupe = byId('spritePickerLoupe');
  const pickerCanvas = byId('spritePickerCanvas');
  const pickerHex = byId('spritePickerHex');
  const spritePickerCoord = byId('spritePickerCoord');

  const state = {
    original: null,
    result: null,
    fileName: '',
    manualColors: [],
    seedPoints: [],
    detectedColors: [],
    autoEnabled: false,
    isProcessing: false,
    isPicking: false,
    pickerPoint: null,
    pickScope: 'full',
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
    const activeName = cleanerActive ? 'sprite-cleaner' : reframeActive ? 'sprite-reframe' : 'video';
    document.body.dataset.activeWorkspace = activeName;
    videoWorkspace.hidden = activeName !== 'video';
    cleanerWorkspace.hidden = !cleanerActive;
    reframeWorkspace.hidden = !reframeActive;
    videoHeaderActions.hidden = activeName !== 'video';
    tabVideo.classList.toggle('active', activeName === 'video');
    tabCleaner.classList.toggle('active', cleanerActive);
    tabReframe.classList.toggle('active', reframeActive);
    tabVideo.setAttribute('aria-selected', String(activeName === 'video'));
    tabCleaner.setAttribute('aria-selected', String(cleanerActive));
    tabReframe.setAttribute('aria-selected', String(reframeActive));
    tabVideo.tabIndex = activeName === 'video' ? 0 : -1;
    tabCleaner.tabIndex = cleanerActive ? 0 : -1;
    tabReframe.tabIndex = reframeActive ? 0 : -1;
    if (activeName === 'video') {
      fullPageDropTitle.textContent = 'Thả file Video vào đây';
      fullPageDropHint.textContent = 'Hỗ trợ các định dạng .mp4, .webm, .mov, .avi, .mkv';
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
      const tabs = { video: tabVideo, 'sprite-cleaner': tabCleaner, 'sprite-reframe': tabReframe };
      tabs[activeName].focus();
    }
  }

  tabVideo.addEventListener('click', () => setWorkspace('video'));
  tabCleaner.addEventListener('click', () => setWorkspace('sprite-cleaner'));
  tabReframe.addEventListener('click', () => setWorkspace('sprite-reframe'));
  [tabVideo, tabCleaner, tabReframe].forEach((tab, index, tabs) => {
    tab.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      let nextIndex = index;
      if (event.key === 'Home') nextIndex = 0;
      else if (event.key === 'End') nextIndex = tabs.length - 1;
      else nextIndex = (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      const nextName = tabs[nextIndex] === tabCleaner ? 'sprite-cleaner' : tabs[nextIndex] === tabReframe ? 'sprite-reframe' : 'video';
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
    if (point && !state.seedPoints.some((item) => item.x === point.x && item.y === point.y)) {
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
      const scopeLabel = color.scope === 'lower' ? ' · lower half of each sprite cell only' : '';
      swatch.title = `${hexColor(color)}${manualIndex >= 0 ? ' · picked' : ' · auto detected'}${scopeLabel}`;
      const chip = document.createElement('span');
      chip.style.background = hexColor(color);
      const label = document.createElement('small');
      label.textContent = `${hexColor(color)}${color.scope === 'lower' ? ' ↓½' : ''}`;
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
    btnClearColors.disabled = !state.original || colors.length === 0;
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
    [btnAuto, btnApply, btnReset, btnPick, btnPickLower, adjustSplit, btnAddColor, btnDownload, btnZoomOut, btnZoomIn, btnZoomFit, btnPreviewMode, previewFps]
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

      state.result = cloneImageData(state.original);
      state.fileName = fileName || 'sprite_sheet.png';
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
      keyRegions: state.manualColors.map((color) => ({
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
      const result = runKeyer(working, { connected: true, ...processOptions(autoDetect) });
      state.result = result.imageData;
      state.detectedColors = autoDetect
        ? result.keyColors.filter((color) => !state.manualColors.some((manual) => manual.hex === color.hex))
        : [];
      renderPreview();
      renderColors();
      resultStatus.textContent = `${result.removedPixels.toLocaleString()} pixels cleaned · edge-connected mask${preserveColors.checked ? ' · RGB preserved' : ''}`;
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
    state.result = cloneImageData(state.original);
    state.manualColors = [];
    state.seedPoints = [];
    state.detectedColors = [];
    state.autoEnabled = false;
    renderPreview();
    renderColors();
    resultStatus.textContent = 'Reset to original';
    deactivatePicker();
    showToast('Đã reset kết quả về ảnh gốc.', 'info');
  }

  function updateTransform() {
    const transform = `translate(-50%, -50%) translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
    originalCanvas.style.transform = transform;
    resultCanvas.style.transform = transform;
    zoomLevel.textContent = `${Math.round(state.zoom * 100)}%`;
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

  function canvasCoordinates(event) {
    const rect = originalCanvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * originalCanvas.width);
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * originalCanvas.height);
    if (x < 0 || y < 0 || x >= originalCanvas.width || y >= originalCanvas.height) return null;
    return { x, y };
  }

  function displayPointToSheet(point) {
    if (state.previewMode !== 'anim' || !perCell.checked) return point;
    const rect = frameRect(state.currentFrameIndex);
    return { x: rect.x0 + point.x, y: rect.y0 + point.y };
  }

  function updatePickerByPoint(point) {
    if (!state.isPicking || !state.original || !point) return;
    state.pickerPoint = point;
    const sheetPoint = displayPointToSheet(point);
    const offset = ((sheetPoint.y * state.original.width) + sheetPoint.x) * 4;
    const data = state.original.data;
    const color = { r: data[offset], g: data[offset + 1], b: data[offset + 2] };
    const hex = hexColor(color);

    const rect = originalCanvas.getBoundingClientRect();
    const clientX = rect.left + ((point.x + 0.5) / originalCanvas.width) * rect.width;
    const clientY = rect.top + ((point.y + 0.5) / originalCanvas.height) * rect.height;

    pickerContext.imageSmoothingEnabled = false;
    pickerContext.clearRect(0, 0, 72, 72);
    pickerContext.drawImage(originalCanvas, point.x - 4, point.y - 4, 9, 9, 0, 0, 72, 72);
    pickerHex.textContent = hex;
    if (spritePickerCoord) spritePickerCoord.textContent = `X: ${sheetPoint.x}, Y: ${sheetPoint.y}`;
    pickerLoupe.style.display = 'block';
    pickerLoupe.style.left = `${clientX + 18}px`;
    pickerLoupe.style.top = `${clientY + 18}px`;
  }

  function updatePicker(event) {
    if (!state.isPicking || !state.original) return;
    const point = canvasCoordinates(event);
    if (!point) {
      pickerLoupe.style.display = 'none';
      return;
    }
    updatePickerByPoint(point);
  }

  function movePickerPoint(dx, dy) {
    if (!state.isPicking || !state.original) return false;
    const cur = state.pickerPoint || { x: Math.floor(originalCanvas.width / 2), y: Math.floor(originalCanvas.height / 2) };
    const next = {
      x: Math.max(0, Math.min(originalCanvas.width - 1, cur.x + dx)),
      y: Math.max(0, Math.min(originalCanvas.height - 1, cur.y + dy))
    };
    updatePickerByPoint(next);
    return true;
  }

  function confirmPickerSelection() {
    if (!state.isPicking || !state.original) return false;
    const point = state.pickerPoint || { x: Math.floor(originalCanvas.width / 2), y: Math.floor(originalCanvas.height / 2) };
    if (state.pickScope === 'lower' && point.y < Math.floor(originalCanvas.height * state.lowerSplitRatio)) {
      showToast(`Chỉ nhận pixel nằm dưới đường chia ${Math.round(state.lowerSplitRatio * 100)}% của sprite.`, 'info');
      return false;
    }
    const sheetPoint = displayPointToSheet(point);
    const offset = ((sheetPoint.y * state.original.width) + sheetPoint.x) * 4;
    if (state.original.data[offset + 3] < 10) {
      showToast('Pixel này đã trong suốt, hãy chọn màu nền nhìn thấy được.', 'info');
      return false;
    }
    const color = {
      r: state.original.data[offset],
      g: state.original.data[offset + 1],
      b: state.original.data[offset + 2]
    };
    color.hex = hexColor(color);
    deactivatePicker();
    addManualColor(color, { point: sheetPoint, scope: state.pickScope });
    return true;
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
    updatePickerByPoint(state.pickerPoint);
  }

  function deactivatePicker() {
    state.isPicking = false;
    state.pickerPoint = null;
    btnPick?.classList.remove('active');
    btnPickLower?.classList.remove('active');
    pickBanner?.classList.remove('active');
    originalStage?.classList.remove('is-picking', 'pick-lower-half', 'adjust-split-line');
    splitHandle.disabled = true;
    if (pickerLoupe) pickerLoupe.style.display = 'none';
  }

  function sanitizeName(value) {
    return (value || 'clean_sprite_sheet').replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_');
  }

  function downloadResult() {
    if (!state.result) return;
    const format = outputFormat.value === 'webp' ? 'webp' : 'png';
    const exportCanvas = document.createElement('canvas');
    const exportContext = exportCanvas.getContext('2d');
    drawImageData(exportCanvas, exportContext, state.result);
    exportCanvas.toBlob((blob) => {
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
    }, `image/${format}`, format === 'webp' ? 0.96 : undefined);
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
    [cleanup, numSpriteCleanup, byId('spriteCleanupValue'), 0]
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

  originalStage.addEventListener('pointermove', updatePicker);
  originalStage.addEventListener('pointerleave', () => { pickerLoupe.style.display = 'none'; });
  originalStage.addEventListener('click', (event) => {
    if (!state.isPicking || !state.original) return;
    const point = canvasCoordinates(event);
    if (!point) return;
    if (state.pickScope === 'lower' && point.y < Math.floor(originalCanvas.height * state.lowerSplitRatio)) {
      showToast(`Chỉ nhận pixel nằm dưới đường chia ${Math.round(state.lowerSplitRatio * 100)}% của sprite.`, 'info');
      return;
    }
    const sheetPoint = displayPointToSheet(point);
    const offset = ((sheetPoint.y * state.original.width) + sheetPoint.x) * 4;
    if (state.original.data[offset + 3] < 10) {
      showToast('Pixel này đã trong suốt, hãy chọn màu nền nhìn thấy được.', 'info');
      return;
    }
    const color = {
      r: state.original.data[offset],
      g: state.original.data[offset + 1],
      b: state.original.data[offset + 2]
    };
    color.hex = hexColor(color);
    deactivatePicker();
    addManualColor(color, { point: sheetPoint, scope: state.pickScope });
  });

  window.addEventListener('keydown', (event) => {
    if (isCleanerActive() && state.isPicking) {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
      const step = event.shiftKey ? 10 : (event.altKey ? 5 : 1);
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
        confirmPickerSelection();
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
