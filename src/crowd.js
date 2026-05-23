// Crowd: festival-goers scattered around stages and tents. They watch Zerble; when
// they're charmed enough, they emit a smile.

import * as THREE from 'three';

const CROWD_COUNT = 110;
const SMILE_CONE_DEG = 80;    // half-angle of Zerble's "look at me" zone
const SMILE_RANGE = 18;
const BUBBLE_RANGE = 6;
const HAPPINESS_THRESHOLD = 0.7;
const COOLDOWN = 10;          // seconds before a single NPC can smile again
const HONK_BOOST = 0.8;       // happiness instantly added by an in-range honk
const HONK_RANGE = 14;

const SHIRT_PALETTE = [
  0xff6f9c, 0xffd28a, 0x6fcf6a, 0x66d9ff, 0xb285ff,
  0xff8a5b, 0xf2e8cf, 0x8ecae6, 0xffb703, 0xc77dff,
  0x7bd389, 0xe07a5f, 0x81b29a, 0xf4a261,
];

export class Crowd {
  constructor(smiles) {
    this.group = new THREE.Group();
    this.group.name = 'Crowd';
    this.smiles = smiles;
    this.people = [];

    this._buildBatched();
  }

  _buildBatched() {
    // We use one InstancedMesh per body part to keep draw calls low.
    const bodyGeo = new THREE.CapsuleGeometry(0.32, 1.0, 4, 8);
    const headGeo = new THREE.IcosahedronGeometry(0.28, 1);

    // We need per-instance color, so use MeshStandardMaterial with vertexColors-via-instanceColor.
    const bodyMat = new THREE.MeshStandardMaterial({ roughness: 0.85, flatShading: true });
    const headMat = new THREE.MeshStandardMaterial({ color: 0xe6c098, roughness: 0.9, flatShading: true });

    this.bodyMesh = new THREE.InstancedMesh(bodyGeo, bodyMat, CROWD_COUNT);
    this.headMesh = new THREE.InstancedMesh(headGeo, headMat, CROWD_COUNT);
    this.bodyMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CROWD_COUNT * 3), 3);
    this.bodyMesh.castShadow = true;
    this.headMesh.castShadow = true;
    this.group.add(this.bodyMesh);
    this.group.add(this.headMesh);

    // Distribute people in clusters near the stages and along the path.
    const clusters = [
      { x: 0, z: -60, r: 22, count: 30 },    // Main stage front
      { x: -40, z: 30, r: 18, count: 18 },   // Side stage left
      { x: 50, z: 30, r: 18, count: 18 },    // Side stage right
      { x: 0, z: 70, r: 25, count: 22 },     // Drum circle / open lawn
      { x: -80, z: -40, r: 18, count: 12 },  // Vendor lawn
      { x: 80, z: -20, r: 15, count: 10 },   // Foodtruck plaza
    ];

    const mat4 = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const vScale = new THREE.Vector3(1, 1, 1);
    const c = new THREE.Color();

    let idx = 0;
    for (const cluster of clusters) {
      for (let i = 0; i < cluster.count && idx < CROWD_COUNT; i++, idx++) {
        const ang = Math.random() * Math.PI * 2;
        const rad = Math.sqrt(Math.random()) * cluster.r;
        const x = cluster.x + Math.cos(ang) * rad;
        const z = cluster.z + Math.sin(ang) * rad;
        const yawSeed = Math.random() * Math.PI * 2;

        const shirt = SHIRT_PALETTE[Math.floor(Math.random() * SHIRT_PALETTE.length)];
        c.setHex(shirt);
        this.bodyMesh.instanceColor.setXYZ(idx, c.r, c.g, c.b);

        const person = {
          idx,
          pos: new THREE.Vector3(x, 0, z),
          yaw: yawSeed,
          baseYaw: yawSeed,
          happiness: 0,
          cooldownLeft: 0,
          bob: Math.random() * Math.PI * 2,
          shirt,
          scale: 0.85 + Math.random() * 0.35,
        };
        this.people.push(person);

        this._writeMatrices(person);
      }
    }

    // Anyone left, drop into the loose ambient pool.
    while (idx < CROWD_COUNT) {
      const ang = Math.random() * Math.PI * 2;
      const rad = 30 + Math.random() * 140;
      const x = Math.cos(ang) * rad;
      const z = Math.sin(ang) * rad;
      const shirt = SHIRT_PALETTE[Math.floor(Math.random() * SHIRT_PALETTE.length)];
      c.setHex(shirt);
      this.bodyMesh.instanceColor.setXYZ(idx, c.r, c.g, c.b);
      const person = {
        idx,
        pos: new THREE.Vector3(x, 0, z),
        yaw: Math.random() * Math.PI * 2,
        baseYaw: 0,
        happiness: 0,
        cooldownLeft: 0,
        bob: Math.random() * Math.PI * 2,
        shirt,
        scale: 0.85 + Math.random() * 0.35,
      };
      this.people.push(person);
      this._writeMatrices(person);
      idx++;
    }

    this.bodyMesh.instanceMatrix.needsUpdate = true;
    this.headMesh.instanceMatrix.needsUpdate = true;
    this.bodyMesh.instanceColor.needsUpdate = true;

    // Reusables for update loop
    this._mat4 = new THREE.Matrix4();
    this._toZerble = new THREE.Vector3();
  }

  _writeMatrices(person) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, person.yaw, 0));
    const bobY = Math.sin(person.bob) * 0.04;
    m.compose(
      new THREE.Vector3(person.pos.x, 0.85 * person.scale + bobY, person.pos.z),
      q,
      new THREE.Vector3(person.scale, person.scale, person.scale)
    );
    this.bodyMesh.setMatrixAt(person.idx, m);

    m.compose(
      new THREE.Vector3(person.pos.x, 1.65 * person.scale + bobY, person.pos.z),
      q,
      new THREE.Vector3(person.scale, person.scale, person.scale)
    );
    this.headMesh.setMatrixAt(person.idx, m);
  }

  update(dt, zerble, bubbles) {
    const cosCone = Math.cos((SMILE_CONE_DEG * Math.PI) / 180);
    const t = performance.now() * 0.001;

    // Build a small array of nearby bubble positions for cheap proximity checks
    const bubblePositions = [];
    if (bubbles) {
      bubbles.forEachAlive((b) => {
        bubblePositions.push(b.pos);
      });
    }

    for (const p of this.people) {
      if (p.cooldownLeft > 0) p.cooldownLeft -= dt;

      // Animate bobbing/yaw
      p.bob += dt * (1 + 0.3 * Math.sin(p.idx));

      // Distance to Zerble
      this._toZerble.set(zerble.position.x - p.pos.x, 0, zerble.position.z - p.pos.z);
      const dist = this._toZerble.length();

      // Face toward Zerble if he's nearby (so the crowd visibly watches)
      if (dist < SMILE_RANGE * 1.4) {
        const targetYaw = Math.atan2(this._toZerble.x, this._toZerble.z);
        const dy = wrapAngle(targetYaw - p.yaw);
        p.yaw += dy * Math.min(1, dt * 3);
      } else {
        // Drift back toward base yaw
        const dy = wrapAngle(p.baseYaw - p.yaw);
        p.yaw += dy * Math.min(1, dt * 0.5);
      }

      // Charm logic only if not on cooldown and within range
      if (p.cooldownLeft <= 0 && dist < SMILE_RANGE) {
        // Eye-contact bonus: is Zerble within the NPC's forward viewing cone?
        // (We compute relative to Zerble's eye direction: is NPC in Zerble's front?)
        const fwd = zerble.forwardWorld;
        const dx = p.pos.x - zerble.position.x;
        const dz = p.pos.z - zerble.position.z;
        const dlen = Math.hypot(dx, dz) || 1;
        const dot = (dx / dlen) * fwd.x + (dz / dlen) * fwd.z;

        let gain = 0;
        if (dot > cosCone) {
          // Stronger at close range and well-centered
          const closeness = 1 - dist / SMILE_RANGE;
          const aim = (dot - cosCone) / (1 - cosCone);
          gain += 1.2 * closeness * (0.4 + 0.6 * aim);
        }

        // Bubble charm: if any bubble is within range
        for (const bp of bubblePositions) {
          const bd = Math.hypot(bp.x - p.pos.x, bp.z - p.pos.z);
          if (bd < BUBBLE_RANGE) {
            gain += 1.0 * (1 - bd / BUBBLE_RANGE);
            break;
          }
        }

        if (gain > 0) p.happiness += gain * dt;

        if (p.happiness >= HAPPINESS_THRESHOLD) {
          p.happiness = 0;
          p.cooldownLeft = COOLDOWN;
          this.smiles.spawn(p.pos);
        }
      } else {
        // Slow decay
        p.happiness = Math.max(0, p.happiness - dt * 0.2);
      }

      this._writeMatrices(p);
    }

    this.bodyMesh.instanceMatrix.needsUpdate = true;
    this.headMesh.instanceMatrix.needsUpdate = true;
  }

  // Called when Zerble honks.
  applyHonk(zerble) {
    for (const p of this.people) {
      const dx = p.pos.x - zerble.position.x;
      const dz = p.pos.z - zerble.position.z;
      const d = Math.hypot(dx, dz);
      if (d < HONK_RANGE && p.cooldownLeft <= 0) {
        const k = 1 - d / HONK_RANGE;
        p.happiness += HONK_BOOST * k;
        if (p.happiness >= HAPPINESS_THRESHOLD) {
          p.happiness = 0;
          p.cooldownLeft = COOLDOWN;
          this.smiles.spawn(p.pos);
        }
      }
    }
  }
}

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
