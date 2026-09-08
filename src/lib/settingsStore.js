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
    face: 0.22,
    pose: 0.2,
    hands: 0.24,
    fingers: 0.18,
    legs: 0.16,
  },
  /** MediaPipe + temporal stabilization (reduces flicker like Meet-style filters). */
  trackingMedia: {
    modelComplexity: 1,
    minDetectionConfidence: 0.72,
    minTrackingConfidence: 0.72,
    smoothLandmarks: true,
    /** 0..1 — higher = smoother body motion. */
    poseStabilization: 0.62,
    /** Legacy single hand slider — used when wrist/finger not set. */
    handStabilization: 0.5,
    wristStabilization: 0.4,
    fingerStabilization: 0.52,
    faceStabilization: 0.48,
    /** Keep last good pose/hand when visibility dips briefly (ms). */
    holdMs: 380,
    lostTrackingMs: 450,
    visibilityLegs: 0.42,
    visibilityArms: 0.38,
    visibilityHips: 0.12,
    /** 640 or 1280 — higher can improve hands/face at CPU cost. */
    cameraWidth: 640,
    cameraHeight: 480,
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

const SETTINGS_KEY = KEY;

const DEFAULTS = {
  sensitivity: {
    mouth: 1,
    eyes: 1,
    expressions: 1,
    audioLipSync: 1.8,
  },
  enabled: {
    mouth: true,
    eyes: true,
    expressions: true,
    audioLipSync: true,
  },
};

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function deepMerge(target, source) {
  if (!source || typeof source !== 'object') return target;
  for (const k of Object.keys(source)) {
    const sv = source[k];
    if (sv && typeof sv === 'object' && !Array.isArray(sv)) {
      target[k] = deepMerge(
        target[k] && typeof target[k] === 'object' ? target[k] : {},
        sv
      );
    } else {
      target[k] = sv;
    }
  }
  return target;
}

export function loadAppSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return JSON.parse(JSON.stringify(DEFAULTS));
    if (typeof raw !== 'string' || raw.trim().length < 2) return JSON.parse(JSON.stringify(DEFAULTS));
    const c0 = raw.trim().charAt(0);
    if (c0 !== '{' && c0 !== '[') return JSON.parse(JSON.stringify(DEFAULTS));
    return deepMerge(JSON.parse(JSON.stringify(DEFAULTS)), JSON.parse(raw));
  } catch {
    return JSON.parse(JSON.stringify(DEFAULTS));
  }
}

export function saveAppSettings(next) {
  const merged = deepMerge(clone(DEFAULT_SETTINGS), next || {});
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
  } catch {
    /* ignore */
  }
  return merged;
}

/** Face / mouth / audio lip-sync multipliers from Settings → Face sensitivity. */
export function getAppExpressionSensitivities() {
  const s = loadAppSettings();
  const sens = s.sensitivity || {};
  const en = s.enabled || {};
  const mouth = Number(sens.mouth) || 1;
  const audioBoost =
    en.audioLipSync !== false ? Number(sens.audioLipSync) || 1.8 : 1;
  return {
    faceIntensity: Number(sens.expressions) || 1,
    eyesIntensity: Number(sens.eyes) || 1,
    mouthIntensity: mouth,
    audioLipSyncMultiplier: audioBoost * mouth,
    expressionsEnabled: en.expressions !== false,
    eyesEnabled: en.eyes !== false,
    mouthEnabled: en.mouth !== false,
    audioLipSyncEnabled: en.audioLipSync !== false,
  };
}

/** Per-viseme toggles derived from Settings (replaces face-follow expression panel). */
export function buildExprSettingsFromApp(app) {
  const mouthKeys = ['aa', 'ih', 'ou', 'ee', 'oh'];
  const eyeKeys = [
    'blinkLeft',
    'blinkRight',
    'blink',
    'lookUp',
    'lookDown',
    'lookLeft',
    'lookRight',
  ];
  const emotionKeys = ['happy', 'sad', 'angry', 'surprised', 'relaxed', 'neutral'];
  const out = {};
  const on = (key, enabled, amount = 1) => {
    out[key] = { enabled: enabled !== false, amount };
  };
  for (const k of mouthKeys) on(k, app.mouthEnabled, app.mouthIntensity);
  for (const k of eyeKeys) on(k, app.eyesEnabled, app.eyesIntensity);
  for (const k of emotionKeys) on(k, app.expressionsEnabled, app.faceIntensity);
  return out;
}

/** Higher = snappier face tracking (inverse of Settings smoothing.face). */
export function getFaceTrackingLerp() {
  const smooth = Number(loadAppSettings().smoothing?.face);
  const s = Number.isFinite(smooth) ? smooth : 0.22;
  return Math.max(0.62, Math.min(0.92, 1 - s * 0.55));
}
