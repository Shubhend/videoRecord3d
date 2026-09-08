/**
 * Same model list as js/modelStore.js (IndexedDB + built-ins) for face-follow page.
 */
const DB_NAME = 'edge_ai_models';
const DB_VERSION = 100;
const STORE = 'models';
const PRESET_STORE = 'placementPresets';
const FACE_MODEL_KEY = 'faceFollowSelectedModelId';

export const DEFAULT_MODEL = Object.freeze({
  id: 'default',
  name: 'Alicia Solid',
  type: 'vrm',
  url: 'models/AliciaSolid.vrm',
  builtIn: true,
});

export const FACE_GLB_MODEL = Object.freeze({
  id: 'face-glb',
  name: '8329890252317737768',
  type: 'glb',
  url: 'models/8329890252317737768 (1).glb',
  builtIn: true,
});

const BUILT_INS = [DEFAULT_MODEL, FACE_GLB_MODEL];

const SCRIPT_BASE = new URL('.', import.meta.url);

export function resolveAssetUrl(path) {
  if (!path || typeof path !== 'string') return path;
  if (/^(https?:|blob:|data:)/i.test(path)) return path;
  const rel = path.replace(/^\//, '');
  return new URL(rel, SCRIPT_BASE).href;
}

let _dbPromise = null;
function openDB() {
  if (_dbPromise) return _dbPromise.catch(() => { _dbPromise = null; return openDB(); });
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('addedAt', 'addedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(PRESET_STORE)) {
        const presetStore = db.createObjectStore(PRESET_STORE, { keyPath: 'id' });
        presetStore.createIndex('addedAt', 'addedAt', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      _dbPromise = null;
      reject(req.error);
    };
  });
  return _dbPromise;
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function listModels() {
  let uploaded = [];
  try {
    const db = await openDB();
    const store = db.transaction(STORE, 'readonly').objectStore(STORE);
    const all = await reqToPromise(store.getAll());
    uploaded = all
      .map((m) => ({
        id: m.id,
        name: m.name,
        type: m.type || 'vrm',
        addedAt: m.addedAt,
        builtIn: false,
      }))
      .sort((a, b) => a.addedAt - b.addedAt);
  } catch {
    /* IndexedDB unavailable */
  }
  return [...BUILT_INS, ...uploaded];
}

export async function getModelSource(id) {
  const builtIn = BUILT_INS.find((m) => m.id === id);
  if (builtIn) {
    return {
      id: builtIn.id,
      type: 'url',
      value: resolveAssetUrl(builtIn.url),
      name: builtIn.name,
      label: builtIn.url,
    };
  }
  try {
    const db = await openDB();
    const store = db.transaction(STORE, 'readonly').objectStore(STORE);
    const record = await reqToPromise(store.get(id));
    if (record?.blob) {
      return {
        id: record.id,
        type: 'blob',
        value: record.blob,
        name: record.name,
        label: record.name,
      };
    }
  } catch {
    /* ignore */
  }
  return getModelSource(FACE_GLB_MODEL.id);
}

export function getSelectedModelId() {
  try {
    return localStorage.getItem(FACE_MODEL_KEY) || FACE_GLB_MODEL.id;
  } catch {
    return FACE_GLB_MODEL.id;
  }
}

export function setSelectedModelId(id) {
  try {
    localStorage.setItem(FACE_MODEL_KEY, id);
  } catch {
    /* ignore */
  }
}

export async function populateModelSelect(selectEl) {
  if (!selectEl) return;
  const models = await listModels();
  const selected = getSelectedModelId();
  selectEl.innerHTML = '';
  for (const m of models) {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.builtIn ? m.name : `${m.name} (uploaded)`;
    selectEl.appendChild(opt);
  }
  if (models.some((m) => m.id === selected)) {
    selectEl.value = selected;
  } else {
    selectEl.value = FACE_GLB_MODEL.id;
    setSelectedModelId(selectEl.value);
  }
}
