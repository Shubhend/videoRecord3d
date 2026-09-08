/**
 * CRUD for placement presets stored in IndexedDB edge_ai_models.placementPresets.
 * Each preset captures position/rotation/scale, body-part visibility, and the
 * model context so switching a preset can also load the matching avatar.
 */

const DB_NAME = 'edge_ai_models';
const DB_VERSION = 100;
const PRESET_STORE = 'placementPresets';
const LAST_PRESET_KEY = 'faceFollowLastPresetId';

let _dbPromise = null;

function openDB() {
  if (_dbPromise) return _dbPromise.catch(() => { _dbPromise = null; return openDB(); });
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      const oldVersion = e.oldVersion || 0;
      if (!db.objectStoreNames.contains('models')) {
        const store = db.createObjectStore('models', { keyPath: 'id' });
        store.createIndex('addedAt', 'addedAt', { unique: false });
      }
      if (oldVersion < 2 && !db.objectStoreNames.contains(PRESET_STORE)) {
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

async function presetTx(mode) {
  const db = await openDB();
  return db.transaction(PRESET_STORE, mode).objectStore(PRESET_STORE);
}

function makeId() {
  return `preset_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function getLastPresetId() {
  try {
    return localStorage.getItem(LAST_PRESET_KEY) || '';
  } catch {
    return '';
  }
}

export function setLastPresetId(id) {
  try {
    if (id) localStorage.setItem(LAST_PRESET_KEY, id);
    else localStorage.removeItem(LAST_PRESET_KEY);
  } catch {
    /* ignore */
  }
}

export async function listPresets() {
  try {
    const store = await presetTx('readonly');
    const all = await reqToPromise(store.getAll());
    return all.sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0));
  } catch {
    return [];
  }
}

export async function savePreset(preset) {
  const record = {
    id: preset.id || makeId(),
    name: (preset.name || 'Preset').trim(),
    modelId: preset.modelId || '',
    modelName: preset.modelName || '',
    placement: preset.placement ? { ...preset.placement } : null,
    bodyParts: preset.bodyParts ? { ...preset.bodyParts } : null,
    addedAt: Date.now(),
  };
  const store = await presetTx('readwrite');
  await reqToPromise(store.put(record));
  return record;
}

export async function deletePreset(id) {
  const store = await presetTx('readwrite');
  await reqToPromise(store.delete(id));
  if (getLastPresetId() === id) setLastPresetId('');
}

export async function renamePreset(id, name) {
  const store = await presetTx('readwrite');
  const record = await reqToPromise(store.get(id));
  if (!record) throw new Error('Preset not found');
  record.name = (name || '').trim() || record.name;
  await reqToPromise(store.put(record));
  return record;
}
