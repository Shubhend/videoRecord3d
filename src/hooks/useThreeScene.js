import { useRef, useState, useEffect, useCallback } from 'react';
import * as THREE from 'three';

export default function useThreeScene({ containerRef, onBeforeRender } = {}) {
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const anchorRootRef = useRef(null);
  const rafRef = useRef(null);
  const clockRef = useRef(null);
  const onBeforeRenderRef = useRef(onBeforeRender);
  const attachedToExternalRendererRef = useRef(false);
  const ownCanvasRef = useRef(null);

  const [started, setStarted] = useState(false);

  useEffect(() => {
    onBeforeRenderRef.current = onBeforeRender;
  }, [onBeforeRender]);

  function ensureSceneGraph() {
    if (!sceneRef.current) sceneRef.current = new THREE.Scene();
    if (!cameraRef.current) {
      const c = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
      cameraRef.current = c;
    }
    if (!anchorRootRef.current) {
      const g = new THREE.Group();
      sceneRef.current.add(g);
      anchorRootRef.current = g;
    }
    if (!clockRef.current) clockRef.current = new THREE.Clock();
  }

  const start = useCallback((options = {}) => {
    ensureSceneGraph();

    // Transition: disposing previously-owned renderer if we are now attaching external one.
    if (options.renderer && options.attachOnly !== false) {
      if (rendererRef.current && !attachedToExternalRendererRef.current && rendererRef.current !== options.renderer) {
        const oldR = rendererRef.current;
        try {
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
          oldR.dispose?.();
          oldR.forceContextLoss?.();
        } catch {}
        if (ownCanvasRef.current && ownCanvasRef.current.parentNode) {
          try { ownCanvasRef.current.parentNode.removeChild(ownCanvasRef.current); } catch {}
        }
        ownCanvasRef.current = null;
      }
      rendererRef.current = options.renderer;
      attachedToExternalRendererRef.current = true;
    } else if (!rendererRef.current) {
      if (!ownCanvasRef.current) {
        throw new Error('useThreeScene: canvasRef has no DOM canvas attached');
      }
      const r = new THREE.WebGLRenderer({
        canvas: ownCanvasRef.current,
        alpha: true,
        antialias: true,
        preserveDrawingBuffer: true,
      });
      r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      rendererRef.current = r;
      attachedToExternalRendererRef.current = false;

      if (containerRef?.current) {
        const w = containerRef.current.clientWidth;
        const h = containerRef.current.clientHeight;
        if (w > 0 && h > 0) {
          r.setSize(w, h, false);
          cameraRef.current.aspect = w / h;
          cameraRef.current.updateProjectionMatrix();
        }
      }
    } else if (options.renderer === undefined && !attachedToExternalRendererRef.current) {
      // Re-owning case: if caller calls start() again without renderer, re-use existing renderer.
    }

    // ResizeObserver only when owning the renderer + container available.
    if (!options.renderer && containerRef?.current) {
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
      (start.resizeCleanup || (start.resizeCleanup = new Set())).add(() => ro.disconnect());
    }

    if (!rafRef.current) {
      const tick = () => {
        const clock = clockRef.current;
        const scene = sceneRef.current;
        const cam = cameraRef.current;
        const r = rendererRef.current;
        if (!clock || !scene || !cam || !r) {
          rafRef.current = requestAnimationFrame(tick);
          return;
        }
        const delta = clock.getDelta();
        const cb = onBeforeRenderRef.current;
        if (cb) cb(delta, scene, cam);
        if (!attachedToExternalRendererRef.current) {
          r.render(scene, cam);
        }
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
    const fns = start.resizeCleanup;
    if (fns) { for (const fn of Array.from(fns)) try { fn(); } catch {} fns.clear(); }
    setStarted(false);
  }, [start]);

  useEffect(() => {
    return () => {
      stop();
      const r = rendererRef.current;
      if (r && !attachedToExternalRendererRef.current) {
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
        r.dispose();
        r.forceContextLoss?.();
      }
      rendererRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
      anchorRootRef.current = null;
      clockRef.current = null;
      attachedToExternalRendererRef.current = false;
    };
  }, [stop]);

  return {
    canvasRef: new Proxy(
      { current: null },
      {
        get(t, p) {
          if (p === 'current') {
            if (rendererRef.current) return rendererRef.current.domElement || ownCanvasRef.current;
            return ownCanvasRef.current;
          }
          if (p === 'setCurrent') return (el) => { ownCanvasRef.current = el; };
          return undefined;
        },
        set(t, p, v) {
          if (p === 'current') { ownCanvasRef.current = v; return true; }
          return false;
        },
      }
    ),
    get scene() { return sceneRef.current; },
    get camera() { return cameraRef.current; },
    get renderer() { return rendererRef.current; },
    get anchorRoot() { return anchorRootRef.current; },
    sceneRef,
    cameraRef,
    rendererRef,
    anchorRootRef,
    ensureSceneGraph,
    started,
    start,
    stop,
  };
}
