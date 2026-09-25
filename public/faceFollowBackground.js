import {
  fetchData,
  persistData,
  uploadBackgroundFile,
  deleteBackgroundFile,
} from '../js/assetsClient.js';

const BG_KEY = 'faceFollowBackground_v1';

/** Modes where the live camera feed is fully hidden (still used for face tracking). */
const HIDE_CAMERA_MODES = new Set(['color', 'image']);

/** Camera PiP size when screen sharing (matches live CSS + recording composite). */
export const CAMERA_PIP = {
  sizeRatio: 0.22,
  maxPx: 200,
  marginPx: 12,
  borderPx: 2,
  borderRadius: 8,
};

/**
 * Background overlay sits BETWEEN the MindAR camera <video> and the WebGL
 * <canvas> so solid color / image cover the camera without changing video
 * layout (which would break face-mesh alignment) — except during screen share
 * layouts (PiP / split), where CSS intentionally repositions the camera tile.
 */
export class FaceBackground {
  constructor(containerEl) {
    this.container = containerEl;
    this.backdrop = document.createElement('div');
    this.backdrop.id = 'bg-backdrop';
    this.backdrop.className = 'bg-backdrop';

    this.bgImage = document.createElement('img');
    this.bgImage.className = 'bg-image-layer';
    this.bgImage.alt = '';
    this.bgImage.decoding = 'async';
    this.bgImage.style.display = 'none';

    this.screenVideo = document.createElement('video');
    this.screenVideo.className = 'bg-image-layer';
    this.screenVideo.playsInline = true;
    this.screenVideo.muted = true;
    this.screenVideo.autoplay = true;
    this.screenVideo.style.display = 'none';

    this.config = this.load();
    this.imageUrl = null;
    this.screenStream = null;
    this._userTouched = false;
    this.onChange = null;
    this.onScreenShareChange = null;

    this.ensureMounted();
    this.apply();
    this.hydrateFromDisk();
  }

  /**
   * Place overlays just before the WebGL canvas (after the video).
   * Never change video position/size/transform outside screen-share layouts.
   */
  ensureMounted() {
    if (!this.container) return;
    const canvas = this.container.querySelector('canvas');
    const anchor = canvas || null;

    const insertBeforeAnchor = (el) => {
      if (el.parentNode !== this.container) {
        if (anchor) this.container.insertBefore(el, anchor);
        else this.container.appendChild(el);
      } else if (anchor && el.nextSibling !== anchor && ![this.backdrop, this.bgImage, this.screenVideo].includes(el.nextSibling)) {
        this.container.insertBefore(el, anchor);
      }
    };

    insertBeforeAnchor(this.backdrop);
    insertBeforeAnchor(this.bgImage);
    insertBeforeAnchor(this.screenVideo);

    // Keep order: … video → backdrop → image → screen → canvas
    if (anchor) {
      this.container.insertBefore(this.backdrop, anchor);
      this.container.insertBefore(this.bgImage, anchor);
      this.container.insertBefore(this.screenVideo, anchor);
    }
  }

  load() {
    try {
      const raw = localStorage.getItem(BG_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          mode: parsed.mode === 'screen' ? 'camera' : parsed.mode || 'camera',
          blurPx: parsed.blurPx ?? 12,
          color: parsed.color || '#0a0e14',
          imageFile: parsed.imageFile || null,
          layout: parsed.layout === 'pip' ? 'pip' : 'split',
        };
      }
    } catch {
      /* ignore */
    }
    return {
      mode: 'camera',
      blurPx: 12,
      color: '#0a0e14',
      imageFile: null,
      layout: 'split',
    };
  }

  async hydrateFromDisk() {
    try {
      const disk = await fetchData('background');
      if (this._userTouched) return;
      if (disk && typeof disk === 'object' && Object.keys(disk).length > 0) {
        const mode = disk.mode === 'screen' ? 'camera' : disk.mode || 'camera';
        this.config = {
          mode,
          blurPx: disk.blurPx ?? 12,
          color: disk.color || '#0a0e14',
          imageFile: disk.imageFile || null,
          layout: disk.layout === 'pip' ? 'pip' : 'split',
        };
        try {
          localStorage.setItem(BG_KEY, JSON.stringify(this.config));
        } catch {
          /* ignore */
        }
        if (this.config.mode === 'image' && this.config.imageFile) {
          this.imageUrl = new URL(
            `assets/backgrounds/${this.config.imageFile}`,
            document.baseURI || location.href
          ).href;
          this.bgImage.src = this.imageUrl;
        }
        this.apply();
        this.notify();
      }
    } catch (err) {
      console.warn('[FaceBackground] disk hydrate failed:', err);
    }
  }

  save() {
    try {
      localStorage.setItem(BG_KEY, JSON.stringify(this.config));
    } catch {
      /* ignore */
    }
    const persistable = { ...this.config };
    if (persistable.mode === 'screen') persistable.mode = 'camera';
    persistData('background', persistable);
  }

  notify() {
    try {
      this.onChange?.(this.config);
    } catch (e) {
      console.warn('[FaceBackground] onChange failed:', e);
    }
  }

  setConfig(partial) {
    this._userTouched = true;
    this.config = { ...this.config, ...partial };
    this.save();
    this.apply();
    this.notify();
  }

  async setImageFile(file) {
    if (this.imageUrl && this.imageUrl.startsWith('blob:')) {
      URL.revokeObjectURL(this.imageUrl);
    }
    if (!file) {
      this.imageUrl = null;
      this.setConfig({ mode: 'camera', imageFile: null });
      return;
    }
    this.stopScreenShare();
    const prev = this.config.imageFile;
    try {
      const uploaded = await uploadBackgroundFile(file);
      if (prev && prev !== uploaded.file) {
        try {
          await deleteBackgroundFile(prev);
        } catch {
          /* ignore */
        }
      }
      this.imageUrl = new URL(
        uploaded.url,
        document.baseURI || location.href
      ).href;
      this.bgImage.src = this.imageUrl;
      this.setConfig({ mode: 'image', imageFile: uploaded.file });
    } catch (err) {
      console.warn('[FaceBackground] upload failed, using blob URL:', err);
      this.imageUrl = URL.createObjectURL(file);
      this.bgImage.src = this.imageUrl;
      this.setConfig({ mode: 'image' });
    }
  }

  async clearImage() {
    const prev = this.config.imageFile;
    if (this.imageUrl && this.imageUrl.startsWith('blob:')) {
      URL.revokeObjectURL(this.imageUrl);
    }
    this.imageUrl = null;
    this.bgImage.removeAttribute('src');
    this.bgImage.style.display = 'none';
    if (prev) {
      try {
        await deleteBackgroundFile(prev);
      } catch {
        /* ignore */
      }
    }
    this.setConfig({ mode: 'camera', imageFile: null });
  }

  async startScreenShare() {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new Error('Screen sharing is not supported in this browser');
    }
    this.stopScreenShare();
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { cursor: 'always' },
      audio: false,
    });
    this.screenStream = stream;
    this.screenVideo.srcObject = stream;
    await this.screenVideo.play().catch(() => {});
    stream.getVideoTracks()[0]?.addEventListener('ended', () => {
      this.stopScreenShare();
      if (this.config.mode === 'screen') this.setConfig({ mode: 'camera' });
      this.onScreenShareChange?.(false);
    });
    this.setConfig({ mode: 'screen' });
    this.onScreenShareChange?.(true);
    return stream;
  }

  stopScreenShare() {
    if (this.screenStream) {
      this.screenStream.getTracks().forEach((t) => t.stop());
      this.screenStream = null;
    }
    this.screenVideo.srcObject = null;
    this.screenVideo.style.display = 'none';
    this.onScreenShareChange?.(false);
    this.apply();
  }

  isScreenActive() {
    return this.config.mode === 'screen' && !!this.screenStream;
  }

  getImageElement() {
    if (this.config.mode !== 'image' || !this.imageUrl) return null;
    if (!this.bgImage.complete || !this.bgImage.naturalWidth) return null;
    return this.bgImage;
  }

  getScreenVideoElement() {
    if (this.config.mode !== 'screen' || !this.screenStream) return null;
    if (!this.screenVideo.videoWidth) return null;
    return this.screenVideo;
  }

  shouldShowCamera() {
    if (this.isScreenLayoutActive()) return true;
    return !HIDE_CAMERA_MODES.has(this.config.mode);
  }

  /** Screen share active with either PiP or split layout. */
  isScreenLayoutActive() {
    return this.config.mode === 'screen' && !!this.screenStream;
  }

  /** Meet-style PiP (full screen + corner avatar). */
  isScreenPipMode() {
    return this.isScreenLayoutActive() && this.config.layout !== 'split';
  }

  /** Top = screen share, bottom = character canvas. */
  isScreenSplitMode() {
    return this.isScreenLayoutActive() && this.config.layout === 'split';
  }

  getSplitRects(w, h) {
    const topH = Math.floor(h / 2);
    return {
      top: { x: 0, y: 0, w, h: topH },
      bottom: { x: 0, y: topH, w, h: h - topH },
    };
  }

  getCameraPipRect(w, h) {
    const size = Math.min(Math.min(w, h) * CAMERA_PIP.sizeRatio, CAMERA_PIP.maxPx);
    const margin = CAMERA_PIP.marginPx;
    return {
      x: w - size - margin,
      y: h - size - margin,
      size,
      margin,
    };
  }

  _drawCover(ctx, source, sw, sh, dx, dy, dw, dh, { mirror = false, filter = 'none' } = {}) {
    if (!sw || !sh || !dw || !dh) return;
    const scale = Math.max(dw / sw, dh / sh);
    const tw = sw * scale;
    const th = sh * scale;
    const sx = (tw - dw) / 2;
    const sy = (th - dh) / 2;
    ctx.save();
    ctx.beginPath();
    ctx.rect(dx, dy, dw, dh);
    ctx.clip();
    if (filter && filter !== 'none') ctx.filter = filter;
    if (mirror) {
      ctx.translate(dx + dw, dy);
      ctx.scale(-1, 1);
      ctx.drawImage(source, -sx, -sy, tw, th);
    } else {
      ctx.drawImage(source, dx - sx, dy - sy, tw, th);
    }
    ctx.restore();
    ctx.filter = 'none';
  }

  _drawContain(ctx, source, sw, sh, dx, dy, dw, dh, fill = '#0a0e14') {
    ctx.fillStyle = fill;
    ctx.fillRect(dx, dy, dw, dh);
    if (!sw || !sh) return;
    const scale = Math.min(dw / sw, dh / sh);
    const tw = sw * scale;
    const th = sh * scale;
    const ox = dx + (dw - tw) / 2;
    const oy = dy + (dh - th) / 2;
    ctx.drawImage(source, ox, oy, tw, th);
  }

  /** Draw mirrored camera feed as a square PiP (bottom-right). Used in recording. */
  drawCameraPip(ctx, video, w, h) {
    if (!video?.videoWidth) return;
    const { x, y, size } = this.getCameraPipRect(w, h);
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const scale = Math.max(size / vw, size / vh);
    const dw = vw * scale;
    const dh = vh * scale;
    const sx = (dw - size) / 2;
    const sy = (dh - size) / 2;
    const r = CAMERA_PIP.borderRadius;

    ctx.save();
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(x, y, size, size, r);
    } else {
      ctx.rect(x, y, size, size);
    }
    ctx.clip();
    ctx.translate(x + size, y);
    ctx.scale(-1, 1);
    ctx.drawImage(video, -sx, -sy, dw, dh);
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = '#2a3544';
    ctx.lineWidth = CAMERA_PIP.borderPx;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(x, y, size, size, r);
    } else {
      ctx.rect(x, y, size, size);
    }
    ctx.stroke();
    ctx.restore();
  }

  /** Draw avatar WebGL canvas clipped to the camera PiP tile. */
  drawGlCanvasPip(ctx, glCanvas, w, h) {
    if (!glCanvas?.width) return;
    const { x, y, size } = this.getCameraPipRect(w, h);
    const r = CAMERA_PIP.borderRadius;
    const cw = glCanvas.width;
    const ch = glCanvas.height;
    const scale = Math.max(size / cw, size / ch);
    const dw = cw * scale;
    const dh = ch * scale;
    const dx = x + (size - dw) / 2;
    const dy = y + (size - dh) / 2;

    ctx.save();
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(x, y, size, size, r);
    } else {
      ctx.rect(x, y, size, size);
    }
    ctx.clip();
    ctx.drawImage(glCanvas, dx, dy, dw, dh);
    ctx.restore();
  }

  drawSplitScreen(ctx, screenVideo, w, h) {
    const { top } = this.getSplitRects(w, h);
    const sv = screenVideo || this.getScreenVideoElement();
    this._drawContain(
      ctx,
      sv,
      sv?.videoWidth || 0,
      sv?.videoHeight || 0,
      top.x,
      top.y,
      top.w,
      top.h
    );
  }

  drawSplitCamera(ctx, video, w, h) {
    if (!video?.videoWidth) return;
    const { bottom } = this.getSplitRects(w, h);
    this._drawCover(ctx, video, video.videoWidth, video.videoHeight, bottom.x, bottom.y, bottom.w, bottom.h, {
      mirror: true,
    });
  }

  drawSplitGlCanvas(ctx, glCanvas, w, h) {
    if (!glCanvas?.width) return;
    const { bottom } = this.getSplitRects(w, h);
    this._drawCover(ctx, glCanvas, glCanvas.width, glCanvas.height, bottom.x, bottom.y, bottom.w, bottom.h);
  }

  _clearLayoutClasses() {
    this.container?.classList.remove('screen-share-mode', 'screen-split-mode');
  }

  _resetCameraVideoStyles(video) {
    if (!video) return;
    video.style.position = '';
    video.style.width = '';
    video.style.height = '';
    video.style.inset = '';
    video.style.left = '';
    video.style.top = '';
    video.style.right = '';
    video.style.bottom = '';
    video.style.objectFit = '';
    video.style.borderRadius = '';
    video.style.border = '';
    video.style.boxShadow = '';
    video.style.transform = '';
    video.style.zIndex = '';
  }

  _resetCanvasStyles(canvas) {
    if (!canvas) return;
    canvas.style.position = '';
    canvas.style.width = '';
    canvas.style.height = '';
    canvas.style.inset = '';
    canvas.style.left = '';
    canvas.style.top = '';
    canvas.style.right = '';
    canvas.style.bottom = '';
    canvas.style.borderRadius = '';
    canvas.style.border = '';
    canvas.style.boxShadow = '';
    canvas.style.zIndex = '';
    canvas.style.overflow = '';
  }

  refresh() {
    this.ensureMounted();
    this.apply();
    this.notify();
  }

  apply() {
    if (!this.container) return;
    this.ensureMounted();

    const { mode, blurPx, color, layout } = this.config;
    const cameraVideo = this.container.querySelector('video:not(.bg-image-layer)');
    const canvas = this.container.querySelector('canvas');

    this.backdrop.style.display = 'none';
    this.backdrop.style.backgroundColor = 'transparent';
    this.backdrop.style.backgroundImage = 'none';
    this.bgImage.style.display = 'none';
    this.screenVideo.style.display = 'none';
    this._clearLayoutClasses();
    this._resetCameraVideoStyles(cameraVideo);
    this._resetCanvasStyles(canvas);

    if (mode === 'color') {
      this.backdrop.style.display = 'block';
      this.backdrop.style.backgroundColor = color || '#0a0e14';
    } else if (mode === 'image' && this.imageUrl) {
      this.bgImage.style.display = 'block';
      if (this.bgImage.src !== this.imageUrl) this.bgImage.src = this.imageUrl;
    } else if (mode === 'screen' && this.screenStream) {
      this.screenVideo.style.display = 'block';
      if (layout === 'split') {
        this.container.classList.add('screen-split-mode');
      } else {
        this.container.classList.add('screen-share-mode');
      }
    }

    // Blur only — never rewrite video transform/size outside screen layouts.
    if (cameraVideo) {
      if (mode === 'blur') {
        const px = Math.max(0, Math.min(40, Number(blurPx) || 12));
        cameraVideo.style.filter = `blur(${px}px)`;
      } else {
        cameraVideo.style.filter = 'none';
      }
    }
  }

  draw(ctx, w, h) {
    const { mode, color } = this.config;
    if (mode === 'color') {
      ctx.fillStyle = color || '#0a0e14';
      ctx.fillRect(0, 0, w, h);
    } else if (mode === 'image') {
      const img = this.getImageElement();
      if (img) {
        const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
        const dw = img.naturalWidth * scale;
        const dh = img.naturalHeight * scale;
        const dx = (w - dw) / 2;
        const dy = (h - dh) / 2;
        ctx.drawImage(img, dx, dy, dw, dh);
      } else {
        ctx.fillStyle = '#0a0e14';
        ctx.fillRect(0, 0, w, h);
      }
    } else if (mode === 'screen') {
      if (this.isScreenSplitMode()) {
        this.drawSplitScreen(ctx, this.getScreenVideoElement(), w, h);
      } else {
        const sv = this.getScreenVideoElement();
        this._drawContain(ctx, sv, sv?.videoWidth || 0, sv?.videoHeight || 0, 0, 0, w, h);
      }
    } else {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);
    }
  }
}
