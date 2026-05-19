// ==================== CONFIGURATION ====================
// Central configuration for the avatar application

export const Config = {
  // VRM Model URL (original version - optimized has Draco)
  vrmUrl: 'models/AliciaSolid.vrm',
  
  // Camera settings
  camera: {
    width: 640,
    height: 480,
    facingMode: 'user'
  },
  
  // Tracking sensitivity
  tracking: {
    /** 0..1 temporal smoothing before rig (higher = less flicker). */
    stabilization: 0.55,
    positionSmooth: 0.1,
    deadZone: 0.003,
    defaultLerpAmount: 0.28,

    lostTrackingMs: 450,

    restRelaxRate: {
      bones: 0.045,
      fingers: 0.06,
      blendshapes: 0.08,
    },

    visibility: {
      legs: 0.42,
      arms: 0.38,
      hips: 0.12,
    },
  },
  
  // MediaPipe Holistic settings (overridden by settings.trackingMedia when set)
  holistic: {
    modelComplexity: 1,
    smoothLandmarks: true,
    minDetectionConfidence: 0.72,
    minTrackingConfidence: 0.72,
    refineFaceLandmarks: true,
  },
  
  // Scene settings
  scene: {
    backgroundColor: 0x000000,
    floorColor: 0x555555,
    floorSize: 1,
    gridDivisions: 10
  },
  
  // Lighting settings
  lighting: {
    directional: { color: 0xffffff, intensity: 0.7 },
    front: { color: 0xffffff, intensity: 0.4 },
    ambient: { color: 0xffffff, intensity: 0.5 },
    back: { color: 0x6699cc, intensity: 0.3 }
  },
  
  // Stars settings
  stars: {
    count: 1000,
    size: 0.1
  }
};
