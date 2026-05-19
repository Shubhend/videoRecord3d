// ==================== SCENE OBJECTS ====================
// 3D objects for the scene (house, trees, etc.)

export class SceneObjects {
  constructor(scene, audioManager) {
    this.scene = scene;
    this.audioManager = audioManager;
  }
  
  /**
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {THREE.Object3D} [parent] — defaults to scene root
   */
  createHouse(x, y, z, parent = null) {
    const houseGroup = new THREE.Group();
    
    // Main house body
    const bodyGeometry = new THREE.BoxGeometry(2, 1.5, 2);
    const bodyMaterial = new THREE.MeshStandardMaterial({ 
      color: 0xd4a574,  // Warm beige/tan
      roughness: 0.8 
    });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.position.y = 0.75;
    body.castShadow = true;
    body.receiveShadow = true;
    houseGroup.add(body);
    
    // Roof (pyramid shape)
    const roofGeometry = new THREE.ConeGeometry(1.6, 1, 4);
    const roofMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x8b4513,  // Brown roof
      roughness: 0.7 
    });
    const roof = new THREE.Mesh(roofGeometry, roofMaterial);
    roof.position.y = 2;
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    houseGroup.add(roof);
    
    // Door
    const doorGeometry = new THREE.BoxGeometry(0.4, 0.8, 0.05);
    const doorMaterial = new THREE.MeshStandardMaterial({ color: 0x4a3728 });
    const door = new THREE.Mesh(doorGeometry, doorMaterial);
    door.position.set(0, 0.4, 1.025);
    houseGroup.add(door);
    
    // Windows
    const windowGeometry = new THREE.BoxGeometry(0.3, 0.3, 0.05);
    const windowMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x87ceeb,
      emissive: 0x87ceeb,
      emissiveIntensity: 0.3
    });
    
    const window1 = new THREE.Mesh(windowGeometry, windowMaterial);
    window1.position.set(-0.5, 1, 1.025);
    houseGroup.add(window1);
    
    const window2 = new THREE.Mesh(windowGeometry, windowMaterial);
    window2.position.set(0.5, 1, 1.025);
    houseGroup.add(window2);
    
    // Chimney
    const chimneyGeometry = new THREE.BoxGeometry(0.3, 0.6, 0.3);
    const chimneyMaterial = new THREE.MeshStandardMaterial({ color: 0x8b0000 });
    const chimney = new THREE.Mesh(chimneyGeometry, chimneyMaterial);
    chimney.position.set(0.6, 2.3, -0.5);
    chimney.castShadow = true;
    houseGroup.add(chimney);
    
    houseGroup.position.set(x, y, z);
    (parent || this.scene).add(houseGroup);
    return houseGroup;
  }
  
  // Create a detailed procedural tree
  createTree(x, y, z, parent = null) {
    const treeGroup = new THREE.Group();
    
    // Tree trunk
    const trunkGeometry = new THREE.CylinderGeometry(0.1, 0.15, 1, 8);
    const trunkMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x4a3728,
      roughness: 0.9 
    });
    const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
    trunk.position.y = 0.5;
    trunk.castShadow = true;
    treeGroup.add(trunk);
    
    // Foliage layers
    const foliageMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x228b22,
      roughness: 0.8 
    });
    
    const layers = [
      { radius: 0.7, height: 0.8, y: 1.2 },
      { radius: 0.55, height: 0.7, y: 1.7 },
      { radius: 0.4, height: 0.6, y: 2.1 }
    ];
    
    layers.forEach(layer => {
      const geometry = new THREE.ConeGeometry(layer.radius, layer.height, 8);
      const foliage = new THREE.Mesh(geometry, foliageMaterial);
      foliage.position.y = layer.y;
      foliage.castShadow = true;
      treeGroup.add(foliage);
    });
    
    treeGroup.position.set(x, y, z);
    (parent || this.scene).add(treeGroup);
    return treeGroup;
  }
  
  // Create a fence
  createFence(x, y, z, length = 4, direction = 'x') {
    const fenceGroup = new THREE.Group();
    const postMaterial = new THREE.MeshStandardMaterial({ color: 0x8b4513 });
    const railMaterial = new THREE.MeshStandardMaterial({ color: 0xa0522d });
    
    const postCount = Math.ceil(length / 0.5) + 1;
    
    for (let i = 0; i < postCount; i++) {
      const postGeometry = new THREE.BoxGeometry(0.08, 0.6, 0.08);
      const post = new THREE.Mesh(postGeometry, postMaterial);
      post.position.y = 0.3;
      if (direction === 'x') {
        post.position.x = i * 0.5;
      } else {
        post.position.z = i * 0.5;
      }
      post.castShadow = true;
      fenceGroup.add(post);
    }
    
    // Rails
    const railGeometry = new THREE.BoxGeometry(
      direction === 'x' ? length : 0.05, 
      0.05, 
      direction === 'z' ? length : 0.05
    );
    
    const topRail = new THREE.Mesh(railGeometry, railMaterial);
    topRail.position.set(
      direction === 'x' ? length / 2 : 0, 
      0.5, 
      direction === 'z' ? length / 2 : 0
    );
    fenceGroup.add(topRail);
    
    const bottomRail = new THREE.Mesh(railGeometry, railMaterial);
    bottomRail.position.set(
      direction === 'x' ? length / 2 : 0, 
      0.2, 
      direction === 'z' ? length / 2 : 0
    );
    fenceGroup.add(bottomRail);
    
    fenceGroup.position.set(x, y, z);
    this.scene.add(fenceGroup);
    return fenceGroup;
  }
  
  loadModel(url, position = { x: 0, y: 0, z: 0 }, scale = 1, centerGeometry = false) {
    const loader = new THREE.GLTFLoader();
    
    return new Promise((resolve, reject) => {
      loader.load(
        url,
        (gltf) => {
          const model = gltf.scene;
          model.scale.set(scale, scale, scale);
          
          // If centerGeometry is true, offset the model to center its bounding box at origin
          if (centerGeometry) {
            const box = new THREE.Box3().setFromObject(model);
            const center = box.getCenter(new THREE.Vector3());
            // Move all children to counter the offset
            model.position.set(-center.x, -box.min.y, -center.z);
          }
          
          // Create a wrapper group for proper positioning
          const wrapper = new THREE.Group();
          wrapper.add(model);
          wrapper.position.set(position.x, position.y, position.z);
          
          wrapper.traverse((obj) => {
            if (obj.isMesh) {
              obj.castShadow = true;
              obj.receiveShadow = true;
            }
          });
          this.scene.add(wrapper);
          resolve(wrapper);
        },
        undefined,
        reject
      );
    });
  }

  createWeather(bounds) {
    const featureSize = 375;
    this.weatherGroup = new THREE.Group();
    
    // Bounds dimensions (Local to the group)
    const minX = bounds.min.x;
    const maxX = bounds.max.x;
    const minZ = bounds.min.z;
    const maxZ = bounds.max.z;
    const minY = bounds.min.y;
    
    // 1. Increase Height (was +3, now +5 for ~30% feel)
    const topY = bounds.max.y + 5.0;
    
    // Centers
    const centerX = (minX + maxX) / 2;
    const centerZ = (minZ + maxZ) / 2;
    
    // 2. Narrow Rain Area (20% reduction = 80% width/depth)
    const width = maxX - minX;
    const depth = maxZ - minZ;
    const marginX = width * 0.10; // 10% each side
    const marginZ = depth * 0.10;
    
    const rainMinX = minX + marginX;
    const rainMaxX = maxX - marginX;
    const rainMinZ = minZ + marginZ;
    const rainMaxZ = maxZ - marginZ;

    this.rainBounds = { 
        minY, topY, 
        minX: rainMinX, maxX: rainMaxX, 
        minZ: rainMinZ, maxZ: rainMaxZ, 
        centerX, centerZ 
    };
    
    // --- 3. CLOUDS (Clustered Shape) ---
    this.cloudGroup = new THREE.Group();
    const cloudGeo = new THREE.SphereGeometry(1.8, 7, 7); 
    
    const cloudCount = 3; 
    
    // Tight triangle configuration for "Real Cloud Shape"
    // Offsets from center
    const positions = [
        { x: 0, z: 0 },             // Center
        { x: -1.2, z: 0.8 },        // Back Left
        { x: 1.2, z: 0.8 }          // Back Right
    ];

    for(let i=0; i<cloudCount; i++) {
        const cloudMat = new THREE.MeshLambertMaterial({ 
            color: 0xcccccc, 
            transparent: true, 
            opacity: 0.85 
        });
        
        const cloud = new THREE.Mesh(cloudGeo, cloudMat);
        
        const pos = positions[i] || { x: 0, z: 0 };
        
        cloud.position.set(
            centerX + pos.x + (Math.random() * 0.4 - 0.2), // Slight jitter
            topY, 
            centerZ + pos.z + (Math.random() * 0.4 - 0.2)
        );
        
        // Vary sizes slightly - Reduced by ~30% as requested
        const scale = 0.6 + Math.random() * 0.3;
        cloud.scale.set(scale, scale * 0.7, scale);
        
        this.cloudGroup.add(cloud);
    }
    this.weatherGroup.add(this.cloudGroup);
    
    // --- 4. LIGHTNING ---
    this.lightningLight = new THREE.PointLight(0xa0a0ff, 0, 50, 2);
    this.lightningLight.position.set(centerX, topY - 1, centerZ);
    this.weatherGroup.add(this.lightningLight);
    
    // Bolt Geometry
    this.boltMaterial = new THREE.LineBasicMaterial({ color: 0xffffff });
    this.boltGeometry = new THREE.BufferGeometry();
    this.boltMesh = new THREE.Line(this.boltGeometry, this.boltMaterial);
    this.boltMesh.visible = false;
    this.weatherGroup.add(this.boltMesh);

    // --- 5. RAIN DROPS (Restricted Area) ---
    const geometry = new THREE.BufferGeometry();
    const positionsArr = [];
    
    for (let i = 0; i < featureSize; i++) {
      // Use NARROW bounds
      const x = Math.random() * (rainMaxX - rainMinX) + rainMinX;
      const y = Math.random() * (topY - minY) + minY;
      const z = Math.random() * (rainMaxZ - rainMinZ) + rainMinZ;
      const dropLen = 0.4;
      
      positionsArr.push(x, y, z);
      positionsArr.push(x, y - dropLen, z);
    }
    
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positionsArr, 3));
    
    const material = new THREE.LineBasicMaterial({
      color: 0xaaaaaa,
      transparent: true,
      opacity: 0.6
    });
    
    this.rainSystem = new THREE.LineSegments(geometry, material);
    this.weatherGroup.add(this.rainSystem);
    
    return this.weatherGroup;
  }

  createLightningBolt() {
    // Generate a jagged/branching look
    const points = [];
    const height = 7;
    // Start at random position near cloudy center
    const startX = this.rainBounds.centerX + (Math.random() - 0.5) * 3;
    const startZ = this.rainBounds.centerZ + (Math.random() - 0.5) * 3;
    const startY = this.rainBounds.topY;
    
    let currentPos = new THREE.Vector3(startX, startY, startZ);
    points.push(currentPos.clone());
    
    const segments = 8;
    const segmentHeight = height / segments;
    
    for(let i=0; i<segments; i++) {
        currentPos.y -= segmentHeight;
        // Strong jitter for "zigzag"
        currentPos.x += (Math.random() - 0.5) * 1.5;
        currentPos.z += (Math.random() - 0.5) * 1.5;
        points.push(currentPos.clone());
    }
    
    this.boltGeometry.setFromPoints(points);
  }

  updateWeather() {
    if (!this.rainSystem || !this.rainBounds) return;
    
    // --- Update Rain Drops ---
    const positions = this.rainSystem.geometry.attributes.position.array;
    const speed = 0.4; 
    const dropLen = 0.4;
    
    for (let i = 0; i < positions.length; i += 6) {
      positions[i + 1] -= speed;     // Top Y
      positions[i + 4] -= speed;     // Bottom Y
      
      if (positions[i + 1] < this.rainBounds.minY) {
        const newX = Math.random() * (this.rainBounds.maxX - this.rainBounds.minX) + this.rainBounds.minX;
        const newZ = Math.random() * (this.rainBounds.maxZ - this.rainBounds.minZ) + this.rainBounds.minZ;
        
        positions[i] = newX;
        positions[i + 1] = this.rainBounds.topY;
        positions[i + 2] = newZ;
        
        positions[i + 3] = newX;
        positions[i + 4] = this.rainBounds.topY - dropLen;
        positions[i + 5] = newZ;
      }
    }
    this.rainSystem.geometry.attributes.position.needsUpdate = true;
    
    // --- Update Lightning ---
    // Timing Logic: First after 5s, then every 20s
    if (!this.weatherStartTime) {
        this.weatherStartTime = Date.now();
        this.lastThunderTime = 0;
        this.hasFlashedOnce = false;
    }

    const now = performance.now();
    let shouldFlash = false;
    
    // Random chance (Increased to 1.8% per frame)
    if (!this.hasFlashedOnce && Math.random() < 0.018) { 
        shouldFlash = true;
    } 
    // Manual interval backup
    else if (this.hasFlashedOnce && (now - this.lastThunderTime) >= 10000) {
        shouldFlash = true;
    }

    if (shouldFlash) {
        this.lastThunderTime = now;
        if (!this.hasFlashedOnce) this.hasFlashedOnce = true;
    }

    if (this.lightningLight) {
        if (shouldFlash) {
            const intensity = 15 + Math.random() * 20;
            this.lightningLight.intensity = intensity;
            
            // Audio
            if (this.audioManager) this.audioManager.playThunder();

            this.createLightningBolt();
            this.boltMesh.visible = true;
            
            // Move light to bolt start
            const boltStart = this.boltGeometry.attributes.position ? 
                new THREE.Vector3().fromBufferAttribute(this.boltGeometry.attributes.position, 0) :
                new THREE.Vector3(this.rainBounds.centerX, this.rainBounds.topY, this.rainBounds.centerZ);

            this.lightningLight.position.copy(boltStart);
            this.lightningLight.position.y -= 1; // Slightly below start
            
        } else {
            // Fade
            if (this.lightningLight.intensity > 0) {
                this.lightningLight.intensity *= 0.8; 
                if (this.lightningLight.intensity < 1) {
                    this.boltMesh.visible = false;
                }
            }
        }
    }
  }
}
