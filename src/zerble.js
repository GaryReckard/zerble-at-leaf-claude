// Zerble: the anthropomorphic golf cart. Geometry + arcade physics.

import * as THREE from 'three';
import { terrainHeight } from './rng.js';

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

    // ----- Front bench seat -----
    const frontSeat = new THREE.Mesh(
      this._roundedBoxGeometry(2.2, 0.55, 1.0, 0.1),
      mat(COLOR_SEAT, { roughness: 0.85 })
    );
    frontSeat.position.set(0, 1.45, -0.4);
    frontSeat.castShadow = true;
    this.root.add(frontSeat);

    const frontSeatBack = new THREE.Mesh(
      this._roundedBoxGeometry(2.2, 1.0, 0.22, 0.08),
      mat(COLOR_SEAT, { roughness: 0.85 })
    );
    frontSeatBack.position.set(0, 1.95, 0.1);
    frontSeatBack.castShadow = true;
    this.root.add(frontSeatBack);

    // ----- Back bench seat (passenger row) -----
    const backSeat = new THREE.Mesh(
      this._roundedBoxGeometry(2.2, 0.55, 1.0, 0.1),
      mat(0xb56b3a, { roughness: 0.85 })
    );
    backSeat.position.set(0, 1.45, 1.0);
    backSeat.castShadow = true;
    this.root.add(backSeat);

    const backSeatBack = new THREE.Mesh(
      this._roundedBoxGeometry(2.2, 0.9, 0.22, 0.08),
      mat(0xb56b3a, { roughness: 0.85 })
    );
    backSeatBack.position.set(0, 1.9, 1.5);
    backSeatBack.castShadow = true;
    this.root.add(backSeatBack);

    // ----- Roof poles (pushed to the very corners so two rows of seats fit underneath) -----
    const poleGeo = new THREE.CylinderGeometry(0.07, 0.07, 2.4, 8);
    const poleMat = mat(COLOR_FRAME, { roughness: 0.4, metalness: 0.5 });
    for (const [x, z] of [
      [-1.3, -1.6],
      [1.3, -1.6],
      [-1.3, 1.8],
      [1.3, 1.8],
    ]) {
      const p = new THREE.Mesh(poleGeo, poleMat);
      p.position.set(x, 2.5, z);
      p.castShadow = true;
      this.root.add(p);
    }

    // ----- Roof (pink, slightly extended to cover both rows) -----
    const roof = new THREE.Mesh(
      this._roundedBoxGeometry(3.4, 0.25, 4.2, 0.12),
      mat(COLOR_ROOF, { roughness: 0.5 })
    );
    roof.position.set(0, 3.75, 0.1);
    roof.castShadow = true;
    this.root.add(roof);

    // ----- "Oh-shit" bar — horizontal cross-brace across the very back -----
    const ohShitBar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 2.4, 10),
      mat(COLOR_FRAME, { roughness: 0.4, metalness: 0.7 })
    );
    ohShitBar.rotation.z = Math.PI / 2;
    ohShitBar.position.set(0, 2.55, 1.9);
    ohShitBar.castShadow = true;
    this.root.add(ohShitBar);

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

    // ----- Eyes — HUGE globes with prominent black pupils, sitting atop the hood -----
    this.eyes = [];
    for (const ex of [-0.85, 0.85]) {
      const eye = new THREE.Group();
      eye.position.set(ex, 2.2, -1.95);

      // Sclera — large white globe
      const sclera = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.85, 2),
        new THREE.MeshStandardMaterial({
          color: 0xffffff,
          emissive: COLOR_EYE_GLOW,
          emissiveIntensity: 0.55,
          roughness: 0.25,
          flatShading: false,
        })
      );
      sclera.castShadow = false;
      eye.add(sclera);

      // Iris — prominent blue ring
      const iris = new THREE.Mesh(
        new THREE.SphereGeometry(0.5, 16, 12),
        new THREE.MeshStandardMaterial({
          color: COLOR_IRIS,
          emissive: 0x0a3f8a,
          emissiveIntensity: 0.3,
          roughness: 0.3,
        })
      );
      iris.position.z = -0.6;
      eye.add(iris);

      // Pupil — BIG, dominant, matches the reference art's expressive eye dots
      const pupil = new THREE.Mesh(
        new THREE.SphereGeometry(0.34, 14, 12),
        new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 1 })
      );
      pupil.position.z = -0.7;
      eye.add(pupil);

      // Highlight
      const hi = new THREE.Mesh(
        new THREE.SphereGeometry(0.1, 10, 8),
        new THREE.MeshStandardMaterial({
          color: 0xffffff,
          emissive: 0xffffff,
          emissiveIntensity: 2,
        })
      );
      hi.position.set(0.08, 0.1, -0.82);
      eye.add(hi);

      this.root.add(eye);
      this.eyes.push({ root: eye, pupil, iris, basePos: eye.position.clone() });
    }

    // ----- Mustache -----
    this._buildMustache();

    // ----- Mouth (small smile slot below the mustache) -----
    const smileGeo = new THREE.TorusGeometry(0.35, 0.06, 8, 24, Math.PI);
    const smileMesh = new THREE.Mesh(smileGeo, mat(0xffffff, { roughness: 1 }));
    smileMesh.rotation.x = Math.PI;
    smileMesh.rotation.z = Math.PI;
    smileMesh.position.set(0, 0.85, -2.13);
    this.root.add(smileMesh);

    // Teeth — sit at chassis-front level below the mustache
    const toothMat = mat(0xffffff, { roughness: 1 });
    for (const tx of [-0.25, -0.08, 0.09, 0.26]) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.05), toothMat);
      t.position.set(tx, 0.92, -2.16);
      this.root.add(t);
    }

    // ----- Bubble machine — mounted ON the oh-shit bar, pointing BACKWARDS -----
    const bm = new THREE.Mesh(
      this._roundedBoxGeometry(0.9, 0.6, 0.6, 0.07),
      mat(0x6b4ea0, { roughness: 0.4 })
    );
    bm.position.set(0, 2.55, 2.0);
    bm.castShadow = true;
    this.root.add(bm);

    // Mounting clamp connecting box to bar
    const clamp = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.09, 0.3, 8),
      mat(COLOR_FRAME, { roughness: 0.4, metalness: 0.7 })
    );
    clamp.position.set(0, 2.55, 1.9);
    clamp.rotation.z = Math.PI / 2;
    this.root.add(clamp);

    // Nozzle — horizontal, aimed +Z (backwards out the rear)
    this.nozzle = new THREE.Mesh(
      new THREE.ConeGeometry(0.22, 0.5, 14),
      mat(0xb89cf5, { roughness: 0.3, metalness: 0.5 })
    );
    this.nozzle.position.set(0, 2.55, 2.45);
    // Default cone points +Y; rotate so it points +Z (out the back)
    this.nozzle.rotation.x = Math.PI / 2;
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
    ring.position.set(0, 2.55, 2.7);
    // Ring lies in the XY plane facing +Z
    ring.rotation.x = 0;
    this.root.add(ring);
    this._nozzleRing = ring;

    // Headlights — round lenses on the front bumper. Subtle; the eyes should be the star.
    for (const hx of [-1.0, 1.0]) {
      const hl = new THREE.Mesh(
        new THREE.SphereGeometry(0.18, 14, 10),
        new THREE.MeshStandardMaterial({
          color: 0xfff0c4,
          emissive: 0xffe9b3,
          emissiveIntensity: 0.45,
          roughness: 0.35,
        })
      );
      hl.position.set(hx, 0.55, -2.18);
      this.root.add(hl);

      // A chrome bezel around each headlight
      const bezel = new THREE.Mesh(
        new THREE.TorusGeometry(0.22, 0.04, 8, 16),
        new THREE.MeshStandardMaterial({ color: 0x6a6a78, roughness: 0.4, metalness: 0.7 })
      );
      bezel.position.set(hx, 0.55, -2.13);
      this.root.add(bezel);
    }

    // A grounded shadow disc for fallback (in case shadow map quality drops)
    const shadowDisc = new THREE.Mesh(
      new THREE.CircleGeometry(2.2, 24),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25 })
    );
    shadowDisc.rotation.x = -Math.PI / 2;
    shadowDisc.position.y = 0.02;
    this.root.add(shadowDisc);

    // ----- Permanent bearded driver in the front-left seat -----
    this._buildDriver();

    // ----- Passenger seat slots (local space, ordered: drivers seat is occupied) -----
    // Each slot is a local position + facing. Passengers attach here.
    this.seatSlots = [
      // Front row
      { name: 'front-right',  x:  0.55, y: 1.75, z: -0.35, yaw: 0,           occupied: false, kind: 'driver_seat' },
      // Back row: 3 across
      { name: 'back-left',    x: -0.65, y: 1.75, z:  1.0,  yaw: 0,           occupied: false, kind: 'bench' },
      { name: 'back-center',  x:  0.0,  y: 1.75, z:  1.0,  yaw: 0,           occupied: false, kind: 'bench' },
      { name: 'back-right',   x:  0.65, y: 1.75, z:  1.0,  yaw: 0,           occupied: false, kind: 'bench' },
      // Running-board / side-rider slots
      { name: 'side-left',    x: -1.55, y: 1.4,  z:  0.5,  yaw: -Math.PI/2,  occupied: false, kind: 'standing' },
      { name: 'side-right',   x:  1.55, y: 1.4,  z:  0.5,  yaw:  Math.PI/2,  occupied: false, kind: 'standing' },
      // Roof riders (the brave ones)
      { name: 'roof-front',   x:  0.0,  y: 3.95, z: -1.2,  yaw: 0,           occupied: false, kind: 'roof' },
      { name: 'roof-back',    x:  0.0,  y: 3.95, z:  1.3,  yaw: 0,           occupied: false, kind: 'roof' },
      // Two more squeezed in
      { name: 'lap-left',     x: -0.55, y: 2.05, z: -0.35, yaw: 0,           occupied: false, kind: 'lap' },
      { name: 'back-lap',     x:  0.0,  y: 2.05, z:  1.0,  yaw: 0,           occupied: false, kind: 'lap' },
    ];
  }

  _buildDriver() {
    const driver = new THREE.Group();
    driver.position.set(-0.55, 1.75, -0.35); // sitting in the front-left seat

    // Body — flannel shirt
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.32, 0.55, 4, 8),
      new THREE.MeshStandardMaterial({ color: 0xa84a3b, roughness: 0.95, flatShading: true })
    );
    body.position.y = 0.05;
    body.castShadow = true;
    driver.add(body);

    // Head
    const head = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.28, 1),
      new THREE.MeshStandardMaterial({ color: 0xd9a26e, roughness: 0.9, flatShading: true })
    );
    head.position.y = 0.75;
    head.castShadow = true;
    driver.add(head);

    // Trucker cap
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.3, 0.2, 12),
      new THREE.MeshStandardMaterial({ color: 0x3a4f6a, roughness: 0.8, flatShading: true })
    );
    cap.position.y = 1.0;
    driver.add(cap);
    const brim = new THREE.Mesh(
      new THREE.CylinderGeometry(0.38, 0.38, 0.04, 12),
      new THREE.MeshStandardMaterial({ color: 0x3a4f6a, roughness: 0.8, flatShading: true })
    );
    brim.position.set(0, 0.9, -0.18);
    driver.add(brim);

    // Beard — chunky cluster of icospheres hanging from the chin
    const beardMatA = new THREE.MeshStandardMaterial({ color: 0x4a352a, roughness: 1, flatShading: true });
    const beardMatB = new THREE.MeshStandardMaterial({ color: 0x5d4435, roughness: 1, flatShading: true });
    const beardClusters = 14;
    for (let i = 0; i < beardClusters; i++) {
      const ang = (i / beardClusters) * Math.PI * 1.2 + Math.PI * 0.4;
      const r = 0.22 + Math.random() * 0.04;
      const dy = -0.05 - Math.random() * 0.15;
      const tuft = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.09 + Math.random() * 0.04, 0),
        i % 2 === 0 ? beardMatA : beardMatB
      );
      tuft.position.set(
        Math.cos(ang) * r * 0.6,
        0.6 + dy,
        Math.sin(ang) * r * 0.6 - 0.05
      );
      tuft.rotation.set(Math.random(), Math.random(), Math.random());
      driver.add(tuft);
    }

    // Hands on a steering wheel (just suggested)
    const handMat = new THREE.MeshStandardMaterial({ color: 0xd9a26e, roughness: 0.9 });
    for (const hx of [-0.18, 0.18]) {
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), handMat);
      hand.position.set(hx, 0.15, -0.45);
      driver.add(hand);
    }
    const wheel = new THREE.Mesh(
      new THREE.TorusGeometry(0.22, 0.04, 6, 14),
      new THREE.MeshStandardMaterial({ color: 0x222, roughness: 0.4 })
    );
    wheel.position.set(0, 0.15, -0.5);
    wheel.rotation.x = Math.PI / 2;
    driver.add(wheel);

    this.root.add(driver);
    this.driver = driver;
  }

  // Convert a local seat slot to a world position. Used by the passenger system.
  worldSeatPosition(slot, out) {
    const cos = Math.cos(this.heading);
    const sin = Math.sin(this.heading);
    out.set(
      this.position.x + slot.x * cos + slot.z * sin,
      this.position.y + slot.y,
      this.position.z - slot.x * sin + slot.z * cos
    );
    return out;
  }

  _buildMustache() {
    // Two mirrored handlebar curls — sweep out wide, dip down at the cheeks,
    // then curl up and back at the tips. Beefier and fuzzier than before.

    const mustacheMat = new THREE.MeshStandardMaterial({
      color: COLOR_MUSTACHE,
      roughness: 0.95,
      flatShading: true,
    });
    const fuzzMatA = new THREE.MeshStandardMaterial({
      color: 0x8244c8, roughness: 1, flatShading: true,
    });
    const fuzzMatB = new THREE.MeshStandardMaterial({
      color: 0xb285e8, roughness: 1, flatShading: true,
    });

    this._mustacheLeds = [];
    const ledGeo = new THREE.SphereGeometry(0.07, 8, 6);
    const fuzzGeo = new THREE.IcosahedronGeometry(0.13, 0);
    const fuzzGeoSmall = new THREE.IcosahedronGeometry(0.09, 0);

    // Position the whole mustache near the front of the cart, below the eyes.
    const baseY = 1.35;
    const baseZ = -2.30;

    for (const side of [-1, 1]) {
      const pts = [];
      // Curve starts at center (t=0) and grows OUTWARD as t increases.
      // The OUTER tip ends at the outer side — then curls upward from there.
      for (let t = 0; t <= 1.0001; t += 1 / 30) {
        const x = side * (0.05 + t * 1.85);                   // monotonically outward
        const y = -0.22 * Math.sin(Math.PI * t);              // sag/dip at the cheek
        const z = 0.08 * Math.sin(Math.PI * t);               // slight forward bulge mid-sweep
        pts.push(new THREE.Vector3(x, y, z));
      }
      // The outer tip — now curl up & inward over the cheek, handlebar style
      const tip = pts[pts.length - 1];
      pts.push(new THREE.Vector3(tip.x + side * 0.08, tip.y + 0.35, tip.z));
      pts.push(new THREE.Vector3(tip.x + side * 0.02, tip.y + 0.72, tip.z));
      pts.push(new THREE.Vector3(tip.x - side * 0.35, tip.y + 0.78, tip.z));
      pts.push(new THREE.Vector3(tip.x - side * 0.65, tip.y + 0.50, tip.z));
      pts.push(new THREE.Vector3(tip.x - side * 0.70, tip.y + 0.18, tip.z));

      const curve = new THREE.CatmullRomCurve3(pts);
      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(curve, 64, 0.22, 6, false),
        mustacheMat
      );
      tube.position.set(0, baseY, baseZ);
      tube.castShadow = true;
      this.root.add(tube);

      // ----- Fuzz tufts along the tube — more, chunkier, in 360° around the tube -----
      const fuzzCount = 44;
      for (let i = 0; i < fuzzCount; i++) {
        const u = (i + 0.5) / fuzzCount;
        const p = curve.getPoint(u);
        // Distribute fuzz balls AROUND the tube
        const offAngle = (i * 2.39996) % (Math.PI * 2); // golden-angle distribution
        const offR = 0.15 + Math.random() * 0.10;
        const fuzz = new THREE.Mesh(
          i % 3 === 0 ? fuzzGeoSmall : fuzzGeo,
          i % 2 === 0 ? fuzzMatA : fuzzMatB
        );
        fuzz.position.set(
          p.x + Math.cos(offAngle) * offR * 0.7,
          p.y + Math.sin(offAngle) * offR,
          p.z + (Math.random() - 0.5) * 0.18
        );
        fuzz.rotation.set(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28);
        fuzz.castShadow = true;
        tube.add(fuzz);
      }

      // ----- LEDs along the curve -----
      const steps = 14;
      for (let i = 0; i < steps; i++) {
        const u = i / (steps - 1);
        const p = curve.getPoint(u);
        const hue = LED_HUES[i % LED_HUES.length];
        const ledMat = new THREE.MeshStandardMaterial({
          color: hue,
          emissive: hue,
          emissiveIntensity: 1.7,
        });
        const led = new THREE.Mesh(ledGeo, ledMat);
        led.position.copy(p);
        led.position.y -= 0.18;
        led.userData = { phase: Math.random() * Math.PI * 2, baseIntensity: 1.7, mat: ledMat };
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

    // Follow terrain — sit on the displaced ground so wheels stay flush.
    const groundY = terrainHeight(this.position.x, this.position.z);
    const targetY = Math.max(0, groundY);
    this.position.y = THREE.MathUtils.lerp(this.position.y, targetY, Math.min(1, dt * 8));

    // Cache useful world data for other systems
    this.forwardWorld.set(fx, 0, fz);
    // Nozzle local is (0, 2.55, 2.7) — rotate by heading around Y.
    this.nozzleWorld.set(
      this.position.x + Math.sin(this.heading) * 2.7,
      this.position.y + 2.55,
      this.position.z + Math.cos(this.heading) * 2.7
    );

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
