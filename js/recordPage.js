// Webcam record page: camera + optional VRM face overlay (expressions / mouth).

import { WebcamRecorder } from './webcamRecorder.js';
import { formatDuration, CanvasRecorder } from './recorder.js';
import { RecordFaceOverlay } from './recordFaceOverlay.js';
import { getRecordFaceSettings, saveRecordFaceSettings } from './recordStore.js';
import { listModels, getModelSource } from './modelStore.js';
import { pipelineStatusText } from './recordPipeline.js';
import {
  formatHeadCoordinateLines,
  suggestPlacementSliderDelta,
  PLACEMENT_SLIDER_MAX,
} from './headCoordinateMatch.js';

const video = document.getElementById('preview');
const overlayCanvas = document.getElementById('face-overlay');
const compositeCanvas = document.getElementById('composite-canvas');
const modelLoadBadge = document.getElementById('model-load-badge');
const showFullBodyInput = document.getElementById('show-full-body');
const reverseHeadPositionInput = document.getElementById('reverse-head-position');
const reverseHeadRotationInput = document.getElementById('reverse-head-rotation');
const reverseFaceMotionInput = document.getElementById('reverse-face-motion');
const playback = document.getElementById('playback');
const loading = document.getElementById('loading');
const loadingText = document.getElementById('loading-text');
const toast = document.getElementById('toast');
const timerEls = document.querySelectorAll('[data-rec-timer]');
const recBadge = document.getElementById('rec-badge');
const statusEl = document.getElementById('status-line');
const mirrorInput = document.getElementById('mirror-toggle');
const includeAudioInput = document.getElementById('include-audio');
const faceOverlayInput = document.getElementById('face-overlay-toggle');
const modelSelect = document.getElementById('model-select');
const faceScaleInput = document.getElementById('face-scale');
const faceScaleVal = document.getElementById('face-scale-val');
const bodyScaleInput = document.getElementById('body-scale');
const bodyScaleVal = document.getElementById('body-scale-val');
const alignInput = document.getElementById('face-align');
const alignVal = document.getElementById('face-align-val');
const offsetXInput = document.getElementById('offset-x');
const offsetXVal = document.getElementById('offset-x-val');
const offsetYInput = document.getElementById('offset-y');
const offsetYVal = document.getElementById('offset-y-val');
const offsetRotYInput = document.getElementById('offset-rot-y');
const offsetRotYVal = document.getElementById('offset-rot-y-val');
const btnOffsetReset = document.getElementById('btn-offset-reset');
const trackingStatus = document.getElementById('tracking-status');
const pipelineStatus = document.getElementById('pipeline-status');
const headCoordLines = document.getElementById('head-coord-lines');
const btnMatchHeadCoords = document.getElementById('btn-match-head-coords');

const btnRecord = document.getElementById('btn-record');
const btnPause = document.getElementById('btn-pause');
const btnResume = document.getElementById('btn-resume');
const btnStop = document.getElementById('btn-stop');
const btnDownload = document.getElementById('btn-download');
const btnNew = document.getElementById('btn-new');

let recorder = null;
let faceOverlay = null;
let previewUrl = null;
let toastTimer = null;
let compositeRaf = null;
let recordSettings = getRecordFaceSettings();
/** After webcam is live, avoid fullscreen loader covering the character overlay. */
let viewportReady = false;

function showToast(msg, isError = false) {
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.toggle('error', !!isError);
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}

function setLoading(text, visible) {
  if (loadingText && text) loadingText.textContent = text;
  if (viewportReady && visible) {
    if (modelLoadBadge && text) modelLoadBadge.textContent = text;
    return;
  }
  if (loading) loading.classList.toggle('hidden', !visible);
}

function updateTimer(ms) {
  const t = formatDuration(ms);
  timerEls.forEach((el) => { el.textContent = t; });
}

function isFaceMode() {
  return faceOverlayInput?.checked !== false && recordSettings.faceOverlayEnabled !== false;
}

function applyMirror() {
  const mirror = mirrorInput?.checked !== false;
  recordSettings.mirror = mirror;
  // Mirror video only — flipping the overlay canvas inverts X twice with tracking.
  if (video) video.style.transform = mirror ? 'scaleX(-1)' : 'none';
  if (playback) playback.style.transform = mirror ? 'scaleX(-1)' : 'none';
  if (overlayCanvas) overlayCanvas.style.transform = 'none';
  if (faceOverlay) {
    faceOverlay.setOptions({ mirror });
    faceOverlay.tracking?.setMirrorPreview?.(mirror);
  }
}

function syncFaceUi() {
  const on = isFaceMode();
  if (overlayCanvas) overlayCanvas.classList.toggle('hidden', !on);
  if (modelSelect) modelSelect.disabled = !on;
  if (faceScaleInput) faceScaleInput.disabled = !on;
  if (bodyScaleInput) bodyScaleInput.disabled = !on;
  if (alignInput) alignInput.disabled = !on;
  if (offsetXInput) offsetXInput.disabled = !on;
  if (offsetYInput) offsetYInput.disabled = !on;
  if (offsetRotYInput) offsetRotYInput.disabled = !on;
  if (btnOffsetReset) btnOffsetReset.disabled = !on;
}

function applyPlacementFromUi() {
  if (!faceOverlay) return;
  faceOverlay.setOptions({
    offsetX: Number(offsetXInput?.value ?? 0),
    offsetY: Number(offsetYInput?.value ?? 0),
    offsetRotY: Number(offsetRotYInput?.value ?? 0),
  });
}

function formatBodyScaleLabel(v) {
  const n = Number(v);
  if (n <= 0.04) return 'Hidden';
  return `${Math.round(n * 100)}%`;
}

function configurePlacementSliders() {
  const max = String(PLACEMENT_SLIDER_MAX);
  if (offsetXInput) {
    offsetXInput.min = `-${max}`;
    offsetXInput.max = max;
  }
  if (offsetYInput) {
    offsetYInput.min = `-${max}`;
    offsetYInput.max = max;
  }
}

function persistFaceSettings() {
  saveRecordFaceSettings({
    faceOverlayEnabled: faceOverlayInput?.checked !== false,
    modelId: modelSelect?.value || recordSettings.modelId,
    faceScale: Number(faceScaleInput?.value ?? recordSettings.faceScale),
    bodyScale: Math.max(0, Number(bodyScaleInput?.value ?? recordSettings.bodyScale)),
    alignStrength: Number(alignInput?.value ?? recordSettings.alignStrength),
    mirror: mirrorInput?.checked !== false,
    showFullBody: showFullBodyInput?.checked === true,
    reverseHeadPosition: reverseHeadPositionInput?.checked === true,
    reverseHeadRotation: reverseHeadRotationInput?.checked === true,
    reverseFaceMotion: reverseFaceMotionInput?.checked === true,
    offsetX: Number(offsetXInput?.value ?? recordSettings.offsetX),
    offsetY: Number(offsetYInput?.value ?? recordSettings.offsetY),
    offsetRotY: Number(offsetRotYInput?.value ?? recordSettings.offsetRotY),
  });
  recordSettings = getRecordFaceSettings();
}

function updatePipelineUi(pipe) {
  if (!pipe || !pipelineStatus) return;
  pipelineStatus.textContent = pipelineStatusText(pipe);
  pipelineStatus.classList.toggle('ok', pipe.allReady);
  pipelineStatus.classList.toggle('warn', !pipe.allReady);
}

function updateHeadCoordUi(report) {
  if (!headCoordLines) return;
  const lines = formatHeadCoordinateLines(report);
  headCoordLines.textContent = lines.join('\n');
  headCoordLines.classList.remove('match-good', 'match-fair', 'match-poor');
  if (report?.matchQuality === 'good') headCoordLines.classList.add('match-good');
  else if (report?.matchQuality === 'fair') headCoordLines.classList.add('match-fair');
  else if (report?.matchQuality === 'poor') headCoordLines.classList.add('match-poor');
}

function updateModelUi(d) {
  if (d?.pipeline) updatePipelineUi(d.pipeline);
  if (d?.headCoords) updateHeadCoordUi(d.headCoords);
  if (modelLoadBadge) {
    if (!d?.modelLoaded) {
      modelLoadBadge.textContent = 'Model not loaded';
      modelLoadBadge.className = 'load-badge pending';
    } else if (d.visibleMeshes === 0) {
      modelLoadBadge.textContent = `${d.modelName} — 0 visible meshes`;
      modelLoadBadge.className = 'load-badge error';
    } else if (d.pipeline?.allReady) {
      modelLoadBadge.textContent = `✓ ${d.modelName} — full pipeline active`;
      modelLoadBadge.className = 'load-badge';
    } else if (d.visibleMeshes > 0) {
      modelLoadBadge.textContent = `✓ ${d.modelName} — ${d.visibleMeshes} head meshes (overlay)`;
      modelLoadBadge.className = 'load-badge';
    } else if (d.pipeline?.threejs) {
      modelLoadBadge.textContent = `${d.modelName} — VRM loaded, 0 visible meshes`;
      modelLoadBadge.className = 'load-badge error';
    } else {
      modelLoadBadge.textContent = `Loading ${d.modelName}…`;
      modelLoadBadge.className = 'load-badge pending';
    }
  }
  if (statusEl && isFaceMode() && d?.modelLoaded) {
    if (d.pipeline?.allReady) {
      statusEl.textContent = 'Face overlay active — move your head to test';
    } else if (d.pipeline?.webgl) {
      statusEl.textContent = d.pipeline?.alignment
        ? 'Face aligned — move your head to test'
        : d.pipeline?.landmarks
          ? 'Landmarks OK — aligning 3D face…'
          : 'Look at the camera for face detection';
    } else if (d.visibleMeshes === 0) {
      statusEl.textContent = 'Model loaded but no visible meshes — try another VRM';
    } else {
      statusEl.textContent = 'Loading overlay…';
    }
  }
}

function setUiState(state) {
  const recording = state === 'recording';
  const paused = state === 'paused';
  const finished = state === 'finished';
  const active = recording || paused;

  if (recBadge) {
    recBadge.classList.toggle('visible', active);
    recBadge.classList.toggle('paused', paused);
  }
  if (statusEl) {
    const labels = {
      idle: isFaceMode()
        ? 'Ready — only the VRM head follows your face (body stays fixed)'
        : 'Ready — press Record to start',
      recording: 'Recording…',
      paused: 'Paused',
      finished: 'Recording saved — preview below or download',
    };
    statusEl.textContent = labels[state] || '';
  }

  if (btnRecord) btnRecord.disabled = active || finished;
  if (btnPause) {
    btnPause.disabled = !recording;
    btnPause.hidden = !WebcamRecorder.supportsPauseResume();
  }
  if (btnResume) {
    btnResume.disabled = !paused;
    btnResume.hidden = !WebcamRecorder.supportsPauseResume();
  }
  if (btnStop) btnStop.disabled = !active;
  if (btnDownload) btnDownload.disabled = !finished;
  if (btnNew) btnNew.disabled = !finished;

  if (video) video.classList.toggle('hidden', finished);
  if (overlayCanvas) overlayCanvas.classList.toggle('hidden', finished || !isFaceMode());
  if (playback) playback.classList.toggle('visible', finished);
}

function revokePreview() {
  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
    previewUrl = null;
  }
  if (playback) {
    playback.removeAttribute('src');
    playback.load?.();
  }
}

function showPlayback(blob) {
  revokePreview();
  previewUrl = URL.createObjectURL(blob);
  if (playback) {
    playback.src = previewUrl;
    playback.play?.().catch(() => {});
  }
}

function stopCompositeTick() {
  if (compositeRaf) {
    cancelAnimationFrame(compositeRaf);
    compositeRaf = null;
  }
}

function startCompositeTick() {
  stopCompositeTick();
  const tick = () => {
    compositeRaf = requestAnimationFrame(tick);
    if (faceOverlay?.enabled && recorder?.isActive()) {
      faceOverlay.drawComposite();
    } else if (!recorder?.isActive()) {
      stopCompositeTick();
    }
  };
  tick();
}

async function populateModels() {
  if (!modelSelect) return;
  const models = await listModels();
  modelSelect.innerHTML = models
    .map(
      (m) =>
        `<option value="${m.id}"${m.id === recordSettings.modelId ? ' selected' : ''}>${m.name}</option>`
    )
    .join('');
}

async function initFaceOverlay() {
  if (!overlayCanvas || !compositeCanvas) return;

  if (!faceOverlay) {
    faceOverlay = new RecordFaceOverlay({
      video,
      overlayCanvas,
      compositeCanvas,
      onStatus: (msg) => {
        if (trackingStatus) trackingStatus.textContent = msg;
      },
      onLoading: (msg) => {
        if (msg) {
          if (!viewportReady) setLoading(msg, true);
          else if (modelLoadBadge) modelLoadBadge.textContent = msg;
        } else if (!viewportReady) {
          setLoading('', false);
        }
      },
      onDiagnostics: (d) => updateModelUi(d),
      onPipeline: (pipe) => updatePipelineUi(pipe),
    });
  }

  faceOverlay.setOptions({
    faceScale: recordSettings.faceScale,
    bodyScale: recordSettings.bodyScale,
    alignStrength: recordSettings.alignStrength,
    mirror: recordSettings.mirror,
    showFullBody: recordSettings.showFullBody === true,
    reverseHeadPosition: recordSettings.reverseHeadPosition === true,
    reverseHeadRotation: recordSettings.reverseHeadRotation === true,
    reverseFaceMotion: recordSettings.reverseFaceMotion === true,
    offsetX: recordSettings.offsetX,
    offsetY: recordSettings.offsetY,
    offsetRotY: recordSettings.offsetRotY,
  });

  if (!isFaceMode()) {
    faceOverlay.disable();
    syncFaceUi();
    return;
  }

  try {
    const { loadJeelizScript } = await import('./jeelizFaceTracking.js');
    await loadJeelizScript().catch(() => {
      if (typeof Holistic === 'undefined') {
        throw new Error('Face tracking did not load. Check your connection and refresh.');
      }
    });
    const modelId = modelSelect?.value || recordSettings.modelId;
    const source = await getModelSource(modelId);
    await faceOverlay.boot(source);
    syncFaceUi();
    updateModelUi(faceOverlay.getDiagnostics());
    showToast(`${source.name} on camera — move your face to test`);
  } catch (e) {
    console.error(e);
    showToast(e.message || 'Could not load character', true);
    syncFaceUi();
  }
}

async function reloadModel() {
  if (!faceOverlay || !isFaceMode()) return;
  persistFaceSettings();
  try {
    const source = await getModelSource(modelSelect?.value || recordSettings.modelId);
    faceOverlay.setOptions({
      faceScale: recordSettings.faceScale,
      bodyScale: recordSettings.bodyScale,
      alignStrength: recordSettings.alignStrength,
      mirror: recordSettings.mirror,
      showFullBody: recordSettings.showFullBody === true,
      reverseHeadPosition: recordSettings.reverseHeadPosition === true,
    reverseHeadRotation: recordSettings.reverseHeadRotation === true,
    reverseFaceMotion: recordSettings.reverseFaceMotion === true,
      offsetX: recordSettings.offsetX,
      offsetY: recordSettings.offsetY,
      offsetRotY: recordSettings.offsetRotY,
    });
    await faceOverlay.loadModel(source);
    if (!faceOverlay.tracking?.holistic) {
      await faceOverlay.warmTracking();
    }
    faceOverlay.enable();
    setLoading('', false);
    updateModelUi(faceOverlay.getDiagnostics());
    showToast(`${source.name} on camera`);
  } catch (e) {
    setLoading('', false);
    showToast(e.message || 'Model load failed', true);
  }
}

async function initCamera() {
  if (!WebcamRecorder.isSupported()) {
    setLoading('', false);
    showToast('Recording is not supported in this browser', true);
    [btnRecord, btnPause, btnStop].forEach((b) => {
      if (b) b.disabled = true;
    });
    return;
  }

  recorder = new WebcamRecorder(video, { onTick: updateTimer });

  const audio = includeAudioInput?.checked !== false;
  const constraints = {
    video: {
      facingMode: 'user',
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
    audio,
  };

  try {
    setLoading('Starting camera…', true);
    await recorder.startCamera(constraints);
    viewportReady = true;
    setLoading('', false);
    syncFaceUi();
    if (overlayCanvas) overlayCanvas.classList.remove('hidden');
    await populateModels();
    if (faceScaleInput) faceScaleInput.value = recordSettings.faceScale;
    if (bodyScaleInput) bodyScaleInput.value = recordSettings.bodyScale;
    if (alignInput) alignInput.value = recordSettings.alignStrength;
    if (faceScaleVal) {
      faceScaleVal.textContent = `${Math.round(Number(recordSettings.faceScale) * 100)}%`;
    }
    if (bodyScaleVal) bodyScaleVal.textContent = formatBodyScaleLabel(recordSettings.bodyScale);
    if (alignVal) alignVal.textContent = `${Math.round(recordSettings.alignStrength * 100)}%`;
    configurePlacementSliders();
    if (offsetXInput) offsetXInput.value = recordSettings.offsetX ?? 0;
    if (offsetYInput) offsetYInput.value = recordSettings.offsetY ?? 0;
    if (offsetRotYInput) offsetRotYInput.value = recordSettings.offsetRotY ?? 0;
    if (offsetXVal) offsetXVal.textContent = String(recordSettings.offsetX ?? 0);
    if (offsetYVal) offsetYVal.textContent = String(recordSettings.offsetY ?? 0);
    if (offsetRotYVal) offsetRotYVal.textContent = `${recordSettings.offsetRotY ?? 0}°`;
    if (faceOverlayInput) faceOverlayInput.checked = recordSettings.faceOverlayEnabled !== false;
    if (showFullBodyInput) showFullBodyInput.checked = recordSettings.showFullBody === true;
    if (reverseHeadPositionInput) {
      reverseHeadPositionInput.checked = recordSettings.reverseHeadPosition === true;
    }
    if (reverseHeadRotationInput) {
      reverseHeadRotationInput.checked = recordSettings.reverseHeadRotation === true;
    }
    if (reverseFaceMotionInput) {
      reverseFaceMotionInput.checked = recordSettings.reverseFaceMotion === true;
    }

    await initFaceOverlay();
    setUiState('idle');
    if (overlayCanvas && isFaceMode()) overlayCanvas.classList.remove('hidden');
    if (!isFaceMode()) showToast('Camera ready');
  } catch (e) {
    setLoading('', false);
    console.error(e);
    showToast(e.message || 'Could not access camera', true);
    setUiState('idle');
  }
}

btnRecord?.addEventListener('click', () => {
  try {
    const useComposite = isFaceMode() && faceOverlay?.isReady();
    recorder.startRecording(
      useComposite ? { compositeCanvas, fps: 30 } : undefined
    );
    if (useComposite) startCompositeTick();
    setUiState('recording');
    updateTimer(0);
    showToast('Recording started');
  } catch (e) {
    showToast(e.message || 'Could not start recording', true);
  }
});

btnPause?.addEventListener('click', () => {
  try {
    recorder?.pauseRecording();
    setUiState('paused');
    showToast('Paused');
  } catch (e) {
    showToast(e.message || 'Could not pause', true);
  }
});

btnResume?.addEventListener('click', () => {
  try {
    recorder?.resumeRecording();
    setUiState('recording');
    showToast('Resumed');
  } catch (e) {
    showToast(e.message || 'Could not resume', true);
  }
});

btnStop?.addEventListener('click', async () => {
  if (!recorder) return;
  stopCompositeTick();
  try {
    const elapsed = recorder.getElapsedMs();
    const blob = await recorder.stopRecording();
    if (!blob?.size) {
      showToast('No video data captured', true);
      setUiState('idle');
      return;
    }
    showPlayback(blob);
    setUiState('finished');
    updateTimer(elapsed);
    showToast('Recording stopped');
  } catch (e) {
    showToast(e.message || 'Could not stop recording', true);
    setUiState('idle');
  }
});

btnDownload?.addEventListener('click', () => {
  const blob = recorder?.lastBlob;
  if (!blob) {
    showToast('Nothing to download', true);
    return;
  }
  const ext = recorder.getFileExtension();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  CanvasRecorder.downloadBlob(blob, `webcam-face-${stamp}.${ext}`);
  showToast('Download started');
});

btnNew?.addEventListener('click', () => {
  revokePreview();
  if (recorder) recorder.lastBlob = null;
  updateTimer(0);
  setUiState('idle');
  showToast('Ready for a new recording');
});

faceOverlayInput?.addEventListener('change', async () => {
  persistFaceSettings();
  syncFaceUi();
  if (isFaceMode()) {
    await initFaceOverlay();
  } else if (faceOverlay) {
    faceOverlay.disable();
    showToast('Face overlay off — plain webcam only');
  }
});

modelSelect?.addEventListener('change', () => {
  persistFaceSettings();
  void reloadModel();
});

faceScaleInput?.addEventListener('input', () => {
  const v = Number(faceScaleInput.value);
  if (faceScaleVal) faceScaleVal.textContent = `${Math.round(v * 100)}%`;
  if (faceOverlay) {
    faceOverlay.faceScale = v;
    faceOverlay.setOptions({ faceScale: v });
  }
  persistFaceSettings();
});

bodyScaleInput?.addEventListener('input', () => {
  const v = Number(bodyScaleInput.value);
  if (bodyScaleVal) bodyScaleVal.textContent = formatBodyScaleLabel(v);
  if (faceOverlay) faceOverlay.setOptions({ bodyScale: v });
  persistFaceSettings();
});

alignInput?.addEventListener('input', () => {
  const v = Number(alignInput.value);
  if (alignVal) alignVal.textContent = `${Math.round(v * 100)}%`;
  if (faceOverlay) faceOverlay.setOptions({ alignStrength: v });
  persistFaceSettings();
});

offsetXInput?.addEventListener('input', () => {
  if (offsetXVal) offsetXVal.textContent = offsetXInput.value;
  applyPlacementFromUi();
  persistFaceSettings();
});

offsetYInput?.addEventListener('input', () => {
  if (offsetYVal) offsetYVal.textContent = offsetYInput.value;
  applyPlacementFromUi();
  persistFaceSettings();
});

offsetRotYInput?.addEventListener('input', () => {
  if (offsetRotYVal) offsetRotYVal.textContent = `${offsetRotYInput.value}°`;
  applyPlacementFromUi();
  persistFaceSettings();
});

btnMatchHeadCoords?.addEventListener('click', () => {
  if (!faceOverlay?.vrm) {
    showToast('Load the character first');
    return;
  }
  const report = faceOverlay.getHeadCoordinates?.();
  if (!report?.camera?.detected) {
    showToast('Look at the camera — face not detected');
    return;
  }
  const delta = suggestPlacementSliderDelta(report, 0.85);
  const nextX = THREE.MathUtils.clamp(
    (Number(offsetXInput?.value) || 0) + delta.offsetX,
    -PLACEMENT_SLIDER_MAX,
    PLACEMENT_SLIDER_MAX
  );
  const nextY = THREE.MathUtils.clamp(
    (Number(offsetYInput?.value) || 0) + delta.offsetY,
    -PLACEMENT_SLIDER_MAX,
    PLACEMENT_SLIDER_MAX
  );
  if (offsetXInput) offsetXInput.value = String(nextX);
  if (offsetYInput) offsetYInput.value = String(nextY);
  if (offsetXVal) offsetXVal.textContent = String(nextX);
  if (offsetYVal) offsetYVal.textContent = String(nextY);
  faceOverlay.offsetX = nextX;
  faceOverlay.offsetY = nextY;
  applyPlacementFromUi();
  persistFaceSettings();
  showToast('Initial position nudged toward camera head');
});

btnOffsetReset?.addEventListener('click', () => {
  if (offsetXInput) offsetXInput.value = '0';
  if (offsetYInput) offsetYInput.value = '0';
  if (offsetRotYInput) offsetRotYInput.value = '0';
  if (offsetXVal) offsetXVal.textContent = '0';
  if (offsetYVal) offsetYVal.textContent = '0';
  if (offsetRotYVal) offsetRotYVal.textContent = '0°';
  applyPlacementFromUi();
  persistFaceSettings();
  showToast('Initial position reset');
});

mirrorInput?.addEventListener('change', () => {
  applyMirror();
  persistFaceSettings();
});

function applyTrackingReverseFromUi() {
  persistFaceSettings();
  if (!faceOverlay) return;
  faceOverlay.setOptions({
    reverseHeadPosition: reverseHeadPositionInput?.checked === true,
    reverseHeadRotation: reverseHeadRotationInput?.checked === true,
    reverseFaceMotion: reverseFaceMotionInput?.checked === true,
  });
}

reverseHeadPositionInput?.addEventListener('change', () => {
  applyTrackingReverseFromUi();
  showToast(
    reverseHeadPositionInput.checked
      ? 'Head position reversed'
      : 'Head position normal'
  );
});
reverseHeadRotationInput?.addEventListener('change', () => {
  applyTrackingReverseFromUi();
  showToast(
    reverseHeadRotationInput.checked
      ? 'Head rotation reversed'
      : 'Head rotation normal'
  );
});
reverseFaceMotionInput?.addEventListener('change', () => {
  applyTrackingReverseFromUi();
  showToast(
    reverseFaceMotionInput.checked
      ? 'Face motion reversed'
      : 'Face motion normal'
  );
});

showFullBodyInput?.addEventListener('change', () => {
  persistFaceSettings();
  if (faceOverlay) {
    faceOverlay.setOptions({ showFullBody: showFullBodyInput.checked });
    showToast(
      showFullBodyInput.checked
        ? 'Showing full character on video'
        : 'Face-only overlay mode'
    );
  }
});

includeAudioInput?.addEventListener('change', () => {
  showToast('Reload the page to apply microphone setting');
});

window.addEventListener('beforeunload', () => {
  revokePreview();
  stopCompositeTick();
  faceOverlay?.dispose();
  recorder?.stopCamera();
});

applyMirror();
syncFaceUi();
setUiState('idle');
initCamera();
