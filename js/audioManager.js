// import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.module.js';

export class AudioManager {
  constructor() {
    this.listener = null;
    this.bgm = null;
    this.rain = null;
    this.thunder = null;
    this.isLoaded = false;
  }

  init(camera) {
    this.listener = new THREE.AudioListener();
    camera.add(this.listener);

    // Create global audio sources
    this.rain = new THREE.Audio(this.listener);
    this.thunder = new THREE.Audio(this.listener);

    this.loadAudio();
  }

  loadAudio() {
    const audioLoader = new THREE.AudioLoader();

    // 1. Rain Loop
    // audioLoader.load('audio/rain.mp3', (buffer) => {
    //   this.rain.setBuffer(buffer);
    //   this.rain.setLoop(true);
    //   this.rain.setVolume(0.4); 
    // });

    // // 2. Thunder (One-shot)
    // audioLoader.load('audio/thunder.mp3', (buffer) => {
    //   this.thunder.setBuffer(buffer);
    //   this.thunder.setLoop(false);
    //   this.thunder.setVolume(0.8);
    // });

    this.isLoaded = true;
  }

  playAmbience() {
    // Resume context if suspended (browser policy)
    if (this.listener.context.state === 'suspended') {
      this.listener.context.resume();
    }

    if (this.rain && !this.rain.isPlaying) this.rain.play();
  }

  playThunder() {
    if (this.listener.context.state === 'suspended') return; // Don't play if blocked

    if (this.thunder && !this.thunder.isPlaying) {
        if (this.thunder.source) {
            this.thunder.setDetune((Math.random() - 0.5) * 400); 
        }
        this.thunder.play();
    } else if (this.thunder && this.thunder.isPlaying) {
        this.thunder.stop();
        this.thunder.play();
    }
  }

  toggleMute() {
    // Resume if needed
    if (this.listener.context.state === 'suspended') {
        this.listener.context.resume();
    }
    
    const vol = this.listener.getMasterVolume();
    if (vol > 0) {
        this.listener.setMasterVolume(0);
        return false; // Muted
    } else {
        this.listener.setMasterVolume(1);
        return true; // Active
    }
  }
}
