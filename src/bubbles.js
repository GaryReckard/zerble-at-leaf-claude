// Bubble particle system. InstancedMesh of transmissive spheres with simple physics.

import * as THREE from 'three';

const MAX_BUBBLES = 120;
const SPAWN_PER_SEC = 26;
const GRAVITY = -0.45;
const BUOYANCY = 1.0;
const LIFETIME = 8;
const POP_SCALE_TIME = 0.25;

// Slowly varying global wind so all bubbles drift coherently most of the time.
let _windT = 0;
function sampleWind(t) {
  return {
    x: Math.sin(t * 0.21) * 0.8 + Math.cos(t * 0.07) * 0.5,
    z: Math.cos(t * 0.18) * 0.8 + Math.sin(t * 0.05) * 0.5,
  };
}

export class Bubbles {
  constructor() {
    const geo = new THREE.IcosahedronGeometry(0.11, 1); // about half the previous size
    const mat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.05,
      metalness: 0,
      transmission: 0.95,
      thickness: 0.4,
      ior: 1.2,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      // Iridescent rim tint
      iridescence: 0.6,
      iridescenceIOR: 1.3,
      sheen: 0.4,
      sheenColor: new THREE.Color(0xff9ad1),
    });

    this.mesh = new THREE.InstancedMesh(geo, mat, MAX_BUBBLES);
    this.mesh.castShadow = false;
    this.mesh.frustumCulled = false;
    this.mesh.count = MAX_BUBBLES;

    // Hide all instances initially by scaling to 0.
    const m = new THREE.Matrix4();
    m.makeScale(0, 0, 0);
    for (let i = 0; i < MAX_BUBBLES; i++) {
      this.mesh.setMatrixAt(i, m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;

    this.particles = new Array(MAX_BUBBLES).fill(null).map(() => ({
      alive: false,
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      size: 1,
      age: 0,
      life: LIFETIME,
      popping: false,
      spin: Math.random() * Math.PI * 2,
    }));

    this._spawnAcc = 0;
    this._tmpMat = new THREE.Matrix4();
    this._tmpPos = new THREE.Vector3();
    this._tmpQuat = new THREE.Quaternion();
    this._tmpScale = new THREE.Vector3();
  }

  update(dt, zerble) {
    _windT += dt;
    // Spawn rate scales with cart speed — at rest, slow ambient drip; moving, full stream.
    const speed = Math.abs(zerble.speed);
    const rate = SPAWN_PER_SEC * (0.25 + Math.min(1, speed / 8) * 0.75);
    this._spawnAcc += rate * dt;

    while (this._spawnAcc >= 1) {
      this._spawnAcc -= 1;
      this._spawnOne(zerble);
    }

    // Update existing
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (!p.alive) continue;

      p.age += dt;

      if (p.popping) {
        const t = (p.age - p.popStart) / POP_SCALE_TIME;
        if (t >= 1) {
          p.alive = false;
          this._tmpMat.makeScale(0, 0, 0);
          this.mesh.setMatrixAt(i, this._tmpMat);
          continue;
        }
        const s = p.size * (1 - t) * (1 + t * 1.5);
        this._writeInstance(i, p.pos, s, p.spin);
        continue;
      }

      if (p.age >= p.life) {
        p.popping = true;
        p.popStart = p.age;
        continue;
      }

      // Physics: gentle buoyancy + wandering wind + per-bubble jitter
      p.vel.y += (BUOYANCY + GRAVITY) * dt;
      const wind = sampleWind(_windT + i * 0.13);
      // Per-bubble jitter (each bubble has its own swirl frequency)
      const jitterX = Math.sin(p.age * (1.4 + (i % 7) * 0.2) + i) * 1.6;
      const jitterZ = Math.cos(p.age * (1.1 + (i % 5) * 0.27) + i * 1.3) * 1.6;
      p.vel.x += (wind.x + jitterX) * dt;
      p.vel.z += (wind.z + jitterZ) * dt;

      // Light damping so they can build up some drift but not race off
      p.vel.multiplyScalar(Math.pow(0.85, dt * 60));

      p.pos.addScaledVector(p.vel, dt);
      p.spin += dt * 0.5;

      // Pop on ground
      if (p.pos.y < 0.2) {
        p.popping = true;
        p.popStart = p.age;
      }

      this._writeInstance(i, p.pos, p.size, p.spin);
    }

    this.mesh.instanceMatrix.needsUpdate = true;
  }

  _spawnOne(zerble) {
    // Find a dead slot
    let idx = -1;
    for (let i = 0; i < this.particles.length; i++) {
      if (!this.particles[i].alive) {
        idx = i;
        break;
      }
    }
    if (idx === -1) return;

    const p = this.particles[idx];
    p.alive = true;
    p.popping = false;
    p.age = 0;
    p.life = LIFETIME * (0.7 + Math.random() * 0.6);
    p.size = 0.7 + Math.random() * 1.3;
    p.pos.copy(zerble.nozzleWorld);
    p.pos.x += (Math.random() - 0.5) * 0.15;
    p.pos.z += (Math.random() - 0.5) * 0.15;

    // Initial velocity: launched up-and-behind from the cart
    const back = zerble.forwardWorld.clone().multiplyScalar(-1);
    p.vel.set(back.x * 1.6, 1.5 + Math.random() * 0.8, back.z * 1.6);
    p.vel.x += (Math.random() - 0.5) * 0.5;
    p.vel.z += (Math.random() - 0.5) * 0.5;

    p.spin = Math.random() * Math.PI * 2;

    this._writeInstance(idx, p.pos, p.size, p.spin);
  }

  _writeInstance(i, pos, scale, spin) {
    this._tmpPos.copy(pos);
    this._tmpQuat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), spin);
    this._tmpScale.setScalar(scale);
    this._tmpMat.compose(this._tmpPos, this._tmpQuat, this._tmpScale);
    this.mesh.setMatrixAt(i, this._tmpMat);
  }

  // Iterate live bubbles — used by crowd to detect nearby bubbles.
  forEachAlive(cb) {
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (p.alive && !p.popping) cb(p);
    }
  }
}
