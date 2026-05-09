// ==================== TRACKING ====================
// MediaPipe Holistic tracking and Kalidokit solving.
// Pose data is gated by per-region MediaPipe visibility scores so the rig
// gracefully drifts back to rest instead of flailing on noisy/missing data.

import { Config } from './config.js';
import { smoothRotation } from './utils.js';

// MediaPipe Pose landmark indices (https://google.github.io/mediapipe/solutions/pose).
const LM = {
  leftShoulder: 11, rightShoulder: 12,
  leftElbow: 13, rightElbow: 14,
  leftWrist: 15, rightWrist: 16,
  leftHip: 23, rightHip: 24,
  leftKnee: 25, rightKnee: 26,
  leftAnkle: 27, rightAnkle: 28,
};

// MediaPipe Face Mesh landmark indices used for our custom expression cues.
// Reference: https://github.com/google/mediapipe/blob/master/mediapipe/modules/face_geometry/data/canonical_face_model_uv_visualization.png
const FM = {
  leftEyeOuter: 33,   rightEyeOuter: 263,
  leftEyeUpper: 159,  rightEyeUpper: 386,
  leftBrowInner: 105, rightBrowInner: 334,
  leftBrowMid:    66, rightBrowMid:   296,
  mouthLeftCorner: 61,
  mouthRightCorner: 291,
  mouthUpperInner: 13,
  mouthLowerInner: 14,
};

function avgVisibility(landmarks, indices) {
  if (!landmarks) return 0;
  let sum = 0;
  let count = 0;
  for (const i of indices) {
    const lm = landmarks[i];
    if (lm && typeof lm.visibility === 'number') {
      sum += lm.visibility;
      count++;
    }
  }
  return count === 0 ? 0 : sum / count;
}

function dist(a, b) {
  if (!a || !b) return 0;
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function clamp01(v) {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export class Tracking {
  constructor(videoElement, avatarRig, onStatusUpdate, onDistance) {
    this.video = videoElement;
    this.avatarRig = avatarRig;
    this.onStatusUpdate = onStatusUpdate;
    /** Optional callback that receives a normalized distance ratio
     *  (1.0 = baseline distance, >1 = closer, <1 = farther). */
    this.onDistance = onDistance || null;
    this.holistic = null;
    this.smoothedValues = {
      face: null,
      pose: null,
      leftHand: null,
      rightHand: null,
    };

    // Distance proxy: shoulder width in normalized image coords.
    // We auto-calibrate a baseline as the median of the first ~1.5s
    // of stable readings, then report a ratio relative to that.
    this._distance = {
      baseline: null,
      samples: [],
      sampleTarget: 45, // ~1.5s at 30 fps
      lastEmitted: 1.0,
    };

    // Expression baselines — auto-calibrated from the user's neutral face
    // over the first ~1.5s of stable readings. We then report deltas from
    // that baseline so different face shapes don't trip the detector.
    this._expr = {
      browSamples: [],
      mouthCornerSamples: [],
      browBaseline: null,
      mouthCornerBaseline: null,
      sampleTarget: 45,
    };
  }
  
  async init() {
    this.holistic = new Holistic({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/holistic@0.5.1635989137/${file}`
    });
    
    this.holistic.setOptions(Config.holistic);
    
    this.holistic.onResults((results) => this.processResults(results));
  }
  
  async start() {
    const camera = new Camera(this.video, {
      onFrame: async () => {
        await this.holistic.send({ image: this.video });
      },
      width: Config.camera.width,
      height: Config.camera.height
    });
    await camera.start();
  }
  
  processResults(results) {
    const status = [];
    
    const faceLandmarks = results.faceLandmarks;
    const pose3DLandmarks = results.ea;
    const pose2DLandmarks = results.poseLandmarks;
    
    // Hand landmarks are REVERSED in MediaPipe Holistic
    const leftHandLandmarks = results.rightHandLandmarks;
    const rightHandLandmarks = results.leftHandLandmarks;
    
    // Process face
    if (faceLandmarks) {
      status.push('Face ✓');
      this.processFace(faceLandmarks);
    }
    
    // Process pose
    if (pose2DLandmarks && pose3DLandmarks) {
      status.push('Pose ✓');
      this.processPose(pose2DLandmarks, pose3DLandmarks);
    }
    
    // Process hands
    if (leftHandLandmarks) {
      status.push('L-Hand ✓');
      this.processHand('left', leftHandLandmarks);
    }
    
    if (rightHandLandmarks) {
      status.push('R-Hand ✓');
      this.processHand('right', rightHandLandmarks);
    }
    
    // Update status
    if (this.onStatusUpdate) {
      this.onStatusUpdate(status.length > 0 ? status.join(' | ') : 'Searching...');
    }
  }
  
  processFace(faceLandmarks) {
    const rawFace = Kalidokit.Face.solve(faceLandmarks, {
      runtime: "mediapipe",
      video: this.video,
      smoothBlink: false,
      blinkSettings: [0.25, 0.75]
    });

    if (rawFace) {
      const rawEyes = { l: rawFace.eye.l, r: rawFace.eye.r };

      let riggedFace;
      if (this.smoothedValues.face) {
        riggedFace = {
          head: smoothRotation(this.smoothedValues.face.head, rawFace.head),
          eye: rawEyes,
          mouth: rawFace.mouth,
          pupil: rawFace.pupil,
          brow: rawFace.brow
        };
      } else {
        riggedFace = rawFace;
      }

      this.smoothedValues.face = riggedFace;

      // Derive extra expression cues (brow raise, frown, smile) from the raw
      // 478-point face mesh — Kalidokit doesn't expose these directly.
      const extras = this._computeExpressionExtras(faceLandmarks);

      this.avatarRig.rigFace(riggedFace, extras);
    }
  }

  /**
   * Compute brow-raise / frown / smile cues from raw MediaPipe FaceMesh
   * landmarks. Returns values in 0..1, normalized against an auto-calibrated
   * neutral baseline collected during the first ~1.5s of tracking.
   */
  _computeExpressionExtras(landmarks) {
    if (!landmarks || landmarks.length < 400) {
      return { browRaise: 0, frown: 0, smile: 0 };
    }

    // Inter-ocular distance — used to normalize all distances so the metrics
    // are independent of how close the user is to the camera.
    const eyeDist = dist(landmarks[FM.leftEyeOuter], landmarks[FM.rightEyeOuter]);
    if (!eyeDist || !Number.isFinite(eyeDist)) {
      return { browRaise: 0, frown: 0, smile: 0 };
    }

    // ---- Brow raise: vertical distance from brow midpoint to eye top ----
    const leftBrowY = (landmarks[FM.leftBrowInner].y + landmarks[FM.leftBrowMid].y) * 0.5;
    const rightBrowY = (landmarks[FM.rightBrowInner].y + landmarks[FM.rightBrowMid].y) * 0.5;
    const leftEyeY = landmarks[FM.leftEyeUpper].y;
    const rightEyeY = landmarks[FM.rightEyeUpper].y;
    // y increases downward, so brow ABOVE eye → eyeY - browY > 0.
    const browToEye = ((leftEyeY - leftBrowY) + (rightEyeY - rightBrowY)) * 0.5;
    const browRatio = browToEye / eyeDist; // typical neutral ~0.35

    // ---- Mouth corner offset: vertical position of corners vs mouth center ----
    const cornerL = landmarks[FM.mouthLeftCorner];
    const cornerR = landmarks[FM.mouthRightCorner];
    const mouthCenterY = (landmarks[FM.mouthUpperInner].y + landmarks[FM.mouthLowerInner].y) * 0.5;
    // Negative = corners ABOVE center (smile); positive = below center (frown).
    const cornerDelta = ((cornerL.y + cornerR.y) * 0.5 - mouthCenterY) / eyeDist;

    // ---- Auto-calibrate baselines from the first stable samples ----
    const e = this._expr;
    if (e.browBaseline === null) {
      e.browSamples.push(browRatio);
      if (e.browSamples.length >= e.sampleTarget) {
        const sorted = [...e.browSamples].sort((a, b) => a - b);
        e.browBaseline = sorted[Math.floor(sorted.length / 2)];
        e.browSamples = [];
      }
    }
    if (e.mouthCornerBaseline === null) {
      e.mouthCornerSamples.push(cornerDelta);
      if (e.mouthCornerSamples.length >= e.sampleTarget) {
        const sorted = [...e.mouthCornerSamples].sort((a, b) => a - b);
        e.mouthCornerBaseline = sorted[Math.floor(sorted.length / 2)];
        e.mouthCornerSamples = [];
      }
    }

    // Until we have a baseline, return zeros — the user might not be ready
    // yet, and false positives during calibration look bad.
    if (e.browBaseline === null || e.mouthCornerBaseline === null) {
      return { browRaise: 0, frown: 0, smile: 0 };
    }

    // Brow raise: delta above neutral, normalized so a ~30% larger gap
    // saturates the blendshape.
    const browDelta = browRatio - e.browBaseline;
    const browRaise = clamp01(browDelta / (e.browBaseline * 0.35));

    // Smile: corners HIGHER than baseline → smile.
    const smileDelta = e.mouthCornerBaseline - cornerDelta;
    const smile = clamp01(smileDelta / 0.04);

    // Frown: corners LOWER than baseline → frown.
    const frownDelta = cornerDelta - e.mouthCornerBaseline;
    const frown = clamp01(frownDelta / 0.04);

    return { browRaise, frown, smile };
  }
  
  processPose(pose2DLandmarks, pose3DLandmarks) {
    const riggedPose = Kalidokit.Pose.solve(pose3DLandmarks, pose2DLandmarks, {
      runtime: "mediapipe",
      video: this.video
    });

    if (!riggedPose) return;

    // Gate each body region on its MediaPipe visibility score so the rig
    // doesn't apply garbage rotations when a region is occluded or out
    // of frame. Dropped fields cause the rig to drift back to rest.
    const v = Config.tracking.visibility;

    const legVis = avgVisibility(pose2DLandmarks, [
      LM.leftKnee, LM.rightKnee, LM.leftAnkle, LM.rightAnkle
    ]);
    if (legVis < v.legs) {
      delete riggedPose.LeftUpperLeg;
      delete riggedPose.LeftLowerLeg;
      delete riggedPose.RightUpperLeg;
      delete riggedPose.RightLowerLeg;
    }

    const armVis = avgVisibility(pose2DLandmarks, [
      LM.leftShoulder, LM.rightShoulder,
      LM.leftElbow, LM.rightElbow,
      LM.leftWrist, LM.rightWrist
    ]);
    if (armVis < v.arms) {
      delete riggedPose.LeftUpperArm;
      delete riggedPose.LeftLowerArm;
      delete riggedPose.RightUpperArm;
      delete riggedPose.RightLowerArm;
    }

    const hipsVis = avgVisibility(pose2DLandmarks, [LM.leftHip, LM.rightHip]);
    if (hipsVis < v.hips) {
      delete riggedPose.Hips;
    }

    // Distance estimation from shoulder width (normalized image coords).
    this._updateDistance(pose2DLandmarks);

    this.smoothedValues.pose = riggedPose;
    this.avatarRig.rigPose(riggedPose);
  }

  /**
   * Computes a relative distance ratio (1.0 = baseline) from the apparent
   * shoulder width in screen space. Uses 2D landmarks because the 3D
   * Z values from MediaPipe are unreliable for absolute depth.
   */
  _updateDistance(landmarks) {
    if (!this.onDistance) return;
    const ls = landmarks?.[LM.leftShoulder];
    const rs = landmarks?.[LM.rightShoulder];
    if (!ls || !rs) return;
    const visOk = (ls.visibility ?? 1) > 0.5 && (rs.visibility ?? 1) > 0.5;
    if (!visOk) return;

    const dx = ls.x - rs.x;
    const dy = ls.y - rs.y;
    const width = Math.hypot(dx, dy);
    if (!Number.isFinite(width) || width <= 0) return;

    // Auto-calibrate: collect samples until we have enough, then take the
    // median to be the "neutral" distance.
    const d = this._distance;
    if (d.baseline === null) {
      d.samples.push(width);
      if (d.samples.length >= d.sampleTarget) {
        const sorted = [...d.samples].sort((a, b) => a - b);
        d.baseline = sorted[Math.floor(sorted.length / 2)];
        d.samples = [];
      }
      return;
    }

    // Clamp ratio so a momentary glitch can't yank the avatar across the room.
    let ratio = width / d.baseline;
    ratio = Math.max(0.5, Math.min(1.8, ratio));
    d.lastEmitted = ratio;
    this.onDistance(ratio);
  }

  /** Manually re-trigger baseline calibration (e.g. after camera change). */
  recalibrateDistance() {
    this._distance.baseline = null;
    this._distance.samples = [];
  }
  
  processHand(side, landmarks) {
    const sideCapital = side === 'left' ? 'Left' : 'Right';
    const rawHand = Kalidokit.Hand.solve(landmarks, sideCapital);
    
    if (rawHand) {
      const smoothKey = `${side}Hand`;
      
      let riggedHand;
      if (this.smoothedValues[smoothKey]) {
        riggedHand = {};
        for (const key in rawHand) {
          riggedHand[key] = smoothRotation(this.smoothedValues[smoothKey][key], rawHand[key]);
        }
      } else {
        riggedHand = rawHand;
      }
      
      this.smoothedValues[smoothKey] = riggedHand;
      this.avatarRig.rigHand(side, riggedHand, this.smoothedValues.pose);
    }
  }
}
