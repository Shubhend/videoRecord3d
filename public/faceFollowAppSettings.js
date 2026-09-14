/**
 * Reads/writes the same settings as js/settingsStore.js for face-follow.
 * Source of truth: localStorage + public/assets/data/settings.json
 */
import { fetchData, putData, persistData } from '../js/assetsClient.js';

const SETTINGS_KEY = 'edge_ai_settings_v1';

const DEFAULTS = {
  sensitivity: {
    mouth: 1,
    eyes: 1,
    expressions: 1,
    audioLipSync: 1.8,
    pupils: 1,
  },
  enabled: {
    mouth: true,
    eyes: true,
    expressions: true,
    audioLipSync: true,
  },
  smoothing: {
    face: 0.18,
    faceMotion: 0.2,
    lipSync: 0.2,
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

/** Merge partial settings and persist (localStorage + assets/data/settings.json). */
export function patchAppSettings(partial) {
  const cur = loadAppSettings();
  const next = deepMerge(cur, partial || {});
  _cached = next;
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  persistData('settings', next);
  try {
    window.dispatchEvent(new StorageEvent('storage', { key: SETTINGS_KEY }));
  } catch {
    window.dispatchEvent(new CustomEvent('edge-ai-settings', { detail: next }));
  }
  return next;
}

/** Face / mouth / audio lip-sync multipliers from Settings → Face sensitivity. */
export function getAppExpressionSensitivities() {
  const s = loadAppSettings();
  const sens = s.sensitivity || {};
  const en = s.enabled || {};
  const mouth = Number(sens.mouth) || 1;
  const lip =
    en.audioLipSync !== false ? Number(sens.audioLipSync) || 1.8 : 1;
  return {
    faceIntensity: Number(sens.expressions) || 1,
    eyesIntensity: Number(sens.eyes) || 1,
    mouthIntensity: mouth,
    /** Lip-sync intensity alone (does not multiply mouth) — clearer control. */
    audioLipSyncMultiplier: lip,
    pupilsIntensity: Number(sens.pupils) || 1,
    expressionsEnabled: en.expressions !== false,
    eyesEnabled: en.eyes !== false,
    mouthEnabled: en.mouth !== false,
    audioLipSyncEnabled: en.audioLipSync !== false,
  };
}

/** Per-viseme toggles derived from Settings. */
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

function clampLerp(v, lo, hi, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

/** Expression morph lerp — lower = smoother. */
export function getFaceTrackingLerp() {
  return clampLerp(loadAppSettings().smoothing?.face, 0.08, 0.4, 0.18);
}

/** Head / face-anchor motion lerp — lower = smoother tracking. */
export function getFaceMotionLerp() {
  return clampLerp(loadAppSettings().smoothing?.faceMotion, 0.08, 0.45, 0.2);
}

/** Audio lip-sync mouth lerp — lower = smoother lips. */
export function getLipSyncLerp() {
  return clampLerp(loadAppSettings().smoothing?.lipSync, 0.08, 0.5, 0.2);
}
