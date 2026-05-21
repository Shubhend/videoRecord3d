// ==================== VRM LOADER ====================
// Loads and configures VRM avatars from a URL or a Blob (uploaded file).

import { Config } from './config.js';
import { resolveAssetUrl } from './assetUrl.js';

export class VRMLoader {
  constructor(scene, onProgress) {
    this.scene = scene;
    this.onProgress = onProgress;
    this.vrm = null;
    this._objectUrl = null;
  }

  /**
   * Load a VRM model.
   * @param {string|Blob|File|{type:'url'|'blob', value:string|Blob, name?:string}} source
   *   Accepts: URL string, Blob/File, or a source descriptor.
   */
  async load(source = Config.vrmUrl) {
    const { url, cleanup } = this._resolveSource(source);

    const loader = new THREE.GLTFLoader();
    loader.crossOrigin = 'anonymous';

    return new Promise((resolve, reject) => {
      loader.load(
        url,
        async (gltf) => {
          try {
            const vrm = await THREE_VRM.VRM.from(gltf);
            this.scene.add(vrm.scene);

            // Face camera
            vrm.scene.rotation.y = Math.PI;

            // Placement applied from settings after load (see avatarPlacement.js)
            vrm.scene.position.set(0, 0, 0);

            // Enable shadows and Fix Materials (Polyfill)
            vrm.scene.traverse((obj) => {
              if (obj.isMesh) {
                obj.castShadow = true;
                obj.receiveShadow = true;

                // Fix for Three.js r128+ shader compatibility
                if (obj.material) {
                  const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
                  materials.forEach((mat) => {
                    if (
                      mat.isShaderMaterial &&
                      mat.fragmentShader &&
                      !mat.fragmentShader.includes('punctualLightIntensityToIrradianceFactor')
                    ) {
                      mat.fragmentShader =
                        `
float punctualLightIntensityToIrradianceFactor( const in float lightDistance, const in float cutoffDistance, const in float decayExponent ) {
    return 1.0;
}
` + mat.fragmentShader;
                    }
                  });
                }
              }
            });

            this.vrm = vrm;
            cleanup?.();
            resolve(vrm);
          } catch (e) {
            cleanup?.();
            reject(e);
          }
        },
        (progress) => {
          if (this.onProgress && progress.total > 0) {
            const percent = Math.round((progress.loaded / progress.total) * 100);
            this.onProgress(`Loading avatar... ${percent}%`);
          }
        },
        (err) => {
          cleanup?.();
          reject(err);
        }
      );
    });
  }

  /**
   * Remove the loaded VRM from the scene and dispose its GPU resources.
   */
  dispose() {
    if (!this.vrm) return;
    const root = this.vrm.scene;
    if (root) {
      this.scene.remove(root);
      root.traverse((obj) => {
        if (obj.isMesh) {
          obj.geometry?.dispose?.();
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          mats.forEach((m) => m?.dispose?.());
        }
      });
    }
    this.vrm = null;
    if (this._objectUrl) {
      URL.revokeObjectURL(this._objectUrl);
      this._objectUrl = null;
    }
  }

  _resolveSource(source) {
    if (source && typeof source === 'object') {
      if (source instanceof Blob) {
        const url = URL.createObjectURL(source);
        this._objectUrl = url;
        return { url, cleanup: () => {} };
      }
      if (source.type === 'blob' && source.value instanceof Blob) {
        const url = URL.createObjectURL(source.value);
        this._objectUrl = url;
        return { url, cleanup: () => {} };
      }
      if (source.type === 'url' && typeof source.value === 'string') {
        return { url: resolveAssetUrl(source.value), cleanup: null };
      }
    }
    if (typeof source === 'string' && source.length > 0) {
      return { url: resolveAssetUrl(source), cleanup: null };
    }
    return { url: resolveAssetUrl(Config.vrmUrl), cleanup: null };
  }
}
