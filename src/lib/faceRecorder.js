let _ffmpeg = null;

function extensionFor(mimeType) {
  if (!mimeType) return 'webm';
  return mimeType.includes('mp4') ? 'mp4' : 'webm';
}

export function pickFaceRecordMime(hasAudio) {
  if (typeof MediaRecorder === 'undefined') return null;
  const types = hasAudio
    ? [
        'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
        'video/mp4;codecs=h264,aac',
        'video/mp4',
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm',
      ]
    : [
        'video/mp4;codecs=avc1.42E01E',
        'video/mp4',
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm',
      ];
  for (const t of types) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return null;
}

async function loadFfmpeg(onProgress) {
  if (_ffmpeg?.loaded) return _ffmpeg;
  const { FFmpeg } = await import(
    'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/+esm'
  );
  const { fetchFile, toBlobURL } = await import(
    'https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/+esm'
  );
  const ffmpeg = new FFmpeg();
  ffmpeg.on('progress', ({ progress }) => {
    onProgress?.(Math.round((progress || 0) * 100));
  });
  const base = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm';
  await ffmpeg.load({
    coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
  });
  _ffmpeg = { ffmpeg, fetchFile, loaded: true };
  return _ffmpeg;
}

export async function ensureMp4Blob(webmOrMp4Blob, onProgress) {
  if (!webmOrMp4Blob) return null;
  if (webmOrMp4Blob.type.includes('mp4')) return webmOrMp4Blob;
  try {
    onProgress?.(0);
    const { ffmpeg, fetchFile } = await loadFfmpeg(onProgress);
    await ffmpeg.writeFile('input.webm', await fetchFile(webmOrMp4Blob));
    await ffmpeg.exec(['-i', 'input.webm', '-c:v', 'libx264', '-preset', 'fast', '-c:a', 'aac', 'output.mp4']);
    const data = await ffmpeg.readFile('output.mp4');
    await ffmpeg.deleteFile('input.webm');
    await ffmpeg.deleteFile('output.mp4');
    return new Blob([data], { type: 'video/mp4' });
  } catch (err) {
    console.warn('[face-follow] MP4 transcode failed:', err);
    return webmOrMp4Blob;
  }
}

export function downloadFaceVideo(blob, filename = 'face-follow') {
  if (!blob) return;
  const ext = extensionFor(blob.type);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${filename}.${ext}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
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

  paintFrame(video, glCanvas, backgroundControllerInstance, w, h) {
    if (w !== this._lastW || h !== this._lastH) {
      this.composite.width = w;
      this.composite.height = h;
      this._lastW = w;
      this._lastH = h;
    }
    const ctx = this.ctx;
    ctx.clearRect(0, 0, w, h);

    const bg = backgroundControllerInstance;
    const cfg = bg?.config || { mode: 'camera' };
    const hideCamera = bg?.shouldShowCamera?.() === false;
    const screenPip = bg?.isScreenPipMode?.() === true;
    const customBg = hideCamera || cfg.mode === 'color' || cfg.mode === 'image' || cfg.mode === 'screen';

    if (customBg) {
      bg?.draw(ctx, w, h);
    } else {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);
    }

    if (screenPip && video?.videoWidth > 0) {
      bg.drawCameraPip(ctx, video, w, h);
    } else if (!hideCamera && video?.videoWidth > 0) {
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

    if (screenPip && glCanvas?.width > 0) {
      bg.drawGlCanvasPip(ctx, glCanvas, w, h);
    } else if (!screenPip && glCanvas?.width > 0) {
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
