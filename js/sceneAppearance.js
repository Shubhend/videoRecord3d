// Apply scene + avatar appearance from settings (floor, model tint).

import { applyModelSurfaceFromSettings } from './vrmSurfaceColor.js';
import { applyAvatarPlacementFromSettings } from './avatarPlacement.js';

function setGroundVisibleSafe(sceneSetup, visible) {
  if (!sceneSetup) return;
  const v = !!visible;
  if (typeof sceneSetup.setGroundVisible === 'function') {
    sceneSetup.setGroundVisible(v);
    return;
  }
  if (sceneSetup.floorMesh) sceneSetup.floorMesh.visible = v;
  if (sceneSetup.gridHelper) sceneSetup.gridHelper.visible = v;
  if (sceneSetup.shadowGroundMesh) sceneSetup.shadowGroundMesh.visible = v;
}

function setFloorColorSafe(sceneSetup, hex) {
  if (!sceneSetup) return;
  const color = hex || '#555555';
  if (typeof sceneSetup.setFloorColor === 'function') {
    sceneSetup.setFloorColor(color);
    return;
  }
  const mat = sceneSetup.floorMesh?.material;
  if (mat?.color) {
    mat.color.set(color);
    mat.needsUpdate = true;
  }
}

/**
 * @param {import('./sceneSetup.js').SceneSetup} sceneSetup
 * @param {object} settings
 */
export function applySceneAppearance(sceneSetup, settings) {
  if (!sceneSetup) return;
  const scene = settings?.scene || {};
  setGroundVisibleSafe(sceneSetup, scene.showGround !== false);
  setFloorColorSafe(sceneSetup, scene.floorColor || '#555555');
}

/**
 * @param {import('./sceneSetup.js').SceneSetup} sceneSetup
 * @param {object} [vrm]
 * @param {object} settings
 * @returns {{ x: number, z: number } | null} placement applied to vrm
 */
export function applyFullAppearance(sceneSetup, vrm, settings) {
  applySceneAppearance(sceneSetup, settings);
  let placement = null;
  if (vrm) {
    placement = applyAvatarPlacementFromSettings(vrm, settings);
    applyModelSurfaceFromSettings(vrm, settings);
  }
  return placement;
}
