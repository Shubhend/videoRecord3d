// ==================== SETTINGS PAGE ====================
// Builds the per-part sensitivity / toggle UI and writes changes
// to the shared settings store.

import {
  getSettings,
  setSettings,
  resetSettings,
  patchTrackingMedia,
  onSettingsChange,
} from './settingsStore.js';
import { AVATAR_PLACEMENTS } from './avatarPlacement.js';
import {
  getBackgroundConfig,
  setBackgroundConfig,
  setBackgroundImage,
  clearBackgroundImage,
  getBackgroundImageBlob,
} from './backgroundStore.js';

const ROWS = {
  face: [
    { key: 'head', label: 'Head & Neck', hint: 'Both the neck and head bones rotate as you turn or tilt your head.' },
    { key: 'eyes', label: 'Eye Blink', hint: 'How aggressively blinks register. Lower if the avatar squints constantly.' },
    { key: 'mouth', label: 'Mouth', hint: 'A/I/U/E/O viseme intensity (face-driven mouth motion).' },
    { key: 'pupils', label: 'Eye Look-At', hint: 'How far the pupils track your gaze direction.' },
    {
      key: 'expressions',
      label: 'Extra Expressions',
      hint: 'Brow raise → Surprise/Fun, frown → Sorrow, smile → Joy. Calibrates to your neutral face in the first ~1.5 seconds.',
    },
    {
      key: 'audioLipSync',
      label: 'Lip-Sync Intensity',
      hint: 'How strong the mouth moves when audio drives lip-sync (face-follow). Independent of face Mouth sensitivity. Range 0–300%.',
      max: 3,
    },
  ],
  body: [
    { key: 'hips', label: 'Waist / Hips', hint: 'Pelvis rotation as you lean or twist.' },
    { key: 'spine', label: 'Spine / Torso', hint: 'Lean and twist of the upper torso.' },
    { key: 'leftArm', label: 'Left Arm', hint: 'Your physical left arm — appears on the avatar\u2019s right when facing you.' },
    { key: 'rightArm', label: 'Right Arm', hint: 'Your physical right arm — appears on the avatar\u2019s left when facing you.' },
    { key: 'leftLeg', label: 'Left Leg', hint: 'Disable if your left leg is out of frame to keep it still.' },
    { key: 'rightLeg', label: 'Right Leg', hint: 'Disable if your right leg is out of frame to keep it still.' },
  ],
  hands: [
    { key: 'leftHand', label: 'Left Hand (wrist + fingers)', hint: 'Wrist orientation. Fingers also follow when the global Fingers toggle is on.' },
    { key: 'rightHand', label: 'Right Hand (wrist + fingers)', hint: 'Wrist orientation. Fingers also follow when the global Fingers toggle is on.' },
    { key: 'fingers', label: 'Fingers (both hands)', hint: 'Individual finger joints. Turn off if finger tracking looks twitchy.' },
  ],
  presence: [
    {
      key: 'distance',
      label: 'Distance / Proximity',
      hint: 'Avatar moves toward the camera when you lean in and away when you lean back. Calibrates automatically in the first ~1.5 seconds of tracking.',
    },
  ],
  smoothing: [
    {
      key: 'autoRelax',
      label: 'Smooth Return to Rest',
      hint: 'When tracking is briefly lost (face turns away, hand off-screen), drift those body parts back to a neutral pose instead of freezing in the last detected position. Sensitivity controls how quickly bones return — higher = snaps back fast, lower = lingers longer.',
    },
  ],
  /** Face-follow lerp rows: stored under settings.smoothing, lower = smoother. */
  faceSmooth: [
    {
      key: 'face',
      label: 'Expression response',
      hint: 'How quickly blinks / brows / smile follow your face. Lower = smoother (less twitchy), higher = snappier.',
      min: 0.08,
      max: 0.4,
      step: 0.01,
    },
    {
      key: 'faceMotion',
      label: 'Tracking motion smooth',
      hint: 'How smoothly the head/avatar follows your face position (face-follow). Lower = smoother motion, higher = sticks closer to raw tracking.',
      min: 0.08,
      max: 0.45,
      step: 0.01,
    },
    {
      key: 'lipSync',
      label: 'Lip-sync smooth',
      hint: 'How smoothly the mouth moves during audio lip-sync. Lower = softer lips, higher = faster viseme changes.',
      min: 0.08,
      max: 0.5,
      step: 0.01,
    },
  ],
  /** Naturalness knobs for audio lip-sync (settings.lipSync). */
  lipSyncNatural: [
    {
      key: 'jawOpen',
      label: 'Jaw open amount',
      hint: 'How wide the jaw opens on open vowels (あ/A). Lower if the mouth looks always open while talking.',
      min: 0,
      max: 1,
      step: 0.05,
    },
    {
      key: 'vowelOpen',
      label: 'Vowel openness',
      hint: 'Overall mouth opening on vowels. Lower = subtler lip motion during speech.',
      min: 0.15,
      max: 1,
      step: 0.05,
    },
    {
      key: 'silenceGate',
      label: 'Silence / close threshold',
      hint: 'Higher = mouth closes more on quiet gaps and soft consonants.',
      min: 0.006,
      max: 0.04,
      step: 0.001,
    },
    {
      key: 'consonantClose',
      label: 'Consonant close',
      hint: 'How much sibilants/consonants pull the lips closed (0 = ignore, 1 = strong close).',
      min: 0,
      max: 1,
      step: 0.05,
    },
    {
      key: 'closeBoost',
      label: 'Close speed',
      hint: 'How fast the mouth closes vs opens. Higher = snappier closes between syllables (more natural chatter).',
      min: 1,
      max: 3.5,
      step: 0.1,
    },
    {
      key: 'secondaryMix',
      label: 'Shape blend',
      hint: 'How much non-dominant mouth shapes stay visible. Lower = clearer single shapes, less “always open” look.',
      min: 0.05,
      max: 0.45,
      step: 0.01,
    },
  ],
  camera: [
    {
      key: 'smoothness',
      label: 'Transition smoothness',
      hint: 'How smoothly the camera moves between your saved views.',
      max: 0.18,
      min: 0.02,
      step: 0.01,
      format: (v) => `${Math.round(v * 100)}%`,
    },
    {
      key: 'shotMinSec',
      label: 'Min seconds per shot',
      hint: 'Shortest time before a random angle change (audio / record).',
      max: 12,
      min: 1.5,
      step: 0.5,
      format: (v) => `${v.toFixed(1)}s`,
      path: 'camera',
    },
    {
      key: 'shotMaxSec',
      label: 'Max seconds per shot',
      hint: 'Longest time before a random angle change.',
      max: 20,
      min: 3,
      step: 0.5,
      format: (v) => `${v.toFixed(1)}s`,
      path: 'camera',
    },
  ],
};

const toast = document.getElementById('toast');
let toastTimer = null;
function showToast(msg) {
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 1600);
}

function pct(v) {
  return `${Math.round(v * 100)}%`;
}

function buildRow(def, settings) {
  const enabled = !!settings.enabled[def.key];
  const sens = Number(settings.sensitivity[def.key] ?? 1);
  const max = Number(def.max ?? 2);
  const highThreshold = max * 0.7;

  const row = document.createElement('div');
  row.className = 'row';
  row.innerHTML = `
    <div class="row-label">
      <label class="switch" aria-label="Enable ${def.label}">
        <input type="checkbox" data-toggle="${def.key}" ${enabled ? 'checked' : ''} />
        <span class="track"></span>
        <span class="thumb"></span>
      </label>
      <div>
        <span class="label-text">${def.label}</span>
        <span class="label-hint">${def.hint}</span>
      </div>
    </div>
    <input
      type="number" min="0" max="${max}" step="0.05"
      class="num-input ${sens > highThreshold ? 'high' : ''}"
      data-num="${def.key}"
      data-max="${max}"
      value="${sens}"
      ${enabled ? '' : 'disabled'}
    />
  `;
  return row;
}

function renderInto(containerId, defs, settings) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';
  defs.forEach((def) => container.appendChild(buildRow(def, settings)));
}

function buildCameraRow(def, settings) {
  const cam = settings.camera || {};
  const val = Number(cam[def.key] ?? def.min ?? 1);
  const min = Number(def.min ?? 0);
  const max = Number(def.max ?? 2);
  const step = def.step ?? 0.05;
  const fmt = def.format || pct;

  const row = document.createElement('div');
  row.className = 'row';
  row.innerHTML = `
    <div class="row-label">
      <div>
        <span class="label-text">${def.label}</span>
        <span class="label-hint">${def.hint}</span>
      </div>
    </div>
    <input
      type="number" min="${min}" max="${max}" step="${step}"
      class="num-input"
      data-cam-num="${def.key}"
      value="${val}"
    />
  `;
  return row;
}

function renderCameraPanel() {
  const settings = getSettings();
  const cam = settings.camera || {};
  const container = document.getElementById('rows-camera');
  if (!container) return;
  container.innerHTML = '';
  ROWS.camera.forEach((def) => container.appendChild(buildCameraRow(def, settings)));

  const map = [
    ['cam-enabled', 'enabled'],
    ['cam-auto-audio', 'autoOnAudio'],
    ['cam-auto-record', 'autoOnRecord'],
    ['cam-auto-live', 'autoOnLive'],
    ['cam-speech-cuts', 'useSpeechCuts'],
  ];
  map.forEach(([id, key]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.checked = cam[key] !== false;
  });

  const changeMode = document.getElementById('cam-change-mode');
  if (changeMode) {
    changeMode.value = cam.changeMode === 'hold' ? 'hold' : 'random';
  }

  container.querySelectorAll('input[data-cam-num]').forEach((input) => {
    const key = input.dataset.camNum;
    const save = () => {
      const v = Number(input.value);
      if (!Number.isFinite(v)) return;
      setSettings({ camera: { [key]: v } });
    };
    input.addEventListener('input', save);
    input.addEventListener('change', save);
  });
}

function bindCameraChangeMode() {
  const el = document.getElementById('cam-change-mode');
  if (!el) return;
  el.addEventListener('change', () => {
    setSettings({ camera: { changeMode: el.value } });
    showToast(
      el.value === 'hold' ? 'Camera: hold one angle' : 'Camera: random cuts'
    );
  });
}

function bindCameraCheckboxes() {
  const map = [
    ['cam-enabled', 'enabled'],
    ['cam-auto-audio', 'autoOnAudio'],
    ['cam-auto-record', 'autoOnRecord'],
    ['cam-auto-live', 'autoOnLive'],
    ['cam-speech-cuts', 'useSpeechCuts'],
  ];
  map.forEach(([id, key]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', () => {
      setSettings({ camera: { [key]: el.checked } });
      showToast(`${key}: ${el.checked ? 'on' : 'off'}`);
    });
  });
}

function buildSmoothLerpRow(def, settings) {
  const smooth = settings.smoothing || {};
  const val = Number(smooth[def.key] ?? def.min ?? 0.2);
  const min = Number(def.min ?? 0.08);
  const max = Number(def.max ?? 0.4);
  const step = def.step ?? 0.01;

  const row = document.createElement('div');
  row.className = 'row';
  row.innerHTML = `
    <div class="row-label">
      <div>
        <span class="label-text">${def.label}</span>
        <span class="label-hint">${def.hint}</span>
      </div>
    </div>
    <input
      type="number" min="${min}" max="${max}" step="${step}"
      class="num-input"
      data-smooth-num="${def.key}"
      value="${val}"
    />
  `;
  return row;
}

function renderFaceSmoothPanel() {
  const settings = getSettings();
  const container = document.getElementById('rows-face-smooth');
  if (!container) return;
  container.innerHTML = '';
  ROWS.faceSmooth.forEach((def) => container.appendChild(buildSmoothLerpRow(def, settings)));

  container.querySelectorAll('input[data-smooth-num]').forEach((input) => {
    const key = input.dataset.smoothNum;
    const save = () => {
      const v = Number(input.value);
      if (!Number.isFinite(v)) return;
      setSettings({ smoothing: { [key]: v } });
      showToast(`${labelFor(key)}: ${v.toFixed(2)}`);
    };
    input.addEventListener('input', save);
    input.addEventListener('change', save);
  });
}

function buildLipSyncNaturalRow(def, settings) {
  const cfg = settings.lipSync || {};
  const val = Number(cfg[def.key] ?? def.min ?? 0);
  const min = Number(def.min ?? 0);
  const max = Number(def.max ?? 1);
  const step = def.step ?? 0.05;

  const row = document.createElement('div');
  row.className = 'row';
  row.innerHTML = `
    <div class="row-label">
      <div>
        <span class="label-text">${def.label}</span>
        <span class="label-hint">${def.hint}</span>
      </div>
    </div>
    <input
      type="number" min="${min}" max="${max}" step="${step}"
      class="num-input"
      data-lipsync-num="${def.key}"
      value="${val}"
    />
  `;
  return row;
}

function renderLipSyncNaturalPanel() {
  const settings = getSettings();
  const container = document.getElementById('rows-lipsync-natural');
  if (!container) return;
  container.innerHTML = '';
  ROWS.lipSyncNatural.forEach((def) => container.appendChild(buildLipSyncNaturalRow(def, settings)));

  container.querySelectorAll('input[data-lipsync-num]').forEach((input) => {
    const key = input.dataset.lipsyncNum;
    const save = () => {
      const v = Number(input.value);
      if (!Number.isFinite(v)) return;
      setSettings({ lipSync: { [key]: v } });
      showToast(`${labelFor(key)}: ${v}`);
    };
    input.addEventListener('input', save);
    input.addEventListener('change', save);
  });
}

function render() {
  const settings = getSettings();
  renderInto('rows-face', ROWS.face, settings);
  renderInto('rows-body', ROWS.body, settings);
  renderInto('rows-hands', ROWS.hands, settings);
  renderInto('rows-presence', ROWS.presence, settings);
  renderInto('rows-smoothing', ROWS.smoothing, settings);
  renderFaceSmoothPanel();
  renderLipSyncNaturalPanel();
  renderCameraPanel();
  bindRowEvents();
}

function bindRowEvents() {
  document.querySelectorAll('input[data-toggle]').forEach((input) => {
    input.addEventListener('change', () => {
      const key = input.dataset.toggle;
      const checked = input.checked;
      setSettings({ enabled: { [key]: checked } });
      const numInput = document.querySelector(`input[data-num="${key}"]`);
      if (numInput) numInput.disabled = !checked;
      showToast(`${labelFor(key)}: ${checked ? 'on' : 'off'}`);
    });
  });

  document.querySelectorAll('input[data-num]').forEach((input) => {
    const max = Number(input.dataset.max ?? 2);
    const highThreshold = max * 0.7;
    const save = () => {
      const key = input.dataset.num;
      const v = Number(input.value);
      if (!Number.isFinite(v)) return;
      input.classList.toggle('high', v > highThreshold);
      setSettings({ sensitivity: { [key]: v } });
    };
    input.addEventListener('input', save);
    input.addEventListener('change', save);
  });
}

function labelFor(key) {
  for (const group of Object.values(ROWS)) {
    const found = group.find((d) => d.key === key);
    if (found) return found.label;
  }
  return key;
}

document.getElementById('reset').addEventListener('click', () => {
  if (!confirm('Reset all sensitivity and tracking settings to defaults?')) return;
  resetSettings();
  render();
  renderBackgroundPanel();
  syncShowGround();
  syncModelSurface();
  syncFloorColor();
  syncTrackingMedia();
  renderPlacementPanel();
  renderCameraPanel();
  showToast('Settings reset to defaults');
});

// ---------- Background panel ----------

const bgRadios = () => Array.from(document.querySelectorAll('input[name="bg-mode"]'));
const bgColorInput = document.getElementById('bg-color-input');
const bgColorThumb = document.getElementById('bg-color-thumb');
const bgImageThumb = document.getElementById('bg-image-thumb');
const bgImageStatus = document.getElementById('bg-image-status');
const bgUploadBtn = document.getElementById('bg-upload');
const bgClearBtn = document.getElementById('bg-clear');
const bgFileInput = document.getElementById('bg-file-input');

let _bgImageThumbUrl = null;

async function renderBackgroundPanel() {
  const cfg = getBackgroundConfig();
  bgRadios().forEach((r) => {
    r.checked = r.value === cfg.mode;
  });
  bgColorInput.value = cfg.color || '#0a0e1a';
  bgColorThumb.style.background = cfg.color || '#0a0e1a';

  // Image preview
  if (_bgImageThumbUrl) {
    URL.revokeObjectURL(_bgImageThumbUrl);
    _bgImageThumbUrl = null;
  }
  bgImageThumb.style.backgroundImage = '';
  bgImageThumb.textContent = '+';
  bgImageStatus.textContent = 'No image uploaded';
  bgClearBtn.disabled = true;

  try {
    const blob = await getBackgroundImageBlob();
    if (blob) {
      const url = URL.createObjectURL(blob);
      _bgImageThumbUrl = url;
      bgImageThumb.style.backgroundImage = `url('${url}')`;
      bgImageThumb.textContent = '';
      bgImageStatus.textContent = `${formatBytes(blob.size)} stored`;
      bgClearBtn.disabled = false;
    }
  } catch (e) {
    console.error('Failed to load background preview:', e);
  }
}

function formatBytes(bytes) {
  if (!bytes) return '—';
  const units = ['B', 'KB', 'MB'];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

bgRadios().forEach((r) => {
  r.addEventListener('change', () => {
    if (!r.checked) return;
    setBackgroundConfig({ mode: r.value });
    showToast(`Background: ${r.value}`);
  });
});

bgColorInput.addEventListener('input', () => {
  const color = bgColorInput.value;
  bgColorThumb.style.background = color;
  setBackgroundConfig({ color });
});
bgColorInput.addEventListener('change', () => {
  // When the color is changed, automatically switch to color mode if not already.
  setBackgroundConfig({ mode: 'color' });
  bgRadios().forEach((r) => { r.checked = r.value === 'color'; });
});

bgUploadBtn.addEventListener('click', () => bgFileInput.click());
bgFileInput.addEventListener('change', async () => {
  const file = bgFileInput.files?.[0];
  bgFileInput.value = '';
  if (!file) return;
  try {
    await setBackgroundImage(file);
    await renderBackgroundPanel();
    showToast('Background image set');
  } catch (e) {
    showToast(e.message || 'Upload failed', true);
  }
});

bgClearBtn.addEventListener('click', async () => {
  try {
    await clearBackgroundImage();
    setBackgroundConfig({ mode: 'default' });
    await renderBackgroundPanel();
    showToast('Background image removed');
  } catch (e) {
    showToast(e.message || 'Failed to remove', true);
  }
});

// ---------- Tracking stability (MediaPipe) ----------

const tmModel = document.getElementById('tm-model-complexity');
const tmCameraRes = document.getElementById('tm-camera-res');
const tmPoseStab = document.getElementById('tm-pose-stab');
const tmHandStab = document.getElementById('tm-hand-stab');
const tmFaceStab = document.getElementById('tm-face-stab');
const tmHoldMs = document.getElementById('tm-hold-ms');
const tmDetConf = document.getElementById('tm-det-conf');
const tmTrkConf = document.getElementById('tm-trk-conf');

function syncTrackingMedia() {
  const tm = getSettings().trackingMedia || {};
  if (tmModel) tmModel.value = String(tm.modelComplexity ?? 1);
  if (tmCameraRes) {
    tmCameraRes.value = (tm.cameraWidth ?? 640) >= 1280 ? '1280' : '640';
  }
  const pose = Number(tm.poseStabilization ?? 0.62);
  const hand = Number(tm.handStabilization ?? 0.58);
  const face = Number(tm.faceStabilization ?? 0.48);
  const hold = Number(tm.holdMs ?? 380);
  const det = Number(tm.minDetectionConfidence ?? 0.72);
  const trk = Number(tm.minTrackingConfidence ?? 0.72);
  if (tmPoseStab) tmPoseStab.value = pose;
  if (tmHandStab) tmHandStab.value = hand;
  if (tmFaceStab) tmFaceStab.value = face;
  if (tmHoldMs) tmHoldMs.value = hold;
  if (tmDetConf) tmDetConf.value = det;
  if (tmTrkConf) tmTrkConf.value = trk;
}

function bindTrackingMedia() {
  tmModel?.addEventListener('change', () => {
    patchTrackingMedia({ modelComplexity: Number(tmModel.value) });
    showToast('Tracking: model quality saved');
  });

  tmCameraRes?.addEventListener('change', () => {
    const hd = tmCameraRes.value === '1280';
    patchTrackingMedia({
      cameraWidth: hd ? 1280 : 640,
      cameraHeight: hd ? 720 : 480,
    });
    showToast(hd ? 'Tracking: HD camera saved — reload live page' : 'Tracking: standard camera saved — reload live page');
  });

  const bindNum = (input, key, mapExtra) => {
    if (!input) return;
    const save = () => {
      const v = Number(input.value);
      if (!Number.isFinite(v)) return;
      patchTrackingMedia({ [key]: v, ...(mapExtra ? mapExtra(v) : {}) });
    };
    input.addEventListener('input', save);
    input.addEventListener('change', save);
  };
  bindNum(tmPoseStab, 'poseStabilization');
  bindNum(tmHandStab, 'handStabilization');
  bindNum(tmFaceStab, 'faceStabilization');
  bindNum(tmHoldMs, 'holdMs', (v) => ({ lostTrackingMs: v + 70 }));
  bindNum(tmDetConf, 'minDetectionConfidence');
  bindNum(tmTrkConf, 'minTrackingConfidence');
}

// ---------- Ground visibility (live scene) ----------

const showGroundInput = document.getElementById('show-ground');

function syncShowGround() {
  if (!showGroundInput) return;
  const s = getSettings();
  showGroundInput.checked = s.scene?.showGround !== false;
}

function bindShowGround() {
  if (!showGroundInput) return;
  showGroundInput.addEventListener('change', () => {
    setSettings({ scene: { showGround: showGroundInput.checked } });
    showToast(showGroundInput.checked ? 'Ground will show on live page' : 'Ground hidden on live page');
  });
}

// ---------- Character placement ----------

const placementModesEl = document.getElementById('placement-modes');

function renderPlacementPanel() {
  if (!placementModesEl) return;
  const current = getSettings().scene?.avatarPlacement || 'east';
  placementModesEl.innerHTML = AVATAR_PLACEMENTS.map(
    (p) => `
    <label class="placement-option">
      <input type="radio" name="avatar-placement" value="${p.id}" ${p.id === current ? 'checked' : ''} />
      <span class="placement-option-card">
        <span class="placement-option-label">${p.label}</span>
        <span class="placement-option-hint">${p.hint}</span>
      </span>
    </label>
  `
  ).join('');
}

function bindPlacementPanel() {
  if (!placementModesEl) return;
  placementModesEl.addEventListener('change', (e) => {
    const input = e.target;
    if (input.name !== 'avatar-placement' || !input.checked) return;
    setSettings({ scene: { avatarPlacement: input.value } });
    const label = AVATAR_PLACEMENTS.find((p) => p.id === input.value)?.label || input.value;
    showToast(`Character position: ${label}`);
  });
}

// ---------- Scene appearance (floor + avatar surface) ----------

const modelSurfaceEnabled = document.getElementById('model-surface-enabled');
const modelSurfaceColor = document.getElementById('model-surface-color');
const modelSurfaceSwatch = document.getElementById('model-surface-swatch');
const floorColorInput = document.getElementById('floor-color');
const floorColorSwatch = document.getElementById('floor-color-swatch');

function readModelSurfaceUi() {
  return {
    enabled: modelSurfaceEnabled?.checked === true,
    color: modelSurfaceColor?.value || '#e8c4a8',
  };
}

function saveModelSurface(patch = {}) {
  const current = getSettings().scene?.modelSurface || {};
  setSettings({
    scene: {
      modelSurface: { ...current, ...patch },
    },
  });
}

function syncModelSurface() {
  const cfg = getSettings().scene?.modelSurface || {};
  if (modelSurfaceEnabled) {
    modelSurfaceEnabled.checked = cfg.enabled === true;
  }
  const hex = cfg.color || '#e8c4a8';
  if (modelSurfaceColor) modelSurfaceColor.value = hex;
  if (modelSurfaceSwatch) modelSurfaceSwatch.style.background = hex;
}

function syncFloorColor() {
  const hex = getSettings().scene?.floorColor || '#555555';
  if (floorColorInput) floorColorInput.value = hex;
  if (floorColorSwatch) floorColorSwatch.style.background = hex;
}

function bindModelSurface() {
  if (!modelSurfaceEnabled || !modelSurfaceColor) return;

  modelSurfaceEnabled.addEventListener('change', () => {
    saveModelSurface(readModelSurfaceUi());
    showToast(
      modelSurfaceEnabled.checked ? 'Avatar surface color on' : 'Avatar using original colors'
    );
  });

  modelSurfaceColor.addEventListener('input', () => {
    const hex = modelSurfaceColor.value;
    if (modelSurfaceSwatch) modelSurfaceSwatch.style.background = hex;
    saveModelSurface({ enabled: true, color: hex });
    if (modelSurfaceEnabled) modelSurfaceEnabled.checked = true;
  });

  modelSurfaceColor.addEventListener('change', () => {
    showToast('Avatar surface color saved');
  });
}

function bindFloorColor() {
  if (!floorColorInput) return;

  floorColorInput.addEventListener('input', () => {
    const hex = floorColorInput.value;
    if (floorColorSwatch) floorColorSwatch.style.background = hex;
    setSettings({ scene: { floorColor: hex } });
  });

  floorColorInput.addEventListener('change', () => {
    showToast('Floor color saved');
  });
}

// ---------- Page init (run after all DOM refs and binders are defined) ----------

render();
renderBackgroundPanel();
syncShowGround();
syncModelSurface();
syncFloorColor();
syncTrackingMedia();
renderPlacementPanel();
bindShowGround();
bindPlacementPanel();
bindModelSurface();
bindFloorColor();
bindCameraCheckboxes();
bindCameraChangeMode();
bindTrackingMedia();

onSettingsChange(() => {
  syncTrackingMedia();
  syncShowGround();
  syncModelSurface();
  syncFloorColor();
  renderPlacementPanel();
});
