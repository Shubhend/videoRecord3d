/** Per-expression enable + amount (0–2). */
export const EXPR_SETTINGS_KEY = 'faceFollowExprSettings_v1';

export const EXPRESSION_DEFS = [
  { key: 'blinkLeft', label: 'Blink left', group: 'Eyes' },
  { key: 'blinkRight', label: 'Blink right', group: 'Eyes' },
  { key: 'blink', label: 'Blink (both)', group: 'Eyes' },
  { key: 'lookUp', label: 'Look up', group: 'Eyes' },
  { key: 'lookDown', label: 'Look down', group: 'Eyes' },
  { key: 'lookLeft', label: 'Look left', group: 'Eyes' },
  { key: 'lookRight', label: 'Look right', group: 'Eyes' },
  { key: 'aa', label: 'Mouth open (A)', group: 'Mouth' },
  { key: 'ih', label: 'Mouth I', group: 'Mouth' },
  { key: 'ou', label: 'Mouth O/U', group: 'Mouth' },
  { key: 'ee', label: 'Mouth E', group: 'Mouth' },
  { key: 'oh', label: 'Mouth closed (O)', group: 'Mouth' },
  { key: 'happy', label: 'Smile / happy', group: 'Emotion' },
  { key: 'sad', label: 'Sad / frown', group: 'Emotion' },
  { key: 'angry', label: 'Angry', group: 'Emotion' },
  { key: 'surprised', label: 'Surprised', group: 'Emotion' },
  { key: 'relaxed', label: 'Relaxed', group: 'Emotion' },
  { key: 'neutral', label: 'Neutral', group: 'Emotion' },
];

export function defaultExprSettings() {
  const out = {};
  for (const d of EXPRESSION_DEFS) {
    out[d.key] = { enabled: true, amount: 1 };
  }
  return out;
}

export function loadExprSettings() {
  try {
    const raw = localStorage.getItem(EXPR_SETTINGS_KEY);
    if (!raw) return defaultExprSettings();
    const parsed = JSON.parse(raw);
    const base = defaultExprSettings();
    for (const key of Object.keys(base)) {
      if (parsed[key]) {
        base[key] = {
          enabled: parsed[key].enabled !== false,
          amount: Math.max(0, Math.min(5, Number(parsed[key].amount) || 1)),
        };
      }
    }
    return base;
  } catch {
    return defaultExprSettings();
  }
}

export function saveExprSettings(settings) {
  try {
    localStorage.setItem(EXPR_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}

/** ARKit blendshape name → panel key (for morph targets + tuning). */
export const ARKIT_TO_EXPR_KEY = {
  eyeBlinkLeft: 'blinkLeft',
  eyeBlinkRight: 'blinkRight',
  eyeLookUpLeft: 'lookUp',
  eyeLookUpRight: 'lookUp',
  eyeLookDownLeft: 'lookDown',
  eyeLookDownRight: 'lookDown',
  eyeLookOutLeft: 'lookLeft',
  eyeLookInRight: 'lookLeft',
  eyeLookInLeft: 'lookRight',
  eyeLookOutRight: 'lookRight',
  jawOpen: 'aa',
  mouthClose: 'oh',
  mouthUpperUpLeft: 'ih',
  mouthUpperUpRight: 'ih',
  mouthPucker: 'ou',
  mouthFunnel: 'ou',
  mouthStretchLeft: 'ee',
  mouthStretchRight: 'ee',
  mouthLeft: 'ee',
  mouthRight: 'ee',
  mouthSmileLeft: 'happy',
  mouthSmileRight: 'happy',
  mouthFrownLeft: 'sad',
  mouthFrownRight: 'sad',
  browDownLeft: 'angry',
  browDownRight: 'angry',
  eyeSquintLeft: 'angry',
  eyeSquintRight: 'angry',
  browInnerUp: 'surprised',
  eyeWideLeft: 'surprised',
  eyeWideRight: 'surprised',
};

export function exprGainForArkit(arkitName, settings, globalIntensity = 1) {
  const key = ARKIT_TO_EXPR_KEY[arkitName];
  if (!key) return globalIntensity;
  const s = settings[key] || { enabled: true, amount: 1 };
  if (!s.enabled) return 0;
  return Math.max(0, (Number(s.amount) || 1) * globalIntensity);
}

export function applyExprMultiplier(weights, settings, globalIntensity = 1) {
  const out = {};
  for (const [name, w] of Object.entries(weights)) {
    const s = settings[name] || { enabled: true, amount: 1 };
    if (!s.enabled) {
      out[name] = 0;
      continue;
    }
    const gain = (Number(s.amount) || 1) * globalIntensity;
    out[name] = Math.min(5, Math.max(0, w * gain));
  }
  return out;
}

export function mountExpressionPanel(containerEl, settings, onChange) {
  if (!containerEl) return;
  containerEl.innerHTML = '';
  let lastGroup = '';
  for (const def of EXPRESSION_DEFS) {
    if (def.group !== lastGroup) {
      lastGroup = def.group;
      const h = document.createElement('h4');
      h.className = 'expr-group';
      h.textContent = def.group;
      containerEl.appendChild(h);
    }
    const row = document.createElement('div');
    row.className = 'expr-row';
    const s = settings[def.key] || { enabled: true, amount: 1 };
    row.innerHTML = `
      <label class="toggle expr-toggle">
        <input type="checkbox" data-expr-en="${def.key}" ${s.enabled ? 'checked' : ''} />
        ${def.label}
      </label>
      <input type="number" class="expr-amt" data-expr-amt="${def.key}"
        min="0" max="5" step="0.05" value="${s.amount}" />
    `;
    containerEl.appendChild(row);
  }
  containerEl.querySelectorAll('[data-expr-en]').forEach((el) => {
    el.addEventListener('change', () => {
      const key = el.dataset.exprEn;
      settings[key].enabled = el.checked;
      saveExprSettings(settings);
      onChange?.();
    });
  });
  containerEl.querySelectorAll('[data-expr-amt]').forEach((el) => {
    const apply = () => {
      const key = el.dataset.exprAmt;
      settings[key].amount = Math.max(0, Math.min(5, Number(el.value) || 0));
      saveExprSettings(settings);
      onChange?.();
    };
    el.addEventListener('input', apply);
    el.addEventListener('change', apply);
  });
}
