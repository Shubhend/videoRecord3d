/** Named raw camera files saved under recordings/ by the Vite dev server. */

export function sanitizeRawName(input) {
  const raw = String(input || '')
    .trim()
    .replace(/\.webm$/i, '');
  const cleaned = raw
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
  return `/recordings/${encodeURIComponent(sanitizeRawName(name))}.webm`;
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
  const res = await fetch('/api/raw-videos');
  if (!res.ok) throw new Error(await readError(res));
  const data = await res.json();
  return Array.isArray(data.names) ? data.names : [];
}

export async function saveRawVideo(name, blob) {
  const safe = sanitizeRawName(name);
  const res = await fetch(`/api/raw-videos?name=${encodeURIComponent(safe)}`, {
    method: 'POST',
    headers: { 'Content-Type': blob.type || 'video/webm' },
    body: blob,
  });
  if (!res.ok) throw new Error(await readError(res));
  const data = await res.json();
  return data.name || safe;
}

export async function deleteRawVideo(name) {
  const safe = sanitizeRawName(name);
  const res = await fetch(`/api/raw-videos/${encodeURIComponent(safe)}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 204) throw new Error(await readError(res));
}
