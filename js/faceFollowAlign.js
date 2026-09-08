import * as THREE from 'three';

const HEAD_MESH_RE = /face|hair|eye|mouth|head|iris|highlight|brow|lash|teeth|lip/i;

/**
 * Put the VRM/VRoid head on the anchor origin, then scale ×2 like blender.html.
 */
export function attachModelLikeBlender(sceneRoot, { blenderScale = 2, vrm = null } = {}) {
  if (!sceneRoot) {
    return { scaleMul: blenderScale, posX: 0, posY: 0, posZ: 0 };
  }

  sceneRoot.position.set(0, 0, 0);
  sceneRoot.rotation.set(0, 0, 0);
  sceneRoot.scale.set(1, 1, 1);
  sceneRoot.updateMatrixWorld(true);

  const center = new THREE.Vector3();
  let hasCenter = false;

  if (vrm?.humanoid) {
    const head =
      vrm.humanoid.getNormalizedBoneNode?.('head') ||
      vrm.humanoid.getRawBoneNode?.('head');
    if (head) {
      head.updateWorldMatrix(true, false);
      head.getWorldPosition(center);
      hasCenter = true;
    }
  }

  if (!hasCenter) {
    const box = new THREE.Box3();
    let matched = 0;
    sceneRoot.traverse((obj) => {
      if (!obj.isMesh) return;
      if (!HEAD_MESH_RE.test(String(obj.name || ''))) return;
      const b = new THREE.Box3().setFromObject(obj);
      if (!b.isEmpty()) {
        box.union(b);
        matched += 1;
      }
    });
    if (matched === 0) {
      const full = new THREE.Box3().setFromObject(sceneRoot);
      if (!full.isEmpty()) box.copy(full);
    }
    if (!box.isEmpty()) {
      box.getCenter(center);
      hasCenter = true;
    }
  }

  if (hasCenter) {
    sceneRoot.position.set(-center.x, -center.y, -center.z);
  }

  sceneRoot.scale.setScalar(blenderScale);
  sceneRoot.updateMatrixWorld(true);

  return {
    scaleMul: blenderScale,
    posX: 0,
    posY: 0,
    posZ: 0,
  };
}

/** @deprecated */
export function fitModelBlenderStyle(sceneRoot, vrm, opts = {}) {
  return attachModelLikeBlender(sceneRoot, { ...opts, vrm });
}

export function autoFitModelOnFace(sceneRoot, vrm) {
  return attachModelLikeBlender(sceneRoot, { vrm });
}
