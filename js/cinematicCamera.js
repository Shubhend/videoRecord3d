// Saved camera director — session anchor from frame 0, match current view on start.

import { getSettings } from './settingsStore.js';
import { listCameras } from './cameraStore.js';
import {
  resolveWorldPose,
  cloneAnchor,
  resolveAnchorForSession,
  findBestMatchingShot,
} from './cameraPoseMath.js';

const _desiredPos = new THREE.Vector3();
const _desiredTarget = new THREE.Vector3();
const _homePos = new THREE.Vector3();
const _homeTarget = new THREE.Vector3();
const _resolveAnchor = {
  position: new THREE.Vector3(),
  quaternion: new THREE.Quaternion(),
  rootPosition: new THREE.Vector3(),
  rootQuaternion: new THREE.Quaternion(),
};

export class CinematicCamera {
  /**
   * @param {import('./sceneSetup.js').SceneSetup} sceneSetup
   * @param {() => { position: THREE.Vector3, quaternion: THREE.Quaternion }} getAnchor
   */
  constructor(sceneSetup, getAnchor) {
    this.sceneSetup = sceneSetup;
    this.getAnchor = getAnchor;
    this.active = false;
    this._controlsWereEnabled = true;
    this._shots = [];
    this._current = null;
    this._shotTimer = 0;
    this._nextShotDuration = 5;
    this._silenceTimer = 0;
    this._wasSpeaking = false;
    this._smoothedPos = new THREE.Vector3();
    this._smoothedTarget = new THREE.Vector3();
    this._initialized = false;
    this._holdShot = null;
    this._targetFov = 50;
    /** @type {ReturnType<typeof cloneAnchor> | null} */
    this._sessionAnchor = null;
  }

  async refreshShots() {
    try {
      this._shots = await listCameras();
    } catch (e) {
      console.warn('Could not load saved cameras:', e);
      this._shots = [];
    }
    return this._shots.length;
  }

  shouldRun(ctx) {
    const c = getSettings().camera || {};
    if (c.enabled === false) return false;
    if (!this._shots.length) return false;
    if (ctx.audioPlaying && c.autoOnAudio !== false) return true;
    if (ctx.recording && c.autoOnRecord !== false) return true;
    if (c.autoOnLive) return true;
    return false;
  }

  /** Lock character placement / rotation from the first frame of this session. */
  _beginSession() {
    const live = this.getAnchor();
    this._sessionAnchor = cloneAnchor(live);
  }

  /**
   * Re-snapshot the character at recording frame 0 (e.g. after audio already started).
   * Keeps the same saved camera shot; only refreshes the anchor baseline.
   */
  relockSessionAnchor() {
    if (!this.active) return;
    this._beginSession();
    this._resolveCurrentTargets();
    this._snapCameraToTarget();
  }

  _getResolveAnchor() {
    const live = this.getAnchor();
    return resolveAnchorForSession(live, this._sessionAnchor, _resolveAnchor);
  }

  start() {
    if (this.active) return true;
    if (!this._shots.length) return false;

    const { camera, controls } = this.sceneSetup;
    if (!camera) return false;

    const cfg = getSettings().camera || {};
    const changeMode = cfg.changeMode || 'random';

    this._beginSession();

    this.active = true;
    this._controlsWereEnabled = controls?.enabled !== false;
    if (controls) {
      _homePos.copy(camera.position);
      _homeTarget.copy(controls.target);
      controls.enabled = false;
    }

    const anchor = this._getResolveAnchor();
    const initialShot = findBestMatchingShot(this._shots, this.sceneSetup, anchor);

    if (changeMode === 'hold') {
      this._holdShot = initialShot;
      this._current = this._holdShot;
    } else {
      this._holdShot = null;
      this._pickNextShotDuration();
      this._current = initialShot;
    }

    this._shotTimer = 0;
    this._silenceTimer = 0;
    this._wasSpeaking = false;
    this._initialized = false;

    this._resolveCurrentTargets();
    this._snapCameraToTarget();

    return true;
  }

  /** Jump to resolved pose so frame 0 matches what the user framed. */
  _snapCameraToTarget() {
    const { camera, controls } = this.sceneSetup;
    if (!camera) return;

    camera.position.copy(_desiredPos);
    if (controls) controls.target.copy(_desiredTarget);
    camera.lookAt(_desiredTarget);
    if (this._targetFov) {
      camera.fov = this._targetFov;
      camera.updateProjectionMatrix();
    }
    this._smoothedPos.copy(_desiredPos);
    this._smoothedTarget.copy(_desiredTarget);
    this._initialized = true;
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    this._current = null;
    this._holdShot = null;
    this._sessionAnchor = null;
    const { controls } = this.sceneSetup;
    if (controls) controls.enabled = this._controlsWereEnabled;
  }

  releaseControls() {
    if (this.active) this.stop();
  }

  update(delta, speechLevel = 0, liveIdle = false) {
    if (!this.active || !this._current) return;

    const cfg = getSettings().camera || {};
    const changeMode = cfg.changeMode || 'random';
    const { camera, controls } = this.sceneSetup;
    if (!camera) return;

    this._resolveCurrentTargets();

    if (changeMode === 'random' && !liveIdle) {
      this._maybeCutShot(delta, speechLevel, cfg);
    }

    const smooth = Math.max(0.03, Math.min(0.25, Number(cfg.smoothness ?? 0.06)));
    const alpha = 1 - Math.pow(1 - smooth, Math.min(delta * 60, 2));

    if (!this._initialized) {
      this._smoothedPos.copy(_desiredPos);
      this._smoothedTarget.copy(_desiredTarget);
      this._initialized = true;
    } else {
      this._smoothedPos.lerp(_desiredPos, alpha);
      this._smoothedTarget.lerp(_desiredTarget, alpha);
    }

    camera.position.copy(this._smoothedPos);
    if (controls) {
      controls.target.copy(this._smoothedTarget);
    }
    camera.lookAt(this._smoothedTarget);

    if (this._targetFov && Math.abs(camera.fov - this._targetFov) > 0.1) {
      camera.fov += (this._targetFov - camera.fov) * alpha;
      camera.updateProjectionMatrix();
    }
  }

  _resolveCurrentTargets() {
    const anchor = this._getResolveAnchor();
    if (!resolveWorldPose(this._current, anchor, _desiredPos, _desiredTarget)) {
      return;
    }
    this._targetFov = this._current?.fov ?? 50;
  }

  _maybeCutShot(delta, speechLevel, cfg) {
    this._shotTimer += delta;

    const useSpeech = cfg.useSpeechCuts !== false;
    const speaking = speechLevel > (cfg.speechThreshold ?? 0.028);
    if (speaking) {
      this._silenceTimer = 0;
      this._wasSpeaking = true;
    } else if (this._wasSpeaking) {
      this._silenceTimer += delta;
    }

    const minDur = Number(cfg.shotMinSec ?? 4);
    const maxDur = Number(cfg.shotMaxSec ?? 9);
    const silenceCut =
      useSpeech && this._silenceTimer > (cfg.silenceGapSec ?? 0.5);
    const timedCut = this._shotTimer >= this._nextShotDuration;

    if (!timedCut && !silenceCut) return;

    this._current = this._pickRandomShot();
    this._shotTimer = 0;
    this._silenceTimer = 0;
    this._wasSpeaking = speaking;
    this._pickNextShotDuration(minDur, maxDur);
  }

  _pickNextShotDuration(min = 4, max = 9) {
    const cfg = getSettings().camera || {};
    const lo = Number(cfg.shotMinSec ?? min);
    const hi = Number(cfg.shotMaxSec ?? max);
    this._nextShotDuration = lo + Math.random() * Math.max(1, hi - lo);
  }

  _pickRandomShot() {
    if (this._shots.length === 1) return this._shots[0];
    let next;
    let tries = 0;
    do {
      next = this._shots[Math.floor(Math.random() * this._shots.length)];
      tries++;
    } while (next.id === this._current?.id && this._shots.length > 1 && tries < 8);
    return next;
  }
}
