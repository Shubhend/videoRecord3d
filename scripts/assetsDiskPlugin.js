/**
 * Vite plugin: physical storage under public/assets/
 *   models/          — .vrm / .glb files
 *   backgrounds/     — background images
 *   data/*.json      — settings, presets, cameras, model catalog, etc.
 *
 * API (dev + preview):
 *   GET/PUT  /api/assets/data/:name.json
 *   GET      /api/assets/models
 *   POST     /api/assets/models?filename=&name=
 *   PATCH    /api/assets/models/:id   { name }
 *   DELETE   /api/assets/models/:id
 *   POST     /api/assets/backgrounds?filename=
 *   DELETE   /api/assets/backgrounds/:filename
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ASSETS = path.join(ROOT, 'public', 'assets');
const MODELS_DIR = path.join(ASSETS, 'models');
const BACKGROUNDS_DIR = path.join(ASSETS, 'backgrounds');
const DATA_DIR = path.join(ASSETS, 'data');
const RECORDINGS_DIR = path.join(ASSETS, 'recordings');
const MODELS_INDEX = path.join(DATA_DIR, 'models.json');

const DATA_ALLOW = new Set([
  'models',
  'settings',
  'presets',
  'background',
  'cameras',
  'selection',
  'record',
]);

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function safeName(name) {
  return String(name || '')
    .replace(/[/\\?%*:|"<>]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function safeId(id) {
  const s = String(id || '');
  if (!/^[\w.-]+$/.test(s)) return null;
  return s;
}

function sanitizeRawName(input) {
  const cleaned = String(input || '')
    .trim()
    .replace(/\.webm$/i, '')
    .replace(/[^a-zA-Z0-9 _-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (!cleaned || cleaned.length > 80) return '';
  return cleaned;
}

function recordingFile(name) {
  const safe = sanitizeRawName(name);
  if (!safe) return null;
  const root = path.resolve(RECORDINGS_DIR);
  const file = path.resolve(root, `${safe}.webm`);
  if (file !== path.join(root, `${safe}.webm`)) return null;
  return { safe, file };
}

async function writeRecording(req, filePath) {
  await fsp.mkdir(RECORDINGS_DIR, { recursive: true });
  const tmp = `${filePath}.partial`;
  try {
    await pipeline(req, fs.createWriteStream(tmp));
    const stat = await fsp.stat(tmp);
    if (!stat.size) {
      const err = new Error('Empty recording');
      err.status = 400;
      throw err;
    }
    await fsp.rename(tmp, filePath);
  } catch (err) {
    await fsp.unlink(tmp).catch(() => {});
    throw err;
  }
}

async function listRecordings() {
  await fsp.mkdir(RECORDINGS_DIR, { recursive: true });
  const entries = await fsp.readdir(RECORDINGS_DIR);
  return entries
    .filter((name) => name.toLowerCase().endsWith('.webm') && !name.endsWith('.partial'))
    .map((name) => name.slice(0, -5))
    .sort((a, b) => a.localeCompare(b));
}

async function ensureDirs() {
  await fsp.mkdir(MODELS_DIR, { recursive: true });
  await fsp.mkdir(BACKGROUNDS_DIR, { recursive: true });
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.mkdir(RECORDINGS_DIR, { recursive: true });
  if (!fs.existsSync(MODELS_INDEX)) {
    await fsp.writeFile(
      MODELS_INDEX,
      JSON.stringify(
        {
          models: [],
          selectedModelId: 'default',
          activeModelId: 'default',
        },
        null,
        2
      ),
      'utf8'
    );
  }
  for (const name of ['settings', 'presets', 'background', 'cameras', 'selection', 'record']) {
    const p = path.join(DATA_DIR, `${name}.json`);
    if (!fs.existsSync(p)) {
      const empty =
        name === 'presets'
          ? { presets: [], lastPresetId: '' }
          : name === 'cameras'
            ? { cameras: [] }
            : name === 'background'
              ? { mode: 'camera', blurPx: 12, color: '#0a0e14', imageFile: null }
              : name === 'selection'
                ? { selectedModelId: 'default', activeModelId: 'default', lastPresetId: '' }
                : name === 'record'
                  ? {}
                  : {};
      await fsp.writeFile(p, JSON.stringify(empty, null, 2), 'utf8');
    }
  }
}

async function readModelsIndex() {
  await ensureDirs();
  try {
    const raw = await fsp.readFile(MODELS_INDEX, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      models: Array.isArray(parsed.models) ? parsed.models : [],
      selectedModelId: parsed.selectedModelId || 'default',
      activeModelId: parsed.activeModelId || 'default',
    };
  } catch {
    return { models: [], selectedModelId: 'default', activeModelId: 'default' };
  }
}

async function writeModelsIndex(data) {
  await ensureDirs();
  await fsp.writeFile(MODELS_INDEX, JSON.stringify(data, null, 2), 'utf8');
}

async function handleApi(req, res, url) {
  const pathname = url.pathname;

  // ---- JSON data ----
  const dataMatch = pathname.match(/^\/api\/assets\/data\/([a-z0-9_-]+)\.json$/i);
  if (dataMatch) {
    const key = dataMatch[1].toLowerCase();
    if (!DATA_ALLOW.has(key)) {
      sendJson(res, 400, { error: 'Unknown data file' });
      return true;
    }
    const filePath = path.join(DATA_DIR, `${key}.json`);
    if (req.method === 'GET') {
      await ensureDirs();
      try {
        const raw = await fsp.readFile(filePath, 'utf8');
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(raw);
      } catch {
        sendJson(res, 200, {});
      }
      return true;
    }
    if (req.method === 'PUT' || req.method === 'POST') {
      const buf = await readBody(req);
      let parsed;
      try {
        parsed = JSON.parse(buf.toString('utf8') || '{}');
      } catch {
        sendJson(res, 400, { error: 'Invalid JSON' });
        return true;
      }
      await ensureDirs();
      await fsp.writeFile(filePath, JSON.stringify(parsed, null, 2), 'utf8');
      sendJson(res, 200, { ok: true });
      return true;
    }
    sendJson(res, 405, { error: 'Method not allowed' });
    return true;
  }

  // ---- Models list ----
  if (pathname === '/api/assets/models' && req.method === 'GET') {
    const index = await readModelsIndex();
    sendJson(res, 200, index);
    return true;
  }

  // ---- Model upload ----
  if (pathname === '/api/assets/models' && req.method === 'POST') {
    const filenameRaw = url.searchParams.get('filename') || 'model.vrm';
    const displayName = safeName(url.searchParams.get('name') || filenameRaw.replace(/\.(vrm|glb)$/i, ''));
    const lower = filenameRaw.toLowerCase();
    const ext = lower.endsWith('.glb') ? '.glb' : lower.endsWith('.vrm') ? '.vrm' : '';
    if (!ext) {
      sendJson(res, 400, { error: 'Only .vrm or .glb files are supported.' });
      return true;
    }
    const id = `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const storedName = `${id}${ext}`;
    const dest = path.join(MODELS_DIR, storedName);
    const buf = await readBody(req);
    if (!buf.length) {
      sendJson(res, 400, { error: 'Empty file body' });
      return true;
    }
    await ensureDirs();
    await fsp.writeFile(dest, buf);
    const record = {
      id,
      name: displayName || id,
      size: buf.length,
      type: ext === '.glb' ? 'glb' : 'vrm',
      file: storedName,
      url: `assets/models/${storedName}`,
      builtIn: false,
      addedAt: Date.now(),
    };
    const index = await readModelsIndex();
    index.models.push(record);
    index.activeModelId = id;
    index.selectedModelId = id;
    await writeModelsIndex(index);
    sendJson(res, 200, record);
    return true;
  }

  // ---- Model rename / delete ----
  const modelIdMatch = pathname.match(/^\/api\/assets\/models\/([\w.-]+)$/);
  if (modelIdMatch) {
    const id = safeId(modelIdMatch[1]);
    if (!id) {
      sendJson(res, 400, { error: 'Invalid id' });
      return true;
    }
    if (id === 'default' || id === 'face-glb') {
      sendJson(res, 400, { error: 'Built-in model cannot be modified.' });
      return true;
    }
    const index = await readModelsIndex();
    const idx = index.models.findIndex((m) => m.id === id);
    if (idx < 0) {
      sendJson(res, 404, { error: 'Model not found' });
      return true;
    }
    const record = index.models[idx];

    if (req.method === 'PATCH') {
      const buf = await readBody(req);
      let body = {};
      try {
        body = JSON.parse(buf.toString('utf8') || '{}');
      } catch {
        sendJson(res, 400, { error: 'Invalid JSON' });
        return true;
      }
      const nextName = safeName(body.name);
      if (!nextName) {
        sendJson(res, 400, { error: 'Name cannot be empty.' });
        return true;
      }
      record.name = nextName;
      index.models[idx] = record;
      await writeModelsIndex(index);
      sendJson(res, 200, record);
      return true;
    }

    if (req.method === 'DELETE') {
      if (record.file) {
        try {
          await fsp.unlink(path.join(MODELS_DIR, record.file));
        } catch {
          /* file may already be gone */
        }
      }
      index.models.splice(idx, 1);
      if (index.activeModelId === id) index.activeModelId = 'default';
      if (index.selectedModelId === id) index.selectedModelId = 'default';
      await writeModelsIndex(index);
      sendJson(res, 200, { ok: true });
      return true;
    }

    sendJson(res, 405, { error: 'Method not allowed' });
    return true;
  }

  // ---- Background image upload ----
  if (pathname === '/api/assets/backgrounds' && req.method === 'POST') {
    const filenameRaw = url.searchParams.get('filename') || 'bg.png';
    const lower = filenameRaw.toLowerCase();
    const extMatch = lower.match(/\.(png|jpe?g|webp|gif|avif)$/);
    if (!extMatch) {
      sendJson(res, 400, { error: 'Use a common image format (.png, .jpg, .webp, .gif).' });
      return true;
    }
    const ext = extMatch[0];
    const storedName = `bg_${Date.now()}${ext}`;
    const buf = await readBody(req);
    await ensureDirs();
    await fsp.writeFile(path.join(BACKGROUNDS_DIR, storedName), buf);
    sendJson(res, 200, {
      file: storedName,
      url: `assets/backgrounds/${storedName}`,
      size: buf.length,
    });
    return true;
  }

  const bgMatch = pathname.match(/^\/api\/assets\/backgrounds\/([\w.-]+)$/);
  if (bgMatch && req.method === 'DELETE') {
    const file = safeId(bgMatch[1]);
    if (!file) {
      sendJson(res, 400, { error: 'Invalid filename' });
      return true;
    }
    try {
      await fsp.unlink(path.join(BACKGROUNDS_DIR, file));
    } catch {
      /* ignore */
    }
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (pathname === '/api/assets/recordings' && req.method === 'GET') {
    sendJson(res, 200, { names: await listRecordings() });
    return true;
  }

  if (pathname === '/api/assets/recordings' && req.method === 'POST') {
    const target = recordingFile(url.searchParams.get('name'));
    if (!target) {
      sendJson(res, 400, { error: 'Enter a name using letters, numbers, spaces, or hyphens' });
      return true;
    }
    await writeRecording(req, target.file);
    sendJson(res, 200, { name: target.safe });
    return true;
  }

  const recMatch = pathname.match(/^\/api\/assets\/recordings\/([^/]+)$/);
  if (recMatch && req.method === 'DELETE') {
    const target = recordingFile(decodeURIComponent(recMatch[1]));
    if (!target) {
      sendJson(res, 400, { error: 'Invalid recording name' });
      return true;
    }
    try {
      await fsp.unlink(target.file);
    } catch (err) {
      if (err?.code !== 'ENOENT') throw err;
      sendJson(res, 404, { error: 'Recording not found' });
      return true;
    }
    res.statusCode = 204;
    res.end();
    return true;
  }

  return false;
}

function attach(server) {
  server.middlewares.use(async (req, res, next) => {
    try {
      if (!req.url || !req.url.startsWith('/api/assets')) return next();
      const host = req.headers.host || 'localhost';
      const url = new URL(req.url, `http://${host}`);
      const handled = await handleApi(req, res, url);
      if (!handled) next();
    } catch (err) {
      console.error('[assetsDisk]', err);
      sendJson(res, 500, { error: err.message || String(err) });
    }
  });
}

export function assetsDiskPlugin() {
  return {
    name: 'assets-disk',
    configureServer(server) {
      ensureDirs().catch((e) => console.warn('[assetsDisk] init', e));
      attach(server);
    },
    configurePreviewServer(server) {
      ensureDirs().catch((e) => console.warn('[assetsDisk] init', e));
      attach(server);
    },
  };
}
