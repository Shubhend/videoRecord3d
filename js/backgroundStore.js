// ==================== BACKGROUND STORE ====================
// Config → public/assets/data/background.json
// Image file → public/assets/backgrounds/

import {
  fetchData,
  putData,
  persistData,
  uploadBackgroundFile,
  deleteBackgroundFile,
} from './assetsClient.js';

const CONFIG_KEY = 'edge_ai_background_config_v1';

export const DEFAULT_BACKGROUND = Object.freeze({
  mode: 'default',
  color: '#0a0e1a',
  imageFile: null,
});

const listeners = new Set();
let _cachedConfig = null;
let _hydratePromise = null;

function writeLocal(cfg) {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
  } catch {
    /* ignore */
  }
}

function readLocal() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return { ...DEFAULT_BACKGROUND };
    const parsed = JSON.parse(raw);
    return {
      mode: parsed.mode || 'default',
      color: typeof parsed.color === 'string' ? parsed.color : DEFAULT_BACKGROUND.color,
      imageFile: parsed.imageFile || null,
    };
  } catch {
    return { ...DEFAULT_BACKGROUND };
  }
}

export function hydrateBackground() {
  if (_hydratePromise) return _hydratePromise;
  _hydratePromise = (async () => {
    try {
      const disk = await fetchData('background');
      if (disk && typeof disk === 'object') {
        _cachedConfig = {
          mode: disk.mode || 'default',
          color: typeof disk.color === 'string' ? disk.color : DEFAULT_BACKGROUND.color,
          imageFile: disk.imageFile || null,
        };
        writeLocal(_cachedConfig);
        return _cachedConfig;
      }
    } catch (err) {
      console.warn('[backgroundStore] disk hydrate failed:', err);
    }
    _cachedConfig = readLocal();
    try {
      await putData('background', _cachedConfig);
    } catch {
      /* ignore */
    }
    return _cachedConfig;
  })();
  return _hydratePromise;
}

hydrateBackground();

export function getBackgroundConfig() {
  if (_cachedConfig) return { ..._cachedConfig };
  _cachedConfig = readLocal();
  return { ..._cachedConfig };
}

export function setBackgroundConfig(partial) {
  const next = { ...getBackgroundConfig(), ...partial };
  _cachedConfig = next;
  writeLocal(next);
  persistData('background', next);
  notify();
  return next;
}

export async function setBackgroundImage(file) {
  if (!(file instanceof Blob)) throw new Error('Expected a Blob/File for the background image');
  const lower = (file.name || '').toLowerCase();
  if (file.type && !file.type.startsWith('image/')) {
    throw new Error('Only image files are supported.');
  }
  if (file.name && !/\.(png|jpe?g|webp|gif|avif)$/i.test(lower)) {
    throw new Error('Use a common image format (.png, .jpg, .webp, .gif).');
  }
  const prev = getBackgroundConfig().imageFile;
  const uploaded = await uploadBackgroundFile(file);
  if (prev && prev !== uploaded.file) {
    try {
      await deleteBackgroundFile(prev);
    } catch {
      /* ignore */
    }
  }
  setBackgroundConfig({ mode: 'image', imageFile: uploaded.file });
  return uploaded;
}

export async function clearBackgroundImage() {
  const prev = getBackgroundConfig().imageFile;
  if (prev) {
    try {
      await deleteBackgroundFile(prev);
    } catch {
      /* ignore */
    }
  }
  setBackgroundConfig({ imageFile: null, mode: 'default' });
  notify();
}

export async function getBackgroundImageBlob() {
  const cfg = getBackgroundConfig();
  if (!cfg.imageFile) return null;
  try {
    const url = new URL(`assets/backgrounds/${cfg.imageFile}`, document.baseURI || location.href).href;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.blob();
  } catch {
    return null;
  }
}

export async function loadBackground() {
  await hydrateBackground();
  const cfg = getBackgroundConfig();
  const result = { mode: cfg.mode, color: cfg.color, blob: null, imageFile: cfg.imageFile };
  if (cfg.mode === 'image') {
    try {
      result.blob = await getBackgroundImageBlob();
      if (!result.blob) result.mode = 'default';
    } catch {
      result.mode = 'default';
    }
  }
  return result;
}

export function onBackgroundChange(cb) {
  listeners.add(cb);
  const storageHandler = (e) => {
    if (e.key === CONFIG_KEY) cb();
  };
  window.addEventListener('storage', storageHandler);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('storage', storageHandler);
  };
}

function notify() {
  listeners.forEach((cb) => {
    try {
      cb();
    } catch (e) {
      console.error(e);
    }
  });
}
