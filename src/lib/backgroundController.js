import { load, save } from './backgroundStore.js';

const HIDE_CAMERA_MODES = new Set(['color', 'image']);

export const CAMERA_PIP = {
  sizeRatio: 0.22,
  maxPx: 200,
  marginPx: 12,
  borderPx: 2,
  borderRadius: 8,
};

export class FaceBackground {
  constructor(containerEl) {
    this.container = containerEl;
    this.backdrop = document.createElement('div');
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

    this.config = load();
    this.imageUrl = null;
    this.screenStream = null;
    this.onScreenShareChange = null;

    if (containerEl) {
      containerEl.insertBefore(this.backdrop, containerEl.firstChild);
      containerEl.insertBefore(this.bgImage, this.backdrop.nextSibling);
      containerEl.insertBefore(this.screenVideo, this.bgImage.nextSibling);
    }
    this.apply();
  }

  setConfig(partial) {
    this.config = { ...this.config, ...partial };
    save(this.config);
    this.apply();
  }

  setImageFile(file) {
    if (this.imageUrl) URL.revokeObjectURL(this.imageUrl);
    if (!file) {
      this.imageUrl = null;
      this.setConfig({ mode: 'camera' });
      return;
    }
    this.imageUrl = URL.createObjectURL(file);
    this.bgImage.src = this.imageUrl;
    this.setConfig({ mode: 'image' });
  }

  clearImage() {
    if (this.imageUrl) URL.revokeObjectURL(this.imageUrl);
    this.imageUrl = null;
    this.bgImage.removeAttribute('src');
    this.bgImage.style.display = 'none';
    this.setConfig({ mode: 'camera' });
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
    if (this.config.mode === 'screen') {
      this.setConfig({ mode: 'camera' });
    } else {
      this.apply();
    }
  }

  shouldShowCamera() {
    if (this.isScreenPipMode()) return true;
    return !HIDE_CAMERA_MODES.has(this.config.mode);
  }

  isScreenPipMode() {
    return this.config.mode === 'screen' && !!this.screenStream;
  }

  _getImageElement() {
    if (this.config.mode !== 'image' || !this.imageUrl) return null;
    if (!this.bgImage.complete || !this.bgImage.naturalWidth) return null;
    return this.bgImage;
  }

  _getScreenVideoElement() {
    if (this.config.mode !== 'screen' || !this.screenStream) return null;
    if (!this.screenVideo.videoWidth) return null;
    return this.screenVideo;
  }

  _getCameraPipRect(w, h) {
    const size = Math.min(Math.min(w, h) * CAMERA_PIP.sizeRatio, CAMERA_PIP.maxPx);
    const margin = CAMERA_PIP.marginPx;
    return {
      x: w - size - margin,
      y: h - size - margin,
      size,
      margin,
    };
  }

  _applyPipTileStyles(el, zIndex = 3) {
    el.style.position = 'absolute';
    el.style.width = `min(22vw, ${CAMERA_PIP.maxPx}px)`;
    el.style.height = `min(22vw, ${CAMERA_PIP.maxPx}px)`;
    el.style.right = `${CAMERA_PIP.marginPx}px`;
    el.style.bottom = `${CAMERA_PIP.marginPx}px`;
    el.style.left = 'auto';
    el.style.top = 'auto';
    el.style.inset = 'auto';
    el.style.objectFit = 'cover';
    el.style.borderRadius = `${CAMERA_PIP.borderRadius}px`;
    el.style.border = `${CAMERA_PIP.borderPx}px solid #2a3544`;
    el.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.45)';
    el.style.zIndex = String(zIndex);
    el.style.overflow = 'hidden';
  }

  _resetCameraVideoStyles(el) {
    el.style.position = '';
    el.style.width = '';
    el.style.height = '';
    el.style.inset = '';
    el.style.left = '';
    el.style.top = '';
    el.style.right = '';
    el.style.bottom = '';
    el.style.objectFit = '';
    el.style.borderRadius = '';
    el.style.border = '';
    el.style.boxShadow = '';
  }

  _applyFullCameraStyles(video) {
    video.style.position = 'absolute';
    video.style.inset = '0';
    video.style.left = '0';
    video.style.top = '0';
    video.style.right = '0';
    video.style.bottom = '0';
    video.style.width = '100%';
    video.style.height = '100%';
    video.style.objectFit = 'cover';
    video.style.borderRadius = '0';
    video.style.border = 'none';
    video.style.boxShadow = 'none';
  }

  drawCameraPip(ctx, video, w, h) {
    if (!video?.videoWidth) return;
    const { x, y, size } = this._getCameraPipRect(w, h);
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

  drawGlCanvasPip(ctx, glCanvas, w, h) {
    if (!glCanvas?.width) return;
    const { x, y, size } = this._getCameraPipRect(w, h);
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

  apply() {
    if (!this.container) return;
    const video = this.container.querySelector('video:not(.bg-image-layer)');
    const { mode, blurPx, color } = this.config;

    this.backdrop.style.backgroundImage = 'none';
    this.backdrop.style.backgroundColor = 'transparent';
    this.bgImage.style.display = 'none';
    this.screenVideo.style.display = 'none';

    if (mode === 'color') {
      this.backdrop.style.backgroundColor = color || '#0a0e14';
    } else if (mode === 'image' && this.imageUrl) {
      this.bgImage.style.display = 'block';
      if (this.bgImage.src !== this.imageUrl) this.bgImage.src = this.imageUrl;
    } else if (mode === 'screen' && this.screenStream) {
      this.screenVideo.style.display = 'block';
    }

    const screenPip = mode === 'screen' && this.screenStream;
    const canvas = this.container.querySelector('canvas');
    if (canvas) {
      if (screenPip) {
        canvas.style.display = '';
        this._applyPipTileStyles(canvas, 4);
        canvas.style.border = 'none';
        canvas.style.boxShadow = 'none';
      } else {
        this._resetCameraVideoStyles(canvas);
        canvas.style.display = '';
        canvas.style.position = '';
        canvas.style.width = '';
        canvas.style.height = '';
        canvas.style.inset = '';
        canvas.style.zIndex = '';
      }
    }

    if (video) {
      const hideCamera = HIDE_CAMERA_MODES.has(mode);

      if (screenPip) {
        this.container.classList.add('screen-share-mode');
        this._applyPipTileStyles(video, 3);
        video.style.visibility = 'visible';
        video.style.opacity = '1';
        video.style.pointerEvents = 'none';
        video.style.filter = 'none';
        video.style.transform = 'scaleX(-1)';
      } else {
        this.container.classList.remove('screen-share-mode');
        this._resetCameraVideoStyles(video);
        if (!hideCamera) this._applyFullCameraStyles(video);
        video.style.visibility = hideCamera ? 'hidden' : 'visible';
        video.style.opacity = hideCamera ? '0' : '1';
        video.style.pointerEvents = hideCamera ? 'none' : '';
        video.style.zIndex = '1';
        if (mode === 'blur') {
          const px = Math.max(0, Math.min(40, Number(blurPx) || 12));
          video.style.filter = `blur(${px}px)`;
          video.style.transform = 'scaleX(-1) scale(1.08)';
        } else {
          video.style.filter = 'none';
          video.style.transform = 'scaleX(-1)';
        }
      }
    } else if (this.container) {
      this.container.classList.remove('screen-share-mode');
    }
  }

  _drawContainMedia(ctx, media, w, h, letterbox = '#0a0e14') {
    const mw = media.videoWidth || media.naturalWidth;
    const mh = media.videoHeight || media.naturalHeight;
    if (!mw || !mh) return false;
    ctx.fillStyle = letterbox;
    ctx.fillRect(0, 0, w, h);
    const scale = Math.min(w / mw, h / mh);
    const dw = mw * scale;
    const dh = mh * scale;
    const dx = (w - dw) / 2;
    const dy = (h - dh) / 2;
    ctx.drawImage(media, dx, dy, dw, dh);
    return true;
  }

  _drawCoverMedia(ctx, media, w, h) {
    const mw = media.videoWidth || media.naturalWidth;
    const mh = media.videoHeight || media.naturalHeight;
    if (!mw || !mh) return false;
    const scale = Math.max(w / mw, h / mh);
    const dw = mw * scale;
    const dh = mh * scale;
    const dx = (w - dw) / 2;
    const dy = (h - dh) / 2;
    ctx.drawImage(media, dx, dy, dw, dh);
    return true;
  }

  draw(ctx, w, h) {
    const { mode, color } = this.config;
    if (mode === 'color') {
      ctx.fillStyle = color || '#0a0e14';
      ctx.fillRect(0, 0, w, h);
    } else if (mode === 'image') {
      const img = this._getImageElement();
      if (img && this._drawCoverMedia(ctx, img, w, h)) return;
      ctx.fillStyle = '#0a0e14';
      ctx.fillRect(0, 0, w, h);
    } else if (mode === 'screen') {
      const screen = this._getScreenVideoElement();
      if (screen && this._drawContainMedia(ctx, screen, w, h)) return;
      ctx.fillStyle = '#0a0e14';
      ctx.fillRect(0, 0, w, h);
    } else {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);
    }
  }
}
