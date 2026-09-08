/** Shared defaults between face-follow modules (placement + body parts). */

export const PLACEMENT_VERSION = 4;

export const DEFAULT_PLACEMENT = {
  version: PLACEMENT_VERSION,
  posX: 0.025,
  posY: -13,
  posZ: 0.003,
  rotX: 0,
  rotY: 0,
  rotZ: 0,
  scaleMul: 1,
};

export const DEFAULT_BODY_PARTS = {
  showHead: true,
  showHair: true,
  showBody: true,
  showArms: true,
  showLegs: true,
  headOnly: false,
};
