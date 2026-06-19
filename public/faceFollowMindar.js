/**
 * Face follow — MindAR + expressions + record + audio lip-sync + background.
 */
import * as THREE from 'three';
import { MindARThree } from 'mindar-face-three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { applyExprMultiplier, exprGainForArkit } from './faceFollowExprControls.js';
import {
  getAppExpressionSensitivities,
  buildExprSettingsFromApp,
  getFaceTrackingLerp,
} from './faceFollowAppSettings.js';
import { FaceBackground } from './faceFollowBackground.js';
import { FaceRecorder } from './faceFollowRecorder.js';
import { AudioLipSync } from './faceFollowAudioLip.js';
import {
  populateModelSelect,
  getModelSource,
  getSelectedModelId,
  setSelectedModelId,
} from './faceFollowModelStore.js';
import {
  buildMorphBindings,
  isMouthArkit,
  mouthWeightsToArkitMap,
} from './faceFollowMorphMap.js';
import { attachModelLikeBlender } from './faceFollowAlign.js';

const MOUTH_EXPR_KEYS = ['aa', 'ih', 'ou', 'ee', 'oh'];

/** VRM presets driven by face tracking while audio owns mouth visemes. */
const FACE_VRM_EXPR_KEYS = [
  'blinkLeft',
  'blinkRight',
  'blink',
  'happy',
  'sad',
  'angry',
  'surprised',
  'relaxed',
  'lookUp',
  'lookDown',
  'lookLeft',
  'lookRight',
  'neutral',
];

const PLACEMENT_KEY = 'faceFollowPlacement_v4';
const PLACEMENT_VERSION = 4;
const BODY_PARTS_KEY = 'faceFollowBodyParts';

const HEAD_NAME_RE =
  /face|head|eye|teeth|brow|lash|mouth|tongue|ear|pupil|iris|sclera|lip|nose|cheek|facial|tooth|gem|piercing|mask/i;
const HAIR_NAME_RE = /hair|bang|fringe|eyebrow|eyelash/i;
const BODY_NAME_RE =
  /body|torso|shirt|pants|skirt|dress|coat|jacket|sleeve|waist|chest|bra|outfit|cloth|wear|uniform|suit|acc_body/i;
const ARM_NAME_RE = /arm|hand|finger|wrist|elbow|shoulder|glove/i;
const LEG_NAME_RE = /leg|foot|shoe|thigh|calf|hip|sock|boot|heel|ankle/i;
/** Do not match VRoid/MToon “outline” meshes — only obvious debug overlays. */
const ARTIFACT_RE = /sticker|decal|makeup|facepaint|lineart|debug|helper|ghost/i;

const DEFAULT_BODY_PARTS = {
  showHead: true,
  showHair: true,
  showBody: true,
  showArms: true,
  showLegs: true,
  headOnly: false,
};
const UV_MAP_URL =
  'https://cdn.jsdelivr.net/gh/hiukim/mind-ar-js@1.2.5/examples/face-tracking/assets/canonical_face_model_uv_visualization.png';

const DEFAULT_PLACEMENT = {
  version: PLACEMENT_VERSION,
  posX: 0.025,
  posY: -13,
  posZ: 0.003,
  rotX: 0,
  rotY: 0,
  rotZ: 0,
  scaleMul: 1,
};

const $ = (id) => document.getElementById(id);
const container = $('container');
const statusEl = $('status');
const hudEl = $('hud');
const btnStart = $('btn-start');
const btnModel = $('btn-model');
const btnStop = $('btn-stop');
const btnResetPlacement = $('btn-reset-placement');
const showMeshInput = $('show-mesh');
const showPipInput = $('show-pip');
const videoFeed = $('video-feed');
const tuningPanel = $('tuning-panel');
const bodyPanel = $('body-panel');
const btnResetBody = $('btn-reset-body');
const bodyPartInputs = {
  showHead: $('bp-head'),
  showHair: $('bp-hair'),
  showBody: $('bp-body'),
  showArms: $('bp-arms'),
  showLegs: $('bp-legs'),
  headOnly: $('bp-head-only'),
};

const placementInputs = {
  posX: $('in-pos-x'),
  posY: $('in-pos-y'),
  posZ: $('in-pos-z'),
  rotX: $('in-rot-x'),
  rotY: $('in-rot-y'),
  rotZ: $('in-rot-z'),
  scaleMul: $('in-scale'),
};

/** Match record.html / avatarRig audio mouth smoothing. */
const AUDIO_MOUTH_LERP = 0.5;

/** VRoid vowel morphs only — exclude Open/Close (mth_o matches inside mth_open). */
const VROID_MOUTH_RULES = [
  { preset: 'aa', re: /fcl_mth_a$/i },
  { preset: 'ih', re: /fcl_mth_i$/i },
  { preset: 'ou', re: /fcl_mth_u$/i },
  { preset: 'ee', re: /fcl_mth_e$/i },
  { preset: 'oh', re: /fcl_mth_o$/i },
];

function clamp01(v) {
  return Math.min(1, Math.max(0, Number(v) || 0));
}

/** Keep GLB/VRM/MToon colors as authored (same idea as blender.html). */
function preserveModelMaterials(root) {
  if (!root) return;
  root.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of mats) {
      if (!mat) continue;
      mat.toneMapped = false;
      if (mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
      if (mat.emissiveMap) mat.emissiveMap.colorSpace = THREE.SRGBColorSpace;
    }
  });
}

/** Raw ARKit score (no clamp — gain applied later). */
function arkitScore(arkit, k) {
  return Math.max(0, Number(arkit.get(k)) || 0);
}

/** MediaPipe ARKit → VRM 1.0 / 2.x expression preset names */
function arkitToVrmExpressionWeights(arkit) {
  const g = (k) => arkitScore(arkit, k);
  const smile = (g('mouthSmileLeft') + g('mouthSmileRight')) * 0.5;
  const frown = (g('mouthFrownLeft') + g('mouthFrownRight')) * 0.5;
  const jawOpen = g('jawOpen');
  const mouthClose = g('mouthClose');

  return {
    blinkLeft: g('eyeBlinkLeft'),
    blinkRight: g('eyeBlinkRight'),
    blink: Math.max(g('eyeBlinkLeft'), g('eyeBlinkRight')),
    aa: jawOpen * 1.35 - mouthClose * 0.15,
    ih: (g('mouthUpperUpLeft') + g('mouthUpperUpRight')) * 0.65,
    ou: g('mouthPucker') * 1.25 + g('mouthFunnel') * 0.7,
    ee:
      (g('mouthStretchLeft') + g('mouthStretchRight')) * 0.65 +
      (g('mouthLeft') + g('mouthRight')) * 0.3,
    oh: g('mouthFunnel') * 0.85 + mouthClose * 0.9,
    happy: smile * 1.25 - frown * 0.12,
    sad: frown * 1.2,
    angry:
      (g('browDownLeft') + g('browDownRight')) * 0.6 +
      (g('eyeSquintLeft') + g('eyeSquintRight')) * 0.25,
    surprised: g('browInnerUp') * 1.2 + (g('eyeWideLeft') + g('eyeWideRight')) * 0.3,
    relaxed: 0.1 * (1 - jawOpen),
    lookUp: (g('eyeLookUpLeft') + g('eyeLookUpRight')) * 0.55,
    lookDown: (g('eyeLookDownLeft') + g('eyeLookDownRight')) * 0.55,
    lookLeft: (g('eyeLookOutLeft') + g('eyeLookInRight')) * 0.55,
    lookRight: (g('eyeLookInLeft') + g('eyeLookOutRight')) * 0.55,
    neutral: Math.max(0, 1 - jawOpen - smile * 0.45),
  };
}

class FaceAvatar {
  constructor() {
    this.gltf = null;
    this.vrm = null;
    this.morphTargetMeshes = [];
    this.morphBindings = [];
    this.mappedArkitNames = new Set();
    this.vrmExprNames = new Set();
    this.smoothed = new Map();
    this.morphSmoothed = new Map();
    this.exprIntensity = 1;
    this.mouthIntensity = 1;
    this.expressionsEnabled = true;
    this.exprSettings = buildExprSettingsFromApp(getAppExpressionSensitivities());
    this.useAudioMouth = false;
    this.audioLip = null;
    this.vrmPresetToVrm = new Map();
    this.displayRoot = null;
    /** Cached VRoid mouth morph indices — built once in init(). */
    this._mouthMorphEntries = [];
    /** Jaw / open morphs driven mainly by mouthOpen (not O viseme). */
    this._mouthOpenMorphEntries = [];
    /** Non-mouth morph bindings for fast face tracking during audio. */
    this._faceMorphBindings = [];
  }

  _exprLerpFactor(forAudio = false) {
    if (forAudio) return AUDIO_MOUTH_LERP;
    return getFaceTrackingLerp();
  }

  async init(loadTarget) {
    const url =
      typeof loadTarget === 'string'
        ? loadTarget
        : loadTarget?.type === 'blob'
          ? URL.createObjectURL(loadTarget.value)
          : loadTarget?.value;
    const revoke = typeof loadTarget === 'object' && loadTarget?.type === 'blob';

    const { VRMLoaderPlugin } = await import('@pixiv/three-vrm');
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    let gltf;
    try {
      gltf = await loader.loadAsync(url);
    } finally {
      if (revoke) URL.revokeObjectURL(url);
    }

    this.gltf = gltf;
    this.vrm = gltf.userData?.vrm ?? null;
    if (this.vrm) {
      try {
        const { VRMUtils } = await import('@pixiv/three-vrm');
        VRMUtils.rotateVRM0(this.vrm);
      } catch {
        /* optional */
      }
    }

    const root = gltf.scene;
    this.displayRoot = root;
    root.traverse((object) => {
      if (object.isBone && !this.root) this.root = object;
      if (!object.isMesh) return;
      const mesh = object;
      if (mesh.morphTargetDictionary && mesh.morphTargetInfluences) {
        this.morphTargetMeshes.push(mesh);
      }
    });

    root.traverse((obj) => {
      if (!obj.isMesh) return;
      obj.frustumCulled = false;
      obj.visible = true;
    });
    preserveModelMaterials(root);

    const em = this.vrm?.expressionManager;
    if (em?.expressionMap) {
      this.vrmExprNames = new Set(Object.keys(em.expressionMap));
    } else if (em?.expressions?.length) {
      em.expressions.forEach((e) => this.vrmExprNames.add(e.expressionName));
    }
    const vrmPresetAlias = { aa: 'a', ih: 'i', ou: 'u', ee: 'e', oh: 'o' };
    for (const [arkitStyle, vrmName] of Object.entries(vrmPresetAlias)) {
      if (this.vrmExprNames.has(vrmName)) this.vrmPresetToVrm.set(arkitStyle, vrmName);
      if (this.vrmExprNames.has(arkitStyle)) this.vrmPresetToVrm.set(arkitStyle, arkitStyle);
    }

    const { entries, arkitNames } = buildMorphBindings(this.morphTargetMeshes);
    this.morphBindings = entries;
    this.mappedArkitNames = arkitNames;
    this._faceMorphBindings = entries.filter((b) => !isMouthArkit(b.arkitName));
    this._buildMouthMorphCache();

    return root;
  }

  _buildMouthMorphCache() {
    this._mouthMorphEntries = [];
    this._mouthOpenMorphEntries = [];
    const seen = new Set();
    const seenOpen = new Set();
    for (const mesh of this.morphTargetMeshes) {
      const dict = mesh.morphTargetDictionary;
      if (!dict || !mesh.morphTargetInfluences) continue;
      for (const morphName of Object.keys(dict)) {
        const idx = dict[morphName];
        const key = `${mesh.uuid}:${idx}`;
        if (this._isJawOpenMorph(morphName)) {
          if (seenOpen.has(key)) continue;
          seenOpen.add(key);
          this._mouthOpenMorphEntries.push({ mesh, idx });
          continue;
        }
        const preset = this._matchVroidMouthPreset(morphName);
        if (!preset) continue;
        if (seen.has(key)) continue;
        seen.add(key);
        this._mouthMorphEntries.push({ mesh, idx, preset });
      }
    }
  }

  _isJawOpenMorph(morphName) {
    const norm = String(morphName || '').toLowerCase();
    return /fcl_mth_open|fclmthopen|mth_open|jaw_?open|mouth_?open/i.test(norm);
  }

  /** VRoid: Fcl_MTH_A is jaw/あ — not the same as ARKit jawOpen on other meshes. */
  _isVroidVowelMorph(morphName) {
    return /^fcl_mth_[aieou]$/i.test(String(morphName || '').trim());
  }

  setExpressionOptions({ enabled, intensity, mouthIntensity, exprSettings, useAudioMouth, audioLip }) {
    if (enabled != null) this.expressionsEnabled = !!enabled;
    if (intensity != null) this.exprIntensity = Math.max(0.25, Math.min(5, intensity));
    if (mouthIntensity != null) this.mouthIntensity = Math.max(0.25, Math.min(5, mouthIntensity));
    if (exprSettings) this.exprSettings = exprSettings;
    if (useAudioMouth != null) this.useAudioMouth = !!useAudioMouth;
    if (audioLip != null) this.audioLip = audioLip;
  }

  _lerpExpr(key, target, lerp) {
    const factor = lerp ?? this._exprLerpFactor();
    const prev = this.smoothed.get(key) ?? target;
    const next = prev + (target - prev) * factor;
    this.smoothed.set(key, next);
    return next;
  }

  _lerpMorph(key, target, lerp) {
    const factor = lerp ?? this._exprLerpFactor();
    const prev = this.morphSmoothed.get(key) ?? target;
    const next = prev + (target - prev) * factor;
    this.morphSmoothed.set(key, next);
    return next;
  }

  _setMorphInfluence(mesh, idx, target, lerp) {
    const factor = lerp ?? this._exprLerpFactor();
    const key = `${mesh.uuid}:inf:${idx}`;
    const smoothed = this._lerpMorph(key, target, factor);
    mesh.morphTargetInfluences[idx] = smoothed;
  }

  _setVrmExpression(name, weight) {
    const em = this.vrm?.expressionManager;
    if (!em) return;
    const vrmName = this.vrmPresetToVrm.get(name) || name;
    if (!this.vrmExprNames.has(vrmName)) return;
    const w = clamp01(weight);
    em.setValue(vrmName, this._lerpExpr(`vrm:${vrmName}`, w));
  }

  _applyMorphFromMap(arkit, { skipMouth = false, onlyMouth = false, lerp } = {}) {
    const trackLerp = lerp ?? this._exprLerpFactor(onlyMouth);

    const applyScore = (mesh, arkitName, idx, score) => {
      if (onlyMouth && !isMouthArkit(arkitName)) return;
      if (skipMouth && isMouthArkit(arkitName)) return;
      const globalGain = isMouthArkit(arkitName) ? this.mouthIntensity : this.exprIntensity;
      const gain = exprGainForArkit(arkitName, this.exprSettings, globalGain);
      const target = Math.min(1, Math.max(0, score * gain));
      this._setMorphInfluence(mesh, idx, target, trackLerp);
    };

    for (const { mesh, arkitName, idx } of this.morphBindings) {
      const score = arkit.get(arkitName);
      if (score === undefined) continue;
      applyScore(mesh, arkitName, idx, score);
    }
    for (const mesh of this.morphTargetMeshes) {
      if (!mesh.morphTargetDictionary || !mesh.morphTargetInfluences) continue;
      for (const [arkitName, score] of arkit) {
        if (this.mappedArkitNames.has(arkitName)) continue;
        const idx = mesh.morphTargetDictionary[arkitName];
        if (idx === undefined) continue;
        applyScore(mesh, arkitName, idx, score);
      }
    }
  }

  _applyMorphTargets(arkit) {
    this._applyMorphFromMap(arkit);
  }

  _applyAudioMouthMorphs(vrmWeights) {
    const arkit = mouthWeightsToArkitMap(vrmWeights);
    if (arkit.size) {
      this._applyMorphFromMap(arkit, { onlyMouth: true, lerp: AUDIO_MOUTH_LERP });
    }
    this._applyDirectMouthPresets(vrmWeights, AUDIO_MOUTH_LERP);
  }

  /** Drive morph targets named aa / ih / viseme_* directly (VRoid / custom GLB). */
  _applyDirectMouthPresets(vrmWeights, lerp) {
    const mouthLerp = lerp ?? AUDIO_MOUTH_LERP;
    for (const mesh of this.morphTargetMeshes) {
      const dict = mesh.morphTargetDictionary;
      if (!dict || !mesh.morphTargetInfluences) continue;
      for (const morphName of Object.keys(dict)) {
        const norm = morphName.toLowerCase().replace(/[\s._-]+/g, '');
        let preset = null;
        if (/fclmtha$/i.test(norm)) preset = 'aa';
        else if (/fclmthi$/i.test(norm)) preset = 'ih';
        else if (/fclmthu$/i.test(norm)) preset = 'ou';
        else if (/fclmthe$/i.test(norm)) preset = 'ee';
        else if (/fclmtho$/i.test(norm)) preset = 'oh';
        for (const key of MOUTH_EXPR_KEYS) {
          if (preset) break;
          if (norm === key || norm.endsWith(key) || norm.includes(`viseme${key}`)) {
            preset = key;
            break;
          }
        }
        if (!preset || vrmWeights[preset] == null) continue;
        const s = this.exprSettings[preset] || { enabled: true, amount: 1 };
        const audioDrive = mouthLerp >= AUDIO_MOUTH_LERP - 0.01;
        if (!s.enabled && !audioDrive) continue;
        const target = Math.min(
          1,
          vrmWeights[preset] * this.mouthIntensity * (audioDrive ? 1 : Number(s.amount) || 1)
        );
        const idx = dict[morphName];
        this._setMorphInfluence(mesh, idx, target, mouthLerp);
      }
    }
  }

  _applyVrmExpressions(vrmWeights, lerp) {
    const scaled = applyExprMultiplier(
      vrmWeights,
      this.exprSettings,
      this.exprIntensity
    );
    for (const [name, weight] of Object.entries(scaled)) {
      const w = clamp01(weight);
      const em = this.vrm?.expressionManager;
      if (!em) continue;
      const vrmName = this.vrmPresetToVrm.get(name) || name;
      if (!this.vrmExprNames.has(vrmName)) continue;
      em.setValue(vrmName, this._lerpExpr(`vrm:${vrmName}`, w, lerp));
    }
  }

  _applyLookAt(arkit) {
    const lookAt = this.vrm?.lookAt;
    if (!lookAt?.applier) return;
    const g = (k) => clamp01(arkit.get(k));
    const yaw =
      ((g('eyeLookOutLeft') + g('eyeLookInRight')) - (g('eyeLookInLeft') + g('eyeLookOutRight'))) *
      0.35 *
      this.exprIntensity;
    const pitch =
      ((g('eyeLookUpLeft') + g('eyeLookUpRight')) - (g('eyeLookDownLeft') + g('eyeLookDownRight'))) *
      0.35 *
      this.exprIntensity;
    if (typeof lookAt.yaw === 'number') lookAt.yaw = yaw;
    if (typeof lookAt.pitch === 'number') lookAt.pitch = pitch;
    if (lookAt.applier?.lookAt) {
      const euler = new THREE.Euler(pitch, yaw, 0, 'YXZ');
      lookAt.applier.lookAt(euler);
    }
  }

  _matchVroidMouthPreset(morphName) {
    const raw = String(morphName || '').trim();
    const norm = raw.toLowerCase();
    if (this._isJawOpenMorph(morphName)) return null;
    if (/neutral|_close|angry|fun|sorrow|surprise|relaxed|_up$|_down$|_large|_small|skin/i.test(norm)) {
      return null;
    }
    if (this._isVroidVowelMorph(raw)) {
      const letter = norm.slice(-1);
      return { a: 'aa', i: 'ih', u: 'ou', e: 'ee', o: 'oh' }[letter] || null;
    }
    for (const { preset, re } of VROID_MOUTH_RULES) {
      if (re.test(norm)) return preset;
    }
    const n = norm.replace(/[\s._-]+/g, '');
    if (n === 'fclmtha' || n === 'aa' || n === 'a') return 'aa';
    if (n === 'fclmthi' || n === 'ih' || n === 'i') return 'ih';
    if (n === 'fclmthu' || n === 'ou' || n === 'u') return 'ou';
    if (n === 'fclmthe' || n === 'ee' || n === 'e') return 'ee';
    if (n === 'fclmtho' || n === 'oh' || n === 'o') return 'oh';
    return null;
  }

  /** Fast mouth apply — cached morphs + VRM only (same idea as avatarRig.setMouthOverride). */
  _applyAudioMouthCached(mouth) {
    const scaled = {};
    const jawOpen = clamp01(mouth.mouthOpen ?? 0);
    for (const key of MOUTH_EXPR_KEYS) {
      scaled[key] = clamp01((mouth[key] || 0) * this.mouthIntensity);
    }
    scaled.aa = clamp01(Math.max(scaled.aa, jawOpen * 0.55));

    for (const { mesh, idx } of this._mouthOpenMorphEntries) {
      const target = clamp01(jawOpen * this.mouthIntensity * 0.85);
      const cur = mesh.morphTargetInfluences[idx] || 0;
      mesh.morphTargetInfluences[idx] =
        cur + (target - cur) * AUDIO_MOUTH_LERP;
    }

    let dominant = MOUTH_EXPR_KEYS[0];
    let dominantV = scaled[dominant] || 0;
    for (const key of MOUTH_EXPR_KEYS) {
      if ((scaled[key] || 0) > dominantV) {
        dominantV = scaled[key];
        dominant = key;
      }
    }

    for (const { mesh, idx, preset } of this._mouthMorphEntries) {
      const base = scaled[preset] || 0;
      const target = preset === dominant ? base : base * 0.12;
      const cur = mesh.morphTargetInfluences[idx] || 0;
      mesh.morphTargetInfluences[idx] =
        cur + (target - cur) * AUDIO_MOUTH_LERP;
    }

    const em = this.vrm?.expressionManager;
    if (!em) return;
    for (const key of MOUTH_EXPR_KEYS) {
      const vrmName = this.vrmPresetToVrm.get(key) || key;
      if (!this.vrmExprNames.has(vrmName)) continue;
      const base = scaled[key];
      const target = key === dominant ? base : base * 0.12;
      const prev = em.getValue(vrmName) ?? 0;
      em.setValue(vrmName, prev + (target - prev) * AUDIO_MOUTH_LERP);
    }
  }

  /** Mouth from audio — one lightweight pass per frame (record.html style). */
  updateAudioLipSync() {
    if (!this.useAudioMouth || !this.audioLip?.enabled || !this.audioLip.isPlaying()) {
      return;
    }
    this._applyAudioMouthCached(this.audioLip.getMouthWeights());
  }

  /**
   * Live face (eyes, brows, smile…) while audio drives mouth — cached bindings only.
   */
  updateFaceExpressionsLive(blendshapes) {
    if (!this.expressionsEnabled || !blendshapes?.categories?.length) return;

    const arkit = new Map();
    for (const cat of blendshapes.categories) {
      arkit.set(cat.categoryName, cat.score);
    }

    for (const { mesh, arkitName, idx } of this._faceMorphBindings) {
      const score = arkit.get(arkitName);
      if (score === undefined) continue;
      const gain = exprGainForArkit(arkitName, this.exprSettings, this.exprIntensity);
      const target = Math.min(1, Math.max(0, score * gain));
      this._setMorphInfluence(mesh, idx, target);
    }

    const scaled = applyExprMultiplier(
      arkitToVrmExpressionWeights(arkit),
      this.exprSettings,
      this.exprIntensity
    );
    for (const name of FACE_VRM_EXPR_KEYS) {
      const weight = scaled[name];
      if (weight === undefined) continue;
      this._setVrmExpression(name, weight);
    }
    this._applyLookAt(arkit);
  }

  updateBlendshapes(blendshapes) {
    if (!blendshapes?.categories) return;

    const arkit = new Map();
    for (const cat of blendshapes.categories) {
      arkit.set(cat.categoryName, cat.score);
    }

    const vrmWeights = arkitToVrmExpressionWeights(arkit);
    const audioMouth =
      this.useAudioMouth && this.audioLip?.enabled && this.audioLip.isPlaying();

    if (!this.expressionsEnabled && !audioMouth) return;

    if (audioMouth) {
      if (this.expressionsEnabled) {
        this._applyMorphFromMap(arkit, { skipMouth: true });
        const scaled = applyExprMultiplier(vrmWeights, this.exprSettings, this.exprIntensity);
        for (const [name, weight] of Object.entries(scaled)) {
          if (MOUTH_EXPR_KEYS.includes(name)) continue;
          this._setVrmExpression(name, weight);
        }
        this._applyLookAt(arkit);
      }
      return;
    }

    this._applyMorphTargets(arkit);
    this._applyVrmExpressions(vrmWeights);
    this._applyLookAt(arkit);
  }

  fadeExpressions() {
    for (const key of [...this.smoothed.keys()]) {
      const prev = this.smoothed.get(key);
      const next = prev * 0.85;
      this.smoothed.set(key, next);
      if (next < 0.01) this.smoothed.delete(key);
    }
    const em = this.vrm?.expressionManager;
    if (em) {
      for (const name of this.vrmExprNames) {
        try {
          em.setValue(name, 0);
        } catch {
          /* skip */
        }
      }
    }
  }

  updateVrm(delta) {
    if (this.vrm?.update) this.vrm.update(delta);
  }
}

let mindarThree = null;
let renderer = null;
let scene = null;
let camera = null;
let faceMesh = null;
let faceAnchor = null;
let modelPivot = null;
let avatar = null;
let modelLoaded = false;
let running = false;
let placement = { ...DEFAULT_PLACEMENT };
let bodyParts = { ...DEFAULT_BODY_PARTS };
let baseFitScale = 2;
let faceStyleTex = null;
let faceUvTex = null;
let background = null;
let faceRecorder = null;
let audioLip = null;
let _bgImageEl = null;

function loadPlacement() {
  try {
    const raw = localStorage.getItem(PLACEMENT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.version === PLACEMENT_VERSION) {
        placement = { ...DEFAULT_PLACEMENT, ...parsed };
      } else {
        placement = { ...DEFAULT_PLACEMENT };
        savePlacement();
      }
    }
  } catch {
    placement = { ...DEFAULT_PLACEMENT };
  }
}

function savePlacement() {
  placement.version = PLACEMENT_VERSION;
  try {
    localStorage.setItem(PLACEMENT_KEY, JSON.stringify(placement));
  } catch {
    /* ignore */
  }
}

function setStatus(html, ok = false) {
  statusEl.className = ok ? 'panel ok' : 'panel warn';
  statusEl.innerHTML = html;
}

function setHud(text) {
  hudEl.textContent = text;
}

function setPlacementUnlocked(on) {
  if (tuningPanel) tuningPanel.classList.toggle('locked', !on);
}

function setBodyPartsUnlocked(on) {
  if (bodyPanel) bodyPanel.classList.toggle('locked', !on);
  Object.values(bodyPartInputs).forEach((el) => {
    if (el) el.disabled = !on;
  });
  if (btnResetBody) btnResetBody.disabled = !on;
}

function loadBodyParts() {
  try {
    const raw = localStorage.getItem(BODY_PARTS_KEY);
    if (raw) bodyParts = { ...DEFAULT_BODY_PARTS, ...JSON.parse(raw) };
  } catch {
    bodyParts = { ...DEFAULT_BODY_PARTS };
  }
}

function saveBodyParts() {
  try {
    localStorage.setItem(BODY_PARTS_KEY, JSON.stringify(bodyParts));
  } catch {
    /* ignore */
  }
}

function syncBodyPartsFromInputs() {
  for (const key of Object.keys(bodyPartInputs)) {
    const el = bodyPartInputs[key];
    if (!el || el.type !== 'checkbox') continue;
    bodyParts[key] = el.checked;
  }
}

function syncInputsFromBodyParts() {
  for (const key of Object.keys(bodyPartInputs)) {
    const el = bodyPartInputs[key];
    if (!el || el.type !== 'checkbox') continue;
    el.checked = bodyParts[key] !== false;
  }
}

function meshKind(mesh) {
  const n = String(mesh.name || '').toLowerCase();
  if (ARTIFACT_RE.test(n)) return 'artifact';
  if (HAIR_NAME_RE.test(n)) return 'hair';
  if (HEAD_NAME_RE.test(n)) return 'head';
  if (LEG_NAME_RE.test(n)) return 'legs';
  if (ARM_NAME_RE.test(n)) return 'arms';
  if (BODY_NAME_RE.test(n)) return 'body';
  return 'other';
}

function applyBodyPartVisibility() {
  if (!avatar) return;
  const root = avatar.displayRoot ?? avatar.vrm?.scene ?? avatar.gltf?.scene;
  if (!root) return;

  if (bodyParts.headOnly) {
    bodyParts.showHead = true;
    bodyParts.showHair = true;
    bodyParts.showBody = false;
    bodyParts.showArms = false;
    bodyParts.showLegs = false;
    syncInputsFromBodyParts();
  }

  root.traverse((obj) => {
    if (!obj.isMesh) return;
    const kind = meshKind(obj);
    let visible = true;
    switch (kind) {
      case 'artifact':
        visible = false;
        break;
      case 'head':
        visible = bodyParts.showHead;
        break;
      case 'hair':
        visible = bodyParts.showHair;
        break;
      case 'body':
        visible = bodyParts.showBody;
        break;
      case 'arms':
        visible = bodyParts.showArms;
        break;
      case 'legs':
        visible = bodyParts.showLegs;
        break;
      default:
        visible = bodyParts.showBody || bodyParts.showHead;
        break;
    }
    obj.visible = visible;
  });

  if (bodyParts.headOnly) {
    root.traverse((obj) => {
      if (!obj.isMesh) return;
      const n = String(obj.name || '');
      if (/face|hair|eye|mouth|iris|highlight/i.test(n)) obj.visible = true;
    });
  }

  saveBodyParts();
}

function syncInputsFromPlacement() {
  for (const key of Object.keys(placementInputs)) {
    const el = placementInputs[key];
    if (!el) continue;
    el.value = String(placement[key]);
  }
}

function readPlacementFromInputs() {
  for (const key of Object.keys(placementInputs)) {
    const el = placementInputs[key];
    if (!el) continue;
    const v = Number(el.value);
    if (Number.isFinite(v)) placement[key] = v;
  }
}

function applyPlacement() {
  if (!modelPivot) return;
  const deg = Math.PI / 180;
  modelPivot.position.set(placement.posX, placement.posY, placement.posZ);
  modelPivot.rotation.set(
    placement.rotX * deg,
    placement.rotY * deg,
    placement.rotZ * deg
  );
  modelPivot.scale.set(1, 1, 1);
  const root = avatar?.displayRoot ?? avatar?.gltf?.scene;
  if (root) {
    const s = 2 * (placement.scaleMul || 1);
    root.scale.setScalar(s);
  }
  savePlacement();
}

async function resolveModelSource() {
  const id = $('model-select')?.value || getSelectedModelId();
  return getModelSource(id);
}

/** Colorful skin-like gradient for the tracked face shell. */
function createFaceStyleTexture() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  const base = ctx.createRadialGradient(size * 0.5, size * 0.52, size * 0.08, size * 0.5, size * 0.5, size * 0.48);
  base.addColorStop(0, '#ffe8d6');
  base.addColorStop(0.35, '#f5b896');
  base.addColorStop(0.7, '#d9866a');
  base.addColorStop(1, '#8b4a3a');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  ctx.globalCompositeOperation = 'soft-light';
  const cheek = ctx.createRadialGradient(size * 0.32, size * 0.55, 0, size * 0.32, size * 0.55, size * 0.22);
  cheek.addColorStop(0, 'rgba(255, 120, 140, 0.55)');
  cheek.addColorStop(1, 'rgba(255, 120, 140, 0)');
  ctx.fillStyle = cheek;
  ctx.fillRect(0, 0, size, size);
  const cheek2 = ctx.createRadialGradient(size * 0.68, size * 0.55, 0, size * 0.68, size * 0.55, size * 0.22);
  cheek2.addColorStop(0, 'rgba(255, 120, 140, 0.55)');
  cheek2.addColorStop(1, 'rgba(255, 120, 140, 0)');
  ctx.fillStyle = cheek2;
  ctx.fillRect(0, 0, size, size);

  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = 'rgba(190, 70, 95, 0.45)';
  ctx.beginPath();
  ctx.ellipse(size * 0.5, size * 0.68, size * 0.14, size * 0.06, 0, 0, Math.PI * 2);
  ctx.fill();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Same as blender.html — avoids washing out original GLB/VRM colors. */
function addSceneLights() {
  scene.add(new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1));
}

function addFaceMesh() {
  if (faceMesh) return;

  faceStyleTex = createFaceStyleTexture();
  faceUvTex = new THREE.TextureLoader().load(UV_MAP_URL);
  faceUvTex.colorSpace = THREE.SRGBColorSpace;

  faceMesh = mindarThree.addFaceMesh();
  faceMesh.material = new THREE.MeshPhysicalMaterial({
    map: faceStyleTex,
    color: 0xffffff,
    transparent: true,
    opacity: 0.72,
    roughness: 0.38,
    metalness: 0.04,
    clearcoat: 0.25,
    clearcoatRoughness: 0.4,
    side: THREE.DoubleSide,
    depthWrite: true,
  });

  scene.add(faceMesh);
  setFaceMeshStyle(showMeshInput?.checked === true);
}

function setFaceMeshStyle(showUvDebug) {
  if (!faceMesh?.material) return;
  const m = faceMesh.material;
  if (showUvDebug) {
    m.map = faceUvTex;
    m.opacity = 0.9;
    m.emissive = new THREE.Color(0x222244);
    m.emissiveIntensity = 0.15;
  } else {
    m.map = faceStyleTex;
    m.opacity = 0.72;
    m.emissive = new THREE.Color(0x000000);
    m.emissiveIntensity = 0;
  }
  m.needsUpdate = true;
}

function ensureTransparentCanvas() {
  if (!renderer) return;
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.NoToneMapping;
  if ('toneMappingExposure' in renderer) renderer.toneMappingExposure = 1;
  renderer.domElement.style.background = 'transparent';
  if (scene) scene.background = null;
}

/** Paint composite after WebGL render so mesh + model appear in the recording. */
function paintRecordFrame() {
  if (!faceRecorder || !running || !mindarThree?.video || !renderer) return;
  const w = container.clientWidth;
  const h = container.clientHeight;
  faceRecorder.paintFrame(mindarThree.video, renderer.domElement, background, w, h);
}

async function startRecordingWithOptions() {
  if (!running || !faceRecorder) return;
  const withAudio = $('record-with-audio')?.checked === true && audioLip?.hasAudio();
  if (withAudio) {
    if ($('audio-lip-sync')) $('audio-lip-sync').checked = true;
    audioLip.enabled = true;
    audioLip.setIntensity(getAppExpressionSensitivities().audioLipSyncMultiplier);
    try {
      await audioLip.play(true);
      if (avatar) avatar.setExpressionOptions(getExpressionOptions());
    } catch (e) {
      console.warn('Audio play failed:', e);
    }
  }
  renderer.render(scene, camera);
  paintRecordFrame();
  let stream = null;
  if (withAudio) {
    stream = audioLip.getCaptureStream();
  }
  await faceRecorder.start(stream);
  updateRecordUi();
}

function syncVideoFeed() {
  if (!videoFeed || !mindarThree?.video?.srcObject || !showPipInput?.checked) return;
  videoFeed.srcObject = mindarThree.video.srcObject.clone();
  videoFeed.play().catch(() => {});
  videoFeed.classList.add('active');
}

/** Centers/scales scene root only — does not change model pivot placement sliders. */
function applyAutoFitToFace(sceneRoot, vrm = null) {
  if (!sceneRoot) return;
  attachModelLikeBlender(sceneRoot, { blenderScale: 2, vrm: vrm ?? avatar?.vrm });
  baseFitScale = 1;
}

function computeBaseFitScale(modelRoot, vrmInstance) {
  let measureRoot = modelRoot;
  if (vrmInstance?.humanoid) {
    const head =
      vrmInstance.humanoid.getNormalizedBoneNode?.('head') ||
      vrmInstance.humanoid.getRawBoneNode?.('head');
    if (head) measureRoot = head;
  }
  const modelSize = new THREE.Box3().setFromObject(measureRoot).getSize(new THREE.Vector3());
  const maxDim = Math.max(modelSize.x, modelSize.y, modelSize.z, 1e-5);
  const fit = 0.22 / maxDim;
  return THREE.MathUtils.clamp(fit, 0.5, 8);
}

/** blender.html: model on anchor; MindAR hides anchor when face lost — we force visible. */
function keepModelVisible() {
  if (!modelLoaded) return;

  if (faceAnchor?.group) faceAnchor.group.visible = true;
  if (modelPivot) {
    modelPivot.visible = true;
    modelPivot.scale.set(1, 1, 1);
  }

  const root = avatar?.displayRoot ?? avatar?.vrm?.scene ?? avatar?.gltf?.scene;
  if (root) {
    root.visible = true;
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.frustumCulled = false;
      o.visible = true;
    });
    applyBodyPartVisibility();
  }
  updateFaceShellVisibility();
}

/** Hide colorful MindAR shell when avatar is on (stops “mask on top of face”). */
function updateFaceShellVisibility() {
  if (!faceMesh) return;
  const showDebug = showMeshInput?.checked === true;
  faceMesh.visible = !modelLoaded || showDebug;
}

let _exprOptsCache = null;
let _exprOptsCacheKey = '';

function invalidateExpressionOptionsCache() {
  _exprOptsCacheKey = '';
  _exprOptsCache = null;
}

function getExpressionOptions() {
  const app = getAppExpressionSensitivities();
  const useAudioMouth =
    $('audio-lip-sync')?.checked === true && app.audioLipSyncEnabled;
  const key = [
    useAudioMouth,
    app.audioLipSyncMultiplier,
    app.mouthIntensity,
    app.faceIntensity,
    app.expressionsEnabled,
    app.mouthEnabled,
    app.eyesEnabled,
    app.audioLipSyncEnabled,
  ].join('|');
  if (_exprOptsCache && key === _exprOptsCacheKey) return _exprOptsCache;

  const mouthIntensity = useAudioMouth
    ? app.audioLipSyncMultiplier
    : app.mouthIntensity;
  const enabled =
    app.expressionsEnabled ||
    app.mouthEnabled ||
    app.eyesEnabled ||
    (useAudioMouth && app.audioLipSyncEnabled);
  _exprOptsCacheKey = key;
  _exprOptsCache = {
    enabled,
    intensity: app.faceIntensity,
    mouthIntensity,
    exprSettings: buildExprSettingsFromApp(app),
    useAudioMouth,
    audioLip,
  };
  return _exprOptsCache;
}

function updateRecordUi() {
  const st = faceRecorder?.state || 'idle';
  const el = $('record-status');
  if (el) el.textContent = `Record: ${st}`;
  const busy = st === 'recording' || st === 'paused';
  if ($('btn-rec-start')) $('btn-rec-start').disabled = !running || busy;
  if ($('btn-rec-with-audio')) {
    $('btn-rec-with-audio').disabled = !running || busy || !audioLip?.hasAudio();
  }
  if ($('btn-rec-pause')) $('btn-rec-pause').disabled = st !== 'recording';
  if ($('btn-rec-resume')) $('btn-rec-resume').disabled = st !== 'paused';
  if ($('btn-rec-stop')) $('btn-rec-stop').disabled = st === 'idle';
}

function onLoop() {
  keepModelVisible();

  const estimate = mindarThree?.getLatestEstimate?.();
  if (avatar) {
    const opts = getExpressionOptions();
    avatar.setExpressionOptions(opts);
    const audioDriving =
      opts.useAudioMouth && audioLip?.enabled && audioLip.isPlaying();

    if (audioDriving) {
      avatar.updateAudioLipSync();
      if (estimate?.blendshapes && opts.enabled) {
        avatar.updateFaceExpressionsLive(estimate.blendshapes);
      }
    } else if (estimate?.blendshapes && opts.enabled) {
      avatar.updateBlendshapes(estimate.blendshapes);
    } else if (!opts.enabled && !audioDriving) {
      avatar.fadeExpressions();
    }
    avatar.updateVrm(0.016);
  }
  renderer.render(scene, camera);

  if (
    faceRecorder &&
    (faceRecorder.state === 'recording' || faceRecorder.state === 'paused')
  ) {
    paintRecordFrame();
  }
}

async function setup() {
  mindarThree = new MindARThree({ container });
  ({ renderer, scene, camera } = mindarThree);
  ensureTransparentCanvas();
  addSceneLights();

  if (!background) background = new FaceBackground(container);
  else background.apply();
  if (background && !background.onScreenShareChange) {
    background.onScreenShareChange = () => {
      updateBgScreenUi();
      if ($('bg-mode') && background.config) {
        $('bg-mode').value = background.config.mode;
      }
    };
  }

  if (!faceRecorder) faceRecorder = new FaceRecorder();

  faceAnchor = mindarThree.addAnchor(1);
  modelPivot = new THREE.Group();
  faceAnchor.group.add(modelPivot);

  addFaceMesh();
}

async function startTracking() {
  btnStart.disabled = true;
  setStatus('Starting MindAR…', false);
  if (!mindarThree) await setup();

  await mindarThree.start();
  syncVideoFeed();
  mindarThree.video?.play?.().catch(() => {});
  background?.refresh();
  requestAnimationFrame(() => background?.refresh());

  running = true;
  renderer.setAnimationLoop(onLoop);

  btnStop.disabled = false;
  btnModel.disabled = false;
  setPlacementUnlocked(true);
  setRecordPanelUnlocked(true);
  applyPlacement();
  background?.refresh();
  updateRecordUi();
  setStatus('<strong>Step 1 OK:</strong> Tracking + record ready', true);
  setHud('Load model (step 2) · sensitivity on Settings page');
}

async function loadModelFace() {
  if (!running || !modelPivot || !faceAnchor) {
    setStatus('Start tracking first (step 1)', false);
    return;
  }

  btnModel.disabled = true;
  try {
    const modelSelect = $('model-select');
    if (modelSelect) setSelectedModelId(modelSelect.value);

    const source = await resolveModelSource();
    setStatus(`Loading <em>${source.name}</em>…`, false);

    modelPivot.clear();

    avatar = new FaceAvatar();
    const sceneRoot = await avatar.init(source);
    avatar.setExpressionOptions(getExpressionOptions());

    applyAutoFitToFace(sceneRoot, avatar.vrm);
    modelPivot.add(sceneRoot);
    applyPlacement();
    applyBodyPartVisibility();

    modelLoaded = true;
    keepModelVisible();
    setBodyPartsUnlocked(true);
    setFaceMeshStyle(showMeshInput?.checked === true);
    updateFaceShellVisibility();
    background?.refresh();
    requestAnimationFrame(() => background?.refresh());

    setStatus('<strong>Step 2 OK:</strong> Model on anchor — enter values below', true);
    const exprCount = avatar.vrmExprNames?.size ?? 0;
    const morphMapped = avatar.morphBindings?.length ?? 0;
    const sc = sceneRoot.scale.x.toFixed(2);
    setHud(
      `Model: ${source.name}\nScene scale: ${sc}\nMeshes: ${avatar.morphTargetMeshes.length}\nMapped morphs: ${morphMapped}\nVRM expr: ${exprCount}`
    );
  } catch (err) {
    console.error(err);
    setStatus(`Load failed: ${err.message}`, false);
    setHud(String(err.message));
  } finally {
    btnModel.disabled = false;
  }
}

async function stopAll() {
  if (mindarThree) {
    mindarThree.stop();
    renderer?.setAnimationLoop?.(null);
  }
  if (videoFeed?.srcObject) {
    videoFeed.srcObject.getTracks?.().forEach((t) => t.stop());
    videoFeed.srcObject = null;
    videoFeed.classList.remove('active');
  }
  running = false;
  modelLoaded = false;
  mindarThree = null;
  renderer = null;
  scene = null;
  camera = null;
  faceMesh = null;
  faceAnchor = null;
  modelPivot = null;
  avatar = null;
  faceStyleTex = null;
  faceUvTex = null;
  if (faceRecorder?.state !== 'idle') {
    faceRecorder.stop().then((blob) => {
      if (blob) faceRecorder.download(blob);
    });
  }
  audioLip?.stop();
  background?.stopScreenShare?.();
  container.innerHTML = '';
  background = null;
  _bgImageEl = null;
  btnStart.disabled = false;
  btnModel.disabled = true;
  btnStop.disabled = true;
  setPlacementUnlocked(false);
  setBodyPartsUnlocked(false);
  setRecordPanelUnlocked(false);
  updateRecordUi();
  setStatus('<strong>Stopped.</strong> Press step 1 again', false);
  setHud('Off');
}

function setRecordPanelUnlocked(on) {
  const panel = $('record-panel');
  if (panel) panel.classList.toggle('locked', !on);
  updateRecordUi();
}

async function initModelDropdown() {
  const sel = $('model-select');
  await populateModelSelect(sel);
  sel?.addEventListener('change', () => {
    setSelectedModelId(sel.value);
    if (modelLoaded && running) {
      loadModelFace().catch((e) => {
        console.error(e);
        setStatus(`Reload failed: ${e.message}`, false);
      });
    }
  });
}

function updateBgScreenUi() {
  const active = background?.isScreenActive?.() === true;
  const startBtn = $('bg-screen-start');
  const stopBtn = $('bg-screen-stop');
  const statusEl = $('bg-screen-status');
  if (startBtn) startBtn.disabled = active;
  if (stopBtn) stopBtn.disabled = !active;
  if (statusEl) statusEl.textContent = active ? 'Screen: sharing' : 'Screen: off';
  if ($('bg-mode') && active) $('bg-mode').value = 'screen';
}

function bindExtendedUi() {
  if (!audioLip) audioLip = new AudioLipSync();
  if (!background && container) background = new FaceBackground(container);
  if (background) {
    background.onScreenShareChange = () => {
      updateBgScreenUi();
      if ($('bg-mode') && background.config) {
        $('bg-mode').value = background.config.mode;
      }
    };
  }
  initModelDropdown().catch(console.error);

  $('bg-mode')?.addEventListener('change', () => {
    const mode = $('bg-mode').value;
    if (mode === 'screen') {
      if (!background?.isScreenActive?.()) {
        $('bg-screen-start')?.click();
        return;
      }
    } else {
      background?.stopScreenShare?.();
      updateBgScreenUi();
    }
    background?.setConfig({ mode });
    _bgImageEl = background?.getImageElement() ?? null;
    faceRecorder?.setBackdropImage(_bgImageEl);
    background?.refresh();
  });
  $('bg-color')?.addEventListener('input', () => {
    background?.stopScreenShare?.();
    updateBgScreenUi();
    background?.setConfig({ mode: 'color', color: $('bg-color').value });
    if ($('bg-mode')) $('bg-mode').value = 'color';
  });
  $('bg-blur')?.addEventListener('input', () => {
    background?.setConfig({ mode: 'blur', blurPx: Number($('bg-blur').value) });
    if ($('bg-mode')) $('bg-mode').value = 'blur';
  });
  $('bg-image-file')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file || !background) return;
    background.stopScreenShare?.();
    updateBgScreenUi();
    background.setImageFile(file);
    if ($('bg-mode')) $('bg-mode').value = 'image';
    const syncBg = () => {
      _bgImageEl = background.getImageElement();
      faceRecorder?.setBackdropImage(_bgImageEl);
      background.refresh();
    };
    if (background.bgImage.complete) syncBg();
    else background.bgImage.onload = syncBg;
  });
  $('bg-clear-image')?.addEventListener('click', () => {
    background?.clearImage();
    _bgImageEl = null;
    faceRecorder?.setBackdropImage(null);
    if ($('bg-mode')) $('bg-mode').value = 'camera';
    background?.refresh();
  });
  $('bg-screen-start')?.addEventListener('click', async () => {
    const statusEl = $('bg-screen-status');
    try {
      if (statusEl) statusEl.textContent = 'Screen: requesting…';
      await background?.startScreenShare?.();
      if ($('bg-mode')) $('bg-mode').value = 'screen';
      background?.refresh();
      updateBgScreenUi();
    } catch (err) {
      console.error(err);
      if (statusEl) statusEl.textContent = `Screen: ${err.message}`;
      background?.stopScreenShare?.();
      background?.setConfig?.({ mode: 'camera' });
      if ($('bg-mode')) $('bg-mode').value = 'camera';
      updateBgScreenUi();
    }
  });
  $('bg-screen-stop')?.addEventListener('click', () => {
    background?.stopScreenShare?.();
    if ($('bg-mode')) $('bg-mode').value = 'camera';
    background?.setConfig({ mode: 'camera' });
    updateBgScreenUi();
  });

  if ($('bg-mode') && background) $('bg-mode').value = background.config.mode;
  if ($('bg-color') && background) $('bg-color').value = background.config.color;
  if ($('bg-blur') && background) $('bg-blur').value = background.config.blurPx;
  updateBgScreenUi();

  $('audio-file')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const app = getAppExpressionSensitivities();
      audioLip.setIntensity(app.audioLipSyncMultiplier);
      const info = await audioLip.loadFile(file);
      audioLip.setIntensity(app.audioLipSyncMultiplier);
      const steps = info?.steps ?? 0;
      $('audio-status').textContent =
        steps > 0
          ? `${file.name} — phoneme lip-sync ready (${steps} steps)`
          : `${file.name} — press Play`;
    } catch (err) {
      console.error(err);
      $('audio-status').textContent = `Load failed: ${err.message}`;
    }
    updateRecordUi();
  });
  $('btn-audio-play')?.addEventListener('click', async () => {
    if (!audioLip.hasAudio()) {
      $('audio-status').textContent = 'Choose an audio file first';
      return;
    }
    if ($('audio-lip-sync')) $('audio-lip-sync').checked = true;
    audioLip.enabled = true;
    const app = getAppExpressionSensitivities();
    audioLip.setIntensity(app.audioLipSyncMultiplier);
    try {
      await audioLip.play(true);
      if (avatar) avatar.setExpressionOptions(getExpressionOptions());
      $('audio-status').textContent = 'Playing — lip-sync active';
    } catch (e) {
      console.error(e);
      $('audio-status').textContent = `Play failed: ${e.message}`;
    }
  });
  $('btn-audio-pause')?.addEventListener('click', () => audioLip.pause());
  $('audio-lip-sync')?.addEventListener('change', () => {
    if (audioLip) audioLip.enabled = $('audio-lip-sync').checked === true;
    invalidateExpressionOptionsCache();
    if (avatar) avatar.setExpressionOptions(getExpressionOptions());
  });
  window.addEventListener('storage', (e) => {
    if (e.key === 'edge_ai_settings_v1') invalidateExpressionOptionsCache();
  });
  if (audioLip) audioLip.enabled = $('audio-lip-sync')?.checked === true;

  $('btn-rec-start')?.addEventListener('click', () => {
    startRecordingWithOptions().catch(console.error);
  });
  $('btn-rec-with-audio')?.addEventListener('click', () => {
    if ($('record-with-audio')) $('record-with-audio').checked = true;
    startRecordingWithOptions().catch(console.error);
  });
  $('btn-rec-pause')?.addEventListener('click', () => {
    faceRecorder.pause();
    if (audioLip?.active) audioLip.pause();
    updateRecordUi();
  });
  $('btn-rec-resume')?.addEventListener('click', () => {
    faceRecorder.resume();
    if ($('record-with-audio')?.checked && audioLip?.hasAudio()) {
      audioLip.resume().catch(() => {});
    }
    updateRecordUi();
  });
  $('btn-rec-stop')?.addEventListener('click', async () => {
    const statusEl = $('record-status');
    faceRecorder.onConvertProgress = (pct) => {
      if (statusEl) statusEl.textContent = `Converting to MP4… ${pct}%`;
    };
    if (statusEl) statusEl.textContent = 'Stopping…';
    const blob = await faceRecorder.stop();
    faceRecorder.onConvertProgress = null;
    audioLip.stop();
    updateRecordUi();
    if (blob) {
      faceRecorder.download(blob, `face-follow-${Date.now()}`);
      if (statusEl) {
        statusEl.textContent = blob.type.includes('mp4')
          ? 'Saved as MP4'
          : 'Saved (WebM — MP4 transcode unavailable)';
      }
    }
  });
}

function bindPlacementControls() {
  loadPlacement();
  loadBodyParts();
  syncInputsFromPlacement();
  syncInputsFromBodyParts();
  setPlacementUnlocked(false);
  setBodyPartsUnlocked(false);

  for (const el of Object.values(placementInputs)) {
    if (!el) continue;
    const apply = () => {
      readPlacementFromInputs();
      applyPlacement();
    };
    el.addEventListener('input', apply);
    el.addEventListener('change', apply);
  }

  btnResetPlacement?.addEventListener('click', () => {
    placement = { ...DEFAULT_PLACEMENT };
    syncInputsFromPlacement();
    applyPlacement();
  });

  const onBodyChange = (ev) => {
    if (ev?.target?.id === 'bp-head-only' && bodyPartInputs.headOnly?.checked) {
      if (bodyPartInputs.showBody) bodyPartInputs.showBody.checked = false;
      if (bodyPartInputs.showArms) bodyPartInputs.showArms.checked = false;
      if (bodyPartInputs.showLegs) bodyPartInputs.showLegs.checked = false;
    } else if (ev?.target?.id !== 'bp-head-only' && bodyPartInputs.headOnly?.checked) {
      bodyPartInputs.headOnly.checked = false;
    }
    syncBodyPartsFromInputs();
    applyBodyPartVisibility();
  };

  Object.values(bodyPartInputs).forEach((el) => {
    el?.addEventListener('change', onBodyChange);
  });

  btnResetBody?.addEventListener('click', () => {
    bodyParts = { ...DEFAULT_BODY_PARTS };
    syncInputsFromBodyParts();
    applyBodyPartVisibility();
  });
}

showMeshInput?.addEventListener('change', () => {
  setFaceMeshStyle(showMeshInput.checked);
  updateFaceShellVisibility();
});

$('btn-auto-fit')?.addEventListener('click', () => {
  const root = avatar?.displayRoot ?? avatar?.gltf?.scene;
  if (!root) {
    setStatus('Load model first (step 2)', false);
    return;
  }
  applyAutoFitToFace(root, avatar?.vrm);
  applyPlacement();
  keepModelVisible();
  updateFaceShellVisibility();
  setHud(
    `Auto-fit (head bone ×2)\nScene scale: ${root.scale.x.toFixed(2)}\nPos: ${placement.posX}, ${placement.posY}, ${placement.posZ}`
  );
});

window.addEventListener('storage', (e) => {
  if (e.key === 'edge_ai_settings_v1' && avatar) {
    avatar.setExpressionOptions(getExpressionOptions());
  }
});

showPipInput?.addEventListener('change', () => {
  if (!videoFeed) return;
  if (showPipInput.checked) syncVideoFeed();
  else {
    videoFeed.classList.remove('active');
    if (videoFeed.srcObject) {
      videoFeed.srcObject.getTracks?.().forEach((t) => t.stop());
      videoFeed.srcObject = null;
    }
  }
});

btnStart.addEventListener('click', () => {
  startTracking().catch((e) => {
    console.error(e);
    setStatus(`Error: ${e.message}`, false);
    btnStart.disabled = false;
  });
});

btnModel.addEventListener('click', () => {
  loadModelFace().catch((e) => {
    console.error(e);
    setStatus(`Load failed: ${e.message}`, false);
    btnModel.disabled = false;
  });
});

btnStop.addEventListener('click', () => stopAll());

bindPlacementControls();
bindExtendedUi();
setRecordPanelUnlocked(false);
