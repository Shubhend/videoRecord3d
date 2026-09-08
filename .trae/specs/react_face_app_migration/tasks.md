# Edge AI Face-Follow React Migration — Implementation Plan

This plan maps each Acceptance Criterion from `spec.md` to concrete implementation tasks. Tasks are dependency-ordered vertically — complete the scaffolding first, then add features layer by layer, then wire persistence + polish.

## Task 1: Add React dependencies + Vite React plugin; scaffold src/ entry points
- **Status**: `pending`
- **Priority**: high
- **Depends On**: None
- **Description**:
  - Install `react@^18`, `react-dom@^18`, `@vitejs/plugin-react` as appropriate for Vite 6.
  - Register `@vitejs/plugin-react` in `vite.config.js`; keep existing MindAR alias, base: `'./'`, and `rollupOptions.input` list (add new React entry).
  - Create `src/main.jsx` that mounts React into a root DOM node (introduces the node in a new React-entry HTML file; we will make `index.html` the React entry, and move the current full-body page to `legacy-index.html` so the old URL isn't lost).
  - Create `src/App.jsx` that imports a CSS reset + minimal layout: top nav, main canvas area, side control panel.
  - Verify `npm run build` succeeds with React bundled (no runtime React errors yet because no components actually render anything interactive).
- **Acceptance Criteria Addressed**: AC-1, AC-10
- **Test Requirements**:
  - `rule` TR-1.1: `npm.cmd run build` exits 0; `dist/assets/` contains one hashed JS chunk that includes React (search for `createRoot` string in bundle).
  - `rule` TR-1.2: No `@mediapipe` CDN URLs in generated `dist/index.html` or `dist/*.html` `<script>` tags.
  - `rubric` TR-1.3: Scaffold cleanliness; scale 1-5; 1 = weird hacks mixing legacy and React in same root; 3 = works but files scattered; 5 = cleanly separated `src/` entry under `src/main.jsx` + `src/App.jsx` + `src/index.css`; pass threshold >= 4.
- **Notes**: Legacy multi-page HTML (`face-follow.html`, `record.html`, etc.) remain listed in Vite's `rollupOptions.input` unchanged for now so their build isn't broken. The new React app replaces only `index.html`.

## Task 2: Port persistence libraries (IndexDB + localStorage wrappers) to src/lib/ with identical keys
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 1
- **Description**:
  - Create `src/lib/modelStore.js` — ports `js/faceFollowModelStore.js` logic exactly: DB `edge_ai_models`, store `models`, `DEFAULT_MODEL`/`FACE_GLB_MODEL`, `FACE_MODEL_KEY = 'faceFollowSelectedModelId'`. Exports `listModels`, `getModelSource`, `getSelectedModelId`, `setSelectedModelId`. Keep blob/URL semantics identical.
  - Create `src/lib/presetStore.js` — ports `js/faceFollowPlacementPresets.js`: DB `edge_ai_models`, store `placementPresets`, `LAST_KEY = 'faceFollowLastPresetId'`. Exports `listPresets`, `getPreset`, `savePreset`, `deletePreset`, `getLastPresetId`, `setLastPresetId`, `normalizePreset`. Keep `DEFAULT_PLACEMENT`/`DEFAULT_BODY_PARTS` in a shared `src/lib/sharedDefaults.js` (copied from `js/faceFollowMindarShared.js`).
  - Create `src/lib/settingsStore.js` — ports `js/settingsStore.js` (full default object with `sensitivity`/`enabled`/`smoothing`/`trackingMedia` sections) and `js/faceFollowAppSettings.js` helpers `getAppExpressionSensitivities`/`buildExprSettingsFromApp`/`getFaceTrackingLerp` under new names; KEY = `edge_ai_settings_v1`.
  - Create `src/lib/backgroundStore.js` — ports `js/faceFollowBackground.js` load/save logic only (no DOM). KEY = `faceFollowBackground_v1`. Exports `load`, `save`, default config.
  - Add unit smoke tests via inline dev-only self-check (or console assert) so that reading defaults returns exact legacy values; no jest required.
- **Acceptance Criteria Addressed**: AC-3, AC-5, AC-9, AC-10, NFR-5
- **Test Requirements**:
  - `rule` TR-2.1: Stringify `loadAppSettings()` default output and compare byte-for-byte against legacy `js/settingsStore.js DEFAULT_SETTINGS` → matches modulo key order (compare parsed objects, not JSON strings).
  - `rule` TR-2.2: `normalizePreset({id:''})` produces same `placement` keys/values as legacy DEFAULT_PLACEMENT + DEFAULT_BODY_PARTS.
  - `rule` TR-2.3: All localStorage key names and IndexedDB `DB_NAME`/`STORE`/keyPath names identical to legacy (manual cross-check with grep of `js/` folder + `src/lib/`).

## Task 3: Create useFaceTracking + useThreeScene hooks with MindAR engine (replaces CDN MediaPipe)
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 2
- **Description**:
  - Create `src/hooks/useThreeScene.js`: owns a `THREE.Scene`, `THREE.WebGLRenderer`, `THREE.PerspectiveCamera`, and an animation loop driven by `requestAnimationFrame`. Exposes a ref-attached `<canvas>`, the scene reference, and start/stop controls. Respects the container size via `ResizeObserver`.
  - Create `src/hooks/useFaceTracking.js`: owns `MindARThree` instance. On `start()`, requests camera, initializes MindAR with face anchor count = 1, attaches anchor group to the scene, and provides callbacks `onFaceDetected`/`onFaceLost`. On `stop()`, cleanly stops MindAR session + releases camera stream (no dangling `useMedia` camera indicator).
  - Create `src/lib/vrmLoader.js`: thin module that imports `GLTFLoader` + `VRMLoaderPlugin` correctly from the npm `@pixiv/three-vrm@^2` + compatible GLTFLoader addon path; exports `async loadVRM(source, manager)` that returns a VRM instance (with auto scene-update callback bound). Also handles `.glb` files without VRM plugin.
  - No component wiring yet — write a dev-only smoke mount in App.jsx that renders the canvas, lets the user click a single start button, and shows a colored placeholder cube anchored to the face. Confirm cube moves with face.
- **Acceptance Criteria Addressed**: AC-1, AC-2, AC-10, AC-11
- **Test Requirements**:
  - `rule` TR-3.1: Clicking "Start" triggers camera prompt, no console errors, and the placeholder cube is tracked to anchor position when face is present.
  - `rule` TR-3.2: Clicking "Stop" releases the camera within 2 seconds (Chrome tab camera indicator disappears).
  - `rubric` TR-3.3: Tracking loop quality; scale 1-5; 1 = setState on every frame causes 1fps React re-renders; 3 = some unnecessary re-renders but usable; 5 = raf loop only touches refs, components subscribe via discrete state transitions (started/stopped, faceDetected true/false); pass threshold >= 4.
- **Notes**: MindAR is selected for the face engine here per spec Background section — it ships via npm and does not share the Emscripten WASM architecture that caused the original `_emval_new_array` crash. This directly eliminates AC-2 failure modes.

## Task 4: Model panel (list + load) and mesh + visibility integration with VRM scene
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 3
- **Description**:
  - Create `src/components/ModelPanel.jsx`: renders `<select>` populated by `listModels()` from modelStore, shows "(built-in)" / "(uploaded)" labels, auto-selects the localStorage-selected model ID. "Load model on face" button calls a loader and attaches the loaded VRM/GLB root to the MindAR anchor group. Loading shows a loading indicator.
  - Integrate `src/lib/vrmLoader.js` with the scene hook so loaded models are added to the anchor; supports switching models (disposes previous VRM's scene nodes + materials + geometries cleanly).
  - Implement body-part visibility: for VRM, traverse the VRM humanoid bones' parents and the `scene` graph for head/hair meshes; provide helper functions `setHeadVisible`, `setHairVisible`, `setBodyVisible`, `setArmsVisible`, `setLegsVisible`; use a heuristic for non-VRM GLB files: mesh name substring matching (typical Blender export names) and a toggleable "Head only" mode that scales the torso/legs/arms alpha to 0 instead of hiding them outright (if exact parts cannot be identified).
  - Ensure previously-selected model ID is written back to `setSelectedModelId` when user picks a different model.
- **Acceptance Criteria Addressed**: AC-3, AC-4
- **Test Requirements**:
  - `rule` TR-4.1: Dropdown shows both built-ins and uploaded models; default selection matches `localStorage.faceFollowSelectedModelId`.
  - `rule` TR-4.2: Loading AliciaSolid.vrm produces a visible face mesh on the anchor; toggling "Head only" hides torso mesh visibly.
  - `rubric` TR-4.3: Dispose behaviour; scale 1-5; 1 = switching models leaks geometries and crashes tab after 10 loads; 3 = most memory freed but occasional warnings; 5 = every dispose called, no Three.js "memory used growing" warnings in console on 5 consecutive model switches; pass threshold >= 4.

## Task 5: Placement tuning panel + placement presets CRUD panel
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 4
- **Description**:
  - Create `src/components/PlacementPanel.jsx`: renders 7 numeric inputs (Pos X/Y/Z, Rot X/Y/Z, Scale) with the legacy ranges/step values from `face-follow.html` controls; plus "Auto-fit to face" and "Reset placement" buttons. Writes current placement to the MindAR anchor group's `position`, `rotation` (convert deg -> rad), `scale` each time value changes (with controlled inputs).
  - Create `src/components/BodyVisibilityPanel.jsx`: 6 toggles (Head, Hair, Body, Arms, Legs, Head-only). Applies visibility helpers from Task 4 live.
  - Create `src/components/PresetPanel.jsx`: preset `<select>` (includes empty header "— Saved presets —"), Delete (×) button, Save (💾) button with prompt for name via `window.prompt` or inline text input. Preset dropdown refresh on mount + after save/delete. Auto-apply preset on dropdown change (reload model if its stored modelId differs from current). On load, try to apply `getLastPresetId()` preset if it exists.
  - Provide shared state via React context (`src/context/FaceAppContext.jsx`) for `{ placement, setPlacement, bodyParts, setBodyParts, model, setModel, trackingStatus, ... }` so panels don't require prop-drilling through 6 layers.
- **Acceptance Criteria Addressed**: AC-4, AC-5
- **Test Requirements**:
  - `rule` TR-5.1: "Reset placement" restores placement + bodyPart values exactly from `DEFAULT_PLACEMENT` / `DEFAULT_BODY_PARTS`.
  - `rule` TR-5.2: Full CRUD round-trip with page reload in between: save preset A with name "Test1", reload, select "Test1" → stored placement values reproduce original values (tolerance 1e-6 for floats).
  - `rule` TR-5.3: Preset with modelId different from current triggers a model switch before applying placement; resulting active modelId matches.

## Task 6: Background panel + visual treatment + recording composite integration
- **Status**: `pending`
- **Priority**: medium
- **Depends On**: Task 3
- **Description**:
  - Create `src/components/BackgroundPanel.jsx`: mode `<select>` (5 modes), blur number input, color picker input, image file input, clear image button, screen share start/stop buttons + status.
  - Create `src/lib/backgroundController.js`: class (not React) that owns DOM elements for image backdrop layer + screen-share video layer if needed, or alternatively implements a fullscreen Three.js plane behind the avatar for "color/image/screen" modes. Whichever is simpler without breaking the PiP semantics: prefer CSS layering mirroring the legacy page's approach (since MindAR creates the camera feed on the DOM already). Implement `drawCameraPip` / `drawGlCanvasPip` for screen share mode so they look identical to legacy.
  - Ensure the background configuration object is saved via `backgroundStore` on every change; rehydrate on mount.
- **Acceptance Criteria Addressed**: AC-6
- **Test Requirements**:
  - `rule` TR-6.1: Each of the 5 background modes renders a visually distinct result in live view (verify screenshots vs legacy page).
  - `rule` TR-6.2: Screen share mode stop works both via UI button and via browser native "Stop sharing" Chrome toolbar — status line updates to "Screen: off" in both cases within 1 second.
  - `rubric` TR-6.3: PiP layout fidelity in screen share mode vs legacy page; scale 1-5; 1 = completely different layout; 3 = mostly similar but sizes off; 5 = identical size/position/border/overlay to legacy CSS; pass threshold >= 4.

## Task 7: Audio lip-sync panel + wire to VRM blend shapes / mouth morphs
- **Status**: `pending`
- **Priority**: medium
- **Depends On**: Task 4
- **Description**:
  - Port `js/audioLipsync.js` and `js/faceFollowPhonemeViseme.js`, `js/faceFollowAudioLip.js` logic into `src/lib/audioLipSync.js` (combined wrapper with same API as legacy `AudioLipSync` class).
  - Create `src/components/AudioPanel.jsx`: audio file input, status line, Play/Pause buttons, "Sync mouth to audio" toggle. Intensity multiplier is read from settings store (audioLipSync sensitivity) on mount and applied via `setIntensity()`.
  - Wire per-frame viseme output into the VRM blend-shape proxy: for VRM 1.0 models, write AA / I / O / E / U blend shapes (or whatever the `faceFollowMorphMap.js` mapping says; port that mapping into `src/lib/vrmMorphMap.js`). For non-VRM GLB, apply a simple uniform mouth-open scale to the head mesh if morph targets are absent or unknown.
- **Acceptance Criteria Addressed**: AC-7
- **Test Requirements**:
  - `rule` TR-7.1: Uploading any audio file sets `hasAudio() === true`; Play button triggers Web Audio playback (can hear sound or `AudioContext.state === 'running'` in devtools).
  - `rule` TR-7.2: During playback of speech audio, viseme sample log shows mouthOpen > 0.05 at least 20% of frames.
  - `rubric` TR-7.3: Viseme naturalness; scale 1-5; 1 = random twitching; 3 = opens on vowels but timings off; 5 = visibly synchronized to audio like legacy page; pass threshold >= 4.

## Task 8: Recording panel (MP4 composite + optional audio)
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Tasks 6, 7
- **Description**:
  - Port `js/faceFollowRecorder.js` + `js/faceFollowMp4Export.js` into `src/lib/faceRecorder.js` (same classes: `FaceRecorder`, export helpers `pickFaceRecordMime`, `ensureMp4Blob`, `downloadFaceVideo`). Use existing implementations unchanged where possible.
  - Create `src/components/RecordPanel.jsx`: Start / Start+audio / Pause / Resume / Stop & save buttons. Status line shows recording state + duration counter (mm:ss formatted). Disable conflicting controls (e.g. switch models) while recording.
  - Wire Start+audio mode to grab the audio lip-sync engine's playing stream (or if audio is not playing, use `audioStream` from lip-sync engine's `WebAudio` → `MediaStreamDestination` so it can be mixed into the recording even during playback).
- **Acceptance Criteria Addressed**: AC-8, AC-7
- **Test Requirements**:
  - `rule` TR-8.1: Start → wait 5s → Stop produces an .mp4 file (verify extension after download) that is ≥ 100KB in size and plays in Chrome without decoder error.
  - `rule` TR-8.2: Start+audio with a loaded 440Hz sine wav file playing: file properties show an audio track, and playback in a media player outputs the tone.
  - `rule` TR-8.3: Pause at 3s, wait 2s, Resume, record 3 more, Stop → total duration in file properties ≈ 6s ± 0.5s (no 2s gap).

## Task 9: App shell (top nav, status HUD, panel layout)
- **Status**: `pending`
- **Priority**: medium
- **Depends On**: Tasks 4-8 (can be done in parallel with 6/7/8 since it's purely layout, but after wiring for final integration)
- **Description**:
  - Create `src/components/TopNav.jsx`: brand label "EA Edge AI Avatar", links to Models (`/models.html`), Record legacy (`/record.html`), Settings inline (toggle a collapsible `SettingsPanel`), and link to legacy full-body page if kept.
  - Create `src/components/StatusHud.jsx`: live-view status: tracking state ("Face mesh: active"/"off"), loaded model name, active preset name, recording timer + indicator dot. Updates based on context state only (not every frame).
  - Create `src/components/SettingsPanel.jsx`: minimal in-app settings that modifies the `edge_ai_settings_v1` keys for: face/mouth/eyes/expressions/audio sensitivity multipliers + smoothing.face slider. These only update the settings store — actual re-read happens in the relevant panels (e.g. audioPanel reads settings before playback). No need to port every setting from legacy Settings page for MVP; port only those used by the face-follow pipeline (which are the ones in `getAppExpressionSensitivities()` and `getFaceTrackingLerp()`).
  - Style panels with minimal native CSS using `<details>`/`<summary>` collapsible sections so layout matches the legacy "stacked panels" order from the face-follow page control column.
- **Acceptance Criteria Addressed**: FR-18, FR-19, FR-20
- **Test Requirements**:
  - `rule` TR-9.1: All 6 panels (Status, Model, Tuning/Placement, Body, Background, Audio, Record) are reachable without scrolling on a 1080p viewport OR accessible via smooth scroll; top nav always visible above canvas.
  - `rubric` TR-9.2: Layout clarity; scale 1-5; 1 = panels overflow horizontally / overlap canvas; 3 = usable but cramped; 5 = clean sidebar (300–320 px wide) + full canvas + top nav, exact visual heirarchy of legacy; pass threshold >= 4.

## Task 10: Final integration build + regression check against all ACs
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Tasks 1–9
- **Description**:
  - Full build `npm run build` with terser; check for unused import warnings; fix any leftover `public/` bare-import paths by moving files into src/ if needed.
  - Manual end-to-end run-through against AC-3 through AC-8: upload a model, save preset, reload app, cycle backgrounds, play audio with lip-sync, record with audio.
  - Address any build warnings that Vite 6 flags as problematic (e.g. CJS→ESM deprecation warnings are non-blocking but should not be new).
  - Add "Legacy pages" quick-access links README-like note in a comment at the top of `src/App.jsx` to indicate legacy-index and face-follow.html still exist if needed.
- **Acceptance Criteria Addressed**: All ACs re-checked; specifically AC-1, AC-2, AC-9, AC-11.
- **Test Requirements**:
  - `rule` TR-10.1: `npm.cmd run build` exit 0 + no console errors when opening the built `dist/index.html` via a static server (`npx serve dist` or similar) and performing the full workflow (start → load model → load audio → record 5s → save).
  - `rule` TR-10.2: No occurrence of strings `cdn.jsdelivr.net/npm/@mediapipe` or `unpkg.com/@mediapipe` in the built output or any network requests during the workflow.
  - `rubric` TR-10.3: End-to-end subjective workflow smoothness; scale 1-5; 1 = crashes midway; 3 = works but requires 2+ page reloads to recover from state; 5 = one click start, flows through all panels without reload, finishes with a saved MP4 on disk; pass threshold >= 4.
