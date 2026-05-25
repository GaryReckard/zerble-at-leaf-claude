// Crowd v2: pool of stateful NPCs spawned by chunks.
//
// Each NPC has:
//   - a personality (curiosity, skittishness, energy, social, talkativeness)
//   - a state: idle | walking | watching | approaching | fleeing | smiling
//   - a target (a registered attractor or random spot)
//   - a group affiliation (optional; group members hover near each other)
//
// Movement uses simple steering: seek target, repel from buildings (via registry),
// repel from neighbors slightly (separation), and a path-attraction nudge toward
// the chunk grid lines so people *tend* to use the dirt paths but don't have to.
//
// Smile mechanic:
//   - Eye-contact + bubble proximity raise happiness.
//   - On threshold: emit a smile pickup, record Zerble's position at-smile.
//   - The same NPC can't smile again until Zerble has driven SMILE_RESET_DIST
//     away (avoids parking-near-crowd farming) AND a small time cooldown.

import * as THREE from 'three';
// BufferGeometryUtils has no default-namespace export — it's a flat ES module.
// `import * as` collects all named exports under one identifier so we can keep
// the `BufferGeometryUtils.mergeGeometries(...)` call style.
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { registry } from './registry.js';
import { PERF } from './perf.js';
import { CHUNK_SIZE } from './chunks.js';

const MAX_NPCS = PERF.crowdMax;

// Despawn NPCs that drift more than this far from Zerble. Anchored to the
// chunk-load radius so we keep NPCs alive across the area that's actually
// rendered, plus a half-chunk buffer to avoid visible blink-out at the edge.
// Riding/boarding NPCs are exempt — they're physically tied to the cart.
const DESPAWN_RADIUS = (PERF.chunkUnloadRadius + 0.5) * CHUNK_SIZE;
const DESPAWN_R2 = DESPAWN_RADIUS * DESPAWN_RADIUS;
const NPC_ROW_SHIRT = [
  0xff6f9c, 0xffd28a, 0x6fcf6a, 0x66d9ff, 0xb285ff,
  0xff8a5b, 0xf2e8cf, 0x8ecae6, 0xffb703, 0xc77dff,
  0x7bd389, 0xe07a5f, 0x81b29a, 0xf4a261,
];

// Awareness / charm
const NOTICE_RANGE = 22;             // NPC starts paying attention to Zerble
const SMILE_RANGE = 18;
const SMILE_CONE_DEG = 80;
const BUBBLE_RANGE = 6;
const HAPPINESS_THRESHOLD = 0.7;
const SMILE_RESET_DIST = 28;         // Zerble must drive this far for the same NPC to smile again
const SMILE_TIME_COOLDOWN = 3;       // ...AND wait this long
const HONK_BOOST = 0.8;
const HONK_RANGE = 14;

// Passenger system
const MAX_PASSENGERS = 10;
const ZERBLE_IDLE_SPEED = 0.6;       // |speed| below this counts as idle
const BOARD_RANGE = 1.3;              // close enough to a seat to sit down
const PASSENGER_BOARD_CHANCE_PER_SEC = 0.45;
const RIDE_MIN_TIME = 15;
const RIDE_MAX_TIME = 75;

// Behavior
const PATH_GRID = 80;                // matches CHUNK_SIZE — paths run along multiples of this
const PATH_PULL_WIDTH = 4;           // how wide the "near path" band is
const BUILDING_AVOID_RADIUS = 4;     // extra buffer beyond footprint
const SEPARATION_RADIUS = 1.9;       // soft separation force kicks in within this
const HARD_SEPARATION = 0.85;        // never let two NPCs get closer than this
const ARRIVE_RADIUS = 1.5;

export class Crowd {
  constructor(smiles) {
    this.smiles = smiles;
    this.npcs = [];
    this.free = []; // indices available
    this.groups = new Map(); // groupId -> { center: Vector3, members: [npcs] }

    this._buildInstanced();
  }

  _buildInstanced() {
    // ---- Legs: two cylinders merged, offsets baked into geometry ----
    const legL = new THREE.CylinderGeometry(0.10, 0.10, 0.65, 6);
    legL.translate(-0.12, 0.325, 0);
    const legR = new THREE.CylinderGeometry(0.10, 0.10, 0.65, 6);
    legR.translate(0.12, 0.325, 0);
    const legsGeo = BufferGeometryUtils.mergeGeometries([legL, legR]);
    legL.dispose(); legR.dispose();

    // ---- Shoes: two boxes merged, offsets baked in ----
    const shoeL = new THREE.BoxGeometry(0.16, 0.07, 0.24);
    shoeL.translate(-0.12, 0.035, -0.06);
    const shoeR = new THREE.BoxGeometry(0.16, 0.07, 0.24);
    shoeR.translate(0.12, 0.035, -0.06);
    const shoesGeo = BufferGeometryUtils.mergeGeometries([shoeL, shoeR]);
    shoeL.dispose(); shoeR.dispose();

    // ---- Body (torso): capsule centered at y=1.0 ----
    const bodyGeo = new THREE.CapsuleGeometry(0.26, 0.55, 3, 6);
    bodyGeo.translate(0, 1.0, 0);

    // ---- Arms: two single-segment capsules merged, shoulders at (±0.30, 1.10, 0) ----
    const armL = new THREE.CapsuleGeometry(0.075, 0.5, 3, 6);
    armL.translate(-0.30, 1.10, 0);
    const armR = new THREE.CapsuleGeometry(0.075, 0.5, 3, 6);
    armR.translate(0.30, 1.10, 0);
    const armsGeo = BufferGeometryUtils.mergeGeometries([armL, armR]);
    armL.dispose(); armR.dispose();

    // ---- Head: icosahedron at y=1.65 ----
    const headGeo = new THREE.IcosahedronGeometry(0.26, 1);
    headGeo.translate(0, 1.65, 0);

    // ---- Eyes: two small spheres baked at NPC-local (±0.08, 1.68, -0.22) ----
    const eyeL = new THREE.SphereGeometry(0.028, 6, 6);
    eyeL.translate(-0.08, 1.68, -0.22);
    const eyeR = new THREE.SphereGeometry(0.028, 6, 6);
    eyeR.translate(0.08, 1.68, -0.22);
    const eyesGeo = BufferGeometryUtils.mergeGeometries([eyeL, eyeR]);
    eyeL.dispose(); eyeR.dispose();

    // ---- Mouth: half-torus smile arc baked at the ORIGIN (positioned via matrix) ----
    // TorusGeometry lies in XY plane; default arc is top half. rotateZ(PI) flips it
    // so the arc opens upward (smile shape). Baked at origin so per-NPC matrix can
    // apply scale around its local center for the smile-pop effect.
    const mouthGeo = new THREE.TorusGeometry(0.06, 0.012, 4, 8, Math.PI);
    mouthGeo.rotateZ(Math.PI);

    // ---- Materials ----
    const legsMat  = new THREE.MeshStandardMaterial({ color: 0x223a5c, roughness: 0.92, flatShading: true });
    const shoesMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8,  flatShading: true });
    const bodyMat  = new THREE.MeshStandardMaterial({ roughness: 0.85, flatShading: true });
    const armsMat  = new THREE.MeshStandardMaterial({ roughness: 0.85, flatShading: true });
    const headMat  = new THREE.MeshStandardMaterial({ color: 0xe6c098, roughness: 0.9,  flatShading: true });
    const featureMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 });

    // ---- InstancedMeshes ----
    this.legsMesh  = new THREE.InstancedMesh(legsGeo,  legsMat,  MAX_NPCS);
    this.shoesMesh = new THREE.InstancedMesh(shoesGeo, shoesMat, MAX_NPCS);
    this.bodyMesh  = new THREE.InstancedMesh(bodyGeo,  bodyMat,  MAX_NPCS);
    this.armsMesh  = new THREE.InstancedMesh(armsGeo,  armsMat,  MAX_NPCS);
    this.headMesh  = new THREE.InstancedMesh(headGeo,  headMat,  MAX_NPCS);
    this.eyesMesh  = new THREE.InstancedMesh(eyesGeo,  featureMat, MAX_NPCS);
    this.mouthMesh = new THREE.InstancedMesh(mouthGeo, featureMat, MAX_NPCS);

    // Per-NPC shirt color shared between body and arms (sleeves).
    this.bodyMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_NPCS * 3), 3);
    this.armsMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_NPCS * 3), 3);

    // InstancedMesh frustum culling uses a bounding sphere that's computed once
    // and cached — it does NOT auto-expand when instance matrices move. As
    // Zerble drives far from spawn, the cached sphere falls behind the camera
    // and the entire crowd vanishes (while game logic keeps running →
    // invisible collisions, invisible smiles). Bubbles already disables
    // culling for the same reason. One drawcall per mesh either way.
    const allMeshes = [this.legsMesh, this.shoesMesh, this.bodyMesh, this.armsMesh, this.headMesh, this.eyesMesh, this.mouthMesh];
    for (const m of allMeshes) {
      m.castShadow = PERF.shadows;
      m.frustumCulled = false;
      m.count = MAX_NPCS;
    }

    this.group = new THREE.Group();
    this.group.name = 'Crowd';
    for (const m of allMeshes) this.group.add(m);

    // Hide all slots initially (zero-scale matrix = invisible).
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < MAX_NPCS; i++) {
      for (const m of allMeshes) m.setMatrixAt(i, zero);
      this.free.push(i);
    }
    for (const m of allMeshes) m.instanceMatrix.needsUpdate = true;

    // Reusables — must be DISTINCT Vector3 instances; reusing one for both
    // position and scale args of Matrix4.compose() silently corrupts position.
    this._mat4 = new THREE.Matrix4();
    this._tmpV = new THREE.Vector3();
    this._tmpV2 = new THREE.Vector3();
    this._tmpV3 = new THREE.Vector3();
    this._tmpQuat = new THREE.Quaternion();
    this._tmpEuler = new THREE.Euler();
    this._tmpDanceMat = new THREE.Matrix4();
    this._tmpScale = new THREE.Vector3();
    this._mouthMat = new THREE.Matrix4();

    // High-water mark: highest slot index ever written. count is set to
    // _maxIdx + 1 each frame so three.js skips unwritten slots above it.
    this._maxIdx = -1;
  }

  // Called by chunk generator.
  spawn({ pos, chunkKey, rng = Math.random }) {
    if (this.free.length === 0) return null;
    const idx = this.free.pop();

    // Personality
    const curiosity = rng();
    const skittish = (1 - curiosity) * rng();        // can't be both bold AND skittish
    const social = rng();
    const energy = 0.6 + rng() * 0.7;
    const dance = rng();                              // some people sway in place to music

    // Group: probability based on sociability
    let groupId = null;
    if (social > 0.55) {
      // Try to join an existing nearby group, else start one
      let joined = false;
      for (const [gid, g] of this.groups) {
        if (pos.distanceTo(g.center) < 9 && g.members.length < 6) {
          groupId = gid;
          g.members.push(idx);
          joined = true;
          break;
        }
      }
      if (!joined) {
        groupId = `g${idx}`;
        this.groups.set(groupId, { center: pos.clone(), members: [idx] });
      }
    }

    const shirt = NPC_ROW_SHIRT[Math.floor(rng() * NPC_ROW_SHIRT.length)];

    const npc = {
      idx,
      pos: pos.clone(),
      vel: new THREE.Vector3(),
      target: pos.clone(),
      yaw: rng() * Math.PI * 2,
      baseYaw: rng() * Math.PI * 2,
      bob: rng() * Math.PI * 2,
      scale: 0.85 + rng() * 0.4,
      shirt,

      state: 'idle',
      stateTimer: rng() * 2,

      // Personality
      curiosity,
      skittish,
      social,
      energy,
      dance,

      // Group
      groupId,

      // Charm
      happiness: 0,
      smileTimeCooldown: 0,
      lastSmilePos: null,    // Zerble's position when this NPC last smiled

      chunkKey,
    };

    this.npcs.push(npc);

    // Track the highest-ever slot index so we can narrow draw count each frame.
    if (idx > this._maxIdx) this._maxIdx = idx;

    // Color — shirt applied to both body (torso) and arms (sleeves) so they match.
    const c = new THREE.Color(shirt);
    this.bodyMesh.instanceColor.setXYZ(idx, c.r, c.g, c.b);
    this.bodyMesh.instanceColor.needsUpdate = true;
    this.armsMesh.instanceColor.setXYZ(idx, c.r, c.g, c.b);
    this.armsMesh.instanceColor.needsUpdate = true;

    // Initial transform
    this._writeMatrices(npc);

    return npc;
  }

  // Kept as a no-op for chunk-unload back-compat. Lifecycle is now driven by
  // distance from Zerble in update() — that way NPCs who wander across chunk
  // boundaries don't blink out when their *spawn* chunk unloads, and NPCs in
  // a still-loaded chunk don't linger after they've drifted out of view.
  unloadChunk(_chunkKey) {
    // intentionally empty
  }

  // Despawn NPCs farther than DESPAWN_RADIUS from Zerble. Skips riders and
  // boarders so passengers can't get yanked off the cart. Called from update().
  _despawnDistant(zerble) {
    const zx = zerble.position.x;
    const zz = zerble.position.z;
    const kept = [];
    const zero = this._zeroMat || (this._zeroMat = new THREE.Matrix4().makeScale(0, 0, 0));
    let freed = 0;
    for (const npc of this.npcs) {
      if (npc.state === 'riding' || npc.state === 'boarding') {
        kept.push(npc);
        continue;
      }
      const dx = npc.pos.x - zx;
      const dz = npc.pos.z - zz;
      if (dx * dx + dz * dz > DESPAWN_R2) {
        if (npc.seatSlot) {
          npc.seatSlot.occupied = false;
          npc.seatSlot = null;
        }
        // Release any hammock claim so it can be re-used.
        if (npc.hammockEntry && npc.hammockEntry.hammock) {
          npc.hammockEntry.hammock.occupied = false;
          npc.hammockEntry = null;
        }
        // Remove from any group it belonged to so dead idx's don't leak.
        if (npc.groupId) {
          const g = this.groups.get(npc.groupId);
          if (g) {
            const i = g.members.indexOf(npc.idx);
            if (i >= 0) g.members.splice(i, 1);
            if (g.members.length === 0) this.groups.delete(npc.groupId);
          }
        }
        this.legsMesh.setMatrixAt(npc.idx, zero);
        this.shoesMesh.setMatrixAt(npc.idx, zero);
        this.bodyMesh.setMatrixAt(npc.idx, zero);
        this.armsMesh.setMatrixAt(npc.idx, zero);
        this.headMesh.setMatrixAt(npc.idx, zero);
        this.eyesMesh.setMatrixAt(npc.idx, zero);
        this.mouthMesh.setMatrixAt(npc.idx, zero);
        this.free.push(npc.idx);
        freed++;
      } else {
        kept.push(npc);
      }
    }
    if (freed > 0) {
      this.npcs = kept;
      this.legsMesh.instanceMatrix.needsUpdate = true;
      this.shoesMesh.instanceMatrix.needsUpdate = true;
      this.bodyMesh.instanceMatrix.needsUpdate = true;
      this.armsMesh.instanceMatrix.needsUpdate = true;
      this.headMesh.instanceMatrix.needsUpdate = true;
      this.eyesMesh.instanceMatrix.needsUpdate = true;
      this.mouthMesh.instanceMatrix.needsUpdate = true;
    }
  }

  // -------------- per-frame --------------

  update(dt, zerble, bubbles) {
    // First sweep: free any NPC who has drifted too far from Zerble. Lifecycle
    // is intentionally distance-based (not chunk-based) so wandering NPCs
    // don't vanish when their spawn chunk unloads.
    this._despawnDistant(zerble);

    const cosCone = Math.cos((SMILE_CONE_DEG * Math.PI) / 180);

    // Collect live bubble positions once per frame
    const bubblePositions = [];
    if (bubbles) bubbles.forEachAlive((b) => bubblePositions.push(b.pos));

    // Passenger bookkeeping: count active passengers + record Zerble idle state
    const zerbleIdle = Math.abs(zerble.speed) < ZERBLE_IDLE_SPEED;
    let activePassengers = 0;
    for (const n of this.npcs) {
      if (n.state === 'boarding' || n.state === 'riding') activePassengers++;
    }

    for (const npc of this.npcs) {
      this._updateNpc(dt, npc, zerble, bubblePositions, cosCone, {
        zerbleIdle,
        activePassengersRef: { count: activePassengers, add: () => activePassengers++ },
      });
    }

    this.legsMesh.instanceMatrix.needsUpdate = true;
    this.shoesMesh.instanceMatrix.needsUpdate = true;
    this.bodyMesh.instanceMatrix.needsUpdate = true;
    this.armsMesh.instanceMatrix.needsUpdate = true;
    this.headMesh.instanceMatrix.needsUpdate = true;
    this.eyesMesh.instanceMatrix.needsUpdate = true;
    this.mouthMesh.instanceMatrix.needsUpdate = true;
    // Narrow draw count to the highest slot ever written + 1. Slots above
    // _maxIdx are untouched (zero matrix from init) and never drawn. Slots
    // below that mark that have been despawned are still in range but carry a
    // zero-scale matrix so the GPU skips them at near-zero cost.
    const drawCount = this._maxIdx + 1;
    if (drawCount < MAX_NPCS) {
      this.legsMesh.count = drawCount;
      this.shoesMesh.count = drawCount;
      this.bodyMesh.count = drawCount;
      this.armsMesh.count = drawCount;
      this.headMesh.count = drawCount;
      this.eyesMesh.count = drawCount;
      this.mouthMesh.count = drawCount;
    }
  }

  _updateNpc(dt, npc, zerble, bubblePositions, cosCone, ctx) {
    if (npc.smileTimeCooldown > 0) npc.smileTimeCooldown -= dt;
    npc.stateTimer -= dt;
    npc.bob += dt * (1 + 0.4 * npc.dance);
    if (npc.rideTimer != null) npc.rideTimer -= dt;

    const dx = zerble.position.x - npc.pos.x;
    const dz = zerble.position.z - npc.pos.z;
    const dToZerble = Math.hypot(dx, dz);

    // --- Passenger states get their OWN handling (skip the proximity switch below) ---
    if (npc.state === 'riding') {
      this._tickRiding(dt, npc, zerble);
      return;
    }
    if (npc.state === 'boarding') {
      this._tickBoarding(dt, npc, zerble, ctx);
      return;
    }
    if (npc.state === 'hammock_riding') {
      this._tickHammockRiding(dt, npc);
      return;
    }
    if (npc.state === 'walking_to_hammock') {
      // If Zerble shows up nearby and the NPC is curious, abort the hammock plan.
      if (dToZerble < SMILE_RANGE && npc.curiosity > 0.65) {
        this._releaseHammock(npc);
        npc.state = 'approaching';
      } else if (this._tickWalkingToHammock(dt, npc)) {
        return;
      }
    }
    if (npc.state === 'disembarking') {
      this._tickDisembarking(dt, npc);
      // fall through to normal walking logic
    }

    // --- state transitions driven by Zerble proximity ---
    if (dToZerble < NOTICE_RANGE) {
      if (npc.skittish > 0.55 && dToZerble < SMILE_RANGE * 0.6) {
        npc.state = 'fleeing';
      } else if (npc.curiosity > 0.65 && dToZerble < NOTICE_RANGE && dToZerble > 4) {
        npc.state = 'approaching';
      } else {
        npc.state = 'watching';
      }

      // Boarding trigger: idle Zerble + curious NPC + open seat + under passenger cap
      if (
        ctx.zerbleIdle &&
        npc.curiosity > 0.45 &&
        ctx.activePassengersRef.count < MAX_PASSENGERS &&
        dToZerble < 12 &&
        Math.random() < PASSENGER_BOARD_CHANCE_PER_SEC * dt
      ) {
        const slot = this._claimFreeSeat(zerble);
        if (slot) {
          npc.state = 'boarding';
          npc.seatSlot = slot;
          npc.stateTimer = 20; // give up trying after 20s if we can't reach
          ctx.activePassengersRef.add();
          return;
        }
      }
    } else if (npc.state !== 'idle' && npc.state !== 'walking' && npc.state !== 'disembarking') {
      // Lost interest — go back to ambient behavior
      npc.state = 'idle';
      npc.stateTimer = 1 + Math.random() * 3;
    }

    // --- choose movement target based on state ---
    let speed = 0;
    let desiredX = npc.pos.x;
    let desiredZ = npc.pos.z;

    switch (npc.state) {
      case 'idle': {
        // Occasionally try to claim a nearby unoccupied hammock. Tired/sociable
        // NPCs are slightly more likely to nap; skittish ones almost never.
        if (
          npc.skittish < 0.5 &&
          npc.stateTimer < 5 &&
          Math.random() < dt * 0.05
        ) {
          const claimed = this._tryClaimHammock(npc);
          if (claimed) break;
        }
        if (npc.stateTimer <= 0) {
          // Pick a new wander target: prefer an attractor, else random nearby spot.
          // Target a RING around the attractor (40-100% of its radius) so crowds
          // distribute around the POI instead of all piling on the same center spot.
          const at = registry.pickAttractor(Math.random);
          if (at && Math.hypot(at.position.x - npc.pos.x, at.position.z - npc.pos.z) < 60) {
            const ang = Math.random() * Math.PI * 2;
            const rad = (0.4 + Math.random() * 0.6) * at.radius;
            npc.target.set(
              at.position.x + Math.cos(ang) * rad,
              0,
              at.position.z + Math.sin(ang) * rad,
            );
          } else {
            npc.target.set(
              npc.pos.x + (Math.random() - 0.5) * 18,
              0,
              npc.pos.z + (Math.random() - 0.5) * 18
            );
          }
          npc.state = 'walking';
          npc.stateTimer = 10 + Math.random() * 12;
        }
        // Tiny in-place sway driven by music dance
        npc.yaw += Math.sin(npc.bob * 0.5) * 0.01 * npc.dance;
        break;
      }

      case 'walking': {
        const tdx = npc.target.x - npc.pos.x;
        const tdz = npc.target.z - npc.pos.z;
        const td = Math.hypot(tdx, tdz);
        if (td < ARRIVE_RADIUS || npc.stateTimer <= 0) {
          npc.state = 'idle';
          npc.stateTimer = 2 + Math.random() * 6;
        } else {
          desiredX = tdx / td;
          desiredZ = tdz / td;
          speed = 1.4 * npc.energy;
        }
        break;
      }

      case 'watching': {
        // Face Zerble; tiny dance bob if music-y
        const target = Math.atan2(-dx, -dz);
        const diff = wrapAngle(target - npc.yaw);
        npc.yaw += diff * Math.min(1, dt * 6);
        break;
      }

      case 'approaching': {
        // Walk toward Zerble, but stop ~5m away
        if (dToZerble > 5.5) {
          const inv = 1 / (dToZerble || 1);
          desiredX = dx * inv;
          desiredZ = dz * inv;
          speed = 1.7 * npc.energy;
        } else {
          npc.state = 'watching';
        }
        const target = Math.atan2(-dx, -dz);
        const diff = wrapAngle(target - npc.yaw);
        npc.yaw += diff * Math.min(1, dt * 6);
        break;
      }

      case 'fleeing': {
        // Run perpendicular-away from Zerble (so they get out of his lane)
        const inv = 1 / (dToZerble || 1);
        // Bias 70% direct away, 30% sideways for a more natural scatter
        const awayX = -dx * inv;
        const awayZ = -dz * inv;
        const sideX = -dz * inv;
        const sideZ = dx * inv;
        const sideSign = (npc.idx % 2 === 0) ? 1 : -1;
        desiredX = awayX * 0.7 + sideX * 0.3 * sideSign;
        desiredZ = awayZ * 0.7 + sideZ * 0.3 * sideSign;
        const dn = Math.hypot(desiredX, desiredZ) || 1;
        desiredX /= dn;
        desiredZ /= dn;
        speed = 3.5 * npc.energy;
        const lookDir = Math.atan2(-desiredX, -desiredZ);
        npc.yaw = lookDir;
        if (dToZerble > NOTICE_RANGE + 4) {
          npc.state = 'idle';
          npc.stateTimer = 2;
        }
        break;
      }
    }

    // --- NPC-NPC separation (always active — prevents the cluster-stack bug) ---
    let sepX = 0, sepZ = 0, sepCount = 0;
    let overlapPushX = 0, overlapPushZ = 0;
    for (const other of this.npcs) {
      if (other === npc || other.state === 'riding') continue;
      const ox = npc.pos.x - other.pos.x;
      const oz = npc.pos.z - other.pos.z;
      const d2 = ox * ox + oz * oz;
      if (d2 > 0 && d2 < SEPARATION_RADIUS * SEPARATION_RADIUS) {
        const d = Math.sqrt(d2);
        const inv = 1 / d;
        const force = (SEPARATION_RADIUS - d) / SEPARATION_RADIUS;
        sepX += ox * inv * force;
        sepZ += oz * inv * force;
        sepCount++;
        // Hard floor: directly resolve overlap if very close
        if (d < HARD_SEPARATION) {
          const push = (HARD_SEPARATION - d) * 0.5;
          overlapPushX += ox * inv * push;
          overlapPushZ += oz * inv * push;
        }
      }
    }
    // Apply hard-overlap push instantly (so NPCs never visually stack)
    npc.pos.x += overlapPushX;
    npc.pos.z += overlapPushZ;

    // --- steering modifiers ---
    if (speed > 0) {
      // Path attraction: nudge toward the nearest path grid line
      const px = Math.round(npc.pos.x / PATH_GRID) * PATH_GRID;
      const pz = Math.round(npc.pos.z / PATH_GRID) * PATH_GRID;
      const offX = px - npc.pos.x;
      const offZ = pz - npc.pos.z;
      const closestPathOffset = Math.abs(offX) < Math.abs(offZ)
        ? { x: offX, z: 0 }
        : { x: 0, z: offZ };
      const pathDist = Math.hypot(closestPathOffset.x, closestPathOffset.z);
      if (pathDist > PATH_PULL_WIDTH) {
        const pull = THREE.MathUtils.clamp((pathDist - PATH_PULL_WIDTH) / 20, 0, 0.4);
        const pn = pathDist || 1;
        desiredX += (closestPathOffset.x / pn) * pull;
        desiredZ += (closestPathOffset.z / pn) * pull;
      }

      // Building avoidance
      const avoid = nearestFootprintAvoidance(npc.pos, BUILDING_AVOID_RADIUS);
      if (avoid) {
        desiredX += avoid.x * avoid.strength;
        desiredZ += avoid.z * avoid.strength;
      }

      // Soft separation contributes to the heading
      if (sepCount > 0) {
        desiredX += sepX * 1.2;
        desiredZ += sepZ * 1.2;
      }

      const dn = Math.hypot(desiredX, desiredZ) || 1;
      desiredX /= dn;
      desiredZ /= dn;

      npc.vel.x = THREE.MathUtils.lerp(npc.vel.x, desiredX * speed, Math.min(1, dt * 4));
      npc.vel.z = THREE.MathUtils.lerp(npc.vel.z, desiredZ * speed, Math.min(1, dt * 4));
    } else {
      // Even when idle, drift apart slowly if neighbors are crowding in
      if (sepCount > 0) {
        npc.vel.x = THREE.MathUtils.lerp(npc.vel.x, sepX * 0.6, Math.min(1, dt * 3));
        npc.vel.z = THREE.MathUtils.lerp(npc.vel.z, sepZ * 0.6, Math.min(1, dt * 3));
      } else {
        npc.vel.multiplyScalar(Math.pow(0.5, dt * 6));
      }
    }

    // Apply velocity
    npc.pos.x += npc.vel.x * dt;
    npc.pos.z += npc.vel.z * dt;

    // Face direction of motion when walking/fleeing/approaching
    if (Math.abs(npc.vel.x) + Math.abs(npc.vel.z) > 0.4 && npc.state !== 'watching') {
      const targetYaw = Math.atan2(-npc.vel.x, -npc.vel.z);
      const diff = wrapAngle(targetYaw - npc.yaw);
      npc.yaw += diff * Math.min(1, dt * 6);
    }

    // --- charm logic ---
    if (
      npc.smileTimeCooldown <= 0 &&
      (npc.lastSmilePos === null || zerble.position.distanceTo(npc.lastSmilePos) > SMILE_RESET_DIST) &&
      dToZerble < SMILE_RANGE
    ) {
      const fwd = zerble.forwardWorld;
      const ndx = npc.pos.x - zerble.position.x;
      const ndz = npc.pos.z - zerble.position.z;
      const ndlen = Math.hypot(ndx, ndz) || 1;
      const dot = (ndx / ndlen) * fwd.x + (ndz / ndlen) * fwd.z;

      let gain = 0;
      if (dot > cosCone) {
        const closeness = 1 - dToZerble / SMILE_RANGE;
        const aim = (dot - cosCone) / (1 - cosCone);
        gain += 1.4 * closeness * (0.4 + 0.6 * aim);
      }
      for (const bp of bubblePositions) {
        const bd = Math.hypot(bp.x - npc.pos.x, bp.z - npc.pos.z);
        if (bd < BUBBLE_RANGE) {
          gain += 1.0 * (1 - bd / BUBBLE_RANGE);
          break;
        }
      }
      // Curious & approaching NPCs charm faster (they're really looking)
      if (npc.state === 'approaching' || npc.state === 'watching') gain *= 1.2;
      // Fleeing NPCs don't smile
      if (npc.state === 'fleeing') gain = 0;

      if (gain > 0) npc.happiness += gain * dt;

      if (npc.happiness >= HAPPINESS_THRESHOLD) {
        npc.happiness = 0;
        npc.smileTimeCooldown = SMILE_TIME_COOLDOWN;
        npc.lastSmilePos = zerble.position.clone();
        this.smiles.spawn(npc.pos);
      }
    } else {
      npc.happiness = Math.max(0, npc.happiness - dt * 0.2);
    }

    // Write transform
    this._writeMatrices(npc);
  }

  _writeMatrices(npc) {
    const m = this._mat4;
    // Reuse scratch Quaternion/Euler — avoids ~30k allocations/sec at 500 NPCs × 60fps.
    const quat = this._tmpQuat.setFromEuler(this._tmpEuler.set(0, npc.yaw, 0));
    const bobY = Math.sin(npc.bob) * 0.04;
    const danceTilt = npc.dance > 0.6 && (npc.state === 'idle' || npc.state === 'watching' || npc.state === 'riding')
      ? Math.sin(npc.bob * 2) * 0.05 * (npc.dance - 0.5)
      : 0;

    // Happy bounce: while smile cooldown is active the body bobs up by a small
    // sin wave (~6cm amplitude) so the whole figure (body + mouth) hops.
    const bouncing = npc.smileTimeCooldown > 0;
    const bounceY = bouncing
      ? Math.abs(Math.sin(performance.now() * 0.012 + npc.bob)) * 0.06
      : 0;

    // All 5 body meshes share one matrix. The matrix's Y = "feet level" for this NPC.
    // Each geometry has its part offset baked in (legs at y≈0.325, torso at y=1.0,
    // arms at y=1.10, head at y=1.65, shoes at y≈0.035). Scale is applied uniformly
    // via compose() so the whole figure scales together from the feet origin.
    //
    // Special states: riding/hammock npcs are lifted off the ground. We derive the
    // feet-equivalent Y from the seat/hammock world height so the torso (baked at +1.0)
    // lands at the right visual position.
    //   - riding:        torso should sit at ≈ seatY - 0.05  →  feet Y = seatY - 1.05
    //   - hammock_riding: torso should sit at ≈ hammockY - 0.1 →  feet Y = hammockY - 1.1
    //   - normal:        feet at ground (npc.pos.y = 0 always from behavior code)
    let feetY;
    if (npc.state === 'riding' && npc.seatY != null) {
      feetY = npc.seatY - 1.05 + bobY + bounceY;
    } else if (npc.state === 'hammock_riding' && npc.hammockY != null) {
      feetY = npc.hammockY - 1.1 + bobY + bounceY;
    } else {
      feetY = bobY + bounceY; // feet on the ground; npc.pos.y is always 0
    }

    // CRITICAL: position and scale must be DISTINCT Vector3 instances.
    // Reusing this._tmpV for both args caused position to be overwritten by scale,
    // making every non-riding NPC render at (scale, scale, scale) ≈ (1,1,1).
    const posV = this._tmpV;
    const scaleV = this._tmpV2;

    posV.set(npc.pos.x, feetY, npc.pos.z);
    scaleV.set(npc.scale, npc.scale, npc.scale);
    m.compose(posV, quat, scaleV);
    if (danceTilt) {
      // Reuse scratch Matrix4 — avoids per-NPC allocation for dancing crowd.
      this._tmpDanceMat.makeRotationZ(danceTilt);
      m.multiply(this._tmpDanceMat);
    }

    // Write the same transform to legs/shoes/body/arms/head/eyes — per-part offsets live in geometry.
    // Eyes also use this matrix (eyes geometry has offsets baked in, no scale reaction).
    this.legsMesh.setMatrixAt(npc.idx, m);
    this.shoesMesh.setMatrixAt(npc.idx, m);
    this.bodyMesh.setMatrixAt(npc.idx, m);
    this.armsMesh.setMatrixAt(npc.idx, m);
    this.headMesh.setMatrixAt(npc.idx, m);
    this.eyesMesh.setMatrixAt(npc.idx, m);

    // ---- Mouth: separate matrix with per-NPC scale for smile-pop effect ----
    // Mouth geometry is baked at origin; we translate it to its face position
    // (in NPC local space → world space) then apply scale so it pops when smiling.
    // The mouth bobs with the body by including bounceY in the world Y.
    const smileScale = npc.smileTimeCooldown > 0 ? 1.0 : 0.3;
    // Rotate the face-local offset (0, 1.55, -0.215) by the NPC's yaw quaternion
    // to get the world offset from npc.pos.
    this._tmpV3.set(0, 1.55, -0.215).applyQuaternion(this._tmpQuat);
    this._tmpV3.x += npc.pos.x;
    this._tmpV3.y += npc.pos.y + bobY + bounceY;
    this._tmpV3.z += npc.pos.z;
    this._tmpScale.set(smileScale, smileScale, smileScale);
    this._mouthMat.compose(this._tmpV3, this._tmpQuat, this._tmpScale);
    this.mouthMesh.setMatrixAt(npc.idx, this._mouthMat);
  }

  // ----- Passenger system helpers -----

  _claimFreeSeat(zerble) {
    if (!zerble.seatSlots) return null;
    // Try slots in a randomized order so passengers don't all stack the same way
    const order = zerble.seatSlots.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (const idx of order) {
      const slot = zerble.seatSlots[idx];
      if (!slot.occupied) {
        slot.occupied = true;
        return slot;
      }
    }
    return null;
  }

  _releaseSeat(slot) {
    if (slot) slot.occupied = false;
  }

  _tickBoarding(dt, npc, zerble, ctx) {
    if (!npc.seatSlot || !ctx.zerbleIdle) {
      // Cart started moving (or we lost our slot) — abort
      this._releaseSeat(npc.seatSlot);
      npc.seatSlot = null;
      npc.state = 'watching';
      npc.stateTimer = 1;
      return;
    }
    const target = this._tmpV;
    zerble.worldSeatPosition(npc.seatSlot, target);

    const tdx = target.x - npc.pos.x;
    const tdz = target.z - npc.pos.z;
    const td = Math.hypot(tdx, tdz);

    if (td < BOARD_RANGE) {
      // Climb aboard
      npc.state = 'riding';
      npc.rideTimer = RIDE_MIN_TIME + Math.random() * (RIDE_MAX_TIME - RIDE_MIN_TIME);
      this._writeMatrices(npc); // snap into place
      return;
    }

    // Steer toward seat at jog speed
    const invD = 1 / (td || 1);
    const dx = tdx * invD;
    const dz = tdz * invD;
    const speed = 2.4 * npc.energy;
    npc.vel.x = THREE.MathUtils.lerp(npc.vel.x, dx * speed, Math.min(1, dt * 6));
    npc.vel.z = THREE.MathUtils.lerp(npc.vel.z, dz * speed, Math.min(1, dt * 6));
    npc.pos.x += npc.vel.x * dt;
    npc.pos.z += npc.vel.z * dt;

    // Face direction of motion
    const targetYaw = Math.atan2(-npc.vel.x, -npc.vel.z);
    const diff = wrapAngle(targetYaw - npc.yaw);
    npc.yaw += diff * Math.min(1, dt * 6);

    // Timeout — give up if we can't reach the seat
    if (npc.stateTimer <= 0) {
      this._releaseSeat(npc.seatSlot);
      npc.seatSlot = null;
      npc.state = 'idle';
      npc.stateTimer = 2;
    }

    this._writeMatrices(npc);
  }

  _tickRiding(dt, npc, zerble) {
    if (!npc.seatSlot) {
      npc.state = 'idle';
      npc.stateTimer = 1;
      return;
    }
    // Lock position to the seat. Face the same way the cart is facing.
    const out = this._tmpV;
    zerble.worldSeatPosition(npc.seatSlot, out);
    npc.pos.x = out.x;
    npc.pos.z = out.z;
    // Stash seat Y on the npc — we use it in _writeMatrices to lift the body.
    npc.seatY = out.y;

    // Yaw matches cart heading (passengers face forward like the cart) plus slot's offset
    npc.yaw = zerble.heading + npc.seatSlot.yaw;

    // Slight dance bob even while riding (extra dance-y characters wiggle a bit)
    npc.bob += dt * (1.2 + 0.6 * npc.dance);

    // Disembark only when Zerble is idle AND ride timer expired
    if (npc.rideTimer <= 0 && Math.abs(zerble.speed) < ZERBLE_IDLE_SPEED) {
      this._releaseSeat(npc.seatSlot);
      const seatPos = { x: out.x, z: out.z };
      npc.seatSlot = null;
      npc.seatY = undefined;
      npc.state = 'disembarking';
      // Pick a destination 3-6m away from where we got off
      const a = Math.random() * Math.PI * 2;
      const r = 3 + Math.random() * 3;
      npc.target.set(seatPos.x + Math.cos(a) * r, 0, seatPos.z + Math.sin(a) * r);
      npc.stateTimer = 5;
    }

    this._writeMatrices(npc);
  }

  _tickDisembarking(dt, npc) {
    // Just lean toward the disembark target; the regular walking loop below handles motion.
    const tdx = npc.target.x - npc.pos.x;
    const tdz = npc.target.z - npc.pos.z;
    const td = Math.hypot(tdx, tdz);
    if (td < ARRIVE_RADIUS || npc.stateTimer <= 0) {
      npc.state = 'idle';
      npc.stateTimer = 1 + Math.random() * 2;
    }
  }

  // ----- Hammock riding -----

  _tryClaimHammock(npc) {
    // Find the nearest unoccupied hammock within 30m.
    const ids = registry.byKind.get('hammock');
    if (!ids) return false;
    let best = null;
    let bestD2 = 30 * 30;
    for (const id of ids) {
      const e = registry.entries.get(id);
      if (!e || !e.hammock || e.hammock.occupied) continue;
      const dx = e.position.x - npc.pos.x;
      const dz = e.position.z - npc.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) { bestD2 = d2; best = e; }
    }
    if (!best) return false;
    best.hammock.occupied = true;
    npc.hammockEntry = best;
    npc.target.copy(best.position);
    npc.state = 'walking_to_hammock';
    npc.stateTimer = 18;             // give up if can't reach in 18s
    return true;
  }

  _tickWalkingToHammock(dt, npc) {
    // Returns true if we handled the NPC fully this frame (skip rest of update).
    if (!npc.hammockEntry) {
      npc.state = 'idle';
      npc.stateTimer = 1;
      return true;
    }
    const target = npc.hammockEntry.hammock.seatPos;
    const tdx = target.x - npc.pos.x;
    const tdz = target.z - npc.pos.z;
    const td = Math.hypot(tdx, tdz);
    if (td < 0.7) {
      // Arrived — climb in
      npc.state = 'hammock_riding';
      npc.rideTimer = 12 + Math.random() * 18;  // 12-30s of swinging
      npc.hammockBob = 0;
      return true;
    }
    if (npc.stateTimer <= 0) {
      // Couldn't reach in time — release and go idle
      this._releaseHammock(npc);
      npc.state = 'idle';
      npc.stateTimer = 1;
      return true;
    }
    // Walk toward the hammock at jog speed
    const inv = 1 / (td || 1);
    npc.vel.x = THREE.MathUtils.lerp(npc.vel.x, tdx * inv * 1.6 * npc.energy, Math.min(1, dt * 5));
    npc.vel.z = THREE.MathUtils.lerp(npc.vel.z, tdz * inv * 1.6 * npc.energy, Math.min(1, dt * 5));
    npc.pos.x += npc.vel.x * dt;
    npc.pos.z += npc.vel.z * dt;
    // Face direction of motion
    const targetYaw = Math.atan2(-npc.vel.x, -npc.vel.z);
    const diff = wrapAngle(targetYaw - npc.yaw);
    npc.yaw += diff * Math.min(1, dt * 6);
    this._writeMatrices(npc);
    return true;
  }

  _tickHammockRiding(dt, npc) {
    if (!npc.hammockEntry) {
      npc.state = 'idle';
      npc.stateTimer = 1;
      return;
    }
    npc.rideTimer -= dt;
    npc.hammockBob += dt * 2.2;          // swing speed
    const h = npc.hammockEntry.hammock;
    const swingAmp = 0.18;
    // Sway PERPENDICULAR to the hammock's long axis (i.e. side-to-side, not
    // along its length) so it looks like the cloth is swinging.
    const perpX = -Math.sin(h.yaw);
    const perpZ = Math.cos(h.yaw);
    const sway = Math.sin(npc.hammockBob) * swingAmp;
    npc.pos.x = h.seatPos.x + perpX * sway;
    npc.pos.z = h.seatPos.z + perpZ * sway;
    npc.hammockY = h.seatPos.y + Math.sin(npc.hammockBob * 2) * 0.04;
    // Face roughly along the hammock long axis (lounging direction)
    npc.yaw = h.yaw + Math.PI / 2;
    npc.vel.set(0, 0, 0);

    if (npc.rideTimer <= 0) {
      this._releaseHammock(npc);
      npc.state = 'idle';
      npc.stateTimer = 1 + Math.random() * 2;
      // Step a bit out of the hammock so the next idle target makes sense
      npc.pos.x += (Math.random() - 0.5) * 0.8;
      npc.pos.z += (Math.random() - 0.5) * 0.8;
      npc.hammockY = undefined;
    }
    this._writeMatrices(npc);
  }

  _releaseHammock(npc) {
    if (npc.hammockEntry && npc.hammockEntry.hammock) {
      npc.hammockEntry.hammock.occupied = false;
    }
    npc.hammockEntry = null;
    npc.hammockY = undefined;
  }

  // Called from main.js when Zerble drives into an NPC. Knockback the victim,
  // put them into a fleeing state, and spook nearby NPCs (panic cascade).
  onZerbleHit(victim, pushX, pushZ) {
    victim.state = 'fleeing';
    victim.stateTimer = 3;
    victim.happiness = 0;
    // Apply an instant positional knockback so the cart doesn't keep grinding
    // through the same NPC frame after frame.
    victim.pos.x += pushX * 0.6;
    victim.pos.z += pushZ * 0.6;
    // Panic cascade: nearby NPCs (within 6m) of any reasonable skittishness flee too
    for (const other of this.npcs) {
      if (other === victim || other.state === 'riding' || other.state === 'boarding') continue;
      const dx = other.pos.x - victim.pos.x;
      const dz = other.pos.z - victim.pos.z;
      if (dx * dx + dz * dz > 36) continue;
      // Bolder/calmer folks may shrug it off
      if (other.skittish < 0.15 && Math.random() < 0.5) continue;
      other.state = 'fleeing';
      other.stateTimer = 2.5;
    }
  }

  applyHonk(zerble) {
    for (const npc of this.npcs) {
      const dx = npc.pos.x - zerble.position.x;
      const dz = npc.pos.z - zerble.position.z;
      const d = Math.hypot(dx, dz);
      if (d < HONK_RANGE && npc.smileTimeCooldown <= 0 && npc.state !== 'fleeing') {
        const k = 1 - d / HONK_RANGE;
        npc.happiness += HONK_BOOST * k;
        if (npc.happiness >= HAPPINESS_THRESHOLD) {
          // Apply the same distance/time gate as natural smiles
          if (npc.lastSmilePos === null || zerble.position.distanceTo(npc.lastSmilePos) > SMILE_RESET_DIST) {
            npc.happiness = 0;
            npc.smileTimeCooldown = SMILE_TIME_COOLDOWN;
            npc.lastSmilePos = zerble.position.clone();
            this.smiles.spawn(npc.pos);
          } else {
            // They're charmed but already smiled recently — just hold at threshold
            npc.happiness = HAPPINESS_THRESHOLD * 0.95;
          }
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

// Looks up nearby building footprints and returns a normalized repulsion direction.
function nearestFootprintAvoidance(pos, lookAheadRadius) {
  let pushX = 0, pushZ = 0, strength = 0;
  for (const fp of registry.footprints()) {
    if (fp.kind === 'tree' || fp.kind === 'path_node') continue;
    const dx = pos.x - fp.position.x;
    const dz = pos.z - fp.position.z;
    const d = Math.hypot(dx, dz);
    const intrusion = fp.radius + lookAheadRadius - d;
    if (intrusion > 0) {
      const inv = 1 / (d || 0.0001);
      const w = intrusion / lookAheadRadius;
      pushX += dx * inv * w;
      pushZ += dz * inv * w;
      strength += w;
    }
  }
  if (strength <= 0) return null;
  const n = Math.hypot(pushX, pushZ) || 1;
  return { x: pushX / n, z: pushZ / n, strength: Math.min(1.2, strength) };
}
