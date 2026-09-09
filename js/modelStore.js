// ==================== MODEL STORE ====================
// Physical persistence under public/assets/models + public/assets/data/models.json
// (written via Vite /api/assets middleware during npm run dev / preview).

import {
  listUploadedModels,
  uploadModelFile,
  renameUploadedModel,
  deleteUploadedModel,
  putData,
  fetchData,
} from './assetsClient.js';

const ACTIVE_KEY = 'edge_ai_active_model_id';

/** Built-in defaults — place matching files under public/assets/models/ */
export const DEFAULT_MODEL = Object.freeze({
  id: 'default',
  name: 'Alicia Solid',
  size: 7879244,
  type: 'vrm',
  url: 'assets/models/AliciaSolid.vrm',
  file: 'AliciaSolid.vrm',
  builtIn: true,
  addedAt: 0,
});

export const FACE_GLB_MODEL = Object.freeze({
  id: 'face-glb',
  name: '8329890252317737768',
  type: 'glb',
  url: 'assets/models/8329890252317737768.glb',
  file: '8329890252317737768.glb',
  builtIn: true,
  addedAt: 0,
});

const BUILT_INS = [DEFAULT_MODEL, FACE_GLB_MODEL];

function resolveAssetUrl(path) {
  if (!path || typeof path !== 'string') return path;
  if (/^(https?:|blob:|data:)/i.test(path)) return path;
  const rel = path.replace(/^\//, '');
  try {
    const base =
      (typeof document !== 'undefined' && document.baseURI) ||
      (typeof location !== 'undefined' ? location.href : '/');
    return new URL(rel, base).href;
  } catch {
    return rel;
  }
}

async function readIndex() {
  try {
    return await listUploadedModels();
  } catch (err) {
    console.warn('[modelStore] assets API unavailable:', err);
    return { models: [], selectedModelId: 'default', activeModelId: 'default' };
  }
}

async function syncSelectionToDisk(partial) {
  try {
    const cur = (await fetchData('selection').catch(() => ({}))) || {};
    await putData('selection', { ...cur, ...partial });
  } catch (err) {
    console.warn('[modelStore] selection save failed:', err);
  }
  try {
    const index = await readIndex();
    await putData('models', {
      models: index.models || [],
      selectedModelId: partial.selectedModelId ?? index.selectedModelId,
      activeModelId: partial.activeModelId ?? index.activeModelId,
    });
  } catch {
    /* ignore */
  }
}

/**
 * Returns all models (built-ins + uploaded), newest uploads last.
 */
export async function listModels() {
  const index = await readIndex();
  const uploaded = (index.models || [])
    .map((m) => ({
      id: m.id,
      name: m.name,
      size: m.size,
      type: m.type || 'vrm',
      url: m.url || (m.file ? `assets/models/${m.file}` : null),
      file: m.file,
      addedAt: m.addedAt || 0,
      builtIn: false,
    }))
    .sort((a, b) => a.addedAt - b.addedAt);
  return [...BUILT_INS, ...uploaded];
}

/**
 * Add an uploaded avatar file. Writes the binary into public/assets/models/.
 */
export async function addModel(file) {
  const lower = (file.name || '').toLowerCase();
  const isVrm = lower.endsWith('.vrm');
  const isGlb = lower.endsWith('.glb');
  if (!isVrm && !isGlb) {
    throw new Error('Only .vrm or .glb files are supported.');
  }
  const record = await uploadModelFile(file);
  setActiveModelId(record.id);
  return record;
}

export async function deleteModel(id) {
  if (id === DEFAULT_MODEL.id || id === FACE_GLB_MODEL.id) {
    throw new Error('Built-in model cannot be deleted.');
  }
  await deleteUploadedModel(id);
  if (getActiveModelId() === id) {
    setActiveModelId(DEFAULT_MODEL.id);
  }
}

export async function renameModel(id, newName) {
  if (id === DEFAULT_MODEL.id || id === FACE_GLB_MODEL.id) {
    throw new Error('Built-in model cannot be renamed.');
  }
  const trimmed = (newName || '').trim();
  if (!trimmed) throw new Error('Name cannot be empty.');
  return renameUploadedModel(id, trimmed);
}

/**
 * Resolves a model id to a loadable source.
 * Returns: { type: 'url'|'blob', value, name, id }
 */
export async function getModelSource(id) {
  const models = await listModels();
  const found = models.find((m) => m.id === id) || DEFAULT_MODEL;
  const url = resolveAssetUrl(found.url || DEFAULT_MODEL.url);
  return {
    id: found.id,
    type: 'url',
    value: url,
    name: found.name,
    label: found.url || found.name,
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
  syncSelectionToDisk({ activeModelId: id, selectedModelId: id });
}

/** Prefer disk selection when available (call on app boot). */
export async function hydrateActiveModelId() {
  try {
    const index = await readIndex();
    const id = index.activeModelId || index.selectedModelId;
    if (id) {
      try {
        localStorage.setItem(ACTIVE_KEY, id);
      } catch {
        /* ignore */
      }
      return id;
    }
  } catch {
    /* ignore */
  }
  return getActiveModelId();
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
