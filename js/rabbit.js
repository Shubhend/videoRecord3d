// import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.module.js';
// Rely on global THREE

export class Rabbit extends THREE.Group {
  constructor() {
    super();
    this.createMesh();
    
    // Animation State
    this.state = 'IDLE'; // IDLE, HOPPING
    this.hopTime = 0;
    this.restTime = 0;
    this.lookTime = 0;
    this.lookTarget = new THREE.Vector3();
    
    this.velocity = new THREE.Vector3();
    this.onGround = true;

    // AI
    this.target = null; // Will point to avatar position
    this.minDist = 2.5; // Distance to keep from avatar
    
    // Random Start
    this.position.set(3, 0, 3);
  }

  createMesh() {
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
    const pinkMat = new THREE.MeshStandardMaterial({ color: 0xffb7b2, roughness: 0.9 });
    const blackMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.5 });
    
    // --- Scale Group (Rabbit is small) ---
    this.meshRoot = new THREE.Group();
    // Reduced scale by ~30% from 0.3 -> 0.21
    this.meshRoot.scale.set(0.21, 0.21, 0.21); 
    this.add(this.meshRoot);

    // Body starts here


    // 1. Body
    const bodyGeo = new THREE.SphereGeometry(0.8, 8, 8);
    bodyGeo.scale(1, 0.9, 1.4);
    this.body = new THREE.Mesh(bodyGeo, whiteMat);
    this.body.position.y = 0.7;
    this.body.castShadow = true;
    this.meshRoot.add(this.body);

    // 2. Head Group (For animation)
    this.headGroup = new THREE.Group();
    this.headGroup.position.set(0, 1.2, 0.8);
    this.meshRoot.add(this.headGroup);
    
    const headGeo = new THREE.SphereGeometry(0.5, 8, 8);
    this.head = new THREE.Mesh(headGeo, whiteMat);
    this.head.castShadow = true;
    this.headGroup.add(this.head);

    // Ears
    const earGeo = new THREE.BoxGeometry(0.2, 0.8, 0.1);
    
    const earL = new THREE.Mesh(earGeo, whiteMat);
    earL.position.set(-0.25, 0.6, 0);
    earL.rotation.x = -0.2;
    earL.rotation.z = 0.1;
    earL.castShadow = true;
    this.headGroup.add(earL);
    
    const earR = new THREE.Mesh(earGeo, whiteMat);
    earR.position.set(0.25, 0.6, 0);
    earR.rotation.x = -0.2;
    earR.rotation.z = -0.1;
    earR.castShadow = true;
    this.headGroup.add(earR);

    // Eyes
    const eyeGeo = new THREE.SphereGeometry(0.06, 4, 4);
    const eyeL = new THREE.Mesh(eyeGeo, blackMat);
    eyeL.position.set(-0.3, 0.1, 0.4);
    this.headGroup.add(eyeL);
    const eyeR = new THREE.Mesh(eyeGeo, blackMat);
    eyeR.position.set(0.3, 0.1, 0.4);
    this.headGroup.add(eyeR);

    // 3. Tail
    const tailGeo = new THREE.SphereGeometry(0.25, 6, 6);
    const tail = new THREE.Mesh(tailGeo, whiteMat);
    tail.position.set(0, 0.8, -1.0);
    this.meshRoot.add(tail);

    // 4. Legs (Articulated Groups)
    // Front Legs (Simple)
    const fLegGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.6);
    this.legFL = new THREE.Mesh(fLegGeo, whiteMat);
    this.legFL.position.set(-0.4, 0.3, 0.8);
    this.meshRoot.add(this.legFL);
    
    this.legFR = new THREE.Mesh(fLegGeo, whiteMat);
    this.legFR.position.set(0.4, 0.3, 0.8);
    this.meshRoot.add(this.legFR);

    // Back Legs (Thigh + Foot)
    this.thighL = new THREE.Group();
    this.thighL.position.set(-0.6, 0.6, -0.4);
    this.meshRoot.add(this.thighL);
    
    const thighGeo = new THREE.SphereGeometry(0.45, 8, 8);
    thighGeo.scale(0.5, 1, 1);
    const thighMeshL = new THREE.Mesh(thighGeo, whiteMat);
    this.thighL.add(thighMeshL);
    
    // Foot L
    this.footL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 0.6), whiteMat);
    this.footL.position.set(0, -0.6, 0.2);
    this.thighL.add(this.footL);

    this.thighR = new THREE.Group();
    this.thighR.position.set(0.6, 0.6, -0.4);
    this.meshRoot.add(this.thighR);
    const thighMeshR = new THREE.Mesh(thighGeo, whiteMat);
    this.thighR.add(thighMeshR);
    this.footR = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 0.6), whiteMat);
    this.footR.position.set(0, -0.6, 0.2);
    this.thighR.add(this.footR);
  }

  setAvatarTarget(position) {
      if (position) this.target = position;
  }

  update(delta) {
    if (this.state === 'HOPPING') {
        this.updateHop(delta);
    } else {
        this.updateIdle(delta);
    }
  }

  updateIdle(delta) {
    this.restTime += delta;
    this.lookTime += delta;
    
    // Look around animation
    if (this.lookTime > 0.5) {
        // Random subtle head movements
        this.headGroup.rotation.y += (Math.random() - 0.5) * 0.5 * delta;
        this.headGroup.rotation.x += (Math.random() - 0.5) * 0.2 * delta;
        
        // Clamp
        this.headGroup.rotation.y *= 0.9;
        this.headGroup.rotation.x *= 0.9;
        
        if (this.lookTime > 2.0) this.lookTime = 0;
    }
    
    // Decide to hop
    if (this.restTime > 3.5) {
        if (this.target) {
            const dist = this.position.distanceTo(this.target);
            // If too far, hop towards. If too close, maybe hop away or turn.
            if (dist > this.minDist) {
                this.startHop(this.target);
            } else if (dist < 1.0) {
                 // Too close! Hop away
                 const away = new THREE.Vector3().subVectors(this.position, this.target).add(this.position);
                 this.startHop(away);
            } else {
                // Just random adjust
                if (Math.random() > 0.8) {
                    const randPos = this.position.clone().add(new THREE.Vector3((Math.random()-0.5)*2, 0, (Math.random()-0.5)*2));
                    this.startHop(randPos);
                }
            }
        } else {
            // Random hop
             const randPos = this.position.clone().add(new THREE.Vector3((Math.random()-0.5)*2, 0, (Math.random()-0.5)*2));
            this.startHop(randPos);
        }
    }
    
    // Ground limbs
    this.meshRoot.position.y = 0;
    this.thighL.rotation.x = 0;
    this.thighR.rotation.x = 0;
  }

  startHop(targetPos) {
      this.state = 'HOPPING';
      this.hopTime = 0;
      this.restTime = 0;
      
      // Calculate direction
      const dir = new THREE.Vector3().subVectors(targetPos, this.position);
      dir.y = 0;
      dir.normalize();
      
      // Face direction (Lerp rotation later? Instant for now for responsiveness)
      const angle = Math.atan2(dir.x, dir.z);
      this.rotation.y = angle;
      
      this.velocity.copy(dir).multiplyScalar(4.0); // Speed
  }
  
  updateHop(delta) {
      this.hopTime += delta * 5.0; // Jump speed
      
      // Arc logic
      if (this.hopTime > Math.PI) {
          // Landed
          this.state = 'IDLE';
          this.hopTime = 0;
          this.meshRoot.position.y = 0;
          return;
      }
      
      // Physics move
      const jumpHeight = 0.6;
      this.meshRoot.position.y = Math.sin(this.hopTime) * jumpHeight;
      this.position.addScaledVector(this.velocity, delta);
      
      // Limb Animation (Leg kick)
      // Extend back legs when jumping up
      const kick = Math.sin(this.hopTime);
      this.thighL.rotation.x = kick * 0.5; // Rotate back
      this.thighR.rotation.x = kick * 0.5;
      
      // Front legs dangle
      this.legFL.rotation.x = -kick * 0.5;
      this.legFR.rotation.x = -kick * 0.5;
  }
}
