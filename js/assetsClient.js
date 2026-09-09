/**
 * Client for physical assets API (public/assets via Vite middleware).
 * Works in both React (src/) and legacy (js/) pages.
 */

const API = '/api/assets';

async function parseJson(res) {
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const msg = (data && data.error) || text || res.statusText || 'Request failed';
    throw new Error(msg);
  }
  return data;
}

export async function fetchData(name) {
  const res = await fetch(`${API}/data/${encodeURIComponent(name)}.json`, {
    cache: 'no-store',
  });
  return parseJson(res);
}

export async function putData(name, value) {
  const res = await fetch(`${API}/data/${encodeURIComponent(name)}.json`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value ?? {}),
  });
  return parseJson(res);
}

export async function listUploadedModels() {
  const res = await fetch(`${API}/models`, { cache: 'no-store' });
  return parseJson(res);
}

export async function uploadModelFile(file) {
  const filename = file.name || 'model.vrm';
  const name = filename.replace(/\.(vrm|glb)$/i, '');
  const q = new URLSearchParams({ filename, name });
  const res = await fetch(`${API}/models?${q}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: file,
  });
  return parseJson(res);
}

export async function renameUploadedModel(id, name) {
  const res = await fetch(`${API}/models/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return parseJson(res);
}

export async function deleteUploadedModel(id) {
  const res = await fetch(`${API}/models/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  return parseJson(res);
}

export async function uploadBackgroundFile(file) {
  const filename = file.name || 'bg.png';
  const q = new URLSearchParams({ filename });
  const res = await fetch(`${API}/backgrounds?${q}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: file,
  });
  return parseJson(res);
}

export async function deleteBackgroundFile(filename) {
  if (!filename) return { ok: true };
  const res = await fetch(`${API}/backgrounds/${encodeURIComponent(filename)}`, {
    method: 'DELETE',
  });
  return parseJson(res);
}

/** Fire-and-forget disk write; logs errors without throwing. */
export function persistData(name, value) {
  putData(name, value).catch((err) => {
    console.warn(`[assets] failed to save ${name}.json:`, err);
  });
}
