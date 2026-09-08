// ==================== MODEL STORE ====================
// IndexedDB-backed persistence for uploaded VRM avatars.
// Built-in defaults are referenced by URL; user uploads are stored as Blobs.

const DB_NAME = 'edge_ai_models';
const DB_VERSION = 101;
const STORE = 'models';
const PRESET_STORE = 'placementPresets';
const ACTIVE_KEY = 'edge_ai_active_model_id';

// Built-in default model bundled with the app (URL reference, not a blob).
export const DEFAULT_MODEL = Object.freeze({
  id: 'default',
  name: 'Alicia Solid',
  size: 7879244,
  type: 'vrm',
  url: 'models/AliciaSolid.vrm',
  builtIn: true,
  addedAt: 0,
});

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

function tx(mode) {
  return openDB().then((db) => db.transaction(STORE, mode).objectStore(STORE));
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Returns all models (default + uploaded), newest uploads last.
 */
export async function listModels() {
  const store = await tx('readonly');
  const all = await reqToPromise(store.getAll());
  const uploaded = all
    .map((m) => ({
      id: m.id,
      name: m.name,
      size: m.size,
      type: m.type,
      addedAt: m.addedAt,
      builtIn: false,
    }))
    .sort((a, b) => a.addedAt - b.addedAt);
  return [DEFAULT_MODEL, ...uploaded];
}

/**
 * Add an uploaded avatar file. Accepts .vrm and .glb (VRM is a glTF container,
 * and some browsers save VRMs with a .glb extension). The actual VRM extensions
 * are validated when the file is loaded by the VRM loader.
 */
export async function addModel(file) {
  const lower = (file.name || '').toLowerCase();
  const isVrm = lower.endsWith('.vrm');
  const isGlb = lower.endsWith('.glb');
  if (!isVrm && !isGlb) {
    throw new Error('Only .vrm or .glb files are supported.');
  }
  const id = `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const record = {
    id,
    name: file.name.replace(/\.(vrm|glb)$/i, ''),
    size: file.size,
    type: 'vrm',
    blob: file,
    addedAt: Date.now(),
  };
  const store = await tx('readwrite');
  await reqToPromise(store.add(record));
  return record;
}

export async function deleteModel(id) {
  if (id === DEFAULT_MODEL.id) {
    throw new Error('Built-in model cannot be deleted.');
  }
  const store = await tx('readwrite');
  await reqToPromise(store.delete(id));
  if (getActiveModelId() === id) {
    setActiveModelId(DEFAULT_MODEL.id);
  }
}

export async function renameModel(id, newName) {
  if (id === DEFAULT_MODEL.id) {
    throw new Error('Built-in model cannot be renamed.');
  }
  const trimmed = (newName || '').trim();
  if (!trimmed) throw new Error('Name cannot be empty.');
  const store = await tx('readwrite');
  const record = await reqToPromise(store.get(id));
  if (!record) throw new Error('Model not found.');
  record.name = trimmed;
  await reqToPromise(store.put(record));
  return record;
}

/**
 * Resolves a model id to a loadable source.
 * Returns: { type: 'url'|'blob', value, name, id }
 */
export async function getModelSource(id) {
  if (!id || id === DEFAULT_MODEL.id) {
    return {
      id: DEFAULT_MODEL.id,
      type: 'url',
      value: DEFAULT_MODEL.url,
      name: DEFAULT_MODEL.name,
    };
  }
  const store = await tx('readonly');
  const record = await reqToPromise(store.get(id));
  if (!record) {
    setActiveModelId(DEFAULT_MODEL.id);
    return {
      id: DEFAULT_MODEL.id,
      type: 'url',
      value: DEFAULT_MODEL.url,
      name: DEFAULT_MODEL.name,
    };
  }
  return {
    id: record.id,
    type: 'blob',
    value: record.blob,
    name: record.name,
  };
}

export function getActiveModelId() {
  try {
    return localStorage.getItem(ACTIVE_KEY) || DEFAULT_MODEL.id;
  } catch {
    return DEFAULT_MODEL.id;
  }
}

export function setActiveModelId(id) {
  try {
    localStorage.setItem(ACTIVE_KEY, id);
  } catch {
    // ignore storage errors (private mode etc.)
  }
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}
