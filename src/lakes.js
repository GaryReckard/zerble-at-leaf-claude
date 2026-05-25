// Lakes are first-class world features, not chunk content. A lake spans
// multiple chunks (big body radius 70-100m, small body 25-40m), placed at a
// deterministic position within a 320m "lake macrocell". They load when the
// player gets within LOAD_RADIUS and persist until LOAD_RADIUS_UNLOAD — so
// the player can see them well before they reach them, and they don't pop
// in/out at chunk boundaries.
//
// Lakes register their footprints + colliders in the shared registry without
// a chunkKey (so chunk unload doesn't tear them down), and chunks consult
// the registry to avoid placing paths/decorations on top of water.

import * as THREE from 'three';
import { registry } from './registry.js';
import { hash2, mulberry32 } from './rng.js';

const LAKE_CELL = 320;
const LAKE_DENSITY = 0.45;       // ~45% of macrocells get a lake
const LOAD_RADIUS = 720;          // build lakes within this distance of the player
const UNLOAD_RADIUS = 1500;       // tear them down beyond this (rebuilt deterministically on return)

const _key = (mcx, mcz) => `${mcx},${mcz}`;

export class LakeManager {
  constructor() {
    // key -> { center, bigR, smallR, group, registryIds } | null (null = no lake here)
    this.lakes = new Map();
  }

  update(scene, playerPos, dt = 0.016) {
    const mcxMin = Math.floor((playerPos.x - LOAD_RADIUS) / LAKE_CELL);
    const mcxMax = Math.floor((playerPos.x + LOAD_RADIUS) / LAKE_CELL);
    const mczMin = Math.floor((playerPos.z - LOAD_RADIUS) / LAKE_CELL);
    const mczMax = Math.floor((playerPos.z + LOAD_RADIUS) / LAKE_CELL);

    // Build (or note absence of) lakes in nearby macrocells.
    for (let mcx = mcxMin; mcx <= mcxMax; mcx++) {
      for (let mcz = mczMin; mcz <= mczMax; mcz++) {
        const key = _key(mcx, mcz);
        if (this.lakes.has(key)) continue;
        // Don't drop a lake on the main stage / LEAF arch.
        if (mcx === 0 && mcz === 0) {
          this.lakes.set(key, null);
          continue;
        }
        const seed = hash2(mcx * 17 + 91, mcz * 13 + 31);
        const rng = mulberry32(seed);
        if (rng() > LAKE_DENSITY) {
          this.lakes.set(key, null);
          continue;
        }
        this.lakes.set(key, buildLake(scene, mcx, mcz, rng));
      }
    }

    // Unload distant lakes (rebuilt deterministically when the player returns).
    for (const [key, lake] of this.lakes) {
      if (!lake) continue;
      const dx = lake.center.x - playerPos.x;
      const dz = lake.center.z - playerPos.z;
      if (Math.hypot(dx, dz) > UNLOAD_RADIUS) {
        destroyLake(scene, lake);
        this.lakes.delete(key);
      }
    }

    // Drift canoes on every loaded lake.
    for (const [, lake] of this.lakes) {
      if (lake && lake.canoe) updateCanoe(lake.canoe, dt);
    }
  }
}

function buildLake(scene, mcx, mcz, rng) {
  const cellOriginX = mcx * LAKE_CELL;
  const cellOriginZ = mcz * LAKE_CELL;

  // Lake bodies sized for world-scale impact — the user explicitly asked for
  // "5 to 10x as big as what you have" (was 22m big / 9m small).
  const bigR = 70 + rng() * 30;     // 70-100 m
  const smallR = 25 + rng() * 15;   // 25-40 m
  const causewayHalfW = 4;          // 8m wide grass road
  const peninsulaLen = smallR * 0.55;

  // Position the big lake comfortably within the macrocell. Keep some margin
  // from the macrocell edge so neighbour macrocells' content has room.
  const margin = bigR + 30;
  const bigCx = cellOriginX + margin + rng() * (LAKE_CELL - 2 * margin);
  const bigCz = cellOriginZ + margin + rng() * (LAKE_CELL - 2 * margin);

  // Small lake to the north-east of big lake, distance ~bigR + smallR + 30m.
  const sepAngle = (rng() * 0.6 - 0.3) + Math.PI / 4;  // roughly NE, slight jitter
  const sep = bigR + smallR + 25 + rng() * 15;
  const smallCx = bigCx + Math.cos(sepAngle) * sep;
  const smallCz = bigCz + Math.sin(sepAngle) * sep;

  // Causeway runs along the line between the two lake centers, perpendicular
  // to the sep axis is the strip width direction.
  const dirX = (smallCx - bigCx) / sep;
  const dirZ = (smallCz - bigCz) / sep;
  // Causeway midpoint
  const causewayMidX = (bigCx + smallCx) / 2;
  const causewayMidZ = (bigCz + smallCz) / 2;
  // Causeway runs ALONG the sep axis through the two lakes.
  const causewayLen = sep + bigR + smallR + 40;  // extends past both lakes
  const causewayAngle = Math.atan2(dirZ, dirX);

  // ---- Materials ----
  // Water no longer uses polygonOffset — that was a leftover from the bumpy-
  // ground era and was pushing water fragments toward the camera, causing the
  // causeway/peninsula to z-fight on top of it. With a flat ground and the
  // causeway lifted above water (y=0.18 vs water y=0.08), the water just
  // needs depthWrite=false so transparent blending behaves.
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x4d96d6,
    emissive: 0x1a3550,
    emissiveIntensity: 0.25,
    roughness: 0.3,
    metalness: 0.05,
    transparent: true,
    opacity: 0.88,
    flatShading: true,
    depthWrite: false,
  });
  const grassMat = new THREE.MeshStandardMaterial({
    color: 0x82c277,
    roughness: 0.95,
    flatShading: true,
  });

  const group = new THREE.Group();
  group.name = `lake(${mcx},${mcz})`;

  // ---- Big lake water ----
  const bigWater = new THREE.Mesh(new THREE.CircleGeometry(bigR, 64), waterMat);
  bigWater.rotation.x = -Math.PI / 2;
  bigWater.position.set(bigCx, 0.08, bigCz);
  bigWater.receiveShadow = true;
  bigWater.renderOrder = 0;
  group.add(bigWater);

  // ---- Small lake water ----
  const smallWater = new THREE.Mesh(new THREE.CircleGeometry(smallR, 40), waterMat);
  smallWater.rotation.x = -Math.PI / 2;
  smallWater.position.set(smallCx, 0.08, smallCz);
  smallWater.receiveShadow = true;
  smallWater.renderOrder = 0;
  group.add(smallWater);

  // ---- Island in big lake ----
  const islandR = 5 + rng() * 3;       // 5-8 m
  const islandOff = bigR * 0.25 * (rng() - 0.5);
  // Slightly offset from center, perpendicular to sep axis
  const islandX = bigCx - dirZ * islandOff;
  const islandZ = bigCz + dirX * islandOff;
  const island = new THREE.Mesh(new THREE.CircleGeometry(islandR, 24), grassMat);
  island.rotation.x = -Math.PI / 2;
  island.position.set(islandX, 0.16, islandZ);
  island.receiveShadow = true;
  island.renderOrder = 1;
  group.add(island);

  // Tree on the island, scaled to lake scale
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6a4a2a, roughness: 0.95, flatShading: true });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x5fa55d, roughness: 0.95, flatShading: true });
  const trunkH = 4 + rng() * 1.5;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.55, trunkH, 8), trunkMat);
  trunk.position.set(islandX, trunkH / 2, islandZ);
  trunk.castShadow = true;
  group.add(trunk);
  const leafR = 2.2 + rng() * 0.6;
  const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(leafR, 1), leafMat);
  leaf.position.set(islandX, trunkH + leafR * 0.5, islandZ);
  leaf.castShadow = true;
  group.add(leaf);

  // ---- Causeway: grass strip running along the sep axis through both lakes ----
  const causeway = new THREE.Mesh(
    new THREE.PlaneGeometry(causewayLen, causewayHalfW * 2),
    grassMat,
  );
  causeway.rotation.x = -Math.PI / 2;
  causeway.rotation.z = -causewayAngle;
  // y=0.18 puts the causeway comfortably above the water (y=0.08) so there's
  // no z-fight where the strip crosses the lake.
  causeway.position.set(causewayMidX, 0.18, causewayMidZ);
  causeway.receiveShadow = true;
  causeway.renderOrder = 1;
  group.add(causeway);

  // ---- Peninsula in small lake: a finger jutting into the small lake from
  // the OPPOSITE side of where the causeway enters. ----
  const peninsulaAngle = causewayAngle + Math.PI;  // 180° from causeway entry
  const pCx = smallCx + Math.cos(peninsulaAngle) * peninsulaLen * 0.5;
  const pCz = smallCz + Math.sin(peninsulaAngle) * peninsulaLen * 0.5;
  const peninsula = new THREE.Mesh(
    new THREE.PlaneGeometry(peninsulaLen, 4),
    grassMat,
  );
  peninsula.rotation.x = -Math.PI / 2;
  peninsula.rotation.z = -peninsulaAngle;
  peninsula.position.set(pCx, 0.20, pCz);
  peninsula.receiveShadow = true;
  peninsula.renderOrder = 1;
  group.add(peninsula);

  scene.add(group);

  // ---- Registry: footprints (NPC + tree avoidance) ----
  const registryIds = [];
  registryIds.push(registry.add({
    kind: 'lake',
    position: new THREE.Vector3(bigCx, 0, bigCz),
    footprint: bigR,
  }));
  registryIds.push(registry.add({
    kind: 'lake',
    position: new THREE.Vector3(smallCx, 0, smallCz),
    footprint: smallR,
  }));

  // ---- Edge colliders: ring around each lake's perimeter ----
  addLakeRingColliders(registryIds, bigCx, bigCz, bigR, causewayAngle, causewayHalfW, null);
  addLakeRingColliders(registryIds, smallCx, smallCz, smallR, causewayAngle + Math.PI, causewayHalfW, peninsulaAngle);

  // Island as a soft bump
  registryIds.push(registry.add({
    kind: 'island',
    position: new THREE.Vector3(islandX, 0.5, islandZ),
    footprint: islandR,
    collider: { radius: islandR + 0.4, damage: 3 },
  }));

  // Shore attractors: NPCs like hanging out at the shoreline. Sample 3-4 points
  // around the big lake's perimeter and one on the peninsula tip.
  const shoreSamples = 4;
  for (let i = 0; i < shoreSamples; i++) {
    const a = (i / shoreSamples) * Math.PI * 2 + rng() * 0.3;
    const r = bigR + 5;
    registryIds.push(registry.add({
      kind: 'shore',
      position: new THREE.Vector3(bigCx + Math.cos(a) * r, 0, bigCz + Math.sin(a) * r),
      footprint: 0,
      attractor: { radius: 8, weight: 1.8 },
    }));
  }
  registryIds.push(registry.add({
    kind: 'shore',
    position: new THREE.Vector3(pCx + Math.cos(peninsulaAngle) * peninsulaLen * 0.3, 0, pCz + Math.sin(peninsulaAngle) * peninsulaLen * 0.3),
    footprint: 0,
    attractor: { radius: 6, weight: 1.6 },
  }));

  // ---- Canoe with paddler(s) drifting around the big lake ----
  const canoe = createLakeCanoe(group, bigCx, bigCz, bigR, rng);

  return {
    center: new THREE.Vector3(bigCx, 0, bigCz),
    bigR,
    smallR,
    group,
    registryIds,
    canoe,
  };
}

// ---- Canoe ----------------------------------------------------------------

function createLakeCanoe(parentGroup, lakeCx, lakeCz, lakeR, rng) {
  const canoeGroup = new THREE.Group();
  canoeGroup.name = 'canoe';
  buildCanoeMesh(canoeGroup, rng);
  // Start at a random point well inside the lake.
  const ang = rng() * Math.PI * 2;
  const r = lakeR * 0.4;
  canoeGroup.position.set(lakeCx + Math.cos(ang) * r, 0, lakeCz + Math.sin(ang) * r);
  canoeGroup.rotation.y = rng() * Math.PI * 2;
  parentGroup.add(canoeGroup);

  return {
    group: canoeGroup,
    lakeCx, lakeCz,
    safeR: lakeR * 0.78,           // stay inside this radius (off the shore)
    heading: canoeGroup.rotation.y,
    speed: 0.7 + rng() * 0.5,
    targetX: lakeCx,
    targetZ: lakeCz,
    timer: 0,
    bobPhase: rng() * Math.PI * 2,
  };
}

function updateCanoe(canoe, dt) {
  canoe.timer -= dt;
  // Pick a new target inside the lake's safe radius every 6-14s.
  if (canoe.timer <= 0) {
    const ang = Math.random() * Math.PI * 2;
    const r = Math.random() * canoe.safeR * 0.85;
    canoe.targetX = canoe.lakeCx + Math.cos(ang) * r;
    canoe.targetZ = canoe.lakeCz + Math.sin(ang) * r;
    canoe.timer = 6 + Math.random() * 8;
  }

  // Steer toward target.
  const dx = canoe.targetX - canoe.group.position.x;
  const dz = canoe.targetZ - canoe.group.position.z;
  const dist = Math.hypot(dx, dz);
  if (dist > 0.5) {
    // Convention: canoe modeled with long axis along +Z. heading rotates around Y.
    // We want forward direction = (sin(h), 0, cos(h)) (rotating +Z by Y rotation h
    // gives (sin h, 0, cos h)). To face toward (dx, dz), heading = atan2(dx, dz).
    const targetHeading = Math.atan2(dx, dz);
    let diff = targetHeading - canoe.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    canoe.heading += Math.sign(diff) * Math.min(Math.abs(diff), 0.7 * dt);

    // Move forward in current heading direction.
    canoe.group.position.x += Math.sin(canoe.heading) * canoe.speed * dt;
    canoe.group.position.z += Math.cos(canoe.heading) * canoe.speed * dt;
  }

  // Hard clamp inside the lake — if drift pushes the canoe past safeR, pull it back.
  const ox = canoe.group.position.x - canoe.lakeCx;
  const oz = canoe.group.position.z - canoe.lakeCz;
  const distFromCenter = Math.hypot(ox, oz);
  if (distFromCenter > canoe.safeR) {
    const inv = canoe.safeR / distFromCenter;
    canoe.group.position.x = canoe.lakeCx + ox * inv;
    canoe.group.position.z = canoe.lakeCz + oz * inv;
    // Pick a new target back toward center
    canoe.targetX = canoe.lakeCx;
    canoe.targetZ = canoe.lakeCz;
    canoe.timer = 4 + Math.random() * 3;
  }

  // Gentle bob + sway for "floating on water" feel.
  canoe.bobPhase += dt * 1.3;
  canoe.group.position.y = 0.04 + Math.sin(canoe.bobPhase) * 0.04;
  canoe.group.rotation.y = canoe.heading;
  canoe.group.rotation.x = Math.sin(canoe.bobPhase * 0.7) * 0.03;
  canoe.group.rotation.z = Math.cos(canoe.bobPhase * 0.5) * 0.04;
}

// Builds the canoe + paddler meshes at the group's origin. Long axis along Z.
function buildCanoeMesh(group, rng = Math.random) {
  const woodMat = new THREE.MeshStandardMaterial({
    color: 0x8b5a2b, roughness: 0.95, flatShading: true,
  });
  const insideMat = new THREE.MeshStandardMaterial({
    color: 0xd4a874, roughness: 0.95, flatShading: true,
  });

  // Hull
  const hull = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.4, 4.0), woodMat);
  hull.position.y = 0.2;
  hull.castShadow = true;
  hull.receiveShadow = true;
  group.add(hull);

  // Pointed bow + stern
  for (const ez of [-2.0, 2.0]) {
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.48, 1.0, 6), woodMat);
    tip.rotation.x = ez < 0 ? Math.PI / 2 : -Math.PI / 2;
    tip.position.set(0, 0.2, ez);
    tip.castShadow = true;
    group.add(tip);
  }

  // Inside floor (slightly raised, lighter wood)
  const floor = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.05, 3.6), insideMat);
  floor.position.y = 0.40;
  group.add(floor);

  // Two thwarts (seat planks)
  for (const ez of [-0.7, 0.7]) {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.06, 0.18), insideMat);
    seat.position.set(0, 0.50, ez);
    group.add(seat);
  }

  // 1-2 paddlers — always at least the front seat occupied.
  const shirts = [0x66d9ff, 0xff6f9c, 0xffd28a, 0x6fcf6a, 0xb285ff, 0xff8a5b];
  const seatPositions = [-0.7, 0.7];
  // Decide rear-seat occupancy first; front is always taken.
  const rearOccupied = rng() < 0.55;
  for (const ez of seatPositions) {
    if (ez > 0 && !rearOccupied) continue;

    const shirt = shirts[Math.floor(rng() * shirts.length)];
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.18, 0.55, 4, 6),
      new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.85, flatShading: true }),
    );
    body.position.set(0, 0.85, ez);
    body.castShadow = true;
    group.add(body);

    const head = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.20, 1),
      new THREE.MeshStandardMaterial({ color: 0xe6c098, roughness: 0.9, flatShading: true }),
    );
    head.position.set(0, 1.30, ez);
    head.castShadow = true;
    group.add(head);

    // Paddle — handle + blade, tilted to one side as if mid-stroke
    const paddleSide = ez < 0 ? -1 : 1;     // alternating sides per seat
    const paddle = new THREE.Group();
    const paddleHandle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, 1.4, 6),
      new THREE.MeshStandardMaterial({ color: 0x6a4a2a, roughness: 0.95, flatShading: true }),
    );
    paddleHandle.position.y = 0;
    paddle.add(paddleHandle);
    const paddleBlade = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.04, 0.45),
      new THREE.MeshStandardMaterial({ color: 0x8b6f47, roughness: 0.95, flatShading: true }),
    );
    paddleBlade.position.y = -0.75;
    paddle.add(paddleBlade);

    paddle.position.set(paddleSide * 0.55, 0.85, ez);
    paddle.rotation.z = paddleSide * -0.6;
    group.add(paddle);
  }
}

// Sandbox helper — same builder, with a sensible default rng.
export function _buildCanoeMeshForSandbox(group, rng = Math.random) {
  buildCanoeMesh(group, rng);
}

// Ring of overlapping sphere colliders around a lake. The cart's outer radius
// (1.9m) + sphereR(2.2) means cart_edge meets the visible water exactly when
// ringR = lakeR - sphereR. step = sphereR gives full overlap so the cart
// can't tunnel between spheres.
function addLakeRingColliders(registryIds, lcx, lcz, lakeR, causewayAngle, causewayHalfW, peninsulaAngle) {
  const sphereR = 2.2;
  const ringR = Math.max(2, lakeR - sphereR);
  const circumference = 2 * Math.PI * ringR;
  const step = sphereR;
  const n = Math.max(20, Math.ceil(circumference / step));

  // Causeway crosses the lake along causewayAngle. Compute the angular gap on
  // the ring as the half-width / ringR (small-angle ok since causewayHalfW << ringR).
  const causewayHalfArc = Math.atan2(causewayHalfW + 1.0, ringR);

  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2;

    // Skip both ends of the causeway axis (entry and exit) so the cart can drive through.
    const dCauseway = Math.min(
      angDiff(ang, causewayAngle),
      angDiff(ang, causewayAngle + Math.PI),
    );
    if (dCauseway < causewayHalfArc) continue;

    // Skip peninsula attachment if applicable
    if (peninsulaAngle != null && angDiff(ang, peninsulaAngle) < 0.20) continue;

    const px = lcx + Math.cos(ang) * ringR;
    const pz = lcz + Math.sin(ang) * ringR;
    registryIds.push(registry.add({
      kind: 'lake_edge',
      position: new THREE.Vector3(px, 0.5, pz),
      footprint: 0,
      collider: { radius: sphereR, damage: 1 },
    }));
  }
}

function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

function destroyLake(scene, lake) {
  lake.group.traverse((o) => {
    if (o.isMesh) {
      o.geometry?.dispose();
      // Materials are shared across the lake's meshes so disposing once is enough,
      // but it's cheap to call dispose repeatedly.
      const m = o.material;
      if (Array.isArray(m)) m.forEach((mm) => mm?.dispose?.());
      else m?.dispose?.();
    }
  });
  scene.remove(lake.group);
  for (const id of lake.registryIds) registry.remove(id);
}

// Helper for chunks.js to know whether a chunk should skip its standard paths
// because a lake passes through it.
export function chunkOverlapsLake(cxWorld, czWorld, halfChunk) {
  for (const e of registry.entries.values()) {
    if (e.kind !== 'lake' || !e.footprint) continue;
    const dx = Math.max(0, Math.abs(e.position.x - cxWorld) - halfChunk);
    const dz = Math.max(0, Math.abs(e.position.z - czWorld) - halfChunk);
    if (Math.hypot(dx, dz) < e.footprint) return true;
  }
  return false;
}

// Stricter check: is the chunk CENTER itself inside a lake footprint? Used to
// suppress theme builders that would place a stage / food truck / drum
// circle in the middle of the water.
export function chunkInLake(cxWorld, czWorld) {
  for (const e of registry.entries.values()) {
    if (e.kind !== 'lake' || !e.footprint) continue;
    const dx = e.position.x - cxWorld;
    const dz = e.position.z - czWorld;
    if (Math.hypot(dx, dz) < e.footprint) return true;
  }
  return false;
}
