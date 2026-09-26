/**
 * Same model list as js/modelStore.js — physical files under public/assets/models.
 * Built-ins fall back to a CDN sample when local files are missing (gitignored).
 */
import { fetchData, putData } from '../js/assetsClient.js';

const FACE_MODEL_KEY = 'faceFollowSelectedModelId';
const API_MODELS = '/api/assets/models';

/** Pixiv sample (~10MB) — used when local AliciaSolid.vrm is absent. */
const SAMPLE_VRM_CDN =
  'https://cdn.jsdelivr.net/gh/pixiv/three-vrm@release/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm';

export const DEFAULT_MODEL = Object.freeze({
  id: 'default',
  name: 'Alicia Solid',
  type: 'vrm',
  url: 'assets/models/AliciaSolid.vrm',
  fallbackUrl: SAMPLE_VRM_CDN,
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

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out (${ms / 1000}s)`)), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

/** Fast assets-API read so a hanging /api never blocks model load. */
async function listUploadedModelsFast(ms = 2000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(API_MODELS, { cache: 'no-store', signal: ctrl.signal });
    if (!res.ok) throw new Error(`models API ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function urlReachable(url, ms = 3000) {
  if (!url) return false;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    let res = await fetch(url, { method: 'HEAD', signal: ctrl.signal, cache: 'no-store' });
    if (res.ok) return true;
    if (res.status === 405 || res.status === 501 || res.status === 403) {
      res = await fetch(url, {
        method: 'GET',
        headers: { Range: 'bytes=0-0' },
        signal: ctrl.signal,
        cache: 'no-store',
      });
      return res.ok || res.status === 206;
    }
    return false;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

async function readIndex() {
  try {
    return await listUploadedModelsFast();
  } catch (e) {
    if (typeof console !== 'undefined') {
      console.warn('[faceFollowModelStore] listModels failed:', e && e.message ? e.message : e);
    }
    return {
      models: [],
      selectedModelId: DEFAULT_MODEL.id,
      activeModelId: DEFAULT_MODEL.id,
    };
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
      fallbackUrl: m.fallbackUrl || null,
      addedAt: m.addedAt,
      builtIn: false,
    }))
    .sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0));
  return [...BUILT_INS, ...uploaded];
}

/**
 * Resolves a loadable URL. Prefers local file; falls back to CDN for built-ins.
 * Throws quickly if nothing is reachable (avoids GLTFLoader hanging on 404 HTML).
 */
export async function getModelSource(id) {
  const models = await listModels();
  const found = models.find((m) => m.id === id) || DEFAULT_MODEL;
  const primary = resolveAssetUrl(found.url || DEFAULT_MODEL.url);
  const fallback = found.fallbackUrl || (found.id === DEFAULT_MODEL.id ? SAMPLE_VRM_CDN : null);

  if (await urlReachable(primary)) {
    return {
      id: found.id,
      type: 'url',
      value: primary,
      name: found.name,
      label: found.url || found.name,
      fromFallback: false,
    };
  }

  if (fallback && (await urlReachable(fallback, 5000))) {
    return {
      id: found.id,
      type: 'url',
      value: fallback,
      name: found.name,
      label: fallback,
      fromFallback: true,
    };
  }

  throw new Error(
    `Model file missing: ${found.url || found.name}. Place it under public/assets/models/ or upload via Models page.`
  );
}

export function getSelectedModelId() {
  try {
    return localStorage.getItem(FACE_MODEL_KEY) || DEFAULT_MODEL.id;
  } catch {
    return DEFAULT_MODEL.id;
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
      await withTimeout(putData('selection', { ...cur, selectedModelId: id }), 2000, 'Save selection');
      const index = await readIndex();
      await withTimeout(
        putData('models', {
          models: index.models || [],
          selectedModelId: id,
          activeModelId: index.activeModelId || id,
        }),
        2000,
        'Save models index'
      );
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
    console.info(
      '[ModelsDropdown] populate:',
      models.length,
      'models (built-ins + uploaded). selectedId=',
      selected
    );
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
