import { processSpriteSheet } from './background-removal.js';

document.addEventListener('DOMContentLoaded', () => {
  const byId = (id) => document.getElementById(id);
  const tabVideo = byId('tabVideoWorkspace');
  const tabCleaner = byId('tabSpriteCleaner');
  const videoWorkspace = byId('videoWorkspace');
  const cleanerWorkspace = byId('spriteCleanerWorkspace');
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
  const manualColor = byId('spriteManualColor');
  const btnAddColor = byId('btnSpriteAddColor');
  const btnClearColors = byId('btnSpriteClearColors');
  const colorSwatches = byId('spriteColorSwatches');
  const colorCount = byId('spriteColorCount');
  const similarity = byId('spriteSimilarity');
  const feather = byId('spriteFeather');
  const spill = byId('spriteSpill');
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
  const zoomLevel = byId('cleanerZoomLevel');
  const btnToggleBg = byId('btnCleanerToggleBg');
  const pickBanner = byId('spritePickBanner');
  const pickerLoupe = byId('spritePickerLoupe');
  const pickerCanvas = byId('spritePickerCanvas');
  const pickerHex = byId('spritePickerHex');

  const state = {
    original: null,
    result: null,
    fileName: '',
    manualColors: [],
    detectedColors: [],
    autoEnabled: false,
    isProcessing: false,
    isPicking: false,
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
    document.body.dataset.activeWorkspace = cleanerActive ? 'sprite-cleaner' : 'video';
    videoWorkspace.hidden = cleanerActive;
    cleanerWorkspace.hidden = !cleanerActive;
    videoHeaderActions.hidden = cleanerActive;
    tabVideo.classList.toggle('active', !cleanerActive);
    tabCleaner.classList.toggle('active', cleanerActive);
    tabVideo.setAttribute('aria-selected', String(!cleanerActive));
    tabCleaner.setAttribute('aria-selected', String(cleanerActive));
    tabVideo.tabIndex = cleanerActive ? -1 : 0;
    tabCleaner.tabIndex = cleanerActive ? 0 : -1;
    fullPageDropTitle.textContent = cleanerActive ? 'Thả Sprite Sheet vào đây' : 'Thả file Video vào đây';
    fullPageDropHint.textContent = cleanerActive
      ? 'Hỗ trợ ảnh tĩnh .png, .webp, .jpg, .jpeg'
      : 'Hỗ trợ các định dạng .mp4, .webm, .mov, .avi, .mkv';
    if (!cleanerActive) deactivatePicker();
    if (cleanerActive && state.original) requestAnimationFrame(fitToView);
    if (focus) (cleanerActive ? tabCleaner : tabVideo).focus();
  }

  tabVideo.addEventListener('click', () => setWorkspace('video'));
  tabCleaner.addEventListener('click', () => setWorkspace('sprite-cleaner'));
  [tabVideo, tabCleaner].forEach((tab) => {
    tab.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const toCleaner = event.key === 'ArrowRight' || event.key === 'End';
      setWorkspace(toCleaner ? 'sprite-cleaner' : 'video', { focus: true });
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

  function addManualColor(color, { process = true } = {}) {
    if (!color) return false;
    if (state.manualColors.some((item) => Math.abs(item.r - color.r) + Math.abs(item.g - color.g) + Math.abs(item.b - color.b) < 10)) {
      showToast('Màu này đã có trong danh sách.', 'info');
      return false;
    }
    state.manualColors.push(color);
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
      swatch.title = `${hexColor(color)}${manualIndex >= 0 ? ' · picked' : ' · auto detected'}`;
      const chip = document.createElement('span');
      chip.style.background = hexColor(color);
      const label = document.createElement('small');
      label.textContent = hexColor(color);
      swatch.append(chip, label);
      if (manualIndex >= 0) {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = '×';
        remove.setAttribute('aria-label', `Remove ${hexColor(color)}`);
        remove.addEventListener('click', () => {
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

  function setControlsEnabled(enabled) {
    [btnAuto, btnApply, btnReset, btnPick, btnAddColor, btnDownload, btnZoomOut, btnZoomIn, btnZoomFit]
      .forEach((button) => { button.disabled = !enabled; });
  }

  async function loadImageFile(file) {
    if (!file) return;
    const validExtension = /\.(png|webp|jpe?g)$/i.test(file.name);
    const validMime = /^image\/(png|webp|jpeg)$/i.test(file.type || '');
    if (!validMime && !validExtension) {
      showToast(`Tệp "${file.name}" không phải PNG, WebP hoặc JPEG hợp lệ.`, 'error');
      return;
    }

    try {
      dropTitle.textContent = 'Loading image…';
      const bitmap = await createImageBitmap(file);
      const pixels = bitmap.width * bitmap.height;
      if (pixels > 50_000_000) {
        bitmap.close();
        throw new Error('Sprite sheet vượt quá giới hạn 50 megapixels.');
      }
      originalCanvas.width = bitmap.width;
      originalCanvas.height = bitmap.height;
      originalContext.clearRect(0, 0, bitmap.width, bitmap.height);
      originalContext.drawImage(bitmap, 0, 0);
      state.original = originalContext.getImageData(0, 0, bitmap.width, bitmap.height);
      bitmap.close();
      state.result = cloneImageData(state.original);
      state.fileName = file.name;
      state.manualColors = [];
      state.detectedColors = [];
      state.autoEnabled = false;
      drawImageData(resultCanvas, resultContext, state.result);
      originalStage.classList.add('has-image');
      resultStage.classList.add('has-image');
      fileLabel.textContent = file.name;
      imageInfo.textContent = `${state.original.width} × ${state.original.height} · ${(file.size / 1024 / 1024).toFixed(2)} MB`;
      resultStatus.textContent = 'Ready · choose Auto Remove or Pick Color';
      dropTitle.textContent = file.name;
      dropHint.textContent = 'Click to replace sprite sheet';
      downloadName.value = (file.name.replace(/\.[^/.]+$/, '') || 'sprite_sheet') + '_clean';
      setControlsEnabled(true);
      renderColors();
      requestAnimationFrame(fitToView);
      showToast(`Đã tải sprite sheet: ${file.name}`, 'success');
    } catch (error) {
      dropTitle.textContent = 'Drop sprite sheet here';
      dropHint.textContent = 'PNG, WebP or JPEG · up to 50 megapixels';
      showToast(error.message || 'Không thể đọc ảnh.', 'error');
    } finally {
      imageInput.value = '';
    }
  }

  function processOptions(autoDetect) {
    return {
      autoDetect,
      keyColors: state.manualColors,
      similarity: Number(similarity.value),
      feather: Number(feather.value),
      spill: Number(spill.value),
      subjectProtection: Number(protection.value),
      cleanupRadius: Number(cleanup.value),
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
      const result = processSpriteSheet(working, processOptions(autoDetect));
      state.result = result.imageData;
      state.detectedColors = autoDetect
        ? result.keyColors.filter((color) => !state.manualColors.some((manual) => manual.hex === color.hex))
        : [];
      drawImageData(resultCanvas, resultContext, state.result);
      renderColors();
      resultStatus.textContent = `${result.removedPixels.toLocaleString()} pixels cleaned · edge-connected mask`;
      showToast(`Đã làm sạch ${result.removedPixels.toLocaleString()} pixels nền.`, 'success');
    } catch (error) {
      resultStatus.textContent = 'Processing failed';
      showToast(error.message || 'Không thể xử lý sprite sheet.', 'error');
    } finally {
      state.isProcessing = false;
      progress.classList.remove('active');
      progress.setAttribute('aria-hidden', 'true');
      setControlsEnabled(true);
    }
  }

  function resetResult() {
    if (!state.original) return;
    state.result = cloneImageData(state.original);
    state.manualColors = [];
    state.detectedColors = [];
    state.autoEnabled = false;
    drawImageData(resultCanvas, resultContext, state.result);
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
  }

  function fitToView() {
    if (!state.original) return;
    const stageWidth = Math.min(originalStage.clientWidth, resultStage.clientWidth) - 32;
    const stageHeight = Math.min(originalStage.clientHeight, resultStage.clientHeight) - 32;
    state.zoom = Math.max(0.02, Math.min(1, stageWidth / state.original.width, stageHeight / state.original.height));
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

  function updatePicker(event) {
    if (!state.isPicking || !state.original) return;
    const point = canvasCoordinates(event);
    if (!point) {
      pickerLoupe.style.display = 'none';
      return;
    }
    const offset = ((point.y * state.original.width) + point.x) * 4;
    const data = state.original.data;
    const color = { r: data[offset], g: data[offset + 1], b: data[offset + 2] };
    const hex = hexColor(color);
    pickerContext.imageSmoothingEnabled = false;
    pickerContext.clearRect(0, 0, 72, 72);
    pickerContext.drawImage(originalCanvas, point.x - 4, point.y - 4, 9, 9, 0, 0, 72, 72);
    pickerHex.textContent = hex;
    pickerLoupe.style.display = 'block';
    pickerLoupe.style.left = `${event.clientX + 18}px`;
    pickerLoupe.style.top = `${event.clientY + 18}px`;
  }

  function activatePicker() {
    if (!state.original) return;
    state.isPicking = true;
    btnPick.classList.add('active');
    pickBanner.classList.add('active');
    originalStage.classList.add('is-picking');
  }

  function deactivatePicker() {
    state.isPicking = false;
    btnPick?.classList.remove('active');
    pickBanner?.classList.remove('active');
    originalStage?.classList.remove('is-picking');
    if (pickerLoupe) pickerLoupe.style.display = 'none';
  }

  function sanitizeName(value) {
    return (value || 'clean_sprite_sheet').replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_');
  }

  function downloadResult() {
    if (!state.result) return;
    const format = outputFormat.value === 'webp' ? 'webp' : 'png';
    resultCanvas.toBlob((blob) => {
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
  btnPick.addEventListener('click', () => state.isPicking ? deactivatePicker() : activatePicker());
  btnAddColor.addEventListener('click', () => addManualColor(colorFromHex(manualColor.value)));
  btnClearColors.addEventListener('click', resetResult);
  btnDownload.addEventListener('click', downloadResult);
  perCell.addEventListener('change', () => {
    rows.disabled = !perCell.checked;
    cols.disabled = !perCell.checked;
    gridInputs.setAttribute('aria-disabled', String(!perCell.checked));
  });

  [
    [similarity, byId('spriteSimilarityValue'), (value) => value],
    [feather, byId('spriteFeatherValue'), (value) => value],
    [spill, byId('spriteSpillValue'), (value) => value],
    [protection, byId('spriteProtectionValue'), (value) => value],
    [cleanup, byId('spriteCleanupValue'), (value) => `${value} px`]
  ].forEach(([input, label, format]) => {
    input.addEventListener('input', () => { label.textContent = format(input.value); });
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
    const offset = ((point.y * state.original.width) + point.x) * 4;
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
    addManualColor(color);
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.isPicking) deactivatePicker();
  });
  window.addEventListener('resize', () => {
    if (isCleanerActive() && state.original) fitToView();
  });
});
