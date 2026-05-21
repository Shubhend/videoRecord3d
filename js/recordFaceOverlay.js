/**
 * Record page face overlay — explicit pipeline:
 *
 *   Webcam (video element)
 *     ↓
 *   Face detection + tracking (Jeeliz Face Filter, fallback MediaPipe)
 *     ↓
 *   Head pose estimation (rx,ry,rz + scale from Jeeliz or landmarks)
 *     ↓
 *   3D face model alignment (VRM position / expressions)
 *     ↓
 *   WebGL overlay render (Three.js transparent canvas)
 */

import { VRMLoader } from './vrmLoader.js';
import { AvatarRig } from './avatarRig.js';
import { Tracking } from './tracking.js';
import { JeelizFaceTracking } from './jeelizFaceTracking.js';
import {
  applyHybridMeshVisibility,
  applyRecordHeadVisibility,
  countVrmMeshes,
  fitHeadPortrait,
  fitFullBodyPortrait,
  prepareVrmMaterialsForOverlay,
  resetHybridHeadScale,
  stripOverlayArtifacts,
} from './vrmHybridFace.js';
import {
  alignVrmFace,
  applyFaceScale,
  storeFitAnchor,
} from './faceModelAlignment.js';
import {
  applyInitialPlacement,
  clampVrmSceneToViewBox,
} from './modelPlacementOffset.js';
import {
  createJeelizPerspectiveCamera,
  updateJeelizPerspectiveCamera,
} from './jeelizPerspectiveCamera.js';
import { ensureJeelizFaceRoot } from './jeelizUpdatePoses.js';
import { getHeadCoordinateReport } from './headCoordinateMatch.js';
import { sliderToPlacementNorm } from './modelPlacementOffset.js';
import { resetFaceFollow } from './recordFaceFollow.js';
import {
  getRecordRigSettings,
  getPipelineStatus,
} from './recordPipeline.js';

export class RecordFaceOverlay {
  constructor(opts) {
    this.video = opts.video;
    this.overlayCanvas = opts.overlayCanvas;
    this.compositeCanvas = opts.compositeCanvas;
    this.onStatus = opts.onStatus || (() => {});
    this.onLoading = opts.onLoading || (() => {});
    this.onDiagnostics = opts.onDiagnostics || (() => {});
    this.onPipeline = opts.onPipeline || (() => {});

    this.faceScale = 1.2;
    this.bodyScale = 0;
    this.offsetX = 0;
    this.offsetY = 0;
    this.offsetRotY = 0;
    this.alignStrength = 0.85;
    this.reverseHeadPosition = false;
    this.reverseHeadRotation = false;
    this.reverseFaceMotion = false;
    this.mirror = true;
    this.showFullBody = false;
    this.modelName = '';
    this.enabled = false;
    this.lastRenderAt = 0;
    this.lastAlignedAt = 0;
    this._trackingStarted = false;
    this._useJeelizPose = false;
    this._jeelizScaleW = 1;
    this._jeelizCanvasAspect = 1;
    this.faceRoot = null;
    this._orthoCamera = null;

    this.scene = new THREE.Scene();
    this._setupLighting();

    const aspect = 16 / 9;
    const halfH = 0.55;
    const halfW = halfH * aspect;
    this.camera = new THREE.OrthographicCamera(
      -halfW,
      halfW,
      halfH,
      -halfH,
      0.01,
      20
    );
    this.camera.position.set(0, 0, 2);
    this.camera.lookAt(0, 0, 0);
    this._orthoCamera = this.camera;

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.overlayCanvas,
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.autoClear = true;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    if (THREE.sRGBEncoding) {
      this.renderer.outputEncoding = THREE.sRGBEncoding;
    }
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;

    this.clock = new THREE.Clock();
    this.vrmLoader = null;
    this.vrm = null;
    this.avatarRig = null;
    this.tracking = null;
    this.jeelizTracking = null;
    this.trackingBackend = 'jeeliz';
    this._raf = null;
    this._resizeObserver = null;
    this._diagTick = 0;
  }

  _setupLighting() {
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.95));
    const key = new THREE.DirectionalLight(0xffffff, 1.15);
    key.position.set(0.3, 1, 1.5);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xccdfff, 0.65);
    fill.position.set(-0.5, 0.2, 1);
    this.scene.add(fill);
  }

  isReady() {
    const trackingOk =
      this.jeelizTracking?.ready || this.tracking?.holistic;
    return !!this.vrm && !!trackingOk;
  }

  getVisibleMeshCount() {
    return countVrmMeshes(this.vrm).visible;
  }

  getPipelineStatus() {
    return getPipelineStatus(this);
  }

  _placementOpts() {
    return {
      normX: sliderToPlacementNorm(this.offsetX),
      normY: sliderToPlacementNorm(this.offsetY),
      rotYDeg: Number(this.offsetRotY) || 0,
    };
  }

  getHeadCoordinates() {
    return getHeadCoordinateReport(this);
  }

  _trackingReverseOpts() {
    return {
      reverseHeadPosition: this.reverseHeadPosition,
      reverseHeadRotation: this.reverseHeadRotation,
      reverseFaceMotion: this.reverseFaceMotion,
    };
  }

  _refreshRigSettings() {
    if (!this.avatarRig) return;
    const useJeeliz = this.trackingBackend === 'jeeliz';
    this.avatarRig.setSettings(
      getRecordRigSettings(useJeeliz, this._trackingReverseOpts())
    );
  }

  _applyPlacement() {
    if (!this.vrm) return;
    applyInitialPlacement(this.vrm, this.camera, this._placementOpts());
    this._forceRender();
  }

  setOptions({
    faceScale,
    bodyScale,
    alignStrength,
    mirror,
    showFullBody,
    reverseHeadPosition,
    reverseHeadRotation,
    reverseFaceMotion,
    flipAlignX,
    offsetX,
    offsetY,
    offsetRotY,
  } = {}) {
    if (faceScale != null) {
      this.faceScale = faceScale;
      if (this.vrm) applyFaceScale(this.vrm, this.faceScale, this.bodyScale);
    }
    if (bodyScale != null) {
      this.bodyScale = bodyScale;
      if (this.vrm) {
        applyRecordHeadVisibility(this.vrm, {
          bodyScale: this.bodyScale,
          faceScale: this.faceScale,
        });
        applyFaceScale(this.vrm, this.faceScale, this.bodyScale);
      }
    }
    if (alignStrength != null) this.alignStrength = alignStrength;
    if (mirror != null) {
      this.mirror = mirror;
      this.tracking?.setMirrorPreview?.(mirror);
    }
    if (reverseHeadPosition != null) this.reverseHeadPosition = reverseHeadPosition;
    if (reverseHeadRotation != null) this.reverseHeadRotation = reverseHeadRotation;
    if (reverseFaceMotion != null) this.reverseFaceMotion = reverseFaceMotion;
    if (flipAlignX != null) this.reverseHeadPosition = flipAlignX;
    if (
      reverseHeadPosition != null ||
      reverseHeadRotation != null ||
      reverseFaceMotion != null ||
      flipAlignX != null
    ) {
      this._refreshRigSettings();
    }
    let placementChanged = false;
    if (offsetX != null) {
      this.offsetX = offsetX;
      placementChanged = true;
    }
    if (offsetY != null) {
      this.offsetY = offsetY;
      placementChanged = true;
    }
    if (offsetRotY != null) {
      this.offsetRotY = offsetRotY;
      placementChanged = true;
    }
    if (placementChanged) this._applyPlacement();
    if (showFullBody != null && showFullBody !== this.showFullBody) {
      this.showFullBody = showFullBody;
      this._applyHeadOnlyMode();
    }
    this._emitDiagnostics();
  }

  /** Step 5: show only head/face meshes on the overlay. */
  _applyHeadOnlyMode() {
    if (!this.vrm) return;
    if (this.showFullBody) {
      applyRecordHeadVisibility(this.vrm, { showAll: true, bodyScale: 1 });
      fitFullBodyPortrait(this.vrm, this.camera);
    } else {
      applyRecordHeadVisibility(this.vrm, {
        bodyScale: this.bodyScale,
        faceScale: this.faceScale,
      });
      fitHeadPortrait(this.vrm, this.camera);
    }
    storeFitAnchor(this.vrm);
    this._applyPlacement();
    applyFaceScale(this.vrm, this.faceScale, this.bodyScale);
    this._forceRender();
  }

  getDiagnostics() {
    const mesh = this.vrm ? countVrmMeshes(this.vrm) : { total: 0, visible: 0 };
    const pipe = getPipelineStatus(this);
    return {
      modelLoaded: !!this.vrm,
      modelName: this.modelName || '—',
      totalMeshes: mesh.total,
      visibleMeshes: mesh.visible,
      overlayPixels: `${this.overlayCanvas?.width ?? 0}×${this.overlayCanvas?.height ?? 0}`,
      enabled: this.enabled,
      lastRenderAt: this.lastRenderAt,
      tracking: pipe.landmarks ? 'face' : 'searching',
      faceScale: this.faceScale,
      pipeline: pipe,
      webgl: !!this.renderer?.getContext?.(),
      headCoords: getHeadCoordinateReport(this),
    };
  }

  _emitDiagnostics() {
    const d = this.getDiagnostics();
    this.onDiagnostics(d);
    this.onPipeline(d.pipeline);
  }

  _viewportRect() {
    const stack =
      this.overlayCanvas.parentElement?.closest?.('.camera-stack') ||
      this.overlayCanvas.parentElement;
    return stack?.getBoundingClientRect?.();
  }

  _updateOrthoCamera(w, h) {
    const aspect = w / h;
    const halfH = 0.55;
    const halfW = halfH * aspect;
    this.camera.left = -halfW;
    this.camera.right = halfW;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;
    this.camera.updateProjectionMatrix();
  }

  _resize() {
    const rect = this._viewportRect();
    const w = Math.max(1, Math.round(rect?.width || window.innerWidth));
    const h = Math.max(1, Math.round(rect?.height || window.innerHeight));
    this.renderer.setSize(w, h, false);
    if (this.compositeCanvas) {
      this.compositeCanvas.width = w;
      this.compositeCanvas.height = h;
    }
    const jeelizCanvas = document.getElementById('jeeliz-canvas');
    if (this._useJeelizPose && this.camera?.isPerspectiveCamera) {
      const state = updateJeelizPerspectiveCamera(
        this.camera,
        this.renderer,
        this.video,
        jeelizCanvas
      );
      this._jeelizScaleW = state.scaleW;
      this._jeelizCanvasAspect = state.canvasAspectRatio;
    } else {
      this._updateOrthoCamera(w, h);
      this.jeelizTracking?.resize?.(w, h);
    }
    this._emitDiagnostics();
  }

  /**
   * Jeeliz tiger-demo style: perspective camera + update_poses on face root.
   * @see https://github.com/jeeliz/jeelizFaceFilter/tree/master/demos/threejs/tiger
   */
  _switchToJeelizPoseMode() {
    if (!this.vrm || this._useJeelizPose) return;
    this.faceRoot = ensureJeelizFaceRoot(this.vrm, this.scene);
    this.camera = createJeelizPerspectiveCamera();
    const jeelizCanvas = document.getElementById('jeeliz-canvas');
    const state = updateJeelizPerspectiveCamera(
      this.camera,
      this.renderer,
      this.video,
      jeelizCanvas
    );
    this._jeelizScaleW = state.scaleW;
    this._jeelizCanvasAspect = state.canvasAspectRatio;
    this._useJeelizPose = true;
    this.vrm.scene.rotation.y = Math.PI;
    this.vrm.scene.position.set(0, 0.12, -0.38);
    storeFitAnchor(this.vrm);
    this._applyPlacement();
    this._forceRender();
  }

  /** Step 4: load VRM into Three.js scene (head-only framing). */
  async loadModel(source) {
    if (typeof THREE_VRM === 'undefined') {
      throw new Error('VRM library did not load. Refresh the page.');
    }

    await this._disposeVrmOnly();
    this.onStatus('Loading VRM head…');
    this.modelName = source?.name || 'VRM';

    if (!this.avatarRig) {
      this.avatarRig = new AvatarRig();
    }
    this._refreshRigSettings();

    this._resize();
    this.vrmLoader = new VRMLoader(this.scene, (msg) => {
      if (msg) this.onStatus(msg);
    });
    const vrm = await this.vrmLoader.load(source);
    vrm.scene.rotation.y = Math.PI;
    vrm.scene.position.set(0, 0, 0);
    vrm.scene.scale.set(1, 1, 1);

    this.vrm = vrm;
    this.avatarRig.setVRM(vrm);
    stripOverlayArtifacts(vrm);
    this._applyHeadOnlyMode();
    if (this.jeelizTracking?.ready && this.trackingBackend === 'jeeliz') {
      this._switchToJeelizPoseMode();
    }

    this.onStatus('VRM ready — starting face tracking…');
    this._forceRender();
    this._emitDiagnostics();
    return vrm;
  }

  /**
   * Webcam → Jeeliz (detect/track/pose) or MediaPipe+Kalidokit fallback.
   */
  async warmTracking() {
    if (this.jeelizTracking?.ready || this.tracking?.holistic) return;

    if (this.jeelizTracking) {
      await this.jeelizTracking.dispose();
      this.jeelizTracking = null;
    }
    if (this.tracking) {
      await this.tracking.disposeHolistic();
      this.tracking = null;
    }

    if (this.video.paused) {
      try {
        await this.video.play();
      } catch {
        // ignore
      }
    }

    const rect = this._viewportRect();
    try {
      this.onStatus('Loading Jeeliz face filter…');
      this.jeelizTracking = new JeelizFaceTracking(this.video, {
        onStatus: (msg) => {
          this.onStatus(msg);
          this._emitDiagnostics();
        },
        onTrack: () => this._emitDiagnostics(),
      });
      this.jeelizTracking.resize(rect?.width, rect?.height);
      await this.jeelizTracking.init();
      this.trackingBackend = 'jeeliz';
      this._refreshRigSettings();
      if (this.vrm) {
        this.avatarRig.setVRM(this.vrm);
        this._switchToJeelizPoseMode();
      }
      this._trackingStarted = true;
      this._emitDiagnostics();
      return;
    } catch (e) {
      console.warn('[RecordFaceOverlay] Jeeliz unavailable:', e);
      this.jeelizTracking = null;
    }

    this.trackingBackend = 'mediapipe';
    this._refreshRigSettings();
    if (this.vrm) this.avatarRig.setVRM(this.vrm);

    this.tracking = new Tracking(
      this.video,
      this.avatarRig,
      (status) => {
        this.onStatus(status);
        this._emitDiagnostics();
      },
      null,
      { faceOnly: true, mirrorPreview: this.mirror }
    );
    await this.tracking.init();
    await this.tracking.start({ useVideoElement: true });
    this._trackingStarted = true;
    this.onStatus('Searching for face… (MediaPipe)');
    this._emitDiagnostics();
  }

  _forceRender() {
    if (!this.vrm) return;
    this.avatarRig?.update?.(0.016);
    this.vrm.scene.updateMatrixWorld(true);
    this.renderer.render(this.scene, this.camera);
    this.lastRenderAt = Date.now();
  }

  async boot(source) {
    this.enable();
    await this.loadModel(source);
    await this.warmTracking();
  }

  enable() {
    if (this.enabled) return;
    this.enabled = true;
    this._resize();
    requestAnimationFrame(() => this._resize());
    if (!this._resizeObserver && typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(() => this._resize());
      const parent = this.overlayCanvas.parentElement;
      if (parent) this._resizeObserver.observe(parent);
    }
    window.addEventListener('resize', this._onResize);
    this._loop();
  }

  disable() {
    this.enabled = false;
    if (this._raf) {
      cancelAnimationFrame(this._raf);
      this._raf = null;
    }
    window.removeEventListener('resize', this._onResize);
    this.renderer.clear();
  }

  _onResize = () => this._resize();

  /**
   * Render loop: Kalidokit already ran in MediaPipe callback; we position head + draw.
   */
  _loop() {
    if (!this.enabled) return;
    this._raf = requestAnimationFrame(() => this._loop());

    if (!this.vrm || !this.avatarRig) return;

    const delta = this.clock.getDelta();
    const rect = this._viewportRect();

    if (this.trackingBackend === 'jeeliz') {
      if (typeof this.vrm.update === 'function') this.vrm.update(delta);
    } else {
      this.avatarRig.update(delta);
    }

    const aligned = alignVrmFace(
      this.vrm,
      this.camera,
      { jeeliz: this.jeelizTracking, mediapipe: this.tracking },
      {
        mirror: this.mirror,
        landmarksMirrored: this.mirror,
        reverseHeadPosition: this.reverseHeadPosition,
        reverseHeadRotation: this.reverseHeadRotation,
        reverseFaceMotion: this.reverseFaceMotion,
        faceScale: this.faceScale,
        bodyScale: this.bodyScale,
        alignStrength: this.alignStrength,
        placement: this._placementOpts(),
        useJeelizPose: this._useJeelizPose,
        jeelizScaleW: this._jeelizScaleW,
        jeelizCanvasAspect: this._jeelizCanvasAspect,
        viewport: rect,
        video: this.video,
      }
    );
    if (aligned) this.lastAlignedAt = Date.now();
    if (!this._useJeelizPose) {
      clampVrmSceneToViewBox(this.vrm, this.camera);
    }

    this.vrm.scene.updateMatrixWorld(true);
    this.renderer.render(this.scene, this.camera);
    this.lastRenderAt = Date.now();

    this._diagTick += 1;
    if (this._diagTick % 12 === 0) this._emitDiagnostics();
  }

  drawComposite() {
    if (!this.compositeCanvas || !this.enabled) return;
    const w = this.compositeCanvas.width;
    const h = this.compositeCanvas.height;
    const ctx = this.compositeCanvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    if (this.video?.readyState >= 2) {
      ctx.save();
      if (this.mirror) {
        ctx.translate(w, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(this.video, 0, 0, w, h);
      ctx.restore();
    }
    if (this.overlayCanvas.width > 0) {
      ctx.drawImage(this.overlayCanvas, 0, 0, w, h);
    }
  }

  async _disposeVrmOnly() {
    if (this.vrm) {
      resetHybridHeadScale(this.vrm);
      resetFaceFollow(this.vrm);
      applyHybridMeshVisibility(this.vrm, false);
    }
    if (this.vrmLoader) {
      this.vrmLoader.dispose?.();
      this.vrmLoader = null;
    }
    this.vrm = null;
    this.avatarRig?.setVRM?.(null);
    this._emitDiagnostics();
  }

  async dispose() {
    this.disable();
    if (this.jeelizTracking) {
      await this.jeelizTracking.dispose();
      this.jeelizTracking = null;
    }
    if (this.tracking) {
      await this.tracking.disposeHolistic();
      this.tracking = null;
    }
    await this._disposeVrmOnly();
    this.avatarRig = null;
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    this.renderer?.dispose?.();
  }
}
