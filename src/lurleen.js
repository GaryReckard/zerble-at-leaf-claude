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

// Heart shape — extruded 2D heart using THREE.Shape. Centered at origin.
// Used for Lurleen's heart particles. Exported so the sandbox can preview.
export function createHeartGeometry() {
  const shape = new THREE.Shape();
  // Standard three.js heart construction. Coordinates are pre-centered so the
  // resulting geometry has its visual center at (0, 0).
  const x = -0.5;
  const y = -0.95;
  shape.moveTo(x + 0.5, y + 0.5);
  shape.bezierCurveTo(x + 0.5, y + 0.5, x + 0.4, y, x, y);
  shape.bezierCurveTo(x - 0.6, y, x - 0.6, y + 0.7, x - 0.6, y + 0.7);
  shape.bezierCurveTo(x - 0.6, y + 1.1, x - 0.3, y + 1.54, x + 0.5, y + 1.9);
  shape.bezierCurveTo(x + 1.2, y + 1.54, x + 1.6, y + 1.1, x + 1.6, y + 0.7);
  shape.bezierCurveTo(x + 1.6, y + 0.7, x + 1.6, y, x + 1, y);
  shape.bezierCurveTo(x + 0.7, y, x + 0.5, y + 0.5, x + 0.5, y + 0.5);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.18,
    bevelEnabled: true,
    bevelSegments: 2,
    bevelSize: 0.05,
    bevelThickness: 0.05,
    curveSegments: 8,
  });
  geo.center();
  // Heart is built "right-side up" but ExtrudeGeometry leaves it oriented
  // with the +Z face forward. Flip vertically so the point hangs DOWN like
  // a heart should when seen face-on.
  geo.rotateZ(Math.PI);
  geo.scale(0.18, 0.18, 0.18);   // tune to roughly match previous sphere size
  return geo;
}

// Shared heart geometry — cheap to clone refs across particles.
const _heartGeo = createHeartGeometry();

const SPAWN_POS = new THREE.Vector3(240, 0, 260);   // ~360m from origin, 3 chunks NE
const HOME_RADIUS = 55;
const AWARE_RANGE = 28;
const FORGET_RANGE = AWARE_RANGE * 3;
const FOLLOW_DIST = 11;
const SPEED_MAX = 16.0;    // close to Zerble's 18 — fast enough to keep up
const ACCEL = 18.0;
const TURN_RATE = 3.0;
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

  // ---------- Lips — plump pink pillow with a horizontal seam ----------
  // Taller, fuller, more prominent than v1. Reference: large fabric/plush
  // lips stretched across the windshield front.

  _buildLips() {
    const lipMat = new THREE.MeshStandardMaterial({
      color: 0xff3580,
      emissive: 0xff1466,
      emissiveIntensity: 0.30,
      roughness: 0.5,
    });

    const lipGroup = new THREE.Group();
    // Upper lobe + lower lobe stacked vertically gives the cupid's-bow shape.
    const upper = new THREE.Mesh(new THREE.SphereGeometry(0.45, 22, 12), lipMat);
    upper.scale.set(1.7, 0.55, 0.7);
    upper.position.y = 0.18;
    upper.castShadow = true;
    lipGroup.add(upper);

    const lower = new THREE.Mesh(new THREE.SphereGeometry(0.45, 22, 12), lipMat);
    lower.scale.set(1.85, 0.65, 0.75);   // lower lip a bit bigger
    lower.position.y = -0.20;
    lower.castShadow = true;
    lipGroup.add(lower);

    // Horizontal seam in the middle
    const seam = new THREE.Mesh(
      new THREE.BoxGeometry(1.55, 0.04, 0.06),
      new THREE.MeshStandardMaterial({ color: 0x88112c, roughness: 0.9 }),
    );
    seam.position.set(0, 0, -0.45);
    lipGroup.add(seam);

    lipGroup.position.set(0, 1.10, -1.65);
    this.root.add(lipGroup);
  }

  // ---------- Eyes — flat googly stickers on the windshield ----------
  // Reference photo: two large flat circles stuck on the windshield (white
  // outer ring + freely-rolling black pupil disc inside). NOT 3D globes —
  // they read as eye stickers, not real eyes. The pupil wobbles inside the
  // sclera disc for the classic googly-eye effect.

  _buildEyes() {
    const scleraMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xffffff,
      emissiveIntensity: 0.10,
      roughness: 0.4,
    });
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0x111111,
      roughness: 0.7,
    });
    const pupilMat = new THREE.MeshStandardMaterial({
      color: 0x080808,
      roughness: 0.9,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const lashMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });

    for (const ex of [-0.78, 0.78]) {
      const eye = new THREE.Group();
      eye.position.set(ex, 2.05, -1.62);
      // Eye faces forward (cart-local -Z). CircleGeometry's normal is +Z by
      // default, so flip the eye group 180° around Y.
      eye.rotation.y = Math.PI;

      // White flat disc — the "sclera sticker"
      const sclera = new THREE.Mesh(
        new THREE.CircleGeometry(0.50, 32),
        scleraMat,
      );
      eye.add(sclera);

      // Thin dark outline ring around the sclera — sells the sticker look
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.48, 0.52, 32),
        ringMat,
      );
      ring.position.z = 0.005;
      eye.add(ring);

      // Pupil — flat black disc that wobbles around inside the sclera. Held
      // in its own group so we can pan it within the sclera circle.
      const pupilGroup = new THREE.Group();
      const pupil = new THREE.Mesh(
        new THREE.CircleGeometry(0.20, 28),
        pupilMat,
      );
      pupil.position.z = 0.02;     // sit on top of sclera
      pupilGroup.add(pupil);
      // Subtle highlight (small white circle on the pupil's upper-left)
      const highlight = new THREE.Mesh(
        new THREE.CircleGeometry(0.05, 16),
        new THREE.MeshStandardMaterial({
          color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.6, roughness: 0.2,
          polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
        }),
      );
      highlight.position.set(-0.06, 0.07, 0.025);
      pupilGroup.add(highlight);
      eye.add(pupilGroup);

      // Eyelashes — three small black cones along the top of the sclera,
      // fanned outward. Cone default is +Y axis; we set rotation.x to point
      // up-and-out from the eye.
      for (let k = -1; k <= 1; k++) {
        const lash = new THREE.Mesh(
          new THREE.ConeGeometry(0.035, 0.30, 5),
          lashMat,
        );
        // Position above the sclera; CircleGeometry is in XY plane.
        lash.position.set(k * 0.20, 0.46, 0.005);
        // Tilt upward and slightly outward from center
        lash.rotation.x = -0.25;
        lash.rotation.z = -k * 0.18;
        eye.add(lash);
      }

      this.root.add(eye);
      this.eyes.push({ root: eye, pupil: pupilGroup, basePos: eye.position.clone() });
    }
  }

  // ---------- Hair — raffia strands wrapping the whole roof + flower crown ----------
  // Reference photo: long fringe of raffia hanging down all four sides of the
  // roof, gathered into bunches/parts in a few places, with a row of small
  // bright flowers along the top edge. Builds the perimeter as four runs (front,
  // back, left, right), each laying strands along its edge.

  _buildHair() {
    const goldHair = new THREE.MeshStandardMaterial({ color: 0xd8b878, roughness: 0.95, flatShading: true });
    const brownHair = new THREE.MeshStandardMaterial({ color: 0xa07840, roughness: 0.95, flatShading: true });
    const lightHair = new THREE.MeshStandardMaterial({ color: 0xe6c98c, roughness: 0.95, flatShading: true });

    // Roof outline (matches `roof` geometry built in _buildBody — 2.1 wide, 1.9 deep, centered at z=-0.5)
    const halfW = 1.05;
    const halfD = 0.95;
    const roofZ = -0.5;
    const hairY = 1.94;     // sits flush against the roof bottom edge

    // Bunches: at these normalized angles around the roof, density is x2 and
    // strands are longer. Creates the gathered "parts" the user asked about.
    const bunchCenters = [0.0, 0.25, 0.50, 0.75];   // front, right, back, left midpoints
    function bunchBoost(u) {
      let m = 1.0;
      for (const c of bunchCenters) {
        const d = Math.min(Math.abs(u - c), 1 - Math.abs(u - c));
        if (d < 0.06) m += (1 - d / 0.06) * 1.6;     // up to ~2.6x at center
      }
      return m;
    }

    // Place strands along the rectangular perimeter — parameterized by u in [0,1)
    // walking clockwise from the front-center.
    function perimeterPoint(u) {
      // 4 sides, each takes 0.25 of u
      const side = Math.floor(u * 4);
      const t = (u * 4) - side;
      switch (side) {
        case 0: // front edge (-halfW, halfD)  →  (+halfW, halfD)
          return { x: -halfW + t * 2 * halfW, z: roofZ + halfD,
                   tangentX: 1, tangentZ: 0 };
        case 1: // right edge (+halfW, halfD)  →  (+halfW, -halfD)
          return { x: halfW, z: roofZ + halfD - t * 2 * halfD,
                   tangentX: 0, tangentZ: -1 };
        case 2: // back edge (+halfW, -halfD) →  (-halfW, -halfD)
          return { x: halfW - t * 2 * halfW, z: roofZ - halfD,
                   tangentX: -1, tangentZ: 0 };
        case 3: // left edge (-halfW, -halfD) →  (-halfW, halfD)
          return { x: -halfW, z: roofZ - halfD + t * 2 * halfD,
                   tangentX: 0, tangentZ: 1 };
      }
    }

    const baseCount = 220;       // base density walking the perimeter
    const samples = baseCount * 2;  // oversampled, density tapers via bunchBoost
    for (let i = 0; i < samples; i++) {
      const u = i / samples;
      const boost = bunchBoost(u);
      // Skip strands probabilistically based on boost — gives sparse base + dense bunches
      if (Math.random() > 0.45 * boost) continue;

      const p = perimeterPoint(u);
      // Jitter perpendicular to the edge tangent so strands fan out slightly
      const perpX = p.tangentZ;
      const perpZ = -p.tangentX;
      const jitter = (Math.random() - 0.5) * 0.08;
      const x = p.x + perpX * jitter + (Math.random() - 0.5) * 0.03;
      const z = p.z + perpZ * jitter + (Math.random() - 0.5) * 0.03;
      // Bunches have longer strands
      const len = (0.45 + Math.random() * 0.40) * (1 + (boost - 1) * 0.3);

      const cone = new THREE.ConeGeometry(0.020, len, 5, 1);
      cone.translate(0, -len / 2, 0);
      const matRoll = Math.random();
      const mat = matRoll < 0.4 ? goldHair : matRoll < 0.75 ? brownHair : lightHair;
      const strand = new THREE.Mesh(cone, mat);
      strand.position.set(x, hairY, z);
      // Drape outward over the roof edge: tilt away from the roof center in
      // the perpendicular direction.
      const outX = (x - 0) * 0.3;     // tilt outward in X based on position
      const outZ = (z - roofZ) * 0.3;
      strand.rotation.x = outZ * 0.6 + (Math.random() - 0.5) * 0.2;
      strand.rotation.z = -outX * 0.6 + (Math.random() - 0.5) * 0.2;
      strand.castShadow = true;
      this.root.add(strand);
    }

    // Flower crown along the top of the roof, with a couple at each bunch.
    const flowerColors = [0xff4d8a, 0xff9933, 0x9966ff, 0x66ccff, 0xffee33, 0xff6f6f, 0x66ff99];
    const flowerCount = 18;
    for (let i = 0; i < flowerCount; i++) {
      const u = i / flowerCount;
      const p = perimeterPoint(u);
      const flower = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.10 + Math.random() * 0.03, 0),
        new THREE.MeshStandardMaterial({
          color: flowerColors[i % flowerColors.length],
          emissive: flowerColors[i % flowerColors.length],
          emissiveIntensity: 0.5,
          roughness: 0.4,
        }),
      );
      // Sit slightly inside the perimeter on top of the roof
      const inset = 0.08;
      const cx = p.x - p.tangentZ * inset * 0;      // edge stays
      const cz = p.z + p.tangentX * inset * 0;
      flower.position.set(cx, 2.10, cz);
      this.root.add(flower);
    }

    // A few "bows" — small colored ribbons gathered at each bunch as visual
    // accents (matches the bows in the reference photo).
    for (const u of bunchCenters) {
      const p = perimeterPoint(u);
      const bow = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.13, 0),
        new THREE.MeshStandardMaterial({ color: 0x66d9ff, roughness: 0.5, flatShading: true }),
      );
      bow.scale.set(1.4, 1.0, 0.6);
      bow.position.set(p.x, 1.85, p.z);
      this.root.add(bow);
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

    // Eye wobble — the flat pupil disc rolls around within the sclera circle,
    // staying clear of the rim. The wobble pattern is the same kind of small-
    // amplitude lissajous that real googly eyes do when shaken.
    const t = performance.now() * 0.001;
    for (const eye of this.eyes) {
      eye.root.position.y = eye.basePos.y + Math.sin(t * 1.4 + eye.basePos.x) * 0.04;
      // Pupil moves in a circle within the sclera. Sclera radius 0.5, pupil
      // radius 0.2, so max safe wobble = 0.5 - 0.2 - 0.04 = 0.26.
      eye.pupil.position.x = Math.sin(t * 0.9 + eye.basePos.x * 3) * 0.18;
      eye.pupil.position.y = Math.cos(t * 1.3 + eye.basePos.x * 2) * 0.14;
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

    // Speed scales with how aligned we are with the target direction — but
    // always at least a fraction of full speed so she can start moving while
    // still rotating to face the target. The previous `aligned > 0.4` gate
    // left her stuck at 0 speed during the initial turn-toward-Zerble.
    const aligned = Math.cos(diff);
    const driveFactor = Math.max(0.25, (aligned + 1) * 0.5);   // 0.25..1.0
    const target = SPEED_MAX * speedScale * driveFactor;
    if (this.speed < target) {
      this.speed = Math.min(target, this.speed + ACCEL * dt);
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
    // Heart-shaped extruded geometry, pink emissive material. Particles
    // billboard toward the camera each frame so the heart shape is always
    // readable.
    const mat = new THREE.MeshStandardMaterial({
      color: 0xff4d8a,
      emissive: 0xff2266,
      emissiveIntensity: 1.6,
      transparent: true,
      opacity: 1,
    });
    const heart = new THREE.Mesh(_heartGeo, mat);
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
      spinSign: Math.random() < 0.5 ? -1 : 1,
    };
    this._heartGroup.add(heart);
    this._activeHearts.push(heart);
  }

  _updateHearts(dt) {
    // Cache camera world position for billboarding (uses the live three.js
    // camera so hearts always face the player).
    const cam = window.__game?.camera;
    for (let i = this._activeHearts.length - 1; i >= 0; i--) {
      const h = this._activeHearts[i];
      h.userData.age += dt;
      if (h.userData.age >= HEART_LIFETIME) {
        this._heartGroup.remove(h);
        // Heart geometry is shared; only dispose the material.
        h.material.dispose();
        this._activeHearts.splice(i, 1);
        continue;
      }
      h.position.x += h.userData.vx * dt;
      h.position.y += h.userData.vy * dt;
      h.position.z += h.userData.vz * dt;
      h.userData.vy *= Math.pow(0.5, dt * 0.4);
      const fade = 1 - h.userData.age / HEART_LIFETIME;
      h.material.opacity = fade;
      h.scale.setScalar(1 + h.userData.age * 0.4);
      // Billboard toward the camera, then add a gentle rocking spin so it
      // doesn't look perfectly static.
      if (cam) {
        h.lookAt(cam.position);
      }
      h.rotation.z += dt * 1.5 * h.userData.spinSign;
    }
  }
}
