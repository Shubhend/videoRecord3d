import { useRef, useState, useEffect, useCallback } from 'react';
import { MindARThree } from 'mindar-face-three';

export default function useFaceTracking({
  containerRef,
  scene,
  camera,
  renderer,
  anchorRoot,
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
    if (!scene || !camera || !renderer) {
      throw new Error('useFaceTracking: scene, camera, and renderer must be initialized (call useThreeScene.start() first)');
    }
    if (mindARRef.current) return;

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
      renderer,
      scene,
      camera,
    });

    mindARRef.current = mindarThree;
    setMindAR(mindarThree);

    await mindarThree.start();

    const anchor = mindarThree.addAnchor(0);
    anchorRef.current = anchor;

    if (anchorRoot && anchor.group) {
      if (anchorRoot.parent) {
        anchorRoot.parent.remove(anchorRoot);
      }
      anchor.group.add(anchorRoot);
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
  }, [containerRef, scene, camera, renderer, anchorRoot]);

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
