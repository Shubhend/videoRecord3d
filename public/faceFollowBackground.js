import {
  fetchData,
  persistData,
  uploadBackgroundFile,
  deleteBackgroundFile,
} from '../js/assetsClient.js';

const BG_KEY = 'faceFollowBackground_v1';

/**
 * Background overlay sits BETWEEN the MindAR camera <video> and the WebGL
 * <canvas> so solid color / image cover the camera without changing video
 * layout (which would break face-mesh alignment).
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

    this.config = this.load();
    this.imageUrl = null;
    this._userTouched = false;
    this.onChange = null;

    this.ensureMounted();
    this.apply();
    this.hydrateFromDisk();
  }

  /**
   * Place overlays just before the WebGL canvas (after the video).
   * Never change video position/size/transform — MindAR needs those intact.
   */
  ensureMounted() {
    if (!this.container) return;
    const canvas = this.container.querySelector('canvas');
    const anchor = canvas || null;

    if (this.backdrop.parentNode !== this.container) {
      if (anchor) this.container.insertBefore(this.backdrop, anchor);
      else this.container.appendChild(this.backdrop);
    } else if (anchor && this.backdrop.nextSibling !== this.bgImage && this.backdrop.nextSibling !== anchor) {
      this.container.insertBefore(this.backdrop, anchor);
    }

    if (this.bgImage.parentNode !== this.container) {
      if (anchor) this.container.insertBefore(this.bgImage, anchor);
      else this.container.appendChild(this.bgImage);
    } else if (anchor && this.bgImage.nextSibling !== anchor) {
      this.container.insertBefore(this.bgImage, anchor);
    }

    // Keep order: … video → backdrop → image → canvas
    if (anchor) {
      this.container.insertBefore(this.backdrop, anchor);
      this.container.insertBefore(this.bgImage, anchor);
    }
  }

  load() {
    try {
      const raw = localStorage.getItem(BG_KEY);
      if (raw) {
        return {
          mode: 'camera',
          blurPx: 12,
          color: '#0a0e14',
          imageFile: null,
          ...JSON.parse(raw),
        };
      }
    } catch {
      /* ignore */
    }
    return { mode: 'camera', blurPx: 12, color: '#0a0e14', imageFile: null };
  }

  async hydrateFromDisk() {
    try {
      const disk = await fetchData('background');
      if (this._userTouched) return;
      if (disk && typeof disk === 'object' && Object.keys(disk).length > 0) {
        this.config = {
          mode: disk.mode || 'camera',
          blurPx: disk.blurPx ?? 12,
          color: disk.color || '#0a0e14',
          imageFile: disk.imageFile || null,
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
    persistData('background', this.config);
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

  getImageElement() {
    if (this.config.mode !== 'image' || !this.imageUrl) return null;
    if (!this.bgImage.complete || !this.bgImage.naturalWidth) return null;
    return this.bgImage;
  }

  refresh() {
    this.ensureMounted();
    this.apply();
    this.notify();
  }

  apply() {
    if (!this.container) return;
    this.ensureMounted();

    const { mode, blurPx, color } = this.config;

    // Reset overlay
    this.backdrop.style.display = 'none';
    this.backdrop.style.backgroundColor = 'transparent';
    this.backdrop.style.backgroundImage = 'none';
    this.bgImage.style.display = 'none';

    if (mode === 'color') {
      this.backdrop.style.display = 'block';
      this.backdrop.style.backgroundColor = color || '#0a0e14';
    } else if (mode === 'image' && this.imageUrl) {
      this.bgImage.style.display = 'block';
      if (this.bgImage.src !== this.imageUrl) this.bgImage.src = this.imageUrl;
    }

    // Blur only — never rewrite video transform/size (breaks MindAR face alignment).
    const video = this.container.querySelector('video');
    if (video) {
      if (mode === 'blur') {
        const px = Math.max(0, Math.min(40, Number(blurPx) || 12));
        video.style.filter = `blur(${px}px)`;
      } else {
        video.style.filter = 'none';
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
    } else {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);
    }
  }
}
