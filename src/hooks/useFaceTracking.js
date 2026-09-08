import { useRef, useState, useEffect, useCallback } from 'react';
import { MindARThree } from 'mindar-face-three';

export default function useFaceTracking({
  containerRef,
  scene,
  sceneRef,
  camera,
  cameraRef,
  renderer,
  rendererRef,
  anchorRoot,
  anchorRootRef,
  onFaceDetected,
  onFaceLost,
}) {
  const mindARRef = useRef(null);
  const anchorRef = useRef(null);
  const foundHandlerRef = useRef(null);
  const lostHandlerRef = useRef(null);
  const onFaceDetectedRef = useRef(onFaceDetected);
  const onFaceLostRef = useRef(onFaceLost);

  const [started, setStarted] = useState(false);
  const [faceDetected, setFaceDetected] = useState(false);
  const [mindAR, setMindAR] = useState(null);

  useEffect(() => {
    onFaceDetectedRef.current = onFaceDetected;
  }, [onFaceDetected]);
  useEffect(() => {
    onFaceLostRef.current = onFaceLost;
  }, [onFaceLost]);

  const start = useCallback(async () => {
    if (!containerRef?.current) {
      throw new Error('useFaceTracking: containerRef is not attached to a DOM element');
    }
    if (mindARRef.current) return;

    // Build MindAR without injecting renderer/scene/camera — let it create its own.
    // Then we patch its created renderer references into our shared refs so consumers
    // (App placement, recording, visibility) read the correct canvas from MindAR.
    const mindarThree = new MindARThree({
      container: containerRef.current,
      imageTarget: null,
      faceDetect: true,
      maxTrack: 1,
      uiLoading: 'no',
      uiError: 'no',
      uiScanning: 'no',
      filterMinCF: 0.9,
      filterBeta: 500,
      // NOTE: do NOT pass renderer/scene/camera here. MindAR creates them internally and
      // inserts them in correct sibling order below its <video> preview layer.
    });

    mindARRef.current = mindarThree;
    setMindAR(mindarThree);

    await mindarThree.start();

    // Patch shared refs to use MindAR's renderer/scene/camera so App wiring picks them up.
    if (rendererRef && mindarThree.renderer) {
      rendererRef.current = mindarThree.renderer;
    }
    if (sceneRef && mindarThree.scene) {
      // Merge our anchorRoot into MindAR's scene if it has been created separately:
      if (sceneRef.current !== mindarThree.scene) {
        const anchor = anchorRootRef?.current ?? anchorRoot;
        if (anchor && anchor.parent) {
          try { anchor.parent.remove(anchor); } catch {}
        }
        if (anchor && !mindarThree.scene.children.includes(anchor)) {
          mindarThree.scene.add(anchor);
        }
        sceneRef.current = mindarThree.scene;
      }
    }
    if (cameraRef && mindarThree.camera) {
      cameraRef.current = mindarThree.camera;
    }

    const anchor = mindarThree.addAnchor(0);
    anchorRef.current = anchor;

    const anchorInst = anchorRootRef?.current ?? anchorRoot;
    if (anchorInst && anchor.group) {
      if (anchorInst.parent) {
        try { anchorInst.parent.remove(anchorInst); } catch {}
      }
      anchor.group.add(anchorInst);
    }

    const handleFound = () => {
      setFaceDetected(true);
      const cb = onFaceDetectedRef.current;
      if (cb) cb();
    };
    const handleLost = () => {
      setFaceDetected(false);
      const cb = onFaceLostRef.current;
      if (cb) cb();
    };

    anchor.on?.('found', handleFound);
    anchor.on?.('lost', handleLost);

    foundHandlerRef.current = handleFound;
    lostHandlerRef.current = handleLost;

    setStarted(true);
  }, [containerRef, scene, sceneRef, camera, cameraRef, renderer, rendererRef, anchorRoot, anchorRootRef]);

  const stop = useCallback(() => {
    const anchor = anchorRef.current;
    if (anchor && foundHandlerRef.current) {
      anchor.off?.('found', foundHandlerRef.current);
    }
    if (anchor && lostHandlerRef.current) {
      anchor.off?.('lost', lostHandlerRef.current);
    }
    foundHandlerRef.current = null;
    lostHandlerRef.current = null;

    const mindarThree = mindARRef.current;
    if (mindarThree) {
      try {
        mindarThree.stop();
      } catch {
        /* ignore stop errors */
      }
      mindARRef.current = null;
      setMindAR(null);
    }
    anchorRef.current = null;
    setFaceDetected(false);
    setStarted(false);
  }, []);

  useEffect(() => {
    return () => {
      stop();
    };
  }, [stop]);

  return {
    started,
    faceDetected,
    mindAR,
    start,
    stop,
  };
}
