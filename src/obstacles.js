// Obstacles: things you DON'T want to hit. Each one exposes:
//   .group  : THREE.Object3D to add to scene
//   .update(dt) : per-frame movement
//   .colliders : array of { position: Vector3, radius: number, damage: number, kind: string }
//
// All geometry is procedural and low-poly.

import * as THREE from 'three';

const TAU = Math.PI * 2;

// =================================================================
// PUPPET PARADE  — the Street Creature Puppet Collective
// =================================================================

export class PuppetParade {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'PuppetParade';

    // A patrol path that loops through the festival center.
    this.path = [
      new THREE.Vector3(-70, 0, -10),
      new THREE.Vector3(-30, 0, 20),
      new THREE.Vector3(20, 0, 10),
      new THREE.Vector3(60, 0, -20),
      new THREE.Vector3(40, 0, -60),
      new THREE.Vector3(-20, 0, -50),
      new THREE.Vector3(-60, 0, -30),
    ];
    this.speed = 2.4;

    this.puppets = [];
    const PUPPET_COUNT = 6;
    for (let i = 0; i < PUPPET_COUNT; i++) {
      const puppet = makePuppet(i);
      const ahead = i * 4.5;  // spacing along the path
      puppet.userData.distance = -ahead;
      this.group.add(puppet);
      this.puppets.push(puppet);
    }

    this.colliders = this.puppets.map((p) => ({
      position: new THREE.Vector3(),
      radius: 1.4,
      damage: 8,
      kind: 'puppet',
    }));

    this._tmpA = new THREE.Vector3();
    this._tmpB = new THREE.Vector3();
  }

  update(dt) {
    const totalLen = pathLength(this.path);
    for (let i = 0; i < this.puppets.length; i++) {
      const p = this.puppets[i];
      p.userData.distance = (p.userData.distance + this.speed * dt + totalLen * 100) % totalLen;
      const { pos, dir } = samplePath(this.path, p.userData.distance, this._tmpA, this._tmpB);
      p.position.copy(pos);
      const yaw = Math.atan2(dir.x, dir.z);
      p.rotation.y = yaw;

      // Per-puppet bob
      const t = performance.now() * 0.002 + i;
      p.children[0].position.y = 4 + Math.sin(t * 4) * 0.25;
      p.children[0].rotation.z = Math.sin(t * 2) * 0.08;

      this.colliders[i].position.copy(p.position);
      this.colliders[i].position.y = 1;
    }
  }
}

function makePuppet(seed) {
  const g = new THREE.Group();

  // A whimsical creature: tall thin pole with a giant head and floppy arms.
  const hueA = (seed * 0.37) % 1;
  const colorA = new THREE.Color().setHSL(hueA, 0.75, 0.55).getHex();
  const colorB = new THREE.Color().setHSL((hueA + 0.5) % 1, 0.75, 0.6).getHex();

  // Floating creature body (held aloft)
  const body = new THREE.Group();
  body.position.y = 4;

  // Head (large oblong)
  const head = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.2, 1),
    new THREE.MeshStandardMaterial({ color: colorA, roughness: 0.8, flatShading: true })
  );
  head.scale.set(1, 1.25, 1);
  head.castShadow = true;
  body.add(head);

  // Eyes — big white discs
  for (const ex of [-0.45, 0.45]) {
    const eye = new THREE.Mesh(
      new THREE.SphereGeometry(0.25, 12, 10),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 })
    );
    eye.position.set(ex, 0.2, -0.95);
    body.add(eye);

    const pupil = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0x000000 })
    );
    pupil.position.set(ex, 0.2, -1.15);
    body.add(pupil);
  }

  // Mouth (open, dark)
  const mouth = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 0.25, 0.1),
    new THREE.MeshStandardMaterial({ color: 0x222035 })
  );
  mouth.position.set(0, -0.45, -1.05);
  body.add(mouth);

  // Floppy arms (two cylinders) hanging from sides
  for (const ax of [-1.2, 1.2]) {
    const arm = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.12, 2.4, 8),
      new THREE.MeshStandardMaterial({ color: colorB, roughness: 0.9, flatShading: true })
    );
    arm.position.set(ax, -1.2, 0);
    arm.rotation.z = ax > 0 ? -0.25 : 0.25;
    arm.castShadow = true;
    body.add(arm);
  }

  // Frilly collar (a torus)
  const collar = new THREE.Mesh(
    new THREE.TorusGeometry(0.9, 0.18, 8, 16),
    new THREE.MeshStandardMaterial({ color: colorB, roughness: 0.9, flatShading: true })
  );
  collar.rotation.x = Math.PI / 2;
  collar.position.y = -1;
  body.add(collar);

  g.add(body);

  // Handler (a person under the puppet)
  const handler = makeSimpleNPC(0x222033, 0xe6c098);
  handler.position.y = 0;
  g.add(handler);

  // Pole connecting handler to puppet body
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.06, 3.5, 8),
    new THREE.MeshStandardMaterial({ color: 0x3a2e22, roughness: 0.95 })
  );
  pole.position.y = 2.8;
  g.add(pole);

  return g;
}

// =================================================================
// BRASS BAND — a cluster of marching musicians
// =================================================================

export class BrassBand {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'BrassBand';

    this.path = [
      new THREE.Vector3(80, 0, 70),
      new THREE.Vector3(40, 0, 95),
      new THREE.Vector3(-30, 0, 95),
      new THREE.Vector3(-90, 0, 70),
      new THREE.Vector3(-95, 0, 10),
      new THREE.Vector3(-60, 0, -10),
      new THREE.Vector3(0, 0, 30),
      new THREE.Vector3(60, 0, 30),
      new THREE.Vector3(85, 0, 50),
    ];
    this.speed = 1.8;

    this.members = [];
    const formation = [
      [0, 0, 'trumpet'],
      [-1.4, -1.2, 'trumpet'],
      [1.4, -1.2, 'sax'],
      [0, -2.6, 'tuba'],
      [-2.6, -2.4, 'drum'],
      [2.6, -2.4, 'sax'],
    ];

    for (const [offX, offZ, instrument] of formation) {
      const m = makeBandMember(instrument);
      m.userData.formationOff = new THREE.Vector3(offX, 0, offZ);
      this.group.add(m);
      this.members.push(m);
    }

    this.colliders = this.members.map(() => ({
      position: new THREE.Vector3(),
      radius: 1.0,
      damage: 6,
      kind: 'brass',
    }));

    this.distance = 0;
    this._tmpA = new THREE.Vector3();
    this._tmpB = new THREE.Vector3();
  }

  update(dt) {
    const totalLen = pathLength(this.path);
    this.distance = (this.distance + this.speed * dt + totalLen * 100) % totalLen;
    const { pos: leadPos, dir: leadDir } = samplePath(this.path, this.distance, this._tmpA, this._tmpB);
    const yaw = Math.atan2(leadDir.x, leadDir.z);
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);

    for (let i = 0; i < this.members.length; i++) {
      const m = this.members[i];
      const off = m.userData.formationOff;
      // Rotate the offset into the band's heading
      const ox = off.x * cos + off.z * sin;
      const oz = -off.x * sin + off.z * cos;
      m.position.set(leadPos.x + ox, 0, leadPos.z + oz);
      m.rotation.y = yaw;

      // Marching bob
      const t = performance.now() * 0.004 + i;
      m.children[0].position.y = 0.85 + Math.abs(Math.sin(t * 2)) * 0.08;

      this.colliders[i].position.copy(m.position);
      this.colliders[i].position.y = 1;
    }
  }
}

function makeBandMember(instrument) {
  const g = new THREE.Group();
  const body = makeSimpleNPC(
    instrument === 'drum' ? 0x6a2a2a : 0xc77dff,
    0xe6c098
  );
  g.add(body);

  // Hat
  const hat = new THREE.Mesh(
    new THREE.CylinderGeometry(0.32, 0.32, 0.35, 12),
    new THREE.MeshStandardMaterial({ color: 0x121212, roughness: 0.8 })
  );
  hat.position.set(0, 2.05, 0);
  g.add(hat);
  const brim = new THREE.Mesh(
    new THREE.CylinderGeometry(0.45, 0.45, 0.05, 12),
    new THREE.MeshStandardMaterial({ color: 0x121212, roughness: 0.8 })
  );
  brim.position.set(0, 1.9, 0);
  g.add(brim);

  // Instrument
  const brass = new THREE.MeshStandardMaterial({
    color: 0xe8b042,
    roughness: 0.4,
    metalness: 0.85,
    flatShading: true,
  });

  if (instrument === 'tuba') {
    // A big spiral approximated with a torus + bell cone
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.18, 10, 16), brass);
    ring.position.set(0, 1.4, -0.5);
    g.add(ring);
    const bell = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.7, 14, 1, true), brass);
    bell.position.set(0, 2.0, -0.5);
    bell.rotation.x = Math.PI;
    g.add(bell);
  } else if (instrument === 'drum') {
    const drum = new THREE.Mesh(
      new THREE.CylinderGeometry(0.7, 0.7, 0.6, 16),
      new THREE.MeshStandardMaterial({ color: 0xfff4d0, roughness: 0.7, flatShading: true })
    );
    drum.rotation.x = Math.PI / 2;
    drum.position.set(0, 1.2, -0.5);
    g.add(drum);
    // Drum head color band
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(0.72, 0.72, 0.1, 16),
      new THREE.MeshStandardMaterial({ color: 0xff6f9c })
    );
    band.rotation.x = Math.PI / 2;
    band.position.set(0, 1.2, -0.5);
    g.add(band);
  } else if (instrument === 'sax') {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.18, 0.95, 10), brass);
    body.position.set(0.35, 1.35, -0.4);
    body.rotation.z = -0.35;
    g.add(body);
    const bell = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.45, 12, 1, true), brass);
    bell.position.set(0.55, 1.9, -0.4);
    bell.rotation.z = -0.35;
    g.add(bell);
  } else {
    // trumpet
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.85, 8), brass);
    tube.rotation.z = Math.PI / 2;
    tube.position.set(0, 1.5, -0.45);
    g.add(tube);
    const bell = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.35, 12, 1, true), brass);
    bell.rotation.z = Math.PI / 2;
    bell.position.set(0.5, 1.5, -0.45);
    g.add(bell);
  }

  return g;
}

// =================================================================
// FOOD TRUCKS — stationary
// =================================================================

export function buildFoodTrucks(scene) {
  const colliders = [];

  const locations = [
    { x: 75, z: -15, color: 0xff6f9c, name: 'TACOS' },
    { x: 75, z: 5, color: 0xffd28a, name: 'BBQ' },
    { x: 75, z: 25, color: 0x66d9ff, name: 'PHO' },
    { x: -75, z: -10, color: 0x6fcf6a, name: 'KOMBUCHA' },
    { x: -75, z: 10, color: 0xb285ff, name: 'WAFFLES' },
  ];

  for (const loc of locations) {
    const truck = makeFoodTruck(loc.color, loc.name);
    truck.position.set(loc.x, 0, loc.z);
    truck.rotation.y = loc.x > 0 ? -Math.PI / 2 : Math.PI / 2;
    scene.add(truck);

    colliders.push({
      position: new THREE.Vector3(loc.x, 1.5, loc.z),
      radius: 3.6,
      damage: 12,
      kind: 'truck',
    });
  }

  return colliders;
}

function makeFoodTruck(color, _name) {
  const g = new THREE.Group();

  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.55, flatShading: true });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.8, flatShading: true });
  const windowMat = new THREE.MeshStandardMaterial({
    color: 0x97e6ff,
    emissive: 0x97e6ff,
    emissiveIntensity: 0.15,
    roughness: 0.2,
  });

  // Cargo box
  const box = new THREE.Mesh(new THREE.BoxGeometry(6, 3, 3.2), bodyMat);
  box.position.set(0.5, 1.9, 0);
  box.castShadow = true;
  box.receiveShadow = true;
  g.add(box);

  // Cab
  const cab = new THREE.Mesh(new THREE.BoxGeometry(2, 2.2, 3.0), bodyMat);
  cab.position.set(-2.5, 1.4, 0);
  cab.castShadow = true;
  g.add(cab);

  // Cab windshield
  const wind = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.0, 2.5), windowMat);
  wind.position.set(-3.55, 1.9, 0);
  g.add(wind);

  // Serving window (opens to one side)
  const serv = new THREE.Mesh(new THREE.BoxGeometry(3.5, 1.0, 0.05), windowMat);
  serv.position.set(0.5, 2.4, 1.6);
  g.add(serv);

  // Canopy
  const canopy = new THREE.Mesh(
    new THREE.BoxGeometry(3.6, 0.1, 1.2),
    new THREE.MeshStandardMaterial({ color: 0xfff4d0, roughness: 0.8, flatShading: true })
  );
  canopy.position.set(0.5, 3.1, 2.3);
  canopy.rotation.x = -0.2;
  canopy.castShadow = true;
  g.add(canopy);

  // Wheels
  for (const [wx, wz] of [[-2.5, -1.5], [-2.5, 1.5], [1.5, -1.5], [1.5, 1.5]]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.3, 14), darkMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(wx, 0.5, wz);
    g.add(w);
  }

  // Roof sign
  const sign = new THREE.Mesh(
    new THREE.BoxGeometry(4, 0.7, 0.15),
    new THREE.MeshStandardMaterial({
      color: 0xfff4d0,
      emissive: 0xffe066,
      emissiveIntensity: 0.4,
      roughness: 0.5,
    })
  );
  sign.position.set(0.5, 3.8, 1);
  sign.rotation.x = -0.15;
  g.add(sign);

  return g;
}

// =================================================================
// KIDS — small fast wandering capsules
// =================================================================

export class KidGaggle {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'Kids';
    this.kids = [];
    this.colliders = [];

    // Two gaggles, each near a stage
    const centers = [
      new THREE.Vector3(0, 0, -40),
      new THREE.Vector3(-40, 0, 30),
      new THREE.Vector3(40, 0, 30),
    ];

    for (const c of centers) {
      const gaggleSize = 4 + Math.floor(Math.random() * 3);
      for (let i = 0; i < gaggleSize; i++) {
        const k = makeKid();
        k.position.copy(c);
        k.position.x += (Math.random() - 0.5) * 8;
        k.position.z += (Math.random() - 0.5) * 8;
        k.userData.center = c.clone();
        k.userData.heading = Math.random() * TAU;
        k.userData.turnTimer = Math.random() * 2;
        k.userData.speed = 3 + Math.random() * 2;
        this.group.add(k);
        this.kids.push(k);
        this.colliders.push({
          position: new THREE.Vector3(),
          radius: 0.6,
          damage: 3,
          kind: 'kid',
        });
      }
    }
  }

  update(dt) {
    for (let i = 0; i < this.kids.length; i++) {
      const k = this.kids[i];

      k.userData.turnTimer -= dt;
      if (k.userData.turnTimer <= 0) {
        k.userData.heading += (Math.random() - 0.5) * 1.8;
        k.userData.turnTimer = 0.5 + Math.random() * 1.5;
      }

      const dx = Math.sin(k.userData.heading);
      const dz = -Math.cos(k.userData.heading);
      k.position.x += dx * k.userData.speed * dt;
      k.position.z += dz * k.userData.speed * dt;

      // Stay within ~12m of their gaggle center
      const cx = k.position.x - k.userData.center.x;
      const cz = k.position.z - k.userData.center.z;
      const cd = Math.hypot(cx, cz);
      if (cd > 12) {
        // Steer back toward center
        k.userData.heading = Math.atan2(-cx, -cz) + (Math.random() - 0.5) * 0.4;
      }

      k.rotation.y = k.userData.heading;

      // Lil hop
      const t = performance.now() * 0.012 + i;
      k.children[0].position.y = 0.55 + Math.abs(Math.sin(t * 2)) * 0.15;

      this.colliders[i].position.copy(k.position);
      this.colliders[i].position.y = 0.6;
    }
  }
}

function makeKid() {
  const g = new THREE.Group();

  const shirtColor = new THREE.Color().setHSL(Math.random(), 0.7, 0.6).getHex();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.22, 0.55, 4, 8),
    new THREE.MeshStandardMaterial({ color: shirtColor, roughness: 0.85, flatShading: true })
  );
  body.position.y = 0.55;
  body.castShadow = true;
  g.add(body);

  const head = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.22, 1),
    new THREE.MeshStandardMaterial({ color: 0xe6c098, roughness: 0.9, flatShading: true })
  );
  head.position.y = 1.15;
  head.castShadow = true;
  g.add(head);

  return g;
}

// =================================================================
// WOOKS — swaying tie-dye figures
// =================================================================

export class Wooks {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'Wooks';
    this.wooks = [];
    this.colliders = [];

    const WOOK_COUNT = 7;
    for (let i = 0; i < WOOK_COUNT; i++) {
      const w = makeWook();
      // Drift in slow circles around random anchor points
      const ang = Math.random() * TAU;
      const rad = 40 + Math.random() * 80;
      w.userData.anchor = new THREE.Vector3(Math.cos(ang) * rad, 0, Math.sin(ang) * rad);
      w.userData.radius = 2.5 + Math.random() * 3;
      w.userData.phase = Math.random() * TAU;
      w.userData.speed = 0.4 + Math.random() * 0.4;

      this.group.add(w);
      this.wooks.push(w);
      this.colliders.push({
        position: new THREE.Vector3(),
        radius: 0.9,
        damage: 5,
        kind: 'wook',
      });
    }
  }

  update(dt) {
    for (let i = 0; i < this.wooks.length; i++) {
      const w = this.wooks[i];
      w.userData.phase += w.userData.speed * dt;
      const a = w.userData.anchor;
      const px = a.x + Math.cos(w.userData.phase) * w.userData.radius;
      const pz = a.z + Math.sin(w.userData.phase * 0.7) * w.userData.radius;
      w.position.set(px, 0, pz);
      w.rotation.y = -w.userData.phase + Math.PI;

      // Sway
      const t = performance.now() * 0.002 + i;
      w.children[0].rotation.z = Math.sin(t) * 0.15;
      w.children[0].rotation.x = Math.cos(t * 0.7) * 0.08;

      this.colliders[i].position.copy(w.position);
      this.colliders[i].position.y = 1;
    }
  }
}

function makeWook() {
  const g = new THREE.Group();

  // Tie-dye body: a tall capsule with hue-shifting color (we approximate via patches of different colored boxes layered)
  const wookGroup = new THREE.Group();
  const colors = [0xff6f9c, 0xffd28a, 0x6fcf6a, 0x66d9ff, 0xb285ff];

  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.45, 1.4, 4, 8),
    new THREE.MeshStandardMaterial({
      color: colors[Math.floor(Math.random() * colors.length)],
      roughness: 0.95,
      flatShading: true,
    })
  );
  body.position.y = 1.1;
  body.castShadow = true;
  wookGroup.add(body);

  // Tie-dye splotches (small flat decals as boxes)
  for (let i = 0; i < 4; i++) {
    const splotch = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 0.4, 0.02),
      new THREE.MeshStandardMaterial({
        color: colors[Math.floor(Math.random() * colors.length)],
        roughness: 0.95,
      })
    );
    const a = Math.random() * TAU;
    splotch.position.set(Math.cos(a) * 0.45, 0.5 + Math.random() * 1.4, Math.sin(a) * 0.45);
    splotch.lookAt(splotch.position.clone().multiplyScalar(2));
    wookGroup.add(splotch);
  }

  // Head with long hair
  const head = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.3, 1),
    new THREE.MeshStandardMaterial({ color: 0xe6c098, roughness: 0.9, flatShading: true })
  );
  head.position.y = 2.15;
  head.castShadow = true;
  wookGroup.add(head);

  // Hair (a few elongated boxes)
  const hairColor = 0x5a3a1a;
  for (let i = 0; i < 6; i++) {
    const strand = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.8, 0.06),
      new THREE.MeshStandardMaterial({ color: hairColor, roughness: 1, flatShading: true })
    );
    const ang = (i / 6) * TAU + Math.random() * 0.3;
    strand.position.set(Math.cos(ang) * 0.25, 1.7, Math.sin(ang) * 0.25);
    wookGroup.add(strand);
  }

  // Bucket hat
  const hat = new THREE.Mesh(
    new THREE.CylinderGeometry(0.4, 0.4, 0.18, 14),
    new THREE.MeshStandardMaterial({ color: 0xc77dff, roughness: 0.8 })
  );
  hat.position.y = 2.4;
  wookGroup.add(hat);
  const brim = new THREE.Mesh(
    new THREE.CylinderGeometry(0.55, 0.55, 0.05, 14),
    new THREE.MeshStandardMaterial({ color: 0xc77dff, roughness: 0.8 })
  );
  brim.position.y = 2.32;
  wookGroup.add(brim);

  g.add(wookGroup);
  return g;
}

// =================================================================
// Helpers
// =================================================================

function makeSimpleNPC(shirtHex, skinHex) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.32, 1.0, 4, 8),
    new THREE.MeshStandardMaterial({ color: shirtHex, roughness: 0.9, flatShading: true })
  );
  body.position.y = 0.85;
  body.castShadow = true;
  g.add(body);
  const head = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.28, 1),
    new THREE.MeshStandardMaterial({ color: skinHex, roughness: 0.9, flatShading: true })
  );
  head.position.y = 1.65;
  head.castShadow = true;
  g.add(head);
  return g;
}

function pathLength(path) {
  let total = 0;
  for (let i = 0; i < path.length; i++) {
    const a = path[i];
    const b = path[(i + 1) % path.length];
    total += a.distanceTo(b);
  }
  return total;
}

function samplePath(path, distance, outPos, outDir) {
  let remaining = distance;
  for (let i = 0; i < path.length; i++) {
    const a = path[i];
    const b = path[(i + 1) % path.length];
    const seg = a.distanceTo(b);
    if (remaining <= seg) {
      const t = remaining / seg;
      outPos.lerpVectors(a, b, t);
      outDir.subVectors(b, a).normalize();
      return { pos: outPos, dir: outDir };
    }
    remaining -= seg;
  }
  outPos.copy(path[0]);
  outDir.set(0, 0, 1);
  return { pos: outPos, dir: outDir };
}
