// ==================== SCENE SETUP ====================
// Three.js scene, camera, renderer, lighting setup

import { Config } from './config.js';

export class SceneSetup {
  constructor(canvas) {
    this.canvas = canvas;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.clock = null;
  }
  
  init() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    
    // Scene
    this.scene = new THREE.Scene();
    
    // Camera
    this.camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000);
    this.camera.position.set(0, 1.4, 4);
    
    // Renderer
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(Config.scene.backgroundColor, 1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    
    // OrbitControls - extended range to see full scene
    this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = false; // Stop movement instantly on release
    this.controls.dampingFactor = 0.05;
    this.controls.enableZoom = true;
    this.controls.target.set(0, 1.4, 0); 
    this.controls.minDistance = 0.5;   // Can zoom in closer
    this.controls.maxDistance = 100;   // Can zoom out much further
    this.controls.maxPolarAngle = Math.PI / 2 + 0.5;  // Can look more below
    this.controls.update();
    
    // Clock
    this.clock = new THREE.Clock();
    
    // Setup lighting
    this.setupLighting();
    
    // Setup environment
    this.setupEnvironment();
    
    // Resize handler
    window.addEventListener('resize', () => this.onResize());
    
    return this;
  }
  
  setupLighting() {
    const { lighting } = Config;
    
    // Main directional light
    const directionalLight = new THREE.DirectionalLight(lighting.directional.color, lighting.directional.intensity);
    directionalLight.position.set(2, 4, 2);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 1024;
    directionalLight.shadow.mapSize.height = 1024;
    directionalLight.shadow.camera.near = 0.1;
    directionalLight.shadow.camera.far = 10;
    directionalLight.shadow.camera.left = -5;
    directionalLight.shadow.camera.right = 5;
    directionalLight.shadow.camera.top = 5;
    directionalLight.shadow.camera.bottom = -5;
    directionalLight.shadow.camera.bottom = -5;
    this.scene.add(directionalLight);
    this.scene.add(directionalLight.target); // Ensure target is in scene
    
    // Front fill light
    const frontLight = new THREE.DirectionalLight(lighting.front.color, lighting.front.intensity);
    frontLight.position.set(0, 2, 4);
    this.scene.add(frontLight);
    
    // Ambient light
    this.scene.add(new THREE.AmbientLight(lighting.ambient.color, lighting.ambient.intensity));
    
    // Back light
    const backLight = new THREE.DirectionalLight(lighting.back.color, lighting.back.intensity);
    backLight.position.set(-1, 2, -2);
    this.scene.add(backLight);
  }
  
  setupEnvironment() {
    // Stars
    this.createStars();
    
    // Floor
    this.createFloor();
    
    // Grid
    this.createGrid();
    
    // Shadow ground
    this.createShadowGround();

    // Moon
    this.createMoon();
  }

  createMoon() {
    // 1. Procedural Moon Texture (Canvas)
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // Base color
    ctx.fillStyle = '#fdfbd3'; // Pale yellowish white
    ctx.fillRect(0, 0, size, size);

    // "Patches" / Craters
    for (let i = 0; i < 40; i++) {
        const x = Math.random() * size;
        const y = Math.random() * size;
        const radius = Math.random() * 40 + 10;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(200, 190, 180, ${Math.random() * 0.3 + 0.1})`; // Darker patches
        ctx.fill();
    }
    
    const texture = new THREE.CanvasTexture(canvas);

    // 2. Moon Mesh (Scaled Up for Distance)
    const geometry = new THREE.SphereGeometry(8, 32, 32); // Larger mesh
    const material = new THREE.MeshStandardMaterial({
        map: texture,
        emissive: 0x444444, 
        emissiveMap: texture,
        emissiveIntensity: 0.2,
        roughness: 0.8
    });
    
    this.moon = new THREE.Mesh(geometry, material);
    // Position: Distant Left Sky (-80, 60, -80)
    const moonPos = new THREE.Vector3(-80, 60, -80);
    this.moon.position.copy(moonPos);
    this.scene.add(this.moon);

    // 3. Moonlight (Directional Light Rays)
    this.moonLight = new THREE.DirectionalLight(0xddeeff, 0.5);
    this.moonLight.position.copy(moonPos);
    this.moonLight.castShadow = true;
    // ... shadows ...
    this.moonLight.target.position.set(0, 0, 0);
    this.scene.add(this.moonLight);
    this.scene.add(this.moonLight.target);

    // 4. Glow
    this.moonGlow = new THREE.PointLight(0xffffee, 1.0, 200); // Larger range
    this.moonGlow.position.copy(moonPos);
    this.scene.add(this.moonGlow);
  }
  
  createStars() {
    const starGeo = new THREE.BufferGeometry();
    const starCount = 1500;
    const posArray = new Float32Array(starCount * 3);
    
    for(let i = 0; i < starCount * 3; i+=3) {
      // Much larger radius for "distant" sky feeling
      // Push them way out between 200 and 400
      const r = 200 + Math.random() * 200;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos((Math.random() * 2) - 1);
      
      posArray[i] = r * Math.sin(phi) * Math.cos(theta);     // x
      posArray[i+1] = Math.abs(r * Math.sin(phi) * Math.sin(theta)); // y (keep above horizon mostly? or full sphere)
      posArray[i+2] = r * Math.cos(phi);                     // z
      
      // Flatten bottom a bit so they don't look weird under floor if visible? 
      // Actually full sphere is fine if floor covers it.
    }
    
    starGeo.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
    
    const starMat = new THREE.PointsMaterial({
      size: 0.8, // Slightly larger to be visible at distance
      color: 0xffffff,
      transparent: true,
      opacity: 0.8,
    });
    
    this.starsMesh = new THREE.Points(starGeo, starMat);
    this.scene.add(this.starsMesh);
  }
  
  createFloor() {
    const { scene: sceneConfig } = Config;
    const floorGeometry = new THREE.PlaneGeometry(sceneConfig.floorSize, sceneConfig.floorSize);
    const floorMaterial = new THREE.MeshStandardMaterial({ 
      color: sceneConfig.floorColor,
      roughness: 0.8,
      metalness: 0.2
    });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.floorMesh = floor;
  }
  
  createGrid() {
    const { scene: sceneConfig } = Config;
    const gridHelper = new THREE.GridHelper(sceneConfig.floorSize, sceneConfig.gridDivisions, 0x888888, 0x444444);
    gridHelper.position.y = 0.01;
    this.scene.add(gridHelper);
    this.gridHelper = gridHelper;
  }
  
  createShadowGround() {
    const groundGeometry = new THREE.PlaneGeometry(12, 12);
    const groundMaterial = new THREE.ShadowMaterial({ opacity: 0.5 });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0.02;
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.shadowGroundMesh = ground;
  }

  /**
   * Show or hide the floor plane, grid helper, and shadow-catcher surface.
   * @param {boolean} visible
   */
  setGroundVisible(visible) {
    const v = !!visible;
    if (this.floorMesh) this.floorMesh.visible = v;
    if (this.gridHelper) this.gridHelper.visible = v;
    if (this.shadowGroundMesh) this.shadowGroundMesh.visible = v;
  }
  
  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
  
  render() {
    if (this.controls) {
      this.controls.update();
    }
    this.renderer.render(this.scene, this.camera);
  }

  getDelta() {
    return this.clock.getDelta();
  }

  /**
   * Apply a custom scene background.
   * @param {{ mode: 'default'|'color'|'image', color?: string, blob?: Blob|null }} cfg
   */
  applyBackground(cfg) {
    if (!this.scene || !this.renderer) return;

    // Dispose any prior background image texture / object URL.
    if (this._bgTexture) {
      this._bgTexture.dispose();
      this._bgTexture = null;
    }
    if (this._bgObjectUrl) {
      URL.revokeObjectURL(this._bgObjectUrl);
      this._bgObjectUrl = null;
    }

    const mode = cfg?.mode || 'default';

    if (mode === 'color') {
      const color = new THREE.Color(cfg.color || '#0a0e1a');
      this.scene.background = color;
      this.renderer.setClearColor(color, 1);
    } else if (mode === 'image' && cfg.blob) {
      const url = URL.createObjectURL(cfg.blob);
      this._bgObjectUrl = url;
      const loader = new THREE.TextureLoader();
      loader.load(
        url,
        (texture) => {
          // Default to using image as a fullscreen background.
          this._bgTexture = texture;
          this.scene.background = texture;
        },
        undefined,
        (err) => {
          console.error('Failed to load background image:', err);
        }
      );
    } else {
      // Default: revert to procedural night sky
      this.scene.background = null;
      this.renderer.setClearColor(Config.scene.backgroundColor, 1);
    }

    // Hide / show celestial decorations so a custom background isn't
    // cluttered with stars and a moon floating in front of it.
    const showCelestials = mode === 'default';
    if (this.starsMesh) this.starsMesh.visible = showCelestials;
    if (this.moon) this.moon.visible = showCelestials;
    if (this.moonLight) this.moonLight.visible = showCelestials;
    if (this.moonGlow) this.moonGlow.visible = showCelestials;
  }
}
