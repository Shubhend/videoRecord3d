// ==================== SETTINGS STORE ====================
// Per-part sensitivity, enable/disable toggles, and smoothing controls.
// Persisted to public/assets/data/settings.json (via assets API).
// localStorage is kept as a sync cache for same-tab reads.

import { fetchData, putData, persistData } from './assetsClient.js';

const KEY = 'edge_ai_settings_v1';

export const DEFAULT_SETTINGS = Object.freeze({
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
    distance: 1.0,
    autoRelax: 1.0,
    audioLipSync: 1.8,
    expressions: 1.0,
  },
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
  smoothing: {
    face: 0.18,
    /** MindAR head/face-anchor pose lerp (lower = smoother tracking motion). */
    faceMotion: 0.2,
    /** Audio lip-sync mouth lerp (lower = smoother lips). */
    lipSync: 0.2,
    pose: 0.2,
    hands: 0.24,
    fingers: 0.18,
    legs: 0.16,
  },
  trackingMedia: {
    modelComplexity: 1,
    minDetectionConfidence: 0.72,
    minTrackingConfidence: 0.72,
    smoothLandmarks: true,
    poseStabilization: 0.62,
    handStabilization: 0.5,
    wristStabilization: 0.4,
    fingerStabilization: 0.52,
    faceStabilization: 0.48,
    holdMs: 380,
    lostTrackingMs: 450,
    visibilityLegs: 0.42,
    visibilityArms: 0.38,
    visibilityHips: 0.12,
    cameraWidth: 640,
    cameraHeight: 480,
  },
  scene: {
    showGround: true,
    floorColor: '#555555',
    modelSurface: {
      enabled: false,
      color: '#e8c4a8',
    },
    avatarPlacement: 'east',
  },
  camera: {
    enabled: true,
    autoOnAudio: true,
    autoOnRecord: true,
    autoOnLive: false,
    changeMode: 'random',
    smoothness: 0.06,
    shotMinSec: 4,
    shotMaxSec: 9,
    useSpeechCuts: true,
    silenceGapSec: 0.5,
    speechThreshold: 0.028,
  },
  /** Audio lip-sync naturalness (face-follow). */
  lipSync: {
    /** Jaw open on open vowels (0 = barely open, 1 = wide). */
    jawOpen: 0.35,
    /** Higher = treat more audio as silence → mouth closes more. */
    silenceGate: 0.016,
    /** Overall mouth openness during vowels. */
    vowelOpen: 0.48,
    /** How strongly consonants/sibilants close the mouth (0–1). */
    consonantClose: 0.82,
    /** Closing speed vs opening (1 = same, 2 = closes twice as fast). */
    closeBoost: 2.1,
    /** Non-dominant viseme bleed (lower = clearer shapes, less always-open). */
    secondaryMix: 0.14,
  },
});

const listeners = new Set();
let _cached = null;
let _hydratePromise = null;

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

function loadFromLocalCache() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeLocalCache(settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // ignore
  }
}

function normalizeSettings(settings) {
  const def = DEFAULT_SETTINGS.trackingMedia;
  const tm = settings.trackingMedia;
  let changed = false;

  if (!tm || typeof tm !== 'object' || Array.isArray(tm)) {
    settings.trackingMedia = clone(def);
    return true;
  }

  const merged = { ...clone(def), ...tm };
  for (const key of Object.keys(def)) {
    if (settings.trackingMedia[key] !== merged[key]) {
      changed = true;
      break;
    }
  }
  if (changed) settings.trackingMedia = merged;
  return changed;
}

function persistDisk(settings) {
  persistData('settings', settings);
}

/** Load settings from public/assets/data/settings.json into the sync cache. */
export function hydrateSettings() {
  if (_hydratePromise) return _hydratePromise;
  _hydratePromise = (async () => {
    try {
      const disk = await fetchData('settings');
      if (disk && typeof disk === 'object' && Object.keys(disk).length > 0) {
        _cached = deepMerge(clone(DEFAULT_SETTINGS), disk);
        normalizeSettings(_cached);
        writeLocalCache(_cached);
        return _cached;
      }
    } catch (err) {
      console.warn('[settingsStore] disk hydrate failed, using local cache:', err);
    }
    _cached = deepMerge(clone(DEFAULT_SETTINGS), loadFromLocalCache());
    normalizeSettings(_cached);
    // Migrate existing localStorage into assets folder once.
    try {
      await putData('settings', _cached);
    } catch {
      /* ignore */
    }
    return _cached;
  })();
  return _hydratePromise;
}

// Kick off hydrate early.
hydrateSettings();

export function getSettings() {
  if (_cached) return _cached;
  _cached = deepMerge(clone(DEFAULT_SETTINGS), loadFromLocalCache());
  if (normalizeSettings(_cached)) {
    writeLocalCache(_cached);
  }
  return _cached;
}

export function getTrackingMedia() {
  const tm = getSettings().trackingMedia;
  return { ...clone(DEFAULT_SETTINGS.trackingMedia), ...tm };
}

export function patchTrackingMedia(partial) {
  const trackingMedia = { ...getTrackingMedia(), ...partial };
  return setSettings({ trackingMedia });
}

export function setSettings(partial) {
  const next = deepMerge(clone(getSettings()), partial);
  normalizeSettings(next);
  _cached = next;
  writeLocalCache(next);
  persistDisk(next);
  listeners.forEach((cb) => {
    try {
      cb(next);
    } catch (e) {
      console.error(e);
    }
  });
  try {
    window.dispatchEvent(new CustomEvent('edge-ai-settings', { detail: next }));
  } catch {
    /* ignore */
  }
  return next;
}

export function resetSettings() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
  _cached = clone(DEFAULT_SETTINGS);
  normalizeSettings(_cached);
  writeLocalCache(_cached);
  persistDisk(_cached);
  listeners.forEach((cb) => {
    try {
      cb(_cached);
    } catch (e) {
      console.error(e);
    }
  });
  try {
    window.dispatchEvent(new CustomEvent('edge-ai-settings', { detail: _cached }));
  } catch {
    /* ignore */
  }
  return _cached;
}

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
