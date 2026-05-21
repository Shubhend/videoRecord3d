/** Map morph target names on a GLB/VRM mesh → MediaPipe ARKit blendshape keys. */

const KNOWN_ARKIT = new Set([
  'eyeBlinkLeft',
  'eyeBlinkRight',
  'eyeLookUpLeft',
  'eyeLookUpRight',
  'eyeLookDownLeft',
  'eyeLookDownRight',
  'eyeLookInLeft',
  'eyeLookInRight',
  'eyeLookOutLeft',
  'eyeLookOutRight',
  'eyeSquintLeft',
  'eyeSquintRight',
  'eyeWideLeft',
  'eyeWideRight',
  'jawOpen',
  'jawForward',
  'jawLeft',
  'jawRight',
  'mouthClose',
  'mouthFunnel',
  'mouthPucker',
  'mouthLeft',
  'mouthRight',
  'mouthSmileLeft',
  'mouthSmileRight',
  'mouthFrownLeft',
  'mouthFrownRight',
  'mouthDimpleLeft',
  'mouthDimpleRight',
  'mouthStretchLeft',
  'mouthStretchRight',
  'mouthRollLower',
  'mouthRollUpper',
  'mouthShrugLower',
  'mouthShrugUpper',
  'mouthPressLeft',
  'mouthPressRight',
  'mouthUpperUpLeft',
  'mouthUpperUpRight',
  'mouthLowerDownLeft',
  'mouthLowerDownRight',
  'browDownLeft',
  'browDownRight',
  'browInnerUp',
  'noseSneerLeft',
  'noseSneerRight',
  'cheekPuff',
  'cheekSquintLeft',
  'cheekSquintRight',
]);

/** VRM / custom preset → ARKit */
const PRESET_TO_ARKIT = {
  aa: 'jawOpen',
  ih: 'mouthUpperUpLeft',
  ou: 'mouthPucker',
  ee: 'mouthStretchLeft',
  oh: 'mouthFunnel',
  happy: 'mouthSmileLeft',
  sad: 'mouthFrownLeft',
  angry: 'browDownLeft',
  surprised: 'browInnerUp',
  blink: 'eyeBlinkLeft',
  blinkleft: 'eyeBlinkLeft',
  blinkright: 'eyeBlinkRight',
  neutral: 'mouthClose',
  relaxed: 'mouthClose',
  lookup: 'eyeLookUpLeft',
  lookdown: 'eyeLookDownLeft',
  lookleft: 'eyeLookOutLeft',
  lookright: 'eyeLookInLeft',
};

const MOUTH_ARKIT = new Set([
  'jawOpen',
  'jawForward',
  'jawLeft',
  'jawRight',
  'mouthClose',
  'mouthFunnel',
  'mouthPucker',
  'mouthLeft',
  'mouthRight',
  'mouthSmileLeft',
  'mouthSmileRight',
  'mouthFrownLeft',
  'mouthFrownRight',
  'mouthStretchLeft',
  'mouthStretchRight',
  'mouthUpperUpLeft',
  'mouthUpperUpRight',
  'mouthLowerDownLeft',
  'mouthLowerDownRight',
  'mouthRollLower',
  'mouthRollUpper',
  'mouthShrugLower',
  'mouthShrugUpper',
  'mouthPressLeft',
  'mouthPressRight',
  'mouthDimpleLeft',
  'mouthDimpleRight',
]);

function normalizeKey(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[\s._-]+/g, '');
}

function toCamelCase(norm) {
  if (!norm) return '';
  if (KNOWN_ARKIT.has(norm)) return norm;
  const parts = norm.split(/[^a-z0-9]+/i).filter(Boolean);
  if (!parts.length) return norm;
  return parts[0].toLowerCase() + parts.slice(1).map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join('');
}

/**
 * @param {string} morphName
 * @returns {string|null} ARKit category name
 */
export function morphNameToArkit(morphName) {
  if (!morphName) return null;
  if (KNOWN_ARKIT.has(morphName)) return morphName;

  const norm = normalizeKey(morphName);
  if (PRESET_TO_ARKIT[norm]) return PRESET_TO_ARKIT[norm];

  const camel = toCamelCase(norm);
  if (KNOWN_ARKIT.has(camel)) return camel;

  for (const arkit of KNOWN_ARKIT) {
    const a = normalizeKey(arkit);
    if (norm === a || norm.includes(a) || a.includes(norm)) return arkit;
  }

  if (/fcl_mth_a/i.test(morphName)) return 'jawOpen';
  if (/fcl_mth_i/i.test(morphName)) return 'mouthUpperUpLeft';
  if (/fcl_mth_u/i.test(morphName)) return 'mouthPucker';
  if (/fcl_mth_e/i.test(morphName)) return 'mouthStretchLeft';
  if (/fcl_mth_o/i.test(morphName)) return 'mouthFunnel';
  if (/fcl_mth_close/i.test(morphName)) return 'mouthClose';
  if (/fcl_eye_close/i.test(morphName)) return 'eyeBlinkLeft';
  if (/^aa$/i.test(norm) || /^a$/i.test(norm)) return 'jawOpen';
  if (/^ih$/i.test(norm) || /^i$/i.test(norm)) return 'mouthUpperUpLeft';
  if (/^ou$/i.test(norm) || /^u$/i.test(norm)) return 'mouthPucker';
  if (/^ee$/i.test(norm) || /^e$/i.test(norm)) return 'mouthStretchLeft';
  if (/^oh$/i.test(norm) || /^o$/i.test(norm)) return 'mouthFunnel';
  if (/jaw|open|viseme.*a|mouthopen/i.test(morphName)) return 'jawOpen';
  if (/pucker|ou\b|viseme.*u/i.test(morphName)) return 'mouthPucker';
  if (/funnel|oh\b/i.test(morphName)) return 'mouthFunnel';
  if (/smile|happy/i.test(morphName)) return 'mouthSmileLeft';
  if (/frown|sad/i.test(morphName)) return 'mouthFrownLeft';
  if (/blink/i.test(morphName)) return /right/i.test(morphName) ? 'eyeBlinkRight' : 'eyeBlinkLeft';
  if (/stretch|ee\b|viseme.*e/i.test(morphName)) return 'mouthStretchLeft';
  if (/close/i.test(morphName)) return 'mouthClose';

  return null;
}

export function isMouthArkit(arkitName) {
  return MOUTH_ARKIT.has(arkitName);
}

/** VRM viseme presets → ARKit keys (for audio lip-sync → morph targets). */
export const VRM_MOUTH_TO_ARKIT = {
  aa: ['jawOpen'],
  ih: ['mouthUpperUpLeft', 'mouthUpperUpRight'],
  ou: ['mouthPucker', 'mouthFunnel'],
  ee: ['mouthStretchLeft', 'mouthStretchRight'],
  oh: ['mouthFunnel', 'mouthClose'],
};

export function mouthWeightsToArkitMap(vrmMouthWeights) {
  const out = new Map();
  for (const [preset, arkitList] of Object.entries(VRM_MOUTH_TO_ARKIT)) {
    const w = Math.max(0, Number(vrmMouthWeights[preset]) || 0);
    if (w <= 0) continue;
    for (const arkit of arkitList) {
      const prev = out.get(arkit) ?? 0;
      out.set(arkit, Math.max(prev, w));
    }
  }
  return out;
}

/**
 * @param {THREE.Mesh[]} meshes
 * @returns {{ entries: { mesh, morphName, arkitName, idx }[], arkitNames: Set<string> }}
 */
export function buildMorphBindings(meshes) {
  const entries = [];
  const arkitNames = new Set();
  for (const mesh of meshes) {
    const dict = mesh.morphTargetDictionary;
    if (!dict || !mesh.morphTargetInfluences) continue;
    for (const morphName of Object.keys(dict)) {
      const arkitName = morphNameToArkit(morphName);
      if (!arkitName) continue;
      const idx = dict[morphName];
      entries.push({ mesh, morphName, arkitName, idx });
      arkitNames.add(arkitName);
    }
  }
  return { entries, arkitNames };
}
