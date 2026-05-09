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
    smoothAmount: 0.1,      // Lower = faster response
    positionSmooth: 0.1,
    deadZone: 0.002,        // Minimum movement threshold
    defaultLerpAmount: 0.7, // Bone rotation interpolation

    // If a part hasn't been updated for this long, the rig relaxes
    // those bones toward their rest pose so the avatar doesn't freeze
    // mid-gesture when MediaPipe briefly loses tracking.
    lostTrackingMs: 250,

    // Per-frame relaxation rates (slerp factors) when a part is "lost".
    // Higher = returns to rest faster. Tuned to feel natural at ~30 fps.
    restRelaxRate: {
      bones: 0.06,        // limbs / spine / hips
      fingers: 0.08,      // fingers — slightly snappier so claws unclench
      blendshapes: 0.1    // mouth / blink fade out faster
    },

    // Minimum average MediaPipe visibility for a region to be trusted.
    // When below the threshold, the corresponding rig data is dropped
    // and the bones drift back to rest instead of flailing on noise.
    visibility: {
      legs: 0.5,          // knees + ankles
      arms: 0.5,          // shoulders + elbows + wrists
      // Hips threshold is intentionally low: most users frame their webcam
      // at head/shoulders, so hip landmarks rarely score high. When hips
      // are filtered out, avatarRig falls back to driving Hips rotation
      // from the Spine (which depends on the more-visible shoulders).
      hips: 0.15
    }
  },
  
  // MediaPipe Holistic settings
  holistic: {
    modelComplexity: 1,
    smoothLandmarks: true,
    minDetectionConfidence: 0.7,
    minTrackingConfidence: 0.7,
    refineFaceLandmarks: true
  },
  
  // Scene settings
  scene: {
    backgroundColor: 0x000000,
    floorColor: 0x555555,
    floorSize: 20,
    gridDivisions: 40
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
