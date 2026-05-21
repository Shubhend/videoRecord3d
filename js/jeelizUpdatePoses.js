// Head pose from Jeeliz detectState — same math as JeelizThreeHelper.update_poses (tiger demo).
// @see https://github.com/jeeliz/jeelizFaceFilter/blob/master/demos/threejs/tiger/main.js
// @see https://github.com/jeeliz/jeelizFaceFilter/blob/master/helpers/JeelizThreeHelper.js

import { resolveTrackingReverse } from './trackingReverseOptions.js';

const _translation = new THREE.Vector3();
const _euler = new THREE.Euler();

/** VRM head pivot (tiger uses position 0,0.2,-0.48 scale 2,3,2 on mesh). */
export const JEELIZ_VRM_PIVOT = {
  rotationOffsetX: 0,
  pivotOffsetYZ: [0.15, 0.55],
};

const DETECTION_THRESHOLD = 0.78;
const DETECTION_HYSTERESIS = 0.02;

/**
 * Apply Jeeliz face pose to a Three.js Object3D (face root / VRM parent).
 * @param {THREE.Object3D} faceRoot
 * @param {THREE.PerspectiveCamera} camera
 * @param {object} detectState
 * @param {object} opts
 */
export function applyJeelizUpdatePoses(faceRoot, camera, detectState, opts = {}) {
  if (!faceRoot || !camera?.isPerspectiveCamera || !detectState) return false;

  const ud = faceRoot.userData;
  const wasVisible = ud._jeelizWasDetected === true;
  const detected = detectState.detected ?? 0;
  const isDetected =
    wasVisible
      ? detected > DETECTION_THRESHOLD - DETECTION_HYSTERESIS
      : detected > DETECTION_THRESHOLD + DETECTION_HYSTERESIS;

  ud._jeelizWasDetected = isDetected;
  faceRoot.visible = isDetected;

  if (!isDetected) return false;

  const rev = resolveTrackingReverse(opts);
  const pivot = opts.pivotOffsetYZ ?? JEELIZ_VRM_PIVOT.pivotOffsetYZ;
  const rotOffX = Number(opts.rotationOffsetX ?? JEELIZ_VRM_PIVOT.rotationOffsetX);
  const scaleW = opts.scaleW ?? 1;
  const canvasAspectRatio = opts.canvasAspectRatio ?? camera.aspect;
  const faceScaleMul = Math.max(0.35, Math.min(5, Number(opts.faceScale) || 1));

  const halfTanFOVX = Math.tan((camera.aspect * camera.fov * Math.PI) / 360);
  const W = (detectState.s * scaleW) / faceScaleMul;
  const DFront = 1 / (2 * W * halfTanFOVX);
  const D = DFront + 0.5;

  let xv = detectState.x * scaleW;
  let yv = detectState.y * scaleW;
  let rx = detectState.rx;
  let ry = detectState.ry;
  let rz = detectState.rz;

  if (rev.reverseHeadPosition) {
    xv = -xv;
    yv = -yv;
  }
  if (rev.reverseHeadRotation) {
    rx = -rx;
    ry = -ry;
    rz = -rz;
  }

  const z = -D;
  const x = xv * D * halfTanFOVX;
  const y = (yv * D * halfTanFOVX) / canvasAspectRatio;

  const cz = Math.cos(rz);
  const sz = Math.sin(rz);

  faceRoot.position.set(-sz * pivot[0], -cz * pivot[0], -pivot[1]);
  _euler.set(rx + rotOffX, ry, rz, 'ZYX');
  faceRoot.rotation.copy(_euler);
  faceRoot.position.applyEuler(faceRoot.rotation);

  _translation.set(x, y + pivot[0], z + pivot[1]);

  const placeX = Number(opts.placementWorld?.x) || 0;
  const placeY = Number(opts.placementWorld?.y) || 0;
  const placeZ = Number(opts.placementWorld?.z) || 0;
  _translation.x += placeX * 0.35;
  _translation.y += placeY * 0.35;
  _translation.z += placeZ;

  faceRoot.position.add(_translation);
  return true;
}

/**
 * @param {object} vrm
 * @returns {THREE.Object3D}
 */
export function getVrmFollowRoot(vrm) {
  const p = vrm?.scene?.parent;
  if (p?.userData?._isJeelizFaceRoot) return p;
  return vrm?.scene;
}

export function ensureJeelizFaceRoot(vrm, scene) {
  if (!vrm?.scene || !scene) return null;
  const existing = vrm.scene.parent;
  if (existing?.userData?._isJeelizFaceRoot) return existing;

  const root = new THREE.Group();
  root.userData._isJeelizFaceRoot = true;
  root.visible = false;
  if (vrm.scene.parent) vrm.scene.parent.remove(vrm.scene);
  scene.add(root);
  root.add(vrm.scene);
  return root;
}
