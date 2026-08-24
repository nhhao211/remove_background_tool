/**
 * Video to Sprite Sheet Studio & Background Remover
 */

import { EditorUtils as U } from './editor-utils.js';
import { applyChromaKey } from './chroma-key.js';

document.addEventListener('DOMContentLoaded', () => {
  const DEFAULT_AUTO_FPS = 12;

  // === DOM ELEMENTS ===
  const video = document.getElementById('sourceVideo');
  const videoViewport = document.getElementById('videoViewport');
  const cropOverlay = document.getElementById('cropOverlay');
  const eyedropperLoupe = document.getElementById('eyedropperLoupe');
  const eyedropperCanvas = document.getElementById('eyedropperCanvas');
  const eyedropperColorBadge = document.getElementById('eyedropperColorBadge');
  const eyedropperHex = document.getElementById('eyedropperHex');
  const eyedropperRgb = document.getElementById('eyedropperRgb');
  const eyedropperBanner = document.getElementById('eyedropperBanner');
  const btnCancelEyedropper = document.getElementById('btnCancelEyedropper');
  const eyedropperOverlay = document.getElementById('eyedropperOverlay');
  const eyedropperZoomBadge = document.getElementById('eyedropperZoomBadge');
  const btnResetEyedropperZoom = document.getElementById('btnResetEyedropperZoom');
  const sourceVideoInfo = document.getElementById('sourceVideoInfo');

  // Preview eyedropper
  const previewEyedropperBanner = document.getElementById('previewEyedropperBanner');
  const previewEyedropperOverlay = document.getElementById('previewEyedropperOverlay');
  const previewEyedropperLoupe = document.getElementById('previewEyedropperLoupe');
  const previewEyedropperCanvas = document.getElementById('previewEyedropperCanvas');
  const previewEyedropperColorBadge = document.getElementById('previewEyedropperColorBadge');
  const previewEyedropperHex = document.getElementById('previewEyedropperHex');
  const previewEyedropperRgb = document.getElementById('previewEyedropperRgb');
  const btnCancelPreviewEyedropper = document.getElementById('btnCancelPreviewEyedropper');
  
  // Custom Video Controls
  const btnVideoPlayPause = document.getElementById('btnVideoPlayPause');
  const iconVideoPlayPause = document.getElementById('iconVideoPlayPause');
  const btnVideoStepBack = document.getElementById('btnVideoStepBack');
  const btnVideoStepForward = document.getElementById('btnVideoStepForward');
  const videoCurrentTimeDisplay = document.getElementById('videoCurrentTimeDisplay');

  // Trimming + CapCut-style editor
  const trimStartInput = document.getElementById('trimStartInput');
  const trimEndInput = document.getElementById('trimEndInput');
  const btnSetTrimStart = document.getElementById('btnSetTrimStart');
  const btnSetTrimEnd = document.getElementById('btnSetTrimEnd');
  const btnResetTrim = document.getElementById('btnResetTrim');
  const trimTimeline = document.getElementById('trimTimeline');
  const trimProgress = document.getElementById('trimProgress');
  const trimPlayhead = document.getElementById('trimPlayhead');

  const editorTrack = document.getElementById('editorTrack');
  const editorClip = document.getElementById('editorClip');
  const editorFilmstrip = document.getElementById('editorFilmstrip');
  const editorClipLabel = document.getElementById('editorClipLabel');
  const editorPlayhead = document.getElementById('editorPlayhead');
  const editorRuler = document.getElementById('editorRuler');
  const clipDimLeft = document.getElementById('clipDimLeft');
  const clipDimRight = document.getElementById('clipDimRight');
  const trimHandleLeft = document.getElementById('trimHandleLeft');
  const trimHandleRight = document.getElementById('trimHandleRight');
  const editorCurrentTime = document.getElementById('editorCurrentTime');
  const editorTotalTime = document.getElementById('editorTotalTime');
  const btnEditorSplit = document.getElementById('btnEditorSplit');
  const btnEditorDuplicate = document.getElementById('btnEditorDuplicate');
  const btnEditorDelete = document.getElementById('btnEditorDelete');
  const btnEditorMute = document.getElementById('btnEditorMute');
  const iconEditorMute = document.getElementById('iconEditorMute');
  const btnEditorPlay = document.getElementById('btnEditorPlay');
  const iconEditorPlay = document.getElementById('iconEditorPlay');
  const btnEditorSkipBack = document.getElementById('btnEditorSkipBack');
  const btnEditorSkipForward = document.getElementById('btnEditorSkipForward');
  const speedPresets = document.getElementById('speedPresets');
  const inputSpeedCustom = document.getElementById('inputSpeedCustom');
  const inputSpeedCustomSettings = document.getElementById('inputSpeedCustomSettings');
  const lblSpeedSettings = document.getElementById('lblSpeedSettings');
  const btnResetSpeed = document.getElementById('btnResetSpeed');
  const speedEffectiveHint = document.getElementById('speedEffectiveHint');

  // Preview
  const previewCanvas = document.getElementById('previewCanvas');
  const spriteViewport = document.getElementById('spriteViewport');
  const btnPlayPause = document.getElementById('btnPlayPause');
  const iconPlayPause = document.getElementById('iconPlayPause');
  const textPlayPause = document.getElementById('textPlayPause');
  const btnToggleMode = document.getElementById('btnToggleMode');
  const textToggleMode = document.getElementById('textToggleMode');
  const frameCounter = document.getElementById('frameCounter');
  const btnZoomIn = document.getElementById('btnZoomIn');
  const btnZoomOut = document.getElementById('btnZoomOut');
  const btnZoomFit = document.getElementById('btnZoomFit');
  const zoomLevel = document.getElementById('zoomLevel');
  const btnToggleChecker = document.getElementById('btnToggleChecker');
  const inputPreviewBgColor = document.getElementById('inputPreviewBgColor');

  // Actions & Inputs
  const btnGenerate = document.getElementById('btnGenerate');
  const btnDownloadMain = document.getElementById('btnDownloadMain');
  const downloadDropdownMenu = document.getElementById('downloadDropdownMenu');
  const btnDownloadBundleZip = document.getElementById('btnDownloadBundleZip');
  const btnDownloadSpriteOnly = document.getElementById('btnDownloadSpriteOnly');
  const btnDownloadAudioOnly = document.getElementById('btnDownloadAudioOnly');
  const lblDownloadBtn = document.getElementById('lblDownloadBtn');
  const lblSpriteOnly = document.getElementById('lblSpriteOnly');

  const btnBrowseFile = document.getElementById('btnBrowseFile');
  const btnBrowseSecondary = document.getElementById('btnBrowseSecondary');
  const videoFileInput = document.getElementById('videoFileInput');
  const dropZone = document.getElementById('dropZone');
  const dropZoneFilename = document.getElementById('dropZoneFilename');
  const activeFilenameLabel = document.getElementById('activeFilenameLabel');
  const btnLoadDemo = document.getElementById('btnLoadDemo');

  const btnToggleCollapse = document.getElementById('btnToggleCollapse');
  const iconCollapse = document.getElementById('iconCollapse');
  const lblCollapse = document.getElementById('lblCollapse');
  const settingsBody = document.getElementById('settingsBody');
  const progressBarContainer = document.getElementById('progressBarContainer');
  const progressBarFill = document.getElementById('progressBarFill');

  // Form Fields
  const inputFrames = document.getElementById('inputFrames');
  const chkKeepSourceSize = document.getElementById('chkKeepSourceSize');
  const inputRows = document.getElementById('inputRows');
  const inputCols = document.getElementById('inputCols');
  const inputCellNative = document.getElementById('inputCellNative');
  const inputCropTop = document.getElementById('inputCropTop');
  const inputCropBottom = document.getElementById('inputCropBottom');
  const inputCropLeft = document.getElementById('inputCropLeft');
  const inputCropRight = document.getElementById('inputCropRight');
  const inputDownloadName = document.getElementById('inputDownloadName');
  const sliderSimilarity = document.getElementById('sliderSimilarity');
  const lblSimilarityVal = document.getElementById('lblSimilarityVal');
  const sliderBlend = document.getElementById('sliderBlend');
  const lblBlendVal = document.getElementById('lblBlendVal');
  const sliderSpill = document.getElementById('sliderSpill');
  const lblSpillVal = document.getElementById('lblSpillVal');
  const sliderSubjectProtection = document.getElementById('sliderSubjectProtection');
  const lblSubjectProtectionVal = document.getElementById('lblSubjectProtectionVal');
  const inputFps = document.getElementById('inputFps');
  const btnAutoFps = document.getElementById('btnAutoFps');
  const chkTransparentFormat = document.getElementById('chkTransparentFormat');
  const lblFormatName = document.getElementById('lblFormatName');
  const selectFormat = document.getElementById('selectFormat');

  // Eyedropper & Swatches
  const btnPickColor = document.getElementById('btnPickColor');
  const manualColorInput = document.getElementById('manualColorInput');
  const btnAddManualColor = document.getElementById('btnAddManualColor');
  const btnClearKeyColors = document.getElementById('btnClearKeyColors');
  const swatchesList = document.getElementById('swatchesList');
  const inputColorHex = document.getElementById('inputColorHex');
  const inputColorRgb = document.getElementById('inputColorRgb');
  const btnApplyColorValue = document.getElementById('btnApplyColorValue');
  const btnCopyColor = document.getElementById('btnCopyColor');
  const btnPasteColor = document.getElementById('btnPasteColor');
  const colorInputError = document.getElementById('colorInputError');
  const recentColorsList = document.getElementById('recentColorsList');
  const toastContainer = document.getElementById('toastContainer');

  // Keep keyboard navigation predictable across the separate preview/editor/settings cards.
  // Positive tabindex is intentionally limited to the primary workflow controls; decorative
  // canvas/video elements stay out of the sequence.
  function applyTabOrder() {
    const orderedIds = [
      'btnLoadDemo', 'btnToggleChecker',
      'btnVideoPlayPause', 'btnVideoStepBack', 'btnVideoStepForward',
      'btnResetEyedropperZoom', 'btnCancelEyedropper',
      'btnEditorSplit', 'btnEditorDuplicate', 'btnEditorDelete', 'btnEditorMute',
      ...Array.from(document.querySelectorAll('#speedPresets .speed-preset-btn')).map((element) => element.id || null),
      'inputSpeedCustom', 'btnEditorSkipBack', 'btnEditorPlay', 'btnEditorSkipForward',
      'btnSetTrimStart', 'btnSetTrimEnd', 'btnResetTrim', 'trimHandleLeft', 'trimHandleRight',
      'trimStartInput', 'trimEndInput',
      'btnPlayPause', 'btnToggleMode', 'btnZoomOut', 'btnZoomIn', 'btnZoomFit', 'inputPreviewBgColor', 'btnCancelPreviewEyedropper',
      'btnGenerate', 'btnDownloadMain', 'btnDownloadBundleZip', 'btnDownloadSpriteOnly', 'btnDownloadAudioOnly',
      'btnBrowseFile', 'btnToggleCollapse', 'btnBrowseSecondary',
      // Sprite Sheet Settings (sidebar)
      'inputFrames', 'chkKeepSourceSize',
      'inputRows', 'inputCols', 'inputCellNative',
      'inputCropTop', 'inputCropBottom', 'inputCropLeft', 'inputCropRight',
      'inputDownloadName',
      'inputSpeedCustomSettings', 'btnResetSpeed',
      'inputFps', 'btnAutoFps',
      // Chroma Key Settings
      'sliderSimilarity', 'sliderBlend', 'sliderSpill', 'sliderSubjectProtection',
      'chkTransparentFormat', 'selectFormat',
      'btnPickColor',
      'manualColorInput', 'btnAddManualColor', 'btnClearKeyColors',
      'inputColorHex', 'inputColorRgb', 'btnApplyColorValue', 'btnCopyColor', 'btnPasteColor'
    ];
    let index = 1;
    orderedIds.forEach((id) => {
      if (!id) return;
      const element = document.getElementById(id);
      if (element) element.tabIndex = index++;
    });
    ['sourceVideo', 'videoFileInput'].forEach((id) => {
      const element = document.getElementById(id);
      if (element) element.tabIndex = -1;
    });
  }

  applyTabOrder();

  // === STATE ===
  let state = {
    currentVideoFile: null,
    currentVideoUrl: '',
    sourceId: '',
    videoLoaded: false,
    duration: 0,
    videoWidth: 0,
    videoHeight: 0,
    trimStart: 0,
    trimEnd: 0,
    keyColors: [
      { r: 0, g: 36, b: 245, hex: '#0024f5' } // Default chroma key color (blue)
    ],
    isEyedropperActive: false,
    eyedropperZoom: 1,
    eyedropperPanX: 0,
    eyedropperPanY: 0,
    eyedropperPointer: null,
    eyedropperLastMouse: null,
    previewEyedropperPointer: null,
    previewEyedropperLastMouse: null,
    wasPreviewPlaying: false,
    generatedFrames: [], // Array of Canvas elements
    fullSheetCanvas: null,
    currentFrameIndex: 0,
    isPlaying: false,
    animationTimer: null,
    previewMode: 'play', // 'play' or 'sheet'
    zoom: 1.0,
    panX: 0,
    panY: 0,
    isDragging: false,
    dragStartX: 0,
    dragStartY: 0,
    isGenerating: false,
    // Timeline editor drag state
    timelineDrag: null, // 'left' | 'right' | 'playhead' | 'move' | null
    filmstripFrames: [],
    filmstripReady: false,
    savedTrimBackup: null, // for duplicate
    isMuted: false,
    playbackSpeed: 1,
    previewFpsIsManual: false,
    activeColorIndex: null,
    timelinePointerId: null,
    videoLoadToken: 0
  };

  const CLIP_STATE_KEY = 'video-editor:clip-states:v1';
  const RECENT_COLORS_KEY = 'video-editor:recent-colors:v1';
  let saveStateTimer = null;

  function readJsonStorage(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      return value && typeof value === 'object' ? value : fallback;
    } catch (_) { return fallback; }
  }

  function loadClipState() {
    if (!state.sourceId) return null;
    const stored = readJsonStorage(CLIP_STATE_KEY, {});
    const states = Array.isArray(stored) ? {} : stored;
    const saved = states[state.sourceId];
    if (!saved || saved.schemaVersion !== 1) return null;
    return saved;
  }

  function saveClipState() {
    if (!state.sourceId || !state.videoLoaded) return;
    const stored = readJsonStorage(CLIP_STATE_KEY, {});
    const states = Array.isArray(stored) ? {} : stored;
    states[state.sourceId] = {
      schemaVersion: 1,
      sourceId: state.sourceId,
      trimStart: state.trimStart,
      trimEnd: state.trimEnd,
      playbackSpeed: state.playbackSpeed,
      previewFps: parseInt(inputFps.value, 10) || DEFAULT_AUTO_FPS,
      previewFpsIsManual: state.previewFpsIsManual,
      keyColors: state.keyColors,
      chromaSimilarity: parseFloat(sliderSimilarity.value),
      chromaBlend: parseFloat(sliderBlend.value),
      chromaSpill: parseFloat(sliderSpill.value),
      chromaSubjectProtection: parseFloat(sliderSubjectProtection.value),
      updatedAt: Date.now()
    };
    try { localStorage.setItem(CLIP_STATE_KEY, JSON.stringify(states)); } catch (_) { /* storage is optional */ }
  }

  function saveClipStateDebounced() {
    clearTimeout(saveStateTimer);
    saveStateTimer = setTimeout(saveClipState, 180);
  }

  function saveRecentColor(color) {
    const stored = readJsonStorage(RECENT_COLORS_KEY, []);
    const recent = Array.isArray(stored)
      ? stored.map((item) => U.normalizeColor(item?.hex || '')).filter(Boolean)
      : [];
    const next = [color, ...recent.filter((item) => item.hex !== color.hex)].slice(0, 12);
    try { localStorage.setItem(RECENT_COLORS_KEY, JSON.stringify(next)); } catch (_) { /* optional */ }
    return next;
  }

  // === INITIALIZATION ===
  renderSwatches();
  renderRecentColors();
  updateFormatLabels();
  initCanvasContexts();

  function initCanvasContexts() {
    previewCanvas.width = 512;
    previewCanvas.height = 512;
    const ctx = previewCanvas.getContext('2d');
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.clearRect(0, 0, 512, 512);
  }

  // === TOAST NOTIFICATIONS ===
  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    let icon = 'info';
    if (type === 'success') icon = 'check-circle';
    if (type === 'error') icon = 'alert-triangle';
    
    const iconElement = document.createElement('i');
    iconElement.setAttribute('data-lucide', icon);
    iconElement.style.width = '16px';
    iconElement.style.height = '16px';
    const messageElement = document.createElement('span');
    messageElement.textContent = String(message);
    toast.append(iconElement, messageElement);
    toastContainer.appendChild(toast);
    lucide.createIcons({ root: toast });

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  // === FILE LOADING ===
  function loadVideoSource(source, fileName = 'video.mp4') {
    clearTimeout(saveStateTimer);
    saveClipState();
    state.videoLoaded = false;
    state.videoLoadToken += 1;
    state.activeColorIndex = null;
    stopAnimationPreview();
    state.generatedFrames = [];
    state.fullSheetCanvas = null;
    state.currentFrameIndex = 0;
    updatePreviewViewport();
    resetVideoViewportAspect();
    state.currentVideoFile = (source instanceof File) ? source : null;
    state.playbackSpeed = 1;
    state.keyColors = [{ r: 0, g: 36, b: 245, hex: '#0024f5' }];
    
    if (typeof source === 'string') {
      state.currentVideoUrl = source;
      video.src = source;
    } else if (source instanceof File) {
      if (state.currentVideoUrl && state.currentVideoUrl.startsWith('blob:')) {
        URL.revokeObjectURL(state.currentVideoUrl);
      }
      state.currentVideoUrl = URL.createObjectURL(source);
      video.src = state.currentVideoUrl;
    }
    state.sourceId = U.sourceId(source, fileName);

    dropZoneFilename.textContent = fileName;
    activeFilenameLabel.textContent = fileName;
    if (editorClipLabel) {
      editorClipLabel.textContent = fileName.replace(/\.[^/.]+$/, '') || fileName;
    }
    
    // Suggest download name based on uploaded filename
    const baseName = fileName.replace(/\.[^/.]+$/, "");
    if (baseName) {
      inputDownloadName.value = baseName;
    }

    showToast(`Loading video: ${fileName}`, 'info');
  }

  function resetVideoViewportAspect() {
    videoViewport.classList.remove('auto-aspect', 'portrait', 'landscape', 'square');
    videoViewport.style.removeProperty('--video-aspect-ratio');
    videoViewport.style.removeProperty('--video-aspect-decimal');
  }

  function updateVideoViewportAspect() {
    if (!state.videoWidth || !state.videoHeight) {
      resetVideoViewportAspect();
      return;
    }

    const ratio = state.videoWidth / state.videoHeight;
    const orientation = ratio < 0.9 ? 'portrait' : ratio > 1.1 ? 'landscape' : 'square';
    videoViewport.style.setProperty('--video-aspect-ratio', `${state.videoWidth} / ${state.videoHeight}`);
    videoViewport.style.setProperty('--video-aspect-decimal', ratio.toFixed(6));
    videoViewport.classList.remove('portrait', 'landscape', 'square');
    videoViewport.classList.add('auto-aspect', orientation);
    requestAnimationFrame(updateCropOverlay);
  }

  function getAspectRatioLabel(width, height) {
    const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
    const divisor = gcd(width, height) || 1;
    const w = width / divisor;
    const h = height / divisor;
    if (w > 100 || h > 100) {
      const ratio = width / height;
      if (Math.abs(ratio - (16 / 9)) < 0.03) return '16:9';
      if (Math.abs(ratio - (9 / 16)) < 0.03) return '9:16';
      if (Math.abs(ratio - 1) < 0.03) return '1:1';
      if (Math.abs(ratio - (4 / 3)) < 0.03) return '4:3';
      if (Math.abs(ratio - (3 / 4)) < 0.03) return '3:4';
    }
    return `${w}:${h}`;
  }

  function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) seconds = 0;
    const totalCentiseconds = Math.round(seconds * 100);
    const m = Math.floor(totalCentiseconds / 6000);
    const s = Math.floor((totalCentiseconds % 6000) / 100);
    const ms = totalCentiseconds % 100;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;
  }

  function updateVideoTimeDisplay() {
    if (!state.videoLoaded) {
      videoCurrentTimeDisplay.textContent = '00:00.00 / 00:00.00';
      if (editorCurrentTime) editorCurrentTime.textContent = '00:00.00';
      if (editorTotalTime) editorTotalTime.textContent = '00:00.00';
      return;
    }
    videoCurrentTimeDisplay.textContent = `${formatTime(video.currentTime)} / ${formatTime(state.duration)}`;
    if (editorCurrentTime) editorCurrentTime.textContent = formatTime(video.currentTime);
    if (editorTotalTime) editorTotalTime.textContent = formatTime(state.duration);
  }

  function updateVideoPlayPauseBtn() {
    const isPaused = video.paused || video.ended;
    const iconName = isPaused ? 'play' : 'pause';

    iconVideoPlayPause.setAttribute('data-lucide', iconName);
    if (isPaused) {
      btnVideoPlayPause.classList.remove('active');
    } else {
      btnVideoPlayPause.classList.add('active');
    }
    lucide.createIcons({ root: btnVideoPlayPause });

    if (iconEditorPlay) {
      iconEditorPlay.setAttribute('data-lucide', iconName);
      lucide.createIcons({ root: btnEditorPlay });
    }
  }

  btnVideoPlayPause.addEventListener('click', () => {
    if (!state.videoLoaded) return;
    if (video.paused || video.ended) {
      video.play();
    } else {
      video.pause();
    }
    updateVideoPlayPauseBtn();
  });

  video.addEventListener('play', updateVideoPlayPauseBtn);
  video.addEventListener('pause', updateVideoPlayPauseBtn);

  btnVideoStepBack.addEventListener('click', () => {
    if (!state.videoLoaded) return;
    video.pause();
    video.currentTime = Math.max(0, video.currentTime - (1 / 24));
  });

  btnVideoStepForward.addEventListener('click', () => {
    if (!state.videoLoaded) return;
    video.pause();
    video.currentTime = Math.min(state.duration, video.currentTime + (1 / 24));
  });

  // Global Keyboard shortcuts for video navigation
  window.addEventListener('keydown', (e) => {
    // Ignore when typing inside input or textarea
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;

    if (e.code === 'Space') {
      e.preventDefault();
      if (!state.videoLoaded) return;
      if (video.paused || video.ended) {
        video.play();
      } else {
        video.pause();
      }
    } else if (e.code === 'ArrowLeft') {
      e.preventDefault();
      if (!state.videoLoaded) return;
      video.pause();
      video.currentTime = Math.max(0, video.currentTime - (1 / 24));
    } else if (e.code === 'ArrowRight') {
      e.preventDefault();
      if (!state.videoLoaded) return;
      video.pause();
      video.currentTime = Math.min(state.duration, video.currentTime + (1 / 24));
    }
  });

  video.addEventListener('loadedmetadata', () => {
    state.videoLoaded = true;
    state.duration = video.duration || 0;
    state.videoWidth = video.videoWidth || 640;
    state.videoHeight = video.videoHeight || 360;
    updateVideoViewportAspect();
    
    const saved = loadClipState();
    const range = U.clampTrimRange(saved?.trimStart ?? 0, saved?.trimEnd ?? state.duration, state.duration, U.MIN_TRIM_DURATION);
    state.trimStart = range.start;
    state.trimEnd = range.end;
    if (Array.isArray(saved?.keyColors)) {
      state.keyColors = saved.keyColors.map((color) => U.normalizeColor(color?.hex || '')).filter(Boolean);
    }
    sliderSimilarity.value = String(U.clampNumber(saved?.chromaSimilarity, 0, 1, 0.55));
    sliderBlend.value = String(U.clampNumber(saved?.chromaBlend, 0, 1, 0.18));
    sliderSpill.value = String(U.clampNumber(saved?.chromaSpill, 0, 1, 0.55));
    sliderSubjectProtection.value = String(U.clampNumber(saved?.chromaSubjectProtection, 0, 1, 0.50));
    updateChromaSliderLabels();

    trimStartInput.value = state.trimStart.toFixed(2);
    trimStartInput.max = state.duration.toFixed(2);
    trimEndInput.value = state.trimEnd.toFixed(2);
    trimEndInput.max = state.duration.toFixed(2);

    sourceVideoInfo.textContent = `${state.videoWidth}x${state.videoHeight} • ${getAspectRatioLabel(state.videoWidth, state.videoHeight)} • ${state.duration.toFixed(2)}s`;
    
    if (editorClipLabel) {
      const name = dropZoneFilename.textContent || 'video';
      editorClipLabel.textContent = name.replace(/\.[^/.]+$/, '') || name;
    }

    updateTrimUI();
    renderRuler();
    updateCropOverlay();
    setPlaybackSpeed(saved?.playbackSpeed ?? 1, { toast: false, persist: false });
    state.previewFpsIsManual = Boolean(saved?.previewFpsIsManual);
    if (saved?.previewFps) inputFps.value = String(Math.max(1, Math.min(60, Number(saved.previewFps) || DEFAULT_AUTO_FPS)));
    else autoComputeFPS({ force: true });
    renderSwatches();
    updateVideoTimeDisplay();
    updateVideoPlayPauseBtn();
    generateFilmstrip();
    saveClipState();
    showToast(`Video loaded (${state.videoWidth}x${state.videoHeight}, ${state.duration.toFixed(2)}s)`, 'success');
  });

  video.addEventListener('timeupdate', () => {
    if (!state.videoLoaded || state.duration === 0) return;
    updatePlayheadPosition();
    updateVideoTimeDisplay();
  });

  // Load demo only when requested.
  btnLoadDemo.addEventListener('click', () => {
    loadVideoSource('/samples/sample_blue_flower.mp4', 'sample_blue_flower.mp4');
  });

  // Full Page & Viewport Drop Elements
  const fullPageDropOverlay = document.getElementById('fullPageDropOverlay');
  const viewportDropOverlay = document.getElementById('viewportDropOverlay');

  // Browse buttons
  btnBrowseFile.addEventListener('click', () => videoFileInput.click());
  btnBrowseSecondary.addEventListener('click', () => videoFileInput.click());
  dropZone.addEventListener('click', () => videoFileInput.click());

  videoFileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      handleIncomingFile(e.target.files[0]);
    }
  });

  // Helper to validate and process incoming file
  function handleIncomingFile(file) {
    if (!file) return;
    
    // Check if file is video by mime-type or file extension
    const validExts = ['.mp4', '.webm', '.mov', '.avi', '.mkv', '.m4v', '.ogv', '.flv'];
    const lowerName = file.name.toLowerCase();
    const isVideoExt = validExts.some(ext => lowerName.endsWith(ext));
    const isVideoMime = file.type && file.type.startsWith('video/');

    if (!isVideoMime && !isVideoExt) {
      showToast(`Tệp "${file.name}" không phải là định dạng video hợp lệ.`, 'error');
      return;
    }

    loadVideoSource(file, file.name);
    showToast(`Đã nhận file video: ${file.name}`, 'success');
  }

  // === DRAG & DROP SYSTEM (Full-page & Targeted zones) ===
  let dragCounter = 0;

  // Window-level drag detection for full-screen overlay
  window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    if (e.dataTransfer && e.dataTransfer.types && Array.from(e.dataTransfer.types).includes('Files')) {
      if (fullPageDropOverlay) fullPageDropOverlay.classList.add('active');
    }
  });

  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy';
    }
  });

  window.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      if (fullPageDropOverlay) fullPageDropOverlay.classList.remove('active');
      if (viewportDropOverlay) viewportDropOverlay.classList.remove('active');
      dropZone.classList.remove('dragover');
    }
  });

  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    if (fullPageDropOverlay) fullPageDropOverlay.classList.remove('active');
    if (viewportDropOverlay) viewportDropOverlay.classList.remove('active');
    dropZone.classList.remove('dragover');

    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      // Find the first video file or take the first file
      let selectedFile = null;
      for (const f of e.dataTransfer.files) {
        if (f.type.startsWith('video/') || /\.(mp4|webm|mov|avi|mkv|m4v)$/i.test(f.name)) {
          selectedFile = f;
          break;
        }
      }
      handleIncomingFile(selectedFile || e.dataTransfer.files[0]);
    }
  });

  // Targeted Source Video Viewport drop
  videoViewport.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (viewportDropOverlay) viewportDropOverlay.classList.add('active');
  });

  videoViewport.addEventListener('dragleave', (e) => {
    e.preventDefault();
    if (viewportDropOverlay) viewportDropOverlay.classList.remove('active');
  });

  // Targeted Drop Zone box
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });

  dropZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
  });

  // === TRIMMING CONTROLS + CAPCUT-STYLE TIMELINE EDITOR ===
  function updatePlayheadPosition() {
    if (!state.duration) return;
    const pct = (video.currentTime / state.duration) * 100;
    if (trimPlayhead) trimPlayhead.style.left = `${pct}%`;
    if (editorPlayhead) editorPlayhead.style.left = `${pct}%`;
  }

  function updateTrimUI() {
    if (!state.duration) return;
    const startPct = (state.trimStart / state.duration) * 100;
    const endPct = (state.trimEnd / state.duration) * 100;
    const widthPct = Math.max(0, endPct - startPct);

    if (trimProgress) {
      trimProgress.style.left = `${startPct}%`;
      trimProgress.style.width = `${widthPct}%`;
    }

    if (editorClip) {
      editorClip.style.left = `${startPct}%`;
      editorClip.style.width = `${widthPct}%`;
    }

    if (clipDimLeft) {
      clipDimLeft.style.width = `${startPct}%`;
    }
    if (clipDimRight) {
      clipDimRight.style.width = `${Math.max(0, 100 - endPct)}%`;
    }

    updatePlayheadPosition();
    updateSpeedEffectiveHint();
    if (trimHandleLeft) {
      trimHandleLeft.querySelector('.trim-handle-tooltip').textContent = formatTime(state.trimStart);
      trimHandleLeft.setAttribute('aria-valuemin', '0');
      trimHandleLeft.setAttribute('aria-valuemax', String(Math.max(0, state.trimEnd - U.MIN_TRIM_DURATION)));
      trimHandleLeft.setAttribute('aria-valuenow', String(state.trimStart));
      trimHandleLeft.setAttribute('aria-valuetext', formatTime(state.trimStart));
    }
    if (trimHandleRight) {
      trimHandleRight.querySelector('.trim-handle-tooltip').textContent = formatTime(state.trimEnd);
      trimHandleRight.setAttribute('aria-valuemin', String(Math.min(state.duration, state.trimStart + U.MIN_TRIM_DURATION)));
      trimHandleRight.setAttribute('aria-valuemax', String(state.duration));
      trimHandleRight.setAttribute('aria-valuenow', String(state.trimEnd));
      trimHandleRight.setAttribute('aria-valuetext', formatTime(state.trimEnd));
    }
  }

  function renderRuler() {
    if (!editorRuler || !state.duration) {
      if (editorRuler) editorRuler.innerHTML = '';
      return;
    }

    const duration = state.duration;
    // Choose nice tick step based on duration
    let majorStep = 1;
    if (duration > 60) majorStep = 10;
    else if (duration > 30) majorStep = 5;
    else if (duration > 12) majorStep = 2;
    else if (duration <= 4) majorStep = 1;
    else majorStep = 1;

    const minorStep = majorStep >= 5 ? 1 : majorStep / 2;
    editorRuler.innerHTML = '';

    for (let t = 0; t <= duration + 0.001; t += minorStep) {
      const clamped = Math.min(t, duration);
      const pct = (clamped / duration) * 100;
      const isMajor = Math.abs(clamped % majorStep) < 0.001 || clamped === 0 || Math.abs(clamped - duration) < 0.001;
      const tick = document.createElement('div');
      tick.className = `ruler-tick${isMajor ? ' major' : ''}`;
      tick.style.left = `${pct}%`;

      const mark = document.createElement('div');
      mark.className = 'tick-mark';
      tick.appendChild(mark);

      if (isMajor) {
        const label = document.createElement('div');
        label.className = 'tick-label';
        const m = Math.floor(clamped / 60);
        const s = Math.floor(clamped % 60);
        label.textContent = `${m}:${String(s).padStart(2, '0')}`;
        tick.appendChild(label);
      }

      editorRuler.appendChild(tick);
      if (clamped >= duration) break;
    }
  }

  async function generateFilmstrip() {
    if (!state.videoLoaded || !editorFilmstrip || state.duration <= 0) return;
    const loadToken = state.videoLoadToken;

    editorFilmstrip.innerHTML = '';
    state.filmstripReady = false;

    const thumbCount = 12;
    const wasPaused = video.paused;
    const restoreTime = video.currentTime;
    video.pause();

    const thumbW = 80;
    const thumbH = 56;
    const canvas = document.createElement('canvas');
    canvas.width = thumbW;
    canvas.height = thumbH;
    const ctx = canvas.getContext('2d');

    const frames = [];
    for (let i = 0; i < thumbCount; i++) {
      const t = (i / Math.max(1, thumbCount - 1)) * state.duration;
      await seekVideoAsync(video, t);
      if (loadToken !== state.videoLoadToken) return;
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, thumbW, thumbH);

      // Cover-fit draw
      const vw = state.videoWidth;
      const vh = state.videoHeight;
      const scale = Math.max(thumbW / vw, thumbH / vh);
      const dw = vw * scale;
      const dh = vh * scale;
      const dx = (thumbW - dw) / 2;
      const dy = (thumbH - dh) / 2;
      ctx.drawImage(video, dx, dy, dw, dh);

      const img = document.createElement('img');
      img.src = canvas.toDataURL('image/jpeg', 0.72);
      img.draggable = false;
      img.alt = `frame ${i}`;
      frames.push(img);
    }

    // Stretch filmstrip to fill clip: duplicate/tile images with flex
    editorFilmstrip.innerHTML = '';
    frames.forEach((img) => {
      img.style.flex = '1 1 0';
      img.style.width = '0';
      img.style.minWidth = '0';
      img.style.objectFit = 'cover';
      editorFilmstrip.appendChild(img);
    });

    state.filmstripFrames = frames;
    state.filmstripReady = true;

    await seekVideoAsync(video, restoreTime);
    if (loadToken !== state.videoLoadToken) return;
    if (!wasPaused) {
      // keep paused after filmstrip build so user controls playback
    }
    updateTrimUI();
  }

  function timeFromTrackClientX(clientX) {
    if (!editorTrack || !state.duration) return 0;
    const rect = editorTrack.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return pct * state.duration;
  }

  function applyTrimStart(val, seek = true) {
    const snapped = U.snapTime(val, state.duration, { step: 0.1, playhead: video.currentTime, threshold: Math.max(0.04, state.duration / 150) });
    state.trimStart = U.clampTrimStart(snapped, state.trimEnd, state.duration, U.MIN_TRIM_DURATION);
    trimStartInput.value = state.trimStart.toFixed(2);
    if (seek) requestVideoSeek(state.trimStart);
    updateTrimUI();
    if (!state.timelineDrag) autoComputeFPS();
  }

  function applyTrimEnd(val, seek = true) {
    const snapped = U.snapTime(val, state.duration, { step: 0.1, playhead: video.currentTime, threshold: Math.max(0.04, state.duration / 150) });
    state.trimEnd = U.clampTrimEnd(state.trimStart, snapped, state.duration, U.MIN_TRIM_DURATION);
    trimEndInput.value = state.trimEnd.toFixed(2);
    if (seek) requestVideoSeek(state.trimEnd);
    updateTrimUI();
    if (!state.timelineDrag) autoComputeFPS();
  }

  trimStartInput.addEventListener('change', () => {
    let val = parseFloat(trimStartInput.value) || 0;
    applyTrimStart(val, true);
    saveClipStateDebounced();
  });

  trimEndInput.addEventListener('change', () => {
    const parsed = parseFloat(trimEndInput.value);
    const val = Number.isFinite(parsed) ? parsed : state.duration;
    applyTrimEnd(val, true);
    saveClipStateDebounced();
  });

  btnSetTrimStart.addEventListener('click', () => {
    if (!state.videoLoaded) return;
    const cur = video.currentTime;
    if (cur < state.trimEnd - U.MIN_TRIM_DURATION) {
      applyTrimStart(cur, false);
      saveClipStateDebounced();
      showToast(`Trim Start set to ${cur.toFixed(2)}s`, 'info');
    }
  });

  btnSetTrimEnd.addEventListener('click', () => {
    if (!state.videoLoaded) return;
    const cur = video.currentTime;
    if (cur > state.trimStart + U.MIN_TRIM_DURATION) {
      applyTrimEnd(cur, false);
      saveClipStateDebounced();
      showToast(`Trim End set to ${cur.toFixed(2)}s`, 'info');
    }
  });

  btnResetTrim.addEventListener('click', () => {
    if (!state.videoLoaded) return;
    ({ start: state.trimStart, end: state.trimEnd } = U.clampTrimRange(0, state.duration, state.duration));
    trimStartInput.value = (0).toFixed(2);
    trimEndInput.value = state.duration.toFixed(2);
    updateTrimUI();
    autoComputeFPS();
    saveClipStateDebounced();
    showToast('Trim reset to full video', 'info');
  });

  // Legacy click scrubber (hidden)
  if (trimTimeline) {
    trimTimeline.addEventListener('click', (e) => {
      if (!state.duration) return;
      const rect = trimTimeline.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const pct = Math.max(0, Math.min(1, clickX / rect.width));
      video.currentTime = pct * state.duration;
    });
  }

  // --- Pointer-based trim interaction (mouse, pen and touch) ---
  let trimRaf = 0;
  let pendingTimelineEvent = null;
  function requestVideoSeek(time) {
    const target = Math.max(0, Math.min(state.duration || 0, Number(time) || 0));
    if (Math.abs((video.currentTime || 0) - target) < 0.005) return;
    video.currentTime = target;
  }
  function beginTimelineDrag(mode, event) {
    if (!state.videoLoaded || !state.duration) return;
    event.preventDefault(); event.stopPropagation();
    state.timelineDrag = mode;
    state.timelinePointerId = event.pointerId;
    if (mode === 'left' || mode === 'right') {
      const handle = mode === 'left' ? trimHandleLeft : trimHandleRight;
      handle.classList.add('dragging'); handle.setPointerCapture?.(event.pointerId);
      handle.querySelector('.trim-handle-tooltip').classList.add('visible');
    }
    if (mode === 'clip-pending') editorClip.setPointerCapture?.(event.pointerId);
    video.pause(); updateVideoPlayPauseBtn();
  }
  function queueTimelineEvent(event) {
    if (event.pointerId !== state.timelinePointerId) return;
    pendingTimelineEvent = event;
    if (!trimRaf) trimRaf = requestAnimationFrame(processTimelineEvent);
  }
  function processTimelineEvent() {
    trimRaf = 0;
    const event = pendingTimelineEvent; pendingTimelineEvent = null;
    if (!event || !state.timelineDrag || !state.duration) return;
    const t = timeFromTrackClientX(event.clientX);
    if (state.timelineDrag === 'left') { applyTrimStart(t, true); }
    else if (state.timelineDrag === 'right') { applyTrimEnd(t, true); }
    else if (state.timelineDrag === 'playhead') { requestVideoSeek(t); updatePlayheadPosition(); updateVideoTimeDisplay(); }
    else if (state.timelineDrag === 'clip-pending' || state.timelineDrag === 'move') {
      const ptr = state._clipPointer; if (!ptr) return;
      const dx = event.clientX - ptr.startX;
      if (state.timelineDrag === 'clip-pending' && Math.abs(dx) < 4) return;
      state.timelineDrag = 'move';
      const dt = (dx / editorTrack.getBoundingClientRect().width) * state.duration;
      const range = U.shiftTrimRange(ptr.trimStart, ptr.trimEnd, dt, state.duration);
      state.trimStart = range.start; state.trimEnd = range.end;
      trimStartInput.value = range.start.toFixed(2); trimEndInput.value = range.end.toFixed(2);
      updateTrimUI(); ptr.moved = true;
    }
  }
  function finishTimelineDrag(event) {
    if (!state.timelineDrag) return;
    if (event?.pointerId != null && event.pointerId !== state.timelinePointerId) return;
    if (pendingTimelineEvent) processTimelineEvent();
    const mode = state.timelineDrag; state.timelineDrag = null;
    trimHandleLeft.classList.remove('dragging'); trimHandleRight.classList.remove('dragging');
    trimHandleLeft.querySelector('.trim-handle-tooltip').classList.remove('visible');
    trimHandleRight.querySelector('.trim-handle-tooltip').classList.remove('visible');
    if (mode === 'clip-pending' && state._clipPointer && !state._clipPointer.moved && Number.isFinite(event?.clientX)) {
      requestVideoSeek(Math.max(state.trimStart, Math.min(state.trimEnd, timeFromTrackClientX(event.clientX))));
      updatePlayheadPosition(); updateVideoTimeDisplay();
    }
    state.timelinePointerId = null;
    autoComputeFPS(); saveClipStateDebounced(); state._clipPointer = null;
  }
  [trimHandleLeft, trimHandleRight].forEach((handle, index) => {
    handle.addEventListener('pointerdown', (event) => beginTimelineDrag(index ? 'right' : 'left', event));
    handle.addEventListener('pointermove', (event) => { if (state.timelineDrag) queueTimelineEvent(event); });
    handle.addEventListener('pointerup', finishTimelineDrag);
    handle.addEventListener('pointercancel', finishTimelineDrag);
    handle.addEventListener('keydown', (event) => {
      if (!state.videoLoaded) return;
      const delta = event.key === 'ArrowLeft' ? -0.1 : event.key === 'ArrowRight' ? 0.1 : 0;
      if (!delta) return; event.preventDefault();
      if (index) applyTrimEnd(state.trimEnd + delta, false); else applyTrimStart(state.trimStart + delta, false);
      saveClipStateDebounced();
    });
  });
  editorClip.addEventListener('pointerdown', (event) => {
    if (event.target.closest('.clip-handle') || !state.videoLoaded) return;
    state._clipPointer = { startX: event.clientX, moved: false, trimStart: state.trimStart, trimEnd: state.trimEnd };
    beginTimelineDrag('clip-pending', event);
  });
  editorTrack.addEventListener('pointerdown', (event) => {
    if (event.target.closest('.clip-handle, .editor-clip, .clip-dim, .playhead-knob') || !state.videoLoaded) return;
    beginTimelineDrag('playhead', event); queueTimelineEvent(event);
  });
  [clipDimLeft, clipDimRight].forEach((el) => el?.addEventListener('pointerdown', (event) => {
    if (!state.videoLoaded) return; beginTimelineDrag('playhead', event); queueTimelineEvent(event);
  }));
  const playheadKnob = editorPlayhead?.querySelector('.playhead-knob');
  playheadKnob?.addEventListener('pointerdown', (event) => { beginTimelineDrag('playhead', event); });
  window.addEventListener('pointermove', (event) => { if (state.timelineDrag) queueTimelineEvent(event); });
  window.addEventListener('pointerup', finishTimelineDrag);
  window.addEventListener('pointercancel', finishTimelineDrag);
  window.addEventListener('blur', finishTimelineDrag);
  window.addEventListener('keydown', (event) => { if (event.key === 'Escape') finishTimelineDrag(event); });

  // --- Editor toolbar actions ---
  btnEditorPlay.addEventListener('click', () => {
    if (!state.videoLoaded) return;
    if (video.paused || video.ended) {
      // Loop within trim range
      if (video.currentTime < state.trimStart || video.currentTime >= state.trimEnd - 0.01) {
        video.currentTime = state.trimStart;
      }
      video.play();
    } else {
      video.pause();
    }
    updateVideoPlayPauseBtn();
  });

  btnEditorSkipBack.addEventListener('click', () => {
    if (!state.videoLoaded) return;
    video.pause();
    video.currentTime = Math.max(0, video.currentTime - 1);
    updateVideoPlayPauseBtn();
  });

  btnEditorSkipForward.addEventListener('click', () => {
    if (!state.videoLoaded) return;
    video.pause();
    video.currentTime = Math.min(state.duration, video.currentTime + 1);
    updateVideoPlayPauseBtn();
  });

  // Keep playback inside trim window
  video.addEventListener('timeupdate', () => {
    if (!state.videoLoaded || video.paused) return;
    if (video.currentTime >= state.trimEnd - 0.01) {
      video.pause();
      video.currentTime = state.trimEnd;
      updateVideoPlayPauseBtn();
    }
  });

  btnEditorMute.addEventListener('click', () => {
    state.isMuted = !state.isMuted;
    video.muted = state.isMuted;
    iconEditorMute.setAttribute('data-lucide', state.isMuted ? 'volume-x' : 'volume-2');
    btnEditorMute.classList.toggle('active', state.isMuted);
    lucide.createIcons({ root: btnEditorMute });
    showToast(state.isMuted ? 'Đã tắt tiếng' : 'Đã bật tiếng', 'info');
  });

  // Split at playhead: keep left segment (trimEnd = playhead)
  btnEditorSplit.addEventListener('click', () => {
    if (!state.videoLoaded) return;
    const cur = video.currentTime;
    if (cur <= state.trimStart + U.MIN_TRIM_DURATION || cur >= state.trimEnd - U.MIN_TRIM_DURATION) {
      showToast('Đặt playhead vào giữa đoạn cắt để Split', 'error');
      return;
    }
    // Save backup for "duplicate" restore of right half conceptually
    state.savedTrimBackup = { start: state.trimStart, end: state.trimEnd };
    applyTrimEnd(cur, false);
    saveClipStateDebounced();
    showToast(`Đã cắt tại ${cur.toFixed(2)}s — giữ đoạn bên trái`, 'success');
  });

  // Duplicate: restore previous full range before last split, or flash current range
  btnEditorDuplicate.addEventListener('click', () => {
    if (!state.videoLoaded) return;
    if (state.savedTrimBackup) {
      // After a split, "duplicate" restores the right half as the new selection
      const mid = state.trimEnd;
      const rightEnd = state.savedTrimBackup.end;
      if (rightEnd - mid > U.MIN_TRIM_DURATION) {
        applyTrimStart(mid, false);
        applyTrimEnd(rightEnd, false);
        video.currentTime = mid;
        state.savedTrimBackup = null;
        saveClipStateDebounced();
        showToast('Đã chuyển sang đoạn bên phải (nhân bản sau khi cắt)', 'success');
        return;
      }
    }
    // Otherwise: re-select current trim (visual feedback)
    editorClip.classList.remove('selected');
    void editorClip.offsetWidth;
    editorClip.classList.add('selected');
    showToast(`Đoạn cắt: ${state.trimStart.toFixed(2)}s → ${state.trimEnd.toFixed(2)}s`, 'info');
  });

  // Delete: reset trim to full video
  btnEditorDelete.addEventListener('click', () => {
    if (!state.videoLoaded) return;
    ({ start: state.trimStart, end: state.trimEnd } = U.clampTrimRange(0, state.duration, state.duration));
    trimStartInput.value = (0).toFixed(2);
    trimEndInput.value = state.duration.toFixed(2);
    state.savedTrimBackup = null;
    updateTrimUI();
    autoComputeFPS();
    saveClipStateDebounced();
    showToast('Đã xóa đoạn cắt — reset về full video', 'info');
  });

  window.addEventListener('resize', () => {
    renderRuler();
  });

  function autoComputeFPS({ force = false } = {}) {
    if (!force && state.previewFpsIsManual) {
      updateSpeedEffectiveHint();
      return;
    }
    inputFps.value = DEFAULT_AUTO_FPS;
    state.previewFpsIsManual = false;
    updateSpeedEffectiveHint();
  }

  function updateSpeedEffectiveHint() {
    if (!speedEffectiveHint) return;
    if (!state.videoLoaded) {
      speedEffectiveHint.textContent = 'Eff. 0.00s';
      return;
    }
    const sourceDuration = Math.max(0, state.trimEnd - state.trimStart);
    const speed = Math.max(0.1, state.playbackSpeed || 1);
    const effective = U.effectiveDuration(state.trimStart, state.trimEnd, speed);
    speedEffectiveHint.textContent = `Eff. ${effective.toFixed(2)}s @ ${formatSpeedLabel(speed)}`;
    speedEffectiveHint.title = `Độ dài phát thực tế sau Speed: ${sourceDuration.toFixed(2)}s ÷ ${formatSpeedLabel(speed)} = ${effective.toFixed(2)}s`;
  }

  function formatSpeedLabel(speed) { return U.formatSpeed(speed); }

  function setPlaybackSpeed(rawSpeed, { toast = false, syncInputs = true, persist = true } = {}) {
    let speed = parseFloat(rawSpeed);
    if (!Number.isFinite(speed)) speed = 1;
    speed = Math.max(U.MIN_SPEED, Math.min(U.MAX_SPEED, speed));
    // Snap near-integers for cleaner display (e.g. 1.0001 → 1)
    if (Math.abs(speed - Math.round(speed)) < 0.001) speed = Math.round(speed);

    state.playbackSpeed = speed;
    video.playbackRate = speed;

    if (syncInputs) {
      if (inputSpeedCustom) inputSpeedCustom.value = String(parseFloat(speed.toFixed(2)));
      if (inputSpeedCustomSettings) inputSpeedCustomSettings.value = String(parseFloat(speed.toFixed(2)));
    }
    if (lblSpeedSettings) lblSpeedSettings.textContent = formatSpeedLabel(speed);

    // Highlight matching preset (tolerance 0.001)
    if (speedPresets) {
      speedPresets.querySelectorAll('.speed-preset-btn').forEach((btn) => {
        const btnSpeed = parseFloat(btn.dataset.speed);
        btn.classList.toggle('active', Math.abs(btnSpeed - speed) < 0.001);
      });
    }

    autoComputeFPS();

    // If sprite preview is already playing, restart with new Auto FPS
    if (state.isPlaying && state.generatedFrames.length > 0) {
      startAnimationPreview();
    }

    if (toast) {
      showToast(`Speed: ${formatSpeedLabel(speed)}`, 'info');
    }
    if (persist) saveClipStateDebounced();
  }

  // Speed preset buttons
  if (speedPresets) {
    speedPresets.querySelectorAll('.speed-preset-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        setPlaybackSpeed(btn.dataset.speed, { toast: true });
      });
    });
  }

  function onSpeedInputChange(el) {
    if (!el) return;
    const apply = () => setPlaybackSpeed(el.value, { toast: true });
    el.addEventListener('change', apply);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        apply();
        el.blur();
      }
    });
  }
  onSpeedInputChange(inputSpeedCustom);
  onSpeedInputChange(inputSpeedCustomSettings);
  btnResetSpeed?.addEventListener('click', () => setPlaybackSpeed(1, { toast: true }));

  // Keep settings field live-synced while typing (without toast spam)
  if (inputSpeedCustom) {
    inputSpeedCustom.addEventListener('input', () => {
      const v = parseFloat(inputSpeedCustom.value);
      if (!Number.isFinite(v)) return;
      if (inputSpeedCustomSettings) inputSpeedCustomSettings.value = inputSpeedCustom.value;
      if (lblSpeedSettings) lblSpeedSettings.textContent = formatSpeedLabel(Math.max(0.1, Math.min(16, v)));
    });
  }
  if (inputSpeedCustomSettings) {
    inputSpeedCustomSettings.addEventListener('input', () => {
      const v = parseFloat(inputSpeedCustomSettings.value);
      if (!Number.isFinite(v)) return;
      if (inputSpeedCustom) inputSpeedCustom.value = inputSpeedCustomSettings.value;
      if (lblSpeedSettings) lblSpeedSettings.textContent = formatSpeedLabel(Math.max(0.1, Math.min(16, v)));
    });
  }

  // Init default speed
  setPlaybackSpeed(1, { toast: false });

  btnAutoFps.addEventListener('click', () => {
    autoComputeFPS({ force: true });
    saveClipStateDebounced();
    showToast(`Auto FPS set to ${DEFAULT_AUTO_FPS} fps`, 'info');
  });

  // === EXACT VIDEO RENDER BOX CALCULATION ===
  // Calculates the exact pixel bounding box of the video frame inside <video> with object-fit: contain
  function getVideoRenderBox() {
    if (!state.videoLoaded || !state.videoWidth || !state.videoHeight) {
      return null;
    }

    const vRect = video.getBoundingClientRect();
    const pRect = videoViewport.getBoundingClientRect();

    if (vRect.width === 0 || vRect.height === 0) return null;

    const videoAspect = state.videoWidth / state.videoHeight;
    const elemAspect = vRect.width / vRect.height;

    let renderWidth, renderHeight, offsetLeft, offsetTop;

    if (elemAspect > videoAspect) {
      // Height constrained (pillarboxed: black bars on left & right)
      renderHeight = vRect.height;
      renderWidth = renderHeight * videoAspect;
      offsetTop = vRect.top;
      offsetLeft = vRect.left + (vRect.width - renderWidth) / 2;
    } else {
      // Width constrained (letterboxed: black bars on top & bottom)
      renderWidth = vRect.width;
      renderHeight = renderWidth / videoAspect;
      offsetLeft = vRect.left;
      offsetTop = vRect.top + (vRect.height - renderHeight) / 2;
    }

    return {
      parentLeft: offsetLeft - pRect.left,
      parentTop: offsetTop - pRect.top,
      screenLeft: offsetLeft,
      screenTop: offsetTop,
      width: renderWidth,
      height: renderHeight,
      scaleX: state.videoWidth / renderWidth,
      scaleY: state.videoHeight / renderHeight
    };
  }

  // === CROP OVERLAY ===
  function updateCropOverlay() {
    if (!state.videoLoaded) {
      cropOverlay.style.display = 'none';
      return;
    }

    const cTop = parseInt(inputCropTop.value, 10) || 0;
    const cBottom = parseInt(inputCropBottom.value, 10) || 0;
    const cLeft = parseInt(inputCropLeft.value, 10) || 0;
    const cRight = parseInt(inputCropRight.value, 10) || 0;

    if (cTop === 0 && cBottom === 0 && cLeft === 0 && cRight === 0) {
      cropOverlay.style.display = 'none';
      return;
    }

    const box = getVideoRenderBox();
    if (!box) {
      cropOverlay.style.display = 'none';
      return;
    }

    const left = box.parentLeft + (cLeft / box.scaleX);
    const top = box.parentTop + (cTop / box.scaleY);
    const width = (state.videoWidth - cLeft - cRight) / box.scaleX;
    const height = (state.videoHeight - cTop - cBottom) / box.scaleY;

    if (width > 0 && height > 0) {
      cropOverlay.style.display = 'block';
      cropOverlay.style.left = `${left}px`;
      cropOverlay.style.top = `${top}px`;
      cropOverlay.style.width = `${width}px`;
      cropOverlay.style.height = `${height}px`;
    } else {
      cropOverlay.style.display = 'none';
    }
  }

  [inputCropTop, inputCropBottom, inputCropLeft, inputCropRight].forEach((input) => {
    input.addEventListener('input', updateCropOverlay);
  });
  window.addEventListener('resize', updateCropOverlay);

  // === EYEDROPPER & COLOR PICKING ===
  btnPickColor.addEventListener('click', () => {
    if (!state.videoLoaded) {
      showToast('Vui lòng tải video trước khi chọn màu', 'error');
      return;
    }
    if (state.isEyedropperActive) {
      deactivateEyedropper();
    } else {
      activateEyedropper();
    }
  });

  btnCancelEyedropper.addEventListener('click', deactivateEyedropper);
  if (btnCancelPreviewEyedropper) {
    btnCancelPreviewEyedropper.addEventListener('click', deactivateEyedropper);
  }

  if (btnResetEyedropperZoom) {
    btnResetEyedropperZoom.addEventListener('click', (e) => {
      e.stopPropagation();
      resetEyedropperZoom();
      showToast('Đã reset zoom về 100%', 'info');
    });
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.isEyedropperActive) {
      deactivateEyedropper();
    }
  });

  function applyEyedropperVideoTransform() {
    const z = state.eyedropperZoom || 1;
    const x = state.eyedropperPanX || 0;
    const y = state.eyedropperPanY || 0;
    if (z <= 1.001 && Math.abs(x) < 0.5 && Math.abs(y) < 0.5) {
      video.style.transform = '';
    } else {
      video.style.transform = `translate(${x}px, ${y}px) scale(${z})`;
    }
    if (eyedropperZoomBadge) {
      eyedropperZoomBadge.textContent = `${Math.round(z * 100)}%`;
    }
    updateCropOverlay();
  }

  function resetEyedropperZoom() {
    state.eyedropperZoom = 1;
    state.eyedropperPanX = 0;
    state.eyedropperPanY = 0;
    applyEyedropperVideoTransform();
  }

  function clampEyedropperPan() {
    if (state.eyedropperZoom <= 1) {
      state.eyedropperPanX = 0;
      state.eyedropperPanY = 0;
      return;
    }
    const pRect = videoViewport.getBoundingClientRect();
    // Allow panning roughly within the scaled overflow
    const maxPanX = (pRect.width * (state.eyedropperZoom - 1)) / 2 + 40;
    const maxPanY = (pRect.height * (state.eyedropperZoom - 1)) / 2 + 40;
    state.eyedropperPanX = Math.max(-maxPanX, Math.min(maxPanX, state.eyedropperPanX));
    state.eyedropperPanY = Math.max(-maxPanY, Math.min(maxPanY, state.eyedropperPanY));
  }

  function activateEyedropper() {
    state.isEyedropperActive = true;
    state.wasPreviewPlaying = state.isPlaying;
    btnPickColor.classList.add('active');
    btnPickColor.innerHTML = `<i data-lucide="crosshair" style="width: 13px; height: 13px;"></i><span>Click Video / Preview</span>`;
    eyedropperBanner.classList.add('active');
    eyedropperOverlay.classList.add('active');
    videoViewport.classList.add('eyedropper-zooming');

    if (previewEyedropperBanner) previewEyedropperBanner.classList.add('active');
    if (previewEyedropperOverlay) previewEyedropperOverlay.classList.add('active');
    if (spriteViewport) spriteViewport.classList.add('eyedropper-zooming');

    // Pause video + sprite preview for steady pixel sampling
    video.pause();
    updateVideoPlayPauseBtn();
    if (state.isPlaying) stopAnimationPreview();
    applyEyedropperVideoTransform();

    showToast('Pick từ Source Video hoặc Preview · Cuộn để zoom · Click để lấy màu', 'info');
    lucide.createIcons({ root: btnPickColor });
    lucide.createIcons({ root: eyedropperBanner });
    if (previewEyedropperBanner) lucide.createIcons({ root: previewEyedropperBanner });
  }

  function deactivateEyedropper() {
    state.isEyedropperActive = false;
    state.eyedropperPointer = null;
    state.previewEyedropperPointer = null;
    btnPickColor.classList.remove('active');
    btnPickColor.innerHTML = `<i data-lucide="pipette" style="width: 13px; height: 13px;"></i><span>Pick Color from Video / Preview</span>`;
    eyedropperBanner.classList.remove('active');
    eyedropperOverlay.classList.remove('active');
    eyedropperLoupe.style.display = 'none';
    videoViewport.classList.remove('eyedropper-zooming', 'eyedropper-panning');

    if (previewEyedropperBanner) previewEyedropperBanner.classList.remove('active');
    if (previewEyedropperOverlay) previewEyedropperOverlay.classList.remove('active');
    if (previewEyedropperLoupe) previewEyedropperLoupe.style.display = 'none';
    if (spriteViewport) spriteViewport.classList.remove('eyedropper-zooming');

    resetEyedropperZoom();
    lucide.createIcons({ root: btnPickColor });
  }

  // Wheel zoom toward cursor while eyedropper is active
  eyedropperOverlay.addEventListener('wheel', (e) => {
    if (!state.isEyedropperActive || !state.videoLoaded) return;
    e.preventDefault();
    e.stopPropagation();

    const pRect = videoViewport.getBoundingClientRect();
    const mx = e.clientX - pRect.left - pRect.width / 2;
    const my = e.clientY - pRect.top - pRect.height / 2;

    const oldZoom = state.eyedropperZoom || 1;
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const newZoom = Math.max(1, Math.min(8, oldZoom * factor));

    if (Math.abs(newZoom - oldZoom) < 0.001) return;

    // Keep the point under the cursor stable while zooming
    const contentX = (mx - state.eyedropperPanX) / oldZoom;
    const contentY = (my - state.eyedropperPanY) / oldZoom;
    state.eyedropperZoom = newZoom;
    state.eyedropperPanX = mx - contentX * newZoom;
    state.eyedropperPanY = my - contentY * newZoom;
    clampEyedropperPan();
    applyEyedropperVideoTransform();

    // Refresh loupe sampling after zoom if mouse is over video
    if (state.eyedropperLastMouse) {
      updateEyedropperLoupe(state.eyedropperLastMouse.clientX, state.eyedropperLastMouse.clientY);
    }
  }, { passive: false });

  // Eyedropper sampling canvas
  const sampleCanvas = document.createElement('canvas');
  const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });
  const loupeCtx = eyedropperCanvas.getContext('2d');

  function updateEyedropperLoupe(clientX, clientY) {
    if (!state.isEyedropperActive || !state.videoLoaded) return;

    const box = getVideoRenderBox();
    if (!box) return;

    const pRect = videoViewport.getBoundingClientRect();

    // Check if mouse is within the actual rendered video frame
    if (
      clientX < box.screenLeft || clientX > box.screenLeft + box.width ||
      clientY < box.screenTop || clientY > box.screenTop + box.height
    ) {
      eyedropperLoupe.style.display = 'none';
      return;
    }

    eyedropperLoupe.style.display = 'block';

    // Position loupe offset from cursor and clamp within viewport bounds
    let loupeX = clientX - pRect.left;
    let loupeY = clientY - pRect.top - 65;

    if (loupeY < 60) {
      loupeY = clientY - pRect.top + 65;
    }
    loupeX = Math.max(60, Math.min(pRect.width - 60, loupeX));

    eyedropperLoupe.style.left = `${loupeX}px`;
    eyedropperLoupe.style.top = `${loupeY}px`;

    // Map client coordinates to video native pixel coordinates accurately
    const px = Math.min(state.videoWidth - 1, Math.max(0, Math.floor((clientX - box.screenLeft) * box.scaleX)));
    const py = Math.min(state.videoHeight - 1, Math.max(0, Math.floor((clientY - box.screenTop) * box.scaleY)));

    if (sampleCanvas.width !== state.videoWidth || sampleCanvas.height !== state.videoHeight) {
      sampleCanvas.width = state.videoWidth;
      sampleCanvas.height = state.videoHeight;
    }
    sampleCtx.drawImage(video, 0, 0, state.videoWidth, state.videoHeight);

    // Zoomed loupe rendering (11x11 pixel window)
    const radius = 5;
    loupeCtx.imageSmoothingEnabled = false;
    loupeCtx.clearRect(0, 0, eyedropperCanvas.width, eyedropperCanvas.height);
    loupeCtx.drawImage(
      sampleCanvas,
      Math.max(0, px - radius),
      Math.max(0, py - radius),
      radius * 2 + 1,
      radius * 2 + 1,
      0, 0,
      eyedropperCanvas.width,
      eyedropperCanvas.height
    );

    const pixel = sampleCtx.getImageData(px, py, 1, 1).data;
    const hex = rgbToHex(pixel[0], pixel[1], pixel[2]);

    eyedropperHex.textContent = hex;
    eyedropperRgb.textContent = `rgb(${pixel[0]}, ${pixel[1]}, ${pixel[2]})`;
    eyedropperColorBadge.style.backgroundColor = hex;
  }

  eyedropperOverlay.addEventListener('mousemove', (e) => {
    if (!state.isEyedropperActive || !state.videoLoaded) return;

    state.eyedropperLastMouse = { clientX: e.clientX, clientY: e.clientY };
    if (previewEyedropperLoupe) previewEyedropperLoupe.style.display = 'none';

    // Pan while dragging
    if (state.eyedropperPointer) {
      const dx = e.clientX - state.eyedropperPointer.startX;
      const dy = e.clientY - state.eyedropperPointer.startY;
      if (!state.eyedropperPointer.moved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
        state.eyedropperPointer.moved = true;
        videoViewport.classList.add('eyedropper-panning');
        eyedropperLoupe.style.display = 'none';
      }
      if (state.eyedropperPointer.moved) {
        state.eyedropperPanX = state.eyedropperPointer.panX + dx;
        state.eyedropperPanY = state.eyedropperPointer.panY + dy;
        clampEyedropperPan();
        applyEyedropperVideoTransform();
        return;
      }
    }

    updateEyedropperLoupe(e.clientX, e.clientY);
  });

  eyedropperOverlay.addEventListener('mousedown', (e) => {
    if (!state.isEyedropperActive || !state.videoLoaded) return;
    if (e.button !== 0) return;
    // Allow pan when zoomed; also allow slight drag detection before pick
    state.eyedropperPointer = {
      startX: e.clientX,
      startY: e.clientY,
      panX: state.eyedropperPanX,
      panY: state.eyedropperPanY,
      moved: false
    };
  });

  window.addEventListener('mouseup', (e) => {
    if (!state.eyedropperPointer || !state.isEyedropperActive) return;
    const ptr = state.eyedropperPointer;
    state.eyedropperPointer = null;
    videoViewport.classList.remove('eyedropper-panning');

    // If user dragged → pan only; if click without drag → pick color
    if (ptr.moved) return;
    if (e.button !== 0) return;

    const box = getVideoRenderBox();
    if (!box) return;

    const clientX = e.clientX;
    const clientY = e.clientY;

    if (
      clientX < box.screenLeft || clientX > box.screenLeft + box.width ||
      clientY < box.screenTop || clientY > box.screenTop + box.height
    ) return;

    const px = Math.min(state.videoWidth - 1, Math.max(0, Math.floor((clientX - box.screenLeft) * box.scaleX)));
    const py = Math.min(state.videoHeight - 1, Math.max(0, Math.floor((clientY - box.screenTop) * box.scaleY)));

    if (sampleCanvas.width !== state.videoWidth || sampleCanvas.height !== state.videoHeight) {
      sampleCanvas.width = state.videoWidth;
      sampleCanvas.height = state.videoHeight;
    }
    sampleCtx.drawImage(video, 0, 0, state.videoWidth, state.videoHeight);

    const pixel = sampleCtx.getImageData(px, py, 1, 1).data;
    const hex = rgbToHex(pixel[0], pixel[1], pixel[2]);

    const added = addColor(pixel[0], pixel[1], pixel[2], hex);
    deactivateEyedropper();
    showToast(added ? `Đã nhận diện & thêm màu nền: ${hex}` : `Màu ${hex} đã có trong danh sách`, added ? 'success' : 'info');
  });

  // Prevent legacy click handler from double-firing — handled via mouseup above
  eyedropperOverlay.addEventListener('click', (e) => {
    if (!state.isEyedropperActive) return;
    e.preventDefault();
    e.stopPropagation();
  });

  // === PREVIEW EYEDROPPER (pick color from sprite preview canvas) ===
  const previewLoupeCtx = previewEyedropperCanvas
    ? previewEyedropperCanvas.getContext('2d')
    : null;

  function getPreviewCanvasPixel(clientX, clientY) {
    if (!previewCanvas || previewCanvas.width < 1 || previewCanvas.height < 1) {
      return null;
    }
    const rect = previewCanvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;

    if (
      clientX < rect.left || clientX > rect.right ||
      clientY < rect.top || clientY > rect.bottom
    ) {
      return null;
    }

    const px = Math.min(
      previewCanvas.width - 1,
      Math.max(0, Math.floor(((clientX - rect.left) / rect.width) * previewCanvas.width))
    );
    const py = Math.min(
      previewCanvas.height - 1,
      Math.max(0, Math.floor(((clientY - rect.top) / rect.height) * previewCanvas.height))
    );

    return { px, py, rect };
  }

  function updatePreviewEyedropperLoupe(clientX, clientY) {
    if (!state.isEyedropperActive || !previewEyedropperLoupe || !previewLoupeCtx) return;

    // Need generated content to sample meaningfully
    if (!state.fullSheetCanvas && state.generatedFrames.length === 0) {
      previewEyedropperLoupe.style.display = 'none';
      return;
    }

    const hit = getPreviewCanvasPixel(clientX, clientY);
    if (!hit) {
      previewEyedropperLoupe.style.display = 'none';
      return;
    }

    const { px, py } = hit;
    const pRect = spriteViewport.getBoundingClientRect();

    previewEyedropperLoupe.style.display = 'block';
    let loupeX = clientX - pRect.left;
    let loupeY = clientY - pRect.top - 65;
    if (loupeY < 60) loupeY = clientY - pRect.top + 65;
    loupeX = Math.max(60, Math.min(pRect.width - 60, loupeX));
    previewEyedropperLoupe.style.left = `${loupeX}px`;
    previewEyedropperLoupe.style.top = `${loupeY}px`;

    const ctx = previewCanvas.getContext('2d', { willReadFrequently: true });
    const radius = 5;
    previewLoupeCtx.imageSmoothingEnabled = false;
    previewLoupeCtx.clearRect(0, 0, previewEyedropperCanvas.width, previewEyedropperCanvas.height);
    previewLoupeCtx.drawImage(
      previewCanvas,
      Math.max(0, px - radius),
      Math.max(0, py - radius),
      radius * 2 + 1,
      radius * 2 + 1,
      0, 0,
      previewEyedropperCanvas.width,
      previewEyedropperCanvas.height
    );

    const pixel = ctx.getImageData(px, py, 1, 1).data;
    const hex = rgbToHex(pixel[0], pixel[1], pixel[2]);
    previewEyedropperHex.textContent = hex;
    previewEyedropperRgb.textContent = pixel[3] < 10
      ? `rgba(${pixel[0]},${pixel[1]},${pixel[2]},0)`
      : `rgb(${pixel[0]}, ${pixel[1]}, ${pixel[2]})`;
    previewEyedropperColorBadge.style.backgroundColor = hex;
    previewEyedropperColorBadge.style.opacity = pixel[3] < 10 ? '0.35' : '1';
  }

  function pickColorFromPreview(clientX, clientY) {
    if (!state.fullSheetCanvas && state.generatedFrames.length === 0) {
      showToast('Hãy Generate sprite sheet trước để pick màu từ Preview', 'error');
      return false;
    }

    const hit = getPreviewCanvasPixel(clientX, clientY);
    if (!hit) return false;

    const ctx = previewCanvas.getContext('2d', { willReadFrequently: true });
    const pixel = ctx.getImageData(hit.px, hit.py, 1, 1).data;

    if (pixel[3] < 10) {
      showToast('Pixel trong suốt — hãy chọn vùng còn màu nền', 'error');
      return false;
    }

    const hex = rgbToHex(pixel[0], pixel[1], pixel[2]);
    const added = addColor(pixel[0], pixel[1], pixel[2], hex);
    deactivateEyedropper();
    showToast(added ? `Đã pick từ Preview: ${hex}` : `Màu ${hex} đã có trong danh sách`, added ? 'success' : 'info');
    return true;
  }

  if (previewEyedropperOverlay) {
    previewEyedropperOverlay.addEventListener('mousemove', (e) => {
      if (!state.isEyedropperActive) return;
      state.previewEyedropperLastMouse = { clientX: e.clientX, clientY: e.clientY };

      if (state.previewEyedropperPointer) {
        const dx = e.clientX - state.previewEyedropperPointer.startX;
        const dy = e.clientY - state.previewEyedropperPointer.startY;
        if (!state.previewEyedropperPointer.moved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
          state.previewEyedropperPointer.moved = true;
          if (previewEyedropperLoupe) previewEyedropperLoupe.style.display = 'none';
        }
        if (state.previewEyedropperPointer.moved) {
          state.panX = state.previewEyedropperPointer.panX + dx;
          state.panY = state.previewEyedropperPointer.panY + dy;
          applyTransform();
          return;
        }
      }

      // Hide video loupe when hovering preview
      eyedropperLoupe.style.display = 'none';
      updatePreviewEyedropperLoupe(e.clientX, e.clientY);
    });

    previewEyedropperOverlay.addEventListener('mousedown', (e) => {
      if (!state.isEyedropperActive) return;
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      state.previewEyedropperPointer = {
        startX: e.clientX,
        startY: e.clientY,
        panX: state.panX,
        panY: state.panY,
        moved: false
      };
    });

    previewEyedropperOverlay.addEventListener('wheel', (e) => {
      if (!state.isEyedropperActive) return;
      e.preventDefault();
      e.stopPropagation();
      const zoomFactor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      state.zoom = Math.max(0.1, Math.min(8.0, state.zoom * zoomFactor));
      applyTransform();
      if (state.previewEyedropperLastMouse) {
        updatePreviewEyedropperLoupe(
          state.previewEyedropperLastMouse.clientX,
          state.previewEyedropperLastMouse.clientY
        );
      }
    }, { passive: false });

    previewEyedropperOverlay.addEventListener('click', (e) => {
      if (!state.isEyedropperActive) return;
      e.preventDefault();
      e.stopPropagation();
    });
  }

  window.addEventListener('mouseup', (e) => {
    if (!state.previewEyedropperPointer || !state.isEyedropperActive) return;
    const ptr = state.previewEyedropperPointer;
    state.previewEyedropperPointer = null;
    if (ptr.moved) return;
    if (e.button !== 0) return;
    pickColorFromPreview(e.clientX, e.clientY);
  });

  function rgbToHex(r, g, b) {
    return `#${[r, g, b].map((channel) => Number(channel).toString(16).padStart(2, '0')).join('')}`;
  }

  function hexToRgb(hex) {
    return U.normalizeColor(hex);
  }

  function addColor(r, g, b, hex) {
    const normalized = U.normalizeColor(hex) || U.normalizeColor(`rgb(${r},${g},${b})`);
    if (!normalized) return false;
    const next = U.dedupeColor(state.keyColors, normalized);
    const added = next.length > state.keyColors.length;
    state.keyColors = next;
    if (added) {
      saveRecentColor(normalized); renderSwatches(); renderRecentColors(); saveClipStateDebounced();
    }
    return added;
  }

  btnAddManualColor.addEventListener('click', () => {
    const color = U.normalizeColor(inputColorHex?.dataset.lastEdited === 'rgb' ? inputColorRgb.value : (inputColorHex?.value || manualColorInput.value));
    if (!color) { if (colorInputError) colorInputError.textContent = 'Enter a valid HEX or RGB color.'; return; }
    if (colorInputError) colorInputError.textContent = '';
    manualColorInput.value = color.hex; inputColorHex.value = color.hex; inputColorRgb.value = `rgb(${color.r}, ${color.g}, ${color.b})`;
    const applied = applyColorValue(color.hex);
    if (applied) showToast(`Color ${color.hex} applied to Chroma Key`, 'info');
  });
  btnClearKeyColors?.addEventListener('click', () => {
    if (state.keyColors.length === 0) return;
    state.keyColors = [];
    state.activeColorIndex = null;
    renderSwatches();
    saveClipStateDebounced();
    showToast('All chroma-key colors cleared', 'info');
  });
  manualColorInput?.addEventListener('input', () => {
    const color = U.normalizeColor(manualColorInput.value);
    if (color && inputColorHex && inputColorRgb) {
      inputColorHex.dataset.lastEdited = 'hex';
      inputColorHex.value = color.hex;
      inputColorRgb.value = `rgb(${color.r}, ${color.g}, ${color.b})`;
    }
  });

  function applyColorValue(value) {
    const color = U.normalizeColor(value);
    if (!color) { if (colorInputError) colorInputError.textContent = 'Invalid color. Use #RGB, #RRGGBB or rgb(...).'; return null; }
    if (colorInputError) colorInputError.textContent = '';
    manualColorInput.value = color.hex; inputColorHex.value = color.hex; inputColorRgb.value = `rgb(${color.r}, ${color.g}, ${color.b})`;
    if (Number.isInteger(state.activeColorIndex) && state.keyColors[state.activeColorIndex]) {
      const duplicate = state.keyColors.some((item, index) => index !== state.activeColorIndex
        && Math.abs(item.r - color.r) + Math.abs(item.g - color.g) + Math.abs(item.b - color.b) < 10);
      if (duplicate) {
        if (colorInputError) colorInputError.textContent = 'This color is already in the chroma-key list.';
        return null;
      }
      state.keyColors[state.activeColorIndex] = color;
      state.activeColorIndex = null;
      renderSwatches(); saveRecentColor(color); renderRecentColors(); saveClipStateDebounced();
    } else if (!addColor(color.r, color.g, color.b, color.hex)) {
      if (colorInputError) colorInputError.textContent = 'This color is already in the chroma-key list.';
      return null;
    }
    return color;
  }
  inputColorHex?.addEventListener('input', () => { inputColorHex.dataset.lastEdited = 'hex'; });
  inputColorRgb?.addEventListener('input', () => { inputColorHex.dataset.lastEdited = 'rgb'; });
  btnApplyColorValue?.addEventListener('click', () => applyColorValue(inputColorHex.dataset.lastEdited === 'rgb' ? inputColorRgb.value : inputColorHex.value));
  inputColorHex?.addEventListener('keydown', (event) => { if (event.key === 'Enter') applyColorValue(inputColorHex.value); });
  inputColorRgb?.addEventListener('keydown', (event) => { if (event.key === 'Enter') applyColorValue(inputColorRgb.value); });
  btnCopyColor?.addEventListener('click', async () => {
    const value = inputColorHex.value || manualColorInput.value;
    try { await navigator.clipboard.writeText(value); showToast('Color copied', 'info'); } catch (_) { showToast(value, 'info'); }
  });
  btnPasteColor?.addEventListener('click', async () => {
    try { const value = await navigator.clipboard.readText(); applyColorValue(value); } catch (_) { showToast('Clipboard access unavailable', 'error'); }
  });

  function renderRecentColors() {
    if (!recentColorsList) return;
    recentColorsList.innerHTML = '';
    const stored = readJsonStorage(RECENT_COLORS_KEY, []);
    const colors = Array.isArray(stored) ? stored.map((item) => U.normalizeColor(item?.hex || '')).filter(Boolean) : [];
    colors.forEach((color) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'recent-color'; button.title = color.hex;
      button.tabIndex = 120 + recentColorsList.children.length;
      button.style.backgroundColor = color.hex; button.addEventListener('click', () => applyColorValue(color.hex)); recentColorsList.appendChild(button);
    });
  }

  function renderSwatches() {
    swatchesList.innerHTML = '';
    if (btnClearKeyColors) btnClearKeyColors.disabled = state.keyColors.length === 0;
    state.keyColors.forEach((color, index) => {
      const item = document.createElement('div');
      item.className = 'swatch-item';
      item.tabIndex = 100 + index;
      item.setAttribute('role', 'button');
      item.setAttribute('aria-label', `Select key color ${color.hex}`);
      item.innerHTML = `
        <span class="swatch-color-box" style="background-color: ${color.hex}"></span>
        <span>${color.hex}</span>
        <button class="swatch-remove" data-index="${index}" title="Remove color">&times;</button>
      `;
      swatchesList.appendChild(item);
      item.addEventListener('click', (event) => {
        if (event.target.closest('.swatch-remove')) return;
        state.activeColorIndex = index;
        inputColorHex.dataset.lastEdited = 'hex';
        if (inputColorHex && inputColorRgb) { inputColorHex.value = color.hex; inputColorRgb.value = `rgb(${color.r}, ${color.g}, ${color.b})`; }
        swatchesList.querySelectorAll('.swatch-item').forEach((node, nodeIndex) => node.classList.toggle('active', nodeIndex === index));
      });
    });

    // Attach remove handlers
    swatchesList.querySelectorAll('.swatch-remove').forEach((btn) => {
      btn.tabIndex = 110 + Number(btn.getAttribute('data-index'));
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.target.getAttribute('data-index'), 10);
        state.keyColors.splice(idx, 1);
        if (state.activeColorIndex === idx) state.activeColorIndex = null;
        else if (Number.isInteger(state.activeColorIndex) && state.activeColorIndex > idx) state.activeColorIndex -= 1;
        renderSwatches();
        saveClipStateDebounced();
      });
    });
  }

  function updateChromaSliderLabels() {
    lblSimilarityVal.textContent = parseFloat(sliderSimilarity.value).toFixed(2);
    lblBlendVal.textContent = parseFloat(sliderBlend.value).toFixed(2);
    lblSpillVal.textContent = parseFloat(sliderSpill.value).toFixed(2);
    lblSubjectProtectionVal.textContent = parseFloat(sliderSubjectProtection.value).toFixed(2);
  }

  // Sliders display and persist their exact values, including zero.
  sliderSimilarity.addEventListener('input', () => {
    updateChromaSliderLabels();
    saveClipStateDebounced();
  });
  sliderBlend.addEventListener('input', () => {
    updateChromaSliderLabels();
    saveClipStateDebounced();
  });
  sliderSpill.addEventListener('input', () => {
    updateChromaSliderLabels();
    saveClipStateDebounced();
  });
  sliderSubjectProtection.addEventListener('input', () => {
    updateChromaSliderLabels();
    saveClipStateDebounced();
  });

  // Format toggle
  selectFormat.addEventListener('change', updateFormatLabels);
  chkTransparentFormat.addEventListener('change', updateFormatLabels);

  function updateFormatLabels() {
    const fmt = selectFormat.value.toUpperCase();
    lblFormatName.textContent = `Transparent ${fmt}`;
    lblDownloadBtn.textContent = `Download ${fmt} + audio`;
    lblSpriteOnly.textContent = `Download Sprite Sheet (${fmt})`;
  }

  // Collapse / Expand
  btnToggleCollapse.addEventListener('click', () => {
    const isHidden = settingsBody.style.display === 'none';
    settingsBody.style.display = isHidden ? 'block' : 'none';
    btnToggleCollapse.setAttribute('aria-expanded', String(isHidden));
    lblCollapse.textContent = isHidden ? 'Collapse' : 'Expand';
    iconCollapse.setAttribute('data-lucide', isHidden ? 'chevron-up' : 'chevron-down');
    lucide.createIcons({ root: btnToggleCollapse });
  });

  // Toggle Background Checker / Dark
  btnToggleChecker.addEventListener('click', () => {
    spriteViewport.classList.toggle('checkerboard-bg');
    if (!spriteViewport.classList.contains('checkerboard-bg')) {
      spriteViewport.style.backgroundColor = '#05070a';
      if (inputPreviewBgColor) inputPreviewBgColor.value = '#05070a';
    } else {
      spriteViewport.style.backgroundColor = '';
      if (inputPreviewBgColor) inputPreviewBgColor.value = '#111827';
    }
  });

  inputPreviewBgColor?.addEventListener('input', () => {
    spriteViewport.classList.remove('checkerboard-bg');
    spriteViewport.style.backgroundColor = inputPreviewBgColor.value || '#111827';
  });

  // === SPRITE SHEET GENERATION ENGINE ===
  btnGenerate.addEventListener('click', async () => {
    if (!state.videoLoaded) {
      showToast('Please load a video first', 'error');
      return;
    }
    if (state.isGenerating) return;

    state.isGenerating = true;
    btnGenerate.disabled = true;
    btnGenerate.innerHTML = `<i data-lucide="loader" class="spin" style="width: 16px; height: 16px;"></i><span>Generating...</span>`;
    lucide.createIcons({ root: btnGenerate });

    progressBarContainer.style.display = 'block';
    progressBarFill.style.width = '0%';

    try {
      await generateSpriteSheet();
      showToast('Sprite Sheet generated successfully!', 'success');
      startAnimationPreview();
    } catch (err) {
      console.error(err);
      showToast(`Error generating sprite sheet: ${err.message}`, 'error');
    } finally {
      state.isGenerating = false;
      btnGenerate.disabled = false;
      btnGenerate.innerHTML = `<i data-lucide="settings" style="width: 16px; height: 16px;"></i><span>Generate</span>`;
      lucide.createIcons({ root: btnGenerate });
      setTimeout(() => {
        progressBarContainer.style.display = 'none';
      }, 1000);
    }
  });

  async function generateSpriteSheet() {
    const totalFrames = parseInt(inputFrames.value, 10) || 24;
    const cols = parseInt(inputCols.value, 10) || 6;
    let rows = parseInt(inputRows.value, 10) || Math.ceil(totalFrames / cols);
    if (rows * cols < totalFrames) {
      rows = Math.ceil(totalFrames / cols);
      inputRows.value = rows;
    }

    const cTop = parseInt(inputCropTop.value, 10) || 0;
    const cBottom = parseInt(inputCropBottom.value, 10) || 0;
    const cLeft = parseInt(inputCropLeft.value, 10) || 0;
    const cRight = parseInt(inputCropRight.value, 10) || 0;

    const cropW = Math.max(1, state.videoWidth - cLeft - cRight);
    const cropH = Math.max(1, state.videoHeight - cTop - cBottom);

    const keepSource = chkKeepSourceSize.checked;
    const cellNative = parseInt(inputCellNative.value, 10) || 512;

    let cellW, cellH;
    if (keepSource) {
      cellW = cropW;
      cellH = cropH;
    } else {
      cellW = cellNative;
      cellH = Math.round(cellNative * (cropH / cropW));
    }

    const sheetW = cellW * cols;
    const sheetH = cellH * rows;

    const sheetCanvas = document.createElement('canvas');
    sheetCanvas.width = sheetW;
    sheetCanvas.height = sheetH;
    const sheetCtx = sheetCanvas.getContext('2d');

    const frameCanvas = document.createElement('canvas');
    frameCanvas.width = cellW;
    frameCanvas.height = cellH;
    const frameCtx = frameCanvas.getContext('2d', { willReadFrequently: true });

    const similarity = U.clampNumber(sliderSimilarity.value, 0, 1, 0.55);
    const blend = U.clampNumber(sliderBlend.value, 0, 1, 0.18);
    const spill = U.clampNumber(sliderSpill.value, 0, 1, 0.55);
    const subjectProtection = U.clampNumber(sliderSubjectProtection.value, 0, 1, 0.50);

    state.generatedFrames = [];
    state.currentFrameIndex = 0;

    const startTime = state.trimStart;
    const endTime = state.trimEnd;
    const timeSpan = endTime - startTime;

    // Pause video during extraction
    video.pause();

    for (let i = 0; i < totalFrames; i++) {
      const targetTime = totalFrames > 1 ? startTime + (i / (totalFrames - 1)) * timeSpan : startTime;
      
      // Seek video to target frame time
      await seekVideoAsync(video, targetTime);

      // Draw cropped video frame
      frameCtx.clearRect(0, 0, cellW, cellH);
      frameCtx.drawImage(
        video,
        cLeft, cTop, cropW, cropH,
        0, 0, cellW, cellH
      );

      // Apply Background Removal Chroma Key Filter
      const imgData = frameCtx.getImageData(0, 0, cellW, cellH);
      applyChromaKey(imgData, {
        enabled: chkTransparentFormat.checked,
        similarity,
        blend,
        spill,
        subjectProtection,
        keyColors: state.keyColors
      });
      frameCtx.putImageData(imgData, 0, 0);

      // Store individual frame canvas for animation preview
      const singleFrameCopy = document.createElement('canvas');
      singleFrameCopy.width = cellW;
      singleFrameCopy.height = cellH;
      const singleCtx = singleFrameCopy.getContext('2d');
      singleCtx.drawImage(frameCanvas, 0, 0);
      state.generatedFrames.push(singleFrameCopy);

      // Draw into grand sprite sheet canvas
      const colIndex = i % cols;
      const rowIndex = Math.floor(i / cols);
      const destX = colIndex * cellW;
      const destY = rowIndex * cellH;

      sheetCtx.drawImage(frameCanvas, destX, destY);

      // Update progress
      const pct = Math.round(((i + 1) / totalFrames) * 100);
      progressBarFill.style.width = `${pct}%`;
    }

    state.fullSheetCanvas = sheetCanvas;
    updatePreviewViewport();
  }

  function seekVideoAsync(vid, time) {
    return new Promise((resolve) => {
      let resolved = false;
      const onSeeked = () => {
        if (!resolved) {
          resolved = true;
          vid.removeEventListener('seeked', onSeeked);
          resolve();
        }
      };
      vid.addEventListener('seeked', onSeeked);
      vid.currentTime = Math.min(time, state.duration);
      
      // Fallback timeout in case seeked doesn't fire immediately
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          vid.removeEventListener('seeked', onSeeked);
          resolve();
        }
      }, 200);
    });
  }

  // === SPRITE PREVIEW PLAYER & ANIMATION LOOP ===
  function startAnimationPreview() {
    stopAnimationPreview();
    state.isPlaying = true;
    updatePlayPauseButton();

    const fps = parseInt(inputFps.value, 10) || 12;
    const intervalMs = 1000 / fps;

    state.animationTimer = setInterval(() => {
      if (state.generatedFrames.length === 0) return;
      state.currentFrameIndex = (state.currentFrameIndex + 1) % state.generatedFrames.length;
      updatePreviewViewport();
    }, intervalMs);
  }

  function stopAnimationPreview() {
    state.isPlaying = false;
    if (state.animationTimer) {
      clearInterval(state.animationTimer);
      state.animationTimer = null;
    }
    updatePlayPauseButton();
  }

  function updatePlayPauseButton() {
    if (state.isPlaying) {
      btnPlayPause.classList.add('active');
      iconPlayPause.setAttribute('data-lucide', 'pause');
      textPlayPause.textContent = 'Pause';
    } else {
      btnPlayPause.classList.remove('active');
      iconPlayPause.setAttribute('data-lucide', 'play');
      textPlayPause.textContent = 'Play';
    }
    lucide.createIcons({ root: btnPlayPause });
  }

  btnPlayPause.addEventListener('click', () => {
    if (state.generatedFrames.length === 0) {
      showToast('Generate a sprite sheet first', 'info');
      return;
    }
    if (state.isPlaying) {
      stopAnimationPreview();
    } else {
      startAnimationPreview();
    }
  });

  btnToggleMode.addEventListener('click', () => {
    if (state.previewMode === 'play') {
      state.previewMode = 'sheet';
      btnToggleMode.classList.add('active');
      textToggleMode.textContent = 'Anim';
    } else {
      state.previewMode = 'play';
      btnToggleMode.classList.remove('active');
      textToggleMode.textContent = 'Sheet';
    }
    updatePreviewViewport();
  });

  inputFps.addEventListener('change', () => {
    const fps = Math.max(1, Math.min(60, parseInt(inputFps.value, 10) || DEFAULT_AUTO_FPS));
    inputFps.value = String(fps);
    state.previewFpsIsManual = fps !== DEFAULT_AUTO_FPS;
    if (state.isPlaying) {
      startAnimationPreview();
    }
    saveClipStateDebounced();
  });

  // Update viewport canvas render
  function updatePreviewViewport() {
    if (!state.fullSheetCanvas || state.generatedFrames.length === 0) {
      frameCounter.textContent = '0/0';
      return;
    }

    const total = state.generatedFrames.length;
    frameCounter.textContent = `${state.currentFrameIndex + 1}/${total}`;

    const ctx = previewCanvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    if (state.previewMode === 'play') {
      // Draw single animated cell
      const currentFrame = state.generatedFrames[state.currentFrameIndex];
      if (currentFrame) {
        previewCanvas.width = currentFrame.width;
        previewCanvas.height = currentFrame.height;
        ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
        ctx.drawImage(currentFrame, 0, 0);
      }
    } else {
      // Draw entire grand sheet
      previewCanvas.width = state.fullSheetCanvas.width;
      previewCanvas.height = state.fullSheetCanvas.height;
      ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
      ctx.drawImage(state.fullSheetCanvas, 0, 0);

      // Draw subtle grid lines
      const cols = parseInt(inputCols.value, 10) || 6;
      const rows = parseInt(inputRows.value, 10) || 4;
      const cellW = previewCanvas.width / cols;
      const cellH = previewCanvas.height / rows;

      ctx.strokeStyle = 'rgba(59, 130, 246, 0.4)';
      ctx.lineWidth = 1;
      for (let c = 0; c <= cols; c++) {
        ctx.beginPath();
        ctx.moveTo(c * cellW, 0);
        ctx.lineTo(c * cellW, previewCanvas.height);
        ctx.stroke();
      }
      for (let r = 0; r <= rows; r++) {
        ctx.beginPath();
        ctx.moveTo(0, r * cellH);
        ctx.lineTo(previewCanvas.width, r * cellH);
        ctx.stroke();
      }
    }

    applyTransform();
  }

  // === ZOOM & PAN CONTROLS ===
  function applyTransform() {
    previewCanvas.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
    zoomLevel.textContent = `${Math.round(state.zoom * 100)}%`;
  }

  btnZoomIn.addEventListener('click', () => {
    state.zoom = Math.min(5.0, state.zoom + 0.15);
    applyTransform();
  });

  btnZoomOut.addEventListener('click', () => {
    state.zoom = Math.max(0.1, state.zoom - 0.15);
    applyTransform();
  });

  btnZoomFit.addEventListener('click', () => {
    state.zoom = 1.0;
    state.panX = 0;
    state.panY = 0;
    applyTransform();
  });

  spriteViewport.addEventListener('wheel', (e) => {
    if (state.isEyedropperActive) return; // preview overlay handles zoom while picking
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    state.zoom = Math.max(0.1, Math.min(8.0, state.zoom * zoomFactor));
    applyTransform();
  }, { passive: false });

  // Pan canvas on mouse drag
  spriteViewport.addEventListener('mousedown', (e) => {
    if (state.isEyedropperActive) return; // preview eyedropper handles drag/pick
    state.isDragging = true;
    state.dragStartX = e.clientX - state.panX;
    state.dragStartY = e.clientY - state.panY;
  });

  window.addEventListener('mousemove', (e) => {
    if (!state.isDragging) return;
    state.panX = e.clientX - state.dragStartX;
    state.panY = e.clientY - state.dragStartY;
    applyTransform();
  });

  window.addEventListener('mouseup', () => {
    state.isDragging = false;
  });

  // === EXPORT & DOWNLOAD ACTIONS ===
  btnDownloadMain.addEventListener('click', (e) => {
    e.stopPropagation();
    downloadDropdownMenu.classList.toggle('show');
  });

  window.addEventListener('click', (e) => {
    if (!btnDownloadMain.contains(e.target) && !downloadDropdownMenu.contains(e.target)) {
      downloadDropdownMenu.classList.remove('show');
    }
  });

  // 1. Download Sprite Sheet Only
  btnDownloadSpriteOnly.addEventListener('click', () => {
    downloadDropdownMenu.classList.remove('show');
    downloadSpriteSheet();
  });

  // 2. Download Audio Only
  btnDownloadAudioOnly.addEventListener('click', () => {
    downloadDropdownMenu.classList.remove('show');
    downloadAudio();
  });

  // 3. Download Bundle (.zip)
  btnDownloadBundleZip.addEventListener('click', () => {
    downloadDropdownMenu.classList.remove('show');
    downloadBundle();
  });

  function downloadSpriteSheet() {
    if (!state.fullSheetCanvas) {
      showToast('Please generate the sprite sheet first', 'error');
      return;
    }

    const fmt = selectFormat.value.toLowerCase();
    const mime = fmt === 'webp' ? 'image/webp' : 'image/png';
    const ext = fmt === 'webp' ? 'webp' : 'png';
    const baseName = (inputDownloadName.value.trim() || 'spritesheet').replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `${baseName}.${ext}`;

    state.fullSheetCanvas.toBlob((blob) => {
      if (!blob) {
        showToast('Failed to create image blob', 'error');
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast(`Downloaded: ${filename}`, 'success');
    }, mime, 0.95);
  }

  async function downloadAudio() {
    if (!state.videoLoaded) {
      showToast('No video loaded', 'error');
      return;
    }

    const baseName = (inputDownloadName.value.trim() || 'audio').replace(/[^a-zA-Z0-9_-]/g, '_');
    showToast('Extracting audio track...', 'info');

    try {
      const formData = new FormData();
      if (state.currentVideoFile) {
        formData.append('video', state.currentVideoFile);
      } else {
        // Fetch source video blob if loaded from sample URL
        const res = await fetch(state.currentVideoUrl);
        const blob = await res.blob();
        formData.append('video', blob, 'video.mp4');
      }

      formData.append('startTime', state.trimStart.toString());
      formData.append('endTime', state.trimEnd.toString());
      formData.append('playbackSpeed', String(state.playbackSpeed || 1));
      formData.append('downloadName', baseName);

      const resp = await fetch('/api/extract-audio', {
        method: 'POST',
        body: formData
      });

      if (!resp.ok) {
        const errJson = await resp.json().catch(() => ({}));
        throw new Error(errJson.error || 'Failed to extract audio');
      }

      const audioBlob = await resp.blob();
      const url = URL.createObjectURL(audioBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${baseName}.mp3`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast(`Audio downloaded: ${baseName}.mp3`, 'success');
    } catch (err) {
      console.error(err);
      showToast(`Audio extraction failed: ${err.message}`, 'error');
    }
  }

  async function downloadBundle() {
    if (!state.fullSheetCanvas) {
      showToast('Please generate sprite sheet before downloading bundle', 'error');
      return;
    }

    const fmt = selectFormat.value.toLowerCase();
    const mime = fmt === 'webp' ? 'image/webp' : 'image/png';
    const baseName = (inputDownloadName.value.trim() || 'spritesheet').replace(/[^a-zA-Z0-9_-]/g, '_');
    
    showToast('Preparing ZIP package (Sprite Sheet + MP3)...', 'info');

    try {
      const dataUrl = state.fullSheetCanvas.toDataURL(mime, 0.95);
      const formData = new FormData();
      
      if (state.currentVideoFile) {
        formData.append('video', state.currentVideoFile);
      } else {
        const res = await fetch(state.currentVideoUrl);
        const blob = await res.blob();
        formData.append('video', blob, 'video.mp4');
      }

      formData.append('spriteDataUrl', dataUrl);
      formData.append('spriteFormat', fmt);
      formData.append('downloadName', baseName);
      formData.append('startTime', state.trimStart.toString());
      formData.append('endTime', state.trimEnd.toString());
      formData.append('playbackSpeed', String(state.playbackSpeed || 1));

      const resp = await fetch('/api/export-bundle', {
        method: 'POST',
        body: formData
      });

      if (!resp.ok) {
        throw new Error('Failed to create bundle archive');
      }

      const zipBlob = await resp.blob();
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${baseName}_bundle.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast(`Downloaded ZIP bundle: ${baseName}_bundle.zip`, 'success');
    } catch (err) {
      console.error(err);
      // Fallback: download sprite sheet and audio separately
      downloadSpriteSheet();
      downloadAudio();
    }
  }
});
