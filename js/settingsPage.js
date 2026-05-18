// ==================== SETTINGS PAGE ====================
// Builds the per-part sensitivity / toggle UI and writes changes
// to the shared settings store.

import { getSettings, setSettings, resetSettings } from './settingsStore.js';
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
      label: 'Audio Lip-Sync Intensity',
      hint: 'Boost factor for the mouth motion when an audio file is driving lip-sync. Higher = more dramatic mouth movement (range 0–300%).',
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
      type="range" min="0" max="${max}" step="0.05"
      class="slider"
      data-slider="${def.key}"
      data-max="${max}"
      value="${sens}"
      ${enabled ? '' : 'disabled'}
    />
    <div class="row-value ${sens > highThreshold ? 'high' : ''}" data-value="${def.key}">${pct(sens)}</div>
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
      type="range" min="${min}" max="${max}" step="${step}"
      class="slider"
      data-cam-slider="${def.key}"
      value="${val}"
    />
    <div class="row-value" data-cam-value="${def.key}">${fmt(val)}</div>
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

  container.querySelectorAll('input[data-cam-slider]').forEach((input) => {
    const key = input.dataset.camSlider;
    const def = ROWS.camera.find((d) => d.key === key);
    const fmt = def?.format || pct;
    const valueEl = container.querySelector(`[data-cam-value="${key}"]`);

    input.addEventListener('input', () => {
      const v = Number(input.value);
      if (valueEl) valueEl.textContent = fmt(v);
    });
    input.addEventListener('change', () => {
      setSettings({ camera: { [key]: Number(input.value) } });
    });
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

function render() {
  const settings = getSettings();
  renderInto('rows-face', ROWS.face, settings);
  renderInto('rows-body', ROWS.body, settings);
  renderInto('rows-hands', ROWS.hands, settings);
  renderInto('rows-presence', ROWS.presence, settings);
  renderInto('rows-smoothing', ROWS.smoothing, settings);
  renderCameraPanel();
  bindRowEvents();
}

function bindRowEvents() {
  document.querySelectorAll('input[data-toggle]').forEach((input) => {
    input.addEventListener('change', () => {
      const key = input.dataset.toggle;
      const checked = input.checked;
      setSettings({ enabled: { [key]: checked } });
      // Enable/disable the matching slider
      const slider = document.querySelector(`input[data-slider="${key}"]`);
      if (slider) slider.disabled = !checked;
      showToast(`${labelFor(key)}: ${checked ? 'on' : 'off'}`);
    });
  });

  document.querySelectorAll('input[data-slider]').forEach((input) => {
    let lastWritten = Number(input.value);
    const max = Number(input.dataset.max ?? 2);
    const highThreshold = max * 0.7;
    input.addEventListener('input', () => {
      const key = input.dataset.slider;
      const v = Number(input.value);
      const valueEl = document.querySelector(`[data-value="${key}"]`);
      if (valueEl) {
        valueEl.textContent = pct(v);
        valueEl.classList.toggle('high', v > highThreshold);
      }
      // Throttle writes to localStorage so dragging is smooth
      if (Math.abs(v - lastWritten) >= 0.05) {
        lastWritten = v;
        setSettings({ sensitivity: { [key]: v } });
      }
    });
    input.addEventListener('change', () => {
      const key = input.dataset.slider;
      const v = Number(input.value);
      setSettings({ sensitivity: { [key]: v } });
    });
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

render();
renderBackgroundPanel();
syncShowGround();
syncModelSurface();
syncFloorColor();
renderPlacementPanel();
bindPlacementPanel();
bindModelSurface();
bindFloorColor();
bindCameraCheckboxes();
bindCameraChangeMode();

// ---------- Ground visibility (live scene) ----------

const showGroundInput = document.getElementById('show-ground');

function syncShowGround() {
  if (!showGroundInput) return;
  const s = getSettings();
  showGroundInput.checked = s.scene?.showGround !== false;
}

if (showGroundInput) {
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
