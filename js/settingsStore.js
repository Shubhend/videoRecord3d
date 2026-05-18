// ==================== SETTINGS STORE ====================
// Per-part sensitivity, enable/disable toggles, and smoothing controls.
// Persisted to localStorage and synced across tabs.

const KEY = 'edge_ai_settings_v1';

export const DEFAULT_SETTINGS = Object.freeze({
  // Multipliers applied to the base dampener for each part. 1.0 = stock behavior.
  // Range used in UI: 0..2 (0% .. 200%).
  sensitivity: {
    head: 1.0,
    mouth: 1.0,
    eyes: 1.0,
    pupils: 1.0,
    hips: 1.0,
    spine: 1.0,
    leftArm: 1.0,
    rightArm: 1.0,
    leftLeg: 1.0,
    rightLeg: 1.0,
    leftHand: 1.0,
    rightHand: 1.0,
    fingers: 1.0,
    distance: 1.0, // how strongly user proximity moves the avatar toward/away
    autoRelax: 1.0, // speed at which lost-tracking body parts drift back to rest
    audioLipSync: 1.8, // boost factor for audio-driven mouth motion (0..3)
    expressions: 1.0, // brow / frown / smile from face landmarks (0..2)
  },
  // Per-part on/off toggles.
  enabled: {
    head: true,
    mouth: true,
    eyes: true,
    pupils: true,
    hips: true,
    spine: true,
    leftArm: true,
    rightArm: true,
    leftLeg: true,
    rightLeg: true,
    leftHand: true,
    rightHand: true,
    fingers: true,
    distance: true,
    autoRelax: true,
    audioLipSync: true,
    expressions: true,
  },
  // Lerp amounts applied per part. Lower = smoother (laggier), higher = snappier (twitchier).
  smoothing: {
    face: 0.7,
    pose: 0.7,
    hands: 0.8,
    fingers: 0.8,
    legs: 0.4, // legs are noisy when partly visible — smooth more by default
  },
  // Live scene options (not sensitivity sliders).
  scene: {
    /** When false, hides the floor mesh, grid, and shadow-receiver plane. */
    showGround: true,
    /** Floor plane color (MeshStandardMaterial on the ground). */
    floorColor: '#555555',
    /** Optional tint multiplied with each mesh material color (textures preserved). */
    modelSurface: {
      enabled: false,
      color: '#e8c4a8',
    },
    /** center | north | south | east | southEast */
    avatarPlacement: 'east',
  },
  // Saved camera views — random cuts during record / audio (see cameras.html).
  camera: {
    enabled: true,
    autoOnAudio: true,
    autoOnRecord: true,
    autoOnLive: false,
    /** 'random' = switch between saved views; 'hold' = one random view for the whole session. */
    changeMode: 'random',
    /** 0.03 = very smooth/slow, 0.2 = snappier. */
    smoothness: 0.06,
    shotMinSec: 4,
    shotMaxSec: 9,
    useSpeechCuts: true,
    silenceGapSec: 0.5,
    speechThreshold: 0.028,
  },
});

const listeners = new Set();
let _cached = null;

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function deepMerge(target, source) {
  if (!source || typeof source !== 'object') return target;
  for (const k of Object.keys(source)) {
    const sv = source[k];
    if (sv && typeof sv === 'object' && !Array.isArray(sv)) {
      target[k] = deepMerge(target[k] && typeof target[k] === 'object' ? target[k] : {}, sv);
    } else {
      target[k] = sv;
    }
  }
  return target;
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function getSettings() {
  if (_cached) return _cached;
  _cached = deepMerge(clone(DEFAULT_SETTINGS), loadFromStorage());
  return _cached;
}

export function setSettings(partial) {
  const next = deepMerge(clone(getSettings()), partial);
  _cached = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // ignore (private mode etc.)
  }
  listeners.forEach((cb) => {
    try {
      cb(next);
    } catch (e) {
      console.error(e);
    }
  });
  return next;
}

export function resetSettings() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
  _cached = clone(DEFAULT_SETTINGS);
  listeners.forEach((cb) => {
    try {
      cb(_cached);
    } catch (e) {
      console.error(e);
    }
  });
  return _cached;
}

/**
 * Subscribe to settings changes (same tab + cross-tab via storage event).
 * Returns an unsubscribe function.
 */
export function onSettingsChange(cb) {
  listeners.add(cb);
  const storageHandler = (e) => {
    if (e.key !== KEY) return;
    _cached = null;
    cb(getSettings());
  };
  window.addEventListener('storage', storageHandler);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('storage', storageHandler);
  };
}
