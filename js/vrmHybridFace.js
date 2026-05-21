// VRM head overlay: hide body, frame head, track user face on webcam (screen-accurate).

import { clearRecordSurfaceTint } from './vrmSurfaceColor.js';

const HEAD_NAME_RE =
  /face|head|hair|eye|teeth|brow|lash|mouth|tongue|ear|pupil|iris|sclera|lip|nose|cheek|facial|bang|fringe|eyebrow|eyelash|tooth|gem|piercing|mask|hat|cap|ribbon/i;
const BODY_NAME_RE =
  /body|torso|shirt|pants|skirt|shoe|foot|leg|arm|hand|glove|bottom|top|dress|coat|jacket|sleeve|thigh|calf|hip|waist|chest|bra|sock|boot|heel|acc_body|outfit|cloth|wear|uniform|suit/i;
/** Extra colored layers / makeup / outlines — hidden on record overlay */
const OVERLAY_ARTIFACT_RE =
  /outline|out_line|sticker|decal|tattoo|makeup|facepaint|face_paint|paint|blush|contour|eyeline|lash_line|marking|_mark|mark_|secondary|overlay|matcap|debug|helper|ghost|duplicate|color_layer|colour|skin_overlay|face_overlay|tint|color_mask|mask_face|lineart|toon_line|mtoon_outline|colored|_color\b|colour_layer|facial_/i;
const OVERLAY_MAT_RE = /outline|lineart|toonline|sticker|decal|overlay|mask|tint/i;

/** Face-size slider range (record page). */
export const RECORD_FACE_SCALE_MIN = 0.25;
export const RECORD_FACE_SCALE_MAX = 5;

const _box = new THREE.Box3();
const _center = new THREE.Vector3();
const _size = new THREE.Vector3();
const _meshCenter = new THREE.Vector3();
const _targetPos = new THREE.Vector3();

function meshName(mesh) {
  return String(mesh.name || '').toLowerCase();
}

export function classifyMeshByName(mesh) {
  const n = meshName(mesh);
  if (BODY_NAME_RE.test(n)) return 'body';
  if (HEAD_NAME_RE.test(n)) return 'head';
  return 'unknown';
}

export function isHeadMesh(mesh) {
  return classifyMeshByName(mesh) === 'head';
}

/** Body = explicit outfit/body names only (not neck-height — that hid whole models). */
export function isBodyMesh(mesh) {
  return classifyMeshByName(mesh) === 'body';
}

export function isOverlayArtifactMesh(mesh) {
  if (OVERLAY_ARTIFACT_RE.test(meshName(mesh))) return true;
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  return mats.some((mat) => mat && isOverlayArtifactMaterial(mat, mesh));
}

function isOverlayArtifactMaterial(mat, mesh) {
  const mn = String(mat.name || '').toLowerCase();
  if (OVERLAY_MAT_RE.test(mn)) return true;
  if (mat.type === 'ShaderMaterial' && /outline/i.test(mat.fragmentShader || '')) {
    return true;
  }
  if (
    mat.transparent &&
    mat.opacity > 0.05 &&
    mat.opacity < 0.92 &&
    !/hair|lash|brow/i.test(meshName(mesh))
  ) {
    return true;
  }
  return (
    mat.blending === THREE.AdditiveBlending ||
    mat.blending === THREE.MultiplyBlending
  );
}

export function setRecordUserScales(vrm, faceScale = 1, bodyScale = 0) {
  if (!vrm?.scene) return;
  const ud = vrm.scene.userData;
  ud._userFaceScale = THREE.MathUtils.clamp(
    Number(faceScale) || 1,
    RECORD_FACE_SCALE_MIN,
    RECORD_FACE_SCALE_MAX
  );
  ud._userBodyScale = Math.max(0, Math.min(1.5, Number(bodyScale) || 0));
}

/** Root scene scale: tracking distance × face size (face-only mode). */
export function computeRecordRootScale(ud, autoS = 1) {
  const base = ud._rootAnchorScale ?? 1;
  const auto = Math.max(0.5, Number(autoS) || 1);
  const showBody = (ud._userBodyScale ?? 0) > 0.04;
  const face = ud._userFaceScale ?? 1;
  const raw = base * auto * (showBody ? 1 : face);
  const maxMul = showBody ? 2.2 : 3.2;
  return Math.min(raw, base * maxMul);
}

export function snapRecordRootScale(vrm, autoS) {
  if (!vrm?.scene) return;
  const ud = vrm.scene.userData;
  const auto = autoS ?? ud._lastJeelizS ?? ud._lastAutoScale ?? 1;
  const s = computeRecordRootScale(ud, auto);
  vrm.scene.scale.setScalar(s);
  if (ud._jeelizFollowScale != null) ud._jeelizFollowScale = s;
}

/** Head region for face-size slider (named head + visible hair/face above neck). */
export function isHeadRegionMesh(mesh, vrm) {
  if (!mesh?.isMesh || isOverlayArtifactMesh(mesh)) return false;
  if (isHeadMesh(mesh)) return true;
  if (isBodyMesh(mesh)) return false;
  return getMeshWorldCenterY(mesh, vrm) >= getNeckWorldY(vrm) - 0.08;
}

function stripMToonOutline(mat) {
  if (!mat) return;
  if (mat.outlineWidth != null) mat.outlineWidth = 0;
  if (mat.outlineWidthFactor != null) mat.outlineWidthFactor = 0;
  if (mat.outlineWidthMultiply != null) mat.outlineWidthMultiply = 0;
  if (mat.outlineColorFactor?.set) mat.outlineColorFactor.set(0, 0, 0);
  if (mat.outlineLightingMix != null) mat.outlineLightingMix = 0;
  if (mat.needOutline != null) mat.needOutline = false;
}

/** Remove makeup/outline/debug material layers and custom tint. */
export function stripOverlayArtifacts(vrm) {
  if (!vrm?.scene) return;
  clearRecordSurfaceTint(vrm);
  vrm.scene.traverse((obj) => {
    if (!obj.isMesh) return;
    if (isOverlayArtifactMesh(obj)) {
      obj.visible = false;
      return;
    }
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    mats.forEach((mat) => {
      if (!mat) return;
      mat.wireframe = false;
      if (mat.emissive) mat.emissive.set(0, 0, 0);
      if (mat.emissiveIntensity != null) mat.emissiveIntensity = 0;
      stripMToonOutline(mat);
      if (mat.rimLightingMix != null) mat.rimLightingMix = 0;
      if (mat.rimColor?.set) mat.rimColor.set(0, 0, 0);
      if (mat.shadeColor && mat.color && mat.userData._recordOrigShade == null) {
        mat.userData._recordOrigShade = mat.shadeColor.clone();
      }
      if (mat.userData._recordOrigShade && mat.shadeColor) {
        mat.shadeColor.copy(mat.userData._recordOrigShade);
      }
    });
  });
}

export function isBodyRegionMesh(mesh, vrm) {
  if (!mesh?.isMesh || isOverlayArtifactMesh(mesh)) return false;
  if (isHeadMesh(mesh)) return false;
  if (isBodyMesh(mesh)) return true;
  return getMeshWorldCenterY(mesh, vrm) < getNeckWorldY(vrm) - 0.08;
}

/** Scale torso/outfit meshes only (face size slider does not affect these). */
export function applyBodyMeshScale(vrm, bodyScale = 1) {
  if (!vrm?.scene) return;
  const m = THREE.MathUtils.clamp(Number(bodyScale) || 0, 0, 1.5);
  vrm.scene.traverse((obj) => {
    if (!obj.isMesh) return;
    if (!obj.userData._recordBodyBaseScale) {
      obj.userData._recordBodyBaseScale = obj.scale.clone();
    }
    const base = obj.userData._recordBodyBaseScale;
    if (!isBodyMesh(obj) && !isBodyRegionMesh(obj, vrm)) return;
    if (!obj.visible) return;
    obj.scale.set(base.x * m, base.y * m, base.z * m);
  });
}

export function resetHeadMeshScales(vrm) {
  if (!vrm?.scene) return;
  vrm.scene.traverse((obj) => {
    if (!obj.isMesh || !obj.userData._recordHeadBaseScale) return;
    obj.scale.copy(obj.userData._recordHeadBaseScale);
  });
}

/** Scale head/face meshes only (used when body is visible). */
export function applyHeadMeshScale(vrm, faceScale = 1) {
  if (!vrm?.scene) return;
  const m = THREE.MathUtils.clamp(
    Number(faceScale) || 1,
    RECORD_FACE_SCALE_MIN,
    RECORD_FACE_SCALE_MAX
  );
  vrm.scene.traverse((obj) => {
    if (!obj.isMesh || !obj.visible) return;
    if (!isHeadRegionMesh(obj, vrm)) return;
    if (!obj.userData._recordHeadBaseScale) {
      obj.userData._recordHeadBaseScale = obj.scale.clone();
    }
    const base = obj.userData._recordHeadBaseScale;
    obj.scale.set(base.x * m, base.y * m, base.z * m);
  });
}

function getMeshWorldCenterY(mesh, vrm) {
  if (!mesh.geometry) return 0;
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  const box = mesh.geometry.boundingBox;
  if (!box) return 0;
  _meshCenter.copy(box.getCenter(new THREE.Vector3()));
  mesh.localToWorld(_meshCenter);
  return _meshCenter.y;
}

function getNeckWorldY(vrm) {
  if (typeof THREE_VRM === 'undefined') return 1.05;
  const neck = vrm.humanoid?.getBoneNode?.(
    THREE_VRM.VRMSchema.HumanoidBoneName.Neck
  );
  if (!neck) return 1.05;
  vrm.scene.updateWorldMatrix(true, true);
  neck.getWorldPosition(_meshCenter);
  return _meshCenter.y;
}

function lmDist(a, b) {
  if (!a || !b) return 0;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Map normalized landmark (0–1 in camera image) to overlay pixel coords (object-fit: contain).
 */
export function mapLandmarkToOverlay(faceX, faceY, video, viewport) {
  const vw = Math.max(1, video?.videoWidth || 640);
  const vh = Math.max(1, video?.videoHeight || 480);
  const dw = Math.max(1, viewport?.width || window.innerWidth);
  const dh = Math.max(1, viewport?.height || window.innerHeight);
  const va = vw / vh;
  const da = dw / dh;
  let rw;
  let rh;
  let ox;
  let oy;
  if (va > da) {
    rw = dw;
    rh = dw / va;
    ox = 0;
    oy = (dh - rh) * 0.5;
  } else {
    rh = dh;
    rw = dh * va;
    ox = (dw - rw) * 0.5;
    oy = 0;
  }
  return {
    px: ox + faceX * rw,
    py: oy + faceY * rh,
    u: (ox + faceX * rw) / dw,
    v: (oy + faceY * rh) / dh,
    renderW: rw,
    renderH: rh,
  };
}

function expandVisibleBox(vrm) {
  _box.makeEmpty();
  vrm.scene.traverse((obj) => {
    if (obj.isMesh && obj.visible) _box.expandByObject(obj);
  });
  return !_box.isEmpty();
}

function expandHeadBox(vrm) {
  const neckY = getNeckWorldY(vrm);
  _box.makeEmpty();
  vrm.scene.traverse((obj) => {
    if (!obj.isMesh || !obj.visible) return;
    if (getMeshWorldCenterY(obj, vrm) >= neckY - 0.1) _box.expandByObject(obj);
  });
  return !_box.isEmpty();
}

export function countVrmMeshes(vrm) {
  let total = 0;
  let visible = 0;
  if (!vrm?.scene) return { total, visible };
  vrm.scene.traverse((obj) => {
    if (!obj.isMesh) return;
    total++;
    if (obj.visible) visible++;
  });
  return { total, visible };
}

export function showAllMeshes(vrm, visible = true) {
  if (!vrm?.scene) return;
  vrm.scene.traverse((obj) => {
    if (obj.isMesh) obj.visible = visible;
  });
}

export function prepareVrmMaterialsForOverlay(vrm) {
  if (!vrm?.scene) return;
  vrm.scene.traverse((obj) => {
    if (!obj.isMesh) return;
    obj.frustumCulled = false;
    if (!obj.material) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    mats.forEach((mat) => {
      if (!mat) return;
      mat.side = THREE.DoubleSide;
      if (mat.transparent) {
        mat.depthWrite = true;
        mat.alphaTest = Math.max(mat.alphaTest ?? 0, 0.01);
      }
    });
  });
}

export function applyHybridMeshVisibility(vrm, hybridEnabled) {
  if (!vrm?.scene) return;

  let visible = 0;
  vrm.scene.traverse((obj) => {
    if (!obj.isMesh) return;
    if (obj.userData._hybridOrigVisible === undefined) {
      obj.userData._hybridOrigVisible = obj.visible;
    }
    if (!hybridEnabled) {
      obj.visible = obj.userData._hybridOrigVisible;
      return;
    }
    const byName = classifyMeshByName(obj);
    obj.visible = byName !== 'body';
    if (obj.visible) visible++;
  });

  if (visible < 1) {
    showMeshesAboveNeck(vrm);
  }
}

/** Show only geometry above the neck (no torso/legs on overlay). */
export function showMeshesAboveNeck(vrm) {
  if (!vrm?.scene) return 0;
  const neckY = getNeckWorldY(vrm);
  let visible = 0;
  vrm.scene.traverse((obj) => {
    if (!obj.isMesh) return;
    if (obj.userData._hybridOrigVisible === undefined) {
      obj.userData._hybridOrigVisible = obj.visible;
    }
    const show = getMeshWorldCenterY(obj, vrm) >= neckY - 0.08;
    obj.visible = show;
    if (show) visible++;
  });
  return visible;
}

/**
 * Record overlay visibility.
 * @param {object} vrm
 * @param {{ bodyScale?: number, showAll?: boolean }} [opts]
 */
export function applyRecordHeadVisibility(vrm, opts = {}) {
  if (!vrm?.scene) return 0;
  const bodyScale = Number(opts.bodyScale ?? 0);
  const showBody = bodyScale > 0.04;
  const showAll = opts.showAll === true;

  stripOverlayArtifacts(vrm);

  vrm.scene.traverse((obj) => {
    if (!obj.isMesh) return;
    if (obj.userData._hybridOrigVisible === undefined) {
      obj.userData._hybridOrigVisible = obj.visible;
    }
  });

  if (showAll) {
    showAllMeshes(vrm, true);
  } else {
    vrm.scene.traverse((obj) => {
      if (!obj.isMesh) return;
      const kind = classifyMeshByName(obj);
      if (kind === 'head') {
        obj.visible = true;
      } else if (kind === 'body') {
        obj.visible = showBody;
      } else if (showBody) {
        obj.visible =
          !isOverlayArtifactMesh(obj) &&
          (isBodyRegionMesh(obj, vrm) || isHeadRegionMesh(obj, vrm));
      } else {
        obj.visible = isHeadRegionMesh(obj, vrm);
      }
    });
  }

  let { total, visible } = countVrmMeshes(vrm);

  if (visible < 1) {
    visible = showMeshesAboveNeck(vrm);
  }

  if (visible < 1 && total > 0) {
    showAllMeshes(vrm, true);
    if (!showBody) {
      vrm.scene.traverse((obj) => {
        if (!obj.isMesh) return;
        if (isBodyMesh(obj, vrm)) obj.visible = false;
      });
    }
    visible = countVrmMeshes(vrm).visible;
  }

  setRecordUserScales(vrm, opts.faceScale ?? 1, bodyScale);
  applyBodyMeshScale(vrm, showBody ? bodyScale : 0);
  if (showBody) applyHeadMeshScale(vrm, opts.faceScale ?? 1);
  else resetHeadMeshScales(vrm);
  snapRecordRootScale(vrm);
  prepareVrmMaterialsForOverlay(vrm);

  vrm.scene.traverse((obj) => {
    if (!obj.isMesh || !obj.visible) return;
    obj.frustumCulled = false;
    obj.renderOrder = 1;
    if (!obj.material) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    mats.forEach((mat) => {
      if (!mat) return;
      mat.side = THREE.DoubleSide;
      mat.depthTest = true;
      if (mat.transparent && mat.opacity < 0.05) {
        mat.opacity = 1;
        mat.transparent = false;
      }
    });
  });

  return visible;
}

/** @deprecated Use applyRecordHeadVisibility */
export function ensureOverlayRenderable(vrm) {
  return applyRecordHeadVisibility(vrm);
}

export function fitHeadPortrait(vrm, camera) {
  if (!vrm?.scene || !camera) return;

  vrm.scene.rotation.y = Math.PI;
  vrm.scene.updateWorldMatrix(true, true);
  if (!expandHeadBox(vrm)) {
    showAllMeshes(vrm, true);
    expandHeadBox(vrm) || expandVisibleBox(vrm);
  }
  if (_box.isEmpty()) return;

  _box.getCenter(_center);
  _box.getSize(_size);
  if (typeof THREE_VRM !== 'undefined') {
    const head = vrm.humanoid?.getBoneNode?.(
      THREE_VRM.VRMSchema.HumanoidBoneName.Head
    );
    if (head) head.getWorldPosition(_center);
  }

  vrm.scene.position.sub(_center);
  const portraitHeight = Math.max(_size.y, 0.16);
  const portraitScale = 0.44 / portraitHeight;
  vrm.scene.scale.setScalar(portraitScale);

  const ud = vrm.scene.userData;
  ud._hybridPortraitScale = portraitScale;
  ud._hybridBasePosition = vrm.scene.position.clone();
  ud._hybridBaseScale = portraitScale;
  ud._fitOffset = ud._hybridBasePosition.clone();
  ud._fitPortraitScale = portraitScale;
  ud._smoothPos = ud._hybridBasePosition.clone();
  ud._smoothScale = portraitScale;
  ud._followPos = ud._smoothPos.clone();
  ud._followScale = portraitScale;
  ud._lastAutoScale = 1;

  if (camera.isOrthographicCamera) {
    camera.position.set(0, 0, 2);
    camera.lookAt(0, 0, 0);
  } else {
    const fovRad = (camera.fov * Math.PI) / 180;
    const dist = 0.24 / Math.tan(fovRad / 2);
    camera.position.set(0, 0, Math.max(0.38, dist));
    camera.lookAt(0, 0, 0);
  }
  camera.updateProjectionMatrix();
}

export function fitFullBodyPortrait(vrm, camera) {
  if (!vrm?.scene || !camera) return;
  vrm.scene.rotation.y = Math.PI;
  showAllMeshes(vrm, true);
  if (!expandVisibleBox(vrm)) return;
  _box.getCenter(_center);
  _box.getSize(_size);
  vrm.scene.position.sub(_center);
  const portraitScale = 1.05 / Math.max(_size.y, 0.5);
  vrm.scene.scale.setScalar(portraitScale);
  const ud = vrm.scene.userData;
  ud._hybridPortraitScale = portraitScale;
  ud._hybridBasePosition = vrm.scene.position.clone();
  ud._fitOffset = ud._hybridBasePosition.clone();
  ud._fitPortraitScale = portraitScale;
  ud._smoothPos = ud._hybridBasePosition.clone();
  ud._smoothScale = portraitScale;
  ud._followPos = ud._smoothPos.clone();
  ud._followScale = portraitScale;
  ud._lastAutoScale = 1;
  camera.position.set(0, 0, 2);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
}

export function applyFaceScaleMultiplier(vrm, multiplier = 1) {
  if (!vrm?.scene) return;
  const ud = vrm.scene.userData;
  const base = ud._hybridPortraitScale ?? ud._hybridBaseScale ?? vrm.scene.scale.x;
  const m = Math.max(0.35, Math.min(2.5, Number(multiplier) || 1));
  const target = base * m;
  ud._smoothScale = target;
  vrm.scene.scale.setScalar(target);
}

/**
 * Move & scale VRM head to cover the user's face on the webcam (follows every frame).
 */
export function updateHybridHeadAlign(vrm, camera, faceLandmarks, options = {}) {
  if (!vrm?.scene || !camera || !faceLandmarks?.length) return false;

  const ud = vrm.scene.userData;
  const basePos = ud._hybridBasePosition;
  const baseScale = ud._hybridPortraitScale ?? ud._hybridBaseScale;
  if (!basePos || baseScale == null) return false;

  // Match selfie-mirrored webcam: landmarks are from raw frames, display is mirrored.
  const mirrorDisplay = options.mirror !== false;
  const align = Math.max(0.5, Math.min(1, Number(options.alignStrength ?? 0.85)));
  const headScale = Math.max(0.5, Math.min(2.5, Number(options.headScale ?? 1.2)));
  const smooth = Math.min(0.92, 0.35 + align * 0.55);

  const le = faceLandmarks[33];
  const re = faceLandmarks[263];
  const nose = faceLandmarks[1] || faceLandmarks[4];
  const forehead = faceLandmarks[10];
  const chin = faceLandmarks[152] || faceLandmarks[175];
  if (!nose) return false;

  let cx = le && re ? (le.x + re.x) * 0.5 : nose.x;
  let cy =
    forehead && chin
      ? (forehead.y + chin.y) * 0.5
      : le && re
        ? (nose.y + le.y + re.y) / 3
        : nose.y;

  if (mirrorDisplay) cx = 1 - cx;

  const mapped = mapLandmarkToOverlay(cx, cy, options.video, options.viewport);

  const eyeDist = le && re ? lmDist(le, re) : 0.16;
  const faceH =
    forehead && chin ? Math.abs(forehead.y - chin.y) : eyeDist * 1.35;

  let halfW;
  let halfH;
  if (camera.isOrthographicCamera) {
    halfW = (camera.right - camera.left) * 0.5;
    halfH = (camera.top - camera.bottom) * 0.5;
  } else {
    const camZ = Math.max(camera.position.z, 0.25);
    const fovRad = (camera.fov * Math.PI) / 180;
    halfH = Math.tan(fovRad / 2) * camZ;
    halfW = halfH * camera.aspect;
  }

  const ndcX = mapped.u * 2 - 1;
  const ndcY = -(mapped.v * 2 - 1);

  const targetX = basePos.x + ndcX * halfW;
  const targetY = basePos.y + ndcY * halfH;

  const refEye = 0.17;
  const refFaceH = 0.24;
  const targetScale =
    baseScale *
    headScale *
    Math.max(eyeDist / refEye, (faceH / refFaceH) * 0.95);

  if (!ud._smoothPos) ud._smoothPos = vrm.scene.position.clone();
  if (ud._smoothScale == null) ud._smoothScale = vrm.scene.scale.x;

  const clampX = basePos.x + THREE.MathUtils.clamp(
    targetX - basePos.x,
    -halfW * 1.15,
    halfW * 1.15
  );
  const clampY = basePos.y + THREE.MathUtils.clamp(
    targetY - basePos.y,
    -halfH * 1.15,
    halfH * 1.15
  );
  const clampScale = THREE.MathUtils.clamp(
    targetScale,
    baseScale * 0.45,
    baseScale * 2.8
  );

  _targetPos.set(clampX, clampY, basePos.z);
  ud._smoothPos.lerp(_targetPos, smooth);
  ud._smoothScale += (clampScale - ud._smoothScale) * smooth;

  vrm.scene.position.copy(ud._smoothPos);
  vrm.scene.scale.setScalar(ud._smoothScale);
  return true;
}

/** Keep head visible at center when tracking is not ready yet. */
export function holdHeadAtCenter(vrm, faceScale = 1) {
  if (!vrm?.scene) return;
  const ud = vrm.scene.userData;
  const basePos = ud._hybridBasePosition;
  const baseScale = ud._hybridPortraitScale ?? ud._hybridBaseScale;
  if (!basePos || baseScale == null) return;
  if (!ud._smoothPos) ud._smoothPos = basePos.clone();
  if (ud._smoothScale == null) ud._smoothScale = baseScale;
  ud._smoothPos.lerp(basePos, 0.12);
  const target = baseScale * faceScale;
  ud._smoothScale += (target - ud._smoothScale) * 0.12;
  vrm.scene.position.copy(ud._smoothPos);
  vrm.scene.scale.setScalar(ud._smoothScale);
}

export function resetHybridHeadScale(vrm) {
  if (!vrm?.scene) return;
  const ud = vrm.scene.userData;
  if (ud._hybridBasePosition) vrm.scene.position.copy(ud._hybridBasePosition);
  else vrm.scene.position.set(0, 0, 0);
  const base = ud._hybridPortraitScale ?? ud._hybridBaseScale;
  if (base != null) vrm.scene.scale.setScalar(base);
  delete ud._hybridBaseScale;
  delete ud._hybridPortraitScale;
  delete ud._hybridBasePosition;
  delete ud._smoothPos;
  delete ud._smoothScale;
}
