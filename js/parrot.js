// Rely on global THREE

export class Parrot extends THREE.Group {
  constructor(colors) {
    super();
    this.colors = colors || {
        body: 0xff0000,
        wing: 0xffff00,
        wingTip: 0x0000ff,
        tail: 0x0000ff
    };
    
    this.createMesh();
    
    // State
    this.state = 'FLYING'; // FLYING, SEEK_PERCH, PERCHED
    this.perchTarget = null;
    this.flightTime = Math.random() * 100;
    this.perchTimer = 0;
    
    // Physics
    this.velocity = new THREE.Vector3();
    this.speed = 3.0 + Math.random() * 2.0;
    
    // Animation
    this.wingAngle = 0;
    this.flapSpeed = 15.0;
  }

  createMesh() {
    // Scale: Small (~30cm tall/long)
    // 1 unit = 1 meter usually, so scale down
    this.scale.set(0.15, 0.15, 0.15); // Slightly smaller than rabbit
    
    const bodyMat = new THREE.MeshStandardMaterial({ color: this.colors.body, roughness: 0.6 });
    const wingMat = new THREE.MeshStandardMaterial({ color: this.colors.wing, roughness: 0.6, side: THREE.DoubleSide });
    const tipMat = new THREE.MeshStandardMaterial({ color: this.colors.wingTip, roughness: 0.6, side: THREE.DoubleSide });
    const tailMat = new THREE.MeshStandardMaterial({ color: this.colors.tail, roughness: 0.6, side: THREE.DoubleSide });
    const beakMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.4 });
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff });

    // 1. Body
    // CapsuleGeometry not supported in r128, use scaled Sphere
    const bodyGeo = new THREE.SphereGeometry(0.4, 8, 8);
    bodyGeo.applyMatrix4(new THREE.Matrix4().makeScale(1, 2, 1)); // Elongate to resemble capsule
    // Orient horizontal
    bodyGeo.rotateX(Math.PI / 2);
    this.body = new THREE.Mesh(bodyGeo, bodyMat);
    this.body.castShadow = true;
    this.add(this.body);

    // 2. Head
    const headGeo = new THREE.SphereGeometry(0.35, 8, 8);
    this.head = new THREE.Mesh(headGeo, bodyMat);
    this.head.position.set(0, 0.3, 0.5); // Up and forward
    this.body.add(this.head);
    
    // Beak (Curved approximation)
    const beakGeo = new THREE.ConeGeometry(0.1, 0.4, 8);
    beakGeo.rotateX(-Math.PI * 0.4); // Curve down
    this.beak = new THREE.Mesh(beakGeo, beakMat);
    this.beak.position.set(0, 0, 0.35);
    this.head.add(this.beak);
    
    // Eyes
    const eyeGeo = new THREE.SphereGeometry(0.08, 4, 4);
    const eyeL = new THREE.Mesh(eyeGeo, whiteMat);
    eyeL.position.set(-0.25, 0.1, 0.15);
    this.head.add(eyeL);
    
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.03), beakMat);
    pupil.position.z = 0.07;
    eyeL.add(pupil);
    
    const eyeR = eyeL.clone();
    eyeR.position.x = 0.25;
    this.head.add(eyeR);

    // 3. Wings (Anchor at shoulder)
    this.wingL = new THREE.Group();
    this.wingL.position.set(-0.3, 0.2, 0.2);
    this.body.add(this.wingL);
    
    // Base Wing
    const wBaseGeo = new THREE.PlaneGeometry(1.2, 0.8);
    const wBaseL = new THREE.Mesh(wBaseGeo, wingMat);
    wBaseL.position.set(-0.6, 0, 0); // Extend out
    wBaseL.rotation.x = -Math.PI / 2; // Flat
    this.wingL.add(wBaseL);
    
    // Wing Tip
    const wTipGeo = new THREE.PlaneGeometry(1.0, 0.6);
    this.wingTipL = new THREE.Mesh(wTipGeo, tipMat);
    this.wingTipL.position.set(-1.1, 0, 0); // Extend further
    this.wingTipL.rotation.x = -Math.PI/2;
    this.wingL.add(this.wingTipL);

    // Right Wing (Mirror)
    this.wingR = new THREE.Group();
    this.wingR.position.set(0.3, 0.2, 0.2);
    this.body.add(this.wingR);
    
    const wBaseR = new THREE.Mesh(wBaseGeo, wingMat);
    wBaseR.position.set(0.6, 0, 0);
    wBaseR.rotation.x = -Math.PI / 2;
    this.wingR.add(wBaseR);
    
    this.wingTipR = new THREE.Mesh(wTipGeo, tipMat);
    this.wingTipR.position.set(1.1, 0, 0);
    this.wingTipR.rotation.x = -Math.PI/2;
    this.wingR.add(this.wingTipR);
    
    // 4. Tail
    const tailGeo = new THREE.PlaneGeometry(0.4, 2.0);
    tailGeo.translate(0, -1.0, 0); // Anchor top
    tailGeo.rotateX(-Math.PI/2 + 0.2); // Angle down
    this.tail = new THREE.Mesh(tailGeo, tailMat);
    this.tail.position.set(0, 0, -0.6);
    this.body.add(this.tail);
  }

  update(delta, time) {
    this.flightTime += delta;
    
    if (this.state === 'FLYING') {
        this.updateFlying(delta, time);
    } else if (this.state === 'SEEK_PERCH') {
        this.updateSeeking(delta);
    } // PERCHED handles itself logic mostly
    
    // Animation
    this.animateWings(delta);
  }
  
  updateFlying(delta, time) {
      // Reverting to Stable Mathematical Orbit (Smoother, no chaos)
      
      const t = this.flightTime * 0.4; // Controlled speed
      
      // Radius variation (Breathing circle) + Long range wander
      // Base 7 + FastVar 3 + SlowVar 5 = Max 15m, Min ~0m (clamped later if needed? No, Math.sin overlaps ensure it stays >2 usually)
      const r = 7.0 + Math.sin(t * 0.5) * 3.0 + Math.sin(t * 0.15) * 5.0; 
      
      // Center Point (Shifted towards House to reduce Avatar focus)
      const centerX = -3;
      const centerZ = -3;
      
      // Target Position on Orbit
      const tx = centerX + Math.sin(t) * r;
      const tz = centerZ + Math.cos(t) * r;
      
      // Altitude (High fluctuation: 2m to 14m)
      // Base 8 + SlowVar 4 + FastVar 2
      const ty = 8.0 + Math.sin(t * 0.3) * 4.0 + Math.sin(t * 1.5) * 2.0;
      
      const target = new THREE.Vector3(tx, Math.max(ty, 2.0), tz); // Clamp > 2m
      
      // Move towards target
      // We seek the point ahead on the curve to look smooth
      const lookAheadT = t + 0.5;
      const lookTx = centerX + Math.sin(lookAheadT) * r;
      const lookTz = centerZ + Math.cos(lookAheadT) * r;
      const lookTarget = new THREE.Vector3(lookTx, ty, lookTz); // Approximate look-ahead
      
      // Interpolate position directly for rail-like smoothness (no physics jitter)
      // But we use lerp to give it a *little* weight
      this.position.lerp(target, delta * 2.0);
      
      // Smooth LookAt
      const currentLook = new THREE.Vector3(0,0,1).applyQuaternion(this.quaternion);
      const dirToLook = new THREE.Vector3().subVectors(lookTarget, this.position).normalize();
      
      // Mix current and desired for dampening
      const smoothDir = currentLook.lerp(dirToLook, delta * 3.0).normalize();
      this.lookAt(this.position.clone().add(smoothDir));
      
      // Simple Banking (Visual only, based on curve)
      // Turning rate is roughly constant in orbit, so constant bank
      this.rotation.z = -0.3; // Slight permanent bank into turn
  }
  
  // switchTarget removed/unused for Orbit mode, but method existence hurts nothing.

  updateSeeking(delta) {
      // Fly towards perch
  }

  animateWings(delta) {
      if (this.state === 'FLYING' || this.state === 'SEEK_PERCH') {
          this.wingAngle += delta * this.flapSpeed * (this.state === 'SEEK_PERCH' ? 1.5 : 1.0);
          const flap = Math.sin(this.wingAngle);
          
          // Base rotation
          this.wingL.rotation.z = flap * 0.5;
          this.wingR.rotation.z = -flap * 0.5;
          
          // Tip delayed rotation (Drag)
          this.wingTipL.rotation.z = -flap * 0.3; // Local relative
          this.wingTipR.rotation.z = flap * 0.3;
          
          // Bob body
          this.body.position.y = Math.sin(this.wingAngle) * 0.05;
          
          // Banking handled in updateFlying
      } else {
          // Fold wings
          this.wingL.rotation.z = THREE.MathUtils.lerp(this.wingL.rotation.z, -0.2, delta * 2);
          this.wingR.rotation.z = THREE.MathUtils.lerp(this.wingR.rotation.z, 0.2, delta * 2);
      }
  }
}
