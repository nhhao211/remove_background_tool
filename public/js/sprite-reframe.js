document.addEventListener('DOMContentLoaded', () => {
  const byId = (id) => document.getElementById(id);

  const imageInput = byId('reframeImageInput');
  const dropZone = byId('reframeDropZone');
  const dropTitle = byId('reframeDropTitle');
  const dropHint = byId('reframeDropHint');
  const originalCanvas = byId('reframeOriginalCanvas');
  const resultCanvas = byId('reframeResultCanvas');
  const originalStage = byId('reframeOriginalStage');
  const resultStage = byId('reframeResultStage');
  const fileLabel = byId('reframeFileLabel');
  const imageInfo = byId('reframeImageInfo');
  const sourceStatus = byId('reframeSourceStatus');
  const resultStatus = byId('reframeResultStatus');
  const sourceRows = byId('reframeSourceRows');
  const sourceCols = byId('reframeSourceCols');
  const targetRows = byId('reframeTargetRows');
  const targetCols = byId('reframeTargetCols');
  const cellWidth = byId('reframeCellWidth');
  const cellHeight = byId('reframeCellHeight');
  const scaleUp = byId('reframeScaleUp');
  const downloadName = byId('reframeDownloadName');
  const outputFormat = byId('reframeOutputFormat');
  const btnConvert = byId('btnReframeConvert');
  const btnReset = byId('btnReframeReset');
  const btnDownload = byId('btnReframeDownload');
  const btnToggleBg = byId('btnReframeToggleBg');
  const btnZoomOut = byId('btnReframeZoomOut');
  const btnZoomIn = byId('btnReframeZoomIn');
  const btnZoomFit = byId('btnReframeZoomFit');
  const zoomLevel = byId('reframeZoomLevel');
  const fullPageDropOverlay = byId('fullPageDropOverlay');

  if (!imageInput || !dropZone || !originalCanvas || !resultCanvas) return;

  const originalContext = originalCanvas.getContext('2d', { willReadFrequently: true });
  const resultContext = resultCanvas.getContext('2d', { willReadFrequently: true });

  const state = {
    sourceCanvas: null,
    resultCanvas: null,
    fileName: '',
    zoom: 1,
    panX: 0,
    panY: 0,
    drag: null,
    checker: true
  };

  function isReframeActive() {
    return document.body.dataset.activeWorkspace === 'sprite-reframe';
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

  function sanitizeName(value) {
    return (value || 'sprite_sheet_6x4_16x9').replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_');
  }

  function clampInteger(input, min, max, fallback) {
    const value = Math.round(Number(input.value) || fallback);
    const clamped = Math.max(min, Math.min(max, value));
    input.value = String(clamped);
    return clamped;
  }

  function settings() {
    return {
      sourceRows: clampInteger(sourceRows, 1, 100, 4),
      sourceCols: clampInteger(sourceCols, 1, 100, 6),
      targetRows: clampInteger(targetRows, 1, 100, 6),
      targetCols: clampInteger(targetCols, 1, 100, 4),
      cellWidth: clampInteger(cellWidth, 16, 4096, 1920),
      cellHeight: clampInteger(cellHeight, 16, 4096, 1080),
      scaleUp: scaleUp.checked
    };
  }

  function setControlsEnabled(enabled) {
    [btnConvert, btnReset, btnZoomOut, btnZoomIn, btnZoomFit].forEach((button) => { button.disabled = !enabled; });
    btnDownload.disabled = !state.resultCanvas;
  }

  function drawCanvas(targetCanvas, context, sourceCanvas) {
    targetCanvas.width = sourceCanvas.width;
    targetCanvas.height = sourceCanvas.height;
    context.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
    context.drawImage(sourceCanvas, 0, 0);
  }

  function applyTransform() {
    const transform = `translate(-50%, -50%) translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
    originalCanvas.style.transform = transform;
    resultCanvas.style.transform = transform;
    zoomLevel.textContent = `${Math.round(state.zoom * 100)}%`;
  }

  function fitToView() {
    const visibleCanvas = state.resultCanvas || state.sourceCanvas;
    if (!visibleCanvas) return;
    const stageWidth = Math.min(originalStage.clientWidth, resultStage.clientWidth) - 32;
    const stageHeight = Math.min(originalStage.clientHeight, resultStage.clientHeight) - 32;
    state.zoom = Math.max(0.01, Math.min(1, stageWidth / visibleCanvas.width, stageHeight / visibleCanvas.height));
    state.panX = 0;
    state.panY = 0;
    applyTransform();
  }

  function zoomBy(factor, clientX = null, clientY = null, stage = resultStage) {
    if (!state.sourceCanvas) return;
    const oldZoom = state.zoom;
    const nextZoom = Math.max(0.01, Math.min(8, oldZoom * factor));
    if (clientX !== null && clientY !== null) {
      const rect = stage.getBoundingClientRect();
      const mx = clientX - rect.left - (rect.width / 2);
      const my = clientY - rect.top - (rect.height / 2);
      state.panX = mx - ((mx - state.panX) * (nextZoom / oldZoom));
      state.panY = my - ((my - state.panY) * (nextZoom / oldZoom));
    }
    state.zoom = nextZoom;
    applyTransform();
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
      dropTitle.textContent = 'Loading image...';
      const bitmap = await createImageBitmap(file);
      const pixels = bitmap.width * bitmap.height;
      if (pixels > 50_000_000) {
        bitmap.close();
        throw new Error('Sprite sheet vượt quá giới hạn 50 megapixels.');
      }

      const sourceCanvas = document.createElement('canvas');
      sourceCanvas.width = bitmap.width;
      sourceCanvas.height = bitmap.height;
      sourceCanvas.getContext('2d').drawImage(bitmap, 0, 0);
      bitmap.close();

      state.sourceCanvas = sourceCanvas;
      state.resultCanvas = null;
      state.fileName = file.name;

      drawCanvas(originalCanvas, originalContext, sourceCanvas);
      resultCanvas.width = 1;
      resultCanvas.height = 1;
      resultContext.clearRect(0, 0, 1, 1);
      originalStage.classList.add('has-image');
      resultStage.classList.remove('has-image');
      fileLabel.textContent = file.name;
      imageInfo.textContent = `${sourceCanvas.width} × ${sourceCanvas.height} · ${(file.size / 1024 / 1024).toFixed(2)} MB`;
      sourceStatus.textContent = `${sourceCanvas.width}×${sourceCanvas.height}`;
      resultStatus.textContent = 'Ready to convert';
      dropTitle.textContent = file.name;
      dropHint.textContent = 'Click to replace sprite sheet';
      downloadName.value = `${file.name.replace(/\.[^/.]+$/, '') || 'sprite_sheet'}_6x4_16x9`;
      setControlsEnabled(true);
      convertSheet();
      showToast(`Đã tải sprite sheet: ${file.name}`, 'success');
    } catch (error) {
      dropTitle.textContent = 'Drop 4×6 sprite sheet here';
      dropHint.textContent = 'PNG, WebP or JPEG · output cells are 1920×1080';
      showToast(error.message || 'Không thể đọc ảnh.', 'error');
    } finally {
      imageInput.value = '';
    }
  }

  function convertSheet() {
    if (!state.sourceCanvas) return;
    const config = settings();
    const sourceTotal = config.sourceRows * config.sourceCols;
    const targetTotal = config.targetRows * config.targetCols;
    const frameCount = Math.min(sourceTotal, targetTotal);
    const sourceCellWidth = state.sourceCanvas.width / config.sourceCols;
    const sourceCellHeight = state.sourceCanvas.height / config.sourceRows;

    const output = document.createElement('canvas');
    output.width = config.targetCols * config.cellWidth;
    output.height = config.targetRows * config.cellHeight;
    const outputContext = output.getContext('2d');
    outputContext.clearRect(0, 0, output.width, output.height);
    outputContext.imageSmoothingEnabled = true;
    outputContext.imageSmoothingQuality = 'high';

    for (let frame = 0; frame < frameCount; frame += 1) {
      const sourceRow = Math.floor(frame / config.sourceCols);
      const sourceCol = frame % config.sourceCols;
      const targetRow = Math.floor(frame / config.targetCols);
      const targetCol = frame % config.targetCols;
      const sx = Math.floor(sourceCol * sourceCellWidth);
      const sy = Math.floor(sourceRow * sourceCellHeight);
      const sw = Math.floor((sourceCol + 1) * sourceCellWidth) - sx;
      const sh = Math.floor((sourceRow + 1) * sourceCellHeight) - sy;
      const maxScale = Math.min(config.cellWidth / sw, config.cellHeight / sh);
      const drawScale = config.scaleUp ? maxScale : Math.min(1, maxScale);
      const dw = Math.round(sw * drawScale);
      const dh = Math.round(sh * drawScale);
      const dx = (targetCol * config.cellWidth) + Math.floor((config.cellWidth - dw) / 2);
      const dy = (targetRow * config.cellHeight) + Math.floor((config.cellHeight - dh) / 2);

      outputContext.drawImage(state.sourceCanvas, sx, sy, sw, sh, dx, dy, dw, dh);
    }

    state.resultCanvas = output;
    drawCanvas(resultCanvas, resultContext, output);
    resultStage.classList.add('has-image');
    btnDownload.disabled = false;
    resultStatus.textContent = `${config.targetRows}×${config.targetCols} sheet · ${config.cellWidth}×${config.cellHeight} cells · ${output.width}×${output.height}px`;
    if (sourceTotal !== targetTotal) {
      showToast(`Grid count khác nhau: đã chuyển ${frameCount}/${sourceTotal} frame.`, 'info');
    }
    requestAnimationFrame(fitToView);
  }

  function resetResult() {
    if (!state.sourceCanvas) return;
    state.resultCanvas = null;
    resultCanvas.width = 1;
    resultCanvas.height = 1;
    resultContext.clearRect(0, 0, 1, 1);
    resultStage.classList.remove('has-image');
    resultStatus.textContent = 'Convert to preview result';
    btnDownload.disabled = true;
    requestAnimationFrame(fitToView);
  }

  function downloadResult() {
    if (!state.resultCanvas) {
      showToast('Hãy convert sprite sheet trước.', 'error');
      return;
    }
    const format = outputFormat.value === 'webp' ? 'webp' : 'png';
    state.resultCanvas.toBlob((blob) => {
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
    if (!isReframeActive()) return;
    event.preventDefault();
    fullPageDropOverlay?.classList.remove('active');
    loadImageFile(event.dataTransfer?.files?.[0]);
  });
  window.addEventListener('dragenter', (event) => {
    if (!isReframeActive() || !Array.from(event.dataTransfer?.types || []).includes('Files')) return;
    event.preventDefault();
    fullPageDropOverlay?.classList.add('active');
  });
  window.addEventListener('dragleave', (event) => {
    if (!isReframeActive() || event.relatedTarget) return;
    fullPageDropOverlay?.classList.remove('active');
  });

  [sourceRows, sourceCols, targetRows, targetCols, cellWidth, cellHeight].forEach((input) => {
    input.addEventListener('change', () => {
      settings();
      if (state.sourceCanvas) convertSheet();
    });
  });
  scaleUp.addEventListener('change', () => {
    if (state.sourceCanvas) convertSheet();
  });
  btnConvert.addEventListener('click', convertSheet);
  btnReset.addEventListener('click', resetResult);
  btnDownload.addEventListener('click', downloadResult);
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
      if (!state.sourceCanvas) return;
      event.preventDefault();
      zoomBy(event.deltaY < 0 ? 1.12 : 0.89, event.clientX, event.clientY, stage);
    }, { passive: false });
    stage.addEventListener('pointerdown', (event) => {
      if (!state.sourceCanvas) return;
      state.drag = { id: event.pointerId, x: event.clientX, y: event.clientY, panX: state.panX, panY: state.panY };
      stage.setPointerCapture(event.pointerId);
      stage.classList.add('is-panning');
    });
    stage.addEventListener('pointermove', (event) => {
      if (!state.drag || state.drag.id !== event.pointerId) return;
      state.panX = state.drag.panX + event.clientX - state.drag.x;
      state.panY = state.drag.panY + event.clientY - state.drag.y;
      applyTransform();
    });
    const finishPan = (event) => {
      if (!state.drag || state.drag.id !== event.pointerId) return;
      state.drag = null;
      stage.classList.remove('is-panning');
    };
    stage.addEventListener('pointerup', finishPan);
    stage.addEventListener('pointercancel', finishPan);
  });

  window.addEventListener('workspacechange', (event) => {
    if (event.detail?.workspace === 'sprite-reframe' && state.sourceCanvas) requestAnimationFrame(fitToView);
  });
  window.addEventListener('resize', () => {
    if (isReframeActive() && state.sourceCanvas) fitToView();
  });
});
