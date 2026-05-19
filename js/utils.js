// ==================== UTILS ====================
// Utility functions for the avatar application

import { Config } from './config.js';
import { smoothRot } from './trackingFilters.js';

// Dead zone filter - ignores tiny movements
export function applyDeadZone(value, threshold = Config.tracking.deadZone) {
  return Math.abs(value) < threshold ? 0 : value;
}

/**
 * Smooth rotation between frames.
 * @param {object|null} current
 * @param {object|null} target
 * @param {number} [stabilization] 0..1 — higher = smoother; defaults from Config
 */
export function smoothRotation(current, target, stabilization = Config.tracking.stabilization) {
  return smoothRot(current, target, stabilization);
}

// Clamp value between min and max
export function clampValue(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
