// ==================== MAIN APPLICATION ====================
// Main entry point that ties all modules together.

import { Config } from './config.js';
import { SceneSetup } from './sceneSetup.js';
import { SceneObjects } from './sceneObjects.js';
import { VRMLoader } from './vrmLoader.js';
import { AvatarRig } from './avatarRig.js';
import { Tracking } from './tracking.js';
import { AudioManager } from './audioManager.js';
import { Rabbit } from './rabbit.js';
import { Parrot } from './parrot.js';
import {
  listModels,
  getActiveModelId,
  setActiveModelId,
  getModelSource,
  formatBytes,
} from './modelStore.js';
import { getSettings, onSettingsChange } from './settingsStore.js';
import { loadBackground, onBackgroundChange } from './backgroundStore.js';
import { CanvasRecorder, formatDuration } from './recorder.js';
import { AudioLipsync } from './audioLipsync.js';
import { CinematicCamera } from './cinematicCamera.js';
import { capturePoseFromScene, saveCamera } from './cameraStore.js';
import { getAvatarAnchor } from './cameraPoseMath.js';
import { applyFullAppearance } from './sceneAppearance.js';

export class AvatarApp {
  constructor() {
    this.sceneSetup = null;
    this.sceneObjects = null;
    this.audioManager = null;
    this.vrmLoader = null;
    this.avatarRig = null;
    this.tracking = null;
    this.rabbit = null;
    this.parrots = [];

    // DOM
    this.canvas = document.getElementById('avatar-canvas');
    this.video = document.getElementById('webcam');
    this.debugVideo = document.getElementById('debug-video');
    this.loadingElement = document.getElementById('loading');
    this.loadingText = document.getElementById('loading-text');
    this.statusElement = document.getElementById('status');
    this.modelChip = document.getElementById('model-chip');
    this.modelChipName = document.getElementById('model-chip-name');
    this.modelMenu = document.getElementById('model-menu');
    this.toast = document.getElementById('toast');

    // Recording / audio lipsync state
    this.recorder = null;
    this.audioLipsync = null;
    this.cinematicCamera = null;
    this._lipsyncFile = null;     // user-chosen audio File for lipsync
    this._isRecordingForExport = false; // true when recording was started by "Play & Record"

    // DOM (recording + audio panel)
    this.recordBtn = document.getElementById('record-btn');
    this.recIndicator = document.getElementById('rec-indicator');
    this.recTimer = document.getElementById('rec-timer');
    this.audioBtn = document.getElementById('audio-btn');
    this.audioPanel = document.getElementById('audio-panel');
    this.apClose = document.getElementById('ap-close');
    this.apFile = document.getElementById('ap-file');
    this.apFileInput = document.getElementById('ap-file-input');
    this.apPlay = document.getElementById('ap-play');
    this.apRecord = document.getElementById('ap-record');
    this.apStop = document.getElementById('ap-stop');

    // Drag interaction state
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.isDragging = false;
    this.dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    this._isSwappingAvatar = false;

    // Distance tracking — moves the avatar toward / away from the camera
    // based on how close the user is to their webcam.
    // The "base" position is the user's intended position (initial spawn
    // or last drag); the "auto offset" is added on top each frame.
    this.avatarBasePosition = new THREE.Vector3(1.0, 0, 0);
    this._distanceRatio = 1.0;        // 1.0 = baseline; >1 = closer; <1 = farther
    this._distanceTargetZ = 0;        // computed each frame from ratio
    this._distanceCurrentZ = 0;       // smoothed value applied to the avatar
    this._maxDistanceZ = 2.5;         // meters of forward travel at full proximity
    this._warnedNoCameras = false;
    this._relockCameraOnRecordStart = false;

    this.setupInteraction();
  }

  setupInteraction() {
    window.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    window.addEventListener('pointermove', (e) => this.onPointerMove(e));
    window.addEventListener('pointerup', () => this.onPointerUp());
  }

  async init() {
    try {
      this.updateLoading('Setting up 3D scene...');
      this.sceneSetup = new SceneSetup(this.canvas);
      this.sceneSetup.init();
      this.cinematicCamera = new CinematicCamera(this.sceneSetup, () =>
        getAvatarAnchor(this.vrmLoader?.vrm)
      );
      await this.cinematicCamera.refreshShots();

      // Apply user's saved background (color/image), default if none.
      try {
        const bg = await loadBackground();
        this.sceneSetup.applyBackground(bg);
      } catch (e) {
        console.warn('Could not apply saved background:', e);
      }
      this._applyAppearanceAndPlacement(getSettings());
      // Live-react to background changes from the settings tab.
      this._unsubBackground = onBackgroundChange(async () => {
        try {
          const bg = await loadBackground();
          this.sceneSetup.applyBackground(bg);
        } catch (e) {
          console.warn('Failed to update background:', e);
        }
      });

      this.audioManager = new AudioManager();
      this.audioManager.init(this.sceneSetup.camera);

      this.sceneObjects = new SceneObjects(this.sceneSetup.scene, this.audioManager);

      // Rabbit
      this.rabbit = new Rabbit();
      this.sceneSetup.scene.add(this.rabbit);

      // Parrots
      const scarlet = new Parrot({ body: 0xff3333, wing: 0xffee00, wingTip: 0x0044ff, tail: 0xcc0000 });
      scarlet.position.set(0, 10, 0);
      scarlet.flightTime = 0;
      this.sceneSetup.scene.add(scarlet);
      this.parrots.push(scarlet);

      const blue = new Parrot({ body: 0x0088ff, wing: 0x0066cc, wingTip: 0xffcc00, tail: 0x0044aa });
      blue.position.set(5, 12, 5);
      blue.flightTime = 1000;
      this.sceneSetup.scene.add(blue);
      this.parrots.push(blue);

      // Speaker toggle
      const speakerBtn = document.getElementById('speaker-btn');
      if (speakerBtn) {
        speakerBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const isActive = this.audioManager.toggleMute();
          speakerBtn.textContent = isActive ? '🔊' : '🔇';
        });
      }

      // Bird view toggle
      const birdBtn = document.getElementById('bird-btn');
      this.isBirdView = false;
      if (birdBtn) {
        birdBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.isBirdView = !this.isBirdView;
          birdBtn.classList.toggle('active', this.isBirdView);
          if (this.isBirdView) this.cinematicCamera?.releaseControls();
          if (this.sceneSetup && this.sceneSetup.controls) {
            this.sceneSetup.controls.enabled = !this.isBirdView;
            if (!this.isBirdView) {
              document.body.style.cursor = 'default';
            }
          }
        });
      }

      // Model selector
      this.setupModelSelector();
      this.setupSaveCameraButton();

      // Recording + audio lipsync controls
      this.setupRecording();
      this.setupAudioLipsync();

      // Audio unlock on first interaction
      const unlockAudio = () => {
        this.audioManager.playAmbience();
        window.removeEventListener('pointerdown', unlockAudio);
        window.removeEventListener('keydown', unlockAudio);
      };
      window.addEventListener('pointerdown', unlockAudio);
      window.addEventListener('keydown', unlockAudio);

      this.updateLoading('Loading environment...');
      await this.createEnvironmentObjects();

      this.updateLoading('Accessing camera...');
      await this.setupCamera();

      // Load active avatar
      this.updateLoading('Loading avatar...');
      const activeId = getActiveModelId();
      const source = await getModelSource(activeId);
      this.modelChipName.textContent = source.name;

      this.vrmLoader = new VRMLoader(this.sceneSetup.scene, (msg) => this.updateLoading(msg));
      const vrm = await this.vrmLoader.load(source);
      vrm.scene.scale.set(1.3, 1.3, 1.3);

      this.avatarRig = new AvatarRig();
      this.avatarRig.setSettings(getSettings());
      this.avatarRig.setVRM(vrm);
      this._applyAppearanceAndPlacement(getSettings());

      // Live-apply sensitivity changes from the Settings page (other tabs too).
      this._unsubSettings = onSettingsChange((s) => {
        this.avatarRig.setSettings(s);
        this._applyAppearanceAndPlacement(s);
      });

      this.updateLoading('Initializing tracking...');
      this.tracking = new Tracking(
        this.video,
        this.avatarRig,
        (status) => this.updateStatus(status),
        (ratio) => { this._distanceRatio = ratio; }
      );
      await this.tracking.init();

      this.updateLoading('Starting...');
      await this.tracking.start();
      this.hideLoading();

      this.animate();
    } catch (error) {
      console.error('Initialization error:', error);
      this.updateLoading(`Error: ${error.message}`);
    }
  }

  // ---------- Model selector / live swap ----------

  setupSaveCameraButton() {
    const btn = document.getElementById('save-cam-btn');
    if (!btn) return;
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await this.saveCurrentCameraView();
    });
  }

  setupModelSelector() {
    if (!this.modelChip || !this.modelMenu) return;
    this.modelChipWrap = document.querySelector('.model-chip-wrap');

    this.modelChip.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = this.modelMenu.classList.contains('open');
      if (isOpen) {
        this.closeModelMenu();
      } else {
        this.openModelMenu();
      }
    });

    document.addEventListener('click', (e) => {
      const wrap = this.modelChipWrap || this.modelChip;
      if (!this.modelMenu.contains(e.target) && !wrap.contains(e.target)) {
        this.closeModelMenu();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.closeModelMenu();
    });
  }

  async openModelMenu() {
    this.modelMenu.classList.add('open');
    this.modelChip.setAttribute('aria-expanded', 'true');
    await this.renderModelMenu();
  }

  closeModelMenu() {
    this.modelMenu.classList.remove('open');
    this.modelChip.setAttribute('aria-expanded', 'false');
  }

  async renderModelMenu() {
    const models = await listModels();
    const activeId = getActiveModelId();
    const items = models
      .map((m) => {
        const meta = m.builtIn ? 'Built-in' : `${formatBytes(m.size)} · uploaded`;
        const cls = m.id === activeId ? 'model-menu-item active' : 'model-menu-item';
        return `
          <div class="${cls}" data-id="${escapeHtml(m.id)}" role="option" aria-selected="${m.id === activeId}">
            <div style="flex:1; min-width:0;">
              <div style="font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(m.name)}</div>
              <div class="meta">${meta}</div>
            </div>
            <span class="check">✓</span>
          </div>
        `;
      })
      .join('');

    this.modelMenu.innerHTML = `
      ${items}
      <div class="model-menu-divider"></div>
      <a class="model-menu-link" href="models.html">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M7 1.5v11M1.5 7h11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
        </svg>
        Manage Models
      </a>
      <a class="model-menu-link" href="cameras.html">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M2 4h10v7H2z" stroke="currentColor" stroke-width="1.4"/>
          <circle cx="7" cy="7.5" r="2" stroke="currentColor" stroke-width="1.4"/>
        </svg>
        Camera Views
      </a>
      <button type="button" class="model-menu-link" id="menu-save-cam">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M2 4h3l1-1h2l1 1h3v7H2V4z" stroke="currentColor" stroke-width="1.2"/>
          <circle cx="7" cy="7.5" r="1.5" stroke="currentColor" stroke-width="1.2"/>
        </svg>
        Save current camera
      </button>
      <a class="model-menu-link" href="settings.html">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <circle cx="7" cy="7" r="2" stroke="currentColor" stroke-width="1.4"/>
          <path d="M7 1v1.5M7 11.5V13M1 7h1.5M11.5 7H13M2.6 2.6l1.1 1.1M10.3 10.3l1.1 1.1M2.6 11.4l1.1-1.1M10.3 3.7l1.1-1.1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
        </svg>
        Tracking Settings
      </a>
    `;

    this.modelMenu.querySelectorAll('.model-menu-item').forEach((el) => {
      el.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = el.dataset.id;
        if (id === activeId) {
          this.closeModelMenu();
          return;
        }
        this.closeModelMenu();
        await this.swapAvatar(id);
      });
    });

    const saveCamBtn = document.getElementById('menu-save-cam');
    if (saveCamBtn) {
      saveCamBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        this.closeModelMenu();
        await this.saveCurrentCameraView();
      });
    }
  }

  async swapAvatar(modelId) {
    if (this._isSwappingAvatar) return;
    this._isSwappingAvatar = true;
    const previousLoader = this.vrmLoader;
    const previousName = this.modelChipName.textContent;
    let newLoader = null;
    try {
      const source = await getModelSource(modelId);
      this.showToast(`Loading ${source.name}…`);

      // Load NEW first; only swap once it succeeds, so a bad file
      // (e.g. a plain .glb without VRM extensions) leaves the scene intact.
      newLoader = new VRMLoader(this.sceneSetup.scene, (msg) => this.showToast(msg));
      const vrm = await newLoader.load(source);
      vrm.scene.scale.set(1.3, 1.3, 1.3);
      this.avatarBasePosition.copy(vrm.scene.position);
      this.avatarRig.setVRM(vrm);
      this._applyAppearanceAndPlacement(getSettings());

      // Dispose old only after success.
      if (previousLoader) previousLoader.dispose();

      this.vrmLoader = newLoader;
      setActiveModelId(modelId);
      this.modelChipName.textContent = source.name;
      this.showToast(`Active: ${source.name}`);
    } catch (err) {
      console.error('Avatar swap failed:', err);
      // Roll back: dispose whatever the new loader added (partial state)
      // and keep the previous avatar driving tracking.
      if (newLoader) newLoader.dispose();
      this.modelChipName.textContent = previousName;
      const msg = (err && err.message) || String(err);
      const hint = /VRM/i.test(msg)
        ? msg
        : `${msg}. This file may not contain VRM extensions.`;
      this.showToast(`Failed to load model: ${hint}`, true);
    } finally {
      this._isSwappingAvatar = false;
    }
  }

  // ---------- Recording ----------

  setupRecording() {
    if (!this.recordBtn) return;
    if (!CanvasRecorder.isSupported()) {
      this.recordBtn.disabled = true;
      this.recordBtn.title = 'Recording not supported in this browser';
      this.recordBtn.style.opacity = '0.45';
      return;
    }

    this.recordBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (this.recorder && this.recorder.isRecording()) {
        if (this._isRecordingForExport) {
          await this._stopLipsync();
        } else {
          await this.stopRecording();
        }
      } else {
        // If audio lipsync is currently playing, automatically include its
        // audio in the recording. This way both the dedicated "● Play &
        // Record" button AND the master record button produce videos with
        // audio when audio is active.
        const includeAudio = !!(this.audioLipsync && this.audioLipsync.isPlaying());
        if (includeAudio) {
          // Need the audio stream's track to actually be live before the
          // recorder starts, otherwise MediaRecorder will drop the audio.
          const ready = await this._waitForAudioTrack(this.audioLipsync, 1500);
          if (!ready) {
            console.warn('[Lipsync] audio track not ready when master record clicked');
          }
        }
        await this.startRecording({ withLipsyncAudio: includeAudio });
      }
    });
  }

  async startRecording({ withLipsyncAudio = false } = {}) {
    if (!CanvasRecorder.isSupported()) {
      this.showToast('Recording is not supported in this browser', true);
      return false;
    }
    if (this.recorder && this.recorder.isRecording()) return false;

    const audioStream = this.audioLipsync ? this.audioLipsync.getStream() : null;
    console.info('[Lipsync] startRecording', {
      withLipsyncAudio,
      hasAudioLipsync: !!this.audioLipsync,
      isPlaying: this.audioLipsync?.isPlaying(),
      hasStream: !!audioStream,
      streamAudioTracks: audioStream ? audioStream.getAudioTracks().length : 0,
      audioContextState: this.audioLipsync?.audioContext?.state,
    });

    this.recorder = new CanvasRecorder(this.canvas, {
      fps: 30,
      onTick: (elapsed) => {
        if (this.recTimer) this.recTimer.textContent = formatDuration(elapsed);
      },
    });

    if (withLipsyncAudio && audioStream) {
      this.recorder.addAudioStream(audioStream);
    } else if (withLipsyncAudio) {
      console.warn(
        '[Lipsync] withLipsyncAudio=true but no audio stream available',
        { hasAudioLipsync: !!this.audioLipsync }
      );
    }

    await this.cinematicCamera?.refreshShots();

    // Frame 0 of the recording = character position + camera framing right now.
    if (this.cinematicCamera?.active) {
      this.cinematicCamera.relockSessionAnchor();
    } else {
      this._relockCameraOnRecordStart = true;
    }

    try {
      await this.recorder.start();
    } catch (err) {
      console.error(err);
      this.showToast(err.message || 'Could not start recording', true);
      this.recorder = null;
      return false;
    }

    if (this.recordBtn) this.recordBtn.classList.add('recording');
    if (this.recIndicator) this.recIndicator.classList.add('show');
    if (this.recTimer) this.recTimer.textContent = '00:00';
    this.showToast('Recording started');
    return true;
  }

  async stopRecording() {
    if (!this.recorder) return null;
    try {
      const blob = await this.recorder.stop();
      this.recorder = null;
      if (this.recordBtn) this.recordBtn.classList.remove('recording');
      if (this.recIndicator) this.recIndicator.classList.remove('show');

      if (blob && blob.size > 0) {
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const ext = blob._ext || 'webm';
        CanvasRecorder.downloadBlob(blob, `edge-ai-${ts}.${ext}`);
        this.showToast(`Recording downloaded (.${ext})`);
      } else {
        this.showToast('Recording was empty', true);
      }
      return blob;
    } catch (e) {
      console.error(e);
      this.showToast('Failed to save recording', true);
      this.recorder = null;
      if (this.recordBtn) this.recordBtn.classList.remove('recording');
      if (this.recIndicator) this.recIndicator.classList.remove('show');
      return null;
    }
  }

  // ---------- Audio lip-sync ----------

  setupAudioLipsync() {
    if (!this.audioBtn || !this.audioPanel) return;

    if (!AudioLipsync.isSupported()) {
      this.audioBtn.disabled = true;
      this.audioBtn.title = 'Audio lip-sync not supported in this browser';
      this.audioBtn.style.opacity = '0.45';
      return;
    }

    this.audioBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = this.audioPanel.classList.contains('show');
      if (isOpen) this.audioPanel.classList.remove('show');
      else this.audioPanel.classList.add('show');
      this.audioBtn.classList.toggle('active', !isOpen);
    });

    this.apClose.addEventListener('click', () => {
      this.audioPanel.classList.remove('show');
      this.audioBtn.classList.remove('active');
    });

    this.apFile.addEventListener('click', () => this.apFileInput.click());

    this.apFileInput.addEventListener('change', async () => {
      const file = this.apFileInput.files?.[0];
      this.apFileInput.value = '';
      if (!file) return;
      await this._loadLipsyncFile(file);
    });

    // Drag-and-drop support on the file box
    this.apFile.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.apFile.style.borderColor = 'var(--accent)';
    });
    this.apFile.addEventListener('dragleave', () => {
      this.apFile.style.borderColor = '';
    });
    this.apFile.addEventListener('drop', async (e) => {
      e.preventDefault();
      this.apFile.style.borderColor = '';
      const file = e.dataTransfer?.files?.[0];
      if (file) await this._loadLipsyncFile(file);
    });

    this.apPlay.addEventListener('click', async () => {
      try {
        await this._startLipsyncPlayback({ record: false });
      } catch (e) {
        this.showToast(e.message || 'Playback failed', true);
      }
    });

    this.apRecord.addEventListener('click', async () => {
      try {
        await this._startLipsyncPlayback({ record: true });
      } catch (e) {
        this.showToast(e.message || 'Could not start recording', true);
      }
    });

    this.apStop.addEventListener('click', async () => {
      await this._stopLipsync();
    });
  }

  async _loadLipsyncFile(file) {
    if (!file.type.startsWith('audio/')) {
      this.showToast('Please choose an audio file (mp3, wav, ogg, m4a)', true);
      return;
    }
    this._lipsyncFile = file;
    this._renderAudioPanelState();
    this.apPlay.disabled = false;
    this.apRecord.disabled = false;
    this.showToast(`Loaded: ${file.name}`);
  }

  _renderAudioPanelState() {
    if (!this._lipsyncFile) {
      this.apFile.classList.remove('has-file');
      this.apFile.innerHTML = `
        <div>Click to choose an audio file</div>
        <div class="ap-file-meta">.mp3, .wav, .ogg, .m4a</div>
      `;
      return;
    }
    const sizeKB = (this._lipsyncFile.size / 1024).toFixed(0);
    this.apFile.classList.add('has-file');
    this.apFile.innerHTML = `
      <div class="ap-file-name">${escapeHtml(this._lipsyncFile.name)}</div>
      <div class="ap-file-meta">${sizeKB} KB · click to replace</div>
    `;
  }

  async _startLipsyncPlayback({ record }) {
    console.info('[Lipsync] _startLipsyncPlayback', { record, hasFile: !!this._lipsyncFile });
    if (!this._lipsyncFile) {
      this.showToast('Choose an audio file first', true);
      return;
    }

    // Tear down any prior session
    if (this.audioLipsync) {
      this.audioLipsync.dispose();
      this.audioLipsync = null;
    }

    this.audioLipsync = new AudioLipsync();
    await this.audioLipsync.load(this._lipsyncFile);
    await this.cinematicCamera?.refreshShots();

    // Apply the user's current intensity setting + react to changes live.
    this._applyAudioLipsyncIntensity();
    if (!this._unsubAudioSettings) {
      this._unsubAudioSettings = onSettingsChange(() => this._applyAudioLipsyncIntensity());
    }

    // Hook the avatar mouth to the audio analyser
    if (this.avatarRig) {
      this.avatarRig.setMouthOverride({ A: 0, I: 0, U: 0, E: 0, O: 0, mouthOpen: 0 });
    }

    this.audioLipsync.onEnded(async () => {
      // Auto-stop & save when audio finishes
      await this._stopLipsync();
    });

    if (record) {
      this._isRecordingForExport = true;
      // CRITICAL ORDER for audio-in-recording:
      //   1. Start audio playback first so the Web Audio graph is producing
      //      real samples and the MediaStreamDestination's audio track is
      //      "live" with data.
      //   2. Wait until the stream actually exposes an audio track (Chrome
      //      sometimes needs a few render quanta before getAudioTracks()
      //      returns the destination track).
      //   3. Start recording.
      await this.audioLipsync.play();
      const audioReady = await this._waitForAudioTrack(this.audioLipsync, 1500);
      if (!audioReady) {
        console.warn('[Lipsync] Audio MediaStreamTrack never went live; recording will be silent.');
        this.showToast('Audio stream unavailable — recording will be silent', true);
      }

      const ok = await this.startRecording({ withLipsyncAudio: true });
      if (!ok) {
        this._isRecordingForExport = false;
        this.audioLipsync.stop();
        this.audioLipsync.dispose();
        this.audioLipsync = null;
        if (this.avatarRig) this.avatarRig.setMouthOverride(null);
        return;
      }
    } else {
      await this.audioLipsync.play();
    }

    this.apPlay.disabled = true;
    this.apRecord.disabled = true;
    this.apStop.disabled = false;
    this.showToast(record ? 'Recording with audio…' : 'Playing audio…');
  }

  _applyAudioLipsyncIntensity() {
    if (!this.audioLipsync) return;
    const s = getSettings();
    const enabled = s.enabled.audioLipSync !== false;
    const sens = enabled ? (s.sensitivity.audioLipSync ?? 1.5) : 1.0;
    this.audioLipsync.setIntensity(sens);
  }

  /**
   * Wait until the audio MediaStream from the lipsync module actually
   * exposes a live audio track. Some browsers (Chrome on macOS in
   * particular) don't make the MediaStreamAudioDestinationNode's track
   * visible via getAudioTracks() until the AudioContext has produced at
   * least one render quantum. If we hand the stream to MediaRecorder
   * before that happens, the recording ends up audio-less.
   *
   * @returns true if a live track was found, false on timeout.
   */
  async _waitForAudioTrack(audioLipsync, timeoutMs = 1500) {
    if (!audioLipsync) return false;
    const start = performance.now();
    let lastSnapshot = null;
    while (performance.now() - start < timeoutMs) {
      const stream = audioLipsync.getStream();
      const ctxState = audioLipsync.audioContext?.state;
      const tracks = stream ? stream.getAudioTracks() : [];
      // Accept any audio track that isn't 'ended' — Chrome reports tracks
      // from MediaStreamAudioDestinationNode as 'live' but some browsers
      // initially mark them as 'new' or even leave readyState undefined.
      const usable = tracks.find(
        (t) => t.kind === 'audio' && t.readyState !== 'ended'
      );

      const snapshot = JSON.stringify({
        ctxState,
        hasStream: !!stream,
        streamActive: stream?.active,
        trackCount: tracks.length,
        readyStates: tracks.map((t) => t.readyState),
      });
      if (snapshot !== lastSnapshot) {
        console.info('[Lipsync] _waitForAudioTrack poll', JSON.parse(snapshot));
        lastSnapshot = snapshot;
      }

      if (usable) {
        console.info('[Lipsync] audio track is usable', {
          id: usable.id,
          label: usable.label,
          readyState: usable.readyState,
          waitedMs: Math.round(performance.now() - start),
          totalAudioTracks: tracks.length,
        });
        return true;
      }
      await new Promise((r) => setTimeout(r, 30));
    }
    console.warn('[Lipsync] _waitForAudioTrack timeout', {
      lastSnapshot: lastSnapshot ? JSON.parse(lastSnapshot) : null,
    });
    return false;
  }

  async _stopLipsync() {
    if (this.audioLipsync) {
      this.audioLipsync.stop();
    }
    if (this.recorder && this.recorder.isRecording() && this._isRecordingForExport) {
      await this.stopRecording();
    }
    if (this.audioLipsync) {
      this.audioLipsync.dispose();
      this.audioLipsync = null;
    }
    if (this.avatarRig) this.avatarRig.setMouthOverride(null);
    this._isRecordingForExport = false;
    this.apPlay.disabled = !this._lipsyncFile;
    this.apRecord.disabled = !this._lipsyncFile;
    this.apStop.disabled = true;
  }

  showToast(message, isError = false) {
    if (!this.toast) return;
    this.toast.textContent = message;
    this.toast.classList.toggle('error', !!isError);
    this.toast.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      this.toast.classList.remove('show');
    }, 2400);
  }

  // ---------- Environment / camera ----------

  async createEnvironmentObjects() {
    this.envGroup = new THREE.Group();
    this.envGroup.position.set(-4, 0, -4);
    this.sceneSetup.scene.add(this.envGroup);

    try {
     

      const houseBounds = new THREE.Box3().setFromObject();
      const weatherGroup = this.sceneObjects.createWeather(houseBounds);
      this.envGroup.add(weatherGroup);
    } catch (e) {
      console.error('Could not load house model:', e);
    }
  }

  async setupCamera() {
    const stream = await navigator.mediaDevices.getUserMedia({ video: Config.camera });
    this.video.srcObject = stream;
    this.debugVideo.srcObject = stream;
    await new Promise((r) => (this.video.onloadedmetadata = r));
  }

  updateLoading(text) {
    if (this.loadingText) this.loadingText.textContent = text;
  }

  hideLoading() {
    if (this.loadingElement) this.loadingElement.classList.add('hidden');
  }

  updateStatus(text) {
    if (this.statusElement) this.statusElement.textContent = `Tracking: ${text}`;
  }

  _applyAppearanceAndPlacement(settings) {
    const vrm = this.vrmLoader?.vrm;
    const placement = applyFullAppearance(this.sceneSetup, vrm, settings);
    if (vrm) {
      const p = placement || vrm.scene.position;
      this.avatarBasePosition.set(p.x, 0, p.z);
    }
  }

  async saveCurrentCameraView() {
    const name = prompt('Name this camera view (e.g. Face close-up)');
    if (!name?.trim()) return;
    try {
      const pose = capturePoseFromScene(this.sceneSetup, this.vrmLoader?.vrm);
      await saveCamera(name.trim(), pose);
      await this.cinematicCamera?.refreshShots();
      this.showToast(`Camera saved (follows avatar): ${name.trim()}`);
    } catch (e) {
      this.showToast(e.message || 'Could not save camera', true);
    }
  }

  _updateCinematicCamera(delta) {
    if (!this.cinematicCamera || this.isBirdView) {
      this.cinematicCamera?.releaseControls();
      return;
    }

    const ctx = {
      audioPlaying: !!this.audioLipsync?.isPlaying(),
      recording: !!(this.recorder?.isRecording()),
    };

    if (!this.cinematicCamera.shouldRun(ctx)) {
      this.cinematicCamera.stop();
      return;
    }

    if (!this.cinematicCamera.active) {
      const forceRelock = this._relockCameraOnRecordStart;
      this._relockCameraOnRecordStart = false;
      if (!this.cinematicCamera.start()) {
        if (!this._warnedNoCameras) {
          this._warnedNoCameras = true;
          this.showToast(
            'No saved camera views — open Camera Views to capture angles first',
            true
          );
        }
        return;
      }
      if (forceRelock && ctx.recording) {
        this.cinematicCamera.relockSessionAnchor();
      }
    }

    const speech = this.audioLipsync?.getSpeechLevel?.() ?? 0;
    const liveIdle = !ctx.audioPlaying && !ctx.recording;
    this.cinematicCamera.update(delta, speech, liveIdle);
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    const delta = this.sceneSetup.getDelta();

    // Sample audio analyser before rig update so the override is fresh.
    if (this.audioLipsync && this.avatarRig) {
      const w = this.audioLipsync.computeWeights();
      this.avatarRig.setMouthOverride(w);
    }

    if (this.avatarRig) this.avatarRig.update(delta);

    // Distance / proximity tracking — move avatar toward or away from camera
    // based on user proximity to the webcam.
    this._applyDistanceTracking();

    this._updateCinematicCamera(delta);

    this.sceneSetup.render();

    const isRec = !!(this.recorder?.isRecording());
    const cinematicOn = !!this.cinematicCamera?.active;

    if (this.sceneObjects && !isRec) this.sceneObjects.updateWeather();

    if (!isRec && !cinematicOn) {
      if (this.rabbit && this.vrmLoader && this.vrmLoader.vrm) {
        this.rabbit.setAvatarTarget(this.vrmLoader.vrm.scene.position);
        this.rabbit.update(delta);
      } else if (this.rabbit) {
        this.rabbit.update(delta);
      }
    }

    if (this.parrots && !isRec && !cinematicOn) {
      this.parrots.forEach((p) => p.update(delta));

      if (this.isBirdView && this.parrots.length > 0) {
        const bird = this.parrots[0];
        const cam = this.sceneSetup.camera;

        const offset = new THREE.Vector3(0, 0.45, 0.4);
        offset.applyQuaternion(bird.quaternion);
        const targetPos = bird.position.clone().add(offset);

        cam.position.lerp(targetPos, delta * 10.0);

        const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(bird.quaternion);
        const lookTarget = bird.position.clone().add(forward.multiplyScalar(20));
        cam.lookAt(lookTarget);
      }
    }
  }

  // ---------- Pointer interaction (drag avatar / env) ----------

  updateMouse(event) {
    this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
  }

  onPointerDown(event) {
    if (!this.sceneSetup) return;

    // Ignore drags that started on UI controls
    if (event.target && event.target.closest && event.target.closest('.topbar, #status, #debug-video, .toast, #loading, #rec-indicator, #audio-panel, #save-cam-btn')) {
      return;
    }

    this.updateMouse(event);
    this.raycaster.setFromCamera(this.mouse, this.sceneSetup.camera);

    const meshes = [];
    const meshToRoot = new Map();

    if (this.vrmLoader?.vrm) {
      this.vrmLoader.vrm.scene.traverse((o) => {
        if (o.isMesh) {
          meshes.push(o);
          meshToRoot.set(o, this.vrmLoader.vrm.scene);
        }
      });
    }
    if (this.envGroup) {
      this.envGroup.traverse((o) => {
        if (o.isMesh) {
          meshes.push(o);
          meshToRoot.set(o, this.envGroup);
        }
      });
    }

    const intersects = this.raycaster.intersectObjects(meshes);

    if (intersects.length > 0) {
      const hitObject = intersects[0].object;
      const root = meshToRoot.get(hitObject);
      if (root) {
        this.dragObject = root;
        this.isDragging = true;
        this.sceneSetup.controls.enabled = false;
        document.body.style.cursor = 'grabbing';

        const hitPoint = intersects[0].point;
        this.dragOffset = new THREE.Vector3().subVectors(root.position, hitPoint);
        this.dragOffset.y = 0;
      }
    }
  }

  onPointerMove(event) {
    if (!this.isDragging || !this.dragObject) return;

    this.updateMouse(event);
    this.raycaster.setFromCamera(this.mouse, this.sceneSetup.camera);

    const target = new THREE.Vector3();
    this.raycaster.ray.intersectPlane(this.dragPlane, target);

    if (target) {
      const newPos = new THREE.Vector3().addVectors(target, this.dragOffset);
      this.dragObject.position.set(newPos.x, 0, newPos.z);

      // If the user dragged the VRM avatar itself, treat that as the new
      // intrinsic base position. Distance tracking adds an offset on top.
      if (this.vrmLoader?.vrm && this.dragObject === this.vrmLoader.vrm.scene) {
        this.avatarBasePosition.set(newPos.x, 0, newPos.z - this._distanceCurrentZ);
      }
    }
  }

  /**
   * Move the avatar along Z based on the distance ratio reported by tracking.
   * Final Z = avatarBase.z + smoothed offset. Subtracting the previously-
   * applied offset before adding the new one keeps drag interaction clean.
   */
  _applyDistanceTracking() {
    if (!this.vrmLoader?.vrm) return;
    const settings = this.avatarRig?.settings;
    const distanceEnabled = settings?.enabled?.distance !== false;
    const distanceSens = settings?.sensitivity?.distance ?? 1.0;

    let target = 0;
    if (distanceEnabled && this._distanceRatio) {
      // ratio of 1.0 → 0 offset; >1 → positive (closer); <1 → negative (farther).
      const norm = (this._distanceRatio - 1.0); // typically -0.5 .. +0.8 after clamping
      target = norm * this._maxDistanceZ * distanceSens;
    }
    this._distanceTargetZ = target;

    // Smooth toward target so breathing / subtle movements don't jitter the avatar.
    this._distanceCurrentZ += (this._distanceTargetZ - this._distanceCurrentZ) * 0.08;

    const avatar = this.vrmLoader.vrm.scene;
    avatar.position.x = this.avatarBasePosition.x;
    avatar.position.z = this.avatarBasePosition.z + this._distanceCurrentZ;
  }

  onPointerUp() {
    this.isDragging = false;
    this.dragObject = null;
    if (this.sceneSetup && this.sceneSetup.controls) {
      this.sceneSetup.controls.enabled = true;
    }
    document.body.style.cursor = 'default';
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

window.addEventListener('DOMContentLoaded', () => {
  const app = new AvatarApp();
  app.init();
});
