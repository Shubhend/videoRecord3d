// Perspective camera setup — ported from JeelizThreeHelper.create_camera / update_camera.
// @see https://github.com/jeeliz/jeelizFaceFilter/blob/master/helpers/JeelizThreeHelper.js

const CAMERA_MIN_VIDEO_DIM_FOV = 35;

/**
 * Same defaults as Jeeliz tiger / Three.js demos.
 */
export function createJeelizPerspectiveCamera() {
  const camera = new THREE.PerspectiveCamera(20, 1, 0.1, 100);
  camera.position.set(0, 0, 0);
  camera.lookAt(0, 0, 1);
  return camera;
}

/**
 * Match Three.js viewport to webcam crop (Jeeliz update_camera).
 * @returns {{ scaleW: number, canvasAspectRatio: number }}
 */
export function updateJeelizPerspectiveCamera(camera, renderer, video, jeelizCanvas) {
  const cvw = Math.max(1, renderer?.domElement?.width || 1);
  const cvh = Math.max(1, renderer?.domElement?.height || 1);
  const canvasAspectRatio = cvw / cvh;

  const vw = Math.max(1, video?.videoWidth || cvw);
  const vh = Math.max(1, video?.videoHeight || cvh);
  const videoAspectRatio = vw / vh;

  const fovFactor =
    videoAspectRatio > canvasAspectRatio
      ? videoAspectRatio / canvasAspectRatio
      : 1;
  const fov = CAMERA_MIN_VIDEO_DIM_FOV * fovFactor;

  let scale = 1;
  let cvws;
  let cvhs;
  if (canvasAspectRatio > videoAspectRatio) {
    scale = cvw / vw;
    cvws = vw * scale;
    cvhs = vh * scale;
  } else {
    scale = cvh / vh;
    cvws = vw * scale;
    cvhs = vh * scale;
  }
  const offsetX = (cvws - cvw) / 2;
  const offsetY = (cvhs - cvh) / 2;
  const scaleW = cvw / cvws;

  camera.aspect = canvasAspectRatio;
  camera.fov = fov;
  camera.setViewOffset(cvws, cvhs, offsetX, offsetY, cvw, cvh);
  camera.updateProjectionMatrix();

  renderer.setSize(cvw, cvh, false);
  renderer.setViewport(0, 0, cvw, cvh);

  if (jeelizCanvas) {
    jeelizCanvas.width = cvw;
    jeelizCanvas.height = cvh;
    if (typeof JEELIZFACEFILTER !== 'undefined') {
      JEELIZFACEFILTER.resize();
    }
  }

  return { scaleW, canvasAspectRatio, fov };
}
