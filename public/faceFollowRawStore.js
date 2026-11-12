/** Named raw camera files saved under public/assets/recordings/. */

export function sanitizeRawName(input) {
  const cleaned = String(input || '')
    .trim()
    .replace(/\.webm$/i, '')
    .replace(/[^a-zA-Z0-9 _-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (!cleaned || cleaned.length > 80) {
    throw new Error('Enter a name using letters, numbers, spaces, or hyphens');
  }
  return cleaned;
}

export function rawVideoUrl(name) {
  return `./assets/recordings/${encodeURIComponent(sanitizeRawName(name))}.webm`;
}

async function readError(res) {
  try {
    const data = await res.json();
    if (data?.error) return data.error;
  } catch {
    /* body was not JSON */
  }
  return res.statusText || 'Request failed';
}

export async function listRawVideos() {
  const res = await fetch('./api/assets/recordings');
  if (!res.ok) throw new Error(await readError(res));
  const data = await res.json();
  return Array.isArray(data.names) ? data.names : [];
}

export async function saveRawVideo(name, blob) {
  const safe = sanitizeRawName(name);
  const res = await fetch(`./api/assets/recordings?name=${encodeURIComponent(safe)}`, {
    method: 'POST',
    headers: { 'X-Recording-Name': safe },
    body: blob,
  });
  if (!res.ok) {
    const detail = await readError(res);
    throw new Error(detail === 'Not Found' ? 'Save route missing. Restart the dev server and try again.' : detail);
  }
  const data = await res.json();
  return data.name || safe;
}

export async function saveOutputVideo(blob) {
  const ext = blob.type && blob.type.includes('mp4') ? 'mp4' : 'webm';
  const name = `output-${Date.now()}`;
  const res = await fetch(`./api/assets/outputs?name=${encodeURIComponent(name)}&ext=${ext}`, {
    method: 'POST',
    headers: { 'X-Recording-Name': name },
    body: blob,
  });
  if (!res.ok) throw new Error(await readError(res));
  const data = await res.json();
  return data.url || `assets/outputs/${name}.${ext}`;
}

export async function deleteRawVideo(name) {
  const safe = sanitizeRawName(name);
  const res = await fetch(`./api/assets/recordings/${encodeURIComponent(safe)}`, {
    method: 'DELETE',
  });
  if (!res.ok && res.status !== 204) throw new Error(await readError(res));
}
