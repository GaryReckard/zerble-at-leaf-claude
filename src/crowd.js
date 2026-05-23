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
import { registry } from './registry.js';

const MAX_NPCS = 500;
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
const SEPARATION_RADIUS = 1.6;
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
    const bodyGeo = new THREE.CapsuleGeometry(0.32, 1.0, 4, 8);
    const headGeo = new THREE.IcosahedronGeometry(0.28, 1);

    const bodyMat = new THREE.MeshStandardMaterial({ roughness: 0.85, flatShading: true });
    const headMat = new THREE.MeshStandardMaterial({ color: 0xe6c098, roughness: 0.9, flatShading: true });

    this.bodyMesh = new THREE.InstancedMesh(bodyGeo, bodyMat, MAX_NPCS);
    this.headMesh = new THREE.InstancedMesh(headGeo, headMat, MAX_NPCS);
    this.bodyMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_NPCS * 3), 3);
    this.bodyMesh.castShadow = true;
    this.headMesh.castShadow = true;
    this.bodyMesh.count = MAX_NPCS;
    this.headMesh.count = MAX_NPCS;

    this.group = new THREE.Group();
    this.group.name = 'Crowd';
    this.group.add(this.bodyMesh);
    this.group.add(this.headMesh);

    // Hide all slots initially.
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < MAX_NPCS; i++) {
      this.bodyMesh.setMatrixAt(i, zero);
      this.headMesh.setMatrixAt(i, zero);
      this.free.push(i);
    }
    this.bodyMesh.instanceMatrix.needsUpdate = true;
    this.headMesh.instanceMatrix.needsUpdate = true;

    // Reusables
    this._mat4 = new THREE.Matrix4();
    this._tmpV = new THREE.Vector3();
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

    // Color
    const c = new THREE.Color(shirt);
    this.bodyMesh.instanceColor.setXYZ(idx, c.r, c.g, c.b);
    this.bodyMesh.instanceColor.needsUpdate = true;

    // Initial transform
    this._writeMatrices(npc);

    return npc;
  }

  unloadChunk(chunkKey) {
    const kept = [];
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (const npc of this.npcs) {
      if (npc.chunkKey === chunkKey) {
        // Free any seat the NPC was occupying so future passengers can claim it
        if (npc.seatSlot) {
          npc.seatSlot.occupied = false;
          npc.seatSlot = null;
        }
        this.bodyMesh.setMatrixAt(npc.idx, zero);
        this.headMesh.setMatrixAt(npc.idx, zero);
        this.free.push(npc.idx);
      } else {
        kept.push(npc);
      }
    }
    this.npcs = kept;
    this.bodyMesh.instanceMatrix.needsUpdate = true;
    this.headMesh.instanceMatrix.needsUpdate = true;
  }

  // -------------- per-frame --------------

  update(dt, zerble, bubbles) {
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

    this.bodyMesh.instanceMatrix.needsUpdate = true;
    this.headMesh.instanceMatrix.needsUpdate = true;
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
        if (npc.stateTimer <= 0) {
          // Pick a new wander target: prefer an attractor, else random nearby spot
          const at = registry.pickAttractor(Math.random);
          if (at && Math.hypot(at.position.x - npc.pos.x, at.position.z - npc.pos.z) < 60) {
            npc.target.copy(at.position);
            npc.target.x += (Math.random() - 0.5) * at.radius;
            npc.target.z += (Math.random() - 0.5) * at.radius;
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
        const target = Math.atan2(dx, dz);
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
        const target = Math.atan2(dx, dz);
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
        const lookDir = Math.atan2(desiredX, desiredZ);
        npc.yaw = lookDir;
        if (dToZerble > NOTICE_RANGE + 4) {
          npc.state = 'idle';
          npc.stateTimer = 2;
        }
        break;
      }
    }

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
        // Add a gentle pull (stronger the farther they are)
        const pull = THREE.MathUtils.clamp((pathDist - PATH_PULL_WIDTH) / 20, 0, 0.4);
        const pn = pathDist || 1;
        desiredX += (closestPathOffset.x / pn) * pull;
        desiredZ += (closestPathOffset.z / pn) * pull;
      }

      // Building avoidance: push away from any nearby footprint
      const avoid = nearestFootprintAvoidance(npc.pos, BUILDING_AVOID_RADIUS);
      if (avoid) {
        desiredX += avoid.x * avoid.strength;
        desiredZ += avoid.z * avoid.strength;
      }

      // Normalize again
      const dn = Math.hypot(desiredX, desiredZ) || 1;
      desiredX /= dn;
      desiredZ /= dn;

      // Smoothly accelerate velocity toward desired
      npc.vel.x = THREE.MathUtils.lerp(npc.vel.x, desiredX * speed, Math.min(1, dt * 4));
      npc.vel.z = THREE.MathUtils.lerp(npc.vel.z, desiredZ * speed, Math.min(1, dt * 4));
    } else {
      // Decelerate
      npc.vel.multiplyScalar(Math.pow(0.5, dt * 6));
    }

    // Apply velocity
    npc.pos.x += npc.vel.x * dt;
    npc.pos.z += npc.vel.z * dt;

    // Face direction of motion when walking/fleeing/approaching
    if (Math.abs(npc.vel.x) + Math.abs(npc.vel.z) > 0.4 && npc.state !== 'watching') {
      const targetYaw = Math.atan2(npc.vel.x, npc.vel.z);
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
    const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, npc.yaw, 0));
    const bobY = Math.sin(npc.bob) * 0.04;
    const danceTilt = npc.dance > 0.6 && (npc.state === 'idle' || npc.state === 'watching' || npc.state === 'riding')
      ? Math.sin(npc.bob * 2) * 0.05 * (npc.dance - 0.5)
      : 0;

    // Riding passengers sit AT seat height (using seatY captured in _tickRiding).
    // Their body's vertical center is ~0.4 below the seat's top so they look seated.
    let bodyY, headY;
    if (npc.state === 'riding' && npc.seatY != null) {
      bodyY = npc.seatY - 0.05 + bobY;
      headY = npc.seatY + 0.7 + bobY;
    } else {
      bodyY = 0.85 * npc.scale + bobY;
      headY = 1.65 * npc.scale + bobY;
    }

    m.compose(
      this._tmpV.set(npc.pos.x, bodyY, npc.pos.z),
      quat,
      this._tmpV.set(npc.scale, npc.scale, npc.scale)
    );
    if (danceTilt) {
      const t = new THREE.Matrix4().makeRotationZ(danceTilt);
      m.multiply(t);
    }
    this.bodyMesh.setMatrixAt(npc.idx, m);

    m.compose(
      this._tmpV.set(npc.pos.x, headY, npc.pos.z),
      quat,
      this._tmpV.set(npc.scale, npc.scale, npc.scale)
    );
    this.headMesh.setMatrixAt(npc.idx, m);
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
    const targetYaw = Math.atan2(npc.vel.x, npc.vel.z);
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
