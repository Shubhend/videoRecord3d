// Record page pipeline:
//   Webcam → Face Detection → Face Landmark Tracking → Head Pose Estimation
//   → 3D Face Model Alignment → Render Overlay (WebGL)

import { getSettings } from './settingsStore.js';
import { estimateHeadPose } from './headPoseEstimate.js';

export const PIPELINE_STAGES = [
  'webcam',
  'detection',
  'landmarks',
  'headPose',
  'alignment',
  'webgl',
];

/** Rig settings for record: face/head only. */
export function getRecordRigSettings(useJeelizPose = false, trackingReverse = {}) {
  const s = getSettings();
  const headSens = Math.min(0.85, (s.sensitivity?.head ?? 1) * 0.55);
  return {
    ...s,
    trackingReverse: {
      headRotation: trackingReverse.reverseHeadRotation === true,
      faceMotion: trackingReverse.reverseFaceMotion === true,
    },
    sensitivity: {
      ...s.sensitivity,
      head: headSens,
    },
    enabled: {
      ...s.enabled,
      head: !useJeelizPose,
      mouth: true,
      eyes: true,
      pupils: false,
      hips: false,
      spine: false,
      leftArm: false,
      rightArm: false,
      leftLeg: false,
      rightLeg: false,
      leftHand: false,
      rightHand: false,
      fingers: false,
      distance: false,
      autoRelax: true,
      audioLipSync: false,
    },
  };
}

/**
 * @param {import('./recordFaceOverlay.js').RecordFaceOverlay | null} overlay
 */
export function getPipelineStatus(overlay) {
  const videoOk = overlay?.video?.readyState >= 2;
  const useJeeliz = overlay?.trackingBackend === 'jeeliz' && overlay?.jeelizTracking?.ready;
  const ds = overlay?.jeelizTracking?.lastDetectState;
  const landmarks = overlay?.tracking?.lastFaceLandmarks;
  const faceDetected = useJeeliz
    ? overlay?.jeelizTracking?.faceDetected === true
    : overlay?.tracking?.faceDetected === true;
  const landmarksOk = useJeeliz
    ? !!(ds && (ds.detected ?? 0) > 0.5)
    : !!(landmarks && landmarks.length > 10);
  const pose = landmarksOk && !useJeeliz ? estimateHeadPose(landmarks) : null;
  const headPoseOk = useJeeliz
    ? landmarksOk && ds && Number.isFinite(ds.rx)
    : !!(pose?.detected && pose.confidence > 0.3);
  const kalidokit = useJeeliz
    ? landmarksOk
    : !!overlay?.tracking?.smoothedValues?.face;
  const threejs = !!overlay?.vrm?.scene;
  const mesh = overlay?.vrm ? overlay.getVisibleMeshCount?.() ?? 0 : 0;
  const rendered =
    overlay?.enabled &&
    overlay?.lastRenderAt > 0 &&
    Date.now() - overlay.lastRenderAt < 5000;
  const webglOk = rendered && mesh > 0;
  const detectionOk = videoOk && faceDetected;
  const headPoseStageOk = headPoseOk && kalidokit;
  const alignmentOk =
    webglOk && headPoseOk && overlay?.lastAlignedAt > 0 && Date.now() - overlay.lastAlignedAt < 5000;

  return {
    webcam: videoOk,
    detection: detectionOk,
    landmarks: landmarksOk,
    headPose: headPoseStageOk,
    alignment: alignmentOk,
    webgl: webglOk,
    visibleMeshes: mesh,
    trackingReady: landmarksOk && headPoseStageOk,
    allReady:
      videoOk &&
      detectionOk &&
      landmarksOk &&
      headPoseStageOk &&
      alignmentOk &&
      webglOk,
  };
}

const STAGE_LABELS = {
  webcam: 'Webcam',
  detection: 'Face detection',
  landmarks: 'Face landmark tracking',
  headPose: 'Head pose estimation',
  alignment: '3D face model alignment',
  webgl: 'Render overlay (WebGL)',
};

export function formatPipelineLabel(stage, ok) {
  return `${ok ? '✓' : '…'} ${STAGE_LABELS[stage] || stage}`;
}

export function pipelineStatusText(status) {
  const meshNote =
    status.visibleMeshes != null ? ` (${status.visibleMeshes} meshes)` : '';
  return [
    formatPipelineLabel('webcam', status.webcam),
    formatPipelineLabel('detection', status.detection),
    formatPipelineLabel('landmarks', status.landmarks),
    formatPipelineLabel('headPose', status.headPose),
    formatPipelineLabel('alignment', status.alignment),
    `${status.webgl ? '✓' : '…'} ${STAGE_LABELS.webgl}${meshNote}`,
  ].join('\n');
}

/** @deprecated */
export function getRecordRigSettingsFromPipeline() {
  return getRecordRigSettings();
}
