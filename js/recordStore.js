// Settings for the webcam record page (face overlay).

const KEY = 'edge_ai_record_face_v1';

export const DEFAULT_RECORD_FACE = Object.freeze({
  faceOverlayEnabled: true,
  modelId: 'default',
  faceScale: 1.2,
  bodyScale: 0,
  alignStrength: 0.85,
  mirror: true,
  /** Screen follow: move opposite left/right & up/down */
  reverseHeadPosition: false,
  /** Head turn / tilt from tracker opposite direction */
  reverseHeadRotation: false,
  /** Mouth, eyes, expressions opposite (MediaPipe / Jeeliz) */
  reverseFaceMotion: false,
  /** @deprecated use reverseHeadPosition */
  flipAlignX: false,
  showFullBody: false,
  /** ±400 slider → up to ±2× screen span before tracking */
  offsetX: 0,
  offsetY: 0,
  /** Degrees added to model facing (use 180 if you see the back of the head) */
  offsetRotY: 0,
});

export function getRecordFaceSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_RECORD_FACE };
    const saved = { ...DEFAULT_RECORD_FACE, ...JSON.parse(raw) };
    if (saved.bodyScale == null || saved.bodyScale > 1) saved.bodyScale = 0;
    if (saved.faceScale != null) {
      saved.faceScale = Math.min(5, Math.max(0.25, Number(saved.faceScale)));
    }
    if (saved.flipAlignX === true && saved.reverseHeadPosition !== true) {
      saved.reverseHeadPosition = true;
    }
    if (saved.offsetX != null) {
      saved.offsetX = Math.min(400, Math.max(-400, Number(saved.offsetX)));
    }
    if (saved.offsetY != null) {
      saved.offsetY = Math.min(400, Math.max(-400, Number(saved.offsetY)));
    }
    return saved;
  } catch {
    return { ...DEFAULT_RECORD_FACE };
  }
}

export function saveRecordFaceSettings(partial) {
  const next = { ...getRecordFaceSettings(), ...partial };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  return next;
}
