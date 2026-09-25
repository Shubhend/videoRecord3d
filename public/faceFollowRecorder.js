import { pickFaceRecordMime, ensureMp4Blob, downloadFaceVideo } from './faceFollowMp4Export.js';

/** Export resolutions for device presets (used by record + download). */
export const RECORD_DEVICES = {
  auto: null,
  phone: { w: 1080, h: 1920, label: 'phone' },
  'phone-landscape': { w: 1920, h: 1080, label: 'phone-landscape' },
  tablet: { w: 1200, h: 1600, label: 'tablet' },
  'tablet-landscape': { w: 1600, h: 1200, label: 'tablet-landscape' },
  desktop: { w: 1920, h: 1080, label: 'desktop' },
  'desktop-2k': { w: 2560, h: 1440, label: 'desktop-2k' },
  square: { w: 1080, h: 1080, label: 'square' },
};

export function resolveRecordSize(deviceKey, fallbackW, fallbackH) {
  const preset = RECORD_DEVICES[deviceKey];
  if (!preset) {
    return {
      w: Math.max(2, Math.floor(fallbackW) || 1280),
      h: Math.max(2, Math.floor(fallbackH) || 720),
      label: 'auto',
    };
  }
  return { w: preset.w, h: preset.h, label: preset.label };
}

export class FaceRecorder {
  constructor() {
    this.composite = document.createElement('canvas');
    this.ctx = this.composite.getContext('2d');
    this.recorder = null;
    this.chunks = [];
    this.state = 'idle';
    this.startTime = 0;
    this._mime = 'video/mp4';
    this._bgImage = null;
    this._lastW = 0;
    this._lastH = 0;
    this.onConvertProgress = null;
  }

  static supported() {
    return (
      typeof MediaRecorder !== 'undefined' &&
      typeof HTMLCanvasElement.prototype.captureStream === 'function'
    );
  }

  setBackdropImage(img) {
    this._bgImage = img;
  }

  paintFrame(video, glCanvas, background, w, h) {
    if (w !== this._lastW || h !== this._lastH) {
      this.composite.width = w;
      this.composite.height = h;
      this._lastW = w;
      this._lastH = h;
    }
    const ctx = this.ctx;
    ctx.clearRect(0, 0, w, h);

    const cfg = background?.config || { mode: 'camera' };
    if (cfg.mode === 'color' || cfg.mode === 'image') {
      background?.draw(ctx, w, h);
    } else {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);
    }

    if (video?.videoWidth > 0) {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const scale = Math.max(w / vw, h / vh);
      const dw = vw * scale;
      const dh = vh * scale;
      const dx = (w - dw) / 2;
      const dy = (h - dh) / 2;
      ctx.save();
      if (cfg.mode === 'blur') {
        ctx.filter = `blur(${cfg.blurPx || 12}px)`;
      }
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, dx, dy, dw, dh);
      ctx.restore();
      ctx.filter = 'none';
    }

    if (glCanvas?.width > 0) {
      const cw = glCanvas.width;
      const ch = glCanvas.height;
      const scale = Math.max(w / cw, h / ch);
      const dw = cw * scale;
      const dh = ch * scale;
      const dx = (w - dw) / 2;
      const dy = (h - dh) / 2;
      ctx.drawImage(glCanvas, dx, dy, dw, dh);
    }
  }

  async start(audioStream = null) {
    if (!FaceRecorder.supported()) throw new Error('Recording not supported');
    if (this.state === 'recording') return;

    const stream = this.composite.captureStream(30);
    if (audioStream) {
      audioStream.getAudioTracks().forEach((t) => stream.addTrack(t));
    }
    const hasAudio = stream.getAudioTracks().length > 0;
    const mimeType = pickFaceRecordMime(hasAudio);
    const opts = { videoBitsPerSecond: 5_000_000 };
    if (hasAudio) opts.audioBitsPerSecond = 128_000;
    if (mimeType) opts.mimeType = mimeType;

    this.chunks = [];
    this.recorder = new MediaRecorder(stream, opts);
    this._mime = this.recorder.mimeType || mimeType || 'video/webm';
    this.recorder.ondataavailable = (e) => {
      if (e.data?.size) this.chunks.push(e.data);
    };
    this.recorder.start(1000);
    this.state = 'recording';
    this.startTime = performance.now();
  }

  pause() {
    if (this.recorder?.state === 'recording') {
      this.recorder.pause();
      this.state = 'paused';
    }
  }

  resume() {
    if (this.recorder?.state === 'paused') {
      this.recorder.resume();
      this.state = 'recording';
    }
  }

  async stop() {
    const raw = await new Promise((resolve) => {
      if (!this.recorder || this.recorder.state === 'inactive') {
        this.state = 'idle';
        return resolve(null);
      }
      this.recorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: this._mime });
        this.state = 'idle';
        this.recorder = null;
        resolve(blob);
      };
      this.recorder.stop();
    });
    if (!raw) return null;
    return ensureMp4Blob(raw, (pct) => this.onConvertProgress?.(pct));
  }

  download(blob, filename = 'face-follow') {
    downloadFaceVideo(blob, filename);
  }
}
