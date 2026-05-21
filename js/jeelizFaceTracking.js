// Jeeliz Face Filter — webcam face detection, tracking, head pose.
// @see https://github.com/jeeliz/jeelizFaceFilter

const JEELIZ_SCRIPT =
  'https://cdn.jsdelivr.net/gh/jeeliz/jeelizFaceFilter@master/dist/jeelizFaceFilter.js';
const JEELIZ_NNC =
  'https://cdn.jsdelivr.net/gh/jeeliz/jeelizFaceFilter@master/neuralNets/';

let _scriptPromise = null;

export function isJeelizAvailable() {
  return typeof JEELIZFACEFILTER !== 'undefined';
}

/** Load Jeeliz script once (CDN). */
export function loadJeelizScript() {
  if (isJeelizAvailable()) return Promise.resolve();
  if (_scriptPromise) return _scriptPromise;

  _scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-jeeliz-facefilter]');
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Jeeliz script failed')));
      return;
    }
    const s = document.createElement('script');
    s.src = JEELIZ_SCRIPT;
    s.crossOrigin = 'anonymous';
    s.dataset.jeelizFacefilter = '1';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load Jeeliz Face Filter'));
    document.head.appendChild(s);
  });
  return _scriptPromise;
}

function waitForVideo(video) {
  const ready = () =>
    video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0;
  if (ready()) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      if (ready()) resolve();
    };
    video.addEventListener('loadeddata', done, { once: true });
    video.addEventListener('loadedmetadata', done, { once: true });
    setTimeout(resolve, 4000);
  });
}

/**
 * Face detection + tracking + head pose via Jeeliz (uses hidden canvas + your video).
 */
export class JeelizFaceTracking {
  /**
   * @param {HTMLVideoElement} video
   * @param {{ onStatus?: (msg: string) => void, onTrack?: (detectState: object) => void }} [hooks]
   */
  constructor(video, hooks = {}) {
    this.video = video;
    this.onStatus = hooks.onStatus || (() => {});
    this.onTrack = hooks.onTrack || (() => {});
    this.canvasId = 'jeeliz-canvas';
    this.ready = false;
    this.faceDetected = false;
    this.lastDetectState = null;
    this.lastFaceLandmarks = null;
    this.smoothedValues = { face: null };
    this.captureFrameW = 512;
    this.captureFrameH = 512;
  }

  async init() {
    await loadJeelizScript();
    await waitForVideo(this.video);
    if (this.video.paused) {
      try {
        await this.video.play();
      } catch {
        // ignore
      }
    }

    const canvas = document.getElementById(this.canvasId);
    if (!canvas) {
      throw new Error('Jeeliz canvas #jeeliz-canvas not found');
    }

    return new Promise((resolve, reject) => {
      JEELIZFACEFILTER.init({
        canvasId: this.canvasId,
        NNCPath: JEELIZ_NNC,
        maxFacesDetected: 1,
        followZRot: true,
        videoSettings: {
          videoElement: this.video,
        },
        callbackReady: (errCode) => {
          if (errCode) {
            reject(new Error(`Jeeliz init failed: ${errCode}`));
            return;
          }
          this.ready = true;
          this.onStatus('Jeeliz face tracking ready');
          resolve();
        },
        callbackTrack: (detectState) => {
          this.lastDetectState = detectState;
          const d = detectState?.detected ?? 0;
          this.faceDetected = d > 0.55;
          if (this.faceDetected) {
            this.smoothedValues.face = { head: { x: detectState.rx, y: detectState.ry, z: detectState.rz } };
            this.onStatus(`Face ✓ (${Math.round(d * 100)}%)`);
          } else {
            this.onStatus('Searching for face…');
          }
          this.onTrack(detectState);
        },
      });
    });
  }

  resize(w, h) {
    const canvas = document.getElementById(this.canvasId);
    if (!canvas) return;
    const W = Math.max(64, Math.round(w || 512));
    const H = Math.max(64, Math.round(h || 512));
    canvas.width = W;
    canvas.height = H;
    this.captureFrameW = W;
    this.captureFrameH = H;
    if (this.ready && typeof JEELIZFACEFILTER !== 'undefined') {
      JEELIZFACEFILTER.resize();
    }
  }

  async dispose() {
    this.ready = false;
    this.lastDetectState = null;
    this.faceDetected = false;
    if (typeof JEELIZFACEFILTER !== 'undefined') {
      try {
        await JEELIZFACEFILTER.destroy();
      } catch {
        // ignore
      }
    }
  }
}
