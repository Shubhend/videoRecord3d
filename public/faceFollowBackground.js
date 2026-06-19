const BG_KEY = 'faceFollowBackground_v1';

/** Modes where the live camera feed is hidden but still used for face tracking. */
const HIDE_CAMERA_MODES = new Set(['color', 'image', 'screen']);

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
    this.onScreenShareChange = null;

    if (containerEl) {
      containerEl.insertBefore(this.backdrop, containerEl.firstChild);
      containerEl.insertBefore(this.bgImage, this.backdrop.nextSibling);
      containerEl.insertBefore(this.screenVideo, this.bgImage.nextSibling);
    }
    this.apply();
  }

  load() {
    try {
      const raw = localStorage.getItem(BG_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        // Screen share cannot persist across reloads.
        if (parsed.mode === 'screen') parsed.mode = 'camera';
        return { mode: 'camera', blurPx: 12, color: '#0a0e14', ...parsed };
      }
    } catch {
      /* ignore */
    }
    return { mode: 'camera', blurPx: 12, color: '#0a0e14' };
  }

  save() {
    try {
      localStorage.setItem(BG_KEY, JSON.stringify(this.config));
    } catch {
      /* ignore */
    }
  }

  setConfig(partial) {
    this.config = { ...this.config, ...partial };
    this.save();
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
  }

  isScreenActive() {
    return this.config.mode === 'screen' && !!this.screenStream;
  }

  /** Image element for live view + recording composite. */
  getImageElement() {
    if (this.config.mode !== 'image' || !this.imageUrl) return null;
    if (!this.bgImage.complete || !this.bgImage.naturalWidth) return null;
    return this.bgImage;
  }

  /** Screen video element for live view + recording composite. */
  getScreenVideoElement() {
    if (this.config.mode !== 'screen' || !this.screenStream) return null;
    if (!this.screenVideo.videoWidth) return null;
    return this.screenVideo;
  }

  /** Whether the camera feed should be visible in the live view / recording. */
  shouldShowCamera() {
    return !HIDE_CAMERA_MODES.has(this.config.mode);
  }

  refresh() {
    this.apply();
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

    if (video) {
      const hideCamera = HIDE_CAMERA_MODES.has(mode);
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
  }

  /** Draw cover-fit media into ctx (shared by image + screen). */
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
      const img = this.getImageElement();
      if (img && this._drawCoverMedia(ctx, img, w, h)) return;
      ctx.fillStyle = '#0a0e14';
      ctx.fillRect(0, 0, w, h);
    } else if (mode === 'screen') {
      const screen = this.getScreenVideoElement();
      if (screen && this._drawCoverMedia(ctx, screen, w, h)) return;
      ctx.fillStyle = '#0a0e14';
      ctx.fillRect(0, 0, w, h);
    } else {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);
    }
  }
}
