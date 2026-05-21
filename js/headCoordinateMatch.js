// Live camera vs model head coordinates (same normalized screen space).

import {
  getOrthoHalfExtents,
  PLACEMENT_NORM_SCALE,
  PLACEMENT_SLIDER_MAX,
  sliderToPlacementNorm,
} from './modelPlacementOffset.js';
import { getVrmFollowRoot } from './jeelizUpdatePoses.js';
import { mapLandmarkFromCaptureFrame } from './recordFaceFollow.js';
import { resolveTrackingReverse } from './trackingReverseOptions.js';

export { PLACEMENT_SLIDER_MAX, PLACEMENT_NORM_SCALE, sliderToPlacementNorm };

function fmt(n, digits = 3) {
  if (n == null || Number.isNaN(n)) return '—';
  return Number(n).toFixed(digits);
}

/**
 * Camera head in normalized overlay space (-1…1, center = 0).
 */
export function getCameraHeadNorm(overlay) {
  if (!overlay?.enabled) return null;

  const rev = resolveTrackingReverse({
    reverseHeadPosition: overlay.reverseHeadPosition,
    reverseHeadRotation: overlay.reverseHeadRotation,
    reverseFaceMotion: overlay.reverseFaceMotion,
  });

  const jeeliz = overlay.jeelizTracking;
  if (overlay.trackingBackend === 'jeeliz' && jeeliz?.ready) {
    const ds = jeeliz.lastDetectState;
    if (!ds || !(ds.detected > 0.5)) return { detected: false, source: 'jeeliz' };
    let x = ds.x ?? 0;
    let y = ds.y ?? 0;
    if (rev.reverseHeadPosition) {
      x = -x;
      y = -y;
    }
    return {
      detected: true,
      source: 'jeeliz',
      x,
      y,
      scale: ds.s ?? null,
    };
  }

  const landmarks = overlay.tracking?.lastFaceLandmarks;
  const video = overlay.video;
  if (!landmarks?.length || !video) return { detected: false, source: 'mediapipe' };

  const nose = landmarks[1] || landmarks[4];
  if (!nose) return { detected: false, source: 'mediapipe' };

  let lx = nose.x;
  let ly = nose.y;
  if (!overlay.mirror) {
    lx = 1 - lx;
  }
  const rect = overlay._viewportRect?.() || { width: 1, height: 1 };
  const mapped = mapLandmarkFromCaptureFrame(
    lx,
    ly,
    video,
    rect,
    overlay.tracking?.captureFrameW ?? 640,
    overlay.tracking?.captureFrameH ?? 480
  );

  let x = (mapped.u - 0.5) * 2;
  let y = -(mapped.v - 0.5) * 2;
  if (rev.reverseHeadPosition) {
    x = -x;
    y = -y;
  }

  return {
    detected: true,
    source: 'mediapipe',
    x,
    y,
    scale: null,
  };
}

/**
 * Model head (VRM root follow position) in the same normalized space.
 */
export function getModelHeadNorm(vrm, camera, detectState = null) {
  if (!vrm?.scene || !camera) return null;

  if (detectState?.detected > 0.5 && camera.isPerspectiveCamera) {
    const scaleW = 1;
    const xv = detectState.x * scaleW;
    const yv = detectState.y * scaleW;
    const halfTanFOVX = Math.tan((camera.aspect * camera.fov * Math.PI) / 360);
    const W = Math.max(0.08, detectState.s || 0.3);
    const D = 1 / (2 * W * halfTanFOVX) + 0.5;
    return {
      detected: true,
      x: xv,
      y: yv,
      approx: true,
      depth: D,
    };
  }

  const ud = vrm.scene.userData;
  const followRoot = getVrmFollowRoot(vrm);
  const anchor = ud._rootAnchorPos;
  if (!anchor) return null;

  const { halfW, halfH } = getOrthoHalfExtents(camera);
  const spanX = halfW * 0.92;
  const spanY = halfH * 0.92;
  const dx = followRoot.position.x - anchor.x;
  const dy = followRoot.position.y - anchor.y;

  return {
    detected: true,
    x: spanX > 1e-6 ? dx / spanX : 0,
    y: spanY > 1e-6 ? dy / spanY : 0,
    worldX: followRoot.position.x,
    worldY: followRoot.position.y,
    anchorX: anchor.x,
    anchorY: anchor.y,
  };
}

/** Initial placement component from sliders only. */
export function getPlacementNorm(offsetX, offsetY) {
  return {
    x: sliderToPlacementNorm(offsetX),
    y: sliderToPlacementNorm(offsetY),
  };
}

/**
 * Tracking-only offset (model norm minus placement norm).
 */
export function getTrackingOffsetNorm(model, placement) {
  if (!model?.detected || !placement) return null;
  return {
    x: model.x - placement.x,
    y: model.y - placement.y,
  };
}

/**
 * @param {import('./recordFaceOverlay.js').RecordFaceOverlay | null} overlay
 */
export function getHeadCoordinateReport(overlay) {
  if (!overlay?.vrm || !overlay.camera) {
    return {
      ready: false,
      camera: null,
      model: null,
      placement: null,
      tracking: null,
      error: null,
      matchQuality: null,
    };
  }

  const camera = getCameraHeadNorm(overlay);
  const ds = overlay.jeelizTracking?.lastDetectState;
  const model = getModelHeadNorm(overlay.vrm, overlay.camera, ds);
  const placement = getPlacementNorm(overlay.offsetX, overlay.offsetY);
  const tracking = getTrackingOffsetNorm(model, placement);

  let error = null;
  let matchQuality = null;
  if (camera?.detected && model?.detected) {
    error = {
      x: camera.x - model.x,
      y: camera.y - model.y,
      distance: Math.hypot(camera.x - model.x, camera.y - model.y),
    };
    matchQuality =
      error.distance < 0.06 ? 'good' : error.distance < 0.15 ? 'fair' : 'poor';
  }

  return {
    ready: true,
    camera,
    model,
    placement,
    tracking,
    error,
    matchQuality,
  };
}

/**
 * Suggest slider delta so placement moves model toward camera head.
 */
export function suggestPlacementSliderDelta(report, strength = 1) {
  if (!report?.error || !report.camera?.detected) return { offsetX: 0, offsetY: 0 };
  const gain = THREE.MathUtils.clamp(Number(strength) || 1, 0.25, 1);
  return {
    offsetX: Math.round(report.error.x * PLACEMENT_NORM_SCALE * gain),
    offsetY: Math.round(report.error.y * PLACEMENT_NORM_SCALE * gain),
  };
}

export function formatHeadCoordinateLines(report) {
  if (!report?.ready) return ['Coordinates: waiting for model…'];
  const cam = report.camera;
  const mod = report.model;
  const plc = report.placement;
  const lines = [];

  if (!cam?.detected) {
    lines.push('Camera head: not detected');
  } else {
    lines.push(
      `Camera head: X ${fmt(cam.x)}  Y ${fmt(cam.y)}  (${cam.source})`
    );
  }

  if (!mod?.detected) {
    lines.push('Model head: no anchor');
  } else {
    lines.push(`Model head:  X ${fmt(mod.x)}  Y ${fmt(mod.y)}`);
  }

  lines.push(
    `Initial offset: X ${fmt(plc?.x)}  Y ${fmt(plc?.y)}  (sliders)`
  );

  if (report.tracking) {
    lines.push(
      `Live tracking: X ${fmt(report.tracking.x)}  Y ${fmt(report.tracking.y)}`
    );
  }

  if (report.error) {
    const q =
      report.matchQuality === 'good'
        ? '✓ matched'
        : report.matchQuality === 'fair'
          ? '~ close'
          : 'Δ adjust sliders';
    lines.push(
      `Error (cam−model): X ${fmt(report.error.x)}  Y ${fmt(report.error.y)}  ${q}`
    );
  }

  return lines;
}
