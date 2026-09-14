/**
 * Reads the same sensitivity / enable flags as js/settingsStore.js (Settings page).
 * Source of truth: public/assets/data/settings.json (via assets API).
 */
import { fetchData } from '../js/assetsClient.js';

const SETTINGS_KEY = 'edge_ai_settings_v1';

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

let _cached = null;
let _hydratePromise = null;

export function hydrateAppSettings() {
  if (_hydratePromise) return _hydratePromise;
  _hydratePromise = (async () => {
    try {
      const disk = await fetchData('settings');
      if (disk && typeof disk === 'object' && Object.keys(disk).length > 0) {
        _cached = deepMerge(JSON.parse(JSON.stringify(DEFAULTS)), disk);
        try {
          localStorage.setItem(SETTINGS_KEY, JSON.stringify(_cached));
        } catch {
          /* ignore */
        }
        return _cached;
      }
    } catch (err) {
      console.warn('[faceFollowAppSettings] disk hydrate failed:', err);
    }
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        _cached = deepMerge(JSON.parse(JSON.stringify(DEFAULTS)), JSON.parse(raw));
        return _cached;
      }
    } catch {
      /* ignore */
    }
    _cached = JSON.parse(JSON.stringify(DEFAULTS));
    return _cached;
  })();
  return _hydratePromise;
}

hydrateAppSettings();

export function loadAppSettings() {
  if (_cached) return JSON.parse(JSON.stringify(_cached));
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return JSON.parse(JSON.stringify(DEFAULTS));
    return deepMerge(JSON.parse(JSON.stringify(DEFAULTS)), JSON.parse(raw));
  } catch {
    return JSON.parse(JSON.stringify(DEFAULTS));
  }
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

/** Lower = smoother face expressions (settings.smoothing.face is already a lerp factor). */
export function getFaceTrackingLerp() {
  const smooth = Number(loadAppSettings().smoothing?.face);
  const s = Number.isFinite(smooth) ? smooth : 0.18;
  // Cap so MindAR blendshape noise does not look like random twitching.
  return Math.max(0.08, Math.min(0.32, s * 0.85));
}
