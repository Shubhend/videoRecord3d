// Avatar-relative camera poses — rooted at character placement, session-locked on record.

const _v3a = new THREE.Vector3();
const _v3b = new THREE.Vector3();
const _v3c = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qInv = new THREE.Quaternion();

/** Default face/chest pivot height in model local Y (metres). */
const PIVOT_Y = 1.35;

/**
 * Stable anchor: character root position + root rotation + chest pivot.
 * (Head bone is avoided — it moves with tracking and skews saved angles.)
 *
 * @param {object} vrm
 * @returns {{
 *   position: THREE.Vector3,
 *   quaternion: THREE.Quaternion,
 *   rootPosition: THREE.Vector3,
 *   rootQuaternion: THREE.Quaternion,
 * }}
 */
export function getAvatarAnchor(vrm) {
  const rootPosition = new THREE.Vector3(1, 0, 0);
  const rootQuaternion = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();

  if (!vrm?.scene) {
    position.copy(rootPosition);
    position.y = PIVOT_Y;
    quaternion.identity();
    return { position, quaternion, rootPosition, rootQuaternion };
  }

  vrm.scene.getWorldPosition(rootPosition);
  vrm.scene.getWorldQuaternion(rootQuaternion);

  quaternion.copy(rootQuaternion);
  position.copy(rootPosition);
  const sy = vrm.scene.scale?.y ?? 1;
  _v3a.set(0, PIVOT_Y * sy, 0);
  _v3a.applyQuaternion(rootQuaternion);
  position.add(_v3a);

  return { position, quaternion, rootPosition, rootQuaternion };
}

export function cloneAnchor(anchor) {
  return {
    position: anchor.position.clone(),
    quaternion: anchor.quaternion.clone(),
    rootPosition: anchor.rootPosition.clone(),
    rootQuaternion: anchor.rootQuaternion.clone(),
  };
}

/**
 * During a recording/audio session: keep the rotation from frame 0,
 * only slide the pivot when the character root moves (e.g. distance Z).
 */
export function resolveAnchorForSession(live, session, out) {
  if (!session) {
    out.position.copy(live.position);
    out.quaternion.copy(live.quaternion);
    out.rootPosition.copy(live.rootPosition);
    out.rootQuaternion.copy(live.rootQuaternion);
    return out;
  }

  _v3a.copy(live.rootPosition).sub(session.rootPosition);
  out.position.copy(session.position).add(_v3a);
  out.quaternion.copy(session.quaternion);
  out.rootPosition.copy(session.rootPosition).add(_v3a);
  out.rootQuaternion.copy(session.rootQuaternion);
  return out;
}

function worldToLocal(worldVec, anchor) {
  _v3a.copy(worldVec).sub(anchor.position);
  _qInv.copy(anchor.quaternion).invert();
  _v3a.applyQuaternion(_qInv);
  return { x: _v3a.x, y: _v3a.y, z: _v3a.z };
}

function localToWorld(local, anchor, out) {
  _v3a.set(local.x, local.y, local.z);
  _v3a.applyQuaternion(anchor.quaternion);
  return out.copy(anchor.position).add(_v3a);
}

/**
 * Capture camera offsets from the character root at the current placement.
 */
export function captureRelativePose(sceneSetup, vrm) {
  const { camera, controls } = sceneSetup;
  if (!camera) throw new Error('Scene not ready');

  const anchor = getAvatarAnchor(vrm);
  const targetWorld = controls?.target
    ? _v3c.copy(controls.target)
    : anchor.position.clone();

  return {
    version: 2,
    localCam: worldToLocal(camera.position, anchor),
    localTarget: worldToLocal(targetWorld, anchor),
    fov: camera.fov,
    captureRoot: {
      x: anchor.rootPosition.x,
      y: anchor.rootPosition.y,
      z: anchor.rootPosition.z,
    },
  };
}

export function resolveWorldPose(shot, anchor, outPos, outTarget) {
  if (shot?.version >= 2 && shot.localCam && shot.localTarget) {
    localToWorld(shot.localCam, anchor, outPos);
    localToWorld(shot.localTarget, anchor, outTarget);
    return true;
  }

  if (shot?.position && shot?.target) {
    outPos.set(shot.position.x, shot.position.y, shot.position.z);
    outTarget.set(shot.target.x, shot.target.y, shot.target.z);
    return true;
  }

  return false;
}

/**
 * Pick the saved view closest to what is on screen now (same framing user set up).
 */
export function findBestMatchingShot(shots, sceneSetup, anchor) {
  if (!shots?.length) return null;
  const { camera, controls } = sceneSetup;
  if (!camera) return shots[0];

  const curPos = camera.position;
  const curTarget = controls?.target ? _v3c.copy(controls.target) : anchor.position;

  let best = shots[0];
  let bestScore = Infinity;

  for (const shot of shots) {
    if (!resolveWorldPose(shot, anchor, _v3a, _v3b)) continue;
    const score =
      curPos.distanceToSquared(_v3a) +
      curTarget.distanceToSquared(_v3b) * 0.35 +
      Math.abs((shot.fov ?? 50) - camera.fov) * 0.02;
    if (score < bestScore) {
      bestScore = score;
      best = shot;
    }
  }

  return best;
}
