// Apply / restore VRM mesh surface tint (Standard, MToon, and common shader uniforms).

const _tint = new THREE.Color();

function captureOrig(mat) {
  if (mat.userData._surfaceOrig) return;
  const orig = {};
  if (mat.color?.isColor) orig.color = mat.color.clone();
  if (mat.shadeColor?.isColor) orig.shadeColor = mat.shadeColor.clone();
  if (mat.emissive?.isColor) orig.emissive = mat.emissive.clone();
  if (mat.uniforms?.litColor?.value?.isColor) {
    orig.litColor = mat.uniforms.litColor.value.clone();
  }
  if (mat.uniforms?.shadeColor?.value?.isColor) {
    orig.shadeColorUniform = mat.uniforms.shadeColor.value.clone();
  }
  if (mat.uniforms?.diffuse?.value?.isColor) {
    orig.diffuse = mat.uniforms.diffuse.value.clone();
  }
  mat.userData._surfaceOrig = orig;
}

function restoreOrig(mat) {
  const orig = mat.userData._surfaceOrig;
  if (!orig) return;
  if (orig.color && mat.color) mat.color.copy(orig.color);
  if (orig.shadeColor && mat.shadeColor) mat.shadeColor.copy(orig.shadeColor);
  if (orig.emissive && mat.emissive) mat.emissive.copy(orig.emissive);
  if (orig.litColor && mat.uniforms?.litColor) mat.uniforms.litColor.value.copy(orig.litColor);
  if (orig.shadeColorUniform && mat.uniforms?.shadeColor) {
    mat.uniforms.shadeColor.value.copy(orig.shadeColorUniform);
  }
  if (orig.diffuse && mat.uniforms?.diffuse) mat.uniforms.diffuse.value.copy(orig.diffuse);
}

function applyTint(mat, tint) {
  const orig = mat.userData._surfaceOrig;
  if (!orig) return;

  if (orig.color && mat.color) {
    mat.color.copy(orig.color).multiply(tint);
  }
  if (orig.shadeColor && mat.shadeColor) {
    mat.shadeColor.copy(orig.shadeColor).multiply(tint);
  }
  if (orig.emissive && mat.emissive) {
    mat.emissive.copy(orig.emissive).multiply(tint);
  }
  if (orig.litColor && mat.uniforms?.litColor) {
    mat.uniforms.litColor.value.copy(orig.litColor).multiply(tint);
  }
  if (orig.shadeColorUniform && mat.uniforms?.shadeColor) {
    mat.uniforms.shadeColor.value.copy(orig.shadeColorUniform).multiply(tint);
  }
  if (orig.diffuse && mat.uniforms?.diffuse) {
    mat.uniforms.diffuse.value.copy(orig.diffuse).multiply(tint);
  }
}

function tintMeshMaterials(root, enabled, colorHex) {
  if (!root) return;
  if (enabled) _tint.set(colorHex);

  root.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
    materials.forEach((mat) => {
      if (!mat) return;
      captureOrig(mat);
      if (!enabled) restoreOrig(mat);
      else applyTint(mat, _tint);
      mat.needsUpdate = true;
    });
  });
}

/**
 * @param {object} vrm — VRM instance from THREE_VRM
 * @param {{ enabled?: boolean, color?: string }} opts
 */
export function applyModelSurfaceColor(vrm, opts = {}) {
  const root = vrm?.scene;
  if (!root) return;
  tintMeshMaterials(root, !!opts.enabled, opts.color || '#e8c4a8');
}

/** @param {object} vrm @param {object} settings */
export function applyModelSurfaceFromSettings(vrm, settings) {
  const cfg = settings?.scene?.modelSurface || {};
  applyModelSurfaceColor(vrm, {
    enabled: cfg.enabled === true,
    color: cfg.color || '#e8c4a8',
  });
}
