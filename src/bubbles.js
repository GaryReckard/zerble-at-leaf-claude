// Bubble particle system. InstancedMesh of transmissive spheres with simple physics.

import * as THREE from 'three';
import { PERF } from './perf.js';

// Pool size is tier-aware (see PERF.bubblePoolMax). The previous fixed 200
// was already saturated at normal play — every G-key blast just churned
// existing bubbles instead of producing a denser cloud. High tier now sees
// 600 so blast mode actually reads as a visible fountain.
const MAX_BUBBLES = PERF.bubblePoolMax || 200;
const SPAWN_PER_SEC = 40;
const GRAVITY = -0.45;
const BUOYANCY = 1.0;
const LIFETIME = 22;     // ~2.75x the original 8s — bubbles linger long enough to feel like a trail
const POP_SCALE_TIME = 0.25;

// Reused across every _writeInstance call — avoids a Vector3 allocation per live bubble per frame.
const _AXIS_Y = new THREE.Vector3(0, 1, 0);

// Slowly varying global wind so all bubbles drift coherently most of the time.
// Amplitudes are tuned so bubbles travel several meters from spawn before popping.
let _windT = 0;
function sampleWind(t) {
  return {
    x: Math.sin(t * 0.21) * 2.4 + Math.cos(t * 0.07) * 1.6 + Math.sin(t * 0.43) * 0.8,
    z: Math.cos(t * 0.18) * 2.4 + Math.sin(t * 0.05) * 1.6 + Math.cos(t * 0.37) * 0.8,
  };
}

export class Bubbles {
  constructor() {
    const geo = new THREE.IcosahedronGeometry(0.11, 1); // about half the previous size

    // Fancy material — full physical (transmission, iridescence, sheen).
    // Built once here so adaptive downgrades never trigger a shader compile.
    this._fancyMat = new THREE.MeshPhysicalMaterial({
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
      // No emissive — bubbles stay transparent. At night the iridescence/sheen
      // ramps up in update() to give a glint effect instead of white blobs.
      emissive: 0x000000,
      emissiveIntensity: 0,
    });

    // Cheap material — plain Standard (no transmission/iridescence). Pre-built
    // here so setCheapMaterial() just swaps a reference with zero allocation.
    this._cheapMat = new THREE.MeshStandardMaterial({
      color: 0xd0eeff,
      roughness: 0.1,
      metalness: 0.25,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.InstancedMesh(geo, this._fancyMat, MAX_BUBBLES);
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
      // Personality, assigned at spawn:
      //   0 = follower (mostly the global wind, tiny jitter)
      //   1 = wanderer (ignores wind, strong own-drift)
      //   2 = spinner  (corkscrew motion around a vertical axis)
      //   3 = sprinter (high initial outward kick, then slows)
      kind: 0,
      // Per-bubble unique drift direction (for wanderers/sprinters)
      driftX: 0,
      driftZ: 0,
      driftMag: 0,
      // Per-bubble spinner phase + radius
      swirlPhase: 0,
      swirlRate: 0,
      swirlRadius: 0,
    }));

    this._spawnAcc = 0;
    this._tmpMat = new THREE.Matrix4();
    this._tmpPos = new THREE.Vector3();
    this._tmpQuat = new THREE.Quaternion();
    this._tmpScale = new THREE.Vector3();

    // Blast mode — when on, spawn rate is multiplied by BLAST_MULT for a
    // dramatic bubble fountain. Toggled per-frame from main.js based on the
    // G key. ~2.8× sits between the requested 2-3×.
    this.blastMode = false;
  }

  setBlast(on) {
    this.blastMode = !!on;
  }

  // Called by main.js via the AdaptiveQuality onLevelChange hook.
  // Swaps between the pre-built fancy (MeshPhysical) and cheap (MeshStandard)
  // materials with zero allocation — no shader compile mid-frame.
  setCheapMaterial(on) {
    this.mesh.material = on ? this._cheapMat : this._fancyMat;
  }

  // dt: frame delta. zerble: cart for spawn pose. nightness: 0..1 from the
  // time-of-day system — bubbles emit more light at night so they pick up
  // the festival glow instead of going invisible.
  update(dt, zerble, nightness = 0) {
    // Nightness ramp only applies to the fancy material — cheap Standard doesn't
    // have iridescence/sheen properties and they'd be silently ignored anyway.
    if (this.mesh.material === this._fancyMat) {
      this._fancyMat.iridescence    = THREE.MathUtils.lerp(0.2, 0.85, nightness);
      this._fancyMat.iridescenceIOR = THREE.MathUtils.lerp(1.3, 1.7, nightness);
      this._fancyMat.sheen          = THREE.MathUtils.lerp(0.0, 0.6, nightness);
      this._fancyMat.sheenColor.setHex(0xffffff);
    }
    _windT += dt;
    // Spawn rate scales with cart speed — at rest, slow ambient drip; moving, full stream.
    // Blast mode (G key) multiplies the rate ~2.8× regardless of speed for
    // an extra-thick bubble fountain.
    const speed = Math.abs(zerble.speed);
    const BLAST_MULT = 2.8;
    const blast = this.blastMode ? BLAST_MULT : 1.0;
    const rate = SPAWN_PER_SEC * (0.55 + Math.min(1, speed / 8) * 0.45) * blast;
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

      // Physics: gentle buoyancy + per-bubble personality forces
      p.vel.y += (BUOYANCY + GRAVITY) * dt;
      const wind = sampleWind(_windT + i * 0.13);

      switch (p.kind) {
        case 0: {
          // FOLLOWER — full wind + small jitter
          const jitterX = Math.sin(p.age * (1.4 + (i % 7) * 0.2) + i) * 1.2;
          const jitterZ = Math.cos(p.age * (1.1 + (i % 5) * 0.27) + i * 1.3) * 1.2;
          p.vel.x += (wind.x + jitterX) * dt;
          p.vel.z += (wind.z + jitterZ) * dt;
          break;
        }
        case 1: {
          // WANDERER — mostly ignores wind, has its own steady drift
          p.vel.x += (p.driftX * p.driftMag + wind.x * 0.1) * dt;
          p.vel.z += (p.driftZ * p.driftMag + wind.z * 0.1) * dt;
          // Small chaotic shudder
          p.vel.x += Math.sin(p.age * 3 + i) * 1.6 * dt;
          p.vel.z += Math.cos(p.age * 2.4 + i * 1.7) * 1.6 * dt;
          break;
        }
        case 2: {
          // SPINNER — corkscrew motion. Add a tangential force in a rotating direction.
          p.swirlPhase += p.swirlRate * dt;
          const tangX = -Math.sin(p.swirlPhase);
          const tangZ = Math.cos(p.swirlPhase);
          const swirlMag = p.swirlRadius * Math.abs(p.swirlRate);
          p.vel.x += (tangX * swirlMag + wind.x * 0.3) * dt;
          p.vel.z += (tangZ * swirlMag + wind.z * 0.3) * dt;
          // Boost upward a touch — spinners rise faster
          p.vel.y += 0.4 * dt;
          break;
        }
        case 3: {
          // SPRINTER — strong initial kick, decays. After 1s, behaves like a wanderer.
          const burst = Math.max(0, 1 - p.age);
          p.vel.x += (p.driftX * p.driftMag * 2 * burst + wind.x * 0.4) * dt;
          p.vel.z += (p.driftZ * p.driftMag * 2 * burst + wind.z * 0.4) * dt;
          break;
        }
      }

      // Per-personality damping — wanderers/sprinters keep momentum longer
      const dampingExp = p.kind === 0 ? 0.92 : (p.kind === 3 ? 0.96 : 0.95);
      p.vel.multiplyScalar(Math.pow(dampingExp, dt * 60));

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

    // Roll a personality
    const r = Math.random();
    if (r < 0.55) p.kind = 0;       // follower (most bubbles)
    else if (r < 0.78) p.kind = 1;  // wanderer
    else if (r < 0.92) p.kind = 2;  // spinner
    else p.kind = 3;                // sprinter

    // Per-bubble random drift direction (used by wanderer/sprinter)
    const ang = Math.random() * Math.PI * 2;
    p.driftX = Math.cos(ang);
    p.driftZ = Math.sin(ang);
    p.driftMag = 2 + Math.random() * 3;

    // Spinner config
    p.swirlPhase = Math.random() * Math.PI * 2;
    p.swirlRate = (Math.random() < 0.5 ? 1 : -1) * (3 + Math.random() * 3);
    p.swirlRadius = 0.3 + Math.random() * 0.6;

    // Initial velocity: launched straight out the back, mostly horizontal
    const back = zerble.forwardWorld.clone().multiplyScalar(-1);
    p.vel.set(back.x * 2.6, 0.3 + Math.random() * 0.5, back.z * 2.6);
    p.vel.x += (Math.random() - 0.5) * 1.2;
    p.vel.z += (Math.random() - 0.5) * 1.2;
    p.vel.y += (Math.random() - 0.5) * 0.4;

    p.spin = Math.random() * Math.PI * 2;

    this._writeInstance(idx, p.pos, p.size, p.spin);
  }

  _writeInstance(i, pos, scale, spin) {
    this._tmpPos.copy(pos);
    this._tmpQuat.setFromAxisAngle(_AXIS_Y, spin);
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
