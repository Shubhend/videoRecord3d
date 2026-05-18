// ==================== CAMERAS PAGE ====================
// Frame the scene with the mouse, then save camera positions for recording.

import { Config } from './config.js';
import { SceneSetup } from './sceneSetup.js';
import { VRMLoader } from './vrmLoader.js';
import { getActiveModelId, getModelSource } from './modelStore.js';
import { getSettings } from './settingsStore.js';
import { applyFullAppearance } from './sceneAppearance.js';
import { loadBackground } from './backgroundStore.js';
import {
  listCameras,
  saveCamera,
  deleteCamera,
  renameCamera,
  capturePoseFromScene,
} from './cameraStore.js';
import { resolveWorldPose, getAvatarAnchor } from './cameraPoseMath.js';

const canvas = document.getElementById('cam-canvas');
const loadingEl = document.getElementById('loading');
const loadingText = document.getElementById('loading-text');
const nameInput = document.getElementById('cam-name');
const btnSave = document.getElementById('btn-save-cam');
const camList = document.getElementById('cam-list');
const toast = document.getElementById('toast');

let sceneSetup = null;
let vrm = null;
let toastTimer = null;

function showToast(msg, isError = false) {
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.toggle('error', !!isError);
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

async function renderList() {
  if (!camList) return;
  const cams = await listCameras();
  if (!cams.length) {
    camList.innerHTML =
      '<p class="cam-empty">No saved views yet. Orbit to frame the face, name the shot, and click Save current view.</p>';
    return;
  }

  camList.innerHTML = cams
    .map(
      (c) => `
    <article class="cam-item" data-id="${escapeHtml(c.id)}">
      <div class="cam-item-main">
        <div class="cam-item-name">${escapeHtml(c.name)}</div>
        <div class="cam-item-meta">${(c.version >= 2) ? 'Relative to avatar (delta)' : 'Legacy — please re-save'}</div>
      </div>
      <div class="cam-item-actions">
        <button type="button" class="btn small" data-action="goto">Go to</button>
        <button type="button" class="btn small" data-action="rename">Rename</button>
        <button type="button" class="btn small danger" data-action="delete">Delete</button>
      </div>
    </article>
  `
    )
    .join('');

  camList.querySelectorAll('.cam-item').forEach((el) => {
    const id = el.dataset.id;
    const cam = cams.find((c) => c.id === id);
    el.querySelector('[data-action="goto"]')?.addEventListener('click', () => {
      if (!cam || !sceneSetup) return;
      const anchor = getAvatarAnchor(vrm);
      const pos = new THREE.Vector3();
      const tgt = new THREE.Vector3();
      if (resolveWorldPose(cam, anchor, pos, tgt)) {
        sceneSetup.camera.position.copy(pos);
        if (sceneSetup.controls) sceneSetup.controls.target.copy(tgt);
        sceneSetup.camera.lookAt(tgt);
        if (cam.fov) {
          sceneSetup.camera.fov = cam.fov;
          sceneSetup.camera.updateProjectionMatrix();
        }
      }
      showToast(`View: ${cam.name}`);
    });
    el.querySelector('[data-action="rename"]')?.addEventListener('click', async () => {
      const next = prompt('Name', cam?.name || '');
      if (!next?.trim()) return;
      await renameCamera(id, next.trim());
      await renderList();
    });
    el.querySelector('[data-action="delete"]')?.addEventListener('click', async () => {
      if (!confirm('Delete this camera view?')) return;
      await deleteCamera(id);
      await renderList();
    });
  });
}

async function init() {
  try {
    loadingText.textContent = 'Setting up scene…';
    sceneSetup = new SceneSetup(canvas);
    sceneSetup.init();
    applyFullAppearance(sceneSetup, null, getSettings()); // floor only until avatar loads
    try {
      const bg = await loadBackground();
      sceneSetup.applyBackground(bg);
    } catch (e) {
      /* optional */
    }

    loadingText.textContent = 'Loading avatar…';
    const source = await getModelSource(getActiveModelId());
    const loader = new VRMLoader(sceneSetup.scene);
    vrm = await loader.load(source);
    applyFullAppearance(sceneSetup, vrm, getSettings()); // placement + tint

    loadingEl.classList.add('hidden');
    sceneSetup.onResize();
    await renderList();
    animate();
  } catch (e) {
    console.error(e);
    loadingText.textContent = `Error: ${e.message}`;
    showToast(e.message, true);
  }
}

function animate() {
  requestAnimationFrame(animate);
  sceneSetup.render();
}

btnSave?.addEventListener('click', async () => {
  const name = nameInput?.value?.trim();
  if (!name) {
    showToast('Enter a name for this view', true);
    nameInput?.focus();
    return;
  }
  try {
    const pose = capturePoseFromScene(sceneSetup, vrm);
    await saveCamera(name, pose);
    nameInput.value = '';
    await renderList();
    showToast(`Saved “${name}”`);
  } catch (e) {
    showToast(e.message || 'Save failed', true);
  }
});

init();
