// 3D VRM alignment from Jeeliz Face Filter (JeelizThreeHelper.update_poses for VRM).

import { holdHeadAtCenter } from './recordFaceFollow.js';
import { resolveTrackingReverse } from './trackingReverseOptions.js';
import { computeRecordRootScale, setRecordUserScales } from './vrmHybridFace.js';
import {
  getTrackingBasePosition,
  getTrackingBaseRotation,
  getViewBoxLimits,
  clampVrmSceneToViewBox,
} from './modelPlacementOffset.js';
import {
  applyJeelizUpdatePoses,
  getVrmFollowRoot,
  JEELIZ_VRM_PIVOT,
} from './jeelizUpdatePoses.js';

const DETECTION_THRESHOLD = 0.65;
const DETECTION_HYSTERESIS = 0.02;

function applyMouthFromJeeliz(vrm, detectState, reverseFaceMotion = false) {
  const proxy = vrm?.blendShapeProxy;
  if (!proxy || !detectState?.expressions || typeof THREE_VRM === 'undefined') return;
  const Preset = THREE_VRM.VRMSchema.BlendShapePresetName;
  let open = (detectState.expressions[0] ?? 0) - 0.2;
  open = Math.min(Math.max(open * 5, 0), 1);
  if (reverseFaceMotion) open = 1 - open;
  try {
    proxy.setValue(Preset.A, open * 0.85);
    proxy.setValue(Preset.O, open * 0.35);
  } catch {
    // ignore missing presets
  }
}

/** Legacy orthographic follow (MediaPipe / fallback). */
function alignVrmFromJeelizOrtho(vrm, camera, detectState, options = {}) {
  if (!vrm?.scene || !camera || !detectState) return false;

  const ud = vrm.scene.userData;
  if (!ud._rootAnchorPos) return false;

  const wasVisible = ud._jeelizWasDetected === true;
  const detected = detectState.detected ?? 0;
  const isDetected =
    wasVisible
      ? detected > DETECTION_THRESHOLD - DETECTION_HYSTERESIS
      : detected > DETECTION_THRESHOLD + DETECTION_HYSTERESIS;

  ud._jeelizWasDetected = isDetected;

  if (!isDetected) {
    holdHeadAtCenter(vrm, options.faceScale ?? 1, camera);
    return false;
  }

  setRecordUserScales(vrm, options.faceScale ?? ud._userFaceScale, options.bodyScale ?? ud._userBodyScale);
  const auto = ud._lastJeelizS ?? 1;
  vrm.scene.scale.setScalar(computeRecordRootScale(ud, auto));

  const align = Math.max(0.35, Math.min(1, Number(options.alignStrength) ?? 0.85));
  const smooth = Math.min(0.98, 0.5 + align * 0.45);
  const gain = 0.9 + align * 1.0;
  const rev = resolveTrackingReverse(options);

  let halfW;
  let halfH;
  if (camera.isOrthographicCamera) {
    halfW = (camera.right - camera.left) * 0.5;
    halfH = (camera.top - camera.bottom) * 0.5;
  } else {
    return false;
  }

  let x = detectState.x * halfW * gain;
  let y = detectState.y * halfH * gain;
  if (rev.reverseHeadPosition) {
    x = -x;
    y = -y;
  }

  const base = getTrackingBasePosition(ud);
  if (!base) return false;
  if (!ud._sceneFollowPos) ud._sceneFollowPos = base.clone();

  const { maxX, maxY } = getViewBoxLimits(camera, vrm.scene.scale.x, ud._rootAnchorScale ?? 1);
  const trackMaxX = Math.max(0.05, maxX - Math.abs(base.x) * 0.35);
  const trackMaxY = Math.max(0.05, maxY - Math.abs(base.y) * 0.35);
  const targetX = THREE.MathUtils.clamp(
    base.x + THREE.MathUtils.clamp(x, -trackMaxX, trackMaxX),
    -maxX,
    maxX
  );
  const targetY = THREE.MathUtils.clamp(
    base.y + THREE.MathUtils.clamp(y, -trackMaxY, trackMaxY),
    -maxY,
    maxY
  );

  ud._sceneFollowPos.x += (targetX - ud._sceneFollowPos.x) * smooth;
  ud._sceneFollowPos.y += (targetY - ud._sceneFollowPos.y) * smooth;
  vrm.scene.position.copy(ud._sceneFollowPos);
  clampVrmSceneToViewBox(vrm, camera);

  const rotOff = Number(options.rotationOffsetX ?? 0);
  const baseRot = getTrackingBaseRotation(ud);
  let rx = detectState.rx;
  let ry = detectState.ry;
  let rz = detectState.rz;
  if (rev.reverseHeadRotation) {
    rx = -rx;
    ry = -ry;
    rz = -rz;
  }
  const targetRot = new THREE.Euler(
    rx + rotOff + (baseRot.x ?? 0),
    ry + (baseRot.y ?? 0),
    rz + (baseRot.z ?? 0),
    'ZYX'
  );
  if (!ud._jeelizSmoothRot) ud._jeelizSmoothRot = targetRot.clone();
  ud._jeelizSmoothRot.x += (targetRot.x - ud._jeelizSmoothRot.x) * smooth;
  ud._jeelizSmoothRot.y += (targetRot.y - ud._jeelizSmoothRot.y) * smooth;
  ud._jeelizSmoothRot.z += (targetRot.z - ud._jeelizSmoothRot.z) * smooth;
  vrm.scene.rotation.copy(ud._jeelizSmoothRot);

  applyMouthFromJeeliz(vrm, detectState, rev.reverseFaceMotion);
  return true;
}

/**
 * Align VRM using Jeeliz detectState — perspective update_poses when available.
 */
export function alignVrmFromJeeliz(vrm, camera, detectState, options = {}) {
  if (!vrm?.scene || !camera || !detectState) return false;

  const faceRoot = getVrmFollowRoot(vrm);
  const useJeelizPose =
    options.useJeelizPose === true && camera.isPerspectiveCamera && faceRoot !== vrm.scene;

  if (!useJeelizPose) {
    return alignVrmFromJeelizOrtho(vrm, camera, detectState, options);
  }

  const ud = vrm.scene.userData;
  const rotYDeg = Number(options.placement?.rotYDeg) || 0;
  const ok = applyJeelizUpdatePoses(faceRoot, camera, detectState, {
    scaleW: options.jeelizScaleW ?? 1,
    canvasAspectRatio: options.jeelizCanvasAspect ?? camera.aspect,
    faceScale: options.faceScale ?? 1,
    rotationOffsetX: (rotYDeg * Math.PI) / 180,
    pivotOffsetYZ: JEELIZ_VRM_PIVOT.pivotOffsetYZ,
    placementWorld: ud._placementWorld,
    reverseHeadPosition: options.reverseHeadPosition,
    reverseHeadRotation: options.reverseHeadRotation,
    reverseFaceMotion: options.reverseFaceMotion,
    flipAlignX: options.flipAlignX,
  });

  if (ok && typeof vrm.update === 'function') {
    // expressions updated separately
  }

  const rev = resolveTrackingReverse(options);
  applyMouthFromJeeliz(vrm, detectState, rev.reverseFaceMotion);

  if (!ok) {
    faceRoot.visible = false;
    holdHeadAtCenter(vrm, options.faceScale ?? 1, camera);
  }

  return ok;
}

/** @deprecated Handled in applyJeelizUpdatePoses + local VRM scale */
export function applyJeelizFaceScale() {}
