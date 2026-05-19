// Temporal filters for Kalidokit / MediaPipe output — reduces flicker and jitter.

/**
 * @param {number} stabilization 0..1 — higher = smoother (slower to follow raw motion)
 */
export function lerpAlpha(stabilization = 0.5) {
  return Math.max(0.04, Math.min(0.72, 1 - stabilization * 0.9));
}

/**
 * Smooth a single Euler-like rotation object.
 * @param {object|null} current
 * @param {object|null} target
 * @param {number} stabilization
 */
export function smoothRot(current, target, stabilization = 0.5) {
  if (!target) return current;
  if (!current) return { ...target };
  const a = lerpAlpha(stabilization);
  return {
    x: current.x + (target.x - current.x) * a,
    y: current.y + (target.y - current.y) * a,
    z: current.z + (target.z - current.z) * a,
    rotationOrder: target.rotationOrder || current.rotationOrder || 'XYZ',
  };
}

/** Smooth all rotation fields on a Kalidokit pose object. */
export function smoothPose(prev, next, stabilization = 0.55) {
  if (!next) return prev;
  if (!prev) return clonePose(next);
  const out = { ...next };
  for (const key of Object.keys(next)) {
    const v = next[key];
    if (v && typeof v === 'object' && typeof v.x === 'number') {
      out[key] = smoothRot(prev[key], v, stabilization);
    }
  }
  return out;
}

/**
 * Smooth hand bones — wrist follows faster than fingers for sharper poses.
 * @param {{ wrist?: number, fingers?: number }} stab
 */
export function smoothHand(prev, next, stab = {}) {
  if (!next) return prev;
  const wristStab = stab.wrist ?? stab.default ?? 0.42;
  const fingerStab = stab.fingers ?? stab.default ?? 0.52;
  if (!prev) {
    const out = {};
    for (const key of Object.keys(next)) out[key] = { ...next[key] };
    return out;
  }
  const out = {};
  for (const key of Object.keys(next)) {
    const s = key.includes('Wrist') ? wristStab : fingerStab;
    out[key] = smoothRot(prev[key], next[key], s);
  }
  return out;
}

function clonePose(pose) {
  const out = {};
  for (const key of Object.keys(pose)) {
    const v = pose[key];
    out[key] = v && typeof v === 'object' ? { ...v } : v;
  }
  return out;
}

/** Smooth mouth viseme weights (plain numbers). */
export function smoothMouth(prev, next, stabilization = 0.45) {
  if (!next) return prev;
  if (!prev) return { ...next };
  const a = lerpAlpha(stabilization);
  const out = { ...next };
  for (const key of Object.keys(next)) {
    const t = next[key] ?? 0;
    const c = prev[key] ?? 0;
    out[key] = c + (t - c) * a;
  }
  return out;
}

/**
 * Visibility with hysteresis — brief dips do not drop the limb instantly.
 */
export class VisibilityGate {
  constructor(threshold = 0.4, holdMs = 350) {
    this.threshold = threshold;
    this.holdMs = holdMs;
    this._lastGood = 0;
    this._trusted = false;
  }

  setThreshold(threshold) {
    this.threshold = threshold;
  }

  setHoldMs(holdMs) {
    this.holdMs = holdMs;
  }

  /**
   * @param {number} visibility 0..1 average for the region
   * @param {number} [now]
   */
  isTrusted(visibility, now = performance.now()) {
    if (visibility >= this.threshold) {
      this._trusted = true;
      this._lastGood = now;
      return true;
    }
    if (this._trusted && now - this._lastGood < this.holdMs) {
      return true;
    }
    this._trusted = false;
    return false;
  }
}
