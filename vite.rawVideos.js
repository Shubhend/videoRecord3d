import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

/** Letters, numbers, spaces, hyphens. Spaces become single hyphens. */
export function sanitizeRawName(input) {
  const raw = String(input || '')
    .trim()
    .replace(/\.webm$/i, '');
  const cleaned = raw
    .replace(/[^a-zA-Z0-9 _-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (!cleaned || cleaned.length > 80) return '';
  return cleaned;
}

function fileFor(dir, name) {
  const safe = sanitizeRawName(name);
  if (!safe) return null;
  const root = path.resolve(dir);
  const file = path.resolve(root, `${safe}.webm`);
  if (file !== path.join(root, `${safe}.webm`)) return null;
  return { safe, file };
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function sendFile(req, res, filePath) {
  const stat = fs.statSync(filePath);
  res.setHeader('Content-Type', 'video/webm');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'no-store');

  const range = req.headers.range;
  if (!range) {
    res.statusCode = 200;
    res.setHeader('Content-Length', stat.size);
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || stat.size === 0) {
    res.statusCode = 416;
    res.setHeader('Content-Range', `bytes */${stat.size}`);
    res.end();
    return;
  }
  let start = match[1] === '' ? 0 : Number(match[1]);
  let end = match[2] === '' ? stat.size - 1 : Number(match[2]);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= stat.size) {
    res.statusCode = 416;
    res.setHeader('Content-Range', `bytes */${stat.size}`);
    res.end();
    return;
  }
  end = Math.min(end, stat.size - 1);
  res.statusCode = 206;
  res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
  res.setHeader('Content-Length', end - start + 1);
  fs.createReadStream(filePath, { start, end }).pipe(res);
}

async function writeBody(req, filePath) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.partial`;
  try {
    await pipeline(req, fs.createWriteStream(tmp));
    const stat = await fs.promises.stat(tmp);
    if (!stat.size) {
      const err = new Error('Empty recording');
      err.status = 400;
      throw err;
    }
    await fs.promises.rename(tmp, filePath);
  } catch (err) {
    await fs.promises.unlink(tmp).catch(() => {});
    throw err;
  }
}

async function listNames(dir) {
  await fs.promises.mkdir(dir, { recursive: true });
  const entries = await fs.promises.readdir(dir);
  return entries
    .filter((name) => name.toLowerCase().endsWith('.webm') && !name.endsWith('.partial'))
    .map((name) => name.slice(0, -5))
    .sort((a, b) => a.localeCompare(b));
}

async function handle(req, res, dir) {
  const url = new URL(req.url || '/', 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);

  if (pathname === '/api/raw-videos' && req.method === 'GET') {
    sendJson(res, 200, { names: await listNames(dir) });
    return true;
  }

  if (pathname === '/api/raw-videos' && req.method === 'POST') {
    const target = fileFor(dir, url.searchParams.get('name'));
    if (!target) {
      sendJson(res, 400, { error: 'Enter a name using letters, numbers, spaces, or hyphens' });
      return true;
    }
    await writeBody(req, target.file);
    sendJson(res, 200, { name: target.safe });
    return true;
  }

  if (req.method === 'DELETE' && pathname.startsWith('/api/raw-videos/')) {
    const target = fileFor(dir, pathname.slice('/api/raw-videos/'.length));
    if (!target) {
      sendJson(res, 400, { error: 'Invalid recording name' });
      return true;
    }
    try {
      await fs.promises.unlink(target.file);
    } catch (err) {
      if (err?.code === 'ENOENT') {
        sendJson(res, 404, { error: 'Recording not found' });
        return true;
      }
      throw err;
    }
    res.statusCode = 204;
    res.end();
    return true;
  }

  if (req.method === 'GET' && pathname.startsWith('/recordings/')) {
    const target = fileFor(dir, path.basename(pathname));
    if (!target || !fs.existsSync(target.file)) {
      sendJson(res, 404, { error: 'Recording not found' });
      return true;
    }
    sendFile(req, res, target.file);
    return true;
  }

  return false;
}

export function rawVideosPlugin(rootDir) {
  const dir = path.resolve(rootDir, 'recordings');
  const attach = (middlewares) => {
    middlewares.use(async (req, res, next) => {
      try {
        const handled = await handle(req, res, dir);
        if (!handled) next();
      } catch (err) {
        if (res.headersSent) return;
        const status = err?.status || 500;
        sendJson(res, status, { error: err?.message || 'Recording error' });
      }
    });
  };
  return {
    name: 'raw-videos',
    configureServer(server) {
      attach(server.middlewares);
    },
    configurePreviewServer(server) {
      attach(server.middlewares);
    },
  };
}
