// Head pose estimation from MediaPipe face landmarks (468 points).

const _d = { x: 0, y: 0 };

function pt(lm, i) {
  const p = lm?.[i];
  if (!p) return null;
  return p;
}

function sub(a, b, out = _d) {
  out.x = a.x - b.x;
  out.y = a.y - b.y;
  return out;
}

/**
 * Estimate head pose + face center from landmarks (normalized 0–1 on capture frame).
 * @param {object[]|null} landmarks
 * @returns {null | {
 *   detected: boolean,
 *   center: { x: number, y: number },
 *   rotation: { yaw: number, pitch: number, roll: number },
 *   confidence: number,
 *   eyeDistance: number,
 *   faceHeight: number,
 * }}
 */
export function estimateHeadPose(landmarks) {
  if (!landmarks || landmarks.length < 300) return null;

  const le = pt(landmarks, 33);
  const re = pt(landmarks, 263);
  const nose = pt(landmarks, 1) || pt(landmarks, 4);
  const chin = pt(landmarks, 152) || pt(landmarks, 175);
  const forehead = pt(landmarks, 10);
  if (!nose || !le || !re) return null;

  const cx = (le.x + re.x) * 0.5;
  const cy =
    forehead && chin
      ? (forehead.y + chin.y) * 0.5
      : (nose.y + le.y + re.y) / 3;

  const eyeDist = Math.hypot(le.x - re.x, le.y - re.y) || 0.16;
  const faceH =
    forehead && chin ? Math.abs(forehead.y - chin.y) : eyeDist * 1.35;

  // Roll: tilt of the eye line (radians)
  const roll = Math.atan2(re.y - le.y, re.x - le.x);

  // Yaw: nose horizontal offset from eye midpoint
  const yaw = THREE.MathUtils.clamp((nose.x - cx) / Math.max(eyeDist, 0.08), -1, 1) * 0.85;

  // Pitch: nose vertical offset within face box
  let pitch = 0;
  if (forehead && chin) {
    const midY = (forehead.y + chin.y) * 0.5;
    pitch = THREE.MathUtils.clamp((nose.y - midY) / Math.max(faceH, 0.08), -1, 1) * 0.7;
  } else {
    pitch = THREE.MathUtils.clamp((nose.y - cy) / Math.max(eyeDist, 0.08), -1, 1) * 0.5;
  }

  const vis = [le, re, nose].filter((p) => (p.visibility ?? 1) > 0.5).length;
  const confidence = vis / 3;

  return {
    detected: true,
    center: { x: cx, y: cy },
    rotation: { yaw, pitch, roll },
    confidence,
    eyeDistance: eyeDist,
    faceHeight: faceH,
  };
}
