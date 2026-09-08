/**
 * Prefer native MP4 from MediaRecorder; transcode WebM → MP4 when needed (Chrome).
 */
let _ffmpeg = null;

function extensionFor(mimeType) {
  if (!mimeType) return 'webm';
  return mimeType.includes('mp4') ? 'mp4' : 'webm';
}

export function pickFaceRecordMime(hasAudio) {
  if (typeof MediaRecorder === 'undefined') return '';
  const types = hasAudio
    ? [
        'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
        'video/mp4;codecs=h264,aac',
        'video/mp4',
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm',
      ]
    : [
        'video/mp4;codecs=avc1.42E01E',
        'video/mp4',
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm',
      ];
  for (const t of types) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

async function loadFfmpeg(onProgress) {
  if (_ffmpeg?.loaded) return _ffmpeg;
  const { FFmpeg } = await import(
    'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/+esm'
  );
  const { fetchFile, toBlobURL } = await import(
    'https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/+esm'
  );
  const ffmpeg = new FFmpeg();
  ffmpeg.on('progress', ({ progress }) => {
    onProgress?.(Math.round((progress || 0) * 100));
  });
  const base = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm';
  await ffmpeg.load({
    coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
  });
  _ffmpeg = { ffmpeg, fetchFile, loaded: true };
  return _ffmpeg;
}

/** @param {Blob} blob @param {(pct:number)=>void} [onProgress] */
export async function ensureMp4Blob(blob, onProgress) {
  if (!blob) return null;
  if (blob.type.includes('mp4')) return blob;
  try {
    onProgress?.(0);
    const { ffmpeg, fetchFile } = await loadFfmpeg(onProgress);
    await ffmpeg.writeFile('input.webm', await fetchFile(blob));
    await ffmpeg.exec(['-i', 'input.webm', '-c:v', 'libx264', '-preset', 'fast', '-c:a', 'aac', 'output.mp4']);
    const data = await ffmpeg.readFile('output.mp4');
    await ffmpeg.deleteFile('input.webm');
    await ffmpeg.deleteFile('output.mp4');
    return new Blob([data], { type: 'video/mp4' });
  } catch (err) {
    console.warn('[face-follow] MP4 transcode failed:', err);
    return blob;
  }
}

export function downloadFaceVideo(blob, filename = 'face-follow') {
  if (!blob) return;
  const ext = extensionFor(blob.type);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${filename}.${ext}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
