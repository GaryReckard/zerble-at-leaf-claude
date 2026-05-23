// Zerble: the anthropomorphic golf cart. Geometry + arcade physics.

import * as THREE from 'three';

// --- Driving feel knobs ---
const ACCEL = 18;          // m/s^2 throttle
const BRAKE = 28;          // m/s^2 when reversing throttle vs current direction
const MAX_SPEED = 18;      // m/s
const BOOST_MULT = 1.55;
const REVERSE_MAX = 7;
const DRAG = 0.92;         // multiplicative drag per second
const TURN_RATE = 2.1;     // rad/s at full speed
const WORLD_BOUND = 230;

// --- Visual palette (matches the reference image) ---
const COLOR_BODY = 0xe63b3b;
const COLOR_ROOF = 0xe879b8;
const COLOR_SEAT = 0x2563d6;
const COLOR_FRAME = 0x2a1f3a;
const COLOR_WHEEL = 0x1c1c20;
const COLOR_MUSTACHE = 0x9b59d6;
const COLOR_EYE_GLOW = 0xa6ecff;
const COLOR_IRIS = 0x1e9bff;

const LED_HUES = [0xff5577, 0xffaa33, 0xffe066, 0x66ff88, 0x66d9ff, 0xc080ff];

export class Zerble {
  constructor() {
    this.root = new THREE.Group();
    this.root.name = 'Zerble';

    this.position = this.root.position; // alias
    this.heading = 0;
    this.speed = 0;
    this.steerAngle = 0;
    this.radius = 1.9;
    this.invulnLeft = 0;
    this.honkCooldown = 0;

    // For bubbles & smile attraction: a stable world point on Zerble.
    this.nozzleWorld = new THREE.Vector3();
    this.forwardWorld = new THREE.Vector3();

    this._build();
  }

  // ---------- BUILD ----------

  _build() {
    const mat = (color, opts = {}) =>
      new THREE.MeshStandardMaterial({
        color,
        flatShading: true,
        roughness: opts.roughness ?? 0.6,
        metalness: opts.metalness ?? 0.05,
        emissive: opts.emissive ?? 0x000000,
        emissiveIntensity: opts.emissiveIntensity ?? 0,
      });

    // ----- Chassis (the red lower body) -----
    const chassis = new THREE.Mesh(
      this._roundedBoxGeometry(3.0, 0.9, 4.2, 0.18),
      mat(COLOR_BODY, { roughness: 0.55 })
    );
    chassis.position.y = 0.85;
    chassis.castShadow = true;
    chassis.receiveShadow = true;
    this.root.add(chassis);

    // Hood front (a small bulge at the front)
    const hood = new THREE.Mesh(
      this._roundedBoxGeometry(2.6, 0.45, 1.0, 0.14),
      mat(COLOR_BODY, { roughness: 0.55 })
    );
    hood.position.set(0, 1.2, -1.8);
    hood.castShadow = true;
    this.root.add(hood);

    // ----- Seat (blue cushion behind the front) -----
    const seat = new THREE.Mesh(
      this._roundedBoxGeometry(2.2, 0.55, 1.0, 0.1),
      mat(COLOR_SEAT, { roughness: 0.85 })
    );
    seat.position.set(0, 1.55, 0.2);
    seat.castShadow = true;
    this.root.add(seat);

    const seatBack = new THREE.Mesh(
      this._roundedBoxGeometry(2.2, 1.1, 0.25, 0.08),
      mat(COLOR_SEAT, { roughness: 0.85 })
    );
    seatBack.position.set(0, 2.1, 0.7);
    seatBack.castShadow = true;
    this.root.add(seatBack);

    // ----- Roof poles -----
    const poleGeo = new THREE.CylinderGeometry(0.07, 0.07, 2.0, 8);
    const poleMat = mat(COLOR_FRAME, { roughness: 0.4, metalness: 0.5 });
    for (const [x, z] of [
      [-1.3, -1.4],
      [1.3, -1.4],
      [-1.3, 1.3],
      [1.3, 1.3],
    ]) {
      const p = new THREE.Mesh(poleGeo, poleMat);
      p.position.set(x, 2.3, z);
      p.castShadow = true;
      this.root.add(p);
    }

    // ----- Roof (pink) -----
    const roof = new THREE.Mesh(
      this._roundedBoxGeometry(3.4, 0.25, 4.0, 0.12),
      mat(COLOR_ROOF, { roughness: 0.5 })
    );
    roof.position.y = 3.35;
    roof.castShadow = true;
    this.root.add(roof);

    // ----- Wheels -----
    this.wheels = [];
    const wheelGeo = new THREE.CylinderGeometry(0.55, 0.55, 0.45, 18);
    wheelGeo.rotateZ(Math.PI / 2);
    const wheelMat = mat(COLOR_WHEEL, { roughness: 0.9 });

    // Inner hub (lighter ring for a hint of detail)
    const hubGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.48, 12);
    hubGeo.rotateZ(Math.PI / 2);
    const hubMat = mat(0x55525a, { roughness: 0.7, metalness: 0.6 });

    const wheelPositions = [
      { x: -1.4, z: -1.5, front: true },
      { x: 1.4, z: -1.5, front: true },
      { x: -1.55, z: 1.4, front: false },
      { x: 1.55, z: 1.4, front: false },
    ];

    for (const wp of wheelPositions) {
      const wheelGroup = new THREE.Group();
      wheelGroup.position.set(wp.x, 0.55, wp.z);

      const tire = new THREE.Mesh(wheelGeo, wheelMat);
      tire.castShadow = true;
      wheelGroup.add(tire);

      const hub = new THREE.Mesh(hubGeo, hubMat);
      wheelGroup.add(hub);

      // Spin pivot is a child so steering can rotate the group without un-spinning the tire.
      const spinPivot = new THREE.Group();
      spinPivot.add(tire);
      spinPivot.add(hub);
      wheelGroup.add(spinPivot);
      // Remove duplicates we added earlier — we want them only via spinPivot.
      wheelGroup.remove(tire);
      wheelGroup.remove(hub);

      this.root.add(wheelGroup);
      this.wheels.push({ group: wheelGroup, spin: spinPivot, front: wp.front, baseY: wheelGroup.position.y });
    }

    // ----- Eyes (the soul of Zerble) -----
    this.eyes = [];
    for (const ex of [-0.7, 0.7]) {
      const eye = new THREE.Group();
      eye.position.set(ex, 2.7, -1.9);

      // Stalk
      const stalk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.1, 0.6, 8),
        mat(COLOR_FRAME, { roughness: 0.5, metalness: 0.4 })
      );
      stalk.position.y = -0.3;
      eye.add(stalk);

      // Sclera (the big white globe — emissive so it bloom-glows)
      const sclera = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.62, 2),
        new THREE.MeshStandardMaterial({
          color: 0xffffff,
          emissive: COLOR_EYE_GLOW,
          emissiveIntensity: 1.4,
          roughness: 0.25,
          flatShading: false,
        })
      );
      sclera.castShadow = false;
      eye.add(sclera);

      // Iris
      const iris = new THREE.Mesh(
        new THREE.SphereGeometry(0.35, 16, 12),
        new THREE.MeshStandardMaterial({
          color: COLOR_IRIS,
          emissive: 0x0a3f8a,
          emissiveIntensity: 0.4,
          roughness: 0.3,
        })
      );
      iris.position.z = -0.4;
      eye.add(iris);

      // Pupil
      const pupil = new THREE.Mesh(
        new THREE.SphereGeometry(0.17, 12, 10),
        new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 1 })
      );
      pupil.position.z = -0.55;
      eye.add(pupil);

      // Highlight
      const hi = new THREE.Mesh(
        new THREE.SphereGeometry(0.07, 10, 8),
        new THREE.MeshStandardMaterial({
          color: 0xffffff,
          emissive: 0xffffff,
          emissiveIntensity: 2,
        })
      );
      hi.position.set(0.06, 0.06, -0.6);
      eye.add(hi);

      this.root.add(eye);
      this.eyes.push({ root: eye, pupil, iris, basePos: eye.position.clone() });
    }

    // ----- Mustache -----
    this._buildMustache();

    // ----- Smile (mouth slot below the mustache) -----
    const smileGeo = new THREE.TorusGeometry(0.45, 0.07, 8, 24, Math.PI);
    const smileMesh = new THREE.Mesh(smileGeo, mat(0xffffff, { roughness: 1 }));
    smileMesh.rotation.x = Math.PI;
    smileMesh.rotation.z = Math.PI;
    smileMesh.position.set(0, 1.55, -2.42);
    this.root.add(smileMesh);

    // Teeth (a few little white boxes)
    const toothMat = mat(0xffffff, { roughness: 1 });
    for (const tx of [-0.25, -0.05, 0.15, 0.35]) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.13, 0.05), toothMat);
      t.position.set(tx - 0.05, 1.65, -2.46);
      this.root.add(t);
    }

    // ----- Bubble machine on the back -----
    const bm = new THREE.Mesh(
      this._roundedBoxGeometry(1.0, 0.7, 0.7, 0.07),
      mat(0x6b4ea0, { roughness: 0.4 })
    );
    bm.position.set(0, 1.4, 2.4);
    bm.castShadow = true;
    this.root.add(bm);

    // Nozzle (cone) where bubbles spawn
    this.nozzle = new THREE.Mesh(
      new THREE.ConeGeometry(0.22, 0.5, 14),
      mat(0xb89cf5, { roughness: 0.3, metalness: 0.5 })
    );
    this.nozzle.position.set(0, 2.0, 2.55);
    this.nozzle.rotation.x = -Math.PI / 6; // tilt back-up
    this.root.add(this.nozzle);

    // Glowing ring at the nozzle tip
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.18, 0.05, 8, 18),
      new THREE.MeshStandardMaterial({
        color: 0xa6ecff,
        emissive: 0xa6ecff,
        emissiveIntensity: 2,
      })
    );
    ring.position.copy(this.nozzle.position);
    ring.position.y += 0.25;
    ring.position.z += 0.05;
    ring.rotation.x = Math.PI / 2;
    this.root.add(ring);
    this._nozzleRing = ring;

    // Headlights (tiny emissive boxes on the front for night-festival vibe)
    for (const hx of [-1.1, 1.1]) {
      const hl = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, 0.15, 0.1),
        new THREE.MeshStandardMaterial({
          color: 0xffe9b3,
          emissive: 0xffe9b3,
          emissiveIntensity: 1.5,
        })
      );
      hl.position.set(hx, 1.15, -2.42);
      this.root.add(hl);
    }

    // A grounded shadow disc for fallback (in case shadow map quality drops)
    const shadowDisc = new THREE.Mesh(
      new THREE.CircleGeometry(2.2, 24),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25 })
    );
    shadowDisc.rotation.x = -Math.PI / 2;
    shadowDisc.position.y = 0.02;
    this.root.add(shadowDisc);
  }

  _buildMustache() {
    // The mustache is two mirrored tube curls — left half and right half.
    // Each curve sweeps out, down, and curls back up in a handlebar shape.

    const mustacheMat = new THREE.MeshStandardMaterial({
      color: COLOR_MUSTACHE,
      roughness: 0.85,
      flatShading: true,
    });

    this._mustacheLeds = [];
    const ledGeo = new THREE.SphereGeometry(0.07, 8, 6);

    for (const side of [-1, 1]) {
      const pts = [];
      for (let t = 0; t <= 1.0001; t += 1 / 30) {
        const x = side * (0.05 + 1.3 * Math.sin(Math.PI * t));
        const y = -0.18 * Math.sin(Math.PI * 2 * t) - 0.04 * Math.cos(Math.PI * 3 * t);
        const z = 0.05 * Math.cos(Math.PI * t * 2);
        pts.push(new THREE.Vector3(x, y, z));
      }
      // Curl the outer tip back up
      const tip = pts[pts.length - 1];
      pts.push(new THREE.Vector3(tip.x + side * 0.1, tip.y + 0.3, tip.z));
      pts.push(new THREE.Vector3(tip.x - side * 0.05, tip.y + 0.55, tip.z));
      pts.push(new THREE.Vector3(tip.x - side * 0.25, tip.y + 0.55, tip.z));

      const curve = new THREE.CatmullRomCurve3(pts);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 0.13, 8, false), mustacheMat);
      tube.position.set(0, 2.0, -2.45);
      tube.castShadow = true;
      this.root.add(tube);

      // Add LEDs along the curve.
      const steps = 14;
      for (let i = 0; i < steps; i++) {
        const u = i / (steps - 1);
        const p = curve.getPoint(u);
        const hue = LED_HUES[i % LED_HUES.length];
        const ledMat = new THREE.MeshStandardMaterial({
          color: hue,
          emissive: hue,
          emissiveIntensity: 1.6,
        });
        const led = new THREE.Mesh(ledGeo, ledMat);
        // Offset outward from the tube center
        led.position.copy(p);
        led.position.y -= 0.12;
        led.userData = { phase: Math.random() * Math.PI * 2, baseIntensity: 1.6, mat: ledMat };
        tube.add(led);
        this._mustacheLeds.push(led);
      }
    }
  }

  // Simple rounded-box-ish geometry. We fake the bevel via BoxGeometry + slight scale on a wrapping shape.
  // For a real bevel we'd use BufferGeometryUtils.mergeVertices on a higher-segment box, but BoxGeometry
  // with flatShading already reads as faceted/low-poly which is the look we want.
  _roundedBoxGeometry(w, h, d /* , r */) {
    return new THREE.BoxGeometry(w, h, d, 2, 1, 2);
  }

  // ---------- UPDATE ----------

  update(dt, input) {
    // ----- Drive -----
    const throttle = input.throttle;
    const steer = input.steer;
    const wantBoost = input.boost && throttle > 0;

    const maxFwd = MAX_SPEED * (wantBoost ? BOOST_MULT : 1);
    const maxRev = -REVERSE_MAX;

    if (throttle !== 0) {
      // If throttle opposes current velocity direction, brake harder.
      const sameSign = Math.sign(throttle) === Math.sign(this.speed) || this.speed === 0;
      const a = sameSign ? ACCEL : BRAKE;
      this.speed += throttle * a * dt;
    } else {
      this.speed *= Math.pow(DRAG, dt * 4);
      if (Math.abs(this.speed) < 0.05) this.speed = 0;
    }
    this.speed = THREE.MathUtils.clamp(this.speed, maxRev, maxFwd);

    // Steering scales with speed — feels arcade-y and forgiving.
    const speedFactor = THREE.MathUtils.clamp(Math.abs(this.speed) / 6, 0.2, 1);
    const dir = Math.sign(this.speed) || 1;
    this.heading += steer * TURN_RATE * speedFactor * dir * dt;
    this.steerAngle = THREE.MathUtils.lerp(this.steerAngle, steer * 0.35, Math.min(1, dt * 10));

    // Move. Visual rotation in three.js: rotating Object3D by +heading around Y rotates
    // its local -Z (cart's nose) to world (-sin(h), 0, -cos(h)). Movement must match.
    const fx = -Math.sin(this.heading);
    const fz = -Math.cos(this.heading);
    this.position.x += fx * this.speed * dt;
    this.position.z += fz * this.speed * dt;
    this.root.rotation.y = this.heading;

    // World bound (push back softly)
    const r = WORLD_BOUND;
    if (Math.abs(this.position.x) > r) {
      this.position.x = THREE.MathUtils.clamp(this.position.x, -r, r);
      this.speed *= 0.5;
    }
    if (Math.abs(this.position.z) > r) {
      this.position.z = THREE.MathUtils.clamp(this.position.z, -r, r);
      this.speed *= 0.5;
    }

    // Cache useful world data for other systems
    this.forwardWorld.set(fx, 0, fz);
    this.nozzleWorld.set(this.position.x - fx * 1.8, 2.2, this.position.z - fz * 1.8);

    // ----- Animate wheels -----
    const wheelAngularSpeed = this.speed / 0.55; // rad/s for r=0.55
    for (const w of this.wheels) {
      w.spin.rotation.x += wheelAngularSpeed * dt;
      // Front wheels steer
      if (w.front) {
        w.group.rotation.y = THREE.MathUtils.lerp(w.group.rotation.y, this.steerAngle, Math.min(1, dt * 10));
      }
      // Tiny bounce to feel alive
      w.group.position.y = w.baseY + Math.sin(performance.now() * 0.01 + w.group.position.x) * 0.02;
    }

    // ----- Animate eyes (idle wobble + look ahead) -----
    const t = performance.now() * 0.001;
    for (const eye of this.eyes) {
      eye.root.position.y = eye.basePos.y + Math.sin(t * 1.5 + eye.basePos.x) * 0.05;
      eye.pupil.position.z = -0.55 + Math.sin(t * 0.7) * 0.05;
      eye.pupil.position.x = Math.sin(t * 0.4) * 0.06;
    }

    // ----- Animate LEDs (rainbow chase) -----
    for (let i = 0; i < this._mustacheLeds.length; i++) {
      const led = this._mustacheLeds[i];
      const phase = led.userData.phase + t * 3 + i * 0.4;
      led.userData.mat.emissiveIntensity = 1.0 + 0.9 * (0.5 + 0.5 * Math.sin(phase));
    }

    // ----- Pulse nozzle ring -----
    this._nozzleRing.material.emissiveIntensity = 1.4 + Math.sin(t * 6) * 0.5;

    // ----- Tick timers -----
    if (this.invulnLeft > 0) this.invulnLeft -= dt;
    if (this.honkCooldown > 0) this.honkCooldown -= dt;
  }

  // Called by main on collision.
  applyHit(pushDir) {
    // Bounce back
    this.speed = -Math.sign(this.speed || 1) * 4;
    this.position.x += pushDir.x * 0.6;
    this.position.z += pushDir.z * 0.6;
    this.invulnLeft = 0.7;
  }

  canHonk() {
    return this.honkCooldown <= 0;
  }

  honk() {
    this.honkCooldown = 2.5;
  }
}
