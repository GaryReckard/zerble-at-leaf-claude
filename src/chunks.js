// Procedural festival, generated in chunks. Each chunk picks a theme based on its
// (cx, cz) seed and lays out props + spawns NPCs accordingly. Chunks are generated
// lazily as Zerble explores; for simplicity they stay loaded once created.
//
// Themes:
//   main_stage  — only at (0,0). Big stage with a dense audience.
//   side_stage  — smaller stage with audience.
//   food_plaza  — cluster of food trucks + tables.
//   vendor_row  — row of craft tents.
//   drum_circle — open area with a drum + congregated crowd.
//   grove       — dense trees, a few hammocks, sparse crowd.
//   open_lawn   — sparse — picnic blankets, room to drive.
//
// Every chunk also drops a path stripe along its primary axis so the player
// can see where to go, and NPC AI prefers walking near paths.

import * as THREE from 'three';
import { registry } from './registry.js';
import { hash2, mulberry32 } from './rng.js';

export const CHUNK_SIZE = 80;
const LOAD_RADIUS = 2; // 5x5 chunks loaded around the player

// Bands placed on stages — animated lightly each frame by the main loop.
export const stagePerformers = [];

export function updateStagePerformers(t) {
  for (let i = 0; i < stagePerformers.length; i++) {
    const p = stagePerformers[i];
    const phase = t * 3 + p.phase;
    p.group.position.y = p.baseY + Math.abs(Math.sin(phase)) * 0.08;
    p.group.rotation.z = Math.sin(phase * 0.5) * 0.05;
    p.group.rotation.y = p.baseYaw + Math.sin(phase * 0.3) * 0.15;
  }
}

// ---------- Public API ----------

export class ChunkManager {
  constructor(scene, crowd) {
    this.scene = scene;
    this.crowd = crowd;
    this.loaded = new Map(); // key -> { group, cx, cz, theme }
  }

  update(playerPos) {
    const ccx = Math.round(playerPos.x / CHUNK_SIZE);
    const ccz = Math.round(playerPos.z / CHUNK_SIZE);

    for (let dx = -LOAD_RADIUS; dx <= LOAD_RADIUS; dx++) {
      for (let dz = -LOAD_RADIUS; dz <= LOAD_RADIUS; dz++) {
        const cx = ccx + dx;
        const cz = ccz + dz;
        const key = chunkKey(cx, cz);
        if (!this.loaded.has(key)) {
          this._generate(cx, cz);
        }
      }
    }
  }

  _generate(cx, cz) {
    const key = chunkKey(cx, cz);
    const theme = pickTheme(cx, cz);
    const group = new THREE.Group();
    group.name = `chunk(${cx},${cz},${theme})`;

    const ctx = {
      cx, cz, key,
      cxWorld: cx * CHUNK_SIZE,
      czWorld: cz * CHUNK_SIZE,
      rng: mulberry32(hash2(cx, cz)),
      group,
      crowd: this.crowd,
    };

    // Every chunk: paths along its grid axes
    placePaths(ctx);

    // Build theme content FIRST so footprints register before we scatter trees & NPCs.
    THEME_BUILDERS[theme](ctx);

    // Scatter trees — will dodge the buildings we just registered.
    const treeDensity = THEME_PROPS[theme].treeDensity;
    scatterTrees(ctx, treeDensity);

    // Ambient crowd
    spawnAmbientCrowd(ctx, THEME_PROPS[theme].ambientCrowd);

    this.scene.add(group);
    this.loaded.set(key, { group, cx, cz, theme });
  }
}

function chunkKey(cx, cz) {
  return `${cx},${cz}`;
}

// ---------- Theme picking ----------

function pickTheme(cx, cz) {
  if (cx === 0 && cz === 0) return 'main_stage';

  const dist = Math.hypot(cx, cz);
  // Closer to origin: denser/more interesting; far: more groves and lawns.
  const rng = mulberry32(hash2(cx, cz, 1));
  const r = rng();

  if (dist <= 1.5) {
    if (r < 0.35) return 'side_stage';
    if (r < 0.55) return 'food_plaza';
    if (r < 0.80) return 'vendor_row';
    if (r < 0.92) return 'drum_circle';
    return 'grove';
  }
  if (dist <= 3.5) {
    if (r < 0.20) return 'side_stage';
    if (r < 0.35) return 'food_plaza';
    if (r < 0.55) return 'vendor_row';
    if (r < 0.70) return 'drum_circle';
    if (r < 0.90) return 'grove';
    return 'open_lawn';
  }
  // Outer rings — peaceful
  if (r < 0.10) return 'drum_circle';
  if (r < 0.30) return 'vendor_row';
  if (r < 0.65) return 'grove';
  return 'open_lawn';
}

const THEME_PROPS = {
  main_stage:  { treeDensity: 0.15, ambientCrowd: 18 }, // big audience right at the main stage
  side_stage:  { treeDensity: 0.25, ambientCrowd: 9 },
  food_plaza:  { treeDensity: 0.2, ambientCrowd: 10 },
  vendor_row:  { treeDensity: 0.3, ambientCrowd: 8 },
  drum_circle: { treeDensity: 0.4, ambientCrowd: 7 },
  grove:       { treeDensity: 1.0, ambientCrowd: 3 },
  open_lawn:   { treeDensity: 0.2, ambientCrowd: 3 },
};

const THEME_BUILDERS = {
  main_stage: buildMainStage,
  side_stage: buildSideStage,
  food_plaza: buildFoodPlaza,
  vendor_row: buildVendorRow,
  drum_circle: buildDrumCircle,
  grove: buildGrove,
  open_lawn: buildOpenLawn,
};

// ---------- Path placement ----------

function placePaths(ctx) {
  // Two perpendicular dirt strips through the chunk center — connect with neighbors
  // automatically because every chunk does the same thing.
  const pathColor = 0xb89570;
  const mat = new THREE.MeshStandardMaterial({
    color: pathColor,
    roughness: 1,
    metalness: 0,
    depthWrite: false,
  });

  const widthA = 5;
  const lenA = CHUNK_SIZE + 2;

  // E-W strip
  const ew = new THREE.Mesh(new THREE.PlaneGeometry(lenA, widthA), mat);
  ew.rotation.x = -Math.PI / 2;
  ew.position.set(ctx.cxWorld, 0.04, ctx.czWorld);
  ew.receiveShadow = true;
  ctx.group.add(ew);

  // N-S strip
  const ns = new THREE.Mesh(new THREE.PlaneGeometry(widthA, lenA), mat);
  ns.rotation.x = -Math.PI / 2;
  ns.position.set(ctx.cxWorld, 0.04, ctx.czWorld);
  ns.receiveShadow = true;
  ctx.group.add(ns);

  // A small dirt pad at the intersection
  const padGeo = new THREE.CircleGeometry(5, 16);
  const pad = new THREE.Mesh(padGeo, mat);
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(ctx.cxWorld, 0.05, ctx.czWorld);
  ctx.group.add(pad);

  // Register path waypoints for NPCs (chunk-local + 4 edge points)
  registry.add({
    kind: 'path_node',
    position: new THREE.Vector3(ctx.cxWorld, 0, ctx.czWorld),
    footprint: 0,
    attractor: { radius: 6, weight: 0.5 },
    chunkKey: ctx.key,
  });
}

// ---------- Tree scattering ----------

function scatterTrees(ctx, density) {
  const TREE_GREENS = [0x4f8a4d, 0x5fa55d, 0x6dba6a, 0x4b7c4a, 0x82c277];
  const trunkGeo = new THREE.CylinderGeometry(0.35, 0.5, 3.6, 8);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6a4a2a, roughness: 0.95, flatShading: true });

  const targetCount = Math.floor(density * 18);
  let placed = 0;
  let tries = 0;
  while (placed < targetCount && tries < targetCount * 5) {
    tries++;
    const x = ctx.cxWorld + (ctx.rng() - 0.5) * (CHUNK_SIZE - 6);
    const z = ctx.czWorld + (ctx.rng() - 0.5) * (CHUNK_SIZE - 6);
    // Avoid the path strip and existing buildings
    if (Math.abs(x - ctx.cxWorld) < 4 && Math.abs(z - ctx.czWorld) < CHUNK_SIZE * 0.5) continue;
    if (Math.abs(z - ctx.czWorld) < 4 && Math.abs(x - ctx.cxWorld) < CHUNK_SIZE * 0.5) continue;
    if (registry.closestBuilding(new THREE.Vector3(x, 0, z), 2.5)) continue;

    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = 1.8;
    trunk.castShadow = true;
    tree.add(trunk);

    if (ctx.rng() < 0.65) {
      const r = 1.6 + ctx.rng() * 1.0;
      const leaf = new THREE.Mesh(
        new THREE.IcosahedronGeometry(r, 1),
        new THREE.MeshStandardMaterial({
          color: TREE_GREENS[Math.floor(ctx.rng() * TREE_GREENS.length)],
          roughness: 0.95,
          flatShading: true,
        })
      );
      leaf.position.y = 3.8 + ctx.rng() * 0.4;
      leaf.castShadow = true;
      tree.add(leaf);
    } else {
      const h = 4 + ctx.rng() * 2.5;
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(1.4, h, 8),
        new THREE.MeshStandardMaterial({ color: 0x2d5d3e, roughness: 0.95, flatShading: true })
      );
      cone.position.y = 2 + h / 2;
      cone.castShadow = true;
      tree.add(cone);
    }

    tree.position.set(x, 0, z);
    tree.rotation.y = ctx.rng() * Math.PI * 2;
    ctx.group.add(tree);

    registry.add({
      kind: 'tree',
      position: new THREE.Vector3(x, 0, z),
      footprint: 1.2,
      attractor: { radius: 4, weight: 0.15 },
      chunkKey: ctx.key,
    });
    placed++;
  }
}

// ---------- Theme builders ----------

function buildMainStage(ctx) {
  const x = ctx.cxWorld;
  const z = ctx.czWorld - 20; // slightly off center in the chunk
  buildStage(ctx, x, z, true);
  buildEntranceArch(ctx, x, ctx.czWorld + 30);
  // Add string lights along the main path
  for (let s = -25; s <= 25; s += 16) {
    placePolePair(ctx, x - 18, ctx.czWorld + s, x + 18, ctx.czWorld + s);
  }
}

function buildSideStage(ctx) {
  const x = ctx.cxWorld + (ctx.rng() - 0.5) * 10;
  const z = ctx.czWorld + (ctx.rng() - 0.5) * 10;
  buildStage(ctx, x, z, false);
}

function buildFoodPlaza(ctx) {
  // 3-5 food trucks arranged around a central area
  const count = 3 + Math.floor(ctx.rng() * 3);
  const centerX = ctx.cxWorld;
  const centerZ = ctx.czWorld;
  const ring = 14;
  for (let i = 0; i < count; i++) {
    const ang = (i / count) * Math.PI * 2 + ctx.rng() * 0.4;
    const x = centerX + Math.cos(ang) * ring;
    const z = centerZ + Math.sin(ang) * ring;
    const truck = buildFoodTruck(ctx);
    truck.position.set(x, 0, z);
    truck.rotation.y = Math.atan2(centerX - x, centerZ - z); // face inward
    ctx.group.add(truck);

    registry.add({
      kind: 'truck',
      position: new THREE.Vector3(x, 1.5, z),
      footprint: 4.4,
      collider: { radius: 3.6, damage: 12 },
      attractor: { radius: 8, weight: 1.2 },
      chunkKey: ctx.key,
    });
  }
}

function buildVendorRow(ctx) {
  // Two parallel rows of tents along one axis
  const axisH = ctx.rng() < 0.5;
  const count = 4 + Math.floor(ctx.rng() * 3);
  const spacing = 9;
  const rowOffset = 8;
  for (let i = 0; i < count; i++) {
    for (const side of [-1, 1]) {
      const t = i - (count - 1) / 2;
      const x = ctx.cxWorld + (axisH ? t * spacing : side * rowOffset);
      const z = ctx.czWorld + (axisH ? side * rowOffset : t * spacing);
      const tent = buildTent(ctx);
      tent.position.set(x, 0, z);
      tent.rotation.y = axisH ? (side < 0 ? 0 : Math.PI) : (side < 0 ? Math.PI / 2 : -Math.PI / 2);
      ctx.group.add(tent);

      registry.add({
        kind: 'tent',
        position: new THREE.Vector3(x, 0, z),
        footprint: 2.6,
        collider: { radius: 2.2, damage: 5 },
        attractor: { radius: 4, weight: 0.5 },
        chunkKey: ctx.key,
      });
    }
  }
}

function buildDrumCircle(ctx) {
  // A small fire pit + bench ring + a big drum
  const x = ctx.cxWorld + (ctx.rng() - 0.5) * 8;
  const z = ctx.czWorld + (ctx.rng() - 0.5) * 8;

  // Fire (emissive)
  const fire = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.6, 1),
    new THREE.MeshStandardMaterial({
      color: 0xff7733,
      emissive: 0xff5511,
      emissiveIntensity: 2.5,
      roughness: 0.8,
    })
  );
  fire.position.set(x, 0.6, z);
  ctx.group.add(fire);

  // Stones around fire
  for (let i = 0; i < 8; i++) {
    const ang = (i / 8) * Math.PI * 2;
    const sx = x + Math.cos(ang) * 1.4;
    const sz = z + Math.sin(ang) * 1.4;
    const stone = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.3 + ctx.rng() * 0.15, 0),
      new THREE.MeshStandardMaterial({ color: 0x6a6a78, roughness: 1, flatShading: true })
    );
    stone.position.set(sx, 0.3, sz);
    stone.castShadow = true;
    ctx.group.add(stone);
  }

  // Big djembe drum
  const drum = new THREE.Mesh(
    new THREE.CylinderGeometry(0.7, 0.55, 1.4, 14),
    new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.9, flatShading: true })
  );
  drum.position.set(x + 3, 0.7, z + 1);
  drum.castShadow = true;
  ctx.group.add(drum);

  registry.add({
    kind: 'drum_circle',
    position: new THREE.Vector3(x, 0, z),
    footprint: 1.5,
    collider: { radius: 1.2, damage: 4 },
    attractor: { radius: 12, weight: 2.2 },
    chunkKey: ctx.key,
  });
}

function buildGrove(ctx) {
  // Already covered by tree scattering — add a hammock or two
  const count = 1 + Math.floor(ctx.rng() * 2);
  for (let i = 0; i < count; i++) {
    const x = ctx.cxWorld + (ctx.rng() - 0.5) * (CHUNK_SIZE * 0.6);
    const z = ctx.czWorld + (ctx.rng() - 0.5) * (CHUNK_SIZE * 0.6);
    if (Math.abs(x - ctx.cxWorld) < 6 && Math.abs(z - ctx.czWorld) < 6) continue;
    buildHammock(ctx, x, z);
  }
}

function buildOpenLawn(ctx) {
  // Picnic blankets
  const count = 1 + Math.floor(ctx.rng() * 3);
  for (let i = 0; i < count; i++) {
    const x = ctx.cxWorld + (ctx.rng() - 0.5) * (CHUNK_SIZE * 0.7);
    const z = ctx.czWorld + (ctx.rng() - 0.5) * (CHUNK_SIZE * 0.7);
    const colors = [0xff6f9c, 0xffd28a, 0x6fcf6a, 0x66d9ff, 0xb285ff, 0xff8a5b];
    const blanket = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 2.6),
      new THREE.MeshStandardMaterial({
        color: colors[Math.floor(ctx.rng() * colors.length)],
        roughness: 0.9,
        side: THREE.DoubleSide,
      })
    );
    blanket.rotation.x = -Math.PI / 2;
    blanket.position.set(x, 0.06, z);
    blanket.rotation.z = ctx.rng() * Math.PI * 2;
    ctx.group.add(blanket);

    registry.add({
      kind: 'picnic',
      position: new THREE.Vector3(x, 0, z),
      footprint: 0,
      attractor: { radius: 3, weight: 0.4 },
      chunkKey: ctx.key,
    });
  }
}

// ---------- Reusable builders ----------

function buildStage(ctx, x, z, isMain) {
  const w = isMain ? 24 : 14;
  const d = isMain ? 12 : 8;
  const h = 1.5;

  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 0.95, flatShading: true })
  );
  deck.position.set(x, h / 2, z);
  deck.castShadow = true;
  deck.receiveShadow = true;
  ctx.group.add(deck);

  const bannerColor = isMain ? 0x6fcf6a : [0xff9a8b, 0xc77dff, 0x66d9ff, 0xffd28a][Math.floor(ctx.rng() * 4)];
  const banner = new THREE.Mesh(
    new THREE.BoxGeometry(w, 7, 0.4),
    new THREE.MeshStandardMaterial({ color: bannerColor, roughness: 0.9, flatShading: true })
  );
  banner.position.set(x, 4.5, z - d / 2 - 0.2);
  banner.castShadow = true;
  ctx.group.add(banner);

  // LEAF on the main stage — single banner plane painted with the word
  if (isMain) {
    const bannerW = Math.min(w - 2, 16);
    const leaf = new THREE.Mesh(
      new THREE.PlaneGeometry(bannerW, 3.4),
      new THREE.MeshStandardMaterial({
        map: leafBannerTexture('#fff4d0', '#6fcf6a'),
        emissive: 0xffd28a,
        emissiveMap: leafBannerTexture('#ffd28a', '#000000'),
        emissiveIntensity: 0.55,
        roughness: 0.6,
        side: THREE.DoubleSide,
      })
    );
    // Sit slightly in front of the green banner's front face (front face is at z - d/2)
    leaf.position.set(x, 5.3, z - d / 2 + 0.06);
    ctx.group.add(leaf);
  }

  // Truss
  const trussMat = new THREE.MeshStandardMaterial({ color: 0x2a1f3a, roughness: 0.5, metalness: 0.4, flatShading: true });
  for (const [px, pz] of [
    [-w / 2 + 0.3, -d / 2 + 0.3], [w / 2 - 0.3, -d / 2 + 0.3],
    [-w / 2 + 0.3, d / 2 - 0.3], [w / 2 - 0.3, d / 2 - 0.3],
  ]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.25, 9, 0.25), trussMat);
    p.position.set(x + px, 4.5, z + pz);
    ctx.group.add(p);
  }
  for (const dx of [-w / 2, w / 2]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, d), trussMat);
    b.position.set(x + dx, 9, z);
    ctx.group.add(b);
  }
  for (const dz of [-d / 2, d / 2]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, 0.25, 0.25), trussMat);
    b.position.set(x, 9, z + dz);
    ctx.group.add(b);
  }

  // Speaker stacks
  for (const sx of [-w / 2 - 1, w / 2 + 1]) {
    for (let sy = 0; sy < 3; sy++) {
      const spk = new THREE.Mesh(
        new THREE.BoxGeometry(1.6, 1.4, 1.4),
        new THREE.MeshStandardMaterial({ color: 0x121212, roughness: 0.8, flatShading: true })
      );
      spk.position.set(x + sx, 1.4 + sy * 1.45, z - d / 2 + 1.2);
      spk.castShadow = true;
      ctx.group.add(spk);
    }
  }

  // Stage lights
  for (const lx of [-w * 0.3, 0, w * 0.3]) {
    const colorHex = isMain ? [0xff6f9c, 0xffd28a, 0xb285ff][Math.floor(ctx.rng() * 3)] : 0xffd28a;
    const lampLens = new THREE.Mesh(
      new THREE.ConeGeometry(0.4, 0.6, 12, 1, true),
      new THREE.MeshStandardMaterial({
        color: colorHex,
        emissive: colorHex,
        emissiveIntensity: 2.5,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.85,
      })
    );
    lampLens.position.set(x + lx, 8.3, z);
    lampLens.rotation.x = Math.PI;
    ctx.group.add(lampLens);
  }

  // ----- Colliders: overlapping spheres covering the full footprint -----
  // Stage deck rectangle is w x d. We tile spheres so Zerble can't get through from any side.
  const sphereStep = 4;
  const sphereR = 3.0;
  const collDamage = isMain ? 14 : 9;
  for (let xx = -w / 2; xx <= w / 2 + 0.1; xx += sphereStep) {
    for (let zz = -d / 2; zz <= d / 2 + 0.1; zz += sphereStep) {
      registry.add({
        kind: 'stage',
        position: new THREE.Vector3(x + xx, 1, z + zz),
        footprint: 3.2,
        collider: { radius: sphereR, damage: collDamage },
        chunkKey: ctx.key,
      });
    }
  }

  // Attractor in front of the stage so crowds gather there
  registry.add({
    kind: 'stage_front',
    position: new THREE.Vector3(x, 0, z + d / 2 + 6),
    footprint: 0,
    attractor: { radius: 14, weight: isMain ? 3.5 : 2.0 },
    chunkKey: ctx.key,
  });

  // ----- The band on stage -----
  // Main stage gets a bigger ensemble (6 performers). Side stages get a trio.
  const instruments = isMain
    ? ['lead_vocal', 'guitar', 'guitar', 'bass', 'drum', 'sax']
    : ['lead_vocal', 'guitar', 'drum'];
  // Lay them out along the stage front, lead vocal center-front, others slightly behind.
  const lineZ = z + 0.5; // slightly behind front edge, on the deck
  const backZ = z - d * 0.25;
  for (let i = 0; i < instruments.length; i++) {
    const inst = instruments[i];
    const isLead = inst === 'lead_vocal' || inst === 'drum' || inst === 'bass';
    const spread = w * 0.32;
    const spotX = x + ((i / (instruments.length - 1 || 1)) - 0.5) * spread * 2;
    const spotZ = inst === 'drum' ? backZ : isLead && i === 0 ? lineZ + 1.0 : lineZ - 0.5;
    const performer = makePerformer(ctx, inst);
    performer.position.set(spotX, h, spotZ); // h = stage deck height
    performer.rotation.y = Math.PI; // face the audience (local -Z faces +Z toward crowd)
    ctx.group.add(performer);

    stagePerformers.push({
      group: performer,
      baseY: h,
      baseYaw: Math.PI,
      phase: Math.random() * Math.PI * 2,
    });
  }
}

function makePerformer(ctx, instrument) {
  const g = new THREE.Group();
  const shirtColors = [0xff6f9c, 0xffd28a, 0xb285ff, 0x66d9ff, 0x6fcf6a, 0xff8a5b];
  const shirt = shirtColors[Math.floor(ctx.rng() * shirtColors.length)];

  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.34, 1.1, 4, 8),
    new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.85, flatShading: true })
  );
  body.position.y = 0.9;
  body.castShadow = true;
  g.add(body);

  const head = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.3, 1),
    new THREE.MeshStandardMaterial({ color: 0xe6c098, roughness: 0.9, flatShading: true })
  );
  head.position.y = 1.75;
  head.castShadow = true;
  g.add(head);

  const brass = new THREE.MeshStandardMaterial({
    color: 0xe8b042, roughness: 0.4, metalness: 0.85, flatShading: true,
  });
  const black = new THREE.MeshStandardMaterial({ color: 0x121212, roughness: 0.6, flatShading: true });
  const wood = new THREE.MeshStandardMaterial({ color: 0x6a4a2a, roughness: 0.9, flatShading: true });

  if (instrument === 'guitar') {
    const guitarBody = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.7, 0.15),
      new THREE.MeshStandardMaterial({
        color: [0x9b3b2a, 0x4a6f2a, 0x222244, 0xc28a44][Math.floor(ctx.rng() * 4)],
        roughness: 0.5, flatShading: true,
      })
    );
    guitarBody.position.set(0.15, 1.0, -0.35);
    guitarBody.rotation.z = -0.4;
    g.add(guitarBody);
    const neck = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.0, 0.09), wood);
    neck.position.set(-0.55, 1.25, -0.45);
    neck.rotation.z = -0.4;
    g.add(neck);
    const head2 = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.06), wood);
    head2.position.set(-0.95, 1.45, -0.5);
    head2.rotation.z = -0.4;
    g.add(head2);
  } else if (instrument === 'bass') {
    const bassBody = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.85, 0.18),
      new THREE.MeshStandardMaterial({ color: 0x1a3658, roughness: 0.5, flatShading: true })
    );
    bassBody.position.set(0.1, 0.9, -0.35);
    bassBody.rotation.z = -0.35;
    g.add(bassBody);
    const neck = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.2, 0.1), wood);
    neck.position.set(-0.6, 1.2, -0.45);
    neck.rotation.z = -0.35;
    g.add(neck);
  } else if (instrument === 'drum') {
    // Kick drum + tom on a stand
    const kick = new THREE.Mesh(
      new THREE.CylinderGeometry(0.7, 0.7, 0.6, 16),
      new THREE.MeshStandardMaterial({ color: 0xfff4d0, roughness: 0.7, flatShading: true })
    );
    kick.rotation.x = Math.PI / 2;
    kick.position.set(0, 0.6, -0.6);
    g.add(kick);
    const tom = new THREE.Mesh(
      new THREE.CylinderGeometry(0.32, 0.32, 0.4, 12),
      new THREE.MeshStandardMaterial({ color: 0xc97a3b, roughness: 0.7, flatShading: true })
    );
    tom.position.set(0.45, 1.25, -0.55);
    g.add(tom);
    const cymbal = new THREE.Mesh(
      new THREE.CylinderGeometry(0.4, 0.4, 0.03, 16),
      brass
    );
    cymbal.position.set(-0.5, 1.65, -0.55);
    cymbal.rotation.x = -0.15;
    g.add(cymbal);
  } else if (instrument === 'sax') {
    const body2 = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.18, 0.95, 10), brass);
    body2.position.set(0.25, 1.25, -0.35);
    body2.rotation.z = -0.35;
    g.add(body2);
    const bell = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.45, 12, 1, true), brass);
    bell.position.set(0.45, 1.8, -0.35);
    bell.rotation.z = -0.35;
    g.add(bell);
  } else {
    // lead_vocal: just a mic on a stand
    const standBase = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.05, 12), black);
    standBase.position.set(0, 0.025, -0.4);
    g.add(standBase);
    const standPole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.5, 8), black);
    standPole.position.set(0, 0.8, -0.4);
    g.add(standPole);
    const mic = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), black);
    mic.position.set(0, 1.55, -0.4);
    g.add(mic);
  }

  return g;
}

function buildTent(ctx) {
  const g = new THREE.Group();

  const baseColor = [0xfff4d0, 0xe7c995, 0xfddfa5, 0xd0c2a8][Math.floor(ctx.rng() * 4)];
  const roofColor = [0xff6f9c, 0x6fcf6a, 0xffd28a, 0xb285ff, 0x66d9ff][Math.floor(ctx.rng() * 5)];

  const legMat = new THREE.MeshStandardMaterial({ color: 0x3a2e22, roughness: 0.8, flatShading: true });
  for (const [lx, lz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.15, 2.5, 0.15), legMat);
    leg.position.set(lx, 1.25, lz);
    leg.castShadow = true;
    g.add(leg);
  }

  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(3.2, 1.8, 4),
    new THREE.MeshStandardMaterial({ color: roofColor, roughness: 0.85, flatShading: true })
  );
  roof.position.y = 3.4;
  roof.rotation.y = Math.PI / 4;
  roof.castShadow = true;
  g.add(roof);

  const table = new THREE.Mesh(
    new THREE.BoxGeometry(3.0, 0.1, 1.2),
    new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.9, flatShading: true })
  );
  table.position.set(0, 1.0, 0);
  table.castShadow = true;
  table.receiveShadow = true;
  g.add(table);

  for (let i = 0; i < 3; i++) {
    const obj = new THREE.Mesh(
      new THREE.BoxGeometry(0.25 + ctx.rng() * 0.2, 0.2 + ctx.rng() * 0.3, 0.25),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(ctx.rng(), 0.7, 0.55),
        roughness: 0.7,
        flatShading: true,
      })
    );
    obj.position.set(-1 + i * 1, 1.2, 0);
    g.add(obj);
  }

  return g;
}

function buildFoodTruck(ctx) {
  const g = new THREE.Group();

  const color = [0xff6f9c, 0xffd28a, 0x66d9ff, 0x6fcf6a, 0xb285ff, 0xff8a5b][Math.floor(ctx.rng() * 6)];
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.55, flatShading: true });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.8, flatShading: true });
  const windowMat = new THREE.MeshStandardMaterial({
    color: 0x97e6ff, emissive: 0x97e6ff, emissiveIntensity: 0.15, roughness: 0.2,
  });

  const box = new THREE.Mesh(new THREE.BoxGeometry(6, 3, 3.2), bodyMat);
  box.position.set(0.5, 1.9, 0);
  box.castShadow = true;
  box.receiveShadow = true;
  g.add(box);

  const cab = new THREE.Mesh(new THREE.BoxGeometry(2, 2.2, 3.0), bodyMat);
  cab.position.set(-2.5, 1.4, 0);
  cab.castShadow = true;
  g.add(cab);

  const wind = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.0, 2.5), windowMat);
  wind.position.set(-3.55, 1.9, 0);
  g.add(wind);

  const serv = new THREE.Mesh(new THREE.BoxGeometry(3.5, 1.0, 0.05), windowMat);
  serv.position.set(0.5, 2.4, 1.6);
  g.add(serv);

  const canopy = new THREE.Mesh(
    new THREE.BoxGeometry(3.6, 0.1, 1.2),
    new THREE.MeshStandardMaterial({ color: 0xfff4d0, roughness: 0.8, flatShading: true })
  );
  canopy.position.set(0.5, 3.1, 2.3);
  canopy.rotation.x = -0.2;
  canopy.castShadow = true;
  g.add(canopy);

  for (const [wx, wz] of [[-2.5, -1.5], [-2.5, 1.5], [1.5, -1.5], [1.5, 1.5]]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.3, 14), darkMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(wx, 0.5, wz);
    g.add(w);
  }

  const sign = new THREE.Mesh(
    new THREE.BoxGeometry(4, 0.7, 0.15),
    new THREE.MeshStandardMaterial({
      color: 0xfff4d0, emissive: 0xffe066, emissiveIntensity: 0.4, roughness: 0.5,
    })
  );
  sign.position.set(0.5, 3.8, 1);
  sign.rotation.x = -0.15;
  g.add(sign);

  return g;
}

function buildEntranceArch(ctx, x, z) {
  const sideMat = new THREE.MeshStandardMaterial({ color: 0x4f8a4d, roughness: 0.9, flatShading: true });
  const left = new THREE.Mesh(new THREE.BoxGeometry(0.6, 8, 0.6), sideMat);
  left.position.set(x - 6, 4, z);
  left.castShadow = true;
  ctx.group.add(left);

  const right = left.clone();
  right.position.x = x + 6;
  ctx.group.add(right);

  // The arch: half-torus, NOT rotated, so its curve opens downward like a real arch.
  const arch = new THREE.Mesh(
    new THREE.TorusGeometry(6, 0.4, 8, 24, Math.PI),
    new THREE.MeshStandardMaterial({ color: 0xff6f9c, roughness: 0.7, flatShading: true })
  );
  arch.position.set(x, 8, z);
  arch.castShadow = true;
  ctx.group.add(arch);

  // LEAF banner — a thin double-sided plane painted with the word, hung from the arch.
  const bannerGeo = new THREE.PlaneGeometry(8, 2.2);
  const bannerMat = new THREE.MeshStandardMaterial({
    map: leafBannerTexture('#fff4d0', '#ff6f9c'),
    emissive: 0xffe066,
    emissiveMap: leafBannerTexture('#ffe066', '#000000'),
    emissiveIntensity: 0.55,
    roughness: 0.6,
    side: THREE.DoubleSide,
    transparent: false,
  });
  const banner = new THREE.Mesh(bannerGeo, bannerMat);
  banner.position.set(x, 10.5, z);
  ctx.group.add(banner);

  registry.add({
    kind: 'arch',
    position: new THREE.Vector3(x - 6, 1, z),
    footprint: 0.8,
    collider: { radius: 1.0, damage: 4 },
    chunkKey: ctx.key,
  });
  registry.add({
    kind: 'arch',
    position: new THREE.Vector3(x + 6, 1, z),
    footprint: 0.8,
    collider: { radius: 1.0, damage: 4 },
    chunkKey: ctx.key,
  });
}

// Cached canvas texture for the "LEAF" banner used on arches and stage banners.
const _leafTexCache = new Map();
function leafBannerTexture(textColor, bgColor) {
  const key = `${textColor}|${bgColor}`;
  if (_leafTexCache.has(key)) return _leafTexCache.get(key);

  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 256;
  const cx = c.getContext('2d');

  cx.fillStyle = bgColor;
  cx.fillRect(0, 0, c.width, c.height);

  // Subtle border
  cx.strokeStyle = 'rgba(0,0,0,0.18)';
  cx.lineWidth = 8;
  cx.strokeRect(8, 8, c.width - 16, c.height - 16);

  cx.fillStyle = textColor;
  cx.font = 'bold 200px "Trebuchet MS", "Helvetica Neue", Helvetica, Arial, sans-serif';
  cx.textAlign = 'center';
  cx.textBaseline = 'middle';
  cx.fillText('LEAF', c.width / 2, c.height / 2 + 8);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  _leafTexCache.set(key, tex);
  return tex;
}

function buildHammock(ctx, x, z) {
  // Two posts + a colorful sling between them
  const postMat = new THREE.MeshStandardMaterial({ color: 0x6a4a2a, roughness: 0.95, flatShading: true });
  const slingColor = [0xff6f9c, 0xffd28a, 0x6fcf6a, 0x66d9ff, 0xb285ff][Math.floor(ctx.rng() * 5)];

  const post1 = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 1.6, 8), postMat);
  post1.position.set(x - 1.6, 0.8, z);
  post1.castShadow = true;
  ctx.group.add(post1);
  const post2 = post1.clone();
  post2.position.x = x + 1.6;
  ctx.group.add(post2);

  const sling = new THREE.Mesh(
    new THREE.PlaneGeometry(3.0, 0.9, 1, 4),
    new THREE.MeshStandardMaterial({ color: slingColor, roughness: 0.95, side: THREE.DoubleSide, flatShading: true })
  );
  // Slight droop via direct vertex manipulation
  const p = sling.geometry.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x0 = p.getX(i);
    p.setZ(i, -Math.cos((x0 / 1.5) * (Math.PI / 2)) * 0.25);
  }
  sling.geometry.computeVertexNormals();
  sling.rotation.x = -Math.PI / 2;
  sling.position.set(x, 1.2, z);
  ctx.group.add(sling);

  registry.add({
    kind: 'hammock',
    position: new THREE.Vector3(x, 0, z),
    footprint: 1.6,
    attractor: { radius: 3, weight: 0.6 },
    chunkKey: ctx.key,
  });
}

function placePolePair(ctx, ax, az, bx, bz) {
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2a1f3a, roughness: 0.7, flatShading: true });
  const h = 6;
  for (const [px, pz] of [[ax, az], [bx, bz]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, h, 8), poleMat);
    pole.position.set(px, h / 2, pz);
    pole.castShadow = true;
    ctx.group.add(pole);
    registry.add({
      kind: 'lamppost',
      position: new THREE.Vector3(px, 0, pz),
      footprint: 0.5,
      collider: { radius: 0.4, damage: 2 },
      chunkKey: ctx.key,
    });
  }
  const startTop = new THREE.Vector3(ax, h - 0.1, az);
  const endTop = new THREE.Vector3(bx, h - 0.1, bz);
  const mid = startTop.clone().add(endTop).multiplyScalar(0.5);
  mid.y -= 0.6 + startTop.distanceTo(endTop) * 0.02;
  const curve = new THREE.QuadraticBezierCurve3(startTop, mid, endTop);

  const cable = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 12, 0.03, 4, false),
    new THREE.MeshStandardMaterial({ color: 0x1a1a1a })
  );
  ctx.group.add(cable);

  const bulbHues = [0xffd28a, 0xff6f9c, 0x8ecae6, 0x6fcf6a, 0xc77dff, 0xffd166];
  const bulbGeo = new THREE.SphereGeometry(0.12, 8, 6);
  const count = 6;
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count;
    const p = curve.getPoint(t);
    const hue = bulbHues[i % bulbHues.length];
    const bulb = new THREE.Mesh(
      bulbGeo,
      new THREE.MeshStandardMaterial({ color: hue, emissive: hue, emissiveIntensity: 1.2 })
    );
    bulb.position.copy(p);
    bulb.position.y -= 0.13;
    ctx.group.add(bulb);
  }
}

// ---------- Crowd spawning ----------

function spawnAmbientCrowd(ctx, count) {
  if (!ctx.crowd || count <= 0) return;

  // Collect attractors that live in this chunk so we can cluster crowds around them.
  const chunkAttractors = [];
  for (const e of registry.byChunk(ctx.key)) {
    if (e.attractor && e.attractor.weight >= 0.5) chunkAttractors.push(e);
  }

  for (let i = 0; i < count; i++) {
    let x, z;
    let tries = 0;
    do {
      // 70% chance to spawn near an attractor (if any), 30% random in chunk
      if (chunkAttractors.length > 0 && ctx.rng() < 0.7) {
        const att = chunkAttractors[Math.floor(ctx.rng() * chunkAttractors.length)];
        const a = ctx.rng() * Math.PI * 2;
        const r = Math.sqrt(ctx.rng()) * att.attractor.radius;
        x = att.position.x + Math.cos(a) * r;
        z = att.position.z + Math.sin(a) * r;
      } else {
        x = ctx.cxWorld + (ctx.rng() - 0.5) * (CHUNK_SIZE - 8);
        z = ctx.czWorld + (ctx.rng() - 0.5) * (CHUNK_SIZE - 8);
      }
      tries++;
    } while (registry.closestBuilding(new THREE.Vector3(x, 0, z), 1.5) && tries < 6);

    ctx.crowd.spawn({
      pos: new THREE.Vector3(x, 0, z),
      chunkKey: ctx.key,
      rng: ctx.rng,
    });
  }
}
