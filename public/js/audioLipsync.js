// ==================== AUDIO LIP SYNC ====================
// Generates viseme weights (A/I/U/E/O + mouth open) from a playing audio
// file, using formant-style frequency-band analysis. Runs entirely in the
// browser via the Web Audio API.
//
// IMPORTANT: This implementation decodes the audio file into an AudioBuffer
// and plays it via an AudioBufferSourceNode (NOT an HTMLAudioElement). This
// matters when combining with MediaRecorder: the resulting audio flows
// fully through Web Audio's graph, so the MediaStreamDestination's track
// always carries real samples and gets reliably embedded into the recorded
// .webm/.mp4 file. Mixing HTMLAudioElement + Web Audio + MediaRecorder is
// fragile across browsers and was producing video files with no audio.

export class AudioLipsync {
  constructor() {
    this.audioContext = null;
    this.audioBuffer = null;
    this.bufferSource = null; // current AudioBufferSourceNode (one-shot)
    this.analyser = null;
    this.gainNode = null;
    this.streamDestination = null; // optional: for capturing into recorder
    this.silentSource = null;      // belt-and-braces: keeps stream "live"

    this._freqData = null;
    this._timeData = null;
    this._lastWeights = { A: 0, I: 0, U: 0, E: 0, O: 0, mouthOpen: 0 };

    this._intensity = 1.0;
    this._isPlaying = false;
    this._stoppedByUser = false;
    /** Seconds into the clip; updated on pause, used to resume. */
    this._playbackOffset = 0;
    this._segmentStartCtxTime = 0;

    this._onEndedCallbacks = [];
  }

  /**
   * Scale the audio-driven mouth motion. Range typically 0..3.
   */
  setIntensity(value) {
    this._intensity = Math.max(0, Number(value) || 0);
  }

  static isSupported() {
    return typeof AudioContext !== 'undefined' || typeof window.webkitAudioContext !== 'undefined';
  }

  /**
   * Decode the audio file and build the persistent Web Audio graph.
   * Must be called before play(). Caller should be inside a user-gesture
   * context so the AudioContext can resume.
   */
  async load(file) {
    this.dispose();

    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) throw new Error('Web Audio API not supported in this browser.');

    this.audioContext = new Ctx();

    // Resume eagerly while we're still in a user gesture. Without this the
    // audio graph stays suspended and the stream destination produces no
    // samples — which causes MediaRecorder to omit the audio track entirely.
    if (this.audioContext.state === 'suspended') {
      try {
        await this.audioContext.resume();
      } catch (e) {
        // Will be retried in play(); not fatal.
      }
    }

    // Decode the entire audio file into an AudioBuffer.
    let arrayBuffer;
    try {
      arrayBuffer = await file.arrayBuffer();
    } catch (e) {
      throw new Error('Could not read the audio file.');
    }
    try {
      this.audioBuffer = await new Promise((resolve, reject) => {
        // decodeAudioData supports both Promise and callback styles; use the
        // callback form so older Safari builds work too.
        this.audioContext.decodeAudioData(arrayBuffer, resolve, reject);
      });
    } catch (e) {
      throw new Error(
        'Could not decode this audio file. Try MP3, WAV, OGG or M4A.'
      );
    }

    // Persistent graph (source nodes are created per-play in play()):
    //   bufferSource -> analyser -> gain -> destination (speakers)
    //                                    \-> streamDestination (recorder)
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.6;

    this.gainNode = this.audioContext.createGain();
    this.gainNode.gain.value = 1.0;

    this.streamDestination = this.audioContext.createMediaStreamDestination();

    this.analyser.connect(this.gainNode);
    this.gainNode.connect(this.audioContext.destination);
    this.gainNode.connect(this.streamDestination);

    // Belt-and-braces keep-alive node. Pumps a tiny periodic signal into the
    // stream destination so the audio MediaStreamTrack is never considered
    // "inactive". The amplitude is well below the noise floor (effectively
    // inaudible) but ensures non-zero samples flow continuously.
    try {
      this.silentSource = this.audioContext.createConstantSource();
      // Use 1e-4 (≈ -80dB) instead of 0 — some browsers detect "all zero"
      // streams as idle and drop the track from the recording.
      this.silentSource.offset.value = 0.0001;
      this.silentSource.connect(this.streamDestination);
      this.silentSource.start();
    } catch (e) {
      console.warn('Silent keep-alive source unavailable:', e);
    }

    this._freqData = new Float32Array(this.analyser.frequencyBinCount);
    this._timeData = new Float32Array(this.analyser.fftSize);

    return { duration: this.audioBuffer.duration };
  }

  /**
   * Start or resume playback. AudioBufferSourceNode is one-shot — each play()
   * creates a new source, optionally offset into the buffer.
   * @param {boolean} fromStart — if true, always start at 0:00
   */
  async play(fromStart = false) {
    if (!this.audioBuffer || !this.audioContext) {
      throw new Error('No audio loaded.');
    }
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    if (fromStart) {
      this._playbackOffset = 0;
    }

    const offset = Math.min(
      this.audioBuffer.duration,
      Math.max(0, this._playbackOffset)
    );
    this._playbackOffset = offset;

    this._haltSource();

    this.bufferSource = this.audioContext.createBufferSource();
    this.bufferSource.buffer = this.audioBuffer;
    this.bufferSource.connect(this.analyser);

    this._stoppedByUser = false;
    this._isPlaying = true;
    this._segmentStartCtxTime = this.audioContext.currentTime;

    this.bufferSource.onended = () => {
      this._isPlaying = false;
      if (this._stoppedByUser) return;
      this._playbackOffset = this.audioBuffer.duration;
      this._onEndedCallbacks.forEach((cb) => {
        try { cb(); } catch (e) { console.error(e); }
      });
    };

    this.bufferSource.start(0, offset);
  }

  /** Pause and remember position for resume(). */
  pause() {
    if (this._isPlaying) {
      this._playbackOffset = this.getCurrentTime();
    }
    this._haltSource();
  }

  /** Stop and reset to the beginning. */
  stop() {
    this._playbackOffset = 0;
    this._haltSource();
  }

  _haltSource() {
    this._stoppedByUser = true;
    if (this.bufferSource) {
      try { this.bufferSource.stop(); } catch (e) {}
      try { this.bufferSource.disconnect(); } catch (e) {}
      this.bufferSource = null;
    }
    this._isPlaying = false;
  }

  isPlaying() {
    return this._isPlaying;
  }

  /** Current playback position in seconds (while playing or after pause). */
  getCurrentTime() {
    if (!this.audioBuffer) return 0;
    if (!this._isPlaying || !this.audioContext) {
      return Math.min(this.audioBuffer.duration, Math.max(0, this._playbackOffset));
    }
    const elapsed = this.audioContext.currentTime - this._segmentStartCtxTime;
    return Math.min(
      this.audioBuffer.duration,
      Math.max(0, this._playbackOffset + elapsed)
    );
  }

  /**
   * RMS loudness 0..~0.35 for cinematic camera paragraph detection.
   */
  getSpeechLevel() {
    if (!this.analyser || !this._timeData || !this._isPlaying) return 0;
    this.analyser.getFloatTimeDomainData(this._timeData);
    let sumSq = 0;
    for (let i = 0; i < this._timeData.length; i++) {
      const v = this._timeData[i];
      sumSq += v * v;
    }
    return Math.sqrt(sumSq / this._timeData.length);
  }

  /** Returns a MediaStream of the audio (for muxing into a recorder). */
  getStream() {
    return this.streamDestination?.stream || null;
  }

  onEnded(cb) {
    this._onEndedCallbacks.push(cb);
  }

  /** Replace any previous end listener. Pass null to clear. */
  setOnEnded(cb) {
    this._onEndedCallbacks = cb ? [cb] : [];
  }

  /**
   * Sample the analyser and produce viseme weights.
   * Must be called every frame while audio is playing.
   * @returns {{A:number,I:number,U:number,E:number,O:number,mouthOpen:number}}
   */
  computeWeights() {
    if (!this.analyser || !this._isPlaying) {
      // Decay to silence
      const w = this._lastWeights;
      const decay = 0.85;
      w.A *= decay; w.I *= decay; w.U *= decay; w.E *= decay; w.O *= decay; w.mouthOpen *= decay;
      return w;
    }

    this.analyser.getFloatTimeDomainData(this._timeData);
    this.analyser.getFloatFrequencyData(this._freqData); // dB values

    // RMS over time-domain samples → mouth open intensity. Real-world
    // speech rarely hits an RMS above ~0.2, so we boost aggressively and
    // apply a soft curve to keep peaks from saturating.
    let sumSq = 0;
    let peak = 0;
    for (let i = 0; i < this._timeData.length; i++) {
      const v = this._timeData[i];
      sumSq += v * v;
      const av = v < 0 ? -v : v;
      if (av > peak) peak = av;
    }
    const rms = Math.sqrt(sumSq / this._timeData.length);
    const rawOpen = (rms * 9.0 + peak * 1.5) * this._intensity;
    const mouthOpen = clamp01(Math.pow(Math.max(0, rawOpen), 0.7));

    const sampleRate = this.audioContext.sampleRate;
    const binHz = sampleRate / 2 / this._freqData.length;
    const idxLow = Math.floor(600 / binHz);
    const idxMid = Math.floor(1800 / binHz);
    const idxHigh = Math.floor(3500 / binHz);

    const lowEnergy = bandEnergy(this._freqData, 0, idxLow);
    const midEnergy = bandEnergy(this._freqData, idxLow, idxMid);
    const highEnergy = bandEnergy(this._freqData, idxMid, idxHigh);
    const total = lowEnergy + midEnergy + highEnergy + 1e-6;

    const lowR = lowEnergy / total;
    const midR = midEnergy / total;
    const highR = highEnergy / total;

    const target = {
      A: clamp01(midR * 1.6),
      I: clamp01(highR * 1.5),
      E: clamp01(highR * 1.0),
      U: clamp01(lowR * 1.1),
      O: clamp01(lowR * 1.6),
      mouthOpen,
    };

    target.A *= mouthOpen;
    target.I *= mouthOpen;
    target.E *= mouthOpen;
    target.U *= mouthOpen;
    target.O *= mouthOpen;

    const lerp = 0.45;
    const w = this._lastWeights;
    w.A += (target.A - w.A) * lerp;
    w.I += (target.I - w.I) * lerp;
    w.U += (target.U - w.U) * lerp;
    w.E += (target.E - w.E) * lerp;
    w.O += (target.O - w.O) * lerp;
    w.mouthOpen += (target.mouthOpen - w.mouthOpen) * lerp;
    return w;
  }

  dispose() {
    if (this.bufferSource) {
      try { this.bufferSource.stop(); } catch (e) {}
      try { this.bufferSource.disconnect(); } catch (e) {}
    }
    try { this.analyser?.disconnect(); } catch (e) {}
    try { this.gainNode?.disconnect(); } catch (e) {}
    try { this.streamDestination?.disconnect(); } catch (e) {}
    try { this.silentSource?.stop(); } catch (e) {}
    try { this.silentSource?.disconnect(); } catch (e) {}
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close().catch(() => {});
    }
    this.audioContext = null;
    this.audioBuffer = null;
    this.bufferSource = null;
    this.analyser = null;
    this.gainNode = null;
    this.streamDestination = null;
    this.silentSource = null;
    this._freqData = null;
    this._timeData = null;
    this._lastWeights = { A: 0, I: 0, U: 0, E: 0, O: 0, mouthOpen: 0 };
    this._isPlaying = false;
    this._stoppedByUser = false;
    this._playbackOffset = 0;
    this._segmentStartCtxTime = 0;
    this._onEndedCallbacks = [];
  }
}

function bandEnergy(freqData, fromIdx, toIdx) {
  let sum = 0;
  let n = 0;
  for (let i = Math.max(0, fromIdx); i < Math.min(freqData.length, toIdx); i++) {
    // Convert dB → linear-ish amplitude. -100 dB → ~0; 0 dB → 1.
    const linear = Math.pow(10, freqData[i] / 20);
    sum += linear;
    n++;
  }
  return n === 0 ? 0 : sum / n;
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
