import { useRef, useState, useEffect, useCallback } from 'react';
import * as THREE from 'three';

export default function useThreeScene({ containerRef, onBeforeRender } = {}) {
  const canvasRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const anchorRootRef = useRef(null);
  const rafRef = useRef(null);
  const resizeRef = useRef(null);
  const clockRef = useRef(null);
  const onBeforeRenderRef = useRef(onBeforeRender);

  const [started, setStarted] = useState(false);

  useEffect(() => {
    onBeforeRenderRef.current = onBeforeRender;
  }, [onBeforeRender]);

  const start = useCallback(() => {
    if (!canvasRef.current) {
      throw new Error('useThreeScene: canvasRef not attached to a <canvas> element');
    }

    if (!rendererRef.current) {
      const renderer = new THREE.WebGLRenderer({
        canvas: canvasRef.current,
        alpha: true,
        antialias: true,
        preserveDrawingBuffer: true,
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      rendererRef.current = renderer;

      const scene = new THREE.Scene();
      sceneRef.current = scene;

      const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
      cameraRef.current = camera;

      const anchorRoot = new THREE.Group();
      scene.add(anchorRoot);
      anchorRootRef.current = anchorRoot;

      clockRef.current = new THREE.Clock();
    }

    if (containerRef?.current && !resizeRef.current) {
      const ro = new ResizeObserver(() => {
        const container = containerRef.current;
        if (!container || !rendererRef.current || !cameraRef.current) return;
        const w = container.clientWidth;
        const h = container.clientHeight;
        if (w <= 0 || h <= 0) return;
        rendererRef.current.setSize(w, h, false);
        cameraRef.current.aspect = w / h;
        cameraRef.current.updateProjectionMatrix();
      });
      ro.observe(containerRef.current);
      resizeRef.current = ro;

      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      if (w > 0 && h > 0 && rendererRef.current && cameraRef.current) {
        rendererRef.current.setSize(w, h, false);
        cameraRef.current.aspect = w / h;
        cameraRef.current.updateProjectionMatrix();
      }
    }

    if (!rafRef.current) {
      const tick = () => {
        const clock = clockRef.current;
        const scene = sceneRef.current;
        const camera = cameraRef.current;
        const renderer = rendererRef.current;
        if (!clock || !scene || !camera || !renderer) return;

        const delta = clock.getDelta();
        const cb = onBeforeRenderRef.current;
        if (cb) cb(delta, scene, camera);
        renderer.render(scene, camera);

        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    }

    setStarted(true);
  }, [containerRef]);

  const stop = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (resizeRef.current) {
      resizeRef.current.disconnect();
      resizeRef.current = null;
    }
    setStarted(false);
  }, []);

  useEffect(() => {
    return () => {
      stop();
      const renderer = rendererRef.current;
      if (renderer) {
        const scene = sceneRef.current;
        if (scene) {
          scene.traverse((obj) => {
            if (obj.isMesh) {
              obj.geometry?.dispose?.();
              const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
              for (const m of mats) m?.dispose?.();
            }
          });
        }
        renderer.dispose();
        renderer.forceContextLoss?.();
        rendererRef.current = null;
        sceneRef.current = null;
        cameraRef.current = null;
        anchorRootRef.current = null;
        clockRef.current = null;
      }
    };
  }, [stop]);

  return {
    canvasRef,
    scene: sceneRef.current,
    camera: cameraRef.current,
    renderer: rendererRef.current,
    anchorRoot: anchorRootRef.current,
    started,
    start,
    stop,
  };
}
