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
import { createHeartGeometry, sharedHeartGeometry as _heartGeo } from './models/heart.js';

// Re-export so older imports (e.g. from sandbox.html or main) keep working.
export { createHeartGeometry };

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

// Lay out N evenly-spaced positions along a [0..1] parameter, mapping each
// through `fn` to a value. Helper used to plot a flower crown on the roof.
function range(n, fn) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(fn(i / Math.max(1, n - 1)));
  return out;
}

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
    this._buildWindshield();
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

  // Move Lurleen + her wander home to a new origin. Used by sandbox.html so
  // she doesn't immediately race off toward her hard-coded SPAWN_POS once
  // moved to (0,0,0) for inspection.
  setSpawnAt(x, z) {
    this.position.set(x, 0, z);
    this.homePos.set(x, 0, z);
    this.wanderTarget.set(x, 0, z);
    this.wanderTimer = 9 + Math.random() * 8;   // pause before picking next target
    this.speed = 0;
    this.root.position.copy(this.position);
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

    // Roof — bright yellow/gold base, now at Zerble's roof height so the two
    // carts look like equals from a distance. Hair attaches at the four
    // corners and drapes down to the chassis.
    const roofMat = new THREE.MeshStandardMaterial({
      color: 0xffe066, roughness: 0.95, flatShading: true,
    });
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(2.1, 0.18, 1.9),
      roofMat,
    );
    // Roof center at y=3.85, top at 3.94 — matches Zerble's roof at 3.75+0.125.
    roof.position.set(0, 3.85, -0.5);
    roof.castShadow = true;
    this.root.add(roof);
    this._roofY = 3.85;
    this._roofHalfW = 1.05;
    this._roofHalfD = 0.95;
    this._roofZ = -0.5;

    // Roof posts — tall enough to reach the new roof height.
    const postMat = new THREE.MeshStandardMaterial({
      color: 0x2a1f3a, roughness: 0.7, flatShading: true,
    });
    // Posts span from chassis top (y ~1.2) up to roof bottom (y ~3.76).
    const postLen = 2.55;
    const postY = 1.2 + postLen / 2;
    for (const [px, pz] of [[-0.95, 0.3], [0.95, 0.3], [-0.95, -1.3], [0.95, -1.3]]) {
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.05, postLen, 6), postMat,
      );
      post.position.set(px, postY, pz);
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

  // ---------- Windshield — a clear plane between the front posts ----------
  // The googly eyes sit on this surface. Reference photo: the eyes are stuck
  // to the actual clear windshield, not floating in space.

  _buildWindshield() {
    // The front-of-cart edge of the roof is at z = roofZ - halfD = -1.45.
    // The chassis top is at y=1.2. The roof bottom is at y=3.76.
    // Match the front roof-posts at x = ±0.95.
    const windshieldGeo = new THREE.PlaneGeometry(2.0, 2.5);
    const windshieldMat = new THREE.MeshStandardMaterial({
      color: 0xa6d8ff,
      roughness: 0.05,
      metalness: 0.1,
      transparent: true,
      opacity: 0.18,
      side: THREE.DoubleSide,
    });
    const windshield = new THREE.Mesh(windshieldGeo, windshieldMat);
    // Position: centered between the front posts, vertical between chassis & roof.
    // Front face of cart is at z = -1.5 (slightly past the front posts at z=-1.3).
    windshield.position.set(0, 2.45, -1.45);
    // A subtle tilt forward at the top (like a real golf cart windshield)
    windshield.rotation.x = 0.08;
    this.root.add(windshield);
    this._windshield = windshield;
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

    // Per Gary's feedback: a tad smaller eyes than v2 and a bit closer
    // together. Position them ON the windshield surface (z=-1.45 + tilt) so
    // they read as actual stickers, not floating discs.
    const eyeR = 0.38;     // sclera radius (was 0.50)
    const eyeSep = 0.55;   // ±X (was 0.78 → closer together)
    const eyeY = 2.55;     // sits on the upper half of the windshield
    // Windshield front face: z = -1.45 with a 0.08 forward tilt at top.
    // Stick eyes slightly in front of it so they sit on the surface visibly.
    const eyeZ = -1.50;
    for (const ex of [-eyeSep, eyeSep]) {
      const eye = new THREE.Group();
      eye.position.set(ex, eyeY, eyeZ);
      // Match the windshield's tilt so the eye sticker lies flush.
      eye.rotation.x = 0.08;
      // Eye faces forward (cart-local -Z). CircleGeometry's normal is +Z by
      // default, so flip the eye group 180° around Y.
      eye.rotation.y = Math.PI;

      // White flat disc — the "sclera sticker"
      const sclera = new THREE.Mesh(
        new THREE.CircleGeometry(eyeR, 32),
        scleraMat,
      );
      eye.add(sclera);

      // Thin dark outline ring around the sclera — sells the sticker look
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(eyeR - 0.02, eyeR + 0.02, 32),
        ringMat,
      );
      ring.position.z = 0.005;
      eye.add(ring);

      // Pupil — flat black disc that wobbles around inside the sclera. Held
      // in its own group so we can pan it within the sclera circle.
      const pupilR = 0.16;       // scaled down with the sclera
      const pupilGroup = new THREE.Group();
      const pupil = new THREE.Mesh(
        new THREE.CircleGeometry(pupilR, 28),
        pupilMat,
      );
      pupil.position.z = 0.02;
      pupilGroup.add(pupil);
      const highlight = new THREE.Mesh(
        new THREE.CircleGeometry(0.04, 16),
        new THREE.MeshStandardMaterial({
          color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.6, roughness: 0.2,
          polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
        }),
      );
      highlight.position.set(-0.05, 0.06, 0.025);
      pupilGroup.add(highlight);
      eye.add(pupilGroup);

      // Eyelashes
      for (let k = -1; k <= 1; k++) {
        const lash = new THREE.Mesh(
          new THREE.ConeGeometry(0.030, 0.24, 5),
          lashMat,
        );
        lash.position.set(k * 0.16, eyeR - 0.04, 0.005);
        lash.rotation.x = -0.25;
        lash.rotation.z = -k * 0.18;
        eye.add(lash);
      }

      this.root.add(eye);
      // Save the wobble bounds so the pupil can't escape the (smaller) sclera.
      this.eyes.push({
        root: eye, pupil: pupilGroup, basePos: eye.position.clone(),
        wobbleX: eyeR - pupilR - 0.04, wobbleY: eyeR - pupilR - 0.06,
      });
    }
  }

  // ---------- Hair — raffia strands wrapping the whole roof + flower crown ----------
  // Reference photo: long fringe of raffia hanging down all four sides of the
  // roof, gathered into bunches/parts in a few places, with a row of small
  // bright flowers along the top edge. Builds the perimeter as four runs (front,
  // back, left, right), each laying strands along its edge.

  _buildHair() {
    // Per Gary's reference photo + feedback: hair is gathered into FOUR
    // bunches at the roof corners (like hair ties / pigtails) and hangs
    // straight down from there. No perimeter fringe.
    const goldHair = new THREE.MeshStandardMaterial({ color: 0xd8b878, roughness: 0.95, flatShading: true });
    const brownHair = new THREE.MeshStandardMaterial({ color: 0xa07840, roughness: 0.95, flatShading: true });
    const lightHair = new THREE.MeshStandardMaterial({ color: 0xe6c98c, roughness: 0.95, flatShading: true });

    const halfW = this._roofHalfW;
    const halfD = this._roofHalfD;
    const roofZ = this._roofZ;
    // Strands anchor flush against the bottom of the roof slab.
    const hairTopY = this._roofY - 0.09;
    // Length: long enough to drape past the roof posts and just past chassis
    // height, like the photo where hair brushes the windshield top.
    const hairLen = 1.65;

    const corners = [
      { x: -halfW, z: roofZ + halfD, normX: -1, normZ: 1 },     // front-left
      { x:  halfW, z: roofZ + halfD, normX:  1, normZ: 1 },     // front-right
      { x: -halfW, z: roofZ - halfD, normX: -1, normZ: -1 },    // back-left
      { x:  halfW, z: roofZ - halfD, normX:  1, normZ: -1 },    // back-right
    ];

    for (const c of corners) {
      // Each corner has a "hair tie" gather (a small dark ring), then a fan
      // of strands fanning out + hanging down.
      const tieMat = new THREE.MeshStandardMaterial({
        color: 0x66d9ff, roughness: 0.5, flatShading: true,
      });
      const tie = new THREE.Mesh(
        new THREE.TorusGeometry(0.10, 0.04, 6, 14),
        tieMat,
      );
      tie.position.set(c.x, hairTopY - 0.05, c.z);
      tie.rotation.x = Math.PI / 2;       // ring lies flat horizontally
      this.root.add(tie);

      // Bunch of strands. Each strand starts at the tie and falls straight
      // down with a tiny outward bias toward the corner's diagonal — that's
      // the "draped over the edge" feel.
      const strandsPerBunch = 90;
      for (let i = 0; i < strandsPerBunch; i++) {
        // Cluster radius ~0.18 around the tie's center
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * 0.18;
        const sx = c.x + Math.cos(a) * r;
        const sz = c.z + Math.sin(a) * r;
        // Length jitter
        const len = hairLen * (0.75 + Math.random() * 0.45);

        const cone = new THREE.ConeGeometry(0.022, len, 5, 1);
        cone.translate(0, -len / 2, 0);       // anchor strand's top at origin
        const matRoll = Math.random();
        const mat = matRoll < 0.4 ? goldHair : matRoll < 0.75 ? brownHair : lightHair;
        const strand = new THREE.Mesh(cone, mat);
        strand.position.set(sx, hairTopY, sz);
        // Mostly straight down. Tilt slightly outward along the corner's
        // diagonal so the bunch reads as a swept ponytail.
        strand.rotation.x = c.normZ * 0.08 + (Math.random() - 0.5) * 0.12;
        strand.rotation.z = -c.normX * 0.08 + (Math.random() - 0.5) * 0.12;
        strand.castShadow = true;
        this.root.add(strand);
      }
    }

    // Flower crown along the top of the roof — perimeter line of small blossoms.
    const flowerColors = [0xff4d8a, 0xff9933, 0x9966ff, 0x66ccff, 0xffee33, 0xff6f6f, 0x66ff99];
    const flowerCount = 22;
    const perimeter = [
      // walk front edge L→R, right edge F→B, back edge R→L, left edge B→F
      ...range(6, (t) => ({ x: -halfW + t * (2 * halfW), z: roofZ + halfD })),
      ...range(5, (t) => ({ x: halfW, z: roofZ + halfD - t * (2 * halfD) })),
      ...range(6, (t) => ({ x: halfW - t * (2 * halfW), z: roofZ - halfD })),
      ...range(5, (t) => ({ x: -halfW, z: roofZ - halfD + t * (2 * halfD) })),
    ];
    for (let i = 0; i < Math.min(flowerCount, perimeter.length); i++) {
      const p = perimeter[i];
      const c = flowerColors[i % flowerColors.length];
      const flower = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.10 + Math.random() * 0.03, 0),
        new THREE.MeshStandardMaterial({
          color: c, emissive: c, emissiveIntensity: 0.5, roughness: 0.4,
        }),
      );
      flower.position.set(p.x, this._roofY + 0.13, p.z);
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

    // Eye wobble — flat pupil disc rolls around within the sclera circle,
    // staying inside the rim. Lissajous-style motion mimics real googly eyes.
    const t = performance.now() * 0.001;
    for (const eye of this.eyes) {
      eye.root.position.y = eye.basePos.y + Math.sin(t * 1.4 + eye.basePos.x) * 0.03;
      eye.pupil.position.x = Math.sin(t * 0.9 + eye.basePos.x * 3) * eye.wobbleX;
      eye.pupil.position.y = Math.cos(t * 1.3 + eye.basePos.x * 2) * eye.wobbleY;
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
