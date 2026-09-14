/**
 * Phoneme-style VRM visemes (aa/ih/ou/ee/oh) from spectral analysis of speech audio.
 * Designed for natural open/close — mouth should not stay wide open for all speech.
 */

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Hann window sample */
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

/**
 * Map spectral features → VRM vowel visemes.
 * Quiet / noisy / fricative frames stay mostly closed.
 */
export function featuresToVisemes(f, intensity = 1) {
  const out = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0, mouthOpen: 0 };
  // Higher gate → silence and soft consonants close the mouth.
  const gate = 0.014;
  if (f.rms < gate) return out;

  const total = f.low + f.mid + f.high + 1e-6;
  const l = f.low / total;
  const m = f.mid / total;
  const h = f.high / total;
  const cent = f.centroid;
  const spread = f.zcr;

  // Energy above silence, compressed so talking doesn't peg mouth open.
  const energy = Math.max(0, f.rms - gate);
  const open = clamp01(Math.pow(energy * 12 * intensity, 0.72));

  // High zero-crossing with modest energy ≈ consonants / sibilants → keep lips tighter.
  const consonant = clamp01(spread * 2.2) * clamp01(1.15 - open);
  const vowelAmt = clamp01(open * (1 - consonant * 0.75));

  const scores = {
    aa: m * 2.4 + (cent > 850 && cent < 2100 ? 0.35 : 0) + open * 0.25,
    ih: h * 2.6 + (cent > 1700 ? 0.45 : 0) + spread * 0.25,
    ee: h * 1.6 + m * 1.2 + (cent > 1300 && cent < 2900 ? 0.35 : 0),
    ou: l * 1.5 + (cent < 1150 ? 0.35 : 0) + (1 - h) * 0.25,
    oh: l * 1.1 + (cent < 850 ? 0.4 : 0),
  };

  let sumS = 0;
  for (const k of Object.keys(scores)) {
    scores[k] = Math.max(0, scores[k]);
    sumS += scores[k];
  }
  if (sumS < 0.02) return out;

  const temp = 2.4;
  for (const k of Object.keys(scores)) {
    scores[k] = Math.exp(Math.log(scores[k] + 1e-6) * temp);
  }
  let norm = 0;
  for (const k of Object.keys(scores)) norm += scores[k];
  norm = Math.max(norm, 1e-6);

  // mouthOpen tracks vowel energy only — not full RMS — so speech isn't always open.
  out.mouthOpen = vowelAmt * 0.55;
  for (const k of Object.keys(scores)) {
    out[k] = clamp01((scores[k] / norm) * vowelAmt * 0.95);
  }

  return out;
}

/**
 * Competitive viseme mix without forcing aa/jaw open from loudness.
 */
export function sharpenVisemes(mouth) {
  const keys = ['aa', 'ih', 'ou', 'ee', 'oh'];
  const open = mouth.mouthOpen ?? Math.max(...keys.map((k) => mouth[k] || 0));
  if (open < 0.025) {
    return { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0, mouthOpen: 0 };
  }

  const bias = { aa: 1.05, ih: 1.1, ee: 1.06, ou: 1.02, oh: 0.95 };
  let best = keys[0];
  let bestV = -1;
  for (const k of keys) {
    const v = (mouth[k] || 0) * (bias[k] || 1);
    if (v > bestV) {
      bestV = v;
      best = k;
    }
  }

  const out = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0, mouthOpen: 0 };
  for (const k of keys) {
    const v = mouth[k] || 0;
    // Stronger winner, quieter runners-up → clearer shapes, less always-open blend.
    out[k] = clamp01(v * (k === best ? 1.08 : 0.22));
  }

  // Jaw/mouthOpen depends on which vowel wins — closed vowels stay tighter.
  if (best === 'aa') {
    out.mouthOpen = clamp01(Math.max(open * 0.65, out.aa * 0.7));
    out.aa = clamp01(Math.max(out.aa, open * 0.35));
  } else if (best === 'ee' || best === 'ih') {
    out.mouthOpen = clamp01(open * 0.28);
  } else {
    // ou / oh — rounded, not wide open
    out.mouthOpen = clamp01(open * 0.22);
  }

  return out;
}

export function lerpVisemes(a, b, t) {
  const keys = ['aa', 'ih', 'ou', 'ee', 'oh', 'mouthOpen'];
  const out = {};
  for (const k of keys) {
    out[k] = (a[k] || 0) + ((b[k] || 0) - (a[k] || 0)) * t;
  }
  return out;
}

/**
 * @param {AudioBuffer} audioBuffer
 * @param {number} intensity
 * @returns {{ t: number, aa: number, ih: number, ou: number, ee: number, oh: number, mouthOpen: number }[]}
 */
export function buildPhonemeTimeline(audioBuffer, intensity = 1) {
  const data = audioBuffer.getChannelData(0);
  const sr = audioBuffer.sampleRate;
  // Slightly finer hops catch open/close of syllables better.
  const hopSec = 0.025;
  const winSec = 0.045;
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

  // Light temporal blur — keep mouthOpen from smearing open across consonants.
  const shapeKeys = ['aa', 'ih', 'ou', 'ee', 'oh'];
  const copy = timeline.map((row) => ({ ...row }));
  for (let i = 1; i < timeline.length - 1; i++) {
    for (const k of shapeKeys) {
      timeline[i][k] =
        copy[i - 1][k] * 0.2 + copy[i][k] * 0.6 + copy[i + 1][k] * 0.2;
    }
    // Prefer closing: if neighbors are quieter, pull mouthOpen down more.
    const mo =
      copy[i - 1].mouthOpen * 0.15 +
      copy[i].mouthOpen * 0.55 +
      copy[i + 1].mouthOpen * 0.15;
    timeline[i].mouthOpen = Math.min(copy[i].mouthOpen, mo);
  }

  return timeline;
}

export function sampleTimeline(timeline, timeSec) {
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

export async function decodeAudioFile(file) {
  const arrayBuffer = await file.arrayBuffer();
  const copy = arrayBuffer.slice(0);
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  try {
    if (ctx.state === 'suspended') await ctx.resume();
    const buffer = await ctx.decodeAudioData(copy);
    return buffer;
  } finally {
    if (ctx.state !== 'closed') await ctx.close().catch(() => {});
  }
}
