import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

export function disposeObject3D(root) {
  if (!root) return;
  root.traverse((obj) => {
    if (obj.isMesh) {
      obj.geometry?.dispose?.();
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) {
        m?.dispose?.();
      }
    }
  });
}

export async function loadModelFromSource(source, { signal } = {}) {
  if (!source) throw new Error('loadModelFromSource: source is required');

  let url;
  let shouldRevoke = false;

  if (source.type === 'blob' && source.value instanceof Blob) {
    url = URL.createObjectURL(source.value);
    shouldRevoke = true;
  } else if (source.type === 'url' && typeof source.value === 'string') {
    url = source.value;
  } else if (typeof source === 'string') {
    url = source;
  } else {
    throw new Error('loadModelFromSource: unsupported source format');
  }

  const name = source.name || '';
  const isVrmByName = /\.vrm$/i.test(name);

  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));

  let gltf;
  try {
    gltf = await loader.loadAsync(url, (onProgress) => {
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
    });
  } catch (err) {
    const msg = (err && err.message) ? String(err.message) : String(err || '');
    if (/unexpected token\s*[<']/i.test(msg) || /doctype/i.test(msg) || /html/i.test(msg)) {
      throw new Error(
        'Model file could not be loaded (the server returned an HTML page instead of a .vrm/.glb file). ' +
        'Make sure the file exists at the expected path or upload it via the Models page.'
      );
    }
    if (/not found|404/i.test(msg)) {
      throw new Error(`Model file not found: ${name || url}. Check the path or upload a new model.`);
    }
    throw err;
  } finally {
    if (shouldRevoke) {
      try { URL.revokeObjectURL(url); } catch {}
    }
  }

  signal?.throwIfAborted();

  const vrm = gltf.userData?.vrm ?? null;
  const hasVrmExtension = !!gltf.userData?.gltfExtensions?.VRM;
  const isVrm = hasVrmExtension || isVrmByName || !!vrm;

  let modelRoot;
  if (isVrm && vrm) {
    VRMUtils.removeUnnecessaryJoints(vrm.scene);
    try {
      VRMUtils.rotateVRM0(vrm);
    } catch {
      /* optional — only needed for VRM 0.x */
    }
    modelRoot = vrm.scene;
  } else {
    modelRoot = gltf.scene;
  }

  modelRoot.traverse((obj) => {
    if (obj.isMesh) {
      obj.frustumCulled = false;
    }
  });

  return {
    modelRoot,
    vrm: isVrm ? vrm : null,
    isVrm,
  };
}
