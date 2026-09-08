/**
 * Named placement presets for face-follow (placement + body-parts visibility).
 * Stored in the same IndexedDB as models so presets are device-persistent.
 * Last-used preset ID is kept in localStorage for quick restore.
 */
import { DEFAULT_PLACEMENT, DEFAULT_BODY_PARTS } from './faceFollowMindarShared.js';

const DB_NAME = 'edge_ai_models';
const DB_VERSION = 2;
const STORE = 'placementPresets';
const MODELS_STORE = 'models';
const LAST_KEY = 'faceFollowLastPresetId';

let _dbPromise = null;
function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(MODELS_STORE)) {
        try {
          db.createObjectStore(MODELS_STORE, { keyPath: 'id' });
        } catch {
          /* already exists in older version */
        }
      }
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.close();
        reject(new Error('Store missing — reopen required'));
        return;
      }
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function normalizePreset(raw, withDefaults = true) {
  const placement = withDefaults
    ? { ...DEFAULT_PLACEMENT, ...(raw?.placement ?? {}) }
    : { ...(raw?.placement ?? {}) };
  const bodyParts = withDefaults
    ? { ...DEFAULT_BODY_PARTS, ...(raw?.bodyParts ?? {}) }
    : { ...(raw?.bodyParts ?? {}) };
  return {
    id: String(raw?.id ?? ''),
    name: String(raw?.name ?? 'Untitled').slice(0, 80),
    placement,
    bodyParts,
    modelId: raw?.modelId ?? null,
    modelName: raw?.modelName ?? null,
    createdAt: raw?.createdAt ?? Date.now(),
    updatedAt: raw?.updatedAt ?? Date.now(),
  };
}

export async function listPresets() {
  try {
    const db = await openDB();
    const store = db.transaction(STORE, 'readonly').objectStore(STORE);
    const rows = (await reqToPromise(store.getAll())) || [];
    return rows
      .map((r) => normalizePreset(r))
      .sort((a, b) => a.updatedAt - b.updatedAt);
  } catch {
    return [];
  }
}

export async function getPreset(id) {
  if (!id) return null;
  try {
    const db = await openDB();
    const store = db.transaction(STORE, 'readonly').objectStore(STORE);
    const row = await reqToPromise(store.get(id));
    return row ? normalizePreset(row) : null;
  } catch {
    return null;
  }
}

export async function savePreset(input) {
  const existing = input.id ? await getPreset(input.id) : null;
  const id =
    input.id && !/^(auto|new|)$/i.test(input.id)
      ? String(input.id)
      : `preset_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const now = Date.now();
  const record = {
    ...normalizePreset({
      id,
      name: (input.name && String(input.name).trim()) || existing?.name || `Preset ${new Date(now).toLocaleString()}`,
      placement: input.placement ?? existing?.placement ?? DEFAULT_PLACEMENT,
      bodyParts: input.bodyParts ?? existing?.bodyParts ?? DEFAULT_BODY_PARTS,
      modelId: input.modelId ?? existing?.modelId ?? null,
      modelName: input.modelName ?? existing?.modelName ?? null,
    }, false),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  const db = await openDB();
  await reqToPromise(db.transaction(STORE, 'readwrite').objectStore(STORE).put(record));
  setLastPresetId(id);
  return normalizePreset(record);
}

export async function deletePreset(id) {
  if (!id) return false;
  try {
    const db = await openDB();
    await reqToPromise(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id));
    if (getLastPresetId() === id) setLastPresetId('');
    return true;
  } catch {
    return false;
  }
}

export function getLastPresetId() {
  try {
    return localStorage.getItem(LAST_KEY) || '';
  } catch {
    return '';
  }
}

export function setLastPresetId(id) {
  try {
    if (id) localStorage.setItem(LAST_KEY, String(id));
    else localStorage.removeItem(LAST_KEY);
  } catch {
    /* ignore */
  }
}

export async function populatePresetSelect(selectEl, { includeEmpty = true } = {}) {
  if (!selectEl) return;
  const presets = await listPresets();
  const prev = selectEl.value;
  selectEl.innerHTML = '';
  if (includeEmpty) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '— Saved presets —';
    selectEl.appendChild(opt);
  }
  for (const p of presets) {
    const opt = document.createElement('option');
    opt.value = p.id;
    const hint = p.modelName ? ` · ${p.modelName}` : '';
    opt.textContent = `${p.name}${hint}`;
    selectEl.appendChild(opt);
  }
  if (presets.some((p) => p.id === prev)) {
    selectEl.value = prev;
  } else {
    const last = getLastPresetId();
    if (last && presets.some((p) => p.id === last)) selectEl.value = last;
  }
}
