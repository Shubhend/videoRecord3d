// Records the live webcam MediaStream via MediaRecorder (pause / resume / stop).

import { extensionFor } from './recorder.js';

const MIME_TYPES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=h264,opus',
  'video/webm',
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4',
];

function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const t of MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

export class WebcamRecorder {
  /**
   * @param {HTMLVideoElement} videoElement — live preview
   * @param {{ onTick?: (elapsedMs: number) => void, videoBitsPerSecond?: number }} [options]
   */
  constructor(videoElement, options = {}) {
    this.video = videoElement;
    this.onTick = options.onTick || null;
    this.videoBitsPerSecond = options.videoBitsPerSecond ?? 2_500_000;
    this.stream = null;
    this.recorder = null;
    this.chunks = [];
    this._mimeType = '';
    this._fileExt = 'webm';
    this.startTime = 0;
    this.pausedAccum = 0;
    this.pauseStarted = 0;
    this.tickInterval = null;
    this.lastBlob = null;
  }

  static isSupported() {
    return typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  }

  static supportsPauseResume() {
    return (
      typeof MediaRecorder !== 'undefined' &&
      typeof MediaRecorder.prototype.pause === 'function' &&
      typeof MediaRecorder.prototype.resume === 'function'
    );
  }

  get state() {
    return this.recorder?.state || 'inactive';
  }

  isRecording() {
    return this.state === 'recording';
  }

  isPaused() {
    return this.state === 'paused';
  }

  isActive() {
    return this.state === 'recording' || this.state === 'paused';
  }

  getElapsedMs() {
    if (!this.isActive() && !this.startTime) return 0;
    let elapsed = performance.now() - this.startTime - this.pausedAccum;
    if (this.isPaused() && this.pauseStarted) {
      elapsed -= performance.now() - this.pauseStarted;
    }
    return Math.max(0, elapsed);
  }

  /**
   * @param {MediaStreamConstraints} [constraints]
   */
  async startCamera(constraints = { video: { facingMode: 'user', width: 1280, height: 720 }, audio: true }) {
    this.stopCamera();
    this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    this.video.srcObject = this.stream;
    const playPromise = this.video.play?.();
    if (playPromise?.catch) await playPromise.catch(() => {});
    return this.stream;
  }

  stopCamera() {
    if (this.isActive()) {
      try {
        this.recorder?.stop();
      } catch {
        // ignore
      }
    }
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    this.video.srcObject = null;
    this.recorder = null;
    this.chunks = [];
    this.startTime = 0;
    this.pausedAccum = 0;
    this.pauseStarted = 0;
  }

  /**
   * @param {{ compositeCanvas?: HTMLCanvasElement, fps?: number }} [options]
   *   When compositeCanvas is set, records that canvas (e.g. webcam + VRM face) plus mic audio.
   */
  startRecording(options = {}) {
    if (!this.stream) throw new Error('Camera is not running');
    if (this.isActive()) throw new Error('Already recording');

    const mimeType = pickMimeType();
    const opts = { videoBitsPerSecond: this.videoBitsPerSecond };
    if (mimeType) opts.mimeType = mimeType;

    let recordStream = this.stream;
    const composite = options.compositeCanvas;
    if (composite?.captureStream) {
      const fps = options.fps ?? 30;
      const videoStream = composite.captureStream(fps);
      const videoTrack = videoStream.getVideoTracks()[0];
      const audioTracks = this.stream.getAudioTracks();
      recordStream = new MediaStream([videoTrack, ...audioTracks]);
    }

    this.recorder = new MediaRecorder(recordStream, opts);
    this._mimeType = this.recorder.mimeType || mimeType || 'video/webm';
    this._fileExt = extensionFor(this._mimeType);
    this.chunks = [];
    this.lastBlob = null;

    this.recorder.ondataavailable = (e) => {
      if (e.data?.size > 0) this.chunks.push(e.data);
    };

    this.recorder.start(1000);
    this.startTime = performance.now();
    this.pausedAccum = 0;
    this.pauseStarted = 0;

    if (this.onTick) {
      this.tickInterval = setInterval(() => {
        if (this.isActive()) this.onTick(this.getElapsedMs());
      }, 100);
    }
  }

  pauseRecording() {
    if (!this.isRecording()) throw new Error('Not recording');
    if (!WebcamRecorder.supportsPauseResume()) {
      throw new Error('Pause is not supported in this browser');
    }
    this.recorder.pause();
    this.pauseStarted = performance.now();
  }

  resumeRecording() {
    if (!this.isPaused()) throw new Error('Not paused');
    this.pausedAccum += performance.now() - this.pauseStarted;
    this.pauseStarted = 0;
    this.recorder.resume();
  }

  /**
   * @returns {Promise<Blob|null>}
   */
  stopRecording() {
    return new Promise((resolve) => {
      if (!this.recorder || this.recorder.state === 'inactive') {
        if (this.tickInterval) {
          clearInterval(this.tickInterval);
          this.tickInterval = null;
        }
        return resolve(this.lastBlob);
      }

      this.recorder.onstop = () => {
        if (this.tickInterval) {
          clearInterval(this.tickInterval);
          this.tickInterval = null;
        }
        const type = this.recorder?.mimeType || this._mimeType || 'video/webm';
        const blob = this.chunks.length
          ? new Blob(this.chunks, { type })
          : null;
        this.chunks = [];
        this.recorder = null;
        this.startTime = 0;
        this.pausedAccum = 0;
        this.pauseStarted = 0;
        this.lastBlob = blob;
        resolve(blob);
      };

      try {
        this.recorder.stop();
      } catch (e) {
        this.recorder = null;
        resolve(null);
      }
    });
  }

  getFileExtension() {
    return this._fileExt || 'webm';
  }

  static downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
