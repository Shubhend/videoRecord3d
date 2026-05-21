// Step 5: 3D face model alignment (Jeeliz pose or MediaPipe landmarks).

import {
  followFaceOnCamera,
  holdHeadAtCenter,
  storeFitAnchor,
  applyUserFaceScale,
} from './recordFaceFollow.js';
import { estimateHeadPose } from './headPoseEstimate.js';
import { alignVrmFromJeeliz } from './jeelizVrmAlignment.js';
import {
  applyBodyMeshScale,
  applyHeadMeshScale,
  setRecordUserScales,
  snapRecordRootScale,
} from './vrmHybridFace.js';

/**
 * Align VRM using Jeeliz detectState (preferred on record page).
 */
export function alignVrmFromJeelizDetect(vrm, camera, detectState, options = {}) {
  const ok = alignVrmFromJeeliz(vrm, camera, detectState, {
    ...options,
    useJeelizPose: options.useJeelizPose,
    jeelizScaleW: options.jeelizScaleW,
    jeelizCanvasAspect: options.jeelizCanvasAspect,
  });
  if (options.useJeelizPose) return ok;
  if (vrm?.scene && (options.bodyScale ?? 0) > 0.04) {
    applyBodyMeshScale(vrm, options.bodyScale);
    applyHeadMeshScale(vrm, options.faceScale ?? 1);
  }
  return ok;
}

/**
 * Align VRM using MediaPipe landmarks + Kalidokit rig.
 */
export function alignVrmFaceModel(vrm, camera, landmarks, tracking, options = {}) {
  if (!vrm?.scene || !camera) return false;

  const pose = estimateHeadPose(landmarks);
  if (!landmarks?.length || !pose?.detected) {
    holdHeadAtCenter(vrm, options.faceScale ?? 1, camera);
    return false;
  }

  const ok = followFaceOnCamera(vrm, camera, landmarks, {
    mirror: options.mirror,
    landmarksMirrored: options.landmarksMirrored ?? options.mirror,
    reverseHeadPosition: options.reverseHeadPosition,
    reverseHeadRotation: options.reverseHeadRotation,
    reverseFaceMotion: options.reverseFaceMotion,
    flipAlignX: options.flipAlignX,
    faceScale: options.faceScale,
    alignStrength: options.alignStrength,
    video: options.video,
    viewport: options.viewport,
    frameW: tracking?.captureFrameW ?? 640,
    frameH: tracking?.captureFrameH ?? 480,
  });
  if (vrm?.scene && (options.bodyScale ?? 0) > 0.04) {
    applyBodyMeshScale(vrm, options.bodyScale);
    applyHeadMeshScale(vrm, options.faceScale ?? 1);
  }
  return ok;
}

/**
 * Auto: Jeeliz head pose if available, else MediaPipe landmarks.
 */
export function alignVrmFace(vrm, camera, trackingBundle, options = {}) {
  const ds = trackingBundle?.jeeliz?.lastDetectState;
  if (trackingBundle?.jeeliz?.ready && ds) {
    return alignVrmFromJeeliz(vrm, camera, ds, options);
  }
  return alignVrmFaceModel(
    vrm,
    camera,
    trackingBundle?.mediapipe?.lastFaceLandmarks,
    trackingBundle?.mediapipe,
    options
  );
}

export function applyFaceScale(vrm, faceScale, bodyScale = 0) {
  if (!vrm?.scene) return;
  setRecordUserScales(vrm, faceScale, bodyScale);
  const showBody = bodyScale > 0.04;
  applyBodyMeshScale(vrm, showBody ? bodyScale : 0);
  if (showBody) applyHeadMeshScale(vrm, faceScale);
  snapRecordRootScale(vrm);
}

export { storeFitAnchor, applyUserFaceScale, holdHeadAtCenter };
