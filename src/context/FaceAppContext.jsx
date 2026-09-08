import React, { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react';
import { DEFAULT_PLACEMENT, DEFAULT_BODY_PARTS } from '../lib/sharedDefaults.js';
import { load as loadBackground, DEFAULT_CONFIG } from '../lib/backgroundStore.js';

const FaceAppContext = createContext(null);

export function FaceAppProvider({ children }) {
  const [tracking, setTracking] = useState({ started: false, faceDetected: false });
  const [placement, setPlacement] = useState({ ...DEFAULT_PLACEMENT });
  const [bodyParts, setBodyParts] = useState({ ...DEFAULT_BODY_PARTS });
  const [model, setModelState] = useState({
    id: null,
    name: null,
    loaded: false,
    loading: false,
    modelRoot: null,
    vrm: null,
  });
  const [classified, setClassified] = useState({
    headMeshes: null,
    hairMeshes: null,
    bodyMeshes: null,
    armsMeshes: null,
    legsMeshes: null,
  });
  const [activePreset, setActivePreset] = useState({ id: null, name: null });
  const [recording, setRecordingState] = useState({ state: 'idle', durationMs: 0 });
  const [background, setBackgroundState] = useState(() => ({
    controller: null,
    ...loadBackground(),
    ...DEFAULT_CONFIG,
    ...loadBackground(),
  }));
  const [audio, setAudioState] = useState({
    loaded: false,
    fileName: null,
    playing: false,
    duration: 0,
    currentTime: 0,
    syncEnabled: true,
    engine: null,
  });
  const [toast, setToast] = useState({ message: null, tone: 'info' });

  const trackingApiRef = useRef(null);
  const recorderApiRef = useRef(null);
  const actionsRef = useRef(null);
  const toastTimerRef = useRef(null);

  const setModel = useCallback((partial) => {
    setModelState((prev) => ({ ...prev, ...partial }));
  }, []);

  const setRecording = useCallback((partial) => {
    setRecordingState((prev) => ({ ...prev, ...partial }));
  }, []);

  const setBackground = useCallback((cfg) => {
    setBackgroundState((prev) => {
      const next = { ...prev, ...cfg };
      if (prev.controller && typeof prev.controller.setConfig === 'function') {
        const { controller: _c, ...rest } = next;
        prev.controller.setConfig(rest);
      }
      return next;
    });
  }, []);

  const setAudio = useCallback((partial) => {
    setAudioState((prev) => ({ ...prev, ...partial }));
  }, []);

  const showToast = useCallback((msg, tone = 'info') => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message: msg, tone });
    toastTimerRef.current = setTimeout(() => {
      setToast({ message: null, tone: 'info' });
    }, 3500);
  }, []);

  const hideToast = useCallback(() => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message: null, tone: 'info' });
  }, []);

  const setTrackingApi = useCallback((api) => {
    trackingApiRef.current = api;
  }, []);

  const setRecorderApi = useCallback((api) => {
    recorderApiRef.current = api;
  }, []);

  const setActions = useCallback((a) => {
    actionsRef.current = a;
  }, []);

  const setBackgroundController = useCallback((ctrl) => {
    setBackgroundState((prev) => ({ ...prev, controller: ctrl }));
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const value = {
    tracking,
    setTracking,
    placement,
    setPlacement,
    bodyParts,
    setBodyParts,
    model,
    setModel,
    classified,
    setClassified,
    activePreset,
    setActivePreset,
    recording,
    setRecording,
    background,
    setBackground,
    setBackgroundController,
    audio,
    setAudio,
    toast,
    showToast,
    hideToast,
    trackingApi: trackingApiRef,
    setTrackingApi,
    recorderApi: recorderApiRef,
    setRecorderApi,
    actions: actionsRef,
    setActions,
  };

  return React.createElement(FaceAppContext.Provider, { value }, children);
}

export function useFaceApp() {
  const ctx = useContext(FaceAppContext);
  if (!ctx) {
    throw new Error('useFaceApp must be used within <FaceAppProvider>');
  }
  return ctx;
}
