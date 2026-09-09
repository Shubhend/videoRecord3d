/**
 * Same model list as js/modelStore.js — physical files under public/assets/models.
 */
import {
  listUploadedModels,
  fetchData,
  putData,
} from '../js/assetsClient.js';

const FACE_MODEL_KEY = 'faceFollowSelectedModelId';

export const DEFAULT_MODEL = Object.freeze({
  id: 'default',
  name: 'Alicia Solid',
  type: 'vrm',
  url: 'assets/models/AliciaSolid.vrm',
  builtIn: true,
});

export const FACE_GLB_MODEL = Object.freeze({
  id: 'face-glb',
  name: '8329890252317737768',
  type: 'glb',
  url: 'assets/models/8329890252317737768.glb',
  builtIn: true,
});

const BUILT_INS = [DEFAULT_MODEL, FACE_GLB_MODEL];

export function resolveAssetUrl(path) {
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
  } catch (e) {
    if (typeof console !== 'undefined') {
      console.warn('[faceFollowModelStore] listModels failed:', e && e.message ? e.message : e);
    }
    return { models: [], selectedModelId: FACE_GLB_MODEL.id, activeModelId: FACE_GLB_MODEL.id };
  }
}

export async function listModels() {
  const index = await readIndex();
  const uploaded = (index.models || [])
    .map((m) => ({
      id: m.id,
      name: m.name,
      type: m.type || 'vrm',
      url: m.url || (m.file ? `assets/models/${m.file}` : null),
      addedAt: m.addedAt,
      builtIn: false,
    }))
    .sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0));
  return [...BUILT_INS, ...uploaded];
}

export async function getModelSource(id) {
  const models = await listModels();
  const found = models.find((m) => m.id === id) || FACE_GLB_MODEL;
  return {
    id: found.id,
    type: 'url',
    value: resolveAssetUrl(found.url || FACE_GLB_MODEL.url),
    name: found.name,
    label: found.url || found.name,
  };
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
  (async () => {
    try {
      const cur = (await fetchData('selection').catch(() => ({}))) || {};
      await putData('selection', { ...cur, selectedModelId: id });
      const index = await readIndex();
      await putData('models', {
        models: index.models || [],
        selectedModelId: id,
        activeModelId: index.activeModelId || id,
      });
    } catch (err) {
      console.warn('[faceFollowModelStore] selection save failed:', err);
    }
  })();
}

export async function populateModelSelect(selectEl) {
  if (!selectEl) return;
  const models = await listModels();
  let selected = getSelectedModelId();
  try {
    const index = await readIndex();
    if (index.selectedModelId) selected = index.selectedModelId;
  } catch {
    /* ignore */
  }
  if (typeof console !== 'undefined') {
    console.info('[ModelsDropdown] populate:', models.length, 'models (built-ins + uploaded). selectedId=', selected);
  }
  selectEl.innerHTML = '';
  if (models.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No models available';
    opt.disabled = true;
    selectEl.appendChild(opt);
    return;
  }
  for (const m of models) {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.builtIn ? m.name : `${m.name} (uploaded)`;
    selectEl.appendChild(opt);
  }
  const validSelected = models.find((m) => m.id === selected);
  if (validSelected) {
    selectEl.value = selected;
  } else {
    const first = models[0];
    selectEl.value = first.id;
    setSelectedModelId(first.id);
  }
}
