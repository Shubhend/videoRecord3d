const HAIR_NAME_PATTERN = /hair|Hair|HAIR|髪|カミ|gumi|Gumi|Strand|strand|Fringe|fringe|Bang|bang|Wig|wig|Toupee|toupee/;
const HEAD_NAME_PATTERN = /\bHead\b|\bhead\b|M_Head|m_head|Skull|skull|Face|face|顔|カオ|Mesh_Head|mesh_head|Head_.*\bMesh\b/;
const ARM_NAME_PATTERN = /Arm|arm|Hand|hand|Wrist|wrist|Elbow|elbow|Finger|finger|Thumb|thumb|Palm|palm|腕|テ|手首|指/;
const LEG_NAME_PATTERN = /Leg|leg|Foot|foot|Shoe|shoe|Pants|pants|Knee|knee|Ankle|ankle|Thigh|thigh|Shin|shin|Calf|calf|靴|ズボン|腿|膝|足|足首/;
const BODY_NAME_PATTERN = /Torso|torso|Body|body|Shirt|shirt|Jacket|jacket|Dress|dress|Skirt|skirt|Coat|coat|Sweater|sweater|Vest|vest|Pantsu|pantsu|Underwear|underwear|Bra|bra|Hip|hip|Waist|waist|Chest|chest|Spine|spine|胴体|シャツ|スカート|ドレス|上着|ズボン/;

const VRM_HEAD_BONES = new Set(['head']);
const VRM_ARM_BONES = new Set([
  'leftShoulder', 'rightShoulder',
  'leftUpperArm', 'rightUpperArm',
  'leftLowerArm', 'rightLowerArm',
  'leftHand', 'rightHand',
]);
const VRM_SPINE_BONES = new Set([
  'hips', 'spine', 'chest', 'upperChest', 'neck',
]);
const VRM_LEG_BONES = new Set([
  'leftUpperLeg', 'rightUpperLeg',
  'leftLowerLeg', 'rightLowerLeg',
  'leftFoot', 'rightFoot',
  'leftToes', 'rightToes',
]);

function collectBoneMeshes(root, boneSet, vrm) {
  const result = [];
  if (!vrm?.humanoid) return result;
  const seen = new WeakSet();
  for (const boneName of boneSet) {
    const node = vrm.humanoid.getNormalizedBoneNode?.(boneName)
      || vrm.humanoid.getBoneNode?.(boneName);
    if (!node) continue;
    node.traverse((obj) => {
      if (obj.isMesh && !seen.has(obj)) {
        seen.add(obj);
        result.push(obj);
      }
    });
  }
  return result;
}

function nameMatches(str, pattern) {
  return pattern.test(String(str || ''));
}

function getAllMeshes(root) {
  const meshes = [];
  if (!root) return meshes;
  root.traverse((obj) => {
    if (obj.isMesh) meshes.push(obj);
  });
  return meshes;
}

function classifyByHeuristics(meshes, classified, assigned) {
  for (const mesh of meshes) {
    if (assigned.has(mesh)) continue;
    const name = mesh.name || '';
    if (nameMatches(name, HAIR_NAME_PATTERN)) {
      classified.hairMeshes.push(mesh);
      assigned.add(mesh);
    } else if (nameMatches(name, HEAD_NAME_PATTERN)) {
      classified.headMeshes.push(mesh);
      assigned.add(mesh);
    }
  }

  for (const mesh of meshes) {
    if (assigned.has(mesh)) continue;
    const name = mesh.name || '';
    if (nameMatches(name, ARM_NAME_PATTERN)) {
      classified.armsMeshes.push(mesh);
      assigned.add(mesh);
    }
  }

  for (const mesh of meshes) {
    if (assigned.has(mesh)) continue;
    const name = mesh.name || '';
    if (nameMatches(name, LEG_NAME_PATTERN)) {
      classified.legsMeshes.push(mesh);
      assigned.add(mesh);
    }
  }

  for (const mesh of meshes) {
    if (assigned.has(mesh)) continue;
    const name = mesh.name || '';
    if (nameMatches(name, BODY_NAME_PATTERN) || !nameMatches(name, HEAD_NAME_PATTERN)) {
      classified.bodyMeshes.push(mesh);
      assigned.add(mesh);
    }
  }

  for (const mesh of meshes) {
    if (assigned.has(mesh)) continue;
    classified.bodyMeshes.push(mesh);
    assigned.add(mesh);
  }
}

export function classifyParts(root, vrm) {
  const classified = {
    headMeshes: [],
    hairMeshes: [],
    bodyMeshes: [],
    armsMeshes: [],
    legsMeshes: [],
  };

  const allMeshes = getAllMeshes(root);
  if (allMeshes.length === 0) return classified;

  const assigned = new WeakSet();

  if (vrm?.humanoid) {
    const headBoneMeshes = collectBoneMeshes(root, VRM_HEAD_BONES, vrm);
    const spineBoneMeshes = collectBoneMeshes(root, VRM_SPINE_BONES, vrm);
    const armBoneMeshes = collectBoneMeshes(root, VRM_ARM_BONES, vrm);
    const legBoneMeshes = collectBoneMeshes(root, VRM_LEG_BONES, vrm);

    for (const mesh of headBoneMeshes) {
      const name = mesh.name || '';
      if (nameMatches(name, HAIR_NAME_PATTERN)) {
        if (!assigned.has(mesh)) {
          classified.hairMeshes.push(mesh);
          assigned.add(mesh);
        }
      } else {
        if (!assigned.has(mesh)) {
          classified.headMeshes.push(mesh);
          assigned.add(mesh);
        }
      }
    }

    for (const mesh of armBoneMeshes) {
      if (!assigned.has(mesh)) {
        classified.armsMeshes.push(mesh);
        assigned.add(mesh);
      }
    }

    for (const mesh of legBoneMeshes) {
      if (!assigned.has(mesh)) {
        classified.legsMeshes.push(mesh);
        assigned.add(mesh);
      }
    }

    for (const mesh of spineBoneMeshes) {
      if (!assigned.has(mesh)) {
        classified.bodyMeshes.push(mesh);
        assigned.add(mesh);
      }
    }
  }

  classifyByHeuristics(allMeshes, classified, assigned);

  classified._originalVisibility = new WeakMap();
  for (const key of ['headMeshes', 'hairMeshes', 'bodyMeshes', 'armsMeshes', 'legsMeshes']) {
    for (const mesh of classified[key]) {
      classified._originalVisibility.set(mesh, !!mesh.visible);
    }
  }

  return classified;
}

export function applyBodyVisibility(root, vrm, classified, visibility) {
  if (!classified) return;
  const { showHead = true, showHair = true, showBody = true, showArms = true, showLegs = true, headOnly = false } = visibility || {};

  const groups = [
    { list: classified.headMeshes, show: headOnly ? true : showHead },
    { list: classified.hairMeshes, show: headOnly ? true : showHair },
    { list: classified.bodyMeshes, show: headOnly ? false : showBody },
    { list: classified.armsMeshes, show: headOnly ? false : showArms },
    { list: classified.legsMeshes, show: headOnly ? false : showLegs },
  ];

  const origVis = classified._originalVisibility;

  for (const { list, show } of groups) {
    if (!list) continue;
    for (const mesh of list) {
      if (!mesh) continue;
      if (origVis && origVis.has(mesh) && !origVis.get(mesh)) {
        mesh.visible = false;
      } else {
        mesh.visible = !!show;
      }
    }
  }
}
