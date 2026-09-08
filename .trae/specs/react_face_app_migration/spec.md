# Edge AI Face-Follow — React Migration PRD

## Overview
- **Summary**: Migrate the legacy multi-page vanilla JS / CDN-script app to a single-page React 18 + Vite application in a proper `src/` folder structure. Eliminate the fragile CDN `<script>`-based MediaPipe loading (root cause of the `_emval_new_array` WebAssembly LinkError) by installing MediaPipe Holistic and related packages via npm, so the WASM binary and its JS glue are guaranteed to be the same build and properly bundled by Vite.
- **Purpose**: Fix the unrecoverable MediaPipe WASM linking error, deliver a standard modern React codebase that future contributors can extend, and preserve all existing face-follow functionality end-to-end.
- **Target Users**: Avatar creators / live streamers who use the face-follow page for webcam-driven 3D avatars with recording.

## Goals
- [G-1] The face-follow view loads without any WebAssembly `LinkError` or MediaPipe runtime `abort()` on the first user action.
- [G-2] Face tracking, VRM/GLB model rendering, placement tuning, body-part visibility, presets, backgrounds, audio lip-sync, and MP4 recording all work at feature parity with the legacy `face-follow.html`.
- [G-3] Codebase uses a conventional React structure (`src/components`, `src/hooks`, `src/lib`, etc.) instead of a flat `js/` folder with imperative DOM wiring.
- [G-4] Models (built-in + uploaded), settings, placement presets, and backgrounds persist across reloads via the same IndexedDB / localStorage keys used by the legacy app so existing user data is not lost.

## Non-Goals
- Redesign or restyle the UI beyond "minimal and functional React equivalents" of the legacy panels (no new visual design system).
- Port the full-body `index.html` (MediaPipe Holistic pose + hands page), `record.html` (Jeeliz webcam recorder), `models.html`, `cameras.html`, or `settings.html` as full pages — they can remain accessible as static links or be dropped from the entry list for now; the React app focuses on the **face-follow** surface the user called out.
- Add novel features not present in the current face-follow page (e.g., cloud storage, multi-user, RTMP streaming).
- Convert `three-vrm@0.x` UMD-based loading used on the full-body page; the React face-follow view keeps using the npm `@pixiv/three-vrm@^2` + VRM 1.0 path already in use by MindAR on `face-follow.html`.

## Background & Context
- The user reported `RuntimeError: abort(LinkError: WebAssembly.instantiate(): Import #0 "env" "_emval_new_array": function import requires a callable)` from the production bundle `app.B74NRNSN.js`.
- Previous attempt pinned CDN script versions for `@mediapipe/holistic` and `@mediapipe/camera_utils`; user reports the error persists. Root cause is that CDN-delivered UMD scripts from different publishers/CDNs can still have mismatched Emscripten module glue at the global scope, or CDN caches serve a stale `.wasm` against a fresh `.js`, or the browser runs them out of order on cold loads.
- The only robust fix is to **ship MediaPipe via npm + Vite bundling** so the glue code, WASM, and imports are resolved to one exact build at install time, and WASM is served from the same Vite asset pipeline as the JS.
- Legacy codebase has MediaPipe Holistic on `index.html`/`record.html` (CDN scripts) and MindAR face tracking on `face-follow.html` (npm `mind-ar` via import map). For the React migration we standardize on **MindAR (already npm-installed, proven to work for face tracking in this project)** for the face tracking engine because it does not have the same Emscripten/WASM dependency pattern; MediaPipe Holistic is NOT reintroduced in the React app unless explicitly needed later. If MindAR is acceptable for face tracking, it eliminates the entire WASM failure class.

## Functional Requirements

### Core tracking + rendering
- **FR-1**: Face tracking engine (MindAR via npm `mind-ar`) initializes on user click ("Start face mesh tracking"), provides per-frame face mesh landmarks, and exposes a start/stop control.
- **FR-2**: Three.js scene is rendered inside a React-created `<canvas>` within the live-view container; MindAR's AR session attaches to the existing DOM container (not a manually-created one).
- **FR-3**: User can select a 3D model from a dropdown containing built-in models plus user-uploaded models, and load it onto the face anchor. Supported formats: `.vrm` (VRM 1.0 via `@pixiv/three-vrm@^2`) and `.glb` (via `GLTFLoader`).
- **FR-4**: Placement tuning: numeric inputs for position (X/Y/Z), rotation (X/Y/Z in degrees), and scale; plus an "Auto-fit to face" action and a "Reset placement" action.
- **FR-5**: Body part visibility toggles: head, hair, torso/outfit, arms/hands, legs/feet, and a "Head only" preset toggle.
- **FR-6**: Placement presets CRUD: list, save (with prompt for name), delete, auto-apply last-used preset on load. A preset stores placement, body parts, and the model ID it was saved against.

### Backgrounds
- **FR-7**: Background mode selector with 5 modes: Live camera, Camera blur, Solid color, Image, Screen share.
- **FR-8**: Camera blur pixel slider; color picker; image file upload + clear; screen share start/stop with display media picker.
- **FR-9**: Screen share layout applies the legacy "camera PiP bottom-right + avatar PiP bottom-right on top of camera" behaviour.

### Audio lip-sync
- **FR-10**: Audio file upload (`.mp3/.wav/.ogg/.m4a`) and Play/Pause controls.
- **FR-11**: A toggle to sync mouth shapes (visemes: aa/ih/ou/ee/oh + open amount) to audio during playback, driven by the project's existing phoneme timeline code.
- **FR-12**: Intensity/gain settings from the shared settings store are applied to viseme output.

### Recording
- **FR-13**: MP4 recording start/pause/resume/stop-and-save, compositing background + camera (if shown) + 3D canvas into a single stream via `canvas.captureStream` + `MediaRecorder`.
- **FR-14**: Option to include the currently loaded audio track in the recording stream (audio muxed alongside video). Stop yields an MP4 blob downloaded via `<a download>` using the existing MP4 conversion helper.
- **FR-15**: Recording shows on-screen state (timer or duration) and disables UI that would break capture while active.

### Persistence + compatibility
- **FR-16**: Reads/writes the following legacy storage keys so user state migrates cleanly:
  - `localStorage.edge_ai_settings_v1` (app settings / sensitivities)
  - `localStorage.faceFollowSelectedModelId` (last chosen model)
  - `localStorage.faceFollowLastPresetId` (last chosen preset)
  - `localStorage.faceFollowBackground_v1` (background mode config)
- **FR-17**: IndexedDB `edge_ai_models` database, stores `models` (blobs for uploaded VRM/GLB + metadata) and `placementPresets` — schema and key names identical to legacy stores.

### App shell
- **FR-18**: Top nav bar with a brand label and links to Settings (opens React Settings panel inline) and legacy pages (`/models.html`, `/record.html`, `/settings.html` as static fallbacks if not yet ported).
- **FR-19**: Side panel / control panel containing all the controls grouped into logical collapsible sections (Tuning, Body, Background, Audio, Record) matching the legacy layout order.
- **FR-20**: Status HUD below the start button showing current tracking state (face mesh detected or not, preset active, recording state).

## Non-Functional Requirements
- **NFR-1**: Zero `<script src="...cdn.jsdelivr.net/npm/@mediapipe/...">` or similar MediaPipe CDN tags in the app. MediaPipe / face-tracking assets (if any MediaPipe code remains) must be npm-installed and bundled.
- **NFR-2**: `npm install && npm run build` completes with exit code 0 on Node ≥ 18; `npm run dev` starts Vite with no import errors.
- **NFR-3**: The face tracking pipeline (including Three.js scene + VRM morph targets) must sustain ≥ 20 fps on a mid-range laptop GPU at 640×480 camera input — a rubric, not a hard requirement in the first build, but nothing should block the main thread on a single frame for > 50 ms.
- **NFR-4**: The codebase must pass `npm run build` with no unresolved bare imports; WASM files referenced by MediaPipe/MindAR npm packages must be correctly served as Vite assets (configure `vite.config.js` assetsInclude, publicDir fallback, or explicit chunk copies if needed — but NOT `public/` raw bare imports).
- **NFR-5**: All persistence writes go through typed wrapper modules (`src/lib/modelStore.js`, `src/lib/settingsStore.js`, `src/lib/presetStore.js`, `src/lib/backgroundStore.js`) — React components do not touch IndexedDB or localStorage directly.

## Constraints
- **Technical**:
  - React 18 functional components + hooks only; no class components.
  - Vite `^6` as the bundler/dev server (current pinned version).
  - `three@0.160.0` exact (per existing override for MindAR + three-vrm compatibility).
  - `@pixiv/three-vrm@^2.1.x` (current face-follow import map target).
  - `mind-ar@^1.2.5` (already installed; preferred face tracking engine to avoid MediaPipe WASM entirely).
  - No React UI frameworks (MUI, Ant, shadcn, Tailwind). Minimal native CSS to keep changes small and reviewable; inline styles or plain CSS modules are acceptable.
  - No new npm packages without explicit justification in the task item; prefer built-in browser APIs and existing deps.
- **Business**:
  - Existing user IndexedDB model blobs and localStorage state must not be lost. Keys must remain identical.
  - The legacy pages may still exist on disk but the React app becomes the primary entry (`index.html` points to the React app, or a new entry is used with clear user path).

## Dependencies
- Existing npm deps: `three@0.160.0`, `@pixiv/three-vrm@^2.1.3`, `mind-ar@^1.2.5`, `vite@^6.3.5`, `terser@^5`.
- New deps required for React migration: `react@^18`, `react-dom@^18`, plus `@vitejs/plugin-react` (latest compatible with Vite 6).
- Optional: no state management library; React context + hooks is sufficient for this scale.

## Assumptions
- MindAR-based face tracking is acceptable as the only tracking engine in the React app (the user specifically said "focus on [face-follow] features" and the current `face-follow.html` already runs on MindAR, not MediaPipe Holistic). This directly eliminates the `_emval_new_array` WASM error class because MindAR has a different runtime than MediaPipe Holistic's Emscripten-compiled binaries.
- If the user later wants full MediaPipe Holistic (body+hands) in React, that will be a separate follow-up task using the same npm-based approach — out of scope here.
- Existing `public/models/` built-in VRM/GLB files remain in `public/` and are served by Vite's publicDir copy as today.
- `record.html` (the Jeeliz-based webcam record page, separate from face-follow recording) is not required in the React MVP; its link can remain a static fallback.

## Open Questions
- [ ] Q1: Should the React app become the new `/index.html` (replacing the current full-body MediaPipe page), or live on a new route (e.g. `/app.html` or `/` only), leaving current `index.html` untouched? **Assumption answered below in AC-1**: We make the React app the new `index.html` entry but keep the old full-body page accessible via `legacy-index.html` copy so the link is preserved.
- [ ] Q2: Is MindAR-based face tracking acceptable, or must we also wire MediaPipe Holistic via npm in the React MVP? **Assumption answered**: MindAR only for the MVP to fix the WASM crash; MediaPipe npm install as a separate opt-in future work.
- [ ] Q3: Does the "record.html" (Jeeliz) page need to continue being built into `dist/`? **Assumption**: Keep it in the Vite inputs, unchanged, so the link works if the user navigates to it.

## Acceptance Criteria

### AC-1: React app structure & build
- **Type**: `rule`
- **Given**: A clean checkout with Node 18+ and the project's `.npmrc` (legacy-peer-deps).
- **When**: Running `npm install && npm run build`.
- **Then**: Vite successfully produces a `dist/` folder that contains the React app entry (HTML loading `src/main.jsx`), no Vite "failed to resolve import" errors, no "bare import in public/" warnings, and the generated JS bundle does not reference any `cdn.jsdelivr.net/npm/@mediapipe` URLs as script sources.
- **Pass Condition**: `npm run build` exit code is 0; `Select-String` of `dist/**/*.html` for `@mediapipe` returns zero matches.
- **Evidence**: Build output capture + grep of generated HTML assets.

### AC-2: No WASM linking error on cold start
- **Type**: `rule`
- **Given**: A freshly opened browser tab (no Service Worker, no CDN cache warm), network tab set to "Disable cache", and the React app served from the built `dist/` (or dev server).
- **When**: User navigates to the app, clicks "Start face mesh tracking", and grants camera permission.
- **Then**: The console shows no `RuntimeError: abort(LinkError...)`, no `_emval_new_array`, no MediaPipe `ASSERTIONS` abort, and tracking status transitions to "Face mesh: active" (or equivalent) within 10 seconds.
- **Pass Condition**: Three consecutive cold-run attempts produce zero such errors and tracking status is green.
- **Evidence**: Browser console log capture (screenshots or HAR) showing clean startup; MindAR or tracking engine initialized message.

### AC-3: Model list + load works with persistence
- **Type**: `rule`
- **Given**: IndexedDB `edge_ai_models.models` contains ≥ 1 user-uploaded model blob (from prior legacy use).
- **When**: The React app mounts and the user opens the model dropdown.
- **Then**: All built-in models (Alicia VRM + default GLB) appear first with "(built-in)" suffix; uploaded models appear second with "(uploaded)"; the previously-selected model ID (stored in `localStorage.faceFollowSelectedModelId`) is selected by default; clicking "Load model on face" renders the mesh on the face anchor.
- **Pass Condition**: Dropdown contents match legacy `listModels()` output order and labels; selected model ID matches localStorage; Three.js scene contains the loaded mesh after the Load button completes.
- **Evidence**: UI screenshot of populated dropdown; React DevTools or scene inspector showing the model root in the Three.js graph; log of `localStorage.faceFollowSelectedModelId` value pre- and post-load.

### AC-4: Placement tuning + body part toggles live-update the avatar
- **Type**: `rule`
- **Given**: A model is loaded and visible on the face anchor.
- **When**: User edits Pos X/Y/Z, Rot X/Y/Z, or Scale; or toggles any body-part visibility checkbox; or clicks "Head only"; or clicks "Auto-fit to face"; or clicks "Reset placement".
- **Then**: The avatar's position / rotation / scale / visibility updates in the Three.js view within 1 frame; "Reset placement" returns to `DEFAULT_PLACEMENT` and `DEFAULT_BODY_PARTS` values exactly as defined in `faceFollowMindarShared.js`.
- **Pass Condition**: All numeric inputs accept values in their stated ranges (e.g. -20..20, step 0.001 for position); checkbox toggles produce visible mesh show/hide on corresponding VRM nodes; Reset restores default values in inputs.
- **Evidence**: Side-by-side screenshots of placement changes; console log of placement object before/after Reset confirming exact default match.

### AC-5: Placement presets CRUD round-trips
- **Type**: `rule`
- **Given**: Avatar has non-default placement and body-part settings, and a model is selected.
- **When**: User clicks "Save current as preset…", enters a name, confirms; then navigates to a new preset in the dropdown; then deletes a preset.
- **Then**: Saved preset appears in dropdown; selecting a preset applies its stored placement + body parts + switches model if the preset stores a different modelId; deleting a preset removes it from the dropdown and IndexedDB; last used preset ID is saved to `localStorage.faceFollowLastPresetId`.
- **Pass Condition**: Full CRUD works with a fresh page reload between Save and Load to prove IndexedDB persistence.
- **Evidence**: Screenshot of saved preset in dropdown; before/after of preset application values; IndexedDB inspector view of `placementPresets` store.

### AC-6: Background modes apply correctly in view + recording
- **Type**: `rule`
- **Given**: Tracking is active and model is visible.
- **When**: User cycles through all 5 background modes, adjusts blur slider, picks a color, uploads an image, and starts screen share.
- **Then**: The visual live view matches the selected mode (camera visible / blurred / replaced by color-img-video as appropriate); recording a 5-second clip in each mode produces MP4 output whose frames show the same background treatment the user saw live.
- **Pass Condition**: All 5 modes render without breaking the canvas stream; screen share ends cleanly when user clicks Stop (or via browser stop-sharing UI); recorded MP4 playback visually matches live view for the mode.
- **Evidence**: Screenshots of each mode live; `ffprobe` or player thumbnails of the resulting MP4 files showing correct backgrounds.

### AC-7: Audio lip-sync with optional recording mux
- **Type**: `rule`
- **Given**: User has uploaded a supported audio file (e.g. 10s `.mp3`) and audio lip-sync is enabled.
- **When**: User clicks Play audio.
- **Then**: The VRM avatar's mouth morphs through visemes (aa/ih/ou/ee/oh + open amount) aligned with audio playback; clicking "Start + audio recording" records a video whose file size is noticeably larger than video-only and whose MP4 contains a playable audio track when opened in a media player.
- **Pass Condition**: Viseme timeline sampling at `t=2s` produces non-zero mouth-open viseme weight for speech-containing audio; recorded MP4 has an audio stream (verify via `ffprobe` or Properties → Audio codec in file explorer).
- **Evidence**: Viseme weight log at playback midpoint; file properties screenshot of MP4 showing audio track presence.

### AC-8: MP4 recording pipeline
- **Type**: `rule`
- **Given**: Tracking active and model rendered.
- **When**: Start → 5s record → Pause → 2s wait → Resume → 3s record → Stop & save.
- **Then**: The browser downloads a single `.mp4` file; the file duration is approximately 8s ± 0.5s; pause/resume leaves no 2s silent gap in the middle (MediaRecorder properly suspends during pause).
- **Pass Condition**: Downloaded file exists with `.mp4` extension, duration within tolerance, and plays in Chrome without Media decode error.
- **Evidence**: File explorer properties of the MP4 (size, duration); single-frame preview thumbnails at 0s, 4s, and 7s.

### AC-9: Storage key backward compatibility
- **Type**: `rule`
- **Given**: A browser profile that was previously populated by the legacy `face-follow.html` (with a model selected, preset saved, non-default background and settings).
- **When**: User opens the React app without clearing storage.
- **Then**: The React app reads the identical settings values, model selection, preset list, and background mode from the *same* localStorage keys and IndexedDB stores used by the legacy code; no new key names are introduced that would orphan the old state.
- **Pass Condition**: Enumerate the localStorage keys and IndexedDB store names/keyPaths used by the React wrappers and verify they match legacy `SETTINGS_KEY`/`FACE_MODEL_KEY`/`LAST_KEY`/`BG_KEY`/`DB_NAME`/store names exactly.
- **Evidence**: Tabular diff of legacy vs React storage keys — all identical; screenshot of DevTools Application tab showing old values re-read correctly.

### AC-10: React codebase structure quality
- **Type**: `rubric`
- **Dimension**: Conformance to common React project layout conventions and minimal-but-clean separation of concerns.
- **Scale**: 1-5
- **Anchors**:
  - 1 = everything dumped in `App.jsx`, components directly call IndexedDB APIs, no hooks extracted, massive files.
  - 3 = some split (`src/components` + `src/lib` exists) but files are large, multiple unrelated concerns share one hook, 50% of state manipulation is inline in components.
  - 5 = clear folders: `src/components/*` (one panel per component, < 250 lines typically), `src/hooks/*` (face tracking, three scene, recorder, presets all have dedicated reusable hooks), `src/lib/*` (typed stores for IndexedDB/localStorage, no React deps), `src/main.jsx` + `src/App.jsx` as thin entry/routing. Components do not touch IndexedDB directly.
- **Pass Threshold**: >= 4
- **Evidence**: Directory tree of `src/` (3 levels deep); representative line counts per file.

### AC-11: Runtime performance of the tracking loop
- **Type**: `rubric`
- **Dimension**: Frame-time stability on a mid-range laptop while tracking, rendering VRM, and recording.
- **Scale**: 1-5
- **Anchors**:
  - 1 = main thread jank > 200 ms per frame, frequent dropped frames, audio recording crackles.
  - 3 = occasional jank spikes to 80 ms but mostly 30–40 ms per frame; recording works with minor glitches.
  - 5 = consistently ≤ 50 ms per frame (≥ 20 fps subjective), recording produces smooth output without audio pops, no React re-renders caused by every Three.js frame (raf loop does not setState every frame with raw landmarks).
- **Pass Threshold**: >= 4
- **Evidence**: Chrome DevTools Performance panel trace of a 30s tracking+recording session; screenshots of frame-time distribution.
