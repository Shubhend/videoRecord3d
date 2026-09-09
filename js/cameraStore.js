// ==================== CAMERA STORE ====================
// Saved camera views → public/assets/data/cameras.json

import { captureRelativePose } from './cameraPoseMath.js';
import { fetchData, putData } from './assetsClient.js';

function makeId() {
  return `cam_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

async function readCameras() {
  try {
    const data = await fetchData('cameras');
    return Array.isArray(data?.cameras) ? data.cameras : [];
  } catch (err) {
    console.warn('[cameraStore] read failed:', err);
    return [];
  }
}

async function writeCameras(cameras) {
  await putData('cameras', { cameras });
}

/** @param {import('./sceneSetup.js').SceneSetup} sceneSetup @param {object} [vrm] */
export function capturePoseFromScene(sceneSetup, vrm) {
  return captureRelativePose(sceneSetup, vrm);
}

export async function saveCamera(name, pose) {
  const record = {
    id: makeId(),
    name: name.trim() || 'Camera view',
    version: pose.version ?? 2,
    localCam: pose.localCam ? { ...pose.localCam } : null,
    localTarget: pose.localTarget ? { ...pose.localTarget } : null,
    fov: pose.fov ?? 50,
    captureRoot: pose.captureRoot ? { ...pose.captureRoot } : null,
    position: pose.position ? { ...pose.position } : undefined,
    target: pose.target ? { ...pose.target } : undefined,
    addedAt: Date.now(),
  };
  const cameras = await readCameras();
  cameras.unshift(record);
  await writeCameras(cameras);
  return record;
}

export async function listCameras() {
  const all = await readCameras();
  return all.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
}

export async function getCamera(id) {
  const all = await readCameras();
  return all.find((c) => c.id === id) || null;
}

export async function deleteCamera(id) {
  const cameras = (await readCameras()).filter((c) => c.id !== id);
  await writeCameras(cameras);
}

export async function renameCamera(id, name) {
  const cameras = await readCameras();
  const row = cameras.find((c) => c.id === id);
  if (!row) throw new Error('Camera not found');
  row.name = (name || '').trim() || row.name;
  await writeCameras(cameras);
  return row;
}
