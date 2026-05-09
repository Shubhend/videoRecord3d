// ==================== CANVAS RECORDER ====================
// Captures the live WebGL canvas (and optionally an audio MediaStream) into
// a WebM video file using the browser's MediaRecorder API. No upload, no
// server — encoding happens locally in the browser.

// MIME types that include both a video AND an audio codec. We use these
// when the user is recording with audio so the encoder doesn't silently
// drop the audio track. MP4/H.264/AAC is preferred when available because
// the resulting file plays natively in macOS QuickTime, iOS, Windows,
// and most consumer apps without re-encoding.
const VIDEO_AUDIO_MIME_TYPES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4;codecs=h264,aac',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=h264,opus',
  'video/webm',
];

// Video-only fallback MIME types.
const VIDEO_ONLY_MIME_TYPES = [
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

function extensionFor(mimeType) {
  if (!mimeType) return 'webm';
  if (mimeType.includes('mp4')) return 'mp4';
  return 'webm';
}

function pickMimeType(hasAudio) {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = hasAudio ? VIDEO_AUDIO_MIME_TYPES : VIDEO_ONLY_MIME_TYPES;
  for (const t of candidates) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

export class CanvasRecorder {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {Object} [options]
   * @param {number} [options.fps=30]
   * @param {number} [options.videoBitsPerSecond] Override default bitrate.
   * @param {number} [options.audioBitsPerSecond] Audio bitrate when recording with audio.
   * @param {(elapsedMs:number)=>void} [options.onTick] Called ~10x/sec while recording.
   */
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.fps = options.fps ?? 30;
    this.videoBitsPerSecond = options.videoBitsPerSecond ?? 6_000_000; // 6 Mbps
    this.audioBitsPerSecond = options.audioBitsPerSecond ?? 128_000; // 128 kbps Opus
    this.onTick = options.onTick || null;

    this.recorder = null;
    this.chunks = [];
    this.startTime = 0;
    this.tickInterval = null;
    this._extraAudioStreams = [];
  }

  static isSupported() {
    return (
      typeof MediaRecorder !== 'undefined' &&
      typeof HTMLCanvasElement !== 'undefined' &&
      typeof HTMLCanvasElement.prototype.captureStream === 'function'
    );
  }

  /**
   * Add an audio MediaStream (e.g. from HTMLAudioElement.captureStream() or
   * an AudioContext destination) to be muxed into the recording.
   * Must be called before start().
   */
  addAudioStream(stream) {
    if (!stream) {
      console.warn('[Recorder] addAudioStream called without a stream');
      return;
    }
    const tracks = stream.getAudioTracks();
    console.info('[Recorder] addAudioStream', {
      streamId: stream.id,
      streamActive: stream.active,
      audioTracks: tracks.length,
      trackInfo: tracks.map((t) => ({
        id: t.id,
        kind: t.kind,
        label: t.label,
        enabled: t.enabled,
        muted: t.muted,
        readyState: t.readyState,
      })),
    });
    this._extraAudioStreams.push(stream);
  }

  isRecording() {
    return !!this.recorder && this.recorder.state === 'recording';
  }

  async start() {
    if (this.isRecording()) return;
    if (!CanvasRecorder.isSupported()) {
      throw new Error('Recording is not supported in this browser.');
    }

    const videoStream = this.canvas.captureStream(this.fps);
    const combined = new MediaStream();
    videoStream.getVideoTracks().forEach((t) => combined.addTrack(t));

    let hasAudio = false;
    this._extraAudioStreams.forEach((stream, i) => {
      const tracks = stream.getAudioTracks();
      console.info('[Recorder] processing extra stream', i, {
        audioTracks: tracks.length,
        streamActive: stream.active,
      });
      tracks.forEach((t) => {
        combined.addTrack(t);
        hasAudio = true;
      });
    });

    if (this._extraAudioStreams.length > 0 && !hasAudio) {
      console.error(
        '[Recorder] Extra audio stream(s) were registered but contained no ' +
          'audio tracks. Recording will be silent.'
      );
    }

    const mimeType = pickMimeType(hasAudio);
    const opts = { videoBitsPerSecond: this.videoBitsPerSecond };
    if (hasAudio) opts.audioBitsPerSecond = this.audioBitsPerSecond;
    if (mimeType) opts.mimeType = mimeType;

    // Diagnostic — visible in browser DevTools Console. Helpful when
    // tracking down "the recording has no audio" issues. Shows how many
    // video and audio tracks were actually included in the stream that
    // the recorder is encoding.
    console.info(
      '[Recorder] start',
      JSON.stringify({
        mimeType: mimeType || '(default)',
        videoTracks: combined.getVideoTracks().length,
        audioTracks: combined.getAudioTracks().length,
        videoBitsPerSecond: this.videoBitsPerSecond,
        audioBitsPerSecond: hasAudio ? this.audioBitsPerSecond : 0,
      })
    );

    this.recorder = new MediaRecorder(combined, opts);
    this._mimeType = this.recorder.mimeType || mimeType || 'video/webm';
    this._fileExt = extensionFor(this._mimeType);
    this.chunks = [];
    this.recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };

    this.startTime = performance.now();
    this.recorder.start(1000); // request a chunk every second so memory stays bounded

    if (this.onTick) {
      this.tickInterval = setInterval(() => {
        this.onTick(performance.now() - this.startTime);
      }, 100);
    }
  }

  /**
   * Stop recording. Resolves to a Blob containing the encoded video.
   */
  stop() {
    return new Promise((resolve) => {
      if (!this.recorder || this.recorder.state === 'inactive') {
        if (this.tickInterval) {
          clearInterval(this.tickInterval);
          this.tickInterval = null;
        }
        return resolve(null);
      }
      this.recorder.onstop = () => {
        if (this.tickInterval) {
          clearInterval(this.tickInterval);
          this.tickInterval = null;
        }
        const type = this.recorder.mimeType || this._mimeType || 'video/webm';
        const blob = new Blob(this.chunks, { type });
        // Stamp the file extension onto the blob so callers can pick the
        // right filename suffix.
        blob._ext = this._fileExt || extensionFor(type);
        console.info(
          '[Recorder] stop',
          JSON.stringify({
            type,
            sizeBytes: blob.size,
            chunks: this.chunks.length,
          })
        );
        this.chunks = [];
        this.recorder = null;
        this._extraAudioStreams = [];
        resolve(blob);
      };
      this.recorder.stop();
    });
  }

  /** Get the file extension that matches the current recording format. */
  getFileExtension() {
    return this._fileExt || 'webm';
  }

  /**
   * Trigger a browser download of a blob.
   */
  static downloadBlob(blob, filename = 'edge-ai-recording.webm') {
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

export function formatDuration(ms) {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
