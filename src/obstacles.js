// Obstacles: things you DON'T want to hit. Each one exposes:
//   .group  : THREE.Object3D to add to scene
//   .update(dt) : per-frame movement
//   .colliders : array of { position: Vector3, radius: number, damage: number, kind: string }
//
// Geometry lives in src/models/. This file owns path/AI behavior + colliders.

import * as THREE from 'three';
import { buildPuppet } from './models/puppet.js';
import { buildBandMember } from './models/bandMember.js';
import { buildParasolMarshal } from './models/parasolMarshal.js';
import { buildKid } from './models/kid.js';
import { buildWook } from './models/wook.js';
import { Sound } from './sound.js';
import { projectOutOfLake } from './lakes.js';
import { registry } from './registry.js';

const TAU = Math.PI * 2;

// Walk an array of Vector3 path points and push any that land inside a lake
// out to the shoreline. Mutates the array in place. Called from the parade
// constructors so the visible march never wanders onto water.
function avoidLakes(path) {
  for (let i = 0; i < path.length; i++) {
    const fixed = projectOutOfLake(path[i].x, path[i].z, 3.0);
    if (fixed) {
      path[i].x = fixed.x;
      path[i].z = fixed.z;
    }
  }
}

// =================================================================
// PUPPET PARADE  — the Street Creature Puppet Collective
// =================================================================

export class PuppetParade {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'PuppetParade';

    // A patrol path that loops through the festival center. Project out of
    // any lake footprints so the parade doesn't walk on water.
    this.path = [
      new THREE.Vector3(-70, 0, -10),
      new THREE.Vector3(-30, 0, 20),
      new THREE.Vector3(20, 0, 10),
      new THREE.Vector3(60, 0, -20),
      new THREE.Vector3(40, 0, -60),
      new THREE.Vector3(-20, 0, -50),
      new THREE.Vector3(-60, 0, -30),
    ];
    avoidLakes(this.path);
    this.speed = 2.4;

    this.puppets = [];
    const PUPPET_COUNT = 6;
    for (let i = 0; i < PUPPET_COUNT; i++) {
      const puppet = buildPuppet(i);
      const ahead = i * 4.5;  // spacing along the path
      puppet.userData.distance = -ahead;
      // Honk-scatter offset: while dodgeTimer > 0, the puppet's path-derived
      // position gets nudged perpendicular by (dodgeDirX, dodgeDirZ) * eased
      // amount, then snaps back as the timer winds down. Path progression
      // keeps running underneath so the parade still marches through.
      puppet.userData.dodgeTimer = 0;
      puppet.userData.dodgeDirX = 0;
      puppet.userData.dodgeDirZ = 0;
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

  // Honk-scatter: puppets in front of parked Zerble get a temporary lateral
  // dodge offset. They keep walking along their path but sidestep by ~2.5m
  // for ~1.4s, then ease back.
  scatter(zerble) {
    if (!zerble || !zerble.forwardWorld) return;
    const FRONT_RANGE = 12;
    const FRONT_RANGE_SQ = FRONT_RANGE * FRONT_RANGE;
    const fx = zerble.forwardWorld.x;
    const fz = zerble.forwardWorld.z;
    for (const p of this.puppets) {
      const dx = p.position.x - zerble.position.x;
      const dz = p.position.z - zerble.position.z;
      if (dx * dx + dz * dz > FRONT_RANGE_SQ) continue;
      if (dx * fx + dz * fz <= 0) continue;
      const inv = 1 / Math.sqrt(dx * dx + dz * dz || 0.0001);
      p.userData.dodgeTimer = 1.4;
      p.userData.dodgeDirX = dx * inv;
      p.userData.dodgeDirZ = dz * inv;
    }
  }

  update(dt) {
    const totalLen = pathLength(this.path);
    for (let i = 0; i < this.puppets.length; i++) {
      const p = this.puppets[i];
      p.userData.distance = (p.userData.distance + this.speed * dt + totalLen * 100) % totalLen;
      const { pos, dir } = samplePath(this.path, p.userData.distance, this._tmpA, this._tmpB);
      p.position.copy(pos);
      // Apply dodge offset on top of the path position. Triangle pulse
      // (ramps up, holds, eases out) over the dodge timer's lifetime.
      if (p.userData.dodgeTimer > 0) {
        p.userData.dodgeTimer -= dt;
        const ratio = Math.max(0, p.userData.dodgeTimer / 1.4);  // 1 → 0
        // Bell curve: peaks mid-dodge so the offset eases in and out.
        const env = Math.sin((1 - ratio) * Math.PI);
        const DODGE_DIST = 2.5;
        p.position.x += p.userData.dodgeDirX * DODGE_DIST * env;
        p.position.z += p.userData.dodgeDirZ * DODGE_DIST * env;
      }
      // Their "front" geometry (eyes/mouth) is at local -Z, so face the direction of travel
      // by setting yaw so that local -Z points along dir.
      const yaw = Math.atan2(-dir.x, -dir.z);
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
    avoidLakes(this.path);
    this.speed = 1.8;

    this.members = [];
    // Grand-marshal-led second-line formation: parasol up front, two
    // trumpets + sax behind, tuba + drum + trombone in the back row.
    // Distinct instruments per row gives the silhouette real variety.
    const formation = [
      [0, 1.6, 'parasol'],         // grand marshal up front (positive Z = ahead)
      [-1.4, 0, 'trumpet'],
      [1.4, 0, 'trumpet'],
      [0, -1.0, 'sax'],
      [-2.6, -2.2, 'trombone'],
      [0, -2.4, 'tuba'],
      [2.6, -2.2, 'drum'],
    ];

    for (const [offX, offZ, instrument] of formation) {
      const m = instrument === 'parasol' ? buildParasolMarshal() : buildBandMember(instrument);
      m.userData.formationOff = new THREE.Vector3(offX, 0, offZ);
      m.userData.instrument = instrument;
      this.group.add(m);
      this.members.push(m);
    }

    this.colliders = this.members.map(() => ({
      position: new THREE.Vector3(),
      radius: 1.0,
      damage: 6,
      kind: 'brass',
    }));

    this._parasolPhase = 0;

    this.distance = 0;
    this._tmpA = new THREE.Vector3();
    this._tmpB = new THREE.Vector3();

    // Unit-level honk-scatter offset. The whole formation sidesteps together
    // when any member is in front of parked Zerble.
    this._dodgeTimer = 0;
    this._dodgeDirX = 0;
    this._dodgeDirZ = 0;
  }

  scatter(zerble) {
    if (!zerble || !zerble.forwardWorld) return;
    const FRONT_RANGE = 14;        // bigger range because the formation spans ~6m
    const FRONT_RANGE_SQ = FRONT_RANGE * FRONT_RANGE;
    const fx = zerble.forwardWorld.x;
    const fz = zerble.forwardWorld.z;
    // Trigger if ANY member is in front + in range. Use member positions
    // (set by last update tick) — they reflect the current marching pose.
    for (const m of this.members) {
      const dx = m.position.x - zerble.position.x;
      const dz = m.position.z - zerble.position.z;
      if (dx * dx + dz * dz > FRONT_RANGE_SQ) continue;
      if (dx * fx + dz * fz <= 0) continue;
      // Direction = away from Zerble, derived from this triggering member.
      const inv = 1 / Math.sqrt(dx * dx + dz * dz || 0.0001);
      this._dodgeTimer = 1.6;
      this._dodgeDirX = dx * inv;
      this._dodgeDirZ = dz * inv;
      return;  // one trigger sidesteps the whole unit
    }

    // Second-line groove that follows the band around the world. The seed
    // is just a constant so the band's tune is stable across reloads — only
    // one brass band exists in the game so per-band variation is moot.
    this._music = Sound.attachStageMusic(
      this.path[0].x, 1, this.path[0].z, 0xb4a55, 'second_line',
    );
  }

  update(dt) {
    const totalLen = pathLength(this.path);
    this.distance = (this.distance + this.speed * dt + totalLen * 100) % totalLen;
    const { pos: leadPos, dir: leadDir } = samplePath(this.path, this.distance, this._tmpA, this._tmpB);
    // Face the direction of travel: yaw rotates local -Z to align with dir.
    const yaw = Math.atan2(-leadDir.x, -leadDir.z);
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);

    // Unit-level dodge offset (honk scatter). Sidestep ~3m perpendicular for
    // the dodge timer's lifetime; bell-curve envelope eases in and out.
    let dodgeOX = 0, dodgeOZ = 0;
    if (this._dodgeTimer > 0) {
      this._dodgeTimer -= dt;
      const ratio = Math.max(0, this._dodgeTimer / 1.6);
      const env = Math.sin((1 - ratio) * Math.PI);
      const DODGE_DIST = 3.0;
      dodgeOX = this._dodgeDirX * DODGE_DIST * env;
      dodgeOZ = this._dodgeDirZ * DODGE_DIST * env;
    }

    for (let i = 0; i < this.members.length; i++) {
      const m = this.members[i];
      const off = m.userData.formationOff;
      // Rotate the offset into the band's heading
      const ox = off.x * cos + off.z * sin;
      const oz = -off.x * sin + off.z * cos;
      m.position.set(leadPos.x + ox + dodgeOX, 0, leadPos.z + oz + dodgeOZ);
      m.rotation.y = yaw;

      // Marching bob
      const t = performance.now() * 0.004 + i;
      m.children[0].position.y = 0.85 + Math.abs(Math.sin(t * 2)) * 0.08;

      // The grand marshal's parasol twirls — handle separately.
      if (m.userData.instrument === 'parasol') {
        const parasol = m.userData.parasol;
        if (parasol) parasol.rotation.y += dt * 2.4;
      }

      this.colliders[i].position.copy(m.position);
      this.colliders[i].position.y = 1;
    }

    // Move the spatial music source to the band leader's current position so
    // the music actually walks around the festival with them.
    if (this._music && this._music.setPosition) {
      this._music.setPosition(leadPos.x, 1, leadPos.z);
    }
  }
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

    // Eight gaggles spread across the festival. The anchor-drift logic in
    // update() pulls each kid's center toward Zerble over time, so wherever
    // the player wanders they'll see roughly this many kids around them.
    // Plus the recycle loop below re-anchors kids that lag too far behind.
    const GAGGLE_COUNT = 8;
    const centers = [];
    for (let i = 0; i < GAGGLE_COUNT; i++) {
      const ang = (i / GAGGLE_COUNT) * TAU + Math.random() * 0.3;
      // 25-75m out from origin so gaggles fan out across the visible startup
      // area rather than all clustering near the stages.
      const r = 25 + Math.random() * 50;
      centers.push(new THREE.Vector3(Math.cos(ang) * r, 0, Math.sin(ang) * r));
    }

    for (const c of centers) {
      const gaggleSize = 5 + Math.floor(Math.random() * 4);  // 5-8 kids
      for (let i = 0; i < gaggleSize; i++) {
        const k = buildKid();
        k.position.copy(c);
        k.position.x += (Math.random() - 0.5) * 8;
        k.position.z += (Math.random() - 0.5) * 8;
        k.userData.center = c.clone();
        k.userData.heading = Math.random() * TAU;
        k.userData.turnTimer = Math.random() * 2;
        k.userData.speed = 3 + Math.random() * 2;
        // Honk-scatter timer: while > 0, the kid runs away from Zerble at
        // FLEE_SPEED. Set by KidGaggle.scatter() from main.js on honk.
        k.userData.scatterTimer = 0;
        // Smile state — same model as crowd NPCs (see crowd.js): happiness
        // ramps when near Zerble/bubbles, spawns a smile + resets at the
        // threshold, then needs Zerble to drive SMILE_RESET_DIST away AND
        // SMILE_TIME_COOLDOWN seconds before this kid can smile again. So
        // parking next to a gaggle gets you one smile burst (one per kid),
        // not a cheaty stream.
        k.userData.happiness = 0;
        k.userData.lastSmilePos = null;
        k.userData.smileTimeCooldown = 0;
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

  // Honk-scatter trigger called from main.js when the player honks while
  // parked. Any kid in front of Zerble (within FRONT_RANGE, dot with the
  // cart's forward axis > 0) gets a short flee timer that overrides their
  // bubble-chase / cluster behavior for ~1.2s. Kids behind the cart are
  // left alone — they were the ones we WANTED back there at the vent.
  scatter(zerble) {
    if (!zerble || !zerble.forwardWorld) return;
    const FRONT_RANGE = 10;
    const FRONT_RANGE_SQ = FRONT_RANGE * FRONT_RANGE;
    const fx = zerble.forwardWorld.x;
    const fz = zerble.forwardWorld.z;
    for (const k of this.kids) {
      const dx = k.position.x - zerble.position.x;
      const dz = k.position.z - zerble.position.z;
      if (dx * dx + dz * dz > FRONT_RANGE_SQ) continue;
      // Dot > 0 means the kid is on the forward side of Zerble.
      if (dx * fx + dz * fz <= 0) continue;
      k.userData.scatterTimer = 1.2;
      // Pre-aim them away so the first frame doesn't waste time turning.
      k.userData.heading = Math.atan2(dx, -dz);
      k.userData.turnTimer = 0.8;
    }
  }

  // dt: frame delta. bubbles/zerble are optional — when present, kids go
  // gaga for bubbles (steer toward the nearest one) and the whole gaggle
  // slowly drifts toward wherever Zerble is so they don't get stuck at
  // their birth anchor once he's wandered off. When `smiles` is also
  // passed, a kid who catches a bubble (gets within BUBBLE_GRAB_RANGE)
  // spawns a smile at their position — that's the joy moment that earns
  // the player a point. Per-kid cooldown prevents one bubble-popping kid
  // from spamming smiles every frame they're inside the grab radius.
  update(dt, bubbles, zerble, smiles) {
    // Recycle kids whose position has fallen far behind Zerble. The anchor
    // lerp drags centers toward the player but individual wandering can
    // still leave a kid stranded after a fast drive. Mirrors the wook
    // recycle behavior — re-anchor to a fresh spot 30-80m around Zerble.
    if (zerble) {
      const RECYCLE_DIST2 = 200 * 200;
      const RECYCLE_NEAR = 30;
      const RECYCLE_FAR  = 80;
      for (const k of this.kids) {
        const ddx = k.position.x - zerble.position.x;
        const ddz = k.position.z - zerble.position.z;
        if (ddx * ddx + ddz * ddz > RECYCLE_DIST2) {
          const ang = Math.random() * TAU;
          const r = RECYCLE_NEAR + Math.random() * (RECYCLE_FAR - RECYCLE_NEAR);
          const nx = zerble.position.x + Math.cos(ang) * r;
          const nz = zerble.position.z + Math.sin(ang) * r;
          k.position.set(nx, 0, nz);
          k.userData.center.set(nx, 0, nz);
          k.userData.scatterTimer = 0;
        }
      }
    }

    // Collect live bubble positions once per frame so we don't iterate the
    // whole pool inside every kid's loop.
    const bubblePositions = [];
    if (bubbles) bubbles.forEachAlive((b) => bubblePositions.push(b.pos));

    // Kid gaggles drift their anchor toward Zerble so they follow him
    // around the festival. The pull is stronger when Zerble is parked
    // (lerp ~3× faster) so the gaggle actually congregates around him for
    // bubble play instead of lagging way behind. Anchor TARGETS the bubble
    // vent (zerble.nozzleWorld), not the cart center — that way wander
    // naturally happens around the back where the bubbles spawn, without
    // forcing kids onto an explicit orbit. They still chase any bubble in
    // range; if no bubble is near, they just play / mill around behind.
    const REST_SPEED = 0.5;                // |zerble.speed| below this = parked
    const isParked = zerble && Math.abs(zerble.speed || 0) < REST_SPEED;
    if (zerble) {
      const targetX = isParked && zerble.nozzleWorld ? zerble.nozzleWorld.x : zerble.position.x;
      const targetZ = isParked && zerble.nozzleWorld ? zerble.nozzleWorld.z : zerble.position.z;
      const lerpRate = isParked ? 0.8 : 0.25;
      const lerpAmt = Math.min(1, dt * lerpRate);
      for (const k of this.kids) {
        k.userData.center.x += (targetX - k.userData.center.x) * lerpAmt;
        k.userData.center.z += (targetZ - k.userData.center.z) * lerpAmt;
      }
    }

    const BUBBLE_ATTRACT_RANGE = 9;        // start chasing a bubble within this
    const BUBBLE_GRAB_RANGE = 0.7;         // close enough to "play with" it
    const BUBBLE_ATTRACT_SPEED = 4.2;      // sprint speed when chasing
    const FLEE_SPEED = 5.0;                // honk-scatter sprint speed
    // Smile economy — mirrors crowd.js. A kid must be within KID_SMILE_RANGE
    // of Zerble (or right next to a bubble) for happiness to accrue; smile
    // fires when happiness crosses KID_HAPPINESS_THRESHOLD, then locks out
    // until Zerble has driven KID_SMILE_RESET_DIST away AND the time
    // cooldown elapses.
    const KID_HAPPINESS_THRESHOLD = 0.7;
    const KID_SMILE_RANGE = 12;
    const KID_SMILE_RESET_DIST = 28;
    const KID_SMILE_TIME_COOLDOWN = 3;
    const KID_BUBBLE_GAIN_RANGE = 1.5;     // bubble must be within this for gain
    const KID_BUBBLE_GAIN = 0.6;           // happiness/sec at point-blank to a bubble
    const KID_PROXIMITY_GAIN = 0.4;        // happiness/sec next to Zerble (linear falloff)

    for (let i = 0; i < this.kids.length; i++) {
      const k = this.kids[i];

      // ---- Find nearest live bubble (if any) ----
      let chaseDx = 0, chaseDz = 0, chaseD = Infinity;
      for (const bp of bubblePositions) {
        const dx = bp.x - k.position.x;
        const dz = bp.z - k.position.z;
        const d = Math.hypot(dx, dz);
        if (d < chaseD && d < BUBBLE_ATTRACT_RANGE) {
          chaseD = d; chaseDx = dx; chaseDz = dz;
        }
      }

      // Tick scatter timer first so the test below sees a fresh value.
      if (k.userData.scatterTimer > 0) k.userData.scatterTimer -= dt;
      if (k.userData.smileTimeCooldown > 0) k.userData.smileTimeCooldown -= dt;
      const fleeing = k.userData.scatterTimer > 0 && zerble;

      // Smile economy — same model as crowd NPCs in crowd.js. Gates:
      //   1. Time cooldown elapsed (3s since last smile from this kid)
      //   2. Zerble has moved at least RESET_DIST from where this kid last
      //      smiled, OR this kid has never smiled
      //   3. Kid is within SMILE_RANGE of Zerble (so they're "with" him)
      // Then happiness ramps with proximity + nearby bubbles. When it
      // crosses threshold, spawn a smile and reset.
      if (smiles && zerble && !fleeing) {
        const dxZ = k.position.x - zerble.position.x;
        const dzZ = k.position.z - zerble.position.z;
        const dToZerble = Math.hypot(dxZ, dzZ);
        const moved = k.userData.lastSmilePos === null
          || zerble.position.distanceTo(k.userData.lastSmilePos) > KID_SMILE_RESET_DIST;
        if (
          k.userData.smileTimeCooldown <= 0
          && moved
          && dToZerble < KID_SMILE_RANGE
        ) {
          let gain = 0;
          // Proximity to Zerble — linear falloff over SMILE_RANGE
          gain += KID_PROXIMITY_GAIN * (1 - dToZerble / KID_SMILE_RANGE);
          // Nearest bubble bonus: if any live bubble is within
          // KID_BUBBLE_GAIN_RANGE, add proportional gain. Caps even if
          // multiple bubbles are nearby — kids are excited about bubbles,
          // not exponentially.
          let bestBubbleD = Infinity;
          for (const bp of bubblePositions) {
            const bd = Math.hypot(bp.x - k.position.x, bp.z - k.position.z);
            if (bd < bestBubbleD) bestBubbleD = bd;
          }
          if (bestBubbleD < KID_BUBBLE_GAIN_RANGE) {
            gain += KID_BUBBLE_GAIN * (1 - bestBubbleD / KID_BUBBLE_GAIN_RANGE);
          }
          k.userData.happiness += gain * dt;
          if (k.userData.happiness >= KID_HAPPINESS_THRESHOLD) {
            k.userData.happiness = 0;
            k.userData.smileTimeCooldown = KID_SMILE_TIME_COOLDOWN;
            k.userData.lastSmilePos = zerble.position.clone();
            smiles.spawn(k.position);
          }
        } else {
          // Out of range / on cooldown — decay happiness slowly
          k.userData.happiness = Math.max(0, k.userData.happiness - dt * 0.2);
        }
      }

      if (fleeing) {
        // Run away from Zerble. Lock heading on entry (set by scatter())
        // and just sprint along it — keeps the burst lively without
        // re-aiming every frame.
        k.position.x += Math.sin(k.userData.heading) * FLEE_SPEED * dt;
        k.position.z += -Math.cos(k.userData.heading) * FLEE_SPEED * dt;
      } else if (chaseD < BUBBLE_ATTRACT_RANGE && chaseD > BUBBLE_GRAB_RANGE) {
        // Chase the bubble! Set heading toward it and sprint.
        const inv = 1 / (chaseD || 1);
        // userData.heading uses: dx = sin(h), dz = -cos(h)  →  h = atan2(dx, -dz)
        k.userData.heading = Math.atan2(chaseDx * inv, -chaseDz * inv);
        k.userData.turnTimer = 0.4 + Math.random() * 0.4;
        const stepSpeed = BUBBLE_ATTRACT_SPEED;
        k.position.x += Math.sin(k.userData.heading) * stepSpeed * dt;
        k.position.z += -Math.cos(k.userData.heading) * stepSpeed * dt;
      } else {
        // Default wander behavior with periodic course changes
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
          k.userData.heading = Math.atan2(-cx, -cz) + (Math.random() - 0.5) * 0.4;
        }
      }

      // ---- Respect hard colliders (stages, food trucks, tents, etc.) ----
      // Push the kid radially out of any collider they overlap. Also nudge
      // their heading away so they don't keep marching into the same wall
      // every frame. Kid radius treated as 0.4m for the overlap check.
      pushOutOfHardColliders(k, 0.4);

      k.rotation.y = k.userData.heading;

      // Lil hop — bouncier when chasing a bubble (they're excited)
      const bouncy = chaseD < BUBBLE_ATTRACT_RANGE ? 0.22 : 0.15;
      const tMs = performance.now() * 0.012 + i;
      k.children[0].position.y = 0.55 + Math.abs(Math.sin(tMs * 2)) * bouncy;

      this.colliders[i].position.copy(k.position);
      this.colliders[i].position.y = 0.6;
    }
  }
}

// Push a kid (or any small object with .position + .userData.heading) out
// of every registry collider it currently overlaps. Mutates position +
// flips heading so the next step isn't right back into the wall.
function pushOutOfHardColliders(obj, kidRadius) {
  for (const c of registry.colliders()) {
    const dx = obj.position.x - c.position.x;
    const dz = obj.position.z - c.position.z;
    const minD = c.radius + kidRadius;
    const d2 = dx * dx + dz * dz;
    if (d2 >= minD * minD) continue;
    const d = Math.sqrt(d2) || 0.001;
    const inv = 1 / d;
    // Hard-resolve the overlap so the kid is exactly outside the radius.
    const overlap = minD - d;
    obj.position.x += dx * inv * overlap;
    obj.position.z += dz * inv * overlap;
    // Aim their next step outward + jitter so they don't stutter against
    // the surface.
    if (obj.userData) {
      obj.userData.heading = Math.atan2(dx * inv, -dz * inv)
        + (Math.random() - 0.5) * 0.6;
      obj.userData.turnTimer = 0.3 + Math.random() * 0.4;
    }
  }
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

    // Wook count was 7 — too dense around spawn, easy to accidentally trigger
    // a trip just by parking. Dropped to 5 + larger initial spread + spread
    // check on recycle (see update()) so two wooks don't cluster.
    const WOOK_COUNT = 5;
    for (let i = 0; i < WOOK_COUNT; i++) {
      const w = buildWook();
      // Drift in slow circles around random anchor points
      const ang = Math.random() * TAU;
      const rad = 60 + Math.random() * 100;  // was 40+80; now 60-160m initial radius
      w.userData.anchor = new THREE.Vector3(Math.cos(ang) * rad, 0, Math.sin(ang) * rad);
      w.userData.radius = 2.5 + Math.random() * 3;
      w.userData.phase = Math.random() * TAU;
      w.userData.speed = 0.4 + Math.random() * 0.4;

      // Honk-scatter dodge timer. While > 0, the wook walks straight away
      // from Zerble instead of orbiting its anchor. When it expires we
      // re-anchor to the new position so orbit resumes from there.
      w.userData.dodgeTimer = 0;
      w.userData.dodgeDirX = 0;
      w.userData.dodgeDirZ = 0;

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

  // Honk-scatter trigger. Wooks in front of a parked Zerble (within
  // FRONT_RANGE) get a short dodge timer + direction-away vector. Mirrors
  // KidGaggle.scatter — same convention: dot(rel, zerble.forwardWorld) > 0
  // means in front, since forwardWorld points along the cart's nose.
  scatter(zerble) {
    if (!zerble || !zerble.forwardWorld) return;
    const FRONT_RANGE = 10;
    const FRONT_RANGE_SQ = FRONT_RANGE * FRONT_RANGE;
    const fx = zerble.forwardWorld.x;
    const fz = zerble.forwardWorld.z;
    for (const w of this.wooks) {
      const dx = w.position.x - zerble.position.x;
      const dz = w.position.z - zerble.position.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > FRONT_RANGE_SQ) continue;
      if (dx * fx + dz * fz <= 0) continue;
      const inv = 1 / Math.sqrt(d2 || 0.0001);
      w.userData.dodgeTimer = 1.4;
      w.userData.dodgeDirX = dx * inv;
      w.userData.dodgeDirZ = dz * inv;
    }
  }

  // Wooks normally drift in slow circles around fixed anchors. But if Zerble
  // parks within DETECTION_RANGE, the closest wook breaks formation and walks
  // straight to him — he's about to dose the driver. zerblePos/zerbleSpeed
  // are optional; if omitted, wooks only do their default orbit (sandbox case).
  update(dt, zerblePos, zerbleSpeed) {
    const DETECTION_RANGE = 25;     // wooks notice a stopped Zerble within this
    const APPROACH_SPEED  = 1.8;    // m/s when walking up to the driver
    const REST_SPEED      = 0.5;    // |zerble.speed| below this counts as stopped
    const FAR_THRESHOLD2  = 300 * 300;  // recycle a wook whose anchor is this far
    const RECYCLE_MIN     = 90;     // re-anchor within this minimum distance (was 60 — too close)
    const RECYCLE_MAX     = 160;    // ...and this maximum, around Zerble
    const WOOK_SPREAD     = 40;     // min metres between wook anchors after recycle

    // Recycle wooks whose anchor drifted too far from Zerble — without this,
    // the wooks spawned at world origin stay at radius 60-160m forever, so
    // anyone who drives 800m away never encounters one. Recycled positions
    // honour WOOK_SPREAD (min distance between two wook anchors) so two
    // wooks don't cluster within trip-trigger range of each other.
    if (zerblePos) {
      for (let i = 0; i < this.wooks.length; i++) {
        const w = this.wooks[i];
        const a = w.userData.anchor;
        const adx = a.x - zerblePos.x;
        const adz = a.z - zerblePos.z;
        if (adx * adx + adz * adz > FAR_THRESHOLD2) {
          // Try up to 8 angles to find a position with adequate spread.
          let placed = false;
          for (let attempt = 0; attempt < 8; attempt++) {
            const ang = Math.random() * TAU;
            const dist = RECYCLE_MIN + Math.random() * (RECYCLE_MAX - RECYCLE_MIN);
            const nx = zerblePos.x + Math.cos(ang) * dist;
            const nz = zerblePos.z + Math.sin(ang) * dist;
            let tooClose = false;
            for (let j = 0; j < this.wooks.length; j++) {
              if (j === i) continue;
              const oa = this.wooks[j].userData.anchor;
              const ddx = nx - oa.x, ddz = nz - oa.z;
              if (ddx * ddx + ddz * ddz < WOOK_SPREAD * WOOK_SPREAD) { tooClose = true; break; }
            }
            if (!tooClose) {
              a.set(nx, 0, nz);
              placed = true;
              break;
            }
          }
          // Fallback: if spread couldn't be satisfied (unlikely with only 5
          // wooks), accept the last candidate — better than not recycling.
          if (!placed) {
            const ang = Math.random() * TAU;
            const dist = RECYCLE_MIN + Math.random() * (RECYCLE_MAX - RECYCLE_MIN);
            a.set(zerblePos.x + Math.cos(ang) * dist, 0, zerblePos.z + Math.sin(ang) * dist);
          }
          // Re-randomize so all recycled wooks don't lock to the same orbit phase
          w.userData.phase = Math.random() * TAU;
        }
      }
    }

    // Pick the wook that should approach: closest to Zerble, if Zerble is at rest
    // and within detection range. -1 means no one is approaching this frame.
    let approachIdx = -1;
    if (zerblePos && zerbleSpeed != null && zerbleSpeed < REST_SPEED) {
      let bestD2 = DETECTION_RANGE * DETECTION_RANGE;
      for (let i = 0; i < this.wooks.length; i++) {
        const w = this.wooks[i];
        const dx = w.position.x - zerblePos.x;
        const dz = w.position.z - zerblePos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < bestD2) { bestD2 = d2; approachIdx = i; }
      }
    }

    for (let i = 0; i < this.wooks.length; i++) {
      const w = this.wooks[i];
      const isApproaching = (i === approachIdx && zerblePos);
      const isDodging = w.userData.dodgeTimer > 0;

      if (isDodging) {
        // Walk straight away from Zerble at dodge speed. Overrides orbit
        // AND approach so a honked-at "approaching" wook also backs off.
        const DODGE_SPEED = 3.5;
        w.position.x += w.userData.dodgeDirX * DODGE_SPEED * dt;
        w.position.z += w.userData.dodgeDirZ * DODGE_SPEED * dt;
        // Face direction of travel.
        w.rotation.y = Math.atan2(-w.userData.dodgeDirX, -w.userData.dodgeDirZ);
        w.userData.dodgeTimer -= dt;
        if (w.userData.dodgeTimer <= 0) {
          // Re-anchor at the new position so the orbit resumes from here
          // instead of snapping back to the old spot.
          w.userData.anchor.set(w.position.x, 0, w.position.z);
          w.userData.phase = 0;
        }
      } else if (isApproaching) {
        // Walk toward Zerble. Stop ~1.5m short so we don't standing-on-his-head.
        const dx = zerblePos.x - w.position.x;
        const dz = zerblePos.z - w.position.z;
        const d = Math.hypot(dx, dz);
        if (d > 1.5) {
          const inv = 1 / (d || 1);
          w.position.x += dx * inv * APPROACH_SPEED * dt;
          w.position.z += dz * inv * APPROACH_SPEED * dt;
        }
        // Face Zerble — local -z is forward
        w.rotation.y = Math.atan2(-dx, -dz);
      } else {
        // Default behavior: orbit the anchor
        w.userData.phase += w.userData.speed * dt;
        const a = w.userData.anchor;
        const px = a.x + Math.cos(w.userData.phase) * w.userData.radius;
        const pz = a.z + Math.sin(w.userData.phase * 0.7) * w.userData.radius;
        w.position.set(px, 0, pz);
        w.rotation.y = -w.userData.phase + Math.PI;
      }

      // Sway (applies to everyone — including the creep walking up to you)
      const t = performance.now() * 0.002 + i;
      w.children[0].rotation.z = Math.sin(t) * 0.15;
      w.children[0].rotation.x = Math.cos(t * 0.7) * 0.08;

      this.colliders[i].position.copy(w.position);
      this.colliders[i].position.y = 1;
      // The wook walking up to dose Zerble is trying to GET close — its
      // collider would otherwise shove Zerble away (wook 0.9m + zerble 1.9m =
      // 2.8m minimum separation, which prevents the 2.5m proximity trigger
      // from ever firing). Mark this frame's approaching wook as passive so
      // the main collision resolver skips it.
      this.colliders[i].passive = isApproaching;
      this.colliders[i].damage = isApproaching ? 0 : 5;
    }
  }
}

// =================================================================
// Helpers
// =================================================================

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
