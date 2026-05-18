// Preset floor positions for the avatar (XZ plane). Camera looks toward the origin.

/** @typedef {'center'|'north'|'south'|'east'|'southEast'} AvatarPlacementId */

export const AVATAR_PLACEMENTS = [
  { id: 'center', label: 'Center', hint: 'Middle of the scene', x: 0, z: 0 },
  { id: 'north', label: 'North', hint: 'Back of the scene', x: 0, z: -2.4 },
  { id: 'south', label: 'South', hint: 'Toward the camera', x: 0, z: 2.4 },
  { id: 'east', label: 'East', hint: 'Right side', x: 2.2, z: 0 },
  { id: 'southEast', label: 'South-East', hint: 'Front-right corner', x: 2.2, z: 2.2 },
];

const BY_ID = Object.fromEntries(AVATAR_PLACEMENTS.map((p) => [p.id, p]));

/**
 * @param {AvatarPlacementId | string} [id]
 * @returns {{ x: number, z: number }}
 */
export function getPlacementXZ(id) {
  const p = BY_ID[id] || BY_ID.east;
  return { x: p.x, z: p.z };
}

/**
 * @param {object} vrm
 * @param {AvatarPlacementId | string} [id]
 * @returns {{ x: number, z: number } | null}
 */
export function applyAvatarPlacement(vrm, id) {
  if (!vrm?.scene) return null;
  const { x, z } = getPlacementXZ(id);
  vrm.scene.position.set(x, 0, z);
  return { x, z };
}

/** @param {object} vrm @param {object} settings */
export function applyAvatarPlacementFromSettings(vrm, settings) {
  const id = settings?.scene?.avatarPlacement || 'east';
  return applyAvatarPlacement(vrm, id);
}
