// Apply scene + avatar appearance from settings (floor, model tint).

import { applyModelSurfaceFromSettings } from './vrmSurfaceColor.js';
import { applyAvatarPlacementFromSettings } from './avatarPlacement.js';

/**
 * @param {import('./sceneSetup.js').SceneSetup} sceneSetup
 * @param {object} settings
 */
export function applySceneAppearance(sceneSetup, settings) {
  if (!sceneSetup) return;
  const scene = settings?.scene || {};
  sceneSetup.setGroundVisible(scene.showGround !== false);
  sceneSetup.setFloorColor(scene.floorColor || '#555555');
}

/**
 * @param {import('./sceneSetup.js').SceneSetup} sceneSetup
 * @param {object} [vrm]
 * @param {object} settings
 */
/**
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
