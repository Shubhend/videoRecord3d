// ==================== BACKGROUND STORE ====================
// Persists the user's chosen scene background:
//   - mode:  'default' | 'color' | 'image'
//   - color: '#rrggbb' (used when mode === 'color')
//   - imageBlob: Blob (used when mode === 'image'), stored in IndexedDB
// Mode/color are kept in localStorage so they're synchronous; the image
// blob is in IndexedDB because images can be many MB.

const DB_NAME = 'edge_ai_background';
const DB_VERSION = 1;
const STORE = 'background';
const IMAGE_KEY = 'image';
const CONFIG_KEY = 'edge_ai_background_config_v1';

export const DEFAULT_BACKGROUND = Object.freeze({
  mode: 'default',
  color: '#0a0e1a',
});

const listeners = new Set();
let _dbPromise = null;

function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

function tx(mode) {
  return openDB().then((db) => db.transaction(STORE, mode).objectStore(STORE));
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function getBackgroundConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return { ...DEFAULT_BACKGROUND };
    const parsed = JSON.parse(raw);
    return {
      mode: parsed.mode || 'default',
      color: typeof parsed.color === 'string' ? parsed.color : DEFAULT_BACKGROUND.color,
    };
  } catch {
    return { ...DEFAULT_BACKGROUND };
  }
}

export function setBackgroundConfig(partial) {
  const next = { ...getBackgroundConfig(), ...partial };
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(next));
  } catch {
    // ignore (private mode etc.)
  }
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
  const store = await tx('readwrite');
  await reqToPromise(store.put(file, IMAGE_KEY));
  setBackgroundConfig({ mode: 'image' });
  return file;
}

export async function clearBackgroundImage() {
  const store = await tx('readwrite');
  await reqToPromise(store.delete(IMAGE_KEY));
  notify();
}

export async function getBackgroundImageBlob() {
  const store = await tx('readonly');
  const blob = await reqToPromise(store.get(IMAGE_KEY));
  return blob || null;
}

/**
 * Read the full state needed to apply the background:
 * resolves the image blob automatically when mode is 'image'.
 */
export async function loadBackground() {
  const cfg = getBackgroundConfig();
  const result = { mode: cfg.mode, color: cfg.color, blob: null };
  if (cfg.mode === 'image') {
    try {
      result.blob = await getBackgroundImageBlob();
      if (!result.blob) {
        // Image was deleted but mode wasn't reset — fall back gracefully.
        result.mode = 'default';
      }
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
