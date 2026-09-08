export const ZERO_VISEME = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0, mouthOpen: 0 };

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function hann(i, n) {
  return 0.5 * (1 - Math.cos((2 * Math.PI * i) / Math.max(1, n - 1)));
}

function analyzeWindow(samples, start, winSize) {
  const n = Math.min(winSize, samples.length - start);
  if (n < 64) {
    return { rms: 0, low: 0, mid: 0, high: 0, centroid: 0, zcr: 0 };
  }

  let sumSq = 0;
  let zcr = 0;
  let prev = samples[start];
  const mags = new Float32Array(64);
  let magSum = 0;

  for (let i = 0; i < n; i++) {
    const w = hann(i, n);
    const v = samples[start + i] * w;
    sumSq += v * v;
    if (i > 0 && (v >= 0) !== (prev >= 0)) zcr++;
    prev = v;
    const bin = Math.min(63, ((i / n) * 63) | 0);
    const av = Math.abs(v);
    mags[bin] += av;
    magSum += av;
  }

  const rms = Math.sqrt(sumSq / n);
  zcr /= n;

  let low = 0;
  let mid = 0;
  let high = 0;
  let centNum = 0;
  for (let b = 0; b < 64; b++) {
    const m = mags[b] / (magSum + 1e-8);
    const hz = (b / 64) * 4000;
    centNum += hz * m;
    if (hz < 700) low += m;
    else if (hz < 2200) mid += m;
    else high += m;
  }

  return { rms, low, mid, high, centroid: centNum, zcr };
}

function featuresToVisemes(f, intensity = 1) {
  const out = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0, mouthOpen: 0 };
  const gate = 0.006;
  if (f.rms < gate) return out;

  const total = f.low + f.mid + f.high + 1e-6;
  const l = f.low / total;
  const m = f.mid / total;
  const h = f.high / total;
  const open = clamp01(Math.pow(f.rms * 14 * intensity, 0.55));
  const cent = f.centroid;
  const spread = f.zcr;

  const scores = {
    aa: m * 2.8 + open * 1.35 + (cent > 850 && cent < 2100 ? 0.45 : 0),
    ih: h * 2.8 + (cent > 1700 ? 0.55 : 0) + spread * 0.45,
    ee: h * 1.7 + m * 1.35 + (cent > 1300 && cent < 2900 ? 0.45 : 0),
    ou: l * 1.35 + (cent < 1150 ? 0.4 : 0) + (1 - h) * 0.3,
    oh: l * 0.95 + (cent < 850 ? 0.35 : 0),
  };

  let maxS = 0;
  let sumS = 0;
  for (const k of Object.keys(scores)) {
    scores[k] = Math.max(0, scores[k]);
    maxS = Math.max(maxS, scores[k]);
    sumS += scores[k];
  }

  if (sumS < 0.02) return out;

  const temp = 2.2;
  for (const k of Object.keys(scores)) {
    scores[k] = Math.exp(Math.log(scores[k] + 1e-6) * temp);
  }
  let norm = 0;
  for (const k of Object.keys(scores)) norm += scores[k];
  norm = Math.max(norm, 1e-6);

  out.mouthOpen = open;
  for (const k of Object.keys(scores)) {
    out[k] = clamp01((scores[k] / norm) * open * 1.15);
  }

  return out;
}

function sharpenVisemes(mouth) {
  const keys = ['aa', 'ih', 'ou', 'ee', 'oh'];
  const open = mouth.mouthOpen ?? Math.max(...keys.map((k) => mouth[k] || 0));
  if (open < 0.04) {
    return { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0, mouthOpen: 0 };
  }
  const bias = { aa: 1.15, ih: 1.12, ee: 1.08, ou: 1.05, oh: 0.55 };
  let best = keys[0];
  let bestV = -1;
  for (const k of keys) {
    const v = (mouth[k] || 0) * (bias[k] || 1);
    if (v > bestV) {
      bestV = v;
      best = k;
    }
  }
  const out = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0, mouthOpen: open };
  for (const k of keys) {
    const v = mouth[k] || 0;
    out[k] = clamp01(v * (k === best ? 1.12 : 0.18));
  }
  out.aa = clamp01(Math.max(out.aa, open * 0.82));
  if (best === 'aa') {
    out.aa = clamp01(Math.max(out.aa, open * 0.92));
  } else if (best !== 'oh' && best !== 'ou') {
    out[best] = clamp01(Math.max(out[best], open * 0.55));
  }
  return out;
}

function lerpVisemes(a, b, t) {
  const keys = ['aa', 'ih', 'ou', 'ee', 'oh', 'mouthOpen'];
  const out = {};
  for (const k of keys) {
    out[k] = (a[k] || 0) + ((b[k] || 0) - (a[k] || 0)) * t;
  }
  return out;
}

function buildPhonemeTimeline(audioBuffer, intensity = 1) {
  const data = audioBuffer.getChannelData(0);
  const sr = audioBuffer.sampleRate;
  const hopSec = 0.04;
  const winSec = 0.06;
  const hop = Math.max(256, Math.floor(sr * hopSec));
  const win = Math.max(512, Math.floor(sr * winSec));
  const timeline = [];

  for (let start = 0; start < data.length; start += hop) {
    const f = analyzeWindow(data, start, win);
    const v = sharpenVisemes(featuresToVisemes(f, intensity));
    timeline.push({ t: start / sr, ...v });
  }

  const endT = audioBuffer.duration;
  if (!timeline.length || timeline[timeline.length - 1].t < endT) {
    timeline.push({ t: endT, aa: 0, ih: 0, ou: 0, ee: 0, oh: 0, mouthOpen: 0 });
  }
  return timeline;
}

function sampleTimeline(timeline, timeSec) {
  if (!timeline?.length) return null;
  const t = Math.max(0, timeSec);
  const last = timeline.length - 1;
  if (t <= timeline[0].t) return timeline[0];
  if (t >= timeline[last].t) return timeline[last];

  let lo = 0;
  let hi = last;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (timeline[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = timeline[lo];
  const b = timeline[hi];
  const span = b.t - a.t || 1e-6;
  const u = (t - a.t) / span;
  return lerpVisemes(a, b, u);
}

function bandEnergy(freqData, fromIdx, toIdx) {
  let sum = 0;
  let n = 0;
  for (let i = Math.max(0, fromIdx); i < Math.min(freqData.length, toIdx); i++) {
    const linear = Math.pow(10, freqData[i] / 20);
    sum += linear;
    n++;
  }
  return n === 0 ? 0 : sum / n;
}

class AudioLipsyncEngine {
  constructor() {
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

    this._intensity = 1.0;
    this._isPlaying = false;
    this._stoppedByUser = false;
    this._playbackOffset = 0;
    this._segmentStartCtxTime = 0;

    this._onEndedCallbacks = [];
  }

  setIntensity(value) {
    this._intensity = Math.max(0, Number(value) || 0);
  }

  static isSupported() {
    return typeof AudioContext !== 'undefined' || typeof window.webkitAudioContext !== 'undefined';
  }

  async load(file) {
    this.dispose();

    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) throw new Error('Web Audio API not supported in this browser.');

    this.audioContext = new Ctx();

    if (this.audioContext.state === 'suspended') {
      try {
        await this.audioContext.resume();
      } catch (e) {
        /* ignore */
      }
    }

    let arrayBuffer;
    try {
      arrayBuffer = await file.arrayBuffer();
    } catch (e) {
      throw new Error('Could not read the audio file.');
    }
    try {
      this.audioBuffer = await new Promise((resolve, reject) => {
        this.audioContext.decodeAudioData(arrayBuffer, resolve, reject);
      });
    } catch (e) {
      throw new Error('Could not decode this audio file. Try MP3, WAV, OGG or M4A.');
    }

    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.6;

    this.gainNode = this.audioContext.createGain();
    this.gainNode.gain.value = 1.0;

    this.streamDestination = this.audioContext.createMediaStreamDestination();

    this.analyser.connect(this.gainNode);
    this.gainNode.connect(this.audioContext.destination);
    this.gainNode.connect(this.streamDestination);

    try {
      this.silentSource = this.audioContext.createConstantSource();
      this.silentSource.offset.value = 0.0001;
      this.silentSource.connect(this.streamDestination);
      this.silentSource.start();
    } catch (e) {
      /* ignore */
    }

    this._freqData = new Float32Array(this.analyser.frequencyBinCount);
    this._timeData = new Float32Array(this.analyser.fftSize);

    return { duration: this.audioBuffer.duration };
  }

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

  pause() {
    if (this._isPlaying) {
      this._playbackOffset = this.getCurrentTime();
    }
    this._haltSource();
  }

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

  computeWeights() {
    if (!this.analyser || !this._isPlaying) {
      const w = this._lastWeights;
      const decay = 0.85;
      w.A *= decay; w.I *= decay; w.U *= decay; w.E *= decay; w.O *= decay; w.mouthOpen *= decay;
      return w;
    }

    this.analyser.getFloatTimeDomainData(this._timeData);
    this.analyser.getFloatFrequencyData(this._freqData);

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

export class AudioLipSync {
  constructor() {
    this._engine = null;
    this._intensity = 1;
    this._phonemeTimeline = null;
    this._timelineIdx = 0;
  }

  static isSupported() {
    return AudioLipsyncEngine.isSupported();
  }

  setIntensity(v) {
    const next = Math.max(0, Number(v) || 0);
    if (Math.abs(next - this._intensity) < 0.001) return;
    this._intensity = next;
    this._engine?.setIntensity(this._intensity);
    if (this._engine?.audioBuffer) {
      this._phonemeTimeline = buildPhonemeTimeline(
        this._engine.audioBuffer,
        this._intensity
      );
    }
  }

  async loadFile(file) {
    if (this._engine) {
      this._engine.dispose();
      this._engine = null;
    }
    this._phonemeTimeline = null;
    this._timelineIdx = 0;
    this._engine = new AudioLipsyncEngine();
    this._engine.setIntensity(this._intensity);
    const { duration } = await this._engine.load(file);

    if (this._engine.audioBuffer) {
      this._phonemeTimeline = buildPhonemeTimeline(
        this._engine.audioBuffer,
        this._intensity
      );
    }

    return { duration, steps: this._phonemeTimeline?.length ?? 0 };
  }

  hasAudio() {
    return !!this._engine?.audioBuffer;
  }

  isPlaying() {
    return !!this._engine?.isPlaying();
  }

  getPlaybackTime() {
    return this._engine?.getCurrentTime() ?? 0;
  }

  async play(fromStart = false) {
    if (!this._engine?.audioBuffer) throw new Error('Load an audio file first');
    if (fromStart) {
      this._engine.stop();
      this._timelineIdx = 0;
    }
    await this._engine.play(fromStart);
  }

  pause() {
    this._engine?.pause();
  }

  stop() {
    this._engine?.stop();
    this._timelineIdx = 0;
  }

  dispose() {
    this._engine?.dispose();
    this._engine = null;
    this._phonemeTimeline = null;
    this._timelineIdx = 0;
  }

  _samplePhonemeFast(timeSec) {
    const timeline = this._phonemeTimeline;
    if (!timeline?.length) return null;

    const t = Math.max(0, timeSec);
    let i = this._timelineIdx;
    if (i >= timeline.length) i = timeline.length - 1;
    if (timeline[i].t > t) i = 0;

    while (i + 1 < timeline.length && timeline[i + 1].t <= t) i++;
    this._timelineIdx = i;

    if (i >= timeline.length - 1) return timeline[timeline.length - 1];
    const a = timeline[i];
    const b = timeline[i + 1];
    const span = b.t - a.t || 1e-6;
    const u = (t - a.t) / span;
    return {
      aa: a.aa + (b.aa - a.aa) * u,
      ih: a.ih + (b.ih - a.ih) * u,
      ou: a.ou + (b.ou - a.ou) * u,
      ee: a.ee + (b.ee - a.ee) * u,
      oh: a.oh + (b.oh - a.oh) * u,
      mouthOpen: a.mouthOpen + (b.mouthOpen - a.mouthOpen) * u,
    };
  }

  sampleCurrent() {
    if (!this._engine) return ZERO_VISEME;

    const mouth = this._samplePhonemeFast(this.getPlaybackTime());
    if (mouth) return mouth;

    const w = this._engine.computeWeights();
    return {
      aa: w.A,
      ih: w.I,
      ou: w.U,
      ee: w.E,
      oh: w.O,
      mouthOpen: w.mouthOpen,
    };
  }
}
