// Settings for the webcam record page (face overlay).
// Persisted to public/assets/data/record.json

import { fetchData, putData, persistData } from './assetsClient.js';

const KEY = 'edge_ai_record_face_v1';

export const DEFAULT_RECORD_FACE = Object.freeze({
  faceOverlayEnabled: true,
  modelId: 'default',
  faceScale: 1.2,
  bodyScale: 0,
  alignStrength: 0.85,
  mirror: true,
  reverseHeadPosition: false,
  reverseHeadRotation: false,
  reverseFaceMotion: false,
  flipAlignX: false,
  showFullBody: false,
  offsetX: 0,
  offsetY: 0,
  offsetRotY: 0,
});

let _cached = null;
let _hydratePromise = null;

function normalize(saved) {
  const next = { ...DEFAULT_RECORD_FACE, ...saved };
  if (next.bodyScale == null || next.bodyScale > 1) next.bodyScale = 0;
  if (next.faceScale != null) {
    next.faceScale = Math.min(5, Math.max(0.25, Number(next.faceScale)));
  }
  if (next.flipAlignX === true && next.reverseHeadPosition !== true) {
    next.reverseHeadPosition = true;
  }
  if (next.offsetX != null) {
    next.offsetX = Math.min(400, Math.max(-400, Number(next.offsetX)));
  }
  if (next.offsetY != null) {
    next.offsetY = Math.min(400, Math.max(-400, Number(next.offsetY)));
  }
  return next;
}

function readLocal() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_RECORD_FACE };
    return normalize(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_RECORD_FACE };
  }
}

function writeLocal(next) {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

export function hydrateRecordFaceSettings() {
  if (_hydratePromise) return _hydratePromise;
  _hydratePromise = (async () => {
    try {
      const disk = await fetchData('record');
      if (disk && typeof disk === 'object' && Object.keys(disk).length > 0) {
        _cached = normalize(disk);
        writeLocal(_cached);
        return _cached;
      }
    } catch (err) {
      console.warn('[recordStore] disk hydrate failed:', err);
    }
    _cached = readLocal();
    try {
      await putData('record', _cached);
    } catch {
      /* ignore */
    }
    return _cached;
  })();
  return _hydratePromise;
}

hydrateRecordFaceSettings();

export function getRecordFaceSettings() {
  if (_cached) return { ..._cached };
  _cached = readLocal();
  return { ..._cached };
}

export function saveRecordFaceSettings(partial) {
  const next = normalize({ ...getRecordFaceSettings(), ...partial });
  _cached = next;
  writeLocal(next);
  persistData('record', next);
  return next;
}
