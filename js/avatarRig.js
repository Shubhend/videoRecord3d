// ==================== AVATAR RIGGING ====================
// VRM avatar bone manipulation and rigging, driven by Kalidokit output.
// - Per-part sensitivity, smoothing, on/off toggles come from settingsStore.
// - When a part hasn't been updated for `lostTrackingMs`, its bones and
//   blendshapes are slerped back toward a natural rest pose so the
//   avatar doesn't freeze mid-gesture when tracking flickers.
// - Hips bone is rotated only (no position) — Kalidokit's normalized
//   hip position drifts over time, which would slide the avatar away
//   from the floor.

import { Config } from './config.js';
import { applyDeadZone } from './utils.js';
import { getSettings } from './settingsStore.js';

const FINGERS = ['Ring', 'Index', 'Middle', 'Thumb', 'Little'];
const FINGER_SEGMENTS = ['Proximal', 'Intermediate', 'Distal'];
const MOUTH_SHAPES = ['A', 'I', 'U', 'E', 'O'];

const POSE_BONES = [
  'Hips',
  'Spine',
  'Chest',
  'LeftUpperArm',
  'LeftLowerArm',
  'RightUpperArm',
  'RightLowerArm',
  'LeftUpperLeg',
  'LeftLowerLeg',
  'RightUpperLeg',
  'RightLowerLeg',
];

export class AvatarRig {
  constructor() {
    this.vrm = null;
    this.oldLookTarget = new THREE.Euler();
    this.settings = getSettings();

    this.lastSeen = {
      face: 0,
      pose: 0,
      leftHand: 0,
      rightHand: 0,
    };

    this._identityQuat = new THREE.Quaternion();

    // External viseme weights (e.g. from audio lip-sync) override the
    // face-derived mouth shapes when set. null = use face data.
    this._mouthOverride = null;

    // Most recent expression cues from raw face landmarks (brow / frown /
    // smile). Stored so audio-driven mouth update() can keep applying them
    // even if rigFace hasn't run for a frame.
    this._lastExtras = null;
  }

  setVRM(vrm) {
    this.vrm = vrm;
  }

  setSettings(settings) {
    this.settings = settings || getSettings();
  }

  /**
   * Override mouth shapes from an external source (audio lip-sync).
   * Pass null to clear and resume face-driven mouth animation.
   * @param {{A:number,I:number,U:number,E:number,O:number,mouthOpen?:number}|null} weights
   */
  setMouthOverride(weights) {
    this._mouthOverride = weights || null;
  }

  // ---------- low-level helpers ----------

  rigRotation(name, rotation = { x: 0, y: 0, z: 0 }, dampener = 1, lerpAmount = Config.tracking.defaultLerpAmount) {
    if (!this.vrm || !rotation) return;

    const Part = this.vrm.humanoid.getBoneNode(THREE_VRM.VRMSchema.HumanoidBoneName[name]);
    if (!Part) return;

    const filteredRotation = {
      x: applyDeadZone(rotation.x),
      y: applyDeadZone(rotation.y),
      z: applyDeadZone(rotation.z),
    };
    if (this.settings.trackingReverse?.headRotation) {
      filteredRotation.x *= -1;
      filteredRotation.y *= -1;
      filteredRotation.z *= -1;
    }

    const euler = new THREE.Euler(
      filteredRotation.x * dampener,
      filteredRotation.y * dampener,
      filteredRotation.z * dampener,
      rotation.rotationOrder || 'XYZ'
    );
    const quaternion = new THREE.Quaternion().setFromEuler(euler);
    Part.quaternion.slerp(quaternion, lerpAmount);
  }

  resetBone(name, lerpAmount = 0.15) {
    if (!this.vrm) return;
    const Part = this.vrm.humanoid.getBoneNode(THREE_VRM.VRMSchema.HumanoidBoneName[name]);
    if (!Part) return;
    Part.quaternion.slerp(this._identityQuat, lerpAmount);
  }

  // (rigPosition kept for compatibility but no longer used — removed
  // its single caller in rigPose because Kalidokit's hip position drifts.)
  rigPosition(name, position = { x: 0, y: 0, z: 0 }, dampener = 1, lerpAmount = 0.3) {
    if (!this.vrm || !position) return;

    const Part = this.vrm.humanoid.getBoneNode(THREE_VRM.VRMSchema.HumanoidBoneName[name]);
    if (!Part) return;

    const clampedY = Math.max(applyDeadZone(position.y) * dampener, 0);

    const vector = new THREE.Vector3(
      applyDeadZone(position.x) * dampener,
      clampedY,
      applyDeadZone(position.z) * dampener
    );
    Part.position.lerp(vector, lerpAmount);
  }

  // ---------- Face ----------

  /**
   * @param {object} riggedFace Kalidokit face solver output
   * @param {object} [extras] Optional landmark-derived expression cues:
   *   { browRaise: 0..1, frown: 0..1, smile: 0..1 }
   */
  rigFace(riggedFace, extras) {
    if (!this.vrm || !riggedFace) return;
    this.lastSeen.face = performance.now();

    const { sensitivity, enabled, smoothing } = this.settings;
    this._lastExtras = extras || null;

    // Distribute head rotation across the Neck AND Head bones for a
    // more natural look — the original code only animated the Neck.
    if (enabled.head) {
      const s = sensitivity.head;
      this.rigRotation('Neck', riggedFace.head, 0.35 * s, smoothing.face);
      this.rigRotation('Head', riggedFace.head, 0.35 * s, smoothing.face);
    } else {
      this.resetBone('Neck');
      this.resetBone('Head');
    }

    const Blendshape = this.vrm.blendShapeProxy;
    const PresetName = THREE_VRM.VRMSchema.BlendShapePresetName;
    if (!Blendshape) return;

    const invFace = this.settings.trackingReverse?.faceMotion === true;

    if (enabled.eyes) {
      const leftBlink = clamp01(
        (invFace ? riggedFace.eye.l : 1 - riggedFace.eye.l) * sensitivity.eyes
      );
      const rightBlink = clamp01(
        (invFace ? riggedFace.eye.r : 1 - riggedFace.eye.r) * sensitivity.eyes
      );
      Blendshape.setValue(PresetName.BlinkL, leftBlink);
      Blendshape.setValue(PresetName.BlinkR, rightBlink);
    } else {
      Blendshape.setValue(PresetName.BlinkL, 0);
      Blendshape.setValue(PresetName.BlinkR, 0);
    }

    const lerp = Kalidokit.Vector.lerp;
    const mouthLerp = 0.5;
    if (this._mouthOverride) {
      // External viseme weights (audio lip-sync) override face-derived mouth.
      // The audio intensity slider scales these shapes so the user can
      // exaggerate or dampen the mouth motion.
      const audioGain =
        (enabled.audioLipSync !== false ? (sensitivity.audioLipSync ?? 1.5) : 1.0) *
        (sensitivity.mouth ?? 1.0);
      const w = this._mouthOverride;
      MOUTH_SHAPES.forEach((shape) => {
        const target = clamp01((w[shape] || 0) * audioGain);
        Blendshape.setValue(
          PresetName[shape],
          lerp(Blendshape.getValue(PresetName[shape]) || 0, target, mouthLerp)
        );
      });
      // While audio is driving the mouth, KEEP smile / surprise / sorrow
      // face-driven so the user's real facial expression still comes through.
      this._applyExpressionBlendshapes(
        Blendshape,
        PresetName,
        riggedFace,
        sensitivity,
        enabled,
        mouthLerp,
        invFace
      );
    } else if (enabled.mouth) {
      const ms = sensitivity.mouth;
      MOUTH_SHAPES.forEach((shape) => {
        let raw = riggedFace.mouth.shape[shape] || 0;
        if (invFace) raw = 1 - raw;
        const target = clamp01(raw * ms);
        Blendshape.setValue(
          PresetName[shape],
          lerp(Blendshape.getValue(PresetName[shape]) || 0, target, mouthLerp)
        );
      });
      this._applyExpressionBlendshapes(
        Blendshape,
        PresetName,
        riggedFace,
        sensitivity,
        enabled,
        mouthLerp,
        invFace
      );
    } else {
      MOUTH_SHAPES.forEach((shape) => Blendshape.setValue(PresetName[shape], 0));
      Blendshape.setValue(PresetName.Joy, 0);
      try { Blendshape.setValue(PresetName.Fun, 0); } catch (e) {}
      try { Blendshape.setValue(PresetName.Sorrow, 0); } catch (e) {}
    }

    if (enabled.pupils && this.vrm.lookAt) {
      const ps = sensitivity.pupils;
      const px = (riggedFace.pupil.x || 0) * (invFace ? -1 : 1);
      const py = (riggedFace.pupil.y || 0) * (invFace ? -1 : 1);
      const lookTarget = new THREE.Euler(
        lerp(this.oldLookTarget.x, py * ps, 0.4),
        lerp(this.oldLookTarget.y, px * ps, 0.4),
        0,
        'XYZ'
      );
      this.oldLookTarget.copy(lookTarget);
      this.vrm.lookAt.applyer.lookAt(lookTarget);
    }
  }

  // ---------- Pose (hips + spine + arms + legs) ----------

  rigPose(riggedPose) {
    if (!this.vrm || !riggedPose) return;
    this.lastSeen.pose = performance.now();

    const { sensitivity, enabled, smoothing } = this.settings;

    // ---- Hips (waist / lower back) — ROTATION ONLY ----
    // The original implementation also applied Hips.position which caused
    // the avatar to drift sideways/down because Kalidokit's hip position
    // is a normalized offset, not a stable world coordinate.
    //
    // When Kalidokit doesn't give us a Hips rotation (e.g. hips are off-frame
    // or low-visibility), fall back to driving Hips from Spine (which is
    // derived from the more-reliable shoulder landmarks). This way the waist
    // still twists with the upper body even if the camera can't see hips.
    if (enabled.hips !== false) {
      let hipsRot = null;
      if (riggedPose.Hips) {
        hipsRot = riggedPose.Hips.rotation || riggedPose.Hips;
      }
      if (!hipsRot && riggedPose.Spine) {
        // Use a softened version of Spine rotation as a stand-in for Hips.
        // Scale down so the hips don't twist as dramatically as the chest.
        hipsRot = {
          x: (riggedPose.Spine.x || 0) * 0.45,
          y: (riggedPose.Spine.y || 0) * 0.55,
          z: (riggedPose.Spine.z || 0) * 0.45,
        };
      }
      if (hipsRot && (hipsRot.x !== undefined || hipsRot.y !== undefined || hipsRot.z !== undefined)) {
        this.rigRotation('Hips', hipsRot, 0.7 * (sensitivity.hips ?? 1.0), smoothing.pose);
      }
    } else {
      this.resetBone('Hips');
    }

    // ---- Spine + Chest ----
    if (enabled.spine && riggedPose.Spine) {
      this.rigRotation('Chest', riggedPose.Spine, 0.15 * sensitivity.spine, 0.6);
      this.rigRotation('Spine', riggedPose.Spine, 0.2 * sensitivity.spine, 0.6);
    } else if (!enabled.spine) {
      this.resetBone('Chest');
      this.resetBone('Spine');
    }

    // ---- Arms — independent per side ----
    this._rigArmSide('Left', riggedPose, enabled, sensitivity, smoothing);
    this._rigArmSide('Right', riggedPose, enabled, sensitivity, smoothing);

    // ---- Legs — independent per side ----
    this._rigLegSide('Left', riggedPose, enabled, sensitivity, smoothing);
    this._rigLegSide('Right', riggedPose, enabled, sensitivity, smoothing);
  }

  _rigArmSide(side, riggedPose, enabled, sensitivity, smoothing) {
    const key = side === 'Left' ? 'leftArm' : 'rightArm';
    const upper = `${side}UpperArm`;
    const lower = `${side}LowerArm`;
    if (enabled[key] === false) {
      this.resetBone(upper);
      this.resetBone(lower);
      return;
    }
    const s = sensitivity[key] ?? 1.0;
    this._applyOrRest(upper, riggedPose[upper], s, smoothing.pose);
    this._applyOrRest(lower, riggedPose[lower], s, smoothing.pose);
  }

  _rigLegSide(side, riggedPose, enabled, sensitivity, smoothing) {
    const key = side === 'Left' ? 'leftLeg' : 'rightLeg';
    const upper = `${side}UpperLeg`;
    const lower = `${side}LowerLeg`;
    if (enabled[key] === false) {
      this.resetBone(upper);
      this.resetBone(lower);
      return;
    }
    const s = sensitivity[key] ?? 1.0;
    this._applyOrRest(upper, riggedPose[upper], s, smoothing.legs);
    this._applyOrRest(lower, riggedPose[lower], s, smoothing.legs);
  }

  _applyOrRest(boneName, rotation, dampener, lerpAmount) {
    if (rotation) {
      this.rigRotation(boneName, rotation, dampener, lerpAmount);
      return;
    }
    // No rotation data for this bone (e.g. visibility-filtered).
    // Either smoothly drift it back to rest, or freeze it in place
    // depending on the user's "auto-relax" preference.
    if (this.settings.enabled.autoRelax === false) return;
    const scale = this.settings.sensitivity.autoRelax ?? 1.0;
    if (scale <= 0) return;
    this.resetBone(boneName, Config.tracking.restRelaxRate.bones * scale);
  }

  // ---------- Hands + fingers ----------

  rigHand(side, riggedHand, riggedPose) {
    if (!this.vrm || !riggedHand) return;
    if (side === 'left') this.lastSeen.leftHand = performance.now();
    else this.lastSeen.rightHand = performance.now();

    const { sensitivity, enabled, smoothing } = this.settings;
    const prefix = side === 'left' ? 'Left' : 'Right';
    const sideKey = side === 'left' ? 'leftHand' : 'rightHand';

    const sideEnabled = enabled[sideKey] !== false;
    const sideSens = sensitivity[sideKey] ?? 1.0;

    // Wrist — hand solve + pose arm chain (pose stabilizes shoulder–wrist link)
    if (sideEnabled) {
      const poseHand = riggedPose?.[`${prefix}Hand`];
      const handWrist = riggedHand[`${prefix}Wrist`];
      const wristRot = {
        x: handWrist?.x ?? poseHand?.x ?? 0,
        y: handWrist?.y ?? poseHand?.y ?? 0,
        z: handWrist?.z ?? poseHand?.z ?? 0,
        rotationOrder: handWrist?.rotationOrder || poseHand?.rotationOrder,
      };
      const wristLerp = Math.min(0.95, (smoothing.hands ?? 0.24) * 1.15);
      this.rigRotation(`${prefix}Hand`, wristRot, sideSens, wristLerp);
    } else {
      this.resetBone(`${prefix}Hand`);
    }

    // Fingers — gated by both the side toggle AND the global "fingers" toggle
    if (sideEnabled && enabled.fingers) {
      const f = sensitivity.fingers;
      const fingerLerp = smoothing.fingers ?? 0.18;
      FINGERS.forEach((finger) => {
        FINGER_SEGMENTS.forEach((segment) => {
          const boneName = `${prefix}${finger}${segment}`;
          if (riggedHand[boneName]) {
            this.rigRotation(boneName, riggedHand[boneName], f, fingerLerp);
          }
        });
      });
    } else {
      FINGERS.forEach((finger) => {
        FINGER_SEGMENTS.forEach((segment) => {
          this.resetBone(`${prefix}${finger}${segment}`);
        });
      });
    }
  }

  // ---------- Per-frame update + lost-tracking relaxation ----------

  update(delta) {
    if (!this.vrm) return;

    // Lost-tracking relaxation: when a region's tracking signal hasn't
    // arrived for `lostTrackingMs`, slerp those bones back to rest pose.
    // Gated by the user's "Smooth Return to Rest" setting; when disabled,
    // bones simply freeze in their last detected position.
    const autoRelaxEnabled = this.settings.enabled.autoRelax !== false;
    const autoRelaxScale = this.settings.sensitivity.autoRelax ?? 1.0;
    if (autoRelaxEnabled && autoRelaxScale > 0) {
      const now = performance.now();
      const lostMs =
        this.settings.trackingMedia?.lostTrackingMs ?? Config.tracking.lostTrackingMs;
      const base = Config.tracking.restRelaxRate;
      const rates = {
        bones: base.bones * autoRelaxScale,
        fingers: base.fingers * autoRelaxScale,
        blendshapes: base.blendshapes * autoRelaxScale,
      };

      if (now - this.lastSeen.face > lostMs) {
        this.resetBone('Neck', rates.bones);
        this.resetBone('Head', rates.bones);
        this._relaxBlendshapes(rates.blendshapes);
      }

      // Audio-driven mouth keeps animating even when face tracking is absent.
      if (this._mouthOverride) this._applyMouthOverride();

      if (now - this.lastSeen.pose > lostMs) {
        POSE_BONES.forEach((b) => this.resetBone(b, rates.bones));
      }

      if (now - this.lastSeen.leftHand > lostMs) {
        this._relaxHandBones('Left', rates.bones, rates.fingers);
      }
      if (now - this.lastSeen.rightHand > lostMs) {
        this._relaxHandBones('Right', rates.bones, rates.fingers);
      }
    }

    this.vrm.update(delta);
  }

  _relaxBlendshapes(rate) {
    const Blendshape = this.vrm.blendShapeProxy;
    if (!Blendshape) return;
    const PresetName = THREE_VRM.VRMSchema.BlendShapePresetName;
    // Skip mouth shapes when an audio override is driving them.
    const targets = this._mouthOverride
      ? ['BlinkL', 'BlinkR']
      : ['BlinkL', 'BlinkR', 'A', 'I', 'U', 'E', 'O'];
    targets.forEach((t) => {
      const cur = Blendshape.getValue(PresetName[t]) || 0;
      Blendshape.setValue(PresetName[t], cur + (0 - cur) * rate);
    });
    // Joy / Fun / Sorrow are never relaxed here — they're owned by the
    // expression sub-system (rigFace + _applyExpressionBlendshapes), which
    // already settles them toward 0 when the user's face is neutral.
  }

  _applyMouthOverride() {
    if (!this._mouthOverride || !this.vrm) return;
    const Blendshape = this.vrm.blendShapeProxy;
    if (!Blendshape) return;
    const PresetName = THREE_VRM.VRMSchema.BlendShapePresetName;
    const { sensitivity, enabled } = this.settings;
    const audioGain =
      (enabled.audioLipSync !== false ? (sensitivity.audioLipSync ?? 1.5) : 1.0) *
      (sensitivity.mouth ?? 1.0);
    const w = this._mouthOverride;
    const lerpAmt = 0.5;
    MOUTH_SHAPES.forEach((shape) => {
      const target = clamp01((w[shape] || 0) * audioGain);
      Blendshape.setValue(
        PresetName[shape],
        Kalidokit.Vector.lerp(Blendshape.getValue(PresetName[shape]) || 0, target, lerpAmt)
      );
    });
  }

  /**
   * Apply face-driven expression blendshapes (smile, brow-raise, frown).
   * These are kept separate from the mouth-shape pipeline so they can run
   * even while audio lip-sync is overriding the visemes.
   */
  _applyExpressionBlendshapes(
    Blendshape,
    PresetName,
    riggedFace,
    sensitivity,
    enabled,
    lerpAmt,
    invert = false
  ) {
    const lerp = Kalidokit.Vector.lerp;
    const expEnabled = enabled.expressions !== false;
    const exp = expEnabled ? (sensitivity.expressions ?? 1.0) : 0;
    const extras = this._lastExtras || {};

    // Smile (Joy): combine Kalidokit's mouth.shape.I (mouth wide) with our
    // landmark-derived smile cue (mouth corners pulled up).
    const kalidoSmile = (riggedFace?.mouth?.shape?.I || 0) * 0.7;
    const landmarkSmile = extras.smile || 0;
    let smileAmount = clamp01(Math.max(kalidoSmile, landmarkSmile) * exp);
    if (invert) smileAmount = clamp01(1 - smileAmount);
    Blendshape.setValue(
      PresetName.Joy,
      lerp(Blendshape.getValue(PresetName.Joy) || 0, smileAmount, lerpAmt)
    );

    // Brow raise → Fun (surprised look). Many VRMs map Fun to "raised brows
    // / wide eyes". Falls back gracefully if the preset is missing.
    try {
      let browAmt = clamp01((extras.browRaise || 0) * exp);
      if (invert) browAmt = clamp01(1 - browAmt);
      Blendshape.setValue(
        PresetName.Fun,
        lerp(Blendshape.getValue(PresetName.Fun) || 0, browAmt, lerpAmt)
      );
    } catch (e) {}

    // Frown → Sorrow.
    try {
      let sorrow = clamp01((extras.frown || 0) * exp);
      if (invert) sorrow = clamp01(1 - sorrow);
      Blendshape.setValue(
        PresetName.Sorrow,
        lerp(Blendshape.getValue(PresetName.Sorrow) || 0, sorrow, lerpAmt)
      );
    } catch (e) {}
  }

  _relaxHandBones(prefix, wristRate, fingerRate) {
    this.resetBone(`${prefix}Hand`, wristRate);
    FINGERS.forEach((f) =>
      FINGER_SEGMENTS.forEach((s) => this.resetBone(`${prefix}${f}${s}`, fingerRate))
    );
  }
}

function clamp01(v) {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
