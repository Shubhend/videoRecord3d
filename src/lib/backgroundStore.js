const BG_KEY = 'faceFollowBackground_v1';

/** Modes where the live camera feed is fully hidden (still used for face tracking). */
const HIDE_CAMERA_MODES = new Set(['color', 'image']);

export const DEFAULT_CONFIG = { mode: 'camera', blurPx: 12, color: '#0a0e14' };

export function load() {
  try {
    const raw = localStorage.getItem(BG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Screen share cannot persist across reloads.
      if (parsed.mode === 'screen') parsed.mode = 'camera';
      return { ...DEFAULT_CONFIG, ...parsed };
    }
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_CONFIG };
}

export function save(config) {
  try {
    localStorage.setItem(BG_KEY, JSON.stringify(config));
  } catch {
    /* ignore */
  }
}
