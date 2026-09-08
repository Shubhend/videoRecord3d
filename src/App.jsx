import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FaceAppProvider, useFaceApp } from './context/FaceAppContext.jsx';
import TopNav from './components/TopNav.jsx';
import StatusHud from './components/StatusHud.jsx';
import StartPanel from './components/StartPanel.jsx';
import ModelPanel from './components/ModelPanel.jsx';
import PlacementPanel from './components/PlacementPanel.jsx';
import BodyVisibilityPanel from './components/BodyVisibilityPanel.jsx';
import BackgroundPanel from './components/BackgroundPanel.jsx';
import AudioPanel from './components/AudioPanel.jsx';
import RecordPanel from './components/RecordPanel.jsx';
import SettingsPanel from './components/SettingsPanel.jsx';

import useThreeScene from './hooks/useThreeScene.js';
import useFaceTracking from './hooks/useFaceTracking.js';
import { loadModelFromSource, disposeObject3D } from './lib/vrmLoader.js';
import { classifyParts, applyBodyVisibility } from './lib/modelVisibility.js';
import { FaceBackground } from './lib/backgroundController.js';
import { AudioLipSync, ZERO_VISEME } from './lib/audioLipSync.js';
import { FaceRecorder, downloadFaceVideo } from './lib/faceRecorder.js';
import { applyVisemeToVrm, applyFaceLandmarkExtrasToVrm } from './lib/vrmMorphMap.js';
import {
  listModels,
  getModelSource,
  getSelectedModelId,
  setSelectedModelId,
} from './lib/modelStore.js';
import {
  listPresets,
  getPreset,
  savePreset,
  deletePreset,
  getLastPresetId,
  setLastPresetId,
} from './lib/presetStore.js';
import { getAppExpressionSensitivities } from './lib/settingsStore.js';
import { DEFAULT_PLACEMENT, DEFAULT_BODY_PARTS, PLACEMENT_VERSION } from './lib/sharedDefaults.js';

// Legacy pages quick-access (kept as comment reference; linked in TopNav):
// - legacy-index.html: old full-body MediaPipe Holistic page
// - face-follow.html:  old MindAR vanilla page
// - record.html:       Jeeliz webcam recorder page
// - models.html:       model uploads management
// - settings.html:     legacy full settings page

function degToRad(d) { return (d * Math.PI) / 180; }

function FaceAppShell() {
  const ctx = useFaceApp();
  const {
    tracking, setTracking,
    placement, setPlacement,
    bodyParts, setBodyParts,
    model, setModel,
    classified, setClassified,
    activePreset, setActivePreset,
    recording, setRecording,
    background, setBackground, setBackgroundController,
    audio, setAudio,
    toast, showToast,
    trackingApi, recorderApi, actions,
  } = ctx;

  const [settingsOpen, setSettingsOpen] = useState(false);

  const stageRef = useRef(null);
  const threeScene = useThreeScene({
    containerRef: stageRef,
    onBeforeRender: (delta) => onBeforeFrame(delta),
  });
  const {
    canvasRef,
    scene,
    camera,
    renderer,
    anchorRoot,
    sceneRef,
    cameraRef,
    rendererRef,
    anchorRootRef,
    ensureSceneGraph,
    start: startScene,
  } = threeScene;

  const faceTracking = useFaceTracking({
    containerRef: stageRef,
    scene,
    sceneRef,
    camera,
    cameraRef,
    renderer,
    rendererRef,
    anchorRoot,
    anchorRootRef,
    onFaceDetected: () => setTracking((s) => ({ ...s, faceDetected: true })),
    onFaceLost: () => setTracking((s) => ({ ...s, faceDetected: false })),
  });

  const bgCtrlRef = useRef(null);
  const recorderRef = useRef(null);
  const audioEngineRef = useRef(null);
  const recordingRafRef = useRef(0);
  const recStartTimeRef = useRef(0);
  const recPauseAccumRef = useRef(0);
  const recPauseStartedAtRef = useRef(0);
  const standalonePreviewRef = useRef(true); // true while we haven't attached MindAR renderer yet
  const placementRef = useRef(placement);
  const bodyPartsRef = useRef(bodyParts);
  const modelRef = useRef(model);
  const classifiedRef = useRef(classified);
  const audioRef = useRef(audio);
  const recordingRef = useRef(recording);
  const faceMeshEnabledRef = useRef(faceMeshEnabled);
  const exprSettingsRef = useRef(null);

  useEffect(() => { placementRef.current = placement; }, [placement]);
  useEffect(() => { bodyPartsRef.current = bodyParts; }, [bodyParts]);
  useEffect(() => { modelRef.current = model; }, [model]);
  useEffect(() => { classifiedRef.current = classified; }, [classified]);
  useEffect(() => { audioRef.current = audio; }, [audio]);
  useEffect(() => { recordingRef.current = recording; }, [recording]);
  useEffect(() => { faceMeshEnabledRef.current = faceMeshEnabled; }, [faceMeshEnabled]);

  useEffect(() => {
    exprSettingsRef.current = getAppExpressionSensitivities();
  }, []);

  // ---------- Standalone preview mount: scene + canvas + render loop ASAP ----------
  useEffect(() => {
    // Guarantee scene graph + canvas + render loop starts even before user clicks any button.
    // This ensures: (1) "Load model" shows model preview instantly and visibly.
    //              (2) Placement sliders work immediately, not only after tracking start.
    let detached = false;
    Promise.resolve().then(() => {
      if (detached) return;
      try {
        ensureSceneGraph?.();
        // In standalone preview the model should be visible, centered, camera-friendly.
        // Override default placement just on initial mount for standalone preview;
        // MindAR mode switches to AR-relative DEFAULT_PLACEMENT automatically later.
        const cam = cameraRef?.current;
        if (cam) {
          cam.position.set(0, 1.5, 2.1);
          cam.lookAt?.(0, 1.5, 0);
          cam.near = 0.01;
          cam.far = 100;
          cam.updateProjectionMatrix?.();
        }
        const anchor = anchorRootRef?.current;
        if (anchor) {
          // Preview pose: model at eye level, small size so full avatar is framed.
          anchor.position.set(0, 1.5, 0);
          anchor.rotation.set(0, 0, 0);
          const s = 0.9;
          anchor.scale.set(s, s, s);
        }
        if (canvasRef?.current && !rendererRef?.current) {
          try { startScene?.({}); } catch {}
        }
      } catch (errInit) {
        console.warn('Preview scene init skipped:', errInit);
      }
    });
    return () => { detached = true; };
  }, [ensureSceneGraph, startScene, canvasRef, cameraRef, anchorRootRef, rendererRef]);

  // ---------- Background controller ----------
  useEffect(() => {
    if (!stageRef.current) return;
    const ctrl = new FaceBackground(stageRef.current);
    bgCtrlRef.current = ctrl;
    setBackgroundController(ctrl);
    setBackground({ ...ctrl.config });
    return () => { /* App-level cleanup sufficient */ };
  }, [setBackground, setBackgroundController]);

  // ---------- Recorder ----------
  useEffect(() => {
    recorderRef.current = new FaceRecorder();
  }, []);

  // ---------- Apply placement to anchor ----------
  useEffect(() => {
    const anchor = anchorRootRef?.current ?? anchorRoot;
    if (!anchor) return;
    const p = placementRef.current;
    anchor.position.set(p.posX, p.posY, p.posZ);
    anchor.rotation.set(degToRad(p.rotX), degToRad(p.rotY), degToRad(p.rotZ));
    const s = p.scaleMul ?? 1;
    anchor.scale.set(s, s, s);
  }, [placement, anchorRoot, anchorRootRef]);

  // ---------- Apply body visibility on changes ----------
  useEffect(() => {
    const m = modelRef.current;
    const c = classifiedRef.current;
    if (!m.modelRoot || !c) return;
    applyBodyVisibility(m.modelRoot, m.vrm, c, bodyPartsRef.current);
  }, [bodyParts, model.modelRoot, classified]);

  // ---------- Per-frame update loop (viseme + VRM update + record paint) ----------
  function onBeforeFrame(delta) {
    const m = modelRef.current;
    const vrm = m.vrm;
    if (vrm && typeof vrm.update === 'function') {
      try { vrm.update(delta); } catch {}
    }

    // Apply viseme / expressions
    const aud = audioRef.current;
    const engine = audioEngineRef.current || aud.engine;
    const opts = exprSettingsRef.current || {};
    const settings = opts.expressionsEnabled != null ? {
      mouthEnabled: opts.mouthEnabled !== false,
      eyesEnabled: opts.eyesEnabled !== false,
      expressionsEnabled: opts.expressionsEnabled !== false,
      intensity: (opts.faceIntensity ?? 1),
      mouthIntensity: (opts.mouthIntensity ?? 1),
      eyesIntensity: (opts.eyesIntensity ?? 1),
      audioLipSyncMultiplier: opts.audioLipSyncMultiplier ?? 1,
      visemeSettings: null,
    } : {};
    if (vrm) {
      let vis = ZERO_VISEME;
      if (engine && aud.syncEnabled && engine.sampleCurrent) {
        try { vis = engine.sampleCurrent() || ZERO_VISEME; } catch { vis = ZERO_VISEME; }
      }
      applyVisemeToVrm(vrm, vis, settings);
      // Only apply face-landmark extra morphs (brow/frown/smile) when mesh is enabled.
      const meshOn = !!faceMeshEnabledRef.current;
      applyFaceLandmarkExtrasToVrm(vrm, meshOn ? { browRaise: 0, frown: 0, smile: 0 } : { browRaise: 0, frown: 0, smile: 0 });
    }

    // When faceMeshEnabled is off AND we're in standalone preview, freeze anchor to identity pose
    // (no-op; MindAR still drives anchor when attached, but it won't animate morphs).
    if (!faceMeshEnabledRef.current) {
      const anchor = anchorRootRef?.current;
      if (anchor && m.modelRoot) {
        // Keep model in a resting neutral pose: reset per-frame landmarks override if any applied
        if (vrm) {
          try {
            // Neutralize any lingering face-expression animation delta when user toggles off mirroring
            if (typeof vrm.expressionManager?.setValue === 'function') {
              // VRM1 expression manager: no-op here, kept as extensibility hook
            }
          } catch {}
        }
      }
    }

    // Recording composite paint
    const rec = recordingRef.current;
    if (rec.state === 'recording' || rec.state === 'paused') {
      const recorder = recorderRef.current;
      const glCanvas = renderer?.domElement;
      const faceVideoEl = (bgCtrlRef.current && bgCtrlRef.current._getActiveCameraVideo?.())
        || document.querySelector('#stage-container video:not(.bg-image-layer)')
        || null;
      const w = glCanvas?.width || 1280;
      const h = glCanvas?.height || 720;
      try {
        recorder.paintFrame(faceVideoEl, glCanvas, bgCtrlRef.current, w, h);
      } catch (e) {
        // silent: occasional paint failures should not abort recording
      }
    }
  }

  // ---------- Tracking start/stop ----------
  const handleStartTracking = useCallback(async () => {
    try {
      // 1) Pre-create our scene/anchor in refs so useFaceTracking can reparent anchor under
      //    MindAR's anchor.group with the correct shared THREE objects.
      ensureSceneGraph?.();

      // 2) Start MindAR — it will create its own <video> + <canvas> inside stage-container
      //    in the correct sibling order for preview layering. After start it patches the
      //    shared rendererRef/sceneRef/cameraRef to point at its instances.
      await faceTracking.start();

      // 3) Start our RAF ticker (runs VRM update + viseme + record paint). Use the
      //    renderer MindAR created (patch happened inside start above), attachOnly mode.
      try {
        startScene({
          renderer: rendererRef.current,
          attachOnly: true,
        });
        standalonePreviewRef.current = false; // no longer standalone preview
      } catch (errAttach) {
        // non-fatal: the loop may already be running
      }

      // 4) MindAR AR face-anchor uses its own relative coordinate system where
      //    DEFAULT_PLACEMENT (posY=-13, etc.) is the correct avatar offset vs forehead.
      //    Force a re-apply now that MindAR owns the scene transform.
      try {
        const p = placementRef.current;
        const anchor = anchorRootRef?.current ?? anchorRoot;
        if (anchor) {
          anchor.position.set(p.posX, p.posY, p.posZ);
          anchor.rotation.set(degToRad(p.rotX), degToRad(p.rotY), degToRad(p.rotZ));
          const s = p.scaleMul ?? 1;
          anchor.scale.set(s, s, s);
        }
      } catch {}

      setTracking({ started: true, faceDetected: false });
      bgCtrlRef.current?._scheduleApply?.();
      try { bgCtrlRef.current?.apply?.(); } catch {}
      showToast('Face tracking started', 'ok');
    } catch (err) {
      console.error(err);
      const msg = (err && err.message) ? String(err.message) : String(err || 'Unknown error');
      showToast(`Tracking: ${msg}`, 'error');
    }
  }, [faceTracking, startScene, ensureSceneGraph, rendererRef, setTracking, showToast, anchorRoot, anchorRootRef]);

  const handleStopTracking = useCallback(() => {
    try { faceTracking.stop(); } catch {}
    setTracking({ started: false, faceDetected: false });
  }, [faceTracking, setTracking]);

  useEffect(() => {
    trackingApi.current = { start: handleStartTracking, stop: handleStopTracking };
  }, [trackingApi, handleStartTracking, handleStopTracking]);

  // ---------- Model load ----------
  const handleLoadModel = useCallback(async (id) => {
    setModel((s) => ({ ...s, loading: true, loaded: false }));
    // Always guarantee scene graph and render loop exist before loading.
    try { ensureSceneGraph?.(); } catch {}
    if (canvasRef?.current && !rendererRef?.current) {
      try { startScene?.({}); } catch {}
    }
    try {
      // Dispose prior
      const prev = modelRef.current;
      const anchor = anchorRootRef?.current ?? anchorRoot;
      if (prev.modelRoot && anchor) {
        try { anchor.remove(prev.modelRoot); } catch {}
        try { disposeObject3D(prev.modelRoot); } catch {}
      }
      if (prev.vrm && typeof prev.vrm.dispose === 'function') {
        try { prev.vrm.dispose(); } catch {}
      }

      const source = await getModelSource(id);
      const { modelRoot, vrm, isVrm } = await loadModelFromSource(source);
      setSelectedModelId(id);

      if (anchor) {
        try { anchor.add(modelRoot); } catch (eAnchor) {
          // Anchor still not created? create and add again.
          ensureSceneGraph?.();
          const a2 = anchorRootRef?.current;
          if (a2) a2.add(modelRoot);
        }
      }

      // Standalone preview centering: after successful load, ensure model is
      // framed in the preview camera if we haven't attached MindAR renderer yet.
      const stillStandalone = standalonePreviewRef.current || !tracking.started;
      if (stillStandalone) {
        const cam = cameraRef?.current;
        const a = anchorRootRef?.current ?? anchorRoot;
        if (a) {
          a.position.set(0, 1.5, 0);
          a.rotation.set(0, 0, 0);
          const s = 0.9;
          a.scale.set(s, s, s);
          // Sync context placement so PlacementPanel doesn't show stale values vs actual preview
          setPlacement({
            version: PLACEMENT_VERSION || placementRef.current.version,
            posX: 0,
            posY: 1.5,
            posZ: 0,
            rotX: 0,
            rotY: 0,
            rotZ: 0,
            scaleMul: s,
          });
        }
        if (cam) {
          cam.position.set(0, 1.5, 2.1);
          cam.lookAt?.(0, 1.5, 0);
          cam.near = 0.01;
          cam.far = 100;
          cam.updateProjectionMatrix?.();
        }
      }

      const models = await listModels();
      const modelInfo = models.find((x) => x.id === id) || { name: source.name, id };

      const cl = classifyParts(modelRoot, vrm || null);
      setClassified(cl);
      applyBodyVisibility(modelRoot, vrm || null, cl, bodyPartsRef.current);

      setModel({
        id,
        name: modelInfo.name,
        loaded: true,
        loading: false,
        modelRoot,
        vrm: vrm || null,
        isVrm: !!isVrm,
      });
      showToast(`Loaded ${modelInfo.name}`, 'ok');
    } catch (err) {
      console.error(err);
      setModel((s) => ({ ...s, loading: false }));
      const raw = (err && err.message) ? String(err.message) : String(err || 'Unknown model-load error');
      let msg = raw;
      if (/unexpected token\s*[<']/i.test(raw) || /doctype/i.test(raw) || /html/i.test(raw)) {
        msg = 'Built-in model file not found on disk. Upload a model via the Models page or place your .vrm/.glb files under /models/ in the project.';
      } else if (/404|not found/i.test(raw)) {
        msg = 'Model file not found on the server. Upload a new model via the Models page or check the file exists on disk.';
      }
      showToast(`Model failed: ${msg}`, 'error');
    }
  }, [anchorRoot, anchorRootRef, setModel, setClassified, setPlacement, showToast, ensureSceneGraph, startScene, canvasRef, rendererRef, cameraRef, tracking]);

  // ---------- Presets ----------
  const handleApplyPreset = useCallback(async (presetOrId) => {
    const preset =
      typeof presetOrId === 'string' ? await getPreset(presetOrId) : presetOrId;
    if (!preset) { showToast('Preset not found', 'error'); return; }
    if (preset.modelId && preset.modelId !== modelRef.current.id) {
      await handleLoadModel(preset.modelId);
    }
    const p = { ...DEFAULT_PLACEMENT, ...(preset.placement || {}) };
    const bp = { ...DEFAULT_BODY_PARTS, ...(preset.bodyParts || {}) };
    setPlacement(p);
    setBodyParts(bp);
    setActivePreset({ id: preset.id, name: preset.name });
    setLastPresetId(preset.id);
    showToast(`Applied "${preset.name}"`, 'ok');
  }, [setPlacement, setBodyParts, setActivePreset, showToast, handleLoadModel]);

  const handleSavePreset = useCallback(async (nameInput) => {
    const m = modelRef.current;
    const placement = placementRef.current;
    const bodyParts = bodyPartsRef.current;
    const name =
      (typeof nameInput === 'string' && nameInput.trim()) ||
      window.prompt('Save preset as…', `Preset ${new Date().toLocaleString()}`);
    if (!name) return;
    const saved = await savePreset({
      name,
      placement,
      bodyParts,
      modelId: m.id,
      modelName: m.name,
    });
    setActivePreset({ id: saved.id, name: saved.name });
    showToast(`Saved preset "${saved.name}"`, 'ok');
  }, [showToast, setActivePreset]);

  const handleDeletePreset = useCallback(async (id) => {
    if (!id) return;
    if (!window.confirm('Delete this preset?')) return;
    await deletePreset(id);
    if (activePreset.id === id) setActivePreset({ id: null, name: null });
    showToast('Preset deleted', 'ok');
  }, [activePreset, setActivePreset, showToast]);

  // ---------- Recorder API wiring ----------
  const handleRecStart = useCallback(async (withAudio) => {
    const rec = recorderRef.current;
    if (!rec) return;
    const m = modelRef.current;
    if (!m.loaded) { showToast('Load a model first', 'error'); return; }
    let audioStream = null;
    if (withAudio) {
      const engine = audioEngineRef.current || audioRef.current.engine;
      if (engine && typeof engine.getAudioOutputStream === 'function') {
        try { audioStream = engine.getAudioOutputStream(); } catch {}
      }
      if (!audioStream) {
        const fallback = audioEngineRef.current?.audioCtx?.destination?.stream
          || audioRef.current.engine?.audioCtx?.createMediaStreamDestination?.().stream
          || null;
        if (fallback) audioStream = fallback;
      }
    }
    try {
      await rec.start(audioStream);
    } catch (err) {
      showToast(`Rec start: ${err.message || err}`, 'error');
      return;
    }
    recStartTimeRef.current = performance.now();
    recPauseAccumRef.current = 0;
    recPauseStartedAtRef.current = 0;
    setRecording({ state: 'recording', durationMs: 0 });
    tickRecording();
    showToast('Recording started', 'ok');
  }, [setRecording, showToast]);

  const handleRecPause = useCallback(() => {
    if (recordingRef.current.state !== 'recording') return;
    recorderRef.current?.pause?.();
    recPauseStartedAtRef.current = performance.now();
    setRecording({ state: 'paused', durationMs: recordingRef.current.durationMs });
  }, [setRecording]);

  const handleRecResume = useCallback(() => {
    if (recordingRef.current.state !== 'paused') return;
    recorderRef.current?.resume?.();
    if (recPauseStartedAtRef.current) {
      recPauseAccumRef.current += performance.now() - recPauseStartedAtRef.current;
      recPauseStartedAtRef.current = 0;
    }
    setRecording({ state: 'recording', durationMs: recordingRef.current.durationMs });
    tickRecording();
  }, [setRecording]);

  const handleRecStop = useCallback(async () => {
    cancelAnimationFrame(recordingRafRef.current);
    const blob = await recorderRef.current?.stop?.();
    setRecording({ state: 'idle', durationMs: 0 });
    if (!blob) { showToast('No recording data', 'error'); return; }
    try {
      const name = `face-follow-${Date.now()}`;
      downloadFaceVideo(blob, name);
      showToast('Saved .mp4', 'ok');
    } catch (err) {
      showToast(`Save failed: ${err.message || err}`, 'error');
    }
  }, [setRecording, showToast]);

  function tickRecording() {
    cancelAnimationFrame(recordingRafRef.current);
    function loop() {
      const rec = recordingRef.current;
      if (rec.state !== 'recording') return;
      const now = performance.now();
      const elapsed = now - recStartTimeRef.current - recPauseAccumRef.current;
      setRecording((s) => ({ ...s, durationMs: Math.max(0, Math.floor(elapsed)) }));
      recordingRafRef.current = requestAnimationFrame(loop);
    }
    recordingRafRef.current = requestAnimationFrame(loop);
  }

  useEffect(() => {
    recorderApi.current = {
      start: handleRecStart,
      pause: handleRecPause,
      resume: handleRecResume,
      stop: handleRecStop,
    };
  }, [recorderApi, handleRecStart, handleRecPause, handleRecResume, handleRecStop]);

  // ---------- actions.ref wiring ----------
  useEffect(() => {
    actions.current = {
      loadModelById: handleLoadModel,
      applyPreset: handleApplyPreset,
      savePresetAs: handleSavePreset,
      deletePreset: handleDeletePreset,
      listModels,
      listPresets,
    };
  }, [actions, handleLoadModel, handleApplyPreset, handleSavePreset, handleDeletePreset]);

  // ---------- Attach audio engine created in AudioPanel to ref here via context? ----------
  // Simple: whenever context audio.engine changes, write it to audioEngineRef.
  useEffect(() => {
    if (audio.engine && audio.engine !== audioEngineRef.current) {
      audioEngineRef.current = audio.engine;
    }
  }, [audio.engine]);

  // ---------- Hydrate default selected model ----------
  useEffect(() => {
    // no-op autopreload; user must click Start then Load (per legacy flow)
  }, []);

  // ---------- Auto-apply last preset on mount (after tracking starts?) ----------
  // Legacy: apply preset from getLastPresetId() only if user has previously saved one.
  // Here: keep as manual selection for simplicity, but expose it through PlacementPanel list.
  //
  // Note: MindAR creates its own <video> + <canvas> inside stage-container on start().
  // Stage container intentionally starts empty so sibling order is [video, canvas, backdrop].

  return (
    <div className="app-shell">
      <TopNav settingsOpen={settingsOpen} setSettingsOpen={setSettingsOpen} />
      <div className="layout">
        <div className="stage">
          <div id="stage-container" ref={stageRef} style={{ position: 'absolute', inset: 0 }}>
            {/* Standalone preview canvas used BEFORE MindAR starts. MindAR will inject its own
                <video>+<canvas> on start(), and useThreeScene.start({attachOnly:true}) will
                dispose/remove this preview canvas to avoid double-rendering. */}
            {!tracking.started && (
              <canvas
                key="standalone-preview"
                ref={(el) => { try { canvasRef.current = el; } catch {} }}
                style={{
                  position: 'absolute',
                  inset: 0,
                  left: 0,
                  top: 0,
                  right: 0,
                  bottom: 0,
                  width: '100%',
                  height: '100%',
                  zIndex: 2,
                  display: 'block',
                  background:
                    'radial-gradient(ellipse at 50% 40%, #16213e 0%, #0a0e1a 55%, #06080f 100%)',
                }}
              />
            )}
          </div>
        </div>
        <aside className="sidebar">
          <StatusHud />
          {settingsOpen && (
            <div style={{ display: 'contents' }}>
              <SettingsPanel openFromApp={settingsOpen} />
            </div>
          )}
          <StartPanel />
          <ModelPanel />
          <PlacementPanel />
          <BodyVisibilityPanel />
          <BackgroundPanel />
          <AudioPanel />
          <RecordPanel />
        </aside>
      </div>
      {toast.message && (
        <div
          className="toast"
          onClick={() => ctx.hideToast()}
          style={{
            position: 'fixed',
            top: 72,
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '10px 16px',
            borderRadius: 10,
            background: 'rgba(15,20,36,0.95)',
            border:
              toast.tone === 'error'
                ? '1px solid rgba(255,85,102,0.45)'
                : toast.tone === 'ok'
                ? '1px solid rgba(0,255,136,0.45)'
                : '1px solid var(--border-strong)',
            color: 'var(--text)',
            fontSize: 13,
            zIndex: 200,
            cursor: 'pointer',
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          }}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <FaceAppProvider>
      <FaceAppShell />
    </FaceAppProvider>
  );
}
