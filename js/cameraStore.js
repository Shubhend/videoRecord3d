// ==================== CAMERA STORE ====================
// Saved camera views as avatar-relative deltas (local offset from head/root).

import { captureRelativePose } from './cameraPoseMath.js';

const DB_NAME = 'edge_ai_cameras';
const DB_VERSION = 1;
const STORE = 'cameras';

let _dbPromise = null;

function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: 'id' });
        os.createIndex('addedAt', 'addedAt', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
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

function makeId() {
  return `cam_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
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
  const store = await tx('readwrite');
  await reqToPromise(store.put(record));
  return record;
}

export async function listCameras() {
  const store = await tx('readonly');
  const all = await reqToPromise(store.getAll());
  return all.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
}

export async function getCamera(id) {
  const store = await tx('readonly');
  return reqToPromise(store.get(id));
}

export async function deleteCamera(id) {
  const store = await tx('readwrite');
  await reqToPromise(store.delete(id));
}

export async function renameCamera(id, name) {
  const store = await tx('readwrite');
  const existing = await reqToPromise(store.get(id));
  if (!existing) throw new Error('Camera not found');
  existing.name = name.trim() || existing.name;
  await reqToPromise(store.put(existing));
  return existing;
}
