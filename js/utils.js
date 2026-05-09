// ==================== UTILS ====================
// Utility functions for the avatar application

import { Config } from './config.js';

// Dead zone filter - ignores tiny movements
export function applyDeadZone(value, threshold = Config.tracking.deadZone) {
  return Math.abs(value) < threshold ? 0 : value;
}

// Smooth rotation - returns target directly for fast response
export function smoothRotation(current, target, amount = Config.tracking.smoothAmount) {
  return target || current;
}

// Clamp value between min and max
export function clampValue(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
