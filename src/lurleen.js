// Lurleen — Zerble's love interest. A second anthropomorphic golf cart with
// pink puffy lips, googly eyes, flowing raffia/flower hair, and a small basket
// where the back seat would be.
//
// Spawned at a deterministic location far from origin so the player has to
// drive to find her. She wanders within ~60m of her spawn point. When Zerble
// gets within AWARE_RANGE, clusters of pink hearts erupt and she enters a
// brief "aware" pause, then transitions to "following" — driving after Zerble
// at FOLLOW_DIST. If Zerble drives off too far, she gives up and goes back
// to wandering.

import * as THREE from 'three';
import { registry } from './registry.js';

const SPAWN_POS = new THREE.Vector3(240, 0, 260);   // ~360m from origin, 3 chunks NE
const HOME_RADIUS = 55;
const AWARE_RANGE = 28;
const FORGET_RANGE = AWARE_RANGE * 3;
const FOLLOW_DIST = 11;
const SPEED_MAX = 4.5;
const ACCEL = 6.0;
const TURN_RATE = 1.6;
const HEART_LIFETIME = 2.4;
const HEART_INTERVAL_AWARE = 0.18;
const HEART_INTERVAL_FOLLOW = 0.55;

export class Lurleen {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    this.root.name = 'Lurleen';

    this.position = SPAWN_POS.clone();
    this.heading = Math.PI;          // facing -z initially
    this.speed = 0;
    this.steerAngle = 0;
    this.radius = 1.9;

    this.state = 'wandering';
    this.wanderTarget = SPAWN_POS.clone();
    this.wanderTimer = 0;
    this.heartTimer = 0;
    this.awareTimer = 0;
    this.homePos = SPAWN_POS.clone();
    this.eyes = [];

    this._buildBody();
    this._buildLips();
    this._buildEyes();
    this._buildHair();
    this._buildBasket();

    // Heart particles live in scene-space (not Lurleen's local space) so they
    // rise straight up rather than getting dragged along by her motion.
    this._heartGroup = new THREE.Group();
    this._heartGroup.name = 'LurleenHearts';
    scene.add(this._heartGroup);
    this._activeHearts = [];

    this.root.position.copy(this.position);
    this.root.rotation.y = this.heading;
    scene.add(this.root);

    // Collider so Zerble bumps off her instead of driving through. Damage=0:
    // she's a friend, not an obstacle in the painful sense.
    this._registryId = registry.add({
      kind: 'lurleen',
      position: this.position,    // mutated each frame; registry holds the reference
      footprint: 2.0,
      collider: { radius: 2.0, damage: 0 },
    });
  }

  // ---------- Body ----------

  _buildBody() {
    const chassisMat = new THREE.MeshStandardMaterial({
      color: 0xffb3d9, roughness: 0.6, flatShading: true,
    });
    const chassis = new THREE.Mesh(
      new THREE.BoxGeometry(2.0, 1.0, 3.0, 2, 1, 2),
      chassisMat,
    );
    chassis.position.y = 0.7;
    chassis.castShadow = true;
    this.root.add(chassis);

    // Roof — bright yellow/gold base; hair drapes over it from above.
    const roofMat = new THREE.MeshStandardMaterial({
      color: 0xffe066, roughness: 0.95, flatShading: true,
    });
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(2.1, 0.15, 1.9),
      roofMat,
    );
    roof.position.set(0, 2.0, -0.5);
    roof.castShadow = true;
    this.root.add(roof);

    // Roof posts
    const postMat = new THREE.MeshStandardMaterial({
      color: 0x2a1f3a, roughness: 0.7, flatShading: true,
    });
    for (const [px, pz] of [[-0.95, 0.3], [0.95, 0.3], [-0.95, -1.3], [0.95, -1.3]]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.3, 6), postMat);
      post.position.set(px, 1.4, pz);
      this.root.add(post);
    }

    // Wheels — slightly skinnier than Zerble's monster-truck wheels
    this._wheels = [];
    for (const [wx, wz] of [[-0.95, 1.0], [0.95, 1.0], [-0.95, -1.0], [0.95, -1.0]]) {
      const wheel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.42, 0.42, 0.30, 12),
        new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.95, flatShading: true }),
      );
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(wx, 0.42, wz);
      wheel.castShadow = true;
      this.root.add(wheel);
      this._wheels.push({ mesh: wheel, baseY: 0.42, front: wz < 0 });
    }
  }

  // ---------- Lips — pink puffy pillow with a horizontal seam ----------

  _buildLips() {
    const lipMat = new THREE.MeshStandardMaterial({
      color: 0xff3a8c,
      emissive: 0xff1a6e,
      emissiveIntensity: 0.30,
      roughness: 0.4,
    });

    const lipGroup = new THREE.Group();
    const fill = new THREE.Mesh(new THREE.SphereGeometry(0.5, 18, 10), lipMat);
    fill.scale.set(1.55, 0.42, 0.55);
    fill.castShadow = true;
    lipGroup.add(fill);

    // Horizontal seam separating upper/lower lip
    const seam = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 0.04, 0.06),
      new THREE.MeshStandardMaterial({ color: 0x991133, roughness: 0.9 }),
    );
    seam.position.set(0, 0, -0.32);
    lipGroup.add(seam);

    lipGroup.position.set(0, 1.05, -1.55);
    this.root.add(lipGroup);
  }

  // ---------- Eyes — googly with eyelashes ----------

  _buildEyes() {
    for (const ex of [-0.78, 0.78]) {
      const eye = new THREE.Group();
      eye.position.set(ex, 2.20, -1.50);

      const sclera = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.68, 2),
        new THREE.MeshStandardMaterial({
          color: 0xffffff,
          emissive: 0xfff0e0,
          emissiveIntensity: 0.45,
          roughness: 0.25,
        }),
      );
      eye.add(sclera);

      // Purple iris for distinction from Zerble's blue.
      const iris = new THREE.Mesh(
        new THREE.SphereGeometry(0.40, 16, 12),
        new THREE.MeshStandardMaterial({
          color: 0x9966ff,
          emissive: 0x6633cc,
          emissiveIntensity: 0.25,
          roughness: 0.3,
        }),
      );
      iris.position.z = -0.42;
      eye.add(iris);

      const pupil = new THREE.Mesh(
        new THREE.SphereGeometry(0.30, 14, 12),
        new THREE.MeshStandardMaterial({
          color: 0x000000,
          roughness: 1,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        }),
      );
      pupil.position.z = -0.78;
      eye.add(pupil);

      // Eyelashes — small black cones fanned above the eye
      const lashMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9 });
      for (let k = -2; k <= 2; k++) {
        const lash = new THREE.Mesh(
          new THREE.ConeGeometry(0.035, 0.30, 5),
          lashMat,
        );
        lash.position.set(k * 0.16, 0.58, -0.40);
        // Tilt outward (radial from eye top) and slightly forward
        lash.rotation.x = -0.45;
        lash.rotation.z = -k * 0.18;
        eye.add(lash);
      }

      this.root.add(eye);
      this.eyes.push({ root: eye, pupil, iris, basePos: eye.position.clone() });
    }
  }

  // ---------- Hair — raffia strands + a few flowers ----------

  _buildHair() {
    const goldHair = new THREE.MeshStandardMaterial({ color: 0xd8b878, roughness: 0.95, flatShading: true });
    const brownHair = new THREE.MeshStandardMaterial({ color: 0xa07840, roughness: 0.95, flatShading: true });

    // Drape strands over the front edge of the roof, hanging down.
    const strandCount = 90;
    for (let i = 0; i < strandCount; i++) {
      const t = i / (strandCount - 1);
      const xLocal = -1.0 + t * 2.0 + (Math.random() - 0.5) * 0.05;
      const zLocal = 0.35 + (Math.random() - 0.5) * 0.25;     // along the roof front edge
      const len = 0.55 + Math.random() * 0.35;
      const cone = new THREE.ConeGeometry(0.022, len, 5, 1);
      cone.translate(0, -len / 2, 0);                          // base at origin, tip hangs down

      const strand = new THREE.Mesh(cone, i % 2 === 0 ? goldHair : brownHair);
      strand.position.set(xLocal, 1.96, zLocal);
      // Slight outward fan + jitter so strands aren't perfectly vertical
      strand.rotation.x = -0.15 + (Math.random() - 0.5) * 0.5;
      strand.rotation.z = (Math.random() - 0.5) * 0.45;
      strand.castShadow = true;
      this.root.add(strand);
    }

    // Flower crown along the top of the roof
    const flowerColors = [0xff4d8a, 0xff9933, 0x9966ff, 0x66ccff, 0xffee33, 0xff6f6f];
    for (let i = 0; i < 8; i++) {
      const x = -0.9 + (i / 7) * 1.8;
      const flower = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.10, 0),
        new THREE.MeshStandardMaterial({
          color: flowerColors[i % flowerColors.length],
          emissive: flowerColors[i % flowerColors.length],
          emissiveIntensity: 0.45,
          roughness: 0.4,
        }),
      );
      flower.position.set(x, 2.10, -0.5 + (i % 2) * 0.3);
      this.root.add(flower);
    }
  }

  // ---------- Basket (no back seat) ----------

  _buildBasket() {
    const wickerMat = new THREE.MeshStandardMaterial({
      color: 0x8b6f47, roughness: 0.95, flatShading: true,
    });
    const basket = new THREE.Mesh(
      new THREE.BoxGeometry(1.3, 0.55, 0.85),
      wickerMat,
    );
    basket.position.set(0, 1.1, 1.1);
    basket.castShadow = true;
    this.root.add(basket);

    const handle = new THREE.Mesh(
      new THREE.TorusGeometry(0.38, 0.04, 6, 14, Math.PI),
      wickerMat,
    );
    handle.position.set(0, 1.40, 1.1);
    handle.rotation.x = -Math.PI / 2;
    this.root.add(handle);
  }

  // ---------- Update ----------

  update(dt, zerblePos) {
    const dx = zerblePos.x - this.position.x;
    const dz = zerblePos.z - this.position.z;
    const dToZerble = Math.hypot(dx, dz);

    // State machine
    if (this.state === 'wandering') {
      if (dToZerble < AWARE_RANGE) {
        this.state = 'aware';
        this.awareTimer = 1.4;
        this.heartTimer = 0;
        // Burst of hearts immediately when first spotted
        this._burstHearts(7);
      }
      this._wander(dt);
    } else if (this.state === 'aware') {
      this.awareTimer -= dt;
      this._emitHearts(dt, /*intense=*/true);
      // Slow to a stop, face Zerble.
      this.speed *= Math.pow(0.5, dt * 4);
      this._faceToward(dt, dx, dz);
      if (this.awareTimer <= 0) {
        this.state = 'following';
      }
    } else if (this.state === 'following') {
      this._emitHearts(dt, /*intense=*/false);
      this._followZerble(dt, dx, dz, dToZerble);
      if (dToZerble > FORGET_RANGE) {
        // Zerble bailed — go back to wandering near current spot.
        this.state = 'wandering';
        this.homePos.copy(this.position);
        this.wanderTimer = 0;
      }
    }

    // Apply movement: forward = (-sin(h), 0, -cos(h)) — same convention as Zerble.
    this.position.x += -Math.sin(this.heading) * this.speed * dt;
    this.position.z += -Math.cos(this.heading) * this.speed * dt;
    this.root.position.copy(this.position);
    this.root.rotation.y = this.heading;

    // Wheel anim: spin proportional to speed, front wheels steer.
    for (const w of this._wheels) {
      w.mesh.rotation.x += this.speed * dt * 1.5;
      if (w.front) {
        w.mesh.rotation.y = THREE.MathUtils.lerp(w.mesh.rotation.y, this.steerAngle, Math.min(1, dt * 10));
      }
      w.mesh.position.y = w.baseY + Math.sin(performance.now() * 0.01 + w.mesh.position.x) * 0.02;
    }

    // Eye wobble
    const t = performance.now() * 0.001;
    for (const eye of this.eyes) {
      eye.root.position.y = eye.basePos.y + Math.sin(t * 1.4 + eye.basePos.x) * 0.05;
      eye.pupil.position.z = -0.78 + Math.sin(t * 0.9) * 0.05;
      eye.pupil.position.x = Math.sin(t * 0.5) * 0.06;
    }

    this._updateHearts(dt);
  }

  // ---------- Driving primitives ----------

  _wander(dt) {
    this.wanderTimer -= dt;
    if (this.wanderTimer <= 0) {
      const ang = Math.random() * Math.PI * 2;
      const r = Math.random() * HOME_RADIUS * 0.7;
      this.wanderTarget.set(
        this.homePos.x + Math.cos(ang) * r,
        0,
        this.homePos.z + Math.sin(ang) * r,
      );
      this.wanderTimer = 9 + Math.random() * 8;
    }
    this._driveToward(dt, this.wanderTarget.x, this.wanderTarget.z, 0.6);
  }

  _followZerble(dt, dx, dz, dToZerble) {
    if (dToZerble < FOLLOW_DIST) {
      // Maintain follow distance — coast.
      this.speed *= Math.pow(0.5, dt * 3);
      this._faceToward(dt, dx, dz);
      return;
    }
    const inv = 1 / (dToZerble || 1);
    const reachX = this.position.x + dx * inv * (dToZerble - FOLLOW_DIST);
    const reachZ = this.position.z + dz * inv * (dToZerble - FOLLOW_DIST);
    this._driveToward(dt, reachX, reachZ, 1.0);
  }

  _faceToward(dt, dx, dz) {
    const dist = Math.hypot(dx, dz) || 1;
    const target = Math.atan2(-dx / dist, -dz / dist);
    let diff = target - this.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.heading += Math.sign(diff) * Math.min(Math.abs(diff), TURN_RATE * dt);
    this.steerAngle = THREE.MathUtils.clamp(diff * 1.5, -0.5, 0.5);
  }

  _driveToward(dt, tx, tz, speedScale) {
    const ddx = tx - this.position.x;
    const ddz = tz - this.position.z;
    const dist = Math.hypot(ddx, ddz);
    if (dist < 1.0) {
      this.speed *= Math.pow(0.5, dt * 3);
      this.steerAngle *= 0.9;
      return;
    }
    const targetHeading = Math.atan2(-ddx / dist, -ddz / dist);
    let diff = targetHeading - this.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.heading += Math.sign(diff) * Math.min(Math.abs(diff), TURN_RATE * dt);
    this.steerAngle = THREE.MathUtils.clamp(diff * 1.5, -0.5, 0.5);

    // Accelerate when roughly aligned with target heading; coast when turning.
    const aligned = Math.cos(diff);
    if (aligned > 0.4) {
      this.speed = Math.min(SPEED_MAX * speedScale, this.speed + ACCEL * dt);
    } else {
      this.speed *= Math.pow(0.5, dt * 2);
    }
  }

  // ---------- Hearts ----------

  _emitHearts(dt, intense) {
    this.heartTimer -= dt;
    if (this.heartTimer > 0) return;
    this.heartTimer = intense ? HEART_INTERVAL_AWARE : HEART_INTERVAL_FOLLOW;
    this._burstHearts(intense ? 3 : 1);
  }

  _burstHearts(n) {
    for (let i = 0; i < n; i++) this._spawnHeart();
  }

  _spawnHeart() {
    // Simple "heart" — pink emissive sphere. Reading as a heart at a glance is
    // enough at this scale; the cluster + upward float carries the meaning.
    const mat = new THREE.MeshStandardMaterial({
      color: 0xff4d8a,
      emissive: 0xff2266,
      emissiveIntensity: 1.6,
      transparent: true,
      opacity: 1,
    });
    const heart = new THREE.Mesh(new THREE.IcosahedronGeometry(0.18, 0), mat);
    heart.position.set(
      this.position.x + (Math.random() - 0.5) * 1.4,
      2.4 + Math.random() * 0.4,
      this.position.z + (Math.random() - 0.5) * 1.4,
    );
    heart.userData = {
      age: 0,
      vy: 1.4 + Math.random() * 0.7,
      vx: (Math.random() - 0.5) * 0.6,
      vz: (Math.random() - 0.5) * 0.6,
    };
    this._heartGroup.add(heart);
    this._activeHearts.push(heart);
  }

  _updateHearts(dt) {
    for (let i = this._activeHearts.length - 1; i >= 0; i--) {
      const h = this._activeHearts[i];
      h.userData.age += dt;
      if (h.userData.age >= HEART_LIFETIME) {
        this._heartGroup.remove(h);
        h.geometry.dispose();
        h.material.dispose();
        this._activeHearts.splice(i, 1);
        continue;
      }
      h.position.x += h.userData.vx * dt;
      h.position.y += h.userData.vy * dt;
      h.position.z += h.userData.vz * dt;
      h.userData.vy *= Math.pow(0.5, dt * 0.4);    // gentle slowdown
      const fade = 1 - h.userData.age / HEART_LIFETIME;
      h.material.opacity = fade;
      h.scale.setScalar(1 + h.userData.age * 0.4);
      h.rotation.y += dt * 2.0;
    }
  }
}
