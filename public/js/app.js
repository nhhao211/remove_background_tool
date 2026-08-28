/**
 * Video to Sprite Sheet Studio & Background Remover
 */

import { EditorUtils as U } from './editor-utils.js';
import { runKeyer } from './keyer/index.js';
import { normalizeProtectionStrokes, rasterizeProtectionMask } from './protection-mask.js';
import { applyColorReplacement } from './color-replace.js';
import { detectSubjectBounds, calculateGuidelineShift, alignFrameCanvas, drawSubImageSafe } from './subject-alignment.js';
import {
  computeLoopTimestamps,
  computeFrameDistance,
  scanVideoForOptimalLoops,
  applyLoopCrossfade,
  createDiffHeatmapCanvas
} from './loop-optimizer.js';

document.addEventListener('DOMContentLoaded', () => {
  const DEFAULT_AUTO_FPS = 12;

  // === DOM ELEMENTS ===
  const video = document.getElementById('sourceVideo');
  const videoViewport = document.getElementById('videoViewport');
  const cropOverlay = document.getElementById('cropOverlay');
  const guidelineOverlay = document.getElementById('guidelineOverlay');
  const verticalGuideline = document.getElementById('verticalGuideline');
  const verticalGuidelineHandle = document.getElementById('verticalGuidelineHandle');
  const verticalGuidelineBadge = document.getElementById('verticalGuidelineBadge');
  const horizontalGuideline = document.getElementById('horizontalGuideline');
  const horizontalGuidelineHandle = document.getElementById('horizontalGuidelineHandle');
  const horizontalGuidelineBadge = document.getElementById('horizontalGuidelineBadge');
  const watermarkBanner = document.getElementById('watermarkBanner');
  const watermarkSelectOverlay = document.getElementById('watermarkSelectOverlay');
  const watermarkOverlay = document.getElementById('watermarkOverlay');
  const btnCancelWatermarkSelect = document.getElementById('btnCancelWatermarkSelect');
  const protectionBrushBanner = document.getElementById('protectionBrushBanner');
  const protectionBrushCanvas = document.getElementById('protectionBrushCanvas');
  const btnCancelProtectionBrush = document.getElementById('btnCancelProtectionBrush');
  const eyedropperLoupe = document.getElementById('eyedropperLoupe');
  const eyedropperCanvas = document.getElementById('eyedropperCanvas');
  const eyedropperColorBadge = document.getElementById('eyedropperColorBadge');
  const eyedropperHex = document.getElementById('eyedropperHex');
  const eyedropperRgb = document.getElementById('eyedropperRgb');
  const eyedropperCoord = document.getElementById('eyedropperCoord');
  const eyedropperBanner = document.getElementById('eyedropperBanner');
  const eyedropperBannerText = document.getElementById('eyedropperBannerText');
  const btnCancelEyedropper = document.getElementById('btnCancelEyedropper');
  const eyedropperOverlay = document.getElementById('eyedropperOverlay');
  const eyedropperZoomBadge = document.getElementById('eyedropperZoomBadge');
  const btnResetEyedropperZoom = document.getElementById('btnResetEyedropperZoom');
  const sourceVideoInfo = document.getElementById('sourceVideoInfo');

  // Preview eyedropper
  const previewEyedropperBanner = document.getElementById('previewEyedropperBanner');
  const previewEyedropperBannerText = document.getElementById('previewEyedropperBannerText');
  const previewEyedropperOverlay = document.getElementById('previewEyedropperOverlay');
  const previewEyedropperLoupe = document.getElementById('previewEyedropperLoupe');
  const previewEyedropperCanvas = document.getElementById('previewEyedropperCanvas');
  const previewEyedropperColorBadge = document.getElementById('previewEyedropperColorBadge');
  const previewEyedropperHex = document.getElementById('previewEyedropperHex');
  const previewEyedropperRgb = document.getElementById('previewEyedropperRgb');
  const previewEyedropperCoord = document.getElementById('previewEyedropperCoord');
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
  const btnMoveToCleaner = document.getElementById('btnMoveToCleaner');
  const btnPreviewMoveToCleaner = document.getElementById('btnPreviewMoveToCleaner');
  const btnDropdownMoveToCleaner = document.getElementById('btnDropdownMoveToCleaner');
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
  const cellSizeHint = document.getElementById('cellSizeHint');
  const inputCropTop = document.getElementById('inputCropTop');
  const inputCropBottom = document.getElementById('inputCropBottom');
  const inputCropLeft = document.getElementById('inputCropLeft');
  const inputCropRight = document.getElementById('inputCropRight');
  const btnSelectWatermark = document.getElementById('btnSelectWatermark');
  const btnClearWatermark = document.getElementById('btnClearWatermark');
  const watermarkStatus = document.getElementById('watermarkStatus');
  const groupSubjectAlignment = document.getElementById('groupSubjectAlignment');
  const headerSubjectAlignment = document.getElementById('headerSubjectAlignment');
  const bodySubjectAlignment = document.getElementById('bodySubjectAlignment');
  const lblCollapseSubjectAlignment = document.getElementById('lblCollapseSubjectAlignment');
  const iconCollapseSubjectAlignment = document.getElementById('iconCollapseSubjectAlignment');
  const guidelineStatus = document.getElementById('guidelineStatus');
  const chkEnableGuideline = document.getElementById('chkEnableGuideline');
  const guidelineControlsX = document.getElementById('guidelineControlsX');
  const inputGuidelineX = document.getElementById('inputGuidelineX');
  const selectGuidelineMode = document.getElementById('selectGuidelineMode');
  const chkEnableGuidelineY = document.getElementById('chkEnableGuidelineY');
  const guidelineControlsY = document.getElementById('guidelineControlsY');
  const inputGuidelineY = document.getElementById('inputGuidelineY');
  const selectGuidelineYMode = document.getElementById('selectGuidelineYMode');
  const btnGuidelineAutoDetect = document.getElementById('btnGuidelineAutoDetect');
  const btnGuidelineCenter = document.getElementById('btnGuidelineCenter');
  const btnGuidelineResetCrop = document.getElementById('btnGuidelineResetCrop');
  const chkShowGuidelineVideo = document.getElementById('chkShowGuidelineVideo');
  const chkGuidelinePreview = document.getElementById('chkGuidelinePreview');
  const inputDownloadName = document.getElementById('inputDownloadName');
  const sliderSimilarity = document.getElementById('sliderSimilarity');
  const numSimilarity = document.getElementById('numSimilarity');
  const lblSimilarityVal = document.getElementById('lblSimilarityVal');
  const sliderBlend = document.getElementById('sliderBlend');
  const numBlend = document.getElementById('numBlend');
  const lblBlendVal = document.getElementById('lblBlendVal');
  const sliderSpill = document.getElementById('sliderSpill');
  const numSpill = document.getElementById('numSpill');
  const lblSpillVal = document.getElementById('lblSpillVal');
  const sliderSubjectProtection = document.getElementById('sliderSubjectProtection');
  const numSubjectProtection = document.getElementById('numSubjectProtection');
  const lblSubjectProtectionVal = document.getElementById('lblSubjectProtectionVal');
  const sliderEdgeCleanup = document.getElementById('sliderEdgeCleanup');
  const numEdgeCleanup = document.getElementById('numEdgeCleanup');
  const lblEdgeCleanupVal = document.getElementById('lblEdgeCleanupVal');
  const headerProtectionBrush = document.getElementById('headerProtectionBrush');
  const bodyProtectionBrush = document.getElementById('bodyProtectionBrush');
  const lblCollapseProtectionBrush = document.getElementById('lblCollapseProtectionBrush');
  const iconCollapseProtectionBrush = document.getElementById('iconCollapseProtectionBrush');
  const btnProtectionBrush = document.getElementById('btnProtectionBrush');
  const btnProtectionEraser = document.getElementById('btnProtectionEraser');
  const btnProtectionUndo = document.getElementById('btnProtectionUndo');
  const btnProtectionRedo = document.getElementById('btnProtectionRedo');
  const btnProtectionClear = document.getElementById('btnProtectionClear');
  const chkShowProtectionMask = document.getElementById('chkShowProtectionMask');
  const sliderProtectionSize = document.getElementById('sliderProtectionSize');
  const numProtectionSize = document.getElementById('numProtectionSize');
  const lblProtectionSize = document.getElementById('lblProtectionSize');
  const sliderProtectionStrength = document.getElementById('sliderProtectionStrength');
  const numProtectionStrength = document.getElementById('numProtectionStrength');
  const lblProtectionStrength = document.getElementById('lblProtectionStrength');
  const sliderProtectionHardness = document.getElementById('sliderProtectionHardness');
  const numProtectionHardness = document.getElementById('numProtectionHardness');
  const lblProtectionHardness = document.getElementById('lblProtectionHardness');
  const selectProtectionPreset = document.getElementById('selectProtectionPreset');
  const protectionBrushStatus = document.getElementById('protectionBrushStatus');
  const headerColorReplace = document.getElementById('headerColorReplace');
  const bodyColorReplace = document.getElementById('bodyColorReplace');
  const lblCollapseColorReplace = document.getElementById('lblCollapseColorReplace');
  const iconCollapseColorReplace = document.getElementById('iconCollapseColorReplace');
  const chkEnableColorReplace = document.getElementById('chkEnableColorReplace');
  const inputColorReplaceSource = document.getElementById('inputColorReplaceSource');
  const btnPickColorReplaceSource = document.getElementById('btnPickColorReplaceSource');
  const inputColorReplaceTarget = document.getElementById('inputColorReplaceTarget');
  const colorReplaceSummary = document.getElementById('colorReplaceSummary');
  const sliderColorReplaceTolerance = document.getElementById('sliderColorReplaceTolerance');
  const numColorReplaceTolerance = document.getElementById('numColorReplaceTolerance');
  const lblColorReplaceTolerance = document.getElementById('lblColorReplaceTolerance');
  const sliderColorReplaceStrength = document.getElementById('sliderColorReplaceStrength');
  const numColorReplaceStrength = document.getElementById('numColorReplaceStrength');
  const lblColorReplaceStrength = document.getElementById('lblColorReplaceStrength');
  const inputFps = document.getElementById('inputFps');
  const btnAutoFps = document.getElementById('btnAutoFps');
  const chkTransparentFormat = document.getElementById('chkTransparentFormat');
  const lblFormatName = document.getElementById('lblFormatName');
  const selectFormat = document.getElementById('selectFormat');

  // Loop Optimization & Seam Smoothing DOM Elements
  const headerLoopSettings = document.getElementById('headerLoopSettings');
  const bodyLoopSettings = document.getElementById('bodyLoopSettings');
  const lblCollapseLoopSettings = document.getElementById('lblCollapseLoopSettings');
  const iconCollapseLoopSettings = document.getElementById('iconCollapseLoopSettings');
  const loopStatusBadge = document.getElementById('loopStatusBadge');
  const chkClosedLoop = document.getElementById('chkClosedLoop');
  const sliderLoopCrossfade = document.getElementById('sliderLoopCrossfade');
  const numLoopCrossfade = document.getElementById('numLoopCrossfade');
  const lblLoopCrossfadeVal = document.getElementById('lblLoopCrossfadeVal');
  const chkPingPongLoop = document.getElementById('chkPingPongLoop');
  const btnAutoLoopFinder = document.getElementById('btnAutoLoopFinder');
  const btnOpenLoopModalFromSettings = document.getElementById('btnOpenLoopModalFromSettings');

  // Auto Loop Seeker & Seam Inspector Modal DOM Elements
  const modalLoopFinder = document.getElementById('modalLoopFinder');
  const btnCloseLoopModal = document.getElementById('btnCloseLoopModal');
  const selectLoopScope = document.getElementById('selectLoopScope');
  const selectLoopSpeed = document.getElementById('selectLoopSpeed');
  const inputLoopTargetFrames = document.getElementById('inputLoopTargetFrames');
  const selectLoopTargetFps = document.getElementById('selectLoopTargetFps');
  const lblLoopIdealDurationText = document.getElementById('lblLoopIdealDurationText');
  const btnStartLoopScan = document.getElementById('btnStartLoopScan');
  const lblStartLoopScan = document.getElementById('lblStartLoopScan');
  const loopScanProgressContainer = document.getElementById('loopScanProgressContainer');
  const loopScanProgressBar = document.getElementById('loopScanProgressBar');
  const loopScanStatusText = document.getElementById('loopScanStatusText');
  const loopCandidateCountBadge = document.getElementById('loopCandidateCountBadge');
  const loopCandidatesList = document.getElementById('loopCandidatesList');
  const loopSeamScoreBadge = document.getElementById('loopSeamScoreBadge');
  const seamStartCanvas = document.getElementById('seamStartCanvas');
  const seamEndCanvas = document.getElementById('seamEndCanvas');
  const seamDiffCanvas = document.getElementById('seamDiffCanvas');
  const seamLoopPlayerCanvas = document.getElementById('seamLoopPlayerCanvas');
  const seamFullCycleCanvas = document.getElementById('seamFullCycleCanvas');
  const lblFullCycleFrameBadge = document.getElementById('lblFullCycleFrameBadge');
  const btnToggleFullCyclePlay = document.getElementById('btnToggleFullCyclePlay');
  const iconFullCyclePlay = document.getElementById('iconFullCyclePlay');
  const lblFullCyclePlay = document.getElementById('lblFullCyclePlay');
  const seamStartTimeLabel = document.getElementById('seamStartTimeLabel');
  const seamEndTimeLabel = document.getElementById('seamEndTimeLabel');
  const btnToggleSeamPlay = document.getElementById('btnToggleSeamPlay');
  const iconSeamPlay = document.getElementById('iconSeamPlay');
  const lblSeamPlay = document.getElementById('lblSeamPlay');
  const btnNudgeStartBack = document.getElementById('btnNudgeStartBack');
  const btnNudgeStartForward = document.getElementById('btnNudgeStartForward');
  const btnNudgeEndBack = document.getElementById('btnNudgeEndBack');
  const btnNudgeEndForward = document.getElementById('btnNudgeEndForward');
  const btnApplyLoopToTimeline = document.getElementById('btnApplyLoopToTimeline');

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
      'btnAutoLoopFinder', 'btnSetTrimStart', 'btnSetTrimEnd', 'btnResetTrim', 'trimHandleLeft', 'trimHandleRight',
      'trimStartInput', 'trimEndInput',
      'btnPlayPause', 'btnToggleMode', 'btnZoomOut', 'btnZoomIn', 'btnZoomFit', 'inputPreviewBgColor', 'btnPreviewMoveToCleaner', 'btnCancelPreviewEyedropper',
      'btnGenerate', 'btnMoveToCleaner', 'btnDownloadMain', 'btnDownloadBundleZip', 'btnDownloadSpriteOnly', 'btnDownloadAudioOnly', 'btnDropdownMoveToCleaner',
      'btnBrowseFile', 'btnToggleCollapse', 'btnBrowseSecondary',
      // Sprite Sheet Settings (sidebar)
      'inputFrames', 'chkKeepSourceSize',
      'inputRows', 'inputCols', 'inputCellNative',
      'inputCropTop', 'inputCropBottom', 'inputCropLeft', 'inputCropRight',
      'btnSelectWatermark', 'btnClearWatermark', 'btnCancelWatermarkSelect',
      'headerSubjectAlignment', 'chkEnableGuideline', 'inputGuidelineX', 'selectGuidelineMode', 'chkEnableGuidelineY', 'inputGuidelineY', 'selectGuidelineYMode', 'btnGuidelineAutoDetect', 'btnGuidelineCenter', 'btnGuidelineResetCrop', 'chkShowGuidelineVideo', 'chkGuidelinePreview',
      'headerLoopSettings', 'chkClosedLoop', 'sliderLoopCrossfade', 'numLoopCrossfade', 'chkPingPongLoop', 'btnOpenLoopModalFromSettings',
      'inputDownloadName',
      'inputSpeedCustomSettings', 'btnResetSpeed',
      'inputFps', 'btnAutoFps',
      // Chroma Key Settings
      'sliderSimilarity', 'numSimilarity', 'sliderBlend', 'numBlend', 'sliderSpill', 'numSpill', 'sliderSubjectProtection', 'numSubjectProtection', 'sliderEdgeCleanup', 'numEdgeCleanup',
      'headerProtectionBrush', 'btnProtectionBrush', 'btnProtectionEraser', 'btnProtectionUndo', 'btnProtectionRedo', 'btnProtectionClear',
      'chkShowProtectionMask', 'sliderProtectionSize', 'numProtectionSize', 'sliderProtectionStrength', 'numProtectionStrength', 'sliderProtectionHardness', 'numProtectionHardness', 'selectProtectionPreset',
      'headerColorReplace', 'chkEnableColorReplace', 'inputColorReplaceSource', 'btnPickColorReplaceSource', 'inputColorReplaceTarget',
      'sliderColorReplaceTolerance', 'numColorReplaceTolerance', 'sliderColorReplaceStrength', 'numColorReplaceStrength',
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

  function isVideoWorkspaceActive() {
    return document.body.dataset.activeWorkspace === 'video';
  }

  window.addEventListener('workspacechange', (event) => {
    if (event.detail?.workspace !== 'video') deactivateProtectionBrush();
    else requestAnimationFrame(updateProtectionOverlay);
  });

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
    eyedropperPurpose: 'key', // 'key' | 'recolor'
    eyedropperZoom: 1,
    eyedropperPanX: 0,
    eyedropperPanY: 0,
    eyedropperPointer: null,
    eyedropperLastMouse: null,
    isWatermarkSelectActive: false,
    watermarkRect: null, // Native video coordinates: { x, y, width, height }
    isWatermarkOverlayHidden: false,
    watermarkPointer: null,
    protectionTool: null, // 'protect' | 'erase' | null
    protectionStrokes: [],
    protectionUndoActions: [],
    protectionRedoActions: [],
    protectionPointerId: null,
    activeProtectionStroke: null,
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
    videoLoadToken: 0,
    // Subject Alignment Vertical (X) & Horizontal (Y) Guidelines state
    guidelineEnabled: false,
    guidelineX: 0,
    guidelineAlignMode: 'left', // 'left' | 'center' | 'right'
    guidelineYEnabled: false,
    guidelineY: 0,
    guidelineYAlignMode: 'top', // 'top' | 'center' | 'bottom'
    showGuidelineVideo: true,
    showGuidelinePreview: true,
    isDraggingGuideline: false,
    isDraggingGuidelineY: false,
    // Loop Optimization & Periodicity Seeker state
    isClosedLoop: true,
    loopCrossfade: 0,
    pingPongLoop: false,
    pingPongDirection: 1,
    loopCandidates: [],
    selectedLoopCandidate: null,
    isScanningLoops: false
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
    if (!saved || ![1, 2, 3].includes(saved.schemaVersion)) return null;
    return saved;
  }

  function saveClipState() {
    if (!state.sourceId || !state.videoLoaded) return;
    const stored = readJsonStorage(CLIP_STATE_KEY, {});
    const states = Array.isArray(stored) ? {} : stored;
    states[state.sourceId] = {
      schemaVersion: 3,
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
      chromaEdgeCleanup: parseInt(sliderEdgeCleanup.value, 10),
      protectionStrokes: normalizeProtectionStrokes(state.protectionStrokes),
      protectionBrushSize: parseInt(sliderProtectionSize.value, 10),
      protectionBrushStrength: parseFloat(sliderProtectionStrength.value),
      protectionBrushHardness: parseFloat(sliderProtectionHardness.value),
      protectionPreset: selectProtectionPreset.value,
      showProtectionMask: chkShowProtectionMask.checked,
      colorReplaceEnabled: chkEnableColorReplace.checked,
      colorReplaceSource: inputColorReplaceSource.value,
      colorReplaceTarget: inputColorReplaceTarget.value,
      colorReplaceTolerance: parseFloat(sliderColorReplaceTolerance.value),
      colorReplaceStrength: parseFloat(sliderColorReplaceStrength.value),
      watermarkRect: state.watermarkRect,
      guidelineEnabled: state.guidelineEnabled,
      guidelineX: state.guidelineX,
      guidelineAlignMode: state.guidelineAlignMode,
      guidelineYEnabled: state.guidelineYEnabled,
      guidelineY: state.guidelineY,
      guidelineYAlignMode: state.guidelineYAlignMode,
      showGuidelineVideo: state.showGuidelineVideo,
      showGuidelinePreview: state.showGuidelinePreview,
      isClosedLoop: state.isClosedLoop,
      loopCrossfade: state.loopCrossfade,
      pingPongLoop: state.pingPongLoop,
      updatedAt: Date.now()
    };
    try { localStorage.setItem(CLIP_STATE_KEY, JSON.stringify(states)); } catch (_) { /* storage is optional */ }
  }

  function saveClipStateDebounced() {
    clearTimeout(saveStateTimer);
    saveStateTimer = setTimeout(saveClipState, 180);
  }

  /**
   * Builds chroma keying options from current UI controls.
   * All numeric values are clamped to prevent invalid keyer input.
   * Called per-frame: the returned object is handed to runKeyer, which
   * returns a new ImageData for the video path, so per-frame overrides
   * (like protection masks) differ between branches.
   */
  function buildChromaOptions(overrides = {}) {
    return {
      enabled: chkTransparentFormat.checked,
      similarity: U.clampNumber(sliderSimilarity.value, 0, 1, 0.55),
      blend: U.clampNumber(sliderBlend.value, 0, 1, 0.18),
      spill: U.clampNumber(sliderSpill.value, 0, 1, 0.55),
      subjectProtection: U.clampNumber(sliderSubjectProtection.value, 0, 1, 0.50),
      cleanupRadius: Math.round(U.clampNumber(sliderEdgeCleanup.value, 0, 3, 0)),
      keyColors: state.keyColors,
      ...overrides
    };
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

  // === COLLAPSIBLE SECTIONS ===
  const STORAGE_KEY_PROTECTION_COLLAPSE = 'video-editor:collapsed:protection-brush';
  const STORAGE_KEY_COLOR_REPLACE_COLLAPSE = 'video-editor:collapsed:color-replace';
  const STORAGE_KEY_GUIDELINE_COLLAPSE = 'video-editor:collapsed:subject-alignment';
  const STORAGE_KEY_LOOP_COLLAPSE = 'video-editor:collapsed:loop-settings';

  function setupCollapsibleSection({
    headerEl,
    bodyEl,
    labelEl,
    iconEl,
    storageKey,
    defaultExpanded = false,
    onToggle
  }) {
    if (!headerEl || !bodyEl) {
      return { expand: () => {}, collapse: () => {}, toggle: () => {}, isExpanded: () => true };
    }

    let isExpanded = defaultExpanded;
    if (storageKey) {
      try {
        const stored = localStorage.getItem(storageKey);
        if (stored !== null) isExpanded = stored === 'true';
      } catch (_) {}
    }

    function setExpanded(expanded, { persist = true } = {}) {
      isExpanded = Boolean(expanded);
      const parentGroup = headerEl.closest('.collapsible-section');
      if (parentGroup) {
        parentGroup.classList.toggle('collapsed', !isExpanded);
      }
      bodyEl.style.display = isExpanded ? '' : 'none';
      headerEl.setAttribute('aria-expanded', String(isExpanded));
      if (labelEl) labelEl.textContent = isExpanded ? 'Collapse' : 'Expand';
      if (iconEl) {
        iconEl.setAttribute('data-lucide', isExpanded ? 'chevron-up' : 'chevron-down');
        if (window.lucide && typeof lucide.createIcons === 'function') {
          lucide.createIcons({ root: headerEl });
        }
      }
      if (persist && storageKey) {
        try {
          localStorage.setItem(storageKey, String(isExpanded));
        } catch (_) {}
      }
      if (typeof onToggle === 'function') onToggle(isExpanded);
    }

    headerEl.addEventListener('click', (e) => {
      if (e.target.closest('button, input, select, a') && !e.target.closest('.section-collapse-action')) {
        return;
      }
      setExpanded(!isExpanded);
    });

    headerEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setExpanded(!isExpanded);
      }
    });

    setExpanded(isExpanded, { persist: false });

    return {
      isExpanded: () => isExpanded,
      setExpanded,
      expand: () => setExpanded(true),
      collapse: () => setExpanded(false),
      toggle: () => setExpanded(!isExpanded)
    };
  }

  const subjectAlignmentSection = setupCollapsibleSection({
    headerEl: headerSubjectAlignment,
    bodyEl: bodySubjectAlignment,
    labelEl: lblCollapseSubjectAlignment,
    iconEl: iconCollapseSubjectAlignment,
    storageKey: STORAGE_KEY_GUIDELINE_COLLAPSE,
    defaultExpanded: false
  });

  const protectionBrushSection = setupCollapsibleSection({
    headerEl: headerProtectionBrush,
    bodyEl: bodyProtectionBrush,
    labelEl: lblCollapseProtectionBrush,
    iconEl: iconCollapseProtectionBrush,
    storageKey: STORAGE_KEY_PROTECTION_COLLAPSE,
    defaultExpanded: false
  });

  const colorReplaceSection = setupCollapsibleSection({
    headerEl: headerColorReplace,
    bodyEl: bodyColorReplace,
    labelEl: lblCollapseColorReplace,
    iconEl: iconCollapseColorReplace,
    storageKey: STORAGE_KEY_COLOR_REPLACE_COLLAPSE,
    defaultExpanded: false
  });

  const loopSettingsSection = setupCollapsibleSection({
    headerEl: headerLoopSettings,
    bodyEl: bodyLoopSettings,
    labelEl: lblCollapseLoopSettings,
    iconEl: iconCollapseLoopSettings,
    storageKey: STORAGE_KEY_LOOP_COLLAPSE,
    defaultExpanded: true
  });

  // === SLIDER & NUMBER INPUT TWO-WAY SYNC ===
  function syncSliderAndNumber(sliderEl, numberEl, { decimals = 2, onChange } = {}) {
    if (!sliderEl || !numberEl) return;

    function applyValue(rawVal, isFromNumber = false) {
      const min = parseFloat(sliderEl.min) || 0;
      const max = parseFloat(sliderEl.max) || 1;
      let num = parseFloat(rawVal);
      if (isNaN(num)) num = min;
      num = Math.max(min, Math.min(max, num));
      const formatted = decimals === 0 ? String(Math.round(num)) : num.toFixed(decimals);
      sliderEl.value = String(num);
      if (!isFromNumber || document.activeElement !== numberEl) {
        numberEl.value = formatted;
      }
      if (onChange) onChange();
    }

    sliderEl.addEventListener('input', () => {
      const num = parseFloat(sliderEl.value);
      const formatted = decimals === 0 ? String(Math.round(num)) : num.toFixed(decimals);
      if (document.activeElement !== numberEl) {
        numberEl.value = formatted;
      }
      if (onChange) onChange();
    });

    numberEl.addEventListener('input', () => {
      if (numberEl.value === '' || numberEl.value === '-') return;
      applyValue(numberEl.value, true);
    });

    numberEl.addEventListener('change', () => {
      applyValue(numberEl.value, false);
    });

    numberEl.addEventListener('blur', () => {
      applyValue(numberEl.value, false);
    });
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
    updateMoveToCleanerButtons();
    state.currentFrameIndex = 0;
    state.watermarkRect = null;
    state.isWatermarkOverlayHidden = false;
    deactivateWatermarkSelect();
    deactivateProtectionBrush();
    state.protectionStrokes = [];
    state.protectionUndoActions = [];
    state.protectionRedoActions = [];
    updateWatermarkOverlay();
    updateProtectionOverlay();
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
    requestAnimationFrame(() => {
      updateCropOverlay();
      updateWatermarkOverlay();
      updateProtectionOverlay();
    });
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

  // Global Keyboard shortcuts for video navigation & eyedropper pixel nudging
  window.addEventListener('keydown', (e) => {
    if (!isVideoWorkspaceActive()) return;
    // Ignore when typing inside input or textarea
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
    if (state.protectionTool) return;

    if (state.isEyedropperActive) {
      const step = e.shiftKey ? 10 : (e.altKey ? 5 : 1);
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        moveEyedropperPixel(0, -step);
        return;
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        moveEyedropperPixel(0, step);
        return;
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        moveEyedropperPixel(-step, 0);
        return;
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        moveEyedropperPixel(step, 0);
        return;
      } else if (e.key === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        confirmEyedropperKeyboardSelection();
        return;
      }
      return;
    }

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
    state.watermarkRect = normalizeWatermarkRect(saved?.watermarkRect);
    state.isWatermarkOverlayHidden = false;
    state.protectionStrokes = normalizeProtectionStrokes(saved?.protectionStrokes);
    state.protectionUndoActions = [];
    state.protectionRedoActions = [];
    sliderProtectionSize.value = String(Math.round(U.clampNumber(saved?.protectionBrushSize, 5, 500, 80)));
    sliderProtectionStrength.value = String(U.clampNumber(saved?.protectionBrushStrength, 0, 1, 0.75));
    sliderProtectionHardness.value = String(U.clampNumber(saved?.protectionBrushHardness, 0, 1, 0.55));
    selectProtectionPreset.value = saved?.protectionPreset === 'solid' ? 'solid' : 'translucent';
    chkShowProtectionMask.checked = saved?.showProtectionMask !== false;
    chkEnableColorReplace.checked = Boolean(saved?.colorReplaceEnabled);
    inputColorReplaceSource.value = U.normalizeColor(saved?.colorReplaceSource)?.hex || '#c82828';
    inputColorReplaceTarget.value = U.normalizeColor(saved?.colorReplaceTarget)?.hex || '#1e64dc';
    sliderColorReplaceTolerance.value = String(U.clampNumber(saved?.colorReplaceTolerance, 0, 1, 0.28));
    sliderColorReplaceStrength.value = String(U.clampNumber(saved?.colorReplaceStrength, 0, 1, 1));
    sliderSimilarity.value = String(U.clampNumber(saved?.chromaSimilarity, 0, 1, 0.55));
    sliderBlend.value = String(U.clampNumber(saved?.chromaBlend, 0, 1, 0.18));
    sliderSpill.value = String(U.clampNumber(saved?.chromaSpill, 0, 1, 0.55));
    sliderSubjectProtection.value = String(U.clampNumber(saved?.chromaSubjectProtection, 0, 1, 0.50));
    sliderEdgeCleanup.value = String(Math.round(U.clampNumber(saved?.chromaEdgeCleanup, 0, 3, 0)));
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
    updateWatermarkOverlay();
    updateProtectionBrushUI();
    updateProtectionOverlay();
    updateColorReplaceUI();
    updateCellSizeUI();

    state.guidelineEnabled = Boolean(saved?.guidelineEnabled);
    chkEnableGuideline.checked = state.guidelineEnabled;
    guidelineControlsX.style.display = state.guidelineEnabled ? 'flex' : 'none';
    state.guidelineX = Math.max(0, Math.min(state.videoWidth, Number(saved?.guidelineX) || Math.round(state.videoWidth * 0.25)));
    inputGuidelineX.value = String(state.guidelineX);
    state.guidelineAlignMode = ['left', 'center', 'right'].includes(saved?.guidelineAlignMode) ? saved.guidelineAlignMode : 'left';
    selectGuidelineMode.value = state.guidelineAlignMode;

    state.guidelineYEnabled = Boolean(saved?.guidelineYEnabled);
    chkEnableGuidelineY.checked = state.guidelineYEnabled;
    guidelineControlsY.style.display = state.guidelineYEnabled ? 'flex' : 'none';
    state.guidelineY = Math.max(0, Math.min(state.videoHeight, Number(saved?.guidelineY) || Math.round(state.videoHeight * 0.15)));
    inputGuidelineY.value = String(state.guidelineY);
    state.guidelineYAlignMode = ['top', 'center', 'bottom'].includes(saved?.guidelineYAlignMode) ? saved.guidelineYAlignMode : 'top';
    selectGuidelineYMode.value = state.guidelineYAlignMode;

    state.showGuidelineVideo = saved?.showGuidelineVideo !== false;
    chkShowGuidelineVideo.checked = state.showGuidelineVideo;
    state.showGuidelinePreview = saved?.showGuidelinePreview !== false;
    chkGuidelinePreview.checked = state.showGuidelinePreview;
    updateGuidelineOverlay();

    if (state.guidelineEnabled || state.guidelineYEnabled) {
      subjectAlignmentSection.expand();
    }
    if (state.protectionStrokes.length > 0) {
      protectionBrushSection.expand();
    }
    if (chkEnableColorReplace.checked) {
      colorReplaceSection.expand();
    }

    state.isClosedLoop = saved?.isClosedLoop !== false;
    chkClosedLoop.checked = state.isClosedLoop;
    loopStatusBadge.textContent = state.isClosedLoop ? 'Closed Loop' : 'Open Range';
    loopStatusBadge.style.color = state.isClosedLoop ? '#38bdf8' : '#94a3b8';

    state.loopCrossfade = Math.max(0, Math.min(6, parseInt(saved?.loopCrossfade, 10) || 0));
    sliderLoopCrossfade.value = String(state.loopCrossfade);
    numLoopCrossfade.value = String(state.loopCrossfade);
    lblLoopCrossfadeVal.textContent = state.loopCrossfade === 0 ? '0 frames (Off)' : `${state.loopCrossfade} frame${state.loopCrossfade > 1 ? 's' : ''}`;

    state.pingPongLoop = Boolean(saved?.pingPongLoop);
    chkPingPongLoop.checked = state.pingPongLoop;

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
    if (!isVideoWorkspaceActive()) return;
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
    if (!isVideoWorkspaceActive()) return;
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
    if (!isVideoWorkspaceActive()) return;
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

  function autoComputeFPS({ force = false, toast = false } = {}) {
    if (!force && state.previewFpsIsManual) {
      updateSpeedEffectiveHint();
      return parseInt(inputFps.value, 10) || DEFAULT_AUTO_FPS;
    }
    if (!state.videoLoaded) {
      inputFps.value = DEFAULT_AUTO_FPS;
      updateSpeedEffectiveHint();
      return DEFAULT_AUTO_FPS;
    }
    const frames = parseInt(inputFrames?.value, 10) || 24;
    const speed = Math.max(0.1, state.playbackSpeed || 1);
    const duration = Math.max(0.05, state.trimEnd - state.trimStart);
    const effectiveSecs = duration / speed;
    const computedFps = Math.max(1, Math.min(60, Math.round(frames / effectiveSecs)));
    inputFps.value = String(computedFps);
    state.previewFpsIsManual = false;
    updateSpeedEffectiveHint();
    if (toast) {
      showToast(`Auto FPS set to ${computedFps} FPS (${frames} frames / ${effectiveSecs.toFixed(2)}s)`, 'info');
    }
    return computedFps;
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

  function normalizeWatermarkRect(rect) {
    if (!rect || !state.videoWidth || !state.videoHeight) return null;
    const x = U.clampNumber(rect.x, 0, state.videoWidth, 0);
    const y = U.clampNumber(rect.y, 0, state.videoHeight, 0);
    const maxW = Math.max(0, state.videoWidth - x);
    const maxH = Math.max(0, state.videoHeight - y);
    const width = U.clampNumber(rect.width, 0, maxW, 0);
    const height = U.clampNumber(rect.height, 0, maxH, 0);
    if (width < 1 || height < 1) return null;
    return {
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(width),
      height: Math.round(height)
    };
  }

  function rectFromNativePoints(start, end) {
    if (!start || !end) return null;
    return normalizeWatermarkRect({
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y)
    });
  }

  function getNativePointFromClient(clientX, clientY) {
    const box = getVideoRenderBox();
    if (!box) return null;
    const clampedX = Math.max(box.screenLeft, Math.min(box.screenLeft + box.width, clientX));
    const clampedY = Math.max(box.screenTop, Math.min(box.screenTop + box.height, clientY));
    return {
      x: Math.round((clampedX - box.screenLeft) * box.scaleX),
      y: Math.round((clampedY - box.screenTop) * box.scaleY)
    };
  }

  function updateWatermarkStatus() {
    if (!watermarkStatus) return;
    if (!state.watermarkRect) {
      watermarkStatus.textContent = 'No area selected';
      return;
    }
    const { x, y, width, height } = state.watermarkRect;
    watermarkStatus.textContent = `${width}x${height}px at ${x},${y}`;
  }

  function updateWatermarkOverlay() {
    updateWatermarkStatus();
    if (!watermarkOverlay || !state.videoLoaded || !state.watermarkRect || state.isWatermarkOverlayHidden) {
      if (watermarkOverlay) watermarkOverlay.style.display = 'none';
      return;
    }

    const rect = normalizeWatermarkRect(state.watermarkRect);
    const box = getVideoRenderBox();
    if (!rect || !box) {
      watermarkOverlay.style.display = 'none';
      return;
    }

    watermarkOverlay.style.display = 'block';
    watermarkOverlay.style.left = `${box.parentLeft + (rect.x / box.scaleX)}px`;
    watermarkOverlay.style.top = `${box.parentTop + (rect.y / box.scaleY)}px`;
    watermarkOverlay.style.width = `${rect.width / box.scaleX}px`;
    watermarkOverlay.style.height = `${rect.height / box.scaleY}px`;
  }

  function activateWatermarkSelect() {
    if (!state.videoLoaded) {
      showToast('Vui lòng tải video trước khi chọn vùng watermark', 'error');
      return;
    }
    if (state.isEyedropperActive) deactivateEyedropper();
    if (state.protectionTool) deactivateProtectionBrush();
    state.isWatermarkSelectActive = true;
    state.isWatermarkOverlayHidden = false;
    state.watermarkPointer = null;
    video.pause();
    updateVideoPlayPauseBtn();
    btnSelectWatermark.classList.add('active');
    btnSelectWatermark.innerHTML = `<i data-lucide="scan" style="width: 13px; height: 13px;"></i><span>Drag on video</span>`;
    watermarkBanner.classList.add('active');
    watermarkSelectOverlay.classList.add('active');
    videoViewport.classList.add('watermark-selecting');
    updateWatermarkOverlay();
    showToast('Kéo chọn vùng watermark trên Source video', 'info');
    lucide.createIcons({ root: btnSelectWatermark });
    lucide.createIcons({ root: watermarkBanner });
  }

  function deactivateWatermarkSelect() {
    state.isWatermarkSelectActive = false;
    state.watermarkPointer = null;
    if (btnSelectWatermark) {
      btnSelectWatermark.classList.remove('active');
      btnSelectWatermark.innerHTML = `<i data-lucide="scan" style="width: 13px; height: 13px;"></i><span>Select area</span>`;
      lucide.createIcons({ root: btnSelectWatermark });
    }
    if (watermarkBanner) watermarkBanner.classList.remove('active');
    if (watermarkSelectOverlay) watermarkSelectOverlay.classList.remove('active');
    if (videoViewport) videoViewport.classList.remove('watermark-selecting');
    updateWatermarkOverlay();
  }

  function clearWatermarkFromImageData(imgData, crop, cell) {
    const rect = normalizeWatermarkRect(state.watermarkRect);
    if (!rect) return;

    const cropX2 = crop.x + crop.width;
    const cropY2 = crop.y + crop.height;
    const rectX2 = rect.x + rect.width;
    const rectY2 = rect.y + rect.height;
    const ix1 = Math.max(crop.x, rect.x);
    const iy1 = Math.max(crop.y, rect.y);
    const ix2 = Math.min(cropX2, rectX2);
    const iy2 = Math.min(cropY2, rectY2);
    if (ix2 <= ix1 || iy2 <= iy1) return;

    const x1 = Math.max(0, Math.floor(((ix1 - crop.x) / crop.width) * cell.width));
    const y1 = Math.max(0, Math.floor(((iy1 - crop.y) / crop.height) * cell.height));
    const x2 = Math.min(cell.width, Math.ceil(((ix2 - crop.x) / crop.width) * cell.width));
    const y2 = Math.min(cell.height, Math.ceil(((iy2 - crop.y) / crop.height) * cell.height));
    const data = imgData.data;

    for (let y = y1; y < y2; y++) {
      let index = (y * cell.width + x1) * 4;
      for (let x = x1; x < x2; x++) {
        data[index] = 0;
        data[index + 1] = 0;
        data[index + 2] = 0;
        data[index + 3] = 0;
        index += 4;
      }
    }
  }

  function updateCellSizeUI() {
    if (!state.videoLoaded || !state.videoWidth || !state.videoHeight) {
      if (cellSizeHint) cellSizeHint.textContent = '';
      return;
    }

    const cTop = parseInt(inputCropTop.value, 10) || 0;
    const cBottom = parseInt(inputCropBottom.value, 10) || 0;
    const cLeft = parseInt(inputCropLeft.value, 10) || 0;
    const cRight = parseInt(inputCropRight.value, 10) || 0;

    const cropW = Math.max(1, state.videoWidth - cLeft - cRight);
    const cropH = Math.max(1, state.videoHeight - cTop - cBottom);

    const keepSource = chkKeepSourceSize.checked;
    inputCellNative.disabled = keepSource;

    let cellW, cellH;
    if (keepSource) {
      cellW = cropW;
      cellH = cropH;
      if (cellSizeHint) {
        cellSizeHint.textContent = `${cellW}×${cellH} px`;
        cellSizeHint.style.color = '#06b6d4';
      }
    } else {
      cellW = parseInt(inputCellNative.value, 10) || 512;
      cellH = Math.round(cellW * (cropH / cropW));
      if (cellSizeHint) {
        cellSizeHint.textContent = `${cellW}×${cellH} px`;
        cellSizeHint.style.color = '';
      }
    }
  }

  [inputCropTop, inputCropBottom, inputCropLeft, inputCropRight].forEach((input) => {
    input.addEventListener('input', () => {
      updateCropOverlay();
      updateWatermarkOverlay();
      updateGuidelineOverlay();
      updateCellSizeUI();
    });
  });

  if (chkKeepSourceSize) {
    chkKeepSourceSize.addEventListener('change', () => {
      updateCellSizeUI();
      saveClipStateDebounced();
      updatePreviewViewport();
    });
  }

  if (inputCellNative) {
    inputCellNative.addEventListener('input', () => {
      updateCellSizeUI();
      saveClipStateDebounced();
      updatePreviewViewport();
    });
  }
  window.addEventListener('resize', () => {
    updateCropOverlay();
    updateWatermarkOverlay();
    updateGuidelineOverlay();
    updateProtectionOverlay();
  });

  // === SUBJECT ALIGNMENT / VERTICAL & HORIZONTAL GUIDELINES ===
  function updateGuidelineStatus() {
    if (!guidelineStatus) return;
    const parts = [];
    if (state.guidelineEnabled) {
      const modeX = state.guidelineAlignMode === 'center' ? 'Center' : state.guidelineAlignMode === 'right' ? 'Right' : 'Left';
      parts.push(`X:${Math.round(state.guidelineX)}px (${modeX})`);
    }
    if (state.guidelineYEnabled) {
      const modeY = state.guidelineYAlignMode === 'center' ? 'Center' : state.guidelineYAlignMode === 'bottom' ? 'Bottom' : 'Top';
      parts.push(`Y:${Math.round(state.guidelineY)}px (${modeY})`);
    }
    if (parts.length === 0) {
      guidelineStatus.textContent = 'Off';
      guidelineStatus.style.color = '';
    } else {
      guidelineStatus.textContent = `On (${parts.join(' · ')})`;
      guidelineStatus.style.color = '#06b6d4';
    }
  }

  function updateGuidelineOverlay() {
    updateGuidelineStatus();
    const hasAny = state.guidelineEnabled || state.guidelineYEnabled;
    if (!guidelineOverlay || !state.videoLoaded || !hasAny || !state.showGuidelineVideo) {
      if (guidelineOverlay) guidelineOverlay.style.display = 'none';
      return;
    }

    const box = getVideoRenderBox();
    if (!box) {
      guidelineOverlay.style.display = 'none';
      return;
    }

    guidelineOverlay.style.display = 'block';

    // Vertical line (X)
    if (verticalGuideline) {
      if (state.guidelineEnabled) {
        verticalGuideline.style.display = 'flex';
        const screenX = box.parentLeft + (state.guidelineX / box.scaleX);
        verticalGuideline.style.left = `${screenX}px`;
        verticalGuideline.style.top = `${box.parentTop}px`;
        verticalGuideline.style.height = `${box.height}px`;
        if (verticalGuidelineBadge) {
          verticalGuidelineBadge.textContent = `X: ${Math.round(state.guidelineX)}px`;
        }
      } else {
        verticalGuideline.style.display = 'none';
      }
    }

    // Horizontal line (Y)
    if (horizontalGuideline) {
      if (state.guidelineYEnabled) {
        horizontalGuideline.style.display = 'flex';
        const screenY = box.parentTop + (state.guidelineY / box.scaleY);
        horizontalGuideline.style.top = `${screenY}px`;
        horizontalGuideline.style.left = `${box.parentLeft}px`;
        horizontalGuideline.style.width = `${box.width}px`;
        if (horizontalGuidelineBadge) {
          horizontalGuidelineBadge.textContent = `Y: ${Math.round(state.guidelineY)}px`;
        }
      } else {
        horizontalGuideline.style.display = 'none';
      }
    }
  }

  function setGuidelineFromPointer(e) {
    const box = getVideoRenderBox();
    if (!box) return;
    const clientX = e.clientX;
    const nativeX = (clientX - box.screenLeft) * box.scaleX;
    state.guidelineX = Math.max(0, Math.min(state.videoWidth || 4096, Math.round(nativeX)));
    if (inputGuidelineX) {
      inputGuidelineX.value = String(state.guidelineX);
    }
    updateGuidelineOverlay();
  }

  function setGuidelineYFromPointer(e) {
    const box = getVideoRenderBox();
    if (!box) return;
    const clientY = e.clientY;
    const nativeY = (clientY - box.screenTop) * box.scaleY;
    state.guidelineY = Math.max(0, Math.min(state.videoHeight || 4096, Math.round(nativeY)));
    if (inputGuidelineY) {
      inputGuidelineY.value = String(state.guidelineY);
    }
    updateGuidelineOverlay();
  }

  if (verticalGuideline) {
    verticalGuideline.addEventListener('pointerdown', (e) => {
      if (!state.videoLoaded || !state.guidelineEnabled) return;
      state.isDraggingGuideline = true;
      verticalGuideline.classList.add('is-dragging');
      verticalGuideline.setPointerCapture(e.pointerId);
      e.preventDefault();
      e.stopPropagation();
      setGuidelineFromPointer(e);
    });

    verticalGuideline.addEventListener('pointermove', (e) => {
      if (!state.isDraggingGuideline) return;
      e.preventDefault();
      e.stopPropagation();
      setGuidelineFromPointer(e);
    });

    const stopGuidelineDrag = (e) => {
      if (!state.isDraggingGuideline) return;
      state.isDraggingGuideline = false;
      verticalGuideline.classList.remove('is-dragging');
      try {
        verticalGuideline.releasePointerCapture(e.pointerId);
      } catch (_) {}
      saveClipStateDebounced();
      updatePreviewViewport();
    };

    verticalGuideline.addEventListener('pointerup', stopGuidelineDrag);
    verticalGuideline.addEventListener('pointercancel', stopGuidelineDrag);

    verticalGuideline.addEventListener('keydown', (e) => {
      if (!state.videoLoaded || !state.guidelineEnabled) return;
      const step = e.shiftKey ? 10 : 1;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        state.guidelineX = Math.max(0, state.guidelineX - step);
        if (inputGuidelineX) inputGuidelineX.value = String(state.guidelineX);
        updateGuidelineOverlay();
        saveClipStateDebounced();
        updatePreviewViewport();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        state.guidelineX = Math.min(state.videoWidth || 4096, state.guidelineX + step);
        if (inputGuidelineX) inputGuidelineX.value = String(state.guidelineX);
        updateGuidelineOverlay();
        saveClipStateDebounced();
        updatePreviewViewport();
      }
    });
  }

  if (horizontalGuideline) {
    horizontalGuideline.addEventListener('pointerdown', (e) => {
      if (!state.videoLoaded || !state.guidelineYEnabled) return;
      state.isDraggingGuidelineY = true;
      horizontalGuideline.classList.add('is-dragging');
      horizontalGuideline.setPointerCapture(e.pointerId);
      e.preventDefault();
      e.stopPropagation();
      setGuidelineYFromPointer(e);
    });

    horizontalGuideline.addEventListener('pointermove', (e) => {
      if (!state.isDraggingGuidelineY) return;
      e.preventDefault();
      e.stopPropagation();
      setGuidelineYFromPointer(e);
    });

    const stopGuidelineYDrag = (e) => {
      if (!state.isDraggingGuidelineY) return;
      state.isDraggingGuidelineY = false;
      horizontalGuideline.classList.remove('is-dragging');
      try {
        horizontalGuideline.releasePointerCapture(e.pointerId);
      } catch (_) {}
      saveClipStateDebounced();
      updatePreviewViewport();
    };

    horizontalGuideline.addEventListener('pointerup', stopGuidelineYDrag);
    horizontalGuideline.addEventListener('pointercancel', stopGuidelineYDrag);

    horizontalGuideline.addEventListener('keydown', (e) => {
      if (!state.videoLoaded || !state.guidelineYEnabled) return;
      const step = e.shiftKey ? 10 : 1;
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        state.guidelineY = Math.max(0, state.guidelineY - step);
        if (inputGuidelineY) inputGuidelineY.value = String(state.guidelineY);
        updateGuidelineOverlay();
        saveClipStateDebounced();
        updatePreviewViewport();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        state.guidelineY = Math.min(state.videoHeight || 4096, state.guidelineY + step);
        if (inputGuidelineY) inputGuidelineY.value = String(state.guidelineY);
        updateGuidelineOverlay();
        saveClipStateDebounced();
        updatePreviewViewport();
      }
    });
  }

  async function autoDetectSubjectGuideline() {
    if (!state.videoLoaded) {
      showToast('Vui lòng nạp video trước.', 'error');
      return;
    }
    const fullW = state.videoWidth;
    const fullH = state.videoHeight;

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = fullW;
    tempCanvas.height = fullH;
    const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });

    tempCtx.drawImage(video, 0, 0, fullW, fullH);

    let imgData = tempCtx.getImageData(0, 0, fullW, fullH);
    const keyResult = runKeyer(imgData, buildChromaOptions());
    imgData = keyResult.imageData;

    const bounds = detectSubjectBounds(imgData, {
      alphaThreshold: 25,
      minPixelsPerCol: 3,
      minPixelsPerRow: 3
    });

    if (!bounds) {
      showToast('Không tìm thấy chủ thể ở frame hiện tại (hãy thử seek tới frame khác hoặc kiểm tra màu Chroma key).', 'error');
      return;
    }

    let detectedX = bounds.minX;
    if (state.guidelineAlignMode === 'center') detectedX = bounds.centerX;
    else if (state.guidelineAlignMode === 'right') detectedX = bounds.maxX;

    let detectedY = bounds.minY;
    if (state.guidelineYAlignMode === 'center') detectedY = bounds.centerY;
    else if (state.guidelineYAlignMode === 'bottom') detectedY = bounds.maxY;
    else detectedY = bounds.minY;

    state.guidelineX = Math.round(detectedX);
    state.guidelineY = Math.round(detectedY);
    if (inputGuidelineX) inputGuidelineX.value = String(state.guidelineX);
    if (inputGuidelineY) inputGuidelineY.value = String(state.guidelineY);

    updateGuidelineOverlay();
    saveClipStateDebounced();
    updatePreviewViewport();
    showToast(`Đã nhận diện vị trí chủ thể: X = ${state.guidelineX}px, Y = ${state.guidelineY}px`, 'success');
  }

  if (chkEnableGuideline) {
    chkEnableGuideline.addEventListener('change', () => {
      state.guidelineEnabled = chkEnableGuideline.checked;
      if (guidelineControlsX) {
        guidelineControlsX.style.display = state.guidelineEnabled ? 'flex' : 'none';
      }
      if (state.guidelineEnabled && (!state.guidelineX || state.guidelineX === 0)) {
        const cLeft = parseInt(inputCropLeft.value, 10) || 0;
        const cRight = parseInt(inputCropRight.value, 10) || 0;
        const cropW = Math.max(1, state.videoWidth - cLeft - cRight);
        state.guidelineX = Math.round(cLeft + (cropW * 0.25));
        if (inputGuidelineX) inputGuidelineX.value = String(state.guidelineX);
      }
      updateGuidelineOverlay();
      saveClipStateDebounced();
      updatePreviewViewport();
      if (state.guidelineEnabled) {
        showToast('Đã bật trục dọc X. Nhấn Generate để tạo lại sprite sheet canh lề cố định.', 'info');
      }
    });
  }

  if (inputGuidelineX) {
    inputGuidelineX.addEventListener('input', () => {
      const val = parseInt(inputGuidelineX.value, 10);
      state.guidelineX = U.clampNumber(val, 0, state.videoWidth || 4096, 0);
      updateGuidelineOverlay();
      saveClipStateDebounced();
      updatePreviewViewport();
    });
  }

  if (chkEnableGuidelineY) {
    chkEnableGuidelineY.addEventListener('change', () => {
      state.guidelineYEnabled = chkEnableGuidelineY.checked;
      if (guidelineControlsY) {
        guidelineControlsY.style.display = state.guidelineYEnabled ? 'flex' : 'none';
      }
      if (state.guidelineYEnabled && (!state.guidelineY || state.guidelineY === 0)) {
        const cTop = parseInt(inputCropTop.value, 10) || 0;
        const cBottom = parseInt(inputCropBottom.value, 10) || 0;
        const cropH = Math.max(1, state.videoHeight - cTop - cBottom);
        state.guidelineY = Math.round(cTop + (cropH * 0.15));
        if (inputGuidelineY) inputGuidelineY.value = String(state.guidelineY);
      }
      updateGuidelineOverlay();
      saveClipStateDebounced();
      updatePreviewViewport();
      if (state.guidelineYEnabled) {
        showToast('Đã bật trục ngang Y. Nhấn Generate để tạo lại sprite sheet canh lề cố định.', 'info');
      }
    });
  }

  if (inputGuidelineY) {
    inputGuidelineY.addEventListener('input', () => {
      const val = parseInt(inputGuidelineY.value, 10);
      state.guidelineY = U.clampNumber(val, 0, state.videoHeight || 4096, 0);
      updateGuidelineOverlay();
      saveClipStateDebounced();
      updatePreviewViewport();
    });
  }

  if (selectGuidelineMode) {
    selectGuidelineMode.addEventListener('change', () => {
      state.guidelineAlignMode = selectGuidelineMode.value;
      updateGuidelineOverlay();
      saveClipStateDebounced();
      updatePreviewViewport();
    });
  }

  if (selectGuidelineYMode) {
    selectGuidelineYMode.addEventListener('change', () => {
      state.guidelineYAlignMode = selectGuidelineYMode.value;
      updateGuidelineOverlay();
      saveClipStateDebounced();
      updatePreviewViewport();
    });
  }

  if (btnGuidelineAutoDetect) {
    btnGuidelineAutoDetect.addEventListener('click', autoDetectSubjectGuideline);
  }

  if (btnGuidelineCenter) {
    btnGuidelineCenter.addEventListener('click', () => {
      if (!state.videoLoaded) return;
      const cLeft = parseInt(inputCropLeft.value, 10) || 0;
      const cRight = parseInt(inputCropRight.value, 10) || 0;
      const cTop = parseInt(inputCropTop.value, 10) || 0;
      const cBottom = parseInt(inputCropBottom.value, 10) || 0;
      const cropW = Math.max(1, state.videoWidth - cLeft - cRight);
      const cropH = Math.max(1, state.videoHeight - cTop - cBottom);
      state.guidelineX = Math.round(cLeft + (cropW / 2));
      state.guidelineY = Math.round(cTop + (cropH / 2));
      if (inputGuidelineX) inputGuidelineX.value = String(state.guidelineX);
      if (inputGuidelineY) inputGuidelineY.value = String(state.guidelineY);
      updateGuidelineOverlay();
      saveClipStateDebounced();
      updatePreviewViewport();
    });
  }

  if (btnGuidelineResetCrop) {
    btnGuidelineResetCrop.addEventListener('click', () => {
      if (!state.videoLoaded) return;
      const cLeft = parseInt(inputCropLeft.value, 10) || 0;
      const cTop = parseInt(inputCropTop.value, 10) || 0;
      state.guidelineX = cLeft;
      state.guidelineY = cTop;
      if (inputGuidelineX) inputGuidelineX.value = String(state.guidelineX);
      if (inputGuidelineY) inputGuidelineY.value = String(state.guidelineY);
      updateGuidelineOverlay();
      saveClipStateDebounced();
      updatePreviewViewport();
    });
  }

  if (chkShowGuidelineVideo) {
    chkShowGuidelineVideo.addEventListener('change', () => {
      state.showGuidelineVideo = chkShowGuidelineVideo.checked;
      updateGuidelineOverlay();
      saveClipStateDebounced();
    });
  }

  if (chkGuidelinePreview) {
    chkGuidelinePreview.addEventListener('change', () => {
      state.showGuidelinePreview = chkGuidelinePreview.checked;
      updatePreviewViewport();
      saveClipStateDebounced();
    });
  }

  btnSelectWatermark.addEventListener('click', () => {
    if (state.isWatermarkSelectActive) deactivateWatermarkSelect();
    else activateWatermarkSelect();
  });

  btnClearWatermark.addEventListener('click', () => {
    state.watermarkRect = null;
    state.isWatermarkOverlayHidden = false;
    updateWatermarkOverlay();
    saveClipStateDebounced();
    showToast('Đã xóa vùng watermark đã chọn', 'info');
  });

  btnCancelWatermarkSelect.addEventListener('click', deactivateWatermarkSelect);

  watermarkSelectOverlay.addEventListener('mousedown', (e) => {
    if (!state.isWatermarkSelectActive || e.button !== 0) return;
    const point = getNativePointFromClient(e.clientX, e.clientY);
    if (!point) return;
    e.preventDefault();
    state.watermarkPointer = { start: point, current: point };
    state.watermarkRect = null;
    state.isWatermarkOverlayHidden = false;
    updateWatermarkOverlay();
  });

  watermarkSelectOverlay.addEventListener('mousemove', (e) => {
    if (!state.isWatermarkSelectActive || !state.watermarkPointer) return;
    const point = getNativePointFromClient(e.clientX, e.clientY);
    if (!point) return;
    state.watermarkPointer.current = point;
    state.watermarkRect = rectFromNativePoints(state.watermarkPointer.start, point);
    updateWatermarkOverlay();
  });

  window.addEventListener('mouseup', (e) => {
    if (!state.isWatermarkSelectActive || !state.watermarkPointer) return;
    const point = getNativePointFromClient(e.clientX, e.clientY);
    const rect = rectFromNativePoints(state.watermarkPointer.start, point || state.watermarkPointer.current);
    state.watermarkPointer = null;
    if (!rect || rect.width < 3 || rect.height < 3) {
      state.watermarkRect = null;
      state.isWatermarkOverlayHidden = false;
      updateWatermarkOverlay();
      showToast('Vùng watermark quá nhỏ, hãy kéo chọn lại', 'error');
      return;
    }
    state.watermarkRect = rect;
    deactivateWatermarkSelect();
    saveClipStateDebounced();
    showToast('Đã chọn vùng watermark. Bấm Generate để áp dụng.', 'success');
  });

  // === SUBJECT PROTECTION BRUSH ===
  function updateProtectionBrushUI() {
    const strokeCount = state.protectionStrokes.length;
    const size = Math.round(Number(sliderProtectionSize.value) || 80);
    const strength = U.clampNumber(sliderProtectionStrength.value, 0, 1, 0.75);
    const hardness = U.clampNumber(sliderProtectionHardness.value, 0, 1, 0.55);

    if (numProtectionSize && document.activeElement !== numProtectionSize) numProtectionSize.value = String(size);
    if (numProtectionStrength && document.activeElement !== numProtectionStrength) numProtectionStrength.value = strength.toFixed(2);
    if (numProtectionHardness && document.activeElement !== numProtectionHardness) numProtectionHardness.value = hardness.toFixed(2);

    lblProtectionSize.textContent = `${size} px`;
    lblProtectionStrength.textContent = `${Math.round(strength * 100)}%`;
    lblProtectionHardness.textContent = `${Math.round(hardness * 100)}%`;
    protectionBrushStatus.textContent = strokeCount > 0
      ? `${strokeCount} stroke${strokeCount === 1 ? '' : 's'} · applies to all frames`
      : 'No protected strokes';
    btnProtectionUndo.disabled = state.protectionUndoActions.length === 0;
    btnProtectionRedo.disabled = state.protectionRedoActions.length === 0;
    btnProtectionClear.disabled = strokeCount === 0;
    btnProtectionBrush.classList.toggle('active', state.protectionTool === 'protect');
    btnProtectionEraser.classList.toggle('active', state.protectionTool === 'erase');
  }

  syncSliderAndNumber(sliderProtectionSize, numProtectionSize, { decimals: 0, onChange: () => { updateProtectionBrushUI(); saveClipStateDebounced(); } });
  syncSliderAndNumber(sliderProtectionStrength, numProtectionStrength, { decimals: 2, onChange: () => { updateProtectionBrushUI(); saveClipStateDebounced(); } });
  syncSliderAndNumber(sliderProtectionHardness, numProtectionHardness, { decimals: 2, onChange: () => { updateProtectionBrushUI(); saveClipStateDebounced(); } });

  function updateProtectionOverlay() {
    if (!protectionBrushCanvas) return;
    const shouldShow = state.videoLoaded
      && !state.isEyedropperActive
      && (Boolean(state.protectionTool) || (chkShowProtectionMask.checked && state.protectionStrokes.length > 0));
    if (!shouldShow) {
      protectionBrushCanvas.classList.remove('visible');
      return;
    }
    const box = getVideoRenderBox();
    if (!box || box.width < 1 || box.height < 1) {
      protectionBrushCanvas.classList.remove('visible');
      return;
    }

    protectionBrushCanvas.style.left = `${box.parentLeft}px`;
    protectionBrushCanvas.style.top = `${box.parentTop}px`;
    protectionBrushCanvas.style.width = `${box.width}px`;
    protectionBrushCanvas.style.height = `${box.height}px`;
    rasterizeProtectionMask(state.protectionStrokes, {
      canvas: protectionBrushCanvas,
      sourceWidth: state.videoWidth,
      sourceHeight: state.videoHeight,
      cropX: 0,
      cropY: 0,
      cropWidth: state.videoWidth,
      cropHeight: state.videoHeight,
      targetWidth: Math.max(1, Math.round(box.width)),
      targetHeight: Math.max(1, Math.round(box.height)),
      color: 'rgba(192,132,252,{alpha})'
    });
    protectionBrushCanvas.classList.add('visible');
  }

  function normalizedProtectionPoint(clientX, clientY, clampToVideo = false) {
    const box = getVideoRenderBox();
    if (!box) return null;
    const isInside = clientX >= box.screenLeft && clientX <= box.screenLeft + box.width
      && clientY >= box.screenTop && clientY <= box.screenTop + box.height;
    if (!isInside && !clampToVideo) return null;
    return {
      x: Math.max(0, Math.min(1, (clientX - box.screenLeft) / box.width)),
      y: Math.max(0, Math.min(1, (clientY - box.screenTop) / box.height))
    };
  }

  function finishProtectionStroke(event) {
    const stroke = state.activeProtectionStroke;
    if (!stroke) return;
    if (event?.pointerId != null && event.pointerId !== state.protectionPointerId) return;
    try { protectionBrushCanvas.releasePointerCapture?.(state.protectionPointerId); } catch (_) { /* optional */ }
    state.activeProtectionStroke = null;
    state.protectionPointerId = null;
    state.protectionUndoActions.push({ type: 'stroke', stroke });
    state.protectionUndoActions = state.protectionUndoActions.slice(-100);
    state.protectionRedoActions = [];
    updateProtectionBrushUI();
    updateProtectionOverlay();
    saveClipStateDebounced();
  }

  function activateProtectionBrush(mode) {
    if (!state.videoLoaded) {
      showToast('Vui lòng tải video trước khi vẽ protection mask', 'error');
      return;
    }
    protectionBrushSection.expand();
    if (state.isEyedropperActive) deactivateEyedropper();
    if (state.isWatermarkSelectActive) deactivateWatermarkSelect();
    state.protectionTool = mode === 'erase' ? 'erase' : 'protect';
    video.pause();
    updateVideoPlayPauseBtn();
    protectionBrushBanner.classList.add('active');
    protectionBrushCanvas.classList.add('active');
    videoViewport.classList.add('protection-painting');
    updateProtectionBrushUI();
    updateProtectionOverlay();
    lucide.createIcons({ root: protectionBrushBanner });
    showToast(state.protectionTool === 'erase'
      ? 'Tẩy protection mask trên Source video'
      : 'Vẽ vùng chủ thể cần bảo vệ. Mask áp dụng cho mọi frame.', 'info');
  }

  function deactivateProtectionBrush() {
    if (state.activeProtectionStroke) finishProtectionStroke();
    state.protectionTool = null;
    protectionBrushBanner?.classList.remove('active');
    protectionBrushCanvas?.classList.remove('active');
    videoViewport?.classList.remove('protection-painting');
    updateProtectionBrushUI();
    updateProtectionOverlay();
  }

  btnProtectionBrush.addEventListener('click', () => {
    if (state.protectionTool === 'protect') deactivateProtectionBrush();
    else activateProtectionBrush('protect');
  });
  btnProtectionEraser.addEventListener('click', () => {
    if (state.protectionTool === 'erase') deactivateProtectionBrush();
    else activateProtectionBrush('erase');
  });
  btnCancelProtectionBrush.addEventListener('click', deactivateProtectionBrush);

  protectionBrushCanvas.addEventListener('pointerdown', (event) => {
    if (!state.protectionTool || !state.videoLoaded || event.button !== 0) return;
    const point = normalizedProtectionPoint(event.clientX, event.clientY, false);
    if (!point) return;
    event.preventDefault();
    const rawStrength = U.clampNumber(sliderProtectionStrength.value, 0, 1, 0.75);
    const presetRetention = selectProtectionPreset.value === 'solid' ? 1 : 0.8;
    const stroke = {
      mode: state.protectionTool,
      points: [point],
      size: Math.round(U.clampNumber(sliderProtectionSize.value, 5, 500, 80)),
      strength: state.protectionTool === 'erase' ? rawStrength : rawStrength * presetRetention,
      hardness: U.clampNumber(sliderProtectionHardness.value, 0, 1, 0.55)
    };
    state.activeProtectionStroke = stroke;
    state.protectionPointerId = event.pointerId;
    state.protectionStrokes.push(stroke);
    protectionBrushCanvas.setPointerCapture?.(event.pointerId);
    updateProtectionOverlay();
  });

  protectionBrushCanvas.addEventListener('pointermove', (event) => {
    const stroke = state.activeProtectionStroke;
    if (!stroke || event.pointerId !== state.protectionPointerId) return;
    const point = normalizedProtectionPoint(event.clientX, event.clientY, true);
    if (!point) return;
    const previous = stroke.points[stroke.points.length - 1];
    const nativeDistance = Math.hypot(
      (point.x - previous.x) * state.videoWidth,
      (point.y - previous.y) * state.videoHeight
    );
    if (nativeDistance < Math.max(1, stroke.size * 0.035)) return;
    stroke.points.push(point);
    updateProtectionOverlay();
  });

  protectionBrushCanvas.addEventListener('pointerup', finishProtectionStroke);
  protectionBrushCanvas.addEventListener('pointercancel', finishProtectionStroke);

  btnProtectionUndo.addEventListener('click', () => {
    const action = state.protectionUndoActions.pop();
    if (!action) return;
    if (action.type === 'stroke') state.protectionStrokes.pop();
    else if (action.type === 'clear') state.protectionStrokes = action.strokes.slice();
    state.protectionRedoActions.push(action);
    updateProtectionBrushUI();
    updateProtectionOverlay();
    saveClipStateDebounced();
  });

  btnProtectionRedo.addEventListener('click', () => {
    const action = state.protectionRedoActions.pop();
    if (!action) return;
    if (action.type === 'stroke') state.protectionStrokes.push(action.stroke);
    else if (action.type === 'clear') state.protectionStrokes = [];
    state.protectionUndoActions.push(action);
    updateProtectionBrushUI();
    updateProtectionOverlay();
    saveClipStateDebounced();
  });

  btnProtectionClear.addEventListener('click', () => {
    if (state.protectionStrokes.length === 0) return;
    state.protectionUndoActions.push({ type: 'clear', strokes: state.protectionStrokes.slice() });
    state.protectionUndoActions = state.protectionUndoActions.slice(-100);
    state.protectionRedoActions = [];
    state.protectionStrokes = [];
    updateProtectionBrushUI();
    updateProtectionOverlay();
    saveClipStateDebounced();
    showToast('Đã xóa protection mask. Có thể Undo để khôi phục.', 'info');
  });

  selectProtectionPreset.addEventListener('change', saveClipStateDebounced);
  chkShowProtectionMask.addEventListener('change', () => {
    updateProtectionOverlay();
    saveClipStateDebounced();
  });
  updateProtectionBrushUI();

  // === SUBJECT COLOR REPLACEMENT ===
  function updateColorReplaceUI() {
    const source = U.normalizeColor(inputColorReplaceSource.value)?.hex || '#c82828';
    const target = U.normalizeColor(inputColorReplaceTarget.value)?.hex || '#1e64dc';
    const tol = U.clampNumber(sliderColorReplaceTolerance.value, 0, 1, 0.28);
    const str = U.clampNumber(sliderColorReplaceStrength.value, 0, 1, 1);

    if (numColorReplaceTolerance && document.activeElement !== numColorReplaceTolerance) numColorReplaceTolerance.value = tol.toFixed(2);
    if (numColorReplaceStrength && document.activeElement !== numColorReplaceStrength) numColorReplaceStrength.value = str.toFixed(2);

    lblColorReplaceTolerance.textContent = `${Math.round(tol * 100)}%`;
    lblColorReplaceStrength.textContent = `${Math.round(str * 100)}%`;
    colorReplaceSummary.textContent = `${source.toUpperCase()} → ${target.toUpperCase()}`;
    colorReplaceSummary.classList.toggle('active', chkEnableColorReplace.checked);
  }

  syncSliderAndNumber(sliderColorReplaceTolerance, numColorReplaceTolerance, { decimals: 2, onChange: () => { updateColorReplaceUI(); saveClipStateDebounced(); } });
  syncSliderAndNumber(sliderColorReplaceStrength, numColorReplaceStrength, { decimals: 2, onChange: () => { updateColorReplaceUI(); saveClipStateDebounced(); } });

  function setColorReplaceSource(hex, { enable = true } = {}) {
    const color = U.normalizeColor(hex);
    if (!color) return false;
    inputColorReplaceSource.value = color.hex;
    if (enable) {
      chkEnableColorReplace.checked = true;
      colorReplaceSection.expand();
    }
    updateColorReplaceUI();
    saveClipStateDebounced();
    return true;
  }

  chkEnableColorReplace.addEventListener('change', () => {
    if (chkEnableColorReplace.checked) {
      colorReplaceSection.expand();
    }
  });

  [chkEnableColorReplace, inputColorReplaceSource, inputColorReplaceTarget].forEach((control) => {
    control.addEventListener('input', () => {
      updateColorReplaceUI();
      saveClipStateDebounced();
    });
    control.addEventListener('change', () => {
      updateColorReplaceUI();
      saveClipStateDebounced();
    });
  });

  btnPickColorReplaceSource.addEventListener('click', () => {
    if (!state.videoLoaded) {
      showToast('Vui lòng tải video trước khi chọn màu cần đổi', 'error');
      return;
    }
    colorReplaceSection.expand();
    if (state.isEyedropperActive && state.eyedropperPurpose === 'recolor') deactivateEyedropper();
    else activateEyedropper('recolor');
  });
  updateColorReplaceUI();

  // === EYEDROPPER & COLOR PICKING ===
  btnPickColor.addEventListener('click', () => {
    if (!state.videoLoaded) {
      showToast('Vui lòng tải video trước khi chọn màu', 'error');
      return;
    }
    if (state.isEyedropperActive && state.eyedropperPurpose === 'key') {
      deactivateEyedropper();
    } else {
      activateEyedropper('key');
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
    if (e.key === 'Escape' && modalLoopFinder && modalLoopFinder.style.display !== 'none') {
      closeLoopModal();
    } else if (e.key === 'Escape' && state.isEyedropperActive) {
      deactivateEyedropper();
    } else if (e.key === 'Escape' && state.isWatermarkSelectActive) {
      deactivateWatermarkSelect();
    } else if (e.key === 'Escape' && state.protectionTool) {
      deactivateProtectionBrush();
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
    updateWatermarkOverlay();
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

  function activateEyedropper(purpose = 'key') {
    if (state.isEyedropperActive) deactivateEyedropper();
    if (state.protectionTool) deactivateProtectionBrush();
    if (state.isWatermarkSelectActive) deactivateWatermarkSelect();
    state.eyedropperPurpose = purpose === 'recolor' ? 'recolor' : 'key';
    state.isEyedropperActive = true;
    state.eyedropperTarget = 'video';
    state.eyedropperPixel = null;
    state.wasPreviewPlaying = state.isPlaying;
    const isRecolorPick = state.eyedropperPurpose === 'recolor';
    btnPickColor.classList.toggle('active', !isRecolorPick);
    btnPickColorReplaceSource.classList.toggle('active', isRecolorPick);
    if (!isRecolorPick) {
      btnPickColor.innerHTML = `<i data-lucide="crosshair" style="width: 13px; height: 13px;"></i><span>Click Video / Preview</span>`;
    } else {
      btnPickColorReplaceSource.innerHTML = `<i data-lucide="crosshair" style="width: 13px; height: 13px;"></i><span>Pick from Video / Preview</span>`;
    }
    if (eyedropperBannerText) eyedropperBannerText.textContent = isRecolorPick
      ? 'Chọn màu chủ thể · Click Video/Preview hoặc dùng phím Mũi tên (↑ ↓ ← →) · Enter chọn · Cuộn zoom'
      : 'Pick màu nền · Click Video/Preview hoặc dùng phím Mũi tên (↑ ↓ ← →) · Enter chọn · Cuộn zoom';
    if (previewEyedropperBannerText) previewEyedropperBannerText.textContent = isRecolorPick
      ? 'Pick màu chủ thể từ Preview · Phím Mũi tên (↑ ↓ ← →) · Enter chọn'
      : 'Pick màu nền từ Preview · Phím Mũi tên (↑ ↓ ← →) · Enter chọn';
    eyedropperBanner.classList.add('active');
    eyedropperOverlay.classList.add('active');
    videoViewport.classList.add('eyedropper-zooming');
    updateProtectionOverlay();

    if (previewEyedropperBanner) previewEyedropperBanner.classList.add('active');
    if (previewEyedropperOverlay) previewEyedropperOverlay.classList.add('active');
    if (spriteViewport) spriteViewport.classList.add('eyedropper-zooming');

    // Pause video + sprite preview for steady pixel sampling
    video.pause();
    updateVideoPlayPauseBtn();
    if (state.isPlaying) stopAnimationPreview();
    applyEyedropperVideoTransform();

    // Default sampling position to center of video for instant keyboard navigation
    if (state.videoLoaded && state.videoWidth > 0 && state.videoHeight > 0) {
      const centerX = Math.floor(state.videoWidth / 2);
      const centerY = Math.floor(state.videoHeight / 2);
      updateEyedropperLoupeByPixel(centerX, centerY);
    }

    showToast(isRecolorPick
      ? 'Chọn màu chủ thể: Click hoặc dùng phím Mũi tên (↑ ↓ ← →), Enter để chọn'
      : 'Pick màu nền: Click hoặc dùng phím Mũi tên (↑ ↓ ← →), Enter để chọn', 'info');
    lucide.createIcons({ root: btnPickColor });
    lucide.createIcons({ root: btnPickColorReplaceSource });
    lucide.createIcons({ root: eyedropperBanner });
    if (previewEyedropperBanner) lucide.createIcons({ root: previewEyedropperBanner });
  }

  function deactivateEyedropper() {
    state.isEyedropperActive = false;
    state.eyedropperPointer = null;
    state.previewEyedropperPointer = null;
    state.eyedropperPixel = null;
    state.eyedropperTarget = 'video';
    btnPickColor.classList.remove('active');
    btnPickColor.innerHTML = `<i data-lucide="pipette" style="width: 13px; height: 13px;"></i><span>Pick Color from Video / Preview</span>`;
    btnPickColorReplaceSource.classList.remove('active');
    btnPickColorReplaceSource.innerHTML = `<i data-lucide="pipette" style="width: 13px; height: 13px;"></i><span>Pick source</span>`;
    eyedropperBanner.classList.remove('active');
    eyedropperOverlay.classList.remove('active');
    eyedropperLoupe.style.display = 'none';
    videoViewport.classList.remove('eyedropper-zooming', 'eyedropper-panning');

    if (previewEyedropperBanner) previewEyedropperBanner.classList.remove('active');
    if (previewEyedropperOverlay) previewEyedropperOverlay.classList.remove('active');
    if (previewEyedropperLoupe) previewEyedropperLoupe.style.display = 'none';
    if (spriteViewport) spriteViewport.classList.remove('eyedropper-zooming');

    resetEyedropperZoom();
    updateProtectionOverlay();
    lucide.createIcons({ root: btnPickColor });
    lucide.createIcons({ root: btnPickColorReplaceSource });
  }

  function acceptEyedropperColor(pixel, originLabel) {
    const hex = rgbToHex(pixel[0], pixel[1], pixel[2]);
    if (state.eyedropperPurpose === 'recolor') {
      setColorReplaceSource(hex, { enable: true });
      deactivateEyedropper();
      showToast(`Màu cần đổi: ${hex} (${originLabel})`, 'success');
      return true;
    }
    const added = addColor(pixel[0], pixel[1], pixel[2], hex);
    deactivateEyedropper();
    showToast(added ? `Đã thêm màu nền từ ${originLabel}: ${hex}` : `Màu ${hex} đã có trong danh sách`, added ? 'success' : 'info');
    return true;
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

  function updateEyedropperLoupeByPixel(px, py) {
    if (!state.isEyedropperActive || !state.videoLoaded) return;

    const box = getVideoRenderBox();
    if (!box) return;

    const pRect = videoViewport.getBoundingClientRect();

    px = Math.max(0, Math.min(state.videoWidth - 1, Math.round(px)));
    py = Math.max(0, Math.min(state.videoHeight - 1, Math.round(py)));
    state.eyedropperPixel = { px, py, target: 'video' };
    state.eyedropperTarget = 'video';

    // Client coordinates for positioning loupe
    const clientX = box.screenLeft + (px + 0.5) / box.scaleX;
    const clientY = box.screenTop + (py + 0.5) / box.scaleY;

    if (previewEyedropperLoupe) previewEyedropperLoupe.style.display = 'none';
    eyedropperLoupe.style.display = 'block';

    let loupeX = clientX - pRect.left;
    let loupeY = clientY - pRect.top - 65;
    if (loupeY < 60) {
      loupeY = clientY - pRect.top + 65;
    }
    loupeX = Math.max(60, Math.min(pRect.width - 60, loupeX));

    eyedropperLoupe.style.left = `${loupeX}px`;
    eyedropperLoupe.style.top = `${loupeY}px`;

    if (sampleCanvas.width !== state.videoWidth || sampleCanvas.height !== state.videoHeight) {
      sampleCanvas.width = state.videoWidth;
      sampleCanvas.height = state.videoHeight;
    }
    sampleCtx.drawImage(video, 0, 0, state.videoWidth, state.videoHeight);

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
    if (eyedropperCoord) eyedropperCoord.textContent = `X: ${px}, Y: ${py}`;
    eyedropperColorBadge.style.backgroundColor = hex;
  }

  function updateEyedropperLoupe(clientX, clientY) {
    if (!state.isEyedropperActive || !state.videoLoaded) return;

    const box = getVideoRenderBox();
    if (!box) return;

    // Check if mouse is within the actual rendered video frame
    if (
      clientX < box.screenLeft || clientX > box.screenLeft + box.width ||
      clientY < box.screenTop || clientY > box.screenTop + box.height
    ) {
      eyedropperLoupe.style.display = 'none';
      return;
    }

    const px = Math.min(state.videoWidth - 1, Math.max(0, Math.floor((clientX - box.screenLeft) * box.scaleX)));
    const py = Math.min(state.videoHeight - 1, Math.max(0, Math.floor((clientY - box.screenTop) * box.scaleY)));
    updateEyedropperLoupeByPixel(px, py);
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
    acceptEyedropperColor(pixel, 'Source Video');
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

  function updatePreviewEyedropperLoupeByPixel(px, py) {
    if (!state.isEyedropperActive || !previewEyedropperLoupe || !previewLoupeCtx || !previewCanvas) return;
    if (!state.fullSheetCanvas && state.generatedFrames.length === 0) {
      previewEyedropperLoupe.style.display = 'none';
      return;
    }

    px = Math.max(0, Math.min(previewCanvas.width - 1, Math.round(px)));
    py = Math.max(0, Math.min(previewCanvas.height - 1, Math.round(py)));
    state.eyedropperPixel = { px, py, target: 'preview' };
    state.eyedropperTarget = 'preview';

    const rect = previewCanvas.getBoundingClientRect();
    const pRect = spriteViewport.getBoundingClientRect();

    const clientX = rect.left + ((px + 0.5) / previewCanvas.width) * rect.width;
    const clientY = rect.top + ((py + 0.5) / previewCanvas.height) * rect.height;

    eyedropperLoupe.style.display = 'none';
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
    if (previewEyedropperCoord) previewEyedropperCoord.textContent = `X: ${px}, Y: ${py}`;
    previewEyedropperColorBadge.style.backgroundColor = hex;
    previewEyedropperColorBadge.style.opacity = pixel[3] < 10 ? '0.35' : '1';
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

    updatePreviewEyedropperLoupeByPixel(hit.px, hit.py);
  }

  function moveEyedropperPixel(dx, dy) {
    if (!state.isEyedropperActive) return false;

    const isPreview = state.eyedropperTarget === 'preview';
    if (isPreview) {
      if (!previewCanvas || previewCanvas.width < 1 || previewCanvas.height < 1) return false;
      const curX = (state.eyedropperPixel && state.eyedropperPixel.target === 'preview')
        ? state.eyedropperPixel.px
        : Math.floor(previewCanvas.width / 2);
      const curY = (state.eyedropperPixel && state.eyedropperPixel.target === 'preview')
        ? state.eyedropperPixel.py
        : Math.floor(previewCanvas.height / 2);
      const px = Math.max(0, Math.min(previewCanvas.width - 1, curX + dx));
      const py = Math.max(0, Math.min(previewCanvas.height - 1, curY + dy));
      updatePreviewEyedropperLoupeByPixel(px, py);
      return true;
    } else {
      if (!state.videoLoaded || state.videoWidth < 1 || state.videoHeight < 1) return false;
      const curX = (state.eyedropperPixel && state.eyedropperPixel.target === 'video')
        ? state.eyedropperPixel.px
        : Math.floor(state.videoWidth / 2);
      const curY = (state.eyedropperPixel && state.eyedropperPixel.target === 'video')
        ? state.eyedropperPixel.py
        : Math.floor(state.videoHeight / 2);
      const px = Math.max(0, Math.min(state.videoWidth - 1, curX + dx));
      const py = Math.max(0, Math.min(state.videoHeight - 1, curY + dy));
      updateEyedropperLoupeByPixel(px, py);
      return true;
    }
  }

  function confirmEyedropperKeyboardSelection() {
    if (!state.isEyedropperActive) return false;
    const isPreview = state.eyedropperTarget === 'preview';
    if (isPreview) {
      if (!state.fullSheetCanvas && state.generatedFrames.length === 0) return false;
      const px = (state.eyedropperPixel && state.eyedropperPixel.target === 'preview')
        ? state.eyedropperPixel.px
        : Math.floor(previewCanvas.width / 2);
      const py = (state.eyedropperPixel && state.eyedropperPixel.target === 'preview')
        ? state.eyedropperPixel.py
        : Math.floor(previewCanvas.height / 2);
      const ctx = previewCanvas.getContext('2d', { willReadFrequently: true });
      const pixel = ctx.getImageData(px, py, 1, 1).data;
      if (pixel[3] < 10) {
        showToast('Pixel trong suốt — hãy chọn một vùng còn nhìn thấy', 'error');
        return false;
      }
      return acceptEyedropperColor(pixel, 'Preview');
    } else {
      if (!state.videoLoaded) return false;
      const px = (state.eyedropperPixel && state.eyedropperPixel.target === 'video')
        ? state.eyedropperPixel.px
        : Math.floor(state.videoWidth / 2);
      const py = (state.eyedropperPixel && state.eyedropperPixel.target === 'video')
        ? state.eyedropperPixel.py
        : Math.floor(state.videoHeight / 2);
      if (sampleCanvas.width !== state.videoWidth || sampleCanvas.height !== state.videoHeight) {
        sampleCanvas.width = state.videoWidth;
        sampleCanvas.height = state.videoHeight;
      }
      sampleCtx.drawImage(video, 0, 0, state.videoWidth, state.videoHeight);
      const pixel = sampleCtx.getImageData(px, py, 1, 1).data;
      return acceptEyedropperColor(pixel, 'Source Video');
    }
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
      showToast('Pixel trong suốt — hãy chọn một vùng còn nhìn thấy', 'error');
      return false;
    }

    return acceptEyedropperColor(pixel, 'Preview');
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
    const sim = parseFloat(sliderSimilarity.value).toFixed(2);
    const blend = parseFloat(sliderBlend.value).toFixed(2);
    const spill = parseFloat(sliderSpill.value).toFixed(2);
    const prot = parseFloat(sliderSubjectProtection.value).toFixed(2);
    const cleanup = String(parseInt(sliderEdgeCleanup.value, 10) || 0);

    if (numSimilarity && document.activeElement !== numSimilarity) numSimilarity.value = sim;
    if (numBlend && document.activeElement !== numBlend) numBlend.value = blend;
    if (numSpill && document.activeElement !== numSpill) numSpill.value = spill;
    if (numSubjectProtection && document.activeElement !== numSubjectProtection) numSubjectProtection.value = prot;
    if (numEdgeCleanup && document.activeElement !== numEdgeCleanup) numEdgeCleanup.value = cleanup;

    lblSimilarityVal.textContent = sim;
    lblBlendVal.textContent = blend;
    lblSpillVal.textContent = spill;
    lblSubjectProtectionVal.textContent = prot;
    lblEdgeCleanupVal.textContent = `${cleanup} px`;
  }

  // Sliders display and persist their exact values, including zero.
  syncSliderAndNumber(sliderSimilarity, numSimilarity, { decimals: 2, onChange: () => { updateChromaSliderLabels(); saveClipStateDebounced(); } });
  syncSliderAndNumber(sliderBlend, numBlend, { decimals: 2, onChange: () => { updateChromaSliderLabels(); saveClipStateDebounced(); } });
  syncSliderAndNumber(sliderSpill, numSpill, { decimals: 2, onChange: () => { updateChromaSliderLabels(); saveClipStateDebounced(); } });
  syncSliderAndNumber(sliderSubjectProtection, numSubjectProtection, { decimals: 2, onChange: () => { updateChromaSliderLabels(); saveClipStateDebounced(); } });
  syncSliderAndNumber(sliderEdgeCleanup, numEdgeCleanup, { decimals: 0, onChange: () => { updateChromaSliderLabels(); saveClipStateDebounced(); } });

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
    if (state.protectionTool) deactivateProtectionBrush();

    state.isGenerating = true;
    btnGenerate.disabled = true;
    btnGenerate.innerHTML = `<i data-lucide="loader" class="spin" style="width: 16px; height: 16px;"></i><span>Generating...</span>`;
    lucide.createIcons({ root: btnGenerate });

    progressBarContainer.style.display = 'block';
    progressBarFill.style.width = '0%';

    try {
      const shouldHideWatermarkOverlayAfterGenerate = Boolean(state.watermarkRect);
      await generateSpriteSheet();
      if (shouldHideWatermarkOverlayAfterGenerate) {
        state.isWatermarkOverlayHidden = true;
        updateWatermarkOverlay();
        saveClipStateDebounced();
      }
      updateMoveToCleanerButtons();
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
    const rows = parseInt(inputRows.value, 10) || 6;
    const cols = parseInt(inputCols.value, 10) || 4;
    if (rows * cols < totalFrames) {
      inputRows.value = Math.ceil(totalFrames / cols);
    }

    const cellsAcross = cols;
    const cellsDown = Math.max(rows, Math.ceil(totalFrames / cellsAcross));

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

    const sheetW = cellW * cellsAcross;
    const sheetH = cellH * cellsDown;

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
    const cleanupRadius = Math.round(U.clampNumber(sliderEdgeCleanup.value, 0, 3, 0));

    // Full video resolution canvas for 2D alignment so neither X nor Y is clipped
    const fullW = state.videoWidth;
    const fullH = state.videoHeight;
    const fullFrameCanvas = document.createElement('canvas');
    fullFrameCanvas.width = fullW;
    fullFrameCanvas.height = fullH;
    const fullFrameCtx = fullFrameCanvas.getContext('2d', { willReadFrequently: true });

    const isGuidelineActive = state.guidelineEnabled || state.guidelineYEnabled;

    const protectionMaskStandard = chkTransparentFormat.checked && state.protectionStrokes.length > 0
      ? rasterizeProtectionMask(state.protectionStrokes, {
        sourceWidth: state.videoWidth,
        sourceHeight: state.videoHeight,
        cropX: cLeft,
        cropY: cTop,
        cropWidth: cropW,
        cropHeight: cropH,
        targetWidth: cellW,
        targetHeight: cellH
      }).mask
      : null;

    const protectionMaskFull = chkTransparentFormat.checked && state.protectionStrokes.length > 0
      ? rasterizeProtectionMask(state.protectionStrokes, {
        sourceWidth: state.videoWidth,
        sourceHeight: state.videoHeight,
        cropX: 0,
        cropY: 0,
        cropWidth: fullW,
        cropHeight: fullH,
        targetWidth: fullW,
        targetHeight: fullH
      }).mask
      : null;

    const colorReplaceOptions = {
      enabled: chkEnableColorReplace.checked,
      sourceColor: U.normalizeColor(inputColorReplaceSource.value),
      targetColor: U.normalizeColor(inputColorReplaceTarget.value),
      tolerance: U.clampNumber(sliderColorReplaceTolerance.value, 0, 1, 0.28),
      strength: U.clampNumber(sliderColorReplaceStrength.value, 0, 1, 1)
    };

    state.generatedFrames = [];
    const startTime = state.trimStart;
    const endTime = state.trimEnd;
    const timestamps = computeLoopTimestamps(startTime, endTime, totalFrames, chkClosedLoop.checked);

    // Pause video during extraction
    video.pause();

    for (let i = 0; i < totalFrames; i++) {
      const targetTime = timestamps[i];
      
      // Seek video to target frame time
      await seekVideoAsync(video, targetTime);

      frameCtx.clearRect(0, 0, cellW, cellH);

      if (isGuidelineActive) {
        // Extract full video frame to capture all content in X and Y without any premature clipping
        fullFrameCtx.clearRect(0, 0, fullW, fullH);
        fullFrameCtx.drawImage(video, 0, 0, fullW, fullH);

        let fullImgData = fullFrameCtx.getImageData(0, 0, fullW, fullH);
        const fullKeyResult = runKeyer(fullImgData, buildChromaOptions({ protectionMask: protectionMaskFull }));
        fullImgData = fullKeyResult.imageData;
        applyColorReplacement(fullImgData, colorReplaceOptions);
        clearWatermarkFromImageData(
          fullImgData,
          { x: 0, y: 0, width: fullW, height: fullH },
          { width: fullW, height: fullH }
        );
        fullFrameCtx.putImageData(fullImgData, 0, 0);

        // Detect true subject bounds across full frame
        const bounds = detectSubjectBounds(fullImgData, {
          alphaThreshold: 25,
          minPixelsPerCol: 3,
          minPixelsPerRow: 3
        });

        let sourceX = cLeft;
        let sourceY = cTop;

        if (bounds) {
          if (state.guidelineEnabled) {
            let anchorX = bounds.minX;
            if (state.guidelineAlignMode === 'center') anchorX = bounds.centerX;
            else if (state.guidelineAlignMode === 'right') anchorX = bounds.maxX;
            sourceX = anchorX - (state.guidelineX - cLeft);
          }
          if (state.guidelineYEnabled) {
            let anchorY = bounds.minY;
            if (state.guidelineYAlignMode === 'center') anchorY = bounds.centerY;
            else if (state.guidelineYAlignMode === 'bottom') anchorY = bounds.maxY;
            else anchorY = bounds.minY;
            sourceY = anchorY - (state.guidelineY - cTop);
          }
        }

        // Draw from fullFrameCanvas to frameCanvas preserving full dimensions and exact cell size
        drawSubImageSafe(frameCtx, fullFrameCanvas, sourceX, sourceY, cropW, cropH, 0, 0, cellW, cellH);
      } else {
        // Standard crop extraction
        frameCtx.drawImage(
          video,
          cLeft, cTop, cropW, cropH,
          0, 0, cellW, cellH
        );

        let imgData = frameCtx.getImageData(0, 0, cellW, cellH);
        const cellKeyResult = runKeyer(imgData, buildChromaOptions({ protectionMask: protectionMaskStandard }));
        imgData = cellKeyResult.imageData;
        applyColorReplacement(imgData, colorReplaceOptions);
        clearWatermarkFromImageData(
          imgData,
          { x: cLeft, y: cTop, width: cropW, height: cropH },
          { width: cellW, height: cellH }
        );
        frameCtx.putImageData(imgData, 0, 0);
      }

      // Store individual frame canvas for animation preview
      const singleFrameCopy = document.createElement('canvas');
      singleFrameCopy.width = cellW;
      singleFrameCopy.height = cellH;
      const singleCtx = singleFrameCopy.getContext('2d');
      singleCtx.drawImage(frameCanvas, 0, 0);
      state.generatedFrames.push(singleFrameCopy);

      // Draw into grand sprite sheet canvas
      const colIndex = i % cellsAcross;
      const rowIndex = Math.floor(i / cellsAcross);
      const destX = colIndex * cellW;
      const destY = rowIndex * cellH;

      sheetCtx.drawImage(frameCanvas, destX, destY);

      // Update progress
      const pct = Math.round(((i + 1) / totalFrames) * 100);
      progressBarFill.style.width = `${pct}%`;
    }

    // Apply temporal seam crossfade blending if configured
    const crossfadeFrames = parseInt(sliderLoopCrossfade?.value, 10) || 0;
    if (crossfadeFrames > 0 && state.generatedFrames.length >= crossfadeFrames * 2) {
      applyLoopCrossfade(state.generatedFrames, crossfadeFrames);

      // Re-render full sprite sheet from the blended frames
      sheetCtx.clearRect(0, 0, sheetW, sheetH);
      for (let i = 0; i < totalFrames; i++) {
        const colIndex = i % cellsAcross;
        const rowIndex = Math.floor(i / cellsAcross);
        const destX = colIndex * cellW;
        const destY = rowIndex * cellH;
        sheetCtx.drawImage(state.generatedFrames[i], destX, destY);
      }
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
      }, 1000);
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
      if (chkPingPongLoop.checked && state.generatedFrames.length > 2) {
        state.currentFrameIndex += (state.pingPongDirection || 1);
        if (state.currentFrameIndex >= state.generatedFrames.length - 1) {
          state.currentFrameIndex = state.generatedFrames.length - 1;
          state.pingPongDirection = -1;
        } else if (state.currentFrameIndex <= 0) {
          state.currentFrameIndex = 0;
          state.pingPongDirection = 1;
        }
      } else {
        state.currentFrameIndex = (state.currentFrameIndex + 1) % state.generatedFrames.length;
      }
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
    if (state.generatedFrames.length === 0) return;
    if (state.isPlaying) {
      stopAnimationPreview();
    } else {
      startAnimationPreview();
    }
  });

  btnToggleMode.addEventListener('click', () => {
    state.previewMode = state.previewMode === 'play' ? 'sheet' : 'play';
    textToggleMode.textContent = state.previewMode === 'play' ? 'Anim' : 'Sheet';
    btnToggleMode.classList.toggle('active', state.previewMode === 'sheet');
    updatePreviewViewport();
  });

  btnAutoFps.addEventListener('click', () => {
    const fps = autoComputeFPS({ force: true, toast: true });
    if (state.isPlaying) {
      startAnimationPreview();
    }
    saveClipStateDebounced();
  });

  inputFps.addEventListener('change', () => {
    let fps = parseInt(inputFps.value, 10) || 12;
    fps = Math.max(1, Math.min(60, fps));
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
      const rows = parseInt(inputRows.value, 10) || 6;
      const cols = parseInt(inputCols.value, 10) || 4;
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

    // Draw guidelines on preview if enabled
    if (state.showGuidelinePreview && (state.guidelineEnabled || state.guidelineYEnabled)) {
      const cLeft = parseInt(inputCropLeft.value, 10) || 0;
      const cRight = parseInt(inputCropRight.value, 10) || 0;
      const cTop = parseInt(inputCropTop.value, 10) || 0;
      const cBottom = parseInt(inputCropBottom.value, 10) || 0;
      const cropW = Math.max(1, state.videoWidth - cLeft - cRight);
      const cropH = Math.max(1, state.videoHeight - cTop - cBottom);
      const keepSource = chkKeepSourceSize.checked;
      const cellNative = parseInt(inputCellNative.value, 10) || 512;
      const cellW = keepSource ? cropW : cellNative;
      const cellH = keepSource ? cropH : Math.round(cellNative * (cropH / cropW));

      const targetCellX = Math.round((state.guidelineX - cLeft) * (cellW / cropW));
      const targetCellY = Math.round((state.guidelineY - cTop) * (cellH / cropH));

      if (state.previewMode === 'play') {
        ctx.save();
        if (state.guidelineEnabled && targetCellX >= 0 && targetCellX <= previewCanvas.width) {
          ctx.strokeStyle = 'rgba(6, 182, 212, 0.85)';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(targetCellX + 0.5, 0);
          ctx.lineTo(targetCellX + 0.5, previewCanvas.height);
          ctx.stroke();
        }
        if (state.guidelineYEnabled && targetCellY >= 0 && targetCellY <= previewCanvas.height) {
          ctx.strokeStyle = 'rgba(245, 158, 11, 0.85)';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(0, targetCellY + 0.5);
          ctx.lineTo(previewCanvas.width, targetCellY + 0.5);
          ctx.stroke();
        }
        ctx.restore();
      } else {
        const rows = parseInt(inputRows.value, 10) || 6;
        const cols = parseInt(inputCols.value, 10) || 4;
        const sheetCellW = previewCanvas.width / cols;
        const sheetCellH = previewCanvas.height / rows;
        const scaledTargetX = (targetCellX / cellW) * sheetCellW;
        const scaledTargetY = (targetCellY / cellH) * sheetCellH;

        ctx.save();
        ctx.setLineDash([3, 3]);
        if (state.guidelineEnabled) {
          ctx.strokeStyle = 'rgba(6, 182, 212, 0.65)';
          ctx.lineWidth = 1;
          for (let c = 0; c < cols; c++) {
            const gx = Math.round((c * sheetCellW) + scaledTargetX);
            if (gx >= 0 && gx <= previewCanvas.width) {
              ctx.beginPath();
              ctx.moveTo(gx + 0.5, 0);
              ctx.lineTo(gx + 0.5, previewCanvas.height);
              ctx.stroke();
            }
          }
        }
        if (state.guidelineYEnabled) {
          ctx.strokeStyle = 'rgba(245, 158, 11, 0.65)';
          ctx.lineWidth = 1;
          for (let r = 0; r < rows; r++) {
            const gy = Math.round((r * sheetCellH) + scaledTargetY);
            if (gy >= 0 && gy <= previewCanvas.height) {
              ctx.beginPath();
              ctx.moveTo(0, gy + 0.5);
              ctx.lineTo(previewCanvas.width, gy + 0.5);
              ctx.stroke();
            }
          }
        }
        ctx.restore();
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

  // 4. Move to Clean Sprite Sheet
  btnMoveToCleaner?.addEventListener('click', moveToSpriteCleaner);
  btnPreviewMoveToCleaner?.addEventListener('click', moveToSpriteCleaner);
  btnDropdownMoveToCleaner?.addEventListener('click', () => {
    downloadDropdownMenu?.classList.remove('show');
    moveToSpriteCleaner();
  });

  function updateMoveToCleanerButtons() {
    const hasSheet = Boolean(state.fullSheetCanvas);
    if (btnMoveToCleaner) btnMoveToCleaner.disabled = !hasSheet;
    if (btnPreviewMoveToCleaner) btnPreviewMoveToCleaner.disabled = !hasSheet;
  }

  function moveToSpriteCleaner() {
    if (!state.fullSheetCanvas) {
      showToast('Please generate the sprite sheet first', 'error');
      return;
    }

    const baseName = (inputDownloadName.value.trim() || 'spritesheet').replace(/[^a-zA-Z0-9_-]/g, '_');
    const fmt = selectFormat.value.toLowerCase() === 'webp' ? 'webp' : 'png';
    const fileName = `${baseName}.${fmt}`;
    const totalFrames = parseInt(inputFrames.value, 10) || 24;
    const cols = parseInt(inputCols.value, 10) || 4;
    const rows = parseInt(inputRows.value, 10) || Math.ceil(totalFrames / cols);
    const fps = parseInt(inputFps.value, 10) || 12;

    stopAnimationPreview();
    if (video && !video.paused) video.pause();

    window.dispatchEvent(new CustomEvent('movespritetocleaner', {
      detail: {
        canvas: state.fullSheetCanvas,
        fileName,
        rows,
        cols,
        fps,
        downloadName: `${baseName}_clean`
      }
    }));
  }

  updateMoveToCleanerButtons();

  // === AUTO LOOP SEEKER & SEAM INSPECTOR CONTROLLER ===
  let activeSeamCandidate = null;
  let seamPlayerTimer = null;
  let seamPlayerFrames = [];
  let seamPlayerIndex = 0;

  let fullCycleTimer = null;
  let fullCycleFrames = [];
  let fullCycleIndex = 0;

  function updateLoopTargetHint() {
    if (!lblLoopIdealDurationText) return;
    const speed = parseFloat(selectLoopSpeed?.value) || 2;
    const targetFrames = parseInt(inputLoopTargetFrames?.value, 10) || 24;
    const targetFps = parseInt(selectLoopTargetFps?.value, 10) || 12;
    const idealDuration = (targetFrames * speed) / targetFps;
    lblLoopIdealDurationText.textContent = `Mục tiêu: ${targetFrames} frames @ ${speed}x (${targetFps} FPS) ➔ Chu kỳ video gốc lý tưởng ~${idealDuration.toFixed(2)}s`;
  }

  selectLoopSpeed?.addEventListener('change', updateLoopTargetHint);
  inputLoopTargetFrames?.addEventListener('input', updateLoopTargetHint);
  selectLoopTargetFps?.addEventListener('change', updateLoopTargetHint);

  function openLoopModal() {
    if (!state.videoLoaded) {
      showToast('Vui lòng tải video trước khi tìm chu kỳ Loop', 'error');
      return;
    }
    video.pause();
    stopAnimationPreview();
    if (modalLoopFinder) modalLoopFinder.style.display = 'flex';

    if (selectLoopSpeed) {
      const curSpeed = state.playbackSpeed || 1;
      const speedOptions = Array.from(selectLoopSpeed.options).map((o) => parseFloat(o.value));
      if (speedOptions.includes(curSpeed)) {
        selectLoopSpeed.value = String(curSpeed);
      } else {
        selectLoopSpeed.value = '2'; // Default recommended 2x for multi-action cycles
      }
    }
    if (inputLoopTargetFrames) {
      inputLoopTargetFrames.value = inputFrames?.value || '24';
    }
    if (selectLoopTargetFps) {
      const curFps = parseInt(inputFps?.value, 10) || 12;
      const fpsOptions = Array.from(selectLoopTargetFps.options).map((o) => parseInt(o.value, 10));
      if (fpsOptions.includes(curFps)) {
        selectLoopTargetFps.value = String(curFps);
      } else {
        selectLoopTargetFps.value = '12';
      }
    }
    updateLoopTargetHint();

    if (activeSeamCandidate) {
      inspectSeamCandidate(activeSeamCandidate);
    } else {
      inspectCurrentTrimAsCandidate();
    }
  }

  function closeLoopModal() {
    stopSeamPlayer();
    stopFullCyclePlayer();
    if (modalLoopFinder) modalLoopFinder.style.display = 'none';
  }

  async function inspectCurrentTrimAsCandidate() {
    const speed = parseFloat(selectLoopSpeed?.value) || state.playbackSpeed || 1;
    const targetFps = parseInt(selectLoopTargetFps?.value, 10) || parseInt(inputFps?.value, 10) || 12;
    const targetFrames = parseInt(inputLoopTargetFrames?.value, 10) || parseInt(inputFrames?.value, 10) || 24;
    const dur = Math.max(0.05, state.trimEnd - state.trimStart);

    const curCand = {
      id: 'current_trim',
      startTime: state.trimStart,
      endTime: state.trimEnd,
      duration: dur,
      speed,
      effectiveDuration: dur / speed,
      calculatedFrames: Math.max(1, Math.round((dur / speed) * targetFps)),
      calculatedFps: targetFps,
      score: 0,
      visualScore: 0,
      frameFitScore: 0
    };
    await inspectSeamCandidate(curCand);
  }

  async function inspectSeamCandidate(cand) {
    if (!cand || !state.videoLoaded) return;
    activeSeamCandidate = cand;
    if (btnApplyLoopToTimeline) btnApplyLoopToTimeline.disabled = false;

    if (seamStartTimeLabel) seamStartTimeLabel.textContent = formatTime(cand.startTime);
    if (seamEndTimeLabel) seamEndTimeLabel.textContent = formatTime(cand.endTime);

    const cTop = parseInt(inputCropTop.value, 10) || 0;
    const cBottom = parseInt(inputCropBottom.value, 10) || 0;
    const cLeft = parseInt(inputCropLeft.value, 10) || 0;
    const cRight = parseInt(inputCropRight.value, 10) || 0;
    const cropW = Math.max(1, state.videoWidth - cLeft - cRight);
    const cropH = Math.max(1, state.videoHeight - cTop - cBottom);

    const inspectW = Math.min(220, cropW);
    const inspectH = Math.round(inspectW * (cropH / cropW));

    // 1. Capture Start Frame
    await seekVideoAsync(video, cand.startTime);
    if (seamStartCanvas) {
      seamStartCanvas.width = inspectW;
      seamStartCanvas.height = inspectH;
      const ctxStart = seamStartCanvas.getContext('2d');
      ctxStart.drawImage(video, cLeft, cTop, cropW, cropH, 0, 0, inspectW, inspectH);
      if (chkTransparentFormat.checked && state.keyColors.length > 0) {
        let imgDataS = ctxStart.getImageData(0, 0, inspectW, inspectH);
        const startKeyResult = runKeyer(imgDataS, buildChromaOptions({ enabled: true }));
        imgDataS = startKeyResult.imageData;
        ctxStart.putImageData(imgDataS, 0, 0);
      }
    }

    // 2. Capture End Frame
    await seekVideoAsync(video, cand.endTime);
    if (seamEndCanvas) {
      seamEndCanvas.width = inspectW;
      seamEndCanvas.height = inspectH;
      const ctxEnd = seamEndCanvas.getContext('2d');
      ctxEnd.drawImage(video, cLeft, cTop, cropW, cropH, 0, 0, inspectW, inspectH);
      if (chkTransparentFormat.checked && state.keyColors.length > 0) {
        let imgDataE = ctxEnd.getImageData(0, 0, inspectW, inspectH);
        const endKeyResult = runKeyer(imgDataE, buildChromaOptions({ enabled: true }));
        imgDataE = endKeyResult.imageData;
        ctxEnd.putImageData(imgDataE, 0, 0);
      }
    }

    // 3. Compute Frame Distance & Similarity Score
    if (seamStartCanvas && seamEndCanvas) {
      const ctxStart = seamStartCanvas.getContext('2d');
      const ctxEnd = seamEndCanvas.getContext('2d');
      const imgDataA = ctxStart.getImageData(0, 0, inspectW, inspectH);
      const imgDataB = ctxEnd.getImageData(0, 0, inspectW, inspectH);
      const metrics = computeFrameDistance(imgDataA, imgDataB, inspectW, inspectH);
      const scorePct = metrics.similarity;

      const candFrames = cand.calculatedFrames || 24;
      const candSpeed = cand.speed || 1;
      if (loopSeamScoreBadge) {
        loopSeamScoreBadge.textContent = `${scorePct}% khớp viền · ${candFrames}f @ ${candSpeed}x`;
        loopSeamScoreBadge.className = `loop-score-badge ${scorePct >= 90 ? 'high' : 'medium'}`;
      }

      // 4. Render Diff Heatmap
      if (seamDiffCanvas) {
        createDiffHeatmapCanvas(seamStartCanvas, seamEndCanvas, seamDiffCanvas);
      }
    }

    // 5. Setup Live Seam Mini Player
    await setupSeamPlayer(cand, inspectW, inspectH, cLeft, cTop, cropW, cropH);

    // 6. Setup Full Action 24-Frame Player
    await setupFullCyclePlayer(cand, inspectW, inspectH, cLeft, cTop, cropW, cropH);
  }

  async function setupSeamPlayer(cand, w, h, cLeft, cTop, cropW, cropH) {
    stopSeamPlayer();
    seamPlayerFrames = [];

    const totalFrames = cand.calculatedFrames || parseInt(inputFrames?.value, 10) || 24;
    const dt = Math.max(0.03, cand.duration / totalFrames);
    const times = [
      Math.max(0, cand.endTime - (dt * 2)),
      Math.max(0, cand.endTime - dt),
      cand.endTime,
      cand.startTime,
      Math.min(state.duration, cand.startTime + dt),
      Math.min(state.duration, cand.startTime + (dt * 2))
    ];

    for (const t of times) {
      await seekVideoAsync(video, t);
      const cvs = document.createElement('canvas');
      cvs.width = w;
      cvs.height = h;
      const ctx = cvs.getContext('2d');
      ctx.drawImage(video, cLeft, cTop, cropW, cropH, 0, 0, w, h);
      if (chkTransparentFormat.checked && state.keyColors.length > 0) {
        let img = ctx.getImageData(0, 0, w, h);
        const imgKeyResult = runKeyer(img, buildChromaOptions({ enabled: true }));
        img = imgKeyResult.imageData;
        ctx.putImageData(img, 0, 0);
      }
      seamPlayerFrames.push(cvs);
    }

    if (seamLoopPlayerCanvas) {
      seamLoopPlayerCanvas.width = w;
      seamLoopPlayerCanvas.height = h;
    }
    startSeamPlayer();
  }

  function startSeamPlayer() {
    stopSeamPlayer();
    if (seamPlayerFrames.length === 0 || !seamLoopPlayerCanvas) return;
    seamPlayerIndex = 0;
    if (lblSeamPlay) lblSeamPlay.textContent = 'Pause';
    if (iconSeamPlay) {
      iconSeamPlay.setAttribute('data-lucide', 'pause');
      lucide.createIcons({ root: btnToggleSeamPlay });
    }

    const fps = activeSeamCandidate?.calculatedFps || parseInt(inputFps?.value, 10) || 12;
    const interval = 1000 / fps;

    seamPlayerTimer = setInterval(() => {
      if (seamPlayerFrames.length === 0 || !seamLoopPlayerCanvas) return;
      seamPlayerIndex = (seamPlayerIndex + 1) % seamPlayerFrames.length;
      const ctx = seamLoopPlayerCanvas.getContext('2d');
      ctx.clearRect(0, 0, seamLoopPlayerCanvas.width, seamLoopPlayerCanvas.height);
      ctx.drawImage(seamPlayerFrames[seamPlayerIndex], 0, 0);
    }, interval);
  }

  function stopSeamPlayer() {
    if (seamPlayerTimer) {
      clearInterval(seamPlayerTimer);
      seamPlayerTimer = null;
    }
    if (lblSeamPlay) lblSeamPlay.textContent = 'Play';
    if (iconSeamPlay) {
      iconSeamPlay.setAttribute('data-lucide', 'play');
      lucide.createIcons({ root: btnToggleSeamPlay });
    }
  }

  async function setupFullCyclePlayer(cand, w, h, cLeft, cTop, cropW, cropH) {
    stopFullCyclePlayer();
    fullCycleFrames = [];

    const totalFrames = cand.calculatedFrames || parseInt(inputLoopTargetFrames?.value, 10) || 24;
    const timestamps = computeLoopTimestamps(cand.startTime, cand.endTime, totalFrames, true);

    for (let i = 0; i < timestamps.length; i++) {
      const t = timestamps[i];
      await seekVideoAsync(video, t);
      const cvs = document.createElement('canvas');
      cvs.width = w;
      cvs.height = h;
      const ctx = cvs.getContext('2d');
      ctx.drawImage(video, cLeft, cTop, cropW, cropH, 0, 0, w, h);
      if (chkTransparentFormat.checked && state.keyColors.length > 0) {
        let img = ctx.getImageData(0, 0, w, h);
        const cycleKeyResult = runKeyer(img, buildChromaOptions({ enabled: true }));
        img = cycleKeyResult.imageData;
        ctx.putImageData(img, 0, 0);
      }
      fullCycleFrames.push(cvs);
    }

    if (seamFullCycleCanvas) {
      seamFullCycleCanvas.width = w;
      seamFullCycleCanvas.height = h;
    }
    startFullCyclePlayer();
  }

  function startFullCyclePlayer() {
    stopFullCyclePlayer();
    if (fullCycleFrames.length === 0 || !seamFullCycleCanvas) return;
    fullCycleIndex = 0;
    if (lblFullCyclePlay) lblFullCyclePlay.textContent = 'Pause';
    if (iconFullCyclePlay) {
      iconFullCyclePlay.setAttribute('data-lucide', 'pause');
      lucide.createIcons({ root: btnToggleFullCyclePlay });
    }

    const fps = activeSeamCandidate?.calculatedFps || parseInt(selectLoopTargetFps?.value, 10) || 12;
    const interval = 1000 / fps;

    fullCycleTimer = setInterval(() => {
      if (fullCycleFrames.length === 0 || !seamFullCycleCanvas) return;
      fullCycleIndex = (fullCycleIndex + 1) % fullCycleFrames.length;
      const ctx = seamFullCycleCanvas.getContext('2d');
      ctx.clearRect(0, 0, seamFullCycleCanvas.width, seamFullCycleCanvas.height);
      ctx.drawImage(fullCycleFrames[fullCycleIndex], 0, 0);
      if (lblFullCycleFrameBadge) {
        lblFullCycleFrameBadge.textContent = `${fullCycleIndex + 1} / ${fullCycleFrames.length} frames`;
      }
    }, interval);
  }

  function stopFullCyclePlayer() {
    if (fullCycleTimer) {
      clearInterval(fullCycleTimer);
      fullCycleTimer = null;
    }
    if (lblFullCyclePlay) lblFullCyclePlay.textContent = 'Play Action';
    if (iconFullCyclePlay) {
      iconFullCyclePlay.setAttribute('data-lucide', 'play');
      lucide.createIcons({ root: btnToggleFullCyclePlay });
    }
  }

  async function startLoopScan() {
    if (!state.videoLoaded || state.isScanningLoops) return;
    state.isScanningLoops = true;
    if (btnStartLoopScan) btnStartLoopScan.disabled = true;
    if (lblStartLoopScan) lblStartLoopScan.textContent = 'Đang quét...';
    if (loopScanProgressContainer) loopScanProgressContainer.style.display = 'block';
    if (loopScanProgressBar) loopScanProgressBar.style.width = '0%';
    if (loopScanStatusText) loopScanStatusText.textContent = 'Bắt đầu trích xuất và phân tích chu kỳ video...';

    const scope = selectLoopScope ? selectLoopScope.value : 'full';
    const searchStart = scope === 'trim' ? state.trimStart : 0;
    const searchEnd = scope === 'trim' ? state.trimEnd : state.duration;

    const speed = parseFloat(selectLoopSpeed?.value) || 2;
    const targetFrames = parseInt(inputLoopTargetFrames?.value, 10) || 24;
    const targetFps = parseInt(selectLoopTargetFps?.value, 10) || 12;

    const crop = {
      top: parseInt(inputCropTop.value, 10) || 0,
      bottom: parseInt(inputCropBottom.value, 10) || 0,
      left: parseInt(inputCropLeft.value, 10) || 0,
      right: parseInt(inputCropRight.value, 10) || 0
    };

    const chromaOptions = {
      enabled: chkTransparentFormat.checked,
      keyColors: state.keyColors,
      similarity: parseFloat(sliderSimilarity.value),
      blend: parseFloat(sliderBlend.value),
      spill: parseFloat(sliderSpill.value),
      subjectProtection: parseFloat(sliderSubjectProtection.value),
      cleanupRadius: parseInt(sliderEdgeCleanup.value, 10)
    };

    try {
      const candidates = await scanVideoForOptimalLoops(video, {
        duration: state.duration,
        searchStart,
        searchEnd,
        playbackSpeed: speed,
        targetFrames,
        targetFps,
        sampleRate: 20,
        chromaOptions,
        cropOptions: crop,
        seekVideoAsync,
        onProgress: (pct, status) => {
          if (loopScanProgressBar) loopScanProgressBar.style.width = `${pct}%`;
          if (loopScanStatusText) loopScanStatusText.textContent = status;
        }
      });

      state.loopCandidates = candidates;
      renderLoopCandidates(candidates);

      if (candidates.length > 0) {
        inspectSeamCandidate(candidates[0]);
        showToast(`Tìm thấy ${candidates.length} chu kỳ lặp (~${targetFrames} frames @ ${speed}x)!`, 'success');
      } else {
        showToast('Không tìm thấy chu kỳ lặp rõ rệt trong phạm vi này. Hãy thử đổi tốc độ Speed hoặc phạm vi quét.', 'info');
      }
    } catch (err) {
      console.error(err);
      showToast(`Quét chu kỳ thất bại: ${err.message}`, 'error');
      if (loopScanStatusText) loopScanStatusText.textContent = 'Quét thất bại.';
    } finally {
      state.isScanningLoops = false;
      if (btnStartLoopScan) btnStartLoopScan.disabled = false;
      if (lblStartLoopScan) lblStartLoopScan.textContent = 'Quét tìm chu kỳ ~24f';
      setTimeout(() => {
        if (loopScanProgressContainer) loopScanProgressContainer.style.display = 'none';
      }, 1200);
    }
  }

  function renderLoopCandidates(candidates) {
    if (!loopCandidatesList) return;
    loopCandidatesList.innerHTML = '';
    if (loopCandidateCountBadge) loopCandidateCountBadge.textContent = `${candidates.length} found`;

    if (!candidates || candidates.length === 0) {
      loopCandidatesList.innerHTML = `
        <div class="loop-empty-notice">
          <i data-lucide="info" style="width: 28px; height: 28px; color: #64748b;"></i>
          <p>Không tìm thấy chu kỳ lặp phù hợp. Hãy thử tăng tốc độ Speed hoặc mở rộng phạm vi quét.</p>
        </div>
      `;
      lucide.createIcons({ root: loopCandidatesList });
      return;
    }

    candidates.forEach((cand, idx) => {
      const card = document.createElement('div');
      card.className = `loop-candidate-card ${idx === 0 ? 'active' : ''}`;
      card.dataset.id = cand.id;

      const candFrames = cand.calculatedFrames || 24;
      const candSpeed = cand.speed || 1;
      const candFps = cand.calculatedFps || 12;

      card.innerHTML = `
        <div class="loop-card-top">
          <span style="font-weight: 700; color: #f8fafc; font-size: 0.84rem;">Ứng viên #${idx + 1}</span>
          <span class="loop-score-badge ${cand.score >= 88 ? 'high' : 'medium'}">${cand.score}% khớp</span>
        </div>
        <div class="loop-card-details">
          <span>${formatTime(cand.startTime)} → ${formatTime(cand.endTime)} (${cand.duration.toFixed(2)}s video)</span>
          <span>⚡ ${candSpeed}x Speed ➔ <strong>${candFrames} frames</strong> @ ${candFps} FPS (${cand.effectiveDuration.toFixed(2)}s)</span>
        </div>
        <div class="loop-card-thumbs">
          <img class="loop-card-thumb-img" src="${cand.startThumb}" alt="Start" title="Frame 0 (Start)">
          <i data-lucide="arrow-right" style="width: 14px; height: 14px; color: #38bdf8;"></i>
          <img class="loop-card-thumb-img" src="${cand.endThumb}" alt="End" title="Frame End">
        </div>
        <div class="loop-card-actions">
          <button class="time-btn btn-apply-cand" type="button" style="flex: 1; justify-content: center; font-size: 0.74rem;">
            <i data-lucide="check" style="width: 12px; height: 12px;"></i>
            <span>Áp dụng chu kỳ</span>
          </button>
        </div>
      `;

      card.addEventListener('click', (e) => {
        if (e.target.closest('.btn-apply-cand')) {
          applyCandidateToTimeline(cand);
          return;
        }
        document.querySelectorAll('.loop-candidate-card').forEach((c) => c.classList.remove('active'));
        card.classList.add('active');
        inspectSeamCandidate(cand);
      });

      const btnApply = card.querySelector('.btn-apply-cand');
      btnApply.addEventListener('click', (e) => {
        e.stopPropagation();
        applyCandidateToTimeline(cand);
      });

      loopCandidatesList.appendChild(card);
    });

    lucide.createIcons({ root: loopCandidatesList });
  }

  function applyCandidateToTimeline(cand) {
    if (!cand) return;
    applyTrimStart(cand.startTime, false);
    applyTrimEnd(cand.endTime, true);

    if (cand.speed) {
      setPlaybackSpeed(cand.speed, { toast: false, syncInputs: true, persist: true });
    }
    if (cand.calculatedFrames) {
      inputFrames.value = String(cand.calculatedFrames);
    }
    if (cand.calculatedFps) {
      inputFps.value = String(cand.calculatedFps);
      state.previewFpsIsManual = true;
    }

    updateSpeedEffectiveHint();
    saveClipStateDebounced();
    showToast(`Đã áp dụng chu kỳ: ${formatTime(cand.startTime)} → ${formatTime(cand.endTime)} (${cand.calculatedFrames || 24} frames @ ${cand.speed || 1}x)`, 'success');
    closeLoopModal();
  }

  // Loop Modal Event Listeners
  btnAutoLoopFinder?.addEventListener('click', openLoopModal);
  btnOpenLoopModalFromSettings?.addEventListener('click', openLoopModal);
  btnCloseLoopModal?.addEventListener('click', closeLoopModal);
  btnStartLoopScan?.addEventListener('click', startLoopScan);
  btnToggleSeamPlay?.addEventListener('click', () => {
    if (seamPlayerTimer) stopSeamPlayer();
    else startSeamPlayer();
  });
  btnToggleFullCyclePlay?.addEventListener('click', () => {
    if (fullCycleTimer) stopFullCyclePlayer();
    else startFullCyclePlayer();
  });

  btnNudgeStartBack?.addEventListener('click', async () => {
    if (!activeSeamCandidate) return;
    activeSeamCandidate.startTime = Math.max(0, activeSeamCandidate.startTime - 0.02);
    activeSeamCandidate.duration = Math.max(0.05, activeSeamCandidate.endTime - activeSeamCandidate.startTime);
    activeSeamCandidate.effectiveDuration = activeSeamCandidate.duration / (activeSeamCandidate.speed || 1);
    await inspectSeamCandidate(activeSeamCandidate);
  });

  btnNudgeStartForward?.addEventListener('click', async () => {
    if (!activeSeamCandidate) return;
    activeSeamCandidate.startTime = Math.min(activeSeamCandidate.endTime - 0.05, activeSeamCandidate.startTime + 0.02);
    activeSeamCandidate.duration = Math.max(0.05, activeSeamCandidate.endTime - activeSeamCandidate.startTime);
    activeSeamCandidate.effectiveDuration = activeSeamCandidate.duration / (activeSeamCandidate.speed || 1);
    await inspectSeamCandidate(activeSeamCandidate);
  });

  btnNudgeEndBack?.addEventListener('click', async () => {
    if (!activeSeamCandidate) return;
    activeSeamCandidate.endTime = Math.max(activeSeamCandidate.startTime + 0.05, activeSeamCandidate.endTime - 0.02);
    activeSeamCandidate.duration = Math.max(0.05, activeSeamCandidate.endTime - activeSeamCandidate.startTime);
    activeSeamCandidate.effectiveDuration = activeSeamCandidate.duration / (activeSeamCandidate.speed || 1);
    await inspectSeamCandidate(activeSeamCandidate);
  });

  btnNudgeEndForward?.addEventListener('click', async () => {
    if (!activeSeamCandidate) return;
    activeSeamCandidate.endTime = Math.min(state.duration, activeSeamCandidate.endTime + 0.02);
    activeSeamCandidate.duration = Math.max(0.05, activeSeamCandidate.endTime - activeSeamCandidate.startTime);
    activeSeamCandidate.effectiveDuration = activeSeamCandidate.duration / (activeSeamCandidate.speed || 1);
    await inspectSeamCandidate(activeSeamCandidate);
  });

  btnApplyLoopToTimeline?.addEventListener('click', () => {
    if (activeSeamCandidate) {
      applyCandidateToTimeline(activeSeamCandidate);
    }
  });

  modalLoopFinder?.addEventListener('click', (e) => {
    if (e.target === modalLoopFinder) closeLoopModal();
  });

  // Settings Sidebar Loop Controls
  chkClosedLoop?.addEventListener('change', () => {
    state.isClosedLoop = chkClosedLoop.checked;
    if (loopStatusBadge) {
      loopStatusBadge.textContent = state.isClosedLoop ? 'Closed Loop' : 'Open Range';
      loopStatusBadge.style.color = state.isClosedLoop ? '#38bdf8' : '#94a3b8';
    }
    saveClipStateDebounced();
  });

  syncSliderAndNumber(sliderLoopCrossfade, numLoopCrossfade, {
    decimals: 0,
    onChange: () => {
      const val = parseInt(sliderLoopCrossfade.value, 10) || 0;
      state.loopCrossfade = val;
      if (lblLoopCrossfadeVal) {
        lblLoopCrossfadeVal.textContent = val === 0 ? '0 frames (Off)' : `${val} frame${val > 1 ? 's' : ''}`;
      }
      saveClipStateDebounced();
    }
  });

  chkPingPongLoop?.addEventListener('change', () => {
    state.pingPongLoop = chkPingPongLoop.checked;
    state.pingPongDirection = 1;
    saveClipStateDebounced();
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
