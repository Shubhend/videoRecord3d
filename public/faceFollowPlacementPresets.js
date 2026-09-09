/**
 * CRUD for placement presets → public/assets/data/presets.json
 */

import { fetchData, putData } from '../js/assetsClient.js';

const LAST_PRESET_KEY = 'faceFollowLastPresetId';

function makeId() {
  return `preset_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function readPresetsFile() {
  try {
    const data = await fetchData('presets');
    return {
      presets: Array.isArray(data?.presets) ? data.presets : [],
      lastPresetId: data?.lastPresetId || '',
    };
  } catch {
    return { presets: [], lastPresetId: '' };
  }
}

async function writePresetsFile(data) {
  await putData('presets', data);
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
  (async () => {
    try {
      const cur = await readPresetsFile();
      cur.lastPresetId = id || '';
      await writePresetsFile(cur);
      const sel = (await fetchData('selection').catch(() => ({}))) || {};
      await putData('selection', { ...sel, lastPresetId: id || '' });
    } catch (err) {
      console.warn('[presets] lastPresetId save failed:', err);
    }
  })();
}

export async function listPresets() {
  const { presets } = await readPresetsFile();
  return presets.sort((a, b) => (a.addedAt || a.updatedAt || 0) - (b.addedAt || b.updatedAt || 0));
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
    updatedAt: Date.now(),
  };
  const data = await readPresetsFile();
  const idx = data.presets.findIndex((p) => p.id === record.id);
  if (idx >= 0) {
    record.addedAt = data.presets[idx].addedAt || record.addedAt;
    data.presets[idx] = record;
  } else {
    data.presets.push(record);
  }
  data.lastPresetId = record.id;
  await writePresetsFile(data);
  try {
    localStorage.setItem(LAST_PRESET_KEY, record.id);
  } catch {
    /* ignore */
  }
  return record;
}

export async function deletePreset(id) {
  const data = await readPresetsFile();
  data.presets = data.presets.filter((p) => p.id !== id);
  if (data.lastPresetId === id) data.lastPresetId = '';
  await writePresetsFile(data);
  if (getLastPresetId() === id) setLastPresetId('');
}

export async function renamePreset(id, name) {
  const data = await readPresetsFile();
  const record = data.presets.find((p) => p.id === id);
  if (!record) throw new Error('Preset not found');
  record.name = (name || '').trim() || record.name;
  record.updatedAt = Date.now();
  await writePresetsFile(data);
  return record;
}
