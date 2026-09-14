/**
 * Audio lip-sync for face-follow: Web Audio playback + pre-baked phoneme timeline.
 */
import { AudioLipsync } from './js/audioLipsync.js';
import { buildPhonemeTimeline, sampleTimeline } from './faceFollowPhonemeViseme.js';
import { getLipSyncLerp } from './faceFollowAppSettings.js';

const ZERO = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0, mouthOpen: 0 };

export class AudioLipSync {
  constructor() {
    this._engine = null;
    this.enabled = false;
    this.active = false;
    this._intensity = 1;
    this._phonemeTimeline = null;
    this._timelineIdx = 0;
    this._smoothMouth = { ...ZERO };
  }

  static isSupported() {
    return AudioLipsync.isSupported();
  }

  setIntensity(value) {
    const next = Math.max(0, Number(value) || 0);
    if (Math.abs(next - this._intensity) < 0.001) return;
    this._intensity = next;
    this._engine?.setIntensity(this._intensity);
    if (this._engine?.audioBuffer) {
      this._phonemeTimeline = buildPhonemeTimeline(
        this._engine.audioBuffer,
        this._intensity
      );
      this._seekTimelineIndex(this._engine.getCurrentTime());
    }
  }

  async loadFile(file) {
    if (this._engine) {
      this._engine.dispose();
      this._engine = null;
    }
    this._phonemeTimeline = null;
    this._timelineIdx = 0;
    this._engine = new AudioLipsync();
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

  _seekTimelineIndex(timeSec) {
    const timeline = this._phonemeTimeline;
    if (!timeline?.length) {
      this._timelineIdx = 0;
      return;
    }
    const t = Math.max(0, timeSec);
    let i = 0;
    while (i + 1 < timeline.length && timeline[i + 1].t <= t) i++;
    this._timelineIdx = i;
  }

  async play(fromStart = false) {
    if (!this._engine?.audioBuffer) throw new Error('Load an audio file first');
    if (fromStart) {
      this._engine.stop();
      this._timelineIdx = 0;
      this._smoothMouth = { ...ZERO };
    } else {
      this._seekTimelineIndex(this._engine.getCurrentTime());
    }
    this.enabled = true;
    this.active = true;
    await this._engine.play(fromStart);
  }

  pause() {
    this._engine?.pause();
    this.active = false;
    this._seekTimelineIndex(this.getPlaybackTime());
  }

  async resume() {
    if (!this._engine?.audioBuffer) return;
    this.enabled = true;
    this.active = true;
    this._seekTimelineIndex(this._engine.getCurrentTime());
    await this._engine.play(false);
  }

  stop() {
    this._engine?.stop();
    this.active = false;
    this._timelineIdx = 0;
    this._smoothMouth = { ...ZERO };
  }

  getCaptureStream() {
    return this._engine?.getStream() ?? null;
  }

  getRecordAudioStream() {
    return this.getCaptureStream();
  }

  onEnded(cb) {
    this._engine?.onEnded(cb);
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

  getMouthWeights() {
    if (!this.enabled || !this._engine) {
      this._smoothMouth = { ...ZERO };
      return ZERO;
    }

    let mouth = this._samplePhonemeFast(this.getPlaybackTime());
    if (!mouth) {
      const w = this._engine.computeWeights();
      mouth = {
        aa: w.A,
        ih: w.I,
        ou: w.U,
        ee: w.E,
        oh: w.O,
        mouthOpen: w.mouthOpen,
      };
    }

    // EMA — close faster than open so lips don't stay gaping between syllables.
    const baseLerp = Math.max(0.08, Math.min(0.5, getLipSyncLerp() * 1.15));
    const s = this._smoothMouth;
    for (const k of Object.keys(ZERO)) {
      const target = mouth[k] || 0;
      const lerp = target < s[k] ? Math.min(0.55, baseLerp * 1.85) : baseLerp;
      s[k] = s[k] + (target - s[k]) * lerp;
      if (s[k] < 0.012) s[k] = 0;
    }
    return { ...s };
  }

  dispose() {
    this._engine?.dispose();
    this._engine = null;
    this._phonemeTimeline = null;
    this._timelineIdx = 0;
    this._smoothMouth = { ...ZERO };
    this.active = false;
  }
}
