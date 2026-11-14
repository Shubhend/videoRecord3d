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
  getFaceMotionLerp,
  getLipSyncLerp,
  getLipSyncConfig,
  loadAppSettings,
  patchAppSettings,
  hydrateAppSettings,
  invalidateAppSettingsCache,
} from './faceFollowAppSettings.js';
import { FaceBackground } from './faceFollowBackground.js';
import { FaceRecorder, resolveRecordSize } from './faceFollowRecorder.js';
import { AudioLipSync } from './faceFollowAudioLip.js';
import {
  populateModelSelect,
  getModelSource,
  getSelectedModelId,
  setSelectedModelId,
} from './faceFollowModelStore.js';
import {
  listPresets,
  savePreset,
  deletePreset,
  renamePreset,
  getLastPresetId,
  setLastPresetId,
} from './faceFollowPlacementPresets.js';
import {
  listRawVideos,
  saveRawVideo,
  saveOutputVideo,
  deleteRawVideo,
  rawVideoUrl,
  sanitizeRawName,
} from './faceFollowRawStore.js';
import {
  buildMorphBindings,
  isMouthArkit,
  mouthWeightsToArkitMap,
} from './faceFollowMorphMap.js';
import { attachModelLikeBlender } from './faceFollowAlign.js';

const MOUTH_EXPR_KEYS = ['aa', 'ih', 'ou', 'ee', 'oh'];

/** Cached @pixiv/three-vrm module (avoid re-fetching CDN on every model load). */
let _vrmModulePromise = null;
function loadVrmModule() {
  if (!_vrmModulePromise) {
    _vrmModulePromise = import('@pixiv/three-vrm');
  }
  return _vrmModulePromise;
}

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out (${Math.round(ms / 1000)}s)`)), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

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
const showFaceMeshInput = $('show-face-mesh');
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

/** Defaults kept for reference; live values from Settings getters. */
const BLENDSHAPE_INPUT_LERP = 0.28;

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
    this.blendshapeSmoothed = new Map();
    this._lookYaw = 0;
    this._lookPitch = 0;
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
    if (forAudio) return getLipSyncLerp();
    return getFaceTrackingLerp();
  }

  _lipSyncLerp() {
    return getLipSyncLerp();
  }

  async init(loadTarget, { onProgress, timeoutMs = 90000 } = {}) {
    const url =
      typeof loadTarget === 'string'
        ? loadTarget
        : loadTarget?.type === 'blob'
          ? URL.createObjectURL(loadTarget.value)
          : loadTarget?.value;
    const revoke = typeof loadTarget === 'object' && loadTarget?.type === 'blob';

    const { VRMLoaderPlugin, VRMUtils } = await loadVrmModule();
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    let gltf;
    try {
      gltf = await withTimeout(
        new Promise((resolve, reject) => {
          loader.load(
            url,
            resolve,
            (evt) => {
              if (!onProgress || !evt?.total) return;
              onProgress(Math.min(99, Math.round((100 * evt.loaded) / evt.total)));
            },
            (err) => reject(err || new Error('GLTF load failed'))
          );
        }),
        timeoutMs,
        'Model download'
      );
      onProgress?.(100);
    } finally {
      if (revoke) URL.revokeObjectURL(url);
    }

    this.gltf = gltf;
    this.vrm = gltf.userData?.vrm ?? null;
    if (this.vrm) {
      try {
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

  /** EMA-smooth raw MindAR blendshape scores to kill frame-to-frame noise. */
  _smoothBlendshapeMap(rawMap, lerp = BLENDSHAPE_INPUT_LERP) {
    const out = new Map();
    for (const [name, score] of rawMap) {
      const target = clamp01(Number(score) || 0);
      const prev = this.blendshapeSmoothed.get(name);
      const next = prev == null ? target : prev + (target - prev) * lerp;
      this.blendshapeSmoothed.set(name, next);
      out.set(name, next);
    }
    // Decay keys missing this frame so expressions don't stick.
    for (const [name, prev] of this.blendshapeSmoothed) {
      if (out.has(name)) continue;
      const next = prev * (1 - lerp);
      if (next < 0.008) this.blendshapeSmoothed.delete(name);
      else {
        this.blendshapeSmoothed.set(name, next);
        out.set(name, next);
      }
    }
    return out;
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
    const lipLerp = this._lipSyncLerp();
    const arkit = mouthWeightsToArkitMap(vrmWeights);
    if (arkit.size) {
      this._applyMorphFromMap(arkit, { onlyMouth: true, lerp: lipLerp });
    }
    this._applyDirectMouthPresets(vrmWeights, lipLerp);
  }

  /** Drive morph targets named aa / ih / viseme_* directly (VRoid / custom GLB). */
  _applyDirectMouthPresets(vrmWeights, lerp) {
    const mouthLerp = lerp ?? this._lipSyncLerp();
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
        const audioDrive = true;
        if (!s.enabled && !audioDrive) continue;
        const target = Math.min(
          1,
          vrmWeights[preset] * this.mouthIntensity * (Number(s.amount) || 1)
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
    const yawTarget =
      ((g('eyeLookOutLeft') + g('eyeLookInRight')) - (g('eyeLookInLeft') + g('eyeLookOutRight'))) *
      0.28 *
      this.exprIntensity;
    const pitchTarget =
      ((g('eyeLookUpLeft') + g('eyeLookUpRight')) - (g('eyeLookDownLeft') + g('eyeLookDownRight'))) *
      0.28 *
      this.exprIntensity;
    const lookLerp = Math.min(0.28, this._exprLerpFactor());
    this._lookYaw += (yawTarget - this._lookYaw) * lookLerp;
    this._lookPitch += (pitchTarget - this._lookPitch) * lookLerp;
    if (typeof lookAt.yaw === 'number') lookAt.yaw = this._lookYaw;
    if (typeof lookAt.pitch === 'number') lookAt.pitch = this._lookPitch;
    if (lookAt.applier?.lookAt) {
      const euler = new THREE.Euler(this._lookPitch, this._lookYaw, 0, 'YXZ');
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

  /** Fast mouth apply — vowel shapes drive lips; jaw only opens for open vowels. */
  _applyAudioMouthCached(mouth) {
    const lipLerp = this._lipSyncLerp();
    const cfg = getLipSyncConfig();
    const closeLerp = Math.min(0.65, lipLerp * cfg.closeBoost);
    const mix = cfg.secondaryMix;
    const jawAmt = cfg.jawOpen;

    const scaled = {};
    const jawOpen = clamp01(mouth.mouthOpen ?? 0);
    for (const key of MOUTH_EXPR_KEYS) {
      scaled[key] = clamp01((mouth[key] || 0) * this.mouthIntensity);
    }

    let dominant = MOUTH_EXPR_KEYS[0];
    let dominantV = scaled[dominant] || 0;
    for (const key of MOUTH_EXPR_KEYS) {
      if ((scaled[key] || 0) > dominantV) {
        dominantV = scaled[key];
        dominant = key;
      }
    }

    const jawTarget = clamp01(
      (dominant === 'aa' ? scaled.aa * 0.7 : scaled.aa * 0.15) * jawAmt +
        (dominant === 'ee' || dominant === 'ih' ? jawOpen * 0.12 : 0) * jawAmt +
        jawOpen * (dominant === 'aa' ? 0.3 : 0.08) * jawAmt
    );

    for (const { mesh, idx } of this._mouthOpenMorphEntries) {
      const target = clamp01(jawTarget * this.mouthIntensity);
      const cur = mesh.morphTargetInfluences[idx] || 0;
      const lerp = target < cur ? closeLerp : lipLerp;
      mesh.morphTargetInfluences[idx] = cur + (target - cur) * lerp;
    }

    for (const { mesh, idx, preset } of this._mouthMorphEntries) {
      const base = scaled[preset] || 0;
      const target = preset === dominant ? base : base * mix;
      const cur = mesh.morphTargetInfluences[idx] || 0;
      const lerp = target < cur ? closeLerp : lipLerp;
      mesh.morphTargetInfluences[idx] = cur + (target - cur) * lerp;
    }

    const em = this.vrm?.expressionManager;
    if (!em) return;
    for (const key of MOUTH_EXPR_KEYS) {
      const vrmName = this.vrmPresetToVrm.get(key) || key;
      if (!this.vrmExprNames.has(vrmName)) continue;
      const base = scaled[key];
      const target = key === dominant ? base : base * mix;
      const prev = em.getValue(vrmName) ?? 0;
      const lerp = target < prev ? closeLerp : lipLerp;
      em.setValue(vrmName, prev + (target - prev) * lerp);
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

    const raw = new Map();
    for (const cat of blendshapes.categories) {
      raw.set(cat.categoryName, cat.score);
    }
    const arkit = this._smoothBlendshapeMap(raw);

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

    const raw = new Map();
    for (const cat of blendshapes.categories) {
      raw.set(cat.categoryName, cat.score);
    }
    const arkit = this._smoothBlendshapeMap(raw);

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
let _smoothAnchorPos = null;
let _smoothAnchorQuat = null;
let _anchorSmoothReady = false;
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
let rawPlaybackVideo = null;
let rawRecorder = null;
let rawChunks = [];
let rawCameraStream = null;
let rawOwnsCamera = false;
let rawTick = null;
let rawStartedAt = 0;
let urlJobRecording = false;
let finishingOutput = false;

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
let hemiLight = null;
let keyLight = null;

function addSceneLights() {
  hemiLight = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1);
  scene.add(hemiLight);
  keyLight = new THREE.DirectionalLight(0xffffff, 0.85);
  keyLight.position.set(0.35, 1.2, 1.4);
  scene.add(keyLight);
  applyAvatarLook();
}

/** Brightness / contrast from face-follow panel (default 1 = normal). */
function applyAvatarLook() {
  const b = Math.max(0.4, Math.min(2.5, Number($('avatar-bright')?.value) || 1));
  const c = Math.max(0.5, Math.min(1.8, Number($('avatar-contrast')?.value) || 1));

  if (hemiLight) hemiLight.intensity = b;
  if (keyLight) keyLight.intensity = 0.85 * b;

  // CSS filter always affects what you see (VRM/MToon often ignores scene lights).
  const canvas = renderer?.domElement;
  if (canvas) {
    canvas.style.filter =
      Math.abs(b - 1) < 0.001 && Math.abs(c - 1) < 0.001
        ? 'none'
        : `brightness(${b}) contrast(${c})`;
  }

  // Also tint mesh colors so recorded frames pick up brightness.
  const root = avatar?.displayRoot ?? avatar?.vrm?.scene ?? avatar?.gltf?.scene;
  if (!root) return;
  root.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of mats) {
      if (!mat?.color?.isColor) continue;
      if (!mat.userData._lookColor) mat.userData._lookColor = mat.color.clone();
      const base = mat.userData._lookColor;
      mat.color.setRGB(
        0.5 + (base.r * b - 0.5) * c,
        0.5 + (base.g * b - 0.5) * c,
        0.5 + (base.b * b - 0.5) * c
      );
    }
  });
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
  updateFaceShellVisibility();
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
  renderer.toneMapping = THREE.NoToneMapping;
  if ('toneMappingExposure' in renderer) renderer.toneMappingExposure = 1;
  renderer.domElement.style.background = 'transparent';
  // Clear color is owned by syncThreeBackground (transparent vs solid).
  applyAvatarLook();
}

/**
 * Solid color:
 *  - CSS overlay between video and canvas (works when WebGL has alpha)
 *  - scene.background (works when WebGL canvas is opaque)
 * Never alter MindAR video layout — that breaks face-mesh alignment.
 */
function syncThreeBackground() {
  background?.ensureMounted?.();
  background?.apply?.();

  if (!scene || !renderer) return;
  const mode = background?.config?.mode || 'camera';
  const color = background?.config?.color || '#0a0e14';

  if (mode === 'color') {
    let threeColor;
    try {
      threeColor = new THREE.Color(color);
    } catch {
      threeColor = new THREE.Color(0x0a0e14);
    }
    scene.background = threeColor;
    renderer.setClearColor(threeColor, 1);
  } else {
    scene.background = null;
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.style.background = 'transparent';
  }
}

function wireBackgroundCallbacks() {
  if (!background) return;
  background.onChange = () => {
    syncThreeBackground();
  };
  syncThreeBackground();
}

function getSelectedRecordDevice() {
  return $('record-device')?.value || 'auto';
}

/**
 * Letterbox the live container to the device aspect.
 * Only trigger MindAR's own _resize — never setSize/camera.aspect yourself
 * (that stretches the UV face mesh vs the camera feed).
 */
function applyDevicePreview() {
  if (!container) return;
  const key = getSelectedRecordDevice();
  if (!key || key === 'auto') {
    container.classList.remove('device-preview');
    container.removeAttribute('data-device');
  } else {
    container.classList.add('device-preview');
    container.setAttribute('data-device', key);
  }
  // Wait for CSS layout, then let MindAR re-cover video + canvas together.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'));
    });
  });
}

function getRecordOutputSize() {
  const fallbackW = container?.clientWidth || 1280;
  const fallbackH = container?.clientHeight || 720;
  return resolveRecordSize(getSelectedRecordDevice(), fallbackW, fallbackH);
}

/** Paint composite after WebGL render so mesh + model appear in the recording. */
function paintRecordFrame() {
  if (!faceRecorder || !running || !mindarThree?.video || !renderer) return;
  const { w, h } = getRecordOutputSize();
  faceRecorder.paintFrame(mindarThree.video, renderer.domElement, background, w, h);
}

async function startRecordingWithOptions() {
  if (!running || !faceRecorder) return;
  const withAudio = !!audioLip?.hasAudio();
  if (withAudio && $('record-with-audio')) $('record-with-audio').checked = true;
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
    audioLip.setOnEnded(() => {
      finishRecordedVideo().catch((err) => {
        console.error(err);
        const statusEl = $('record-status');
        if (statusEl) statusEl.textContent = `Save failed: ${err.message}`;
      });
    });
  } else {
    audioLip?.setOnEnded(null);
  }
  renderer.render(scene, camera);
  paintRecordFrame();
  let stream = null;
  if (withAudio) {
    stream = audioLip.getCaptureStream();
  }
  await faceRecorder.start(stream);
  updateRecordUi();
  if (withAudio) {
    const statusEl = $('record-status');
    if (statusEl) statusEl.textContent = 'Record: recording — saves when audio ends';
  }
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
  }

  // Do NOT force every mesh visible each frame — that fights body-part toggles
  // and causes flicker / random-looking pops. Visibility is owned by applyBodyPartVisibility.
}

/** Dampen MindAR face-anchor pose to reduce fast random head motion. */
function smoothFaceAnchorPose() {
  const g = faceAnchor?.group;
  if (!g || !modelLoaded) return;

  if (!_anchorSmoothReady || !_smoothAnchorPos || !_smoothAnchorQuat) {
    _smoothAnchorPos = g.position.clone();
    _smoothAnchorQuat = g.quaternion.clone();
    _anchorSmoothReady = true;
    return;
  }

  _smoothAnchorPos.lerp(g.position, getFaceMotionLerp());
  _smoothAnchorQuat.slerp(g.quaternion, getFaceMotionLerp());
  g.position.copy(_smoothAnchorPos);
  g.quaternion.copy(_smoothAnchorQuat);
}

/** Hide colorful MindAR shell when avatar is on, or when user unchecks Show face mesh. */
function updateFaceShellVisibility() {
  if (!faceMesh) return;
  const showMesh = showFaceMeshInput?.checked !== false;
  const showDebug = showMeshInput?.checked === true;
  faceMesh.visible = showMesh && (!modelLoaded || showDebug);
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
    app.eyesIntensity,
    app.expressionsEnabled,
    app.mouthEnabled,
    app.eyesEnabled,
    app.audioLipSyncEnabled,
    getFaceTrackingLerp(),
    getLipSyncLerp(),
    getFaceMotionLerp(),
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
  const { w, h, label } = getRecordOutputSize();
  if (el) {
    el.textContent =
      st === 'idle'
        ? `Record: idle · ${label} ${w}×${h} · exports .mp4`
        : `Record: ${st} · ${label} ${w}×${h}`;
  }
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
  smoothFaceAnchorPose();
  // Re-assert solid color each frame in case MindAR resets scene.background.
  if (background?.config?.mode === 'color' && scene && renderer) {
    try {
      const threeColor = new THREE.Color(background.config.color || '#0a0e14');
      scene.background = threeColor;
      renderer.setClearColor(threeColor, 1);
    } catch {
      /* ignore */
    }
  }

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
  else {
    background.ensureMounted();
    background.apply();
  }
  wireBackgroundCallbacks();

  if (!faceRecorder) faceRecorder = new FaceRecorder();

  faceAnchor = mindarThree.addAnchor(1);
  modelPivot = new THREE.Group();
  faceAnchor.group.add(modelPivot);

  addFaceMesh();
}

function stopRawPlayback() {
  const video = rawPlaybackVideo;
  rawPlaybackVideo = null;
  if (!video) return;
  video.pause();
  video.removeAttribute('src');
  try {
    video.load();
  } catch {
    /* element already detached */
  }
  video.remove();
}

function liveCameraStream() {
  if (rawPlaybackVideo) return null;
  const stream = mindarThree?.video?.srcObject;
  const track = stream?.getVideoTracks?.()[0];
  if (!track || track.readyState !== 'live') return null;
  return stream;
}

function pickRawMime() {
  const types = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  if (typeof MediaRecorder === 'undefined') return '';
  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

function setRawStatus(text) {
  const el = $('raw-status');
  if (el) el.textContent = text;
}

function updateRawSourceUi() {
  const name = $('raw-select')?.value || '';
  const del = $('btn-raw-delete');
  if (del) del.disabled = !name;
  if (btnStart) {
    btnStart.textContent = name ? '1. Start from recording' : '1. Start face mesh tracking';
  }
  const hint = $('source-hint');
  if (hint) {
    hint.textContent = name
      ? `Tracking will use “${name}”. The live camera stays off.`
      : 'Choose a saved recording to track without the live camera.';
  }
}

async function refreshRawList(preferName = '') {
  const sel = $('raw-select');
  const previous = preferName || sel?.value || '';
  try {
    const names = await listRawVideos();
    if (sel) {
      sel.innerHTML = '<option value="">Live camera</option>';
      for (const name of names) {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        sel.appendChild(opt);
      }
      sel.value = names.includes(previous) ? previous : '';
    }
    updateRawSourceUi();
    if (!rawRecorder) {
      setRawStatus(names.length ? `${names.length} saved in assets/recordings/` : 'No saved recordings yet');
    }
    return names;
  } catch (err) {
    console.error(err);
    setRawStatus('Recordings folder unavailable. Open this page with the dev server.');
    updateRawSourceUi();
    return [];
  }
}

function releaseRawCamera() {
  if (rawOwnsCamera && rawCameraStream) {
    rawCameraStream.getTracks().forEach((track) => track.stop());
  }
  rawCameraStream = null;
  rawOwnsCamera = false;
}

async function startRawCapture() {
  if (rawRecorder) return;
  if (typeof MediaRecorder === 'undefined') {
    setRawStatus('Recording is not supported in this browser');
    return;
  }
  const recBtn = $('btn-raw-rec');
  const stopBtn = $('btn-raw-stop');
  if (recBtn) recBtn.disabled = true;
  try {
    const shared = liveCameraStream();
    if (shared) {
      rawCameraStream = new MediaStream(shared.getVideoTracks());
      rawOwnsCamera = false;
    } else {
      rawCameraStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      rawOwnsCamera = true;
    }
    const mimeType = pickRawMime();
    const opts = { videoBitsPerSecond: 4_000_000 };
    if (mimeType) opts.mimeType = mimeType;
    rawChunks = [];
    rawRecorder = new MediaRecorder(rawCameraStream, opts);
    rawRecorder.ondataavailable = (event) => {
      if (event.data?.size) rawChunks.push(event.data);
    };
    rawRecorder.start(1000);
    rawCameraStream.getVideoTracks()[0]?.addEventListener('ended', () => {
      if (!rawRecorder || rawRecorder.state === 'inactive') return;
      setRawStatus('Camera closed. Press Stop and save to keep this take.');
    });
    rawStartedAt = performance.now();
    if (stopBtn) stopBtn.disabled = false;
    if (rawTick) clearInterval(rawTick);
    rawTick = setInterval(() => {
      const sec = Math.floor((performance.now() - rawStartedAt) / 1000);
      setRawStatus(`Recording raw… ${sec}s`);
    }, 500);
    setRawStatus('Recording raw… 0s');
  } catch (err) {
    console.error(err);
    releaseRawCamera();
    rawRecorder = null;
    if (recBtn) recBtn.disabled = false;
    if (stopBtn) stopBtn.disabled = true;
    setRawStatus(`Camera failed: ${err.message}`);
  }
}

async function stopRawCapture() {
  const recorder = rawRecorder;
  const stopBtn = $('btn-raw-stop');
  const recBtn = $('btn-raw-rec');
  if (!recorder) return;
  if (stopBtn) stopBtn.disabled = true;
  if (rawTick) {
    clearInterval(rawTick);
    rawTick = null;
  }
  setRawStatus('Saving…');
  const mime = recorder.mimeType || 'video/webm';
  const blob = await new Promise((resolve) => {
    recorder.onstop = () => resolve(new Blob(rawChunks, { type: mime }));
    if (recorder.state === 'inactive') resolve(new Blob(rawChunks, { type: mime }));
    else recorder.stop();
  });
  rawRecorder = null;
  rawChunks = [];
  releaseRawCamera();
  if (!blob.size) {
    if (recBtn) recBtn.disabled = false;
    setRawStatus('Recording was empty');
    return;
  }
  let name = $('raw-name')?.value?.trim() || '';
  if (!name) name = `take-${Date.now()}`;
  try {
    const saved = await saveRawVideo(name, blob);
    if ($('raw-name')) $('raw-name').value = saved;
    try {
      await refreshRawList(saved);
    } catch (err) {
      console.error(err);
    }
    setRawStatus(`Saved assets/recordings/${saved}.webm`);
  } catch (err) {
    console.error(err);
    setRawStatus(`Save failed: ${err.message}`);
  } finally {
    if (recBtn) recBtn.disabled = false;
  }
}

async function startFromRecording(name) {
  stopRawPlayback();
  const video = document.createElement('video');
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.setAttribute('playsinline', '');
  video.style.cssText =
    'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none;';
  document.body.appendChild(video);
  rawPlaybackVideo = video;
  video.src = `${rawVideoUrl(name)}?v=${Date.now()}`;
  await new Promise((resolve, reject) => {
    video.addEventListener('loadeddata', () => resolve(), { once: true });
    video.addEventListener(
      'error',
      () => reject(new Error(`Could not load recording “${name}”`)),
      { once: true }
    );
  });
  await video.play();
  video.addEventListener('ended', () => {
    video.pause();
    if (urlJobRecording) finishRecordedVideo().catch(console.error);
  });

  const media = navigator.mediaDevices;
  const orig = media.getUserMedia.bind(media);
  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    media.getUserMedia = orig;
  };
  media.getUserMedia = async () => {
    try {
      if (video.paused) {
        try {
          await video.play();
        } catch {
          /* last frame stays if the file has already ended */
        }
      }
      const stream = typeof video.captureStream === 'function' ? video.captureStream() : null;
      if (!stream?.getVideoTracks().length) {
        throw new Error('This browser cannot use a saved recording for face tracking');
      }
      return stream;
    } finally {
      restore();
    }
  };
  try {
    await mindarThree.start();
  } catch (err) {
    restore();
    try {
      if (mindarThree?.video?.srcObject) mindarThree.stop();
      else mindarThree?.video?.remove();
    } catch {
      mindarThree?.video?.remove();
    }
    stopRawPlayback();
    throw new Error(err?.message || `Could not track faces in “${name}”`);
  } finally {
    restore();
  }
}

async function startTracking() {
  btnStart.disabled = true;
  const selected = $('raw-select')?.value || '';
  setStatus(selected ? `Starting from “${selected}”…` : 'Starting MindAR…', false);
  if (!mindarThree) await setup();

  if (selected) await startFromRecording(selected);
  else {
    stopRawPlayback();
    await mindarThree.start();
  }
  syncVideoFeed();
  mindarThree.video?.play?.().catch(() => {});
  background?.ensureMounted?.();
  background?.refresh();
  syncThreeBackground();

  running = true;
  renderer.setAnimationLoop(onLoop);

  btnStop.disabled = false;
  btnModel.disabled = false;
  setPlacementUnlocked(true);
  setRecordPanelUnlocked(true);
  applyPlacement();
  background?.refresh();
  syncThreeBackground();
  applyDevicePreview();
  updateRecordUi();
  const sourceLabel = selected ? `recording “${selected}”` : 'live camera';
  setStatus(`<strong>Step 1 OK:</strong> Tracking ${sourceLabel}`, true);
  setHud('Load model (step 2) · sensitivity on Settings page');
}

let _modelLoadToken = 0;

async function loadModelFace() {
  if (!running || !modelPivot || !faceAnchor) {
    setStatus('Start tracking first (step 1)', false);
    return;
  }

  const token = ++_modelLoadToken;
  btnModel.disabled = true;
  try {
    const modelSelect = $('model-select');
    if (modelSelect) setSelectedModelId(modelSelect.value);

    setStatus('Resolving model…', false);
    const source = await resolveModelSource();
    if (token !== _modelLoadToken) return;

    const via = source.fromFallback ? ' · CDN fallback' : '';
    setStatus(`Loading <em>${source.name}</em>…${via}`, false);

    modelPivot.clear();

    avatar = new FaceAvatar();
    const sceneRoot = await avatar.init(source, {
      timeoutMs: 90000,
      onProgress: (pct) => {
        if (token !== _modelLoadToken) return;
        setStatus(`Loading <em>${source.name}</em>… ${pct}%${via}`, false);
      },
    });
    if (token !== _modelLoadToken) return;

    avatar.setExpressionOptions(getExpressionOptions());

    applyAutoFitToFace(sceneRoot, avatar.vrm);
    modelPivot.add(sceneRoot);
    applyPlacement();
    applyBodyPartVisibility();
    applyAvatarLook();

    modelLoaded = true;
    _anchorSmoothReady = false;
    keepModelVisible();
    setBodyPartsUnlocked(true);
    setFaceMeshStyle(showMeshInput?.checked === true);
    updateFaceShellVisibility();
    applyBodyPartVisibility();

    setStatus('<strong>Step 2 OK:</strong> Model on anchor — enter values below', true);
    const exprCount = avatar.vrmExprNames?.size ?? 0;
    const morphMapped = avatar.morphBindings?.length ?? 0;
    const sc = sceneRoot.scale.x.toFixed(2);
    setHud(
      `Model: ${source.name}${via}\nScene scale: ${sc}\nMeshes: ${avatar.morphTargetMeshes.length}\nMapped morphs: ${morphMapped}\nVRM expr: ${exprCount}`
    );
  } catch (err) {
    if (token !== _modelLoadToken) return;
    console.error(err);
    const msg = err?.message || String(err);
    setStatus(`Load failed: ${msg}`, false);
    setHud(msg);
  } finally {
    if (token === _modelLoadToken) btnModel.disabled = false;
  }
}

async function stopAll() {
  if (mindarThree) {
    try {
      mindarThree.stop();
    } catch (err) {
      console.warn(err);
      mindarThree.video?.remove();
    }
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
  _smoothAnchorPos = null;
  _smoothAnchorQuat = null;
  _anchorSmoothReady = false;
  avatar = null;
  faceStyleTex = null;
  faceUvTex = null;
  if (faceRecorder?.state !== 'idle') {
    faceRecorder.stop().then((blob) => {
      if (blob) {
        const { label } = getRecordOutputSize();
        faceRecorder.download(blob, `face-follow-${label}-${Date.now()}`);
      }
    });
  }
  audioLip?.stop();
  stopRawPlayback();
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
  if (sel && !sel.dataset.boundChange) {
    sel.dataset.boundChange = '1';
    sel.addEventListener('change', () => {
      setSelectedModelId(sel.value);
      if (modelLoaded && running) {
        loadModelFace().catch((e) => {
          console.error(e);
          setStatus(`Reload failed: ${e.message}`, false);
        });
      }
    });
  }
  if (!window.__faceFollowModelsFocusBound) {
    window.__faceFollowModelsFocusBound = true;
    const refresh = () => {
      populateModelSelect($('model-select')).catch(() => {});
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') refresh();
    });
  }
}

function syncSensitivityInputsFromSettings() {
  const s = loadAppSettings();
  const sens = s.sensitivity || {};
  const smooth = s.smoothing || {};
  const lip = s.lipSync || {};
  const setVal = (id, v) => {
    const el = $(id);
    if (el && Number.isFinite(Number(v))) el.value = String(v);
  };
  setVal('sens-eyes', sens.eyes ?? 1);
  setVal('sens-mouth', sens.mouth ?? 1);
  setVal('sens-expr', sens.expressions ?? 1);
  setVal('sens-lips', sens.audioLipSync ?? 1.8);
  setVal('smooth-face', smooth.face ?? 0.18);
  setVal('smooth-motion', smooth.faceMotion ?? 0.2);
  setVal('smooth-lips', smooth.lipSync ?? 0.2);
  setVal('lip-jaw', lip.jawOpen ?? 0.35);
  setVal('lip-vowel', lip.vowelOpen ?? 0.48);
  setVal('lip-silence', lip.silenceGate ?? 0.016);
  setVal('lip-cons', lip.consonantClose ?? 0.82);
  setVal('lip-close', lip.closeBoost ?? 2.1);
  setVal('lip-blend', lip.secondaryMix ?? 0.14);
}

let _applyingSensitivity = false;

function applySensitivityFromInputs() {
  const num = (id, fallback) => {
    const v = Number($(id)?.value);
    return Number.isFinite(v) ? v : fallback;
  };
  _applyingSensitivity = true;
  try {
    patchAppSettings({
      sensitivity: {
        eyes: num('sens-eyes', 1),
        mouth: num('sens-mouth', 1),
        expressions: num('sens-expr', 1),
        audioLipSync: num('sens-lips', 1.8),
      },
      smoothing: {
        face: num('smooth-face', 0.18),
        faceMotion: num('smooth-motion', 0.2),
        lipSync: num('smooth-lips', 0.2),
      },
      lipSync: {
        jawOpen: num('lip-jaw', 0.35),
        vowelOpen: num('lip-vowel', 0.48),
        silenceGate: num('lip-silence', 0.016),
        consonantClose: num('lip-cons', 0.82),
        closeBoost: num('lip-close', 2.1),
        secondaryMix: num('lip-blend', 0.14),
      },
    });
    invalidateExpressionOptionsCache();
    const app = getAppExpressionSensitivities();
    if (audioLip) {
      audioLip.setIntensity(app.audioLipSyncMultiplier);
      audioLip.rebuildPhonemeTimeline();
    }
    if (avatar) avatar.setExpressionOptions(getExpressionOptions());
  } finally {
    _applyingSensitivity = false;
  }
}

function bindSensitivityPanel() {
  syncSensitivityInputsFromSettings();
  hydrateAppSettings().then(() => syncSensitivityInputsFromSettings());

  const ids = [
    'sens-eyes',
    'sens-mouth',
    'sens-expr',
    'sens-lips',
    'smooth-face',
    'smooth-motion',
    'smooth-lips',
    'lip-jaw',
    'lip-vowel',
    'lip-silence',
    'lip-cons',
    'lip-close',
    'lip-blend',
  ];
  for (const id of ids) {
    const el = $(id);
    if (!el) continue;
    el.addEventListener('input', applySensitivityFromInputs);
    el.addEventListener('change', applySensitivityFromInputs);
  }

  const onSettingsExternal = () => {
    if (_applyingSensitivity) return;
    invalidateAppSettingsCache();
    invalidateExpressionOptionsCache();
    syncSensitivityInputsFromSettings();
    const app = getAppExpressionSensitivities();
    if (audioLip) {
      audioLip.setIntensity(app.audioLipSyncMultiplier);
      audioLip.rebuildPhonemeTimeline();
    }
    if (avatar) avatar.setExpressionOptions(getExpressionOptions());
  };

  window.addEventListener('storage', (e) => {
    if (e.key !== 'edge_ai_settings_v1') return;
    onSettingsExternal();
  });
  window.addEventListener('edge-ai-settings', onSettingsExternal);
}

function bindExtendedUi() {
  if (!audioLip) audioLip = new AudioLipSync();
  if (!background && container) background = new FaceBackground(container);
  wireBackgroundCallbacks();
  initModelDropdown().catch(console.error);

  applyDevicePreview();
  $('record-device')?.addEventListener('change', () => {
    applyDevicePreview();
    updateRecordUi();
  });

  $('bg-mode')?.addEventListener('change', () => {
    background?.setConfig({ mode: $('bg-mode').value });
    _bgImageEl = background?.getImageElement() ?? null;
    faceRecorder?.setBackdropImage(_bgImageEl);
    syncThreeBackground();
  });
  $('bg-color')?.addEventListener('input', () => {
    background?.setConfig({ mode: 'color', color: $('bg-color').value });
    if ($('bg-mode')) $('bg-mode').value = 'color';
    syncThreeBackground();
  });
  $('bg-blur')?.addEventListener('input', () => {
    background?.setConfig({ mode: 'blur', blurPx: Number($('bg-blur').value) });
    if ($('bg-mode')) $('bg-mode').value = 'blur';
    syncThreeBackground();
  });
  $('bg-image-file')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file || !background) return;
    background.setImageFile(file);
    if ($('bg-mode')) $('bg-mode').value = 'image';
    const syncBg = () => {
      _bgImageEl = background.getImageElement();
      faceRecorder?.setBackdropImage(_bgImageEl);
      background.refresh();
      syncThreeBackground();
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
    syncThreeBackground();
  });

  if ($('bg-mode') && background) $('bg-mode').value = background.config.mode;
  if ($('bg-color') && background) $('bg-color').value = background.config.color;
  if ($('bg-blur') && background) $('bg-blur').value = background.config.blurPx;
  updateRecordUi();

  bindSensitivityPanel();

  const applyLook = () => applyAvatarLook();
  $('avatar-bright')?.addEventListener('input', applyLook);
  $('avatar-bright')?.addEventListener('change', applyLook);
  $('avatar-contrast')?.addEventListener('input', applyLook);
  $('avatar-contrast')?.addEventListener('change', applyLook);

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
  $('btn-rec-stop')?.addEventListener('click', () => {
    finishRecordedVideo().catch((err) => {
      console.error(err);
      const statusEl = $('record-status');
      if (statusEl) statusEl.textContent = `Save failed: ${err.message}`;
    });
  });
}

function showOutputUrl(path) {
  const box = $('output-url');
  if (!box || !path) return;
  const href = new URL(path.replace(/^\.\//, ''), document.baseURI).href;
  box.hidden = false;
  box.replaceChildren();
  box.append('Video URL: ');
  const link = document.createElement('a');
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = href;
  box.append(link);
}

async function finishRecordedVideo() {
  if (finishingOutput || !faceRecorder || faceRecorder.state === 'idle') return;
  finishingOutput = true;
  urlJobRecording = false;
  const statusEl = $('record-status');
  try {
    faceRecorder.onConvertProgress = (pct) => {
      if (statusEl) statusEl.textContent = `Converting to MP4… ${pct}%`;
    };
    if (statusEl) statusEl.textContent = 'Stopping…';
    const blob = await faceRecorder.stop();
    faceRecorder.onConvertProgress = null;
    audioLip?.stop();
    updateRecordUi();
    if (!blob) return;
    const { w, h, label } = getRecordOutputSize();
    faceRecorder.download(blob, `face-follow-${label}-${w}x${h}-${Date.now()}`);
    if (statusEl) statusEl.textContent = 'Saving video URL…';
    const url = await saveOutputVideo(blob);
    const videoUrl = new URL(url.replace(/^\.\//, ''), document.baseURI).href;
    showOutputUrl(url);
    let webhookNote = '';
    if (readJobQuery().webhook) {
      if (statusEl) statusEl.textContent = 'Notifying webhook…';
      try {
        await notifyWebhook(videoUrl);
        webhookNote = ' Webhook sent.';
      } catch (err) {
        console.error(err);
        webhookNote = ` Webhook failed: ${err.message}`;
      }
    }
    if (statusEl) {
      const saved = blob.type.includes('mp4')
        ? `Saved as MP4 (${label} ${w}×${h})`
        : `Saved WebM (${label} ${w}×${h}) — MP4 transcode unavailable`;
      statusEl.textContent = saved + webhookNote;
    }
  } finally {
    finishingOutput = false;
  }
}

function readJobQuery() {
  const q = new URLSearchParams(location.search);
  return {
    recording: (q.get('recording') || '').trim(),
    model: (q.get('model') || '').trim(),
    audio: (q.get('audio') || '').trim(),
    webhook: (q.get('webhook') || '').trim(),
  };
}

function webhookQueryParams(webhookUrl) {
  const params = {};
  if (!webhookUrl) return params;
  const parsed = new URL(webhookUrl);
  parsed.searchParams.forEach((value, key) => {
    params[key] = value;
  });
  return params;
}

async function notifyWebhook(videoUrl) {
  const job = readJobQuery();
  if (!job.webhook) return;
  const query = webhookQueryParams(job.webhook);
  const data = {
    ...query,
    videoUrl,
    model: $('model-select')?.value || job.model,
    recording: $('raw-select')?.value || job.recording,
    audio: job.audio,
    webhookQuery: query,
  };
  const res = await fetch('./api/assets/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: job.webhook, data }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(detail || `Webhook failed (${res.status})`);
  }
}

async function selectModelFromQuery(query) {
  const sel = $('model-select');
  await populateModelSelect(sel);
  const needle = query.toLowerCase();
  const match = [...(sel?.options || [])].find(
    (opt) => opt.value.toLowerCase() === needle || opt.textContent.trim().toLowerCase() === needle
  );
  if (!match) throw new Error(`Model not found: ${query}`);
  sel.value = match.value;
  setSelectedModelId(match.value);
}

async function loadAudioFromUrl(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Audio URL failed (${res.status})`);
  const blob = await res.blob();
  const base = decodeURIComponent(url.split('?')[0].split('/').pop() || 'audio');
  const file = new File([blob], base, { type: blob.type || 'audio/mpeg' });
  const app = getAppExpressionSensitivities();
  audioLip.setIntensity(app.audioLipSyncMultiplier);
  const info = await audioLip.loadFile(file);
  audioLip.setIntensity(app.audioLipSyncMultiplier);
  if ($('audio-lip-sync')) $('audio-lip-sync').checked = true;
  audioLip.enabled = true;
  const steps = info?.steps ?? 0;
  const status = $('audio-status');
  if (status) {
    status.textContent = steps > 0 ? `${base} — lip-sync ready (${steps} steps)` : `${base} — loaded`;
  }
  updateRecordUi();
}

async function applyUrlJob() {
  const job = readJobQuery();
  if (!job.recording && !job.model && !job.audio) return;
  if (job.recording) {
    const name = sanitizeRawName(job.recording);
    await refreshRawList(name);
    if ($('raw-select')?.value !== name) throw new Error(`Recording not found: ${job.recording}`);
    setRawStatus(`Selected ${name} from the link.`);
  }
  if (job.model) await selectModelFromQuery(job.model);
  if (job.audio) await loadAudioFromUrl(job.audio);
  if (!(job.recording && job.model && job.audio)) return;

  setStatus('Link loaded. Starting tracking, model, and recording…', false);
  await startTracking();
  await loadModelFace();
  if ($('record-with-audio')) $('record-with-audio').checked = true;
  urlJobRecording = true;
  await startRecordingWithOptions();
  if (rawPlaybackVideo?.ended) {
    await finishRecordedVideo();
    return;
  }
  setStatus('<strong>Recording from link.</strong> The video URL appears when the take ends.', true);
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

async function refreshPresetDropdown() {
  const sel = $('preset-select');
  if (!sel) return;
  const presets = await listPresets();
  const last = getLastPresetId();
  sel.innerHTML = '';
  if (presets.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No presets saved yet';
    opt.disabled = true;
    sel.appendChild(opt);
    return;
  }
  for (const p of presets) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name + (p.modelName ? ` · ${p.modelName}` : '');
    sel.appendChild(opt);
  }
  if (last && presets.some((p) => p.id === last)) {
    sel.value = last;
  } else if (presets.length) {
    sel.value = presets[0].id;
  }
}

async function getSelectedPreset() {
  const sel = $('preset-select');
  const id = sel?.value;
  if (!id) return null;
  const presets = await listPresets();
  return presets.find((p) => p.id === id) || null;
}

function applyPresetData(preset) {
  if (!preset) return;
  if (preset.placement && typeof preset.placement === 'object') {
    placement = { ...DEFAULT_PLACEMENT, ...preset.placement, version: PLACEMENT_VERSION };
    syncInputsFromPlacement();
    applyPlacement();
  }
  if (preset.bodyParts && typeof preset.bodyParts === 'object') {
    bodyParts = { ...DEFAULT_BODY_PARTS, ...preset.bodyParts };
    syncInputsFromBodyParts();
    if (modelLoaded) applyBodyPartVisibility();
  }
  setLastPresetId(preset.id);
}

showFaceMeshInput?.addEventListener('change', () => {
  updateFaceShellVisibility();
});

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

$('btn-preset-apply')?.addEventListener('click', async () => {
  try {
    const preset = await getSelectedPreset();
    if (!preset) {
      setStatus('No preset selected. Save one first.', false);
      return;
    }
    if (preset.modelId && $('model-select')?.value !== preset.modelId) {
      $('model-select').value = preset.modelId;
      setSelectedModelId(preset.modelId);
      if (running && !modelLoaded) {
        loadModelFace().catch(console.error);
      } else if (running && modelLoaded) {
        loadModelFace().catch(console.error);
      }
    }
    await new Promise((r) => setTimeout(r, 20));
    applyPresetData(preset);
    setStatus(`Applied preset: <strong>${preset.name}</strong>`, true);
  } catch (e) {
    console.error(e);
    setStatus(`Apply preset failed: ${e.message}`, false);
  }
});

$('btn-preset-save')?.addEventListener('click', async () => {
  try {
    readPlacementFromInputs();
    syncBodyPartsFromInputs();
    const existing = await getSelectedPreset();
    const defaultName = existing?.name || `Preset ${new Date().toLocaleString().slice(0, 17)}`;
    const name = prompt('Save preset as:', defaultName);
    if (!name) return;
    const modelId = $('model-select')?.value || getSelectedModelId();
    const modelName = (() => {
      const sel = $('model-select');
      const opt = sel?.selectedOptions?.[0];
      return opt?.text?.split(' (')[0] || '';
    })();
    const record = await savePreset({
      id: existing?.id,
      name: name.trim(),
      modelId,
      modelName,
      placement: { ...placement },
      bodyParts: { ...bodyParts },
    });
    setLastPresetId(record.id);
    await refreshPresetDropdown();
    setStatus(`Saved preset: <strong>${record.name}</strong>`, true);
  } catch (e) {
    console.error(e);
    setStatus(`Save preset failed: ${e.message}`, false);
  }
});

$('btn-preset-delete')?.addEventListener('click', async () => {
  try {
    const preset = await getSelectedPreset();
    if (!preset) {
      setStatus('No preset selected.', false);
      return;
    }
    if (!confirm(`Delete preset "${preset.name}"? This cannot be undone.`)) return;
    await deletePreset(preset.id);
    await refreshPresetDropdown();
    setStatus(`Deleted preset: ${preset.name}`, true);
  } catch (e) {
    console.error(e);
    setStatus(`Delete preset failed: ${e.message}`, false);
  }
});

$('btn-preset-rename')?.addEventListener('click', async () => {
  try {
    const preset = await getSelectedPreset();
    if (!preset) {
      setStatus('No preset selected.', false);
      return;
    }
    const name = prompt('Rename preset:', preset.name);
    if (!name || name === preset.name) return;
    await renamePreset(preset.id, name);
    await refreshPresetDropdown();
    const sel = $('preset-select');
    if (sel) sel.value = preset.id;
    setStatus(`Renamed preset to: <strong>${name}</strong>`, true);
  } catch (e) {
    console.error(e);
    setStatus(`Rename preset failed: ${e.message}`, false);
  }
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

function bindRawControls() {
  refreshRawList().catch(console.error);
  $('raw-select')?.addEventListener('change', () => {
    updateRawSourceUi();
    const name = $('raw-select')?.value;
    if (running) {
      setStatus('Stop, then start again to use the new source', false);
    } else if (name) {
      setRawStatus(`Selected ${name}. Press Start from recording.`);
    }
  });
  $('btn-raw-rec')?.addEventListener('click', () => {
    const typed = $('raw-name')?.value?.trim();
    if (typed) {
      try {
        sanitizeRawName(typed);
      } catch (err) {
        setRawStatus(err.message);
        return;
      }
    }
    startRawCapture().catch((err) => {
      console.error(err);
      setRawStatus(err.message);
    });
  });
  $('btn-raw-stop')?.addEventListener('click', () => {
    stopRawCapture().catch((err) => {
      console.error(err);
      setRawStatus(`Save failed: ${err.message}`);
      const recBtn = $('btn-raw-rec');
      if (recBtn) recBtn.disabled = false;
    });
  });
  $('btn-raw-delete')?.addEventListener('click', () => {
    const name = $('raw-select')?.value;
    if (!name) return;
    if (!window.confirm(`Delete assets/recordings/${name}.webm?`)) return;
    deleteRawVideo(name)
      .then(() => refreshRawList())
      .then(() => setRawStatus(`Deleted ${name}`))
      .catch((err) => {
        console.error(err);
        setRawStatus(`Delete failed: ${err.message}`);
      });
  });
}

function bootstrap() {
  bindPlacementControls();
  bindExtendedUi();
  bindRawControls();
  refreshPresetDropdown().catch(console.error);
  setRecordPanelUnlocked(false);
  applyUrlJob().catch((err) => {
    console.error(err);
    setStatus(`Link setup failed: ${err.message}`, false);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
