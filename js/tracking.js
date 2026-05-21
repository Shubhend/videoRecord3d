// ==================== TRACKING ====================
// MediaPipe Holistic tracking and Kalidokit solving.
// Pose data is gated by per-region MediaPipe visibility scores so the rig
// gracefully drifts back to rest instead of flailing on noisy/missing data.

import { Config } from './config.js';
import { getSettings } from './settingsStore.js';
import { estimateHeadPose } from './headPoseEstimate.js';
import { smoothRotation } from './utils.js';
import {
  smoothPose,
  smoothHand,
  smoothMouth,
  smoothRot,
  VisibilityGate,
} from './trackingFilters.js';

// MediaPipe Pose landmark indices (https://google.github.io/mediapipe/solutions/pose).
const LM = {
  leftShoulder: 11, rightShoulder: 12,
  leftElbow: 13, rightElbow: 14,
  leftWrist: 15, rightWrist: 16,
  leftHip: 23, rightHip: 24,
  leftKnee: 25, rightKnee: 26,
  leftAnkle: 27, rightAnkle: 28,
};

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
  /**
   * @param {HTMLVideoElement} videoElement
   * @param {import('./avatarRig.js').AvatarRig} avatarRig
   * @param {(status: string) => void} [onStatusUpdate]
   * @param {(ratio: number) => void} [onDistance]
   * @param {{ faceOnly?: boolean, mirrorPreview?: boolean }} [options]
   */
  constructor(videoElement, avatarRig, onStatusUpdate, onDistance, options = {}) {
    this.video = videoElement;
    this.avatarRig = avatarRig;
    this.onStatusUpdate = onStatusUpdate;
    this.onDistance = options.faceOnly ? null : (onDistance || null);
    this.faceOnly = options.faceOnly === true;
    this.mirrorPreview = options.mirrorPreview === true;
    /** Holistic input size on record page (must match mapLandmarkFromCaptureFrame). */
    this.captureFrameW = 640;
    this.captureFrameH = 480;
    this.settings = getSettings();
    this.holistic = null;
    this._running = false;
    this._frameId = null;
    this._frameTimer = null;
    this._sending = false;
    this._sendTimeout = null;
    this._mpCamera = null;
    this._frameCanvas = null;
    this._frameCtx = null;
    this._frameIntervalMs = options.faceOnly ? 33 : 33;
    this.smoothedValues = {
      face: null,
      pose: null,
      leftHand: null,
      rightHand: null,
    };

    this._handHold = { left: null, right: null };
    this._lastRiggedPose = null;
    this.lastFaceLandmarks = null;
    this.faceDetected = false;
    this.lastHeadPose = null;

    this._distance = {
      baseline: null,
      samples: [],
      sampleTarget: 45,
      lastEmitted: 1.0,
    };

    this._expr = {
      browSamples: [],
      mouthCornerSamples: [],
      browBaseline: null,
      mouthCornerBaseline: null,
      sampleTarget: 45,
    };

    const tm = () => this._tm();
    const hold = () => tm().holdMs ?? 380;
    this._gates = {
      leftArm: new VisibilityGate(tm().visibilityArms ?? 0.38, hold()),
      rightArm: new VisibilityGate(tm().visibilityArms ?? 0.38, hold()),
      leftLeg: new VisibilityGate(tm().visibilityLegs ?? 0.42, hold()),
      rightLeg: new VisibilityGate(tm().visibilityLegs ?? 0.42, hold()),
      hips: new VisibilityGate(tm().visibilityHips ?? 0.12, hold()),
    };
  }

  _tm() {
    return this.settings?.trackingMedia || {};
  }

  setSettings(settings) {
    this.settings = settings || getSettings();
    const tm = this._tm();
    const hold = tm.holdMs ?? 380;

    this._gates.leftArm.setThreshold(tm.visibilityArms ?? Config.tracking.visibility.arms);
    this._gates.rightArm.setThreshold(tm.visibilityArms ?? Config.tracking.visibility.arms);
    this._gates.leftLeg.setThreshold(tm.visibilityLegs ?? Config.tracking.visibility.legs);
    this._gates.rightLeg.setThreshold(tm.visibilityLegs ?? Config.tracking.visibility.legs);
    this._gates.hips.setThreshold(tm.visibilityHips ?? Config.tracking.visibility.hips);
    for (const g of Object.values(this._gates)) g.setHoldMs(hold);

    if (this.holistic) {
      const faceLoose = this.faceOnly ? 0.4 : null;
      this.holistic.setOptions({
        modelComplexity: this.faceOnly
          ? 0
          : (tm.modelComplexity ?? Config.holistic.modelComplexity),
        smoothLandmarks: tm.smoothLandmarks !== false,
        minDetectionConfidence:
          faceLoose ?? tm.minDetectionConfidence ?? Config.holistic.minDetectionConfidence,
        minTrackingConfidence:
          faceLoose ?? tm.minTrackingConfidence ?? Config.holistic.minTrackingConfidence,
        refineFaceLandmarks: true,
        enableSegmentation: false,
      });
    }
  }
  
  async init() {
    if (typeof Holistic === 'undefined') {
      throw new Error('MediaPipe Holistic did not load. Check your network and refresh.');
    }

    if (this.onStatusUpdate) this.onStatusUpdate('Loading face tracker…');

    this.holistic = new Holistic({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/holistic@0.5.1635989137/${file}`,
    });
    
    this.setSettings(this.settings);
    this.holistic.onResults((results) => this.processResults(results));

    if (typeof this.holistic.initialize === 'function') {
      await this.holistic.initialize();
    }
  }
  
  /**
   * Start sending frames to MediaPipe.
   * @param {{ useVideoElement?: boolean }} [options]
   *   useVideoElement: true when the video already has a getUserMedia stream (record page).
   */
  async start(options = {}) {
    this.stop();

    const useVideo = options.useVideoElement === true || this.faceOnly;

    if (useVideo) {
      await this._waitForVideoReady();
      await this._ensureVideoPlaying();
      this._running = true;
      if (this.onStatusUpdate) this.onStatusUpdate('Searching…');
      this._scheduleVideoFrame();
      return;
    }

    const tm = this._tm();
    const width = tm.cameraWidth ?? Config.camera.width;
    const height = tm.cameraHeight ?? Config.camera.height;
    this._mpCamera = new Camera(this.video, {
      onFrame: async () => {
        if (!this._running) return;
        try {
          await this.holistic.send({ image: this.video });
        } catch (err) {
          console.warn('[Tracking] holistic.send:', err);
        }
      },
      width,
      height,
    });
    this._running = true;
    await this._mpCamera.start();
  }

  stop() {
    this._running = false;
    if (this._frameId != null) {
      cancelAnimationFrame(this._frameId);
      this._frameId = null;
    }
    if (this._frameTimer != null) {
      clearTimeout(this._frameTimer);
      this._frameTimer = null;
    }
    if (this._sendTimeout != null) {
      clearTimeout(this._sendTimeout);
      this._sendTimeout = null;
    }
    this._sending = false;
    if (this._mpCamera) {
      try {
        this._mpCamera.stop();
      } catch {
        // ignore
      }
      this._mpCamera = null;
    }
  }

  async disposeHolistic() {
    this.stop();
    if (this.holistic) {
      try {
        await this.holistic.close?.();
      } catch {
        // ignore
      }
      this.holistic = null;
    }
  }

  _waitForVideoReady() {
    const ready = () =>
      this.video.readyState >= 2 &&
      this.video.videoWidth > 0 &&
      this.video.videoHeight > 0;

    if (ready()) return Promise.resolve();

    return new Promise((resolve) => {
      const done = () => {
        if (ready()) resolve();
      };
      const opts = { once: true };
      this.video.addEventListener('loadedmetadata', done, opts);
      this.video.addEventListener('loadeddata', done, opts);
      this.video.addEventListener('resize', done, opts);
      setTimeout(resolve, 3000);
    });
  }

  async _ensureVideoPlaying() {
    if (this.video.paused) {
      try {
        await this.video.play();
      } catch {
        // autoplay policies — user may need to interact
      }
    }
  }

  _ensureCaptureCanvas() {
    if (!this._frameCanvas) {
      this._frameCanvas = document.createElement('canvas');
      this._frameCtx = this._frameCanvas.getContext('2d', { willReadFrequently: true });
    }
  }

  /** Draw current video frame to a fixed-size canvas (Holistic is more reliable than raw video). */
  _captureVideoFrame() {
    this._ensureCaptureCanvas();
    const vw = this.video.videoWidth || 640;
    const vh = this.video.videoHeight || 480;
    const tm = this._tm();
    const tw = this.faceOnly ? 640 : (tm.cameraWidth ?? Config.camera.width);
    const th = this.faceOnly ? 480 : (tm.cameraHeight ?? Config.camera.height);
    this._frameCanvas.width = tw;
    this._frameCanvas.height = th;

    // Record page: letterbox like the mirrored webcam preview (object-fit: contain).
    // Main avatar page: cover crop for fuller body in frame.
    const scale = this.faceOnly
      ? Math.min(tw / vw, th / vh)
      : Math.max(tw / vw, th / vh);
    const sw = vw * scale;
    const sh = vh * scale;
    const ox = (tw - sw) / 2;
    const oy = (th - sh) / 2;
    if (this.faceOnly) {
      this._frameCtx.fillStyle = '#000';
      this._frameCtx.fillRect(0, 0, tw, th);
      this.captureFrameW = tw;
      this.captureFrameH = th;
    }
    if (this.faceOnly && this.mirrorPreview) {
      this._frameCtx.save();
      this._frameCtx.translate(tw, 0);
      this._frameCtx.scale(-1, 1);
      this._frameCtx.drawImage(this.video, ox, oy, sw, sh);
      this._frameCtx.restore();
    } else {
      this._frameCtx.drawImage(this.video, ox, oy, sw, sh);
    }
    return this._frameCanvas;
  }

  setMirrorPreview(enabled) {
    this.mirrorPreview = enabled === true;
  }

  _scheduleVideoFrame() {
    if (!this._running) return;
    this._frameTimer = setTimeout(() => {
      this._frameTimer = null;
      void this._sendVideoFrame();
    }, this._frameIntervalMs);
  }

  async _sendVideoFrame() {
    if (!this._running || !this.holistic) return;

    if (
      this.video.readyState < 2 ||
      this.video.videoWidth < 1 ||
      this.video.videoHeight < 1
    ) {
      this._scheduleVideoFrame();
      return;
    }

    if (this._sending) {
      this._scheduleVideoFrame();
      return;
    }

    this._sending = true;
    if (this._sendTimeout) clearTimeout(this._sendTimeout);
    this._sendTimeout = setTimeout(() => {
      if (this._sending) {
        console.warn('[Tracking] holistic.send timed out — retrying');
        this._sending = false;
      }
    }, 4000);

    const image = this._captureVideoFrame();
    try {
      await this.holistic.send({ image });
    } catch (err) {
      console.warn('[Tracking] holistic.send:', err);
    } finally {
      if (this._sendTimeout) {
        clearTimeout(this._sendTimeout);
        this._sendTimeout = null;
      }
      this._sending = false;
      this._scheduleVideoFrame();
    }
  }
  
  processResults(results) {
    const status = [];
    const now = performance.now();
    
    const faceLandmarks = results.faceLandmarks;
    const pose3DLandmarks = results.ea;
    const pose2DLandmarks = results.poseLandmarks;
    
    const leftHandLandmarks = results.rightHandLandmarks;
    const rightHandLandmarks = results.leftHandLandmarks;
    
    if (faceLandmarks) {
      status.push('Face ✓');
      this.faceDetected = true;
      this.lastFaceLandmarks = faceLandmarks;
      this.lastHeadPose = estimateHeadPose(faceLandmarks);
      this.processFace(faceLandmarks);
    } else {
      this.faceDetected = false;
      this.lastHeadPose = null;
    }
    
    if (!this.faceOnly) {
      if (pose2DLandmarks && pose3DLandmarks) {
        status.push('Pose ✓');
        this.processPose(pose2DLandmarks, pose3DLandmarks, now);
      }

      if (leftHandLandmarks) {
        status.push('L-Hand ✓');
        this.processHand('left', leftHandLandmarks);
      } else {
        this._holdHand('left');
      }

      if (rightHandLandmarks) {
        status.push('R-Hand ✓');
        this.processHand('right', rightHandLandmarks);
      } else {
        this._holdHand('right');
      }
    }
    
    if (this.onStatusUpdate) {
      this.onStatusUpdate(status.length > 0 ? status.join(' | ') : 'Searching...');
    }
  }
  
  processFace(faceLandmarks) {
    this.lastFaceLandmarks = faceLandmarks || null;
    this.lastHeadPose = estimateHeadPose(faceLandmarks);

    if (typeof Kalidokit === 'undefined') {
      console.warn('[Tracking] Kalidokit not loaded');
      return;
    }

    const tm = this._tm();
    const faceStab = tm.faceStabilization ?? Config.tracking.stabilization;

    const rawFace = Kalidokit.Face.solve(faceLandmarks, {
      runtime: "mediapipe",
      video: this.video,
      smoothBlink: true,
      blinkSettings: [0.28, 0.72]
    });

    if (!rawFace) return;

    const prev = this.smoothedValues.face;
    let riggedFace;

    if (prev) {
      const blinkAlpha = 1 - faceStab * 0.85;
      riggedFace = {
        head: smoothRotation(prev.head, rawFace.head, faceStab),
        eye: {
          l: (prev.eye?.l ?? 0) + ((rawFace.eye.l ?? 0) - (prev.eye?.l ?? 0)) * blinkAlpha,
          r: (prev.eye?.r ?? 0) + ((rawFace.eye.r ?? 0) - (prev.eye?.r ?? 0)) * blinkAlpha,
        },
        mouth: smoothMouth(prev.mouth, rawFace.mouth, faceStab),
        pupil: smoothRot(prev.pupil, rawFace.pupil, faceStab * 0.9),
        brow: rawFace.brow,
      };
    } else {
      riggedFace = rawFace;
    }

    this.smoothedValues.face = riggedFace;
    const extras = this._computeExpressionExtras(faceLandmarks);
    this.avatarRig.rigFace(riggedFace, extras);
  }

  _computeExpressionExtras(landmarks) {
    if (!landmarks || landmarks.length < 400) {
      return { browRaise: 0, frown: 0, smile: 0 };
    }

    const eyeDist = dist(landmarks[FM.leftEyeOuter], landmarks[FM.rightEyeOuter]);
    if (!eyeDist || !Number.isFinite(eyeDist)) {
      return { browRaise: 0, frown: 0, smile: 0 };
    }

    const leftBrowY = (landmarks[FM.leftBrowInner].y + landmarks[FM.leftBrowMid].y) * 0.5;
    const rightBrowY = (landmarks[FM.rightBrowInner].y + landmarks[FM.rightBrowMid].y) * 0.5;
    const leftEyeY = landmarks[FM.leftEyeUpper].y;
    const rightEyeY = landmarks[FM.rightEyeUpper].y;
    const browToEye = ((leftEyeY - leftBrowY) + (rightEyeY - rightBrowY)) * 0.5;
    const browRatio = browToEye / eyeDist;

    const cornerL = landmarks[FM.mouthLeftCorner];
    const cornerR = landmarks[FM.mouthRightCorner];
    const mouthCenterY = (landmarks[FM.mouthUpperInner].y + landmarks[FM.mouthLowerInner].y) * 0.5;
    const cornerDelta = ((cornerL.y + cornerR.y) * 0.5 - mouthCenterY) / eyeDist;

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

    if (e.browBaseline === null || e.mouthCornerBaseline === null) {
      return { browRaise: 0, frown: 0, smile: 0 };
    }

    const browDelta = browRatio - e.browBaseline;
    const browRaise = clamp01(browDelta / (e.browBaseline * 0.35));
    const smileDelta = e.mouthCornerBaseline - cornerDelta;
    const smile = clamp01(smileDelta / 0.04);
    const frownDelta = cornerDelta - e.mouthCornerBaseline;
    const frown = clamp01(frownDelta / 0.04);

    return { browRaise, frown, smile };
  }
  
  processPose(pose2DLandmarks, pose3DLandmarks, now) {
    const riggedPose = Kalidokit.Pose.solve(pose3DLandmarks, pose2DLandmarks, {
      runtime: "mediapipe",
      video: this.video
    });

    if (!riggedPose) return;

    const leftArmVis = avgVisibility(pose2DLandmarks, [
      LM.leftShoulder, LM.leftElbow, LM.leftWrist,
    ]);
    const rightArmVis = avgVisibility(pose2DLandmarks, [
      LM.rightShoulder, LM.rightElbow, LM.rightWrist,
    ]);
    const leftLegVis = avgVisibility(pose2DLandmarks, [LM.leftKnee, LM.leftAnkle]);
    const rightLegVis = avgVisibility(pose2DLandmarks, [LM.rightKnee, LM.rightAnkle]);
    const hipsVis = avgVisibility(pose2DLandmarks, [LM.leftHip, LM.rightHip]);

    if (!this._gates.leftArm.isTrusted(leftArmVis, now)) {
      delete riggedPose.LeftUpperArm;
      delete riggedPose.LeftLowerArm;
    }
    if (!this._gates.rightArm.isTrusted(rightArmVis, now)) {
      delete riggedPose.RightUpperArm;
      delete riggedPose.RightLowerArm;
    }
    if (!this._gates.leftLeg.isTrusted(leftLegVis, now)) {
      delete riggedPose.LeftUpperLeg;
      delete riggedPose.LeftLowerLeg;
    }
    if (!this._gates.rightLeg.isTrusted(rightLegVis, now)) {
      delete riggedPose.RightUpperLeg;
      delete riggedPose.RightLowerLeg;
    }
    if (!this._gates.hips.isTrusted(hipsVis, now)) {
      delete riggedPose.Hips;
    }

    this._updateDistance(pose2DLandmarks);

    const tm = this._tm();
    const poseStab = tm.poseStabilization ?? Config.tracking.stabilization;
    const smoothed = smoothPose(this.smoothedValues.pose, riggedPose, poseStab);
    this.smoothedValues.pose = smoothed;
    this._lastRiggedPose = smoothed;
    this.avatarRig.rigPose(smoothed);
  }

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

    let ratio = width / d.baseline;
    ratio = Math.max(0.5, Math.min(1.8, ratio));
    d.lastEmitted = ratio;
    this.onDistance(ratio);
  }

  recalibrateDistance() {
    this._distance.baseline = null;
    this._distance.samples = [];
  }

  _holdHand(side) {
    const hold = this._handHold[side];
    const holdMs = this._tm().holdMs ?? 380;
    if (hold && performance.now() - hold.at < holdMs) {
      this.avatarRig.rigHand(side, hold.data, this._lastRiggedPose || this.smoothedValues.pose);
    }
  }
  
  /** Rough quality 0..1 from palm spread in normalized image space. */
  _handLandmarkQuality(landmarks) {
    if (!landmarks || landmarks.length < 21) return 0;
    const wrist = landmarks[0];
    const indexMcp = landmarks[5];
    const middleMcp = landmarks[9];
    if (!wrist || !indexMcp || !middleMcp) return 0;
    const spread = Math.hypot(middleMcp.x - wrist.x, middleMcp.y - wrist.y);
    if (spread < 0.04) return 0.2;
    if (spread < 0.07) return 0.55;
    return 1;
  }

  /** Blend Kalidokit hand wrist with pose arm chain for steadier attachment. */
  _mergeHandWithPose(rawHand, side) {
    if (!rawHand || !this._lastRiggedPose) return rawHand;
    const prefix = side === 'left' ? 'Left' : 'Right';
    const poseHand = this._lastRiggedPose[`${prefix}Hand`];
    const wristKey = `${prefix}Wrist`;
    const handWrist = rawHand[wristKey];
    if (!poseHand && !handWrist) return rawHand;

    const blend = 0.35;
    const merged = { ...rawHand };
    merged[wristKey] = {
      x: (handWrist?.x ?? 0) * (1 - blend) + (poseHand?.x ?? handWrist?.x ?? 0) * blend,
      y: (handWrist?.y ?? 0) * (1 - blend) + (poseHand?.y ?? handWrist?.y ?? 0) * blend,
      z: (handWrist?.z ?? 0) * (1 - blend) + (poseHand?.z ?? handWrist?.z ?? 0) * blend,
      rotationOrder: handWrist?.rotationOrder || poseHand?.rotationOrder || 'XYZ',
    };
    return merged;
  }

  processHand(side, landmarks) {
    const quality = this._handLandmarkQuality(landmarks);
    if (quality < 0.25) return;

    const sideCapital = side === 'left' ? 'Left' : 'Right';
    let rawHand = Kalidokit.Hand.solve(landmarks, sideCapital);
    if (!rawHand) return;

    rawHand = this._mergeHandWithPose(rawHand, side);

    const tm = this._tm();
    const legacy = tm.handStabilization ?? Config.tracking.stabilization;
    const stab = {
      wrist: tm.wristStabilization ?? legacy * 0.85,
      fingers: tm.fingerStabilization ?? legacy * 1.05,
    };
    // Noisier partial hands → smooth more
    if (quality < 0.7) {
      stab.wrist = Math.min(0.75, stab.wrist + 0.12);
      stab.fingers = Math.min(0.8, stab.fingers + 0.1);
    }

    const smoothKey = `${side}Hand`;
    const prev = this.smoothedValues[smoothKey];
    const riggedHand = smoothHand(prev, rawHand, stab);

    this.smoothedValues[smoothKey] = riggedHand;
    this._handHold[side] = { at: performance.now(), data: riggedHand };
    this.avatarRig.rigHand(side, riggedHand, this._lastRiggedPose || this.smoothedValues.pose);
  }
}
