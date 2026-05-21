// User-adjustable initial VRM position/rotation (tracking adds on top of this base).

/** Slider ±400 → normalized placement ±1 (full span stays inside view). */
export const PLACEMENT_SLIDER_MAX = 400;
export const PLACEMENT_NORM_SCALE = 400;
export const PLACEMENT_NORM_MAX = 1;
/** Fraction of ortho half-extent allowed for scene root (rest = head mesh). */
export const VIEW_BOX_MARGIN = 0.78;

export function sliderToPlacementNorm(sliderValue) {
  return THREE.MathUtils.clamp(
    Number(sliderValue) / PLACEMENT_NORM_SCALE,
    -PLACEMENT_NORM_MAX,
    PLACEMENT_NORM_MAX
  );
}

export function placementNormToSlider(norm) {
  return Math.round(
    THREE.MathUtils.clamp(Number(norm) || 0, -PLACEMENT_NORM_MAX, PLACEMENT_NORM_MAX) *
      PLACEMENT_NORM_SCALE
  );
}

/**
 * Keep VRM root inside the overlay camera frustum (head scale eats margin).
 */
export function getViewBoxLimits(camera, sceneScale = 1, anchorScale = 1) {
  const { halfW, halfH } = getOrthoHalfExtents(camera);
  const scaleRatio = Math.max(1, sceneScale / Math.max(anchorScale, 0.01));
  const pad = Math.min(0.28, 0.12 * (scaleRatio - 1) + 0.08);
  const m = Math.max(0.42, VIEW_BOX_MARGIN - pad);
  return {
    maxX: halfW * m,
    maxY: halfH * m,
    halfW,
    halfH,
  };
}

export function clampVrmSceneToViewBox(vrm, camera) {
  if (!vrm?.scene || !camera) return null;
  const ud = vrm.scene.userData;
  const { maxX, maxY } = getViewBoxLimits(
    camera,
    vrm.scene.scale.x,
    ud._rootAnchorScale ?? vrm.scene.scale.x
  );
  const p = vrm.scene.position;
  p.x = THREE.MathUtils.clamp(p.x, -maxX, maxX);
  p.y = THREE.MathUtils.clamp(p.y, -maxY, maxY);
  if (ud._sceneFollowPos) {
    ud._sceneFollowPos.x = p.x;
    ud._sceneFollowPos.y = p.y;
  }
  return { maxX, maxY, x: p.x, y: p.y };
}

/**
 * @param {THREE.Camera} camera
 */
export function getOrthoHalfExtents(camera) {
  if (camera?.isOrthographicCamera) {
    return {
      halfW: (camera.right - camera.left) * 0.5,
      halfH: (camera.top - camera.bottom) * 0.5,
    };
  }
  const z = Math.max(camera?.position?.z ?? 2, 0.3);
  const fovRad = ((camera?.fov ?? 50) * Math.PI) / 180;
  const halfH = Math.tan(fovRad / 2) * z;
  return { halfW: halfH * (camera?.aspect ?? 1), halfH };
}

/**
 * @param {{ normX?: number, normY?: number, normZ?: number, rotYDeg?: number }} placement
 * @param {THREE.Camera} camera
 */
export function resolvePlacementWorld(placement, camera) {
  const { halfW, halfH } = getOrthoHalfExtents(camera);
  const nx =
    placement?.normX != null
      ? THREE.MathUtils.clamp(Number(placement.normX), -PLACEMENT_NORM_MAX, PLACEMENT_NORM_MAX)
      : sliderToPlacementNorm(placement?.offsetX);
  const ny =
    placement?.normY != null
      ? THREE.MathUtils.clamp(Number(placement.normY), -PLACEMENT_NORM_MAX, PLACEMENT_NORM_MAX)
      : sliderToPlacementNorm(placement?.offsetY);
  const nz = THREE.MathUtils.clamp(Number(placement?.normZ) || 0, -1, 1);
  const rotYDeg = Number(placement?.rotYDeg) || 0;
  const m = VIEW_BOX_MARGIN * 0.95;
  return {
    x: nx * halfW * m,
    y: ny * halfH * m,
    z: nz * 0.15,
    rotY: (rotYDeg * Math.PI) / 180,
  };
}

/**
 * Base anchor + user placement (tracking offsets are added to this).
 */
export function getTrackingBasePosition(ud) {
  const anchor = ud._rootAnchorPos;
  if (!anchor) return null;
  const p = ud._placementWorld || { x: 0, y: 0, z: 0 };
  return new THREE.Vector3(anchor.x + p.x, anchor.y + p.y, anchor.z + p.z);
}

export function getTrackingBaseRotation(ud) {
  const base = ud._fitBaseRotation || { x: 0, y: 0, z: 0 };
  const extraY = ud._placementWorld?.rotY ?? 0;
  return new THREE.Euler(base.x ?? 0, (base.y ?? 0) + extraY, base.z ?? 0, 'ZYX');
}

/**
 * Apply initial placement immediately (before / during tracking).
 */
export function applyInitialPlacement(vrm, camera, placement) {
  if (!vrm?.scene) return;
  const ud = vrm.scene.userData;
  if (!ud._rootAnchorPos) return;

  ud._placementWorld = resolvePlacementWorld(placement, camera);
  if (!ud._fitBaseRotation) {
    ud._fitBaseRotation = {
      x: vrm.scene.rotation.x,
      y: vrm.scene.rotation.y,
      z: vrm.scene.rotation.z,
    };
  }

  const pos = getTrackingBasePosition(ud);
  vrm.scene.position.copy(pos);
  ud._sceneFollowPos = pos.clone();
  clampVrmSceneToViewBox(vrm, camera);

  const rot = getTrackingBaseRotation(ud);
  vrm.scene.rotation.copy(rot);
  ud._jeelizSmoothRot = rot.clone();

  return ud._placementWorld;
}

export function storeFitBaseRotation(vrm) {
  if (!vrm?.scene) return;
  const ud = vrm.scene.userData;
  ud._fitBaseRotation = {
    x: vrm.scene.rotation.x,
    y: vrm.scene.rotation.y,
    z: vrm.scene.rotation.z,
  };
}
