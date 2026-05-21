// Screen-space face follow — aligned to selfie preview + MediaPipe capture frame.

import {
  getTrackingBasePosition,
  getViewBoxLimits,
  clampVrmSceneToViewBox,
} from './modelPlacementOffset.js';
import { computeRecordRootScale, setRecordUserScales } from './vrmHybridFace.js';
import { resolveTrackingReverse } from './trackingReverseOptions.js';
import { getVrmFollowRoot } from './jeelizUpdatePoses.js';

const _headOff = new THREE.Vector3();

function lmDist(a, b) {
  if (!a || !b) return 0;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function getHeadBones(vrm) {
  if (!vrm?.humanoid || typeof THREE_VRM === 'undefined') return { head: null, neck: null };
  const H = THREE_VRM.VRMSchema.HumanoidBoneName;
  return {
    head: vrm.humanoid.getBoneNode?.(H.Head) ?? null,
    neck: vrm.humanoid.getBoneNode?.(H.Neck) ?? null,
  };
}

/**
 * Landmarks are 0–1 on the MediaPipe canvas (640×480, letterboxed).
 * Convert to 0–1 on the visible webcam (object-fit: contain), same as #preview.
 */
export function mapLandmarkFromCaptureFrame(
  lx,
  ly,
  video,
  viewport,
  frameW = 640,
  frameH = 480
) {
  const vw = Math.max(1, video?.videoWidth || 640);
  const vh = Math.max(1, video?.videoHeight || 480);
  const scale = Math.min(frameW / vw, frameH / vh);
  const sw = vw * scale;
  const sh = vh * scale;
  const ox = (frameW - sw) / 2;
  const oy = (frameH - sh) / 2;

  const px = lx * frameW;
  const py = ly * frameH;
  const cx = THREE.MathUtils.clamp((px - ox) / sw, 0, 1);
  const cy = THREE.MathUtils.clamp((py - oy) / sh, 0, 1);

  const dw = Math.max(1, viewport?.width || 1);
  const dh = Math.max(1, viewport?.height || 1);
  const va = vw / vh;
  const da = dw / dh;
  let rw;
  let rh;
  let dox;
  let doy;
  if (va > da) {
    rw = dw;
    rh = dw / va;
    dox = 0;
    doy = (dh - rh) * 0.5;
  } else {
    rh = dh;
    rw = dh * va;
    dox = (dw - rw) * 0.5;
    doy = 0;
  }
  const u = (dox + cx * rw) / dw;
  const v = (doy + cy * rh) / dh;
  return { u, v, cx, cy };
}

/** Lock body root; store anchors for follow + head scale. */
export function storeFitAnchor(vrm) {
  if (!vrm?.scene) return;
  const ud = vrm.scene.userData;
  const followRoot = getVrmFollowRoot(vrm);
  ud._rootAnchorPos = followRoot.position.clone();
  ud._rootAnchorScale = vrm.scene.scale.x;
  ud._sceneFollowPos = ud._rootAnchorPos.clone();

  const { head, neck } = getHeadBones(vrm);
  if (head) {
    ud._headBasePos = head.position.clone();
    ud._headBaseScale = head.scale.x;
    ud._headFollowPos = head.position.clone();
    ud._headFollowScale = head.scale.x;
  }
  if (neck) {
    ud._neckBasePos = neck.position.clone();
    ud._neckFollowPos = neck.position.clone();
  }

  ud._fitOffset = ud._rootAnchorPos.clone();
  ud._fitPortraitScale = ud._rootAnchorScale;
  ud._lastAutoScale = 1;
  ud._fitBaseRotation = {
    x: vrm.scene.rotation.x,
    y: vrm.scene.rotation.y,
    z: vrm.scene.rotation.z,
  };
}

function lockBodyRoot(vrm, faceScale) {
  const ud = vrm.scene.userData;
  if (ud._rootAnchorScale == null) return;
  if (faceScale != null) setRecordUserScales(vrm, faceScale, ud._userBodyScale);
  const auto = ud._lastAutoScale ?? 1;
  vrm.scene.scale.setScalar(computeRecordRootScale(ud, auto));
}

/** Move overlay on screen to match your face (works every frame). */
function applySceneFollow(vrm, camera, dx, dy, smooth, gain) {
  const ud = vrm.scene.userData;
  const base = getTrackingBasePosition(ud);
  if (!base) return false;

  if (!ud._sceneFollowPos) ud._sceneFollowPos = base.clone();

  const g = Math.max(0.5, Number(gain) || 1);
  let tx = base.x + dx * g;
  let ty = base.y + dy * g;
  if (camera) {
    const { maxX, maxY } = getViewBoxLimits(
      camera,
      vrm.scene.scale.x,
      ud._rootAnchorScale ?? 1
    );
    tx = THREE.MathUtils.clamp(tx, -maxX, maxX);
    ty = THREE.MathUtils.clamp(ty, -maxY, maxY);
  }
  _headOff.set(tx, ty, base.z);
  ud._sceneFollowPos.lerp(_headOff, smooth);
  vrm.scene.position.copy(ud._sceneFollowPos);
  if (camera) clampVrmSceneToViewBox(vrm, camera);
  return true;
}

function applyHeadScale(vrm, scaleMul, smooth) {
  const ud = vrm.scene.userData;
  const { head } = getHeadBones(vrm);
  if (!head || ud._headBaseScale == null) return;

  if (ud._headFollowScale == null) ud._headFollowScale = ud._headBaseScale;
  const target = (ud._headBaseScale ?? 1) * scaleMul;
  ud._headFollowScale += (target - ud._headFollowScale) * smooth;
  head.scale.setScalar(ud._headFollowScale);
}

/**
 * Match your face on the webcam (X/Y position + size).
 */
export function followFaceOnCamera(vrm, camera, landmarks, options = {}) {
  if (!vrm?.scene || !camera || !landmarks?.length) return false;

  const ud = vrm.scene.userData;
  if (!ud._rootAnchorPos) return false;

  lockBodyRoot(vrm, options.faceScale);

  const userScale = THREE.MathUtils.clamp(Number(options.faceScale) || 1, 0.25, 5);
  const align = Math.max(0.35, Math.min(1, Number(options.alignStrength) ?? 0.75));
  const smooth = Math.min(0.98, Math.max(0.4, 0.45 + align * 0.5));
  const positionGain = 0.85 + align * 1.15;
  const frameW = options.frameW ?? 640;
  const frameH = options.frameH ?? 480;

  const le = landmarks[33];
  const re = landmarks[263];
  const nose = landmarks[1] || landmarks[4];
  const forehead = landmarks[10];
  const chin = landmarks[152] || landmarks[175];
  if (!nose) return false;

  let lx = le && re ? (le.x + re.x) * 0.5 : nose.x;
  let ly =
    forehead && chin
      ? (forehead.y + chin.y) * 0.5
      : le && re
        ? (nose.y + le.y + re.y) / 3
        : nose.y;

  // When capture is mirrored to match selfie preview, do not flip again.
  if (!options.landmarksMirrored && options.mirror !== false) {
    lx = 1 - lx;
  }

  const mapped = mapLandmarkFromCaptureFrame(
    lx,
    ly,
    options.video,
    options.viewport,
    frameW,
    frameH
  );

  let halfW;
  let halfH;
  if (camera.isOrthographicCamera) {
    halfW = (camera.right - camera.left) * 0.5;
    halfH = (camera.top - camera.bottom) * 0.5;
  } else {
    const z = Math.max(camera.position.z, 0.3);
    const fovRad = (camera.fov * Math.PI) / 180;
    halfH = Math.tan(fovRad / 2) * z;
    halfW = halfH * camera.aspect;
  }

  const rev = resolveTrackingReverse(options);
  let sx = (mapped.u - 0.5) * 2;
  let sy = -(mapped.v - 0.5) * 2;
  if (rev.reverseHeadPosition) {
    sx = -sx;
    sy = -sy;
  }

  const maxX = halfW * 0.95;
  const maxY = halfH * 0.95;
  const dx = THREE.MathUtils.clamp(sx * halfW, -maxX, maxX);
  const dy = THREE.MathUtils.clamp(sy * halfH, -maxY, maxY);

  const eyeDist = le && re ? lmDist(le, re) : 0.16;
  const faceH =
    forehead && chin ? Math.abs(forehead.y - chin.y) : eyeDist * 1.3;
  const autoScale = THREE.MathUtils.clamp(
    Math.max(eyeDist / 0.17, faceH / 0.24),
    0.88,
    1.35
  );
  ud._lastAutoScale = autoScale;

  applySceneFollow(vrm, camera, dx, dy, smooth, positionGain);
  setRecordUserScales(vrm, userScale, ud._userBodyScale);
  const showBody = (ud._userBodyScale ?? 0) > 0.04;
  if (showBody) {
    applyHeadScale(vrm, userScale * autoScale, smooth);
  } else {
    ud._lastAutoScale = autoScale;
    const target = computeRecordRootScale(ud, autoScale);
    const cur = vrm.scene.scale.x;
    vrm.scene.scale.setScalar(cur + (target - cur) * smooth);
  }
  clampVrmSceneToViewBox(vrm, camera);
  return true;
}

/** Face size slider — head bone scale only. */
export function applyUserFaceScale(vrm, userScale = 1) {
  if (!vrm?.scene) return;
  setRecordUserScales(vrm, userScale, vrm.scene.userData._userBodyScale);
  lockBodyRoot(vrm, userScale);
  const showBody = (vrm.scene.userData._userBodyScale ?? 0) > 0.04;
  if (showBody) {
    const auto = vrm.scene.userData._lastAutoScale ?? 1;
    const m = THREE.MathUtils.clamp(Number(userScale) || 1, 0.25, 5);
    applyHeadScale(vrm, m * auto, 1);
  }
}

/** Center overlay when tracking is lost. */
export function holdHeadAtCenter(vrm, faceScale = 1, camera = null) {
  if (!vrm?.scene) return;
  const ud = vrm.scene.userData;
  if (!ud._rootAnchorPos) return;

  lockBodyRoot(vrm, faceScale);

  const base = getTrackingBasePosition(ud);
  if (!base) return;
  if (!ud._sceneFollowPos) ud._sceneFollowPos = base.clone();
  ud._sceneFollowPos.lerp(base, 0.2);
  vrm.scene.position.copy(ud._sceneFollowPos);
  if (camera) clampVrmSceneToViewBox(vrm, camera);

  const { head, neck } = getHeadBones(vrm);
  if (head && ud._headBasePos) {
    if (!ud._headFollowPos) ud._headFollowPos = ud._headBasePos.clone();
    ud._headFollowPos.lerp(ud._headBasePos, 0.2);
    head.position.copy(ud._headFollowPos);
  }
  if (neck && ud._neckBasePos) {
    if (!ud._neckFollowPos) ud._neckFollowPos = ud._neckBasePos.clone();
    ud._neckFollowPos.lerp(ud._neckBasePos, 0.2);
    neck.position.copy(ud._neckFollowPos);
  }

  const m = THREE.MathUtils.clamp(Number(faceScale) || 1, 0.25, 5);
  if ((ud._userBodyScale ?? 0) > 0.04) applyHeadScale(vrm, m, 0.2);
}

export function resetFaceFollow(vrm) {
  if (!vrm?.scene) return;
  const ud = vrm.scene.userData;
  const { head, neck } = getHeadBones(vrm);

  if (ud._rootAnchorPos) vrm.scene.position.copy(ud._rootAnchorPos);
  if (ud._rootAnchorScale != null) vrm.scene.scale.setScalar(ud._rootAnchorScale);
  if (head && ud._headBasePos) head.position.copy(ud._headBasePos);
  if (head && ud._headBaseScale != null) head.scale.setScalar(ud._headBaseScale);
  if (neck && ud._neckBasePos) neck.position.copy(ud._neckBasePos);

  delete ud._rootAnchorPos;
  delete ud._rootAnchorScale;
  delete ud._sceneFollowPos;
  delete ud._headBasePos;
  delete ud._headBaseScale;
  delete ud._headFollowPos;
  delete ud._headFollowScale;
  delete ud._neckBasePos;
  delete ud._neckFollowPos;
  delete ud._fitOffset;
  delete ud._fitPortraitScale;
  delete ud._lastAutoScale;
}

/** @deprecated use mapLandmarkFromCaptureFrame */
export function mapLandmarkToViewport(faceX, faceY, video, viewport) {
  return mapLandmarkFromCaptureFrame(faceX, faceY, video, viewport);
}
