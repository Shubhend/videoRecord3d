import {
  fetchData,
  persistData,
  uploadBackgroundFile,
  deleteBackgroundFile,
} from '../js/assetsClient.js';

const BG_KEY = 'faceFollowBackground_v1';

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

    if (containerEl) {
      containerEl.insertBefore(this.backdrop, containerEl.firstChild);
      containerEl.insertBefore(this.bgImage, this.backdrop.nextSibling);
    }
    this.apply();
    this.hydrateFromDisk();
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
      if (disk && typeof disk === 'object') {
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

  setConfig(partial) {
    this._userTouched = true;
    this.config = { ...this.config, ...partial };
    this.save();
    this.apply();
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
      // Fallback: blob URL for preview if API unavailable
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

  /** Image element for live view + recording composite. */
  getImageElement() {
    if (this.config.mode !== 'image' || !this.imageUrl) return null;
    if (!this.bgImage.complete || !this.bgImage.naturalWidth) return null;
    return this.bgImage;
  }

  refresh() {
    this.apply();
  }

  apply() {
    if (!this.container) return;
    const video = this.container.querySelector('video');
    const { mode, blurPx, color } = this.config;

    this.backdrop.style.backgroundImage = 'none';
    this.backdrop.style.backgroundColor = 'transparent';

    if (mode === 'color') {
      this.backdrop.style.backgroundColor = color || '#0a0e14';
      this.bgImage.style.display = 'none';
    } else if (mode === 'image' && this.imageUrl) {
      this.bgImage.style.display = 'block';
      if (this.bgImage.src !== this.imageUrl) this.bgImage.src = this.imageUrl;
    } else {
      this.bgImage.style.display = 'none';
    }

    if (video) {
      video.style.pointerEvents = 'none';
      // Keep the element in the layout so MindAR can keep reading frames.
      if (mode === 'color' || mode === 'image') {
        video.style.visibility = 'hidden';
        video.style.opacity = '0';
        video.style.filter = 'none';
        video.style.transform = 'scaleX(-1)';
      } else if (mode === 'blur') {
        video.style.visibility = 'visible';
        video.style.opacity = '1';
        const px = Math.max(0, Math.min(40, Number(blurPx) || 12));
        video.style.filter = `blur(${px}px)`;
        video.style.transform = 'scaleX(-1) scale(1.08)';
      } else {
        // Live camera
        video.style.visibility = 'visible';
        video.style.opacity = '1';
        video.style.filter = 'none';
        video.style.transform = 'scaleX(-1)';
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
