// ==================== MODELS PAGE ====================
// Upload, list, rename, delete, and activate VRM avatars.

import {
  listModels,
  addModel,
  deleteModel,
  renameModel,
  getActiveModelId,
  setActiveModelId,
  formatBytes,
  DEFAULT_MODEL,
} from './modelStore.js';

const dropzone = document.getElementById('dropzone');
const browseBtn = document.getElementById('browse-btn');
const fileInput = document.getElementById('file-input');
const grid = document.getElementById('models-grid');
const toast = document.getElementById('toast');

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

async function render() {
  const [models, activeId] = await Promise.all([listModels(), Promise.resolve(getActiveModelId())]);

  const cards = models.map((m) => {
    const isActive = m.id === activeId;
    const isBuiltIn = !!m.builtIn;
    const meta = isBuiltIn ? 'Built-in · VRM' : `${formatBytes(m.size)} · VRM`;

    return `
      <article class="card ${isActive ? 'active' : ''}" data-id="${escapeHtml(m.id)}">
        <span class="card-badge">Active</span>
        <div class="card-thumb" aria-hidden="true">
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none">
            <path d="M12 12a4 4 0 100-8 4 4 0 000 8zm0 2c-3.3 0-8 1.7-8 5v2h16v-2c0-3.3-4.7-5-8-5z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
          </svg>
        </div>
        <div class="card-name" data-name="true">${escapeHtml(m.name)}</div>
        <div class="card-meta">${meta}</div>
        <div class="card-actions">
          ${
            isActive
              ? `<button class="btn small" disabled>Active</button>`
              : `<button class="btn small primary" data-action="activate">Set Active</button>`
          }
          ${
            isBuiltIn
              ? ''
              : `
                <button class="btn small" data-action="rename">Rename</button>
                <button class="btn small danger" data-action="delete">Delete</button>
              `
          }
        </div>
      </article>
    `;
  });

  if (models.length === 1) {
    cards.push(
      `<div class="empty-row">No uploaded models yet. Drop a .vrm/.glb — files are saved under public/assets/models/.</div>`
    );
  }

  grid.innerHTML = cards.join('');
  bindCardActions();
}

function bindCardActions() {
  grid.querySelectorAll('.card').forEach((card) => {
    const id = card.dataset.id;

    card.querySelector('[data-action="activate"]')?.addEventListener('click', async () => {
      setActiveModelId(id);
      showToast('Set as active. Open the live page to use it.');
      await render();
    });

    card.querySelector('[data-action="delete"]')?.addEventListener('click', async () => {
      const nameEl = card.querySelector('[data-name="true"]');
      const name = nameEl?.textContent?.trim() || 'this model';
      if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
      try {
        await deleteModel(id);
        showToast('Deleted.');
        await render();
      } catch (e) {
        showToast(e.message || 'Delete failed', true);
      }
    });

    card.querySelector('[data-action="rename"]')?.addEventListener('click', () => {
      const nameEl = card.querySelector('[data-name="true"]');
      if (!nameEl || nameEl.querySelector('input')) return;
      const current = nameEl.textContent.trim();
      nameEl.innerHTML = `<input type="text" value="${escapeHtml(current)}" />`;
      const input = nameEl.querySelector('input');
      input.focus();
      input.select();

      const finish = async (commit) => {
        const next = input.value.trim();
        input.removeEventListener('keydown', onKey);
        input.removeEventListener('blur', onBlur);
        if (!commit || !next || next === current) {
          nameEl.textContent = current;
          return;
        }
        try {
          await renameModel(id, next);
          showToast('Renamed.');
          await render();
        } catch (e) {
          nameEl.textContent = current;
          showToast(e.message || 'Rename failed', true);
        }
      };
      const onKey = (ev) => {
        if (ev.key === 'Enter') finish(true);
        else if (ev.key === 'Escape') finish(false);
      };
      const onBlur = () => finish(true);
      input.addEventListener('keydown', onKey);
      input.addEventListener('blur', onBlur);
    });
  });
}

// ---------- Upload ----------

async function handleFiles(fileList) {
  const files = Array.from(fileList || []);
  if (files.length === 0) return;

  let added = 0;
  for (const file of files) {
    try {
      const record = await addModel(file);
      added++;
      if (added === 1) setActiveModelId(record.id);
    } catch (e) {
      showToast(e.message || 'Upload failed', true);
    }
  }
  if (added > 0) {
    showToast(
      added === 1
        ? 'Model uploaded and set as active.'
        : `${added} models uploaded.`
    );
    await render();
  }
}

browseBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  fileInput.click();
});
dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fileInput.click();
  }
});

fileInput.addEventListener('change', () => {
  if (fileInput.files && fileInput.files.length > 0) {
    handleFiles(fileInput.files);
    fileInput.value = '';
  }
});

['dragenter', 'dragover'].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropzone.classList.add('dragover');
  })
);
['dragleave', 'drop'].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropzone.classList.remove('dragover');
  })
);
dropzone.addEventListener('drop', (e) => {
  if (e.dataTransfer?.files) handleFiles(e.dataTransfer.files);
});

// Block default browser behavior for drops outside the zone
['dragover', 'drop'].forEach((evt) =>
  window.addEventListener(evt, (e) => e.preventDefault())
);

render().catch((err) => {
  console.error('Failed to render models page:', err);
  showToast('Could not load models from storage', true);
});

// Expose default model name for any debug needs
console.info('[Models] Built-in default:', DEFAULT_MODEL.name);
