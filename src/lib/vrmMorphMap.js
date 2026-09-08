const VRM_MOUTH_TO_ARKIT = {
  aa: ['jawOpen'],
  ih: ['mouthUpperUpLeft', 'mouthUpperUpRight'],
  ou: ['mouthPucker', 'mouthFunnel'],
  ee: ['mouthStretchLeft', 'mouthStretchRight'],
  oh: ['mouthFunnel', 'mouthClose'],
};

const MOUTH_KEYS = ['aa', 'ih', 'ou', 'ee', 'oh', 'mouthOpen'];
const EYE_KEYS = ['lookLeft', 'lookRight', 'lookUp', 'lookDown', 'blinkLeft', 'blinkRight'];
const EXPRESSION_KEYS = ['browRaise', 'frown', 'smile', 'happy', 'sad', 'angry', 'surprised', 'relaxed', 'neutral'];

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function applySetting(value, key, visemeSettings) {
  if (visemeSettings && visemeSettings[key] != null) {
    const s = visemeSettings[key];
    if (s.enabled === false) return 0;
    const amt = s.amount != null ? Number(s.amount) : 1;
    return clamp01(Number(value) * Math.max(0, amt));
  }
  return clamp01(Number(value));
}

export function applyVisemeToVrm(vrm, viseme, {
  intensity = 1,
  mouthEnabled = true,
  eyesEnabled = true,
  expressionsEnabled = true,
  visemeSettings = null,
} = {}) {
  if (!vrm || !vrm.expressionManager) return;
  if (!viseme) return;

  const intMul = Math.max(0, Number(intensity) || 0);

  const setVrm = (name, weight) => {
    try {
      vrm.expressionManager.setValue(name, clamp01(weight));
    } catch {
      /* ignore */
    }
  };

  if (mouthEnabled && intMul > 0) {
    for (const k of MOUTH_KEYS) {
      if (viseme[k] == null) continue;
      const raw = Number(viseme[k]) * intMul;
      const w = applySetting(raw, k, visemeSettings);
      if (k === 'mouthOpen') {
        setVrm('aa', Math.max(vrm.expressionManager.getValue('aa') || 0, w * 0.82));
        setVrm('mouthOpen', w);
      } else {
        setVrm(k, w);
      }
    }
  }

  if (eyesEnabled) {
    for (const k of EYE_KEYS) {
      if (viseme[k] == null) continue;
      const w = applySetting(Number(viseme[k]), k, visemeSettings);
      setVrm(k, w);
    }
  }

  if (expressionsEnabled) {
    for (const k of EXPRESSION_KEYS) {
      if (viseme[k] == null) continue;
      const raw = Number(viseme[k]) * intMul;
      const w = applySetting(raw, k, visemeSettings);
      setVrm(k, w);
    }
  }
}

export function applyFaceLandmarkExtrasToVrm(vrm, extras) {
  if (!vrm || !vrm.expressionManager || !extras) return;

  const setVrm = (name, weight) => {
    try {
      vrm.expressionManager.setValue(name, clamp01(weight));
    } catch {
      /* ignore */
    }
  };

  if (extras.browRaise != null) {
    const v = clamp01(Number(extras.browRaise) * 0.9);
    setVrm('surprised', Math.max(vrm.expressionManager.getValue('surprised') || 0, v));
    setVrm('browRaise', v);
  }

  if (extras.frown != null) {
    const v = clamp01(Number(extras.frown) * 0.8);
    setVrm('angry', Math.max(vrm.expressionManager.getValue('angry') || 0, v));
  }

  if (extras.smile != null) {
    const v = clamp01(Number(extras.smile) * 0.85);
    setVrm('happy', Math.max(vrm.expressionManager.getValue('happy') || 0, v));
  }
}

export { VRM_MOUTH_TO_ARKIT, MOUTH_KEYS, EYE_KEYS, EXPRESSION_KEYS };
