// Campsite props — small, low-poly camping gear used in two places:
//   1. Forest clearings whose interior content is 'campsite' (most forests)
//   2. Lakeside spots picked by the lake manager
//
// Each builder returns a THREE.Group anchored at (0,0,0) so the caller sets
// position + rotation. Builders take a deterministic `rng` so layouts are
// stable across chunk reloads.
//
// Animated bits (firepit flicker, tiki torch flame, tapestry sway) expose
// their state via the returned object so a central updater can advance them
// each frame. To keep this file allocation-cheap on chunk load, all
// "lookup palette" arrays and shared materials are pre-built at module load.
//
// Builders here are intentionally lower-poly than the festival's main props.
// A campsite is a vignette, not a focus — we want the player to immediately
// recognise the silhouette ("oh, a campsite") without burning draw calls.

import * as THREE from 'three';
import { PERF } from '../perf.js';

// ---------- Shared palettes ----------

const TENT_COLORS = [0x2d5a3a, 0xc24b2a, 0x2c4d75, 0xd9a834, 0x6a3b6a, 0x8a3a2a];
const CHAIR_COLORS = [0xc44a4a, 0x3b7fbe, 0x4f9c4f, 0xd4c177, 0xb86bc7, 0x444b55];
const EZUP_COLORS = [0xd86b3a, 0x3a82c0, 0x4ea15a, 0xc7385c];
const TAPESTRY_COLORS = [
  // (primary, secondary) pairs that read as "patterned fabric" even with
  // only flat shading — pick high-saturation pairs so they pop in the woods.
  [0xc23a4a, 0xf2c97a],
  [0x4a5fc7, 0xf28a3a],
  [0x6c3a8a, 0xf5e0a8],
  [0x357a3a, 0xd9a04a],
  [0xc04875, 0x3a7095],
];

// ---------- Shared materials ----------
// Materials pool by hex so building 50 tents doesn't allocate 50 materials
// for the same green. Local cache keyed on hex.
const _matCache = new Map();
function matFor(hex, opts = {}) {
  const key = `${hex.toString(16)}|${opts.emissive || 0}|${opts.roughness || 0.95}`;
  let m = _matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color: hex,
      roughness: opts.roughness ?? 0.95,
      emissive: opts.emissive || 0x000000,
      emissiveIntensity: opts.emissiveIntensity ?? 0,
      flatShading: true,
      side: opts.side ?? THREE.FrontSide,
    });
    _matCache.set(key, m);
  }
  return m;
}

const WOOD_MAT = matFor(0x6a4a2a);
const DARK_WOOD_MAT = matFor(0x4a2f1c);
const POLE_MAT = matFor(0x5a3f24);
const FABRIC_NEUTRAL_MAT = matFor(0xe6dfc8);

// ---------- Camp tent (A-frame) ----------
//
// Triangular-prism sleeping tent. Two triangles for the gable ends + two
// rectangles for the sloped sides + one floor rectangle. Total: 5 quads
// (10 triangles) plus an optional "vestibule" flap at the front.
//
// Size: 2.2m wide × 1.7m tall × 2.5m deep — fits two campers.

export function buildCampTent(rng = Math.random) {
  const group = new THREE.Group();
  const color = TENT_COLORS[Math.floor(rng() * TENT_COLORS.length)];
  const fabric = matFor(color);

  const w = 2.2, h = 1.7, d = 2.5;

  // Build geometry from explicit vertices so we get the A-frame shape exactly.
  // Local frame: x = side-to-side, y = up, z = front-to-back (door at +z).
  const verts = [];
  const indices = [];

  // 6 corner-ish points:
  // 0: ridge front, 1: ridge back
  // 2: front-left base, 3: front-right base
  // 4: back-left base,  5: back-right base
  verts.push(0,  h,  d/2);   // 0
  verts.push(0,  h, -d/2);   // 1
  verts.push(-w/2, 0,  d/2); // 2
  verts.push( w/2, 0,  d/2); // 3
  verts.push(-w/2, 0, -d/2); // 4
  verts.push( w/2, 0, -d/2); // 5

  // Sloped sides
  indices.push(0, 1, 4, 0, 4, 2);  // left slope
  indices.push(0, 3, 1, 1, 3, 5);  // right slope
  // Gable ends
  indices.push(0, 2, 3);            // front gable
  indices.push(1, 5, 4);            // back gable
  // Floor (so the dark interior doesn't show through at low angles)
  indices.push(2, 4, 3, 3, 4, 5);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const tent = new THREE.Mesh(geo, fabric);
  tent.castShadow = true;
  tent.receiveShadow = true;
  group.add(tent);

  // Optional small vestibule flap — a triangle sticking out from the front
  // gable. Picks 50% of the time per rng.
  if (rng() < 0.55) {
    const flapVerts = [
      0,  h,  d/2,
      -w/3, 0, d/2 + 0.7,
       w/3, 0, d/2 + 0.7,
    ];
    const flapGeo = new THREE.BufferGeometry();
    flapGeo.setAttribute('position', new THREE.Float32BufferAttribute(flapVerts, 3));
    flapGeo.setIndex([0, 1, 2, 0, 2, 1]); // double-sided
    flapGeo.computeVertexNormals();
    const flap = new THREE.Mesh(flapGeo, fabric);
    flap.castShadow = true;
    group.add(flap);
  }

  return { group, color, footprint: 1.8 };
}

// ---------- Camp chair (folding) ----------
//
// Stylized folding chair: 4 angled legs forming an X-frame, a seat plane,
// and a back-rest plane. ~0.55m wide, 0.85m tall.

export function buildCampChair(rng = Math.random) {
  const group = new THREE.Group();
  const color = CHAIR_COLORS[Math.floor(rng() * CHAIR_COLORS.length)];
  const fabric = matFor(color);
  const metal = matFor(0x222626, { roughness: 0.5 });

  // X-frame legs — 4 thin cylinders crossing under the seat
  const legGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.7, 6);
  for (let i = 0; i < 4; i++) {
    const leg = new THREE.Mesh(legGeo, metal);
    const sx = (i % 2 === 0) ? -1 : 1;
    const sz = (i < 2) ? -1 : 1;
    leg.position.set(sx * 0.20, 0.35, sz * 0.18);
    // Lean each leg toward the opposite top corner — X-frame effect
    leg.rotation.z = sx * 0.20;
    leg.rotation.x = sz * 0.18;
    group.add(leg);
  }

  // Seat — flat slab
  const seat = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 0.04, 0.45),
    fabric,
  );
  seat.position.set(0, 0.45, 0);
  seat.castShadow = true;
  group.add(seat);

  // Back — flat slab leaning slightly back
  const back = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 0.45, 0.04),
    fabric,
  );
  back.position.set(0, 0.7, -0.22);
  back.rotation.x = -0.12;
  back.castShadow = true;
  group.add(back);

  // Arms — two short cylinders flanking the seat
  const armGeo = new THREE.CylinderGeometry(0.022, 0.022, 0.4, 6);
  for (const sx of [-1, 1]) {
    const arm = new THREE.Mesh(armGeo, metal);
    arm.position.set(sx * 0.28, 0.55, -0.05);
    arm.rotation.x = Math.PI / 2;
    group.add(arm);
  }

  return { group, color, footprint: 0.5 };
}

// ---------- Chiminea (or ring firepit) ----------
//
// Two variants picked deterministically: a teardrop chiminea (clay bulb +
// chimney) or a low ring firepit (stones + embers). Both expose an
// `emissive` material so a central updater can pulse them with nightness.

export function buildChiminea(rng = Math.random) {
  const group = new THREE.Group();

  // Per-instance emissive material (NOT pooled — each chiminea pulses on
  // its own rng offset so they don't sync up).
  const emberMat = new THREE.MeshStandardMaterial({
    color: 0xff7733,
    emissive: 0xff5511,
    emissiveIntensity: 1.5,
    roughness: 0.7,
    flatShading: true,
  });
  const phase = rng() * Math.PI * 2;

  if (rng() < 0.5) {
    // ----- Teardrop chiminea -----
    const clay = matFor(0x6a3a26);

    // Base bulb (sphere flattened slightly)
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.38, 12, 10),
      clay,
    );
    bulb.scale.set(1, 0.85, 1);
    bulb.position.y = 0.38;
    bulb.castShadow = true;
    group.add(bulb);

    // Chimney stack — narrowing cone
    const stack = new THREE.Mesh(
      new THREE.CylinderGeometry(0.10, 0.22, 0.55, 8),
      clay,
    );
    stack.position.y = 0.85;
    stack.castShadow = true;
    group.add(stack);

    // Glowing opening — small disk facing forward
    const opening = new THREE.Mesh(
      new THREE.CircleGeometry(0.13, 12),
      emberMat,
    );
    opening.position.set(0, 0.36, 0.36);
    group.add(opening);
    // Tiny stand legs (3 short feet)
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const foot = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.04, 0.15, 6),
        DARK_WOOD_MAT,
      );
      foot.position.set(Math.cos(a) * 0.18, 0.075, Math.sin(a) * 0.18);
      group.add(foot);
    }

    return { group, kind: 'chiminea', emberMat, phase, footprint: 0.7 };
  }

  // ----- Ring firepit -----
  const stoneMat = matFor(0x7a7785, { roughness: 1.0 });
  const ringR = 0.55;
  const stoneCount = 8;
  for (let i = 0; i < stoneCount; i++) {
    const a = (i / stoneCount) * Math.PI * 2;
    const stone = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.18 + rng() * 0.08, 0),
      stoneMat,
    );
    stone.position.set(Math.cos(a) * ringR, 0.13, Math.sin(a) * ringR);
    stone.rotation.y = rng() * Math.PI * 2;
    stone.castShadow = true;
    group.add(stone);
  }

  // Inner ember cluster — a few flat-shaded log nubs glowing
  const logMat = matFor(0x2a1a10, { roughness: 1 });
  for (let i = 0; i < 3; i++) {
    const a = i * 2.1 + 0.3;
    const log = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 0.45, 6),
      logMat,
    );
    log.position.set(Math.cos(a) * 0.15, 0.07, Math.sin(a) * 0.15);
    log.rotation.z = Math.PI / 2;
    log.rotation.y = a;
    group.add(log);
  }

  const embers = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.20, 1),
    emberMat,
  );
  embers.position.y = 0.10;
  group.add(embers);

  return { group, kind: 'firepit', emberMat, phase, footprint: 0.7 };
}

// ---------- Tiki torch ----------
//
// Bamboo pole + flame tuft. Flame is emissive and animated separately
// (caller bobs the scale or material on a timer).

export function buildTikiTorch(rng = Math.random) {
  const group = new THREE.Group();

  const bamboo = matFor(0xa37a3a);
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.04, 1.7, 6),
    bamboo,
  );
  pole.position.y = 0.85;
  pole.castShadow = true;
  group.add(pole);

  // Two thin "joint" rings on the bamboo for visual interest
  for (const y of [0.50, 1.10]) {
    const joint = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.055, 0.04, 6),
      matFor(0x6a4a1a),
    );
    joint.position.y = y;
    group.add(joint);
  }

  // Reservoir cup at the top
  const cup = new THREE.Mesh(
    new THREE.CylinderGeometry(0.10, 0.08, 0.12, 8),
    matFor(0x4a3018),
  );
  cup.position.y = 1.78;
  group.add(cup);

  // Flame — emissive teardrop. Phase used by central updater to bob/flicker
  // independently per torch.
  const flameMat = new THREE.MeshStandardMaterial({
    color: 0xffb04a,
    emissive: 0xff5a1a,
    emissiveIntensity: 2.0,
    roughness: 0.4,
    transparent: true,
    opacity: 0.95,
  });
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.10, 0.32, 8),
    flameMat,
  );
  flame.position.y = 2.0;
  group.add(flame);
  const phase = rng() * Math.PI * 2;

  // Fancy-lights opt-in: real PointLight at the flame. Stays off if the
  // user hasn't opted in via the backtick menu. Animatable so the
  // central updater can dim it during the day.
  let flameLight = null;
  if (PERF.fancyLights) {
    flameLight = new THREE.PointLight(0xff8830, 0, 3.5, 1.5);
    flameLight.position.y = 2.0;
    flameLight.castShadow = false;
    group.add(flameLight);
  }

  return { group, flame, flameMat, flameLight, phase, footprint: 0.25 };
}

// ---------- EZ-up canopy ----------
//
// Square fabric roof on 4 corner poles, slight peak in the middle. 3m × 3m
// × 2.4m tall.

export function buildEzUp(rng = Math.random) {
  const group = new THREE.Group();
  const color = EZUP_COLORS[Math.floor(rng() * EZUP_COLORS.length)];
  const fabric = matFor(color);
  const post = matFor(0x222626, { roughness: 0.4 });

  const size = 3.0;
  const height = 2.4;
  const half = size / 2;

  // 4 corner posts
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const p = new THREE.Mesh(
        new THREE.CylinderGeometry(0.035, 0.035, height, 6),
        post,
      );
      p.position.set(sx * half, height / 2, sz * half);
      group.add(p);
    }
  }

  // Roof — a square pyramid: 4 triangles meeting at a center apex
  const apexY = height + 0.35;
  const verts = [
    // 4 corners at the post tops
    -half, height, -half,   // 0  NW
     half, height, -half,   // 1  NE
     half, height,  half,   // 2  SE
    -half, height,  half,   // 3  SW
     0,    apexY,   0,      // 4  apex
  ];
  const indices = [
    0, 4, 1,   // back
    1, 4, 2,   // right
    2, 4, 3,   // front
    3, 4, 0,   // left
  ];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const roof = new THREE.Mesh(geo, fabric);
  roof.castShadow = true;
  group.add(roof);

  // Add a small fabric skirt drop along one edge for character — picks 60% of the time
  if (rng() < 0.6) {
    const skirt = new THREE.Mesh(
      new THREE.PlaneGeometry(size * 0.95, 0.3),
      fabric,
    );
    skirt.material = new THREE.MeshStandardMaterial({
      color, roughness: 0.95, flatShading: true, side: THREE.DoubleSide,
    });
    skirt.position.set(0, height - 0.15, -half);
    group.add(skirt);
  }

  return { group, color, footprint: 2.0 };
}

// ---------- Tapestry ----------
//
// A square of patterned fabric strung between two short posts. Uses a
// canvas-baked texture so the pattern reads even at low light.

export function buildTapestry(rng = Math.random) {
  const group = new THREE.Group();

  const w = 1.8 + rng() * 0.8;       // 1.8-2.6m wide
  const h = 1.3 + rng() * 0.3;       // 1.3-1.6m tall
  const postH = h + 0.4;

  // Two posts on either side
  const postGeo = new THREE.CylinderGeometry(0.06, 0.06, postH, 6);
  for (const sx of [-1, 1]) {
    const p = new THREE.Mesh(postGeo, POLE_MAT);
    p.position.set(sx * w / 2, postH / 2, 0);
    p.castShadow = true;
    group.add(p);
  }

  // Fabric — slight droop along the top edge (cosine curve)
  const [c1Hex, c2Hex] = TAPESTRY_COLORS[Math.floor(rng() * TAPESTRY_COLORS.length)];
  const tex = tapestryTexture(c1Hex, c2Hex, rng);
  const fabric = new THREE.MeshStandardMaterial({
    map: tex,
    roughness: 0.95,
    flatShading: true,
    side: THREE.DoubleSide,
  });

  const segs = 8;
  const verts = [];
  const uvs = [];
  const idx = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const x = (t - 0.5) * w;
    // Cosine droop — middle hangs 12cm below the post tops
    const sag = -Math.cos((t - 0.5) * Math.PI) * 0.12;
    verts.push(x, postH * 0.9 + sag, 0);
    verts.push(x, postH * 0.9 + sag - h, 0);
    uvs.push(t, 0);
    uvs.push(t, 1);
  }
  for (let i = 0; i < segs; i++) {
    const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
    idx.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();

  const cloth = new THREE.Mesh(geo, fabric);
  cloth.castShadow = true;
  cloth.receiveShadow = true;
  group.add(cloth);

  return { group, footprint: 0.6 };
}

// Tiny procedural tapestry pattern: stripes / bands / diamonds. Drawn to a
// 64x64 canvas — cheap, doesn't depend on external assets, and gives enough
// detail that "tapestry" reads clearly at any zoom level.
const _tapestryCanvas = document.createElement('canvas');
_tapestryCanvas.width = 64;
_tapestryCanvas.height = 64;
function tapestryTexture(c1, c2, rng) {
  const ctx = _tapestryCanvas.getContext('2d');
  const c1Str = '#' + c1.toString(16).padStart(6, '0');
  const c2Str = '#' + c2.toString(16).padStart(6, '0');
  ctx.fillStyle = c1Str;
  ctx.fillRect(0, 0, 64, 64);

  const pattern = Math.floor(rng() * 3);
  ctx.fillStyle = c2Str;
  if (pattern === 0) {
    // Horizontal bands
    for (let y = 4; y < 64; y += 12) ctx.fillRect(0, y, 64, 4);
  } else if (pattern === 1) {
    // Diamond grid
    for (let y = 0; y < 64; y += 16) {
      for (let x = 0; x < 64; x += 16) {
        ctx.beginPath();
        ctx.moveTo(x + 8, y);
        ctx.lineTo(x + 16, y + 8);
        ctx.lineTo(x + 8, y + 16);
        ctx.lineTo(x, y + 8);
        ctx.closePath();
        ctx.fill();
      }
    }
  } else {
    // Vertical stripes
    for (let x = 4; x < 64; x += 10) ctx.fillRect(x, 0, 3, 64);
  }
  const tex = new THREE.CanvasTexture(_tapestryCanvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  // We use a NEW canvas per call — but CanvasTexture clones the source pixels
  // on first upload, so reusing a singleton canvas is safe. The image data is
  // re-drawn before each new texture is created.
  return tex;
}

// ---------- Campsite assembler ----------
//
// Lays out a coherent campsite scene anchored at the origin: a central
// firepit, 2-3 tents in a loose arc, 1-2 EZ-ups with chairs underneath,
// 2-4 tiki torches at the perimeter, 1-2 tapestries hung between posts.
// Caller positions/rotates the returned group.
//
// `size` controls the radius and prop count:
//   'small'  → 4m radius, 1 tent, 0-1 EZ-up, 2 torches, 1 tapestry, 1-2 chairs
//   'medium' → 6m radius, 2 tents, 1 EZ-up, 3 torches, 1-2 tapestries, 2-3 chairs
//   'large'  → 8m radius, 3 tents, 1-2 EZ-ups, 4 torches, 2 tapestries, 3-4 chairs
//
// Returns { group, animatables, footprint } — animatables array goes into
// the world's per-frame updater list so flames flicker / embers pulse.

const SIZE_CONFIG = {
  small:  { radius: 4, tents: 1, ezUps: [0, 1], torches: 2, tapestries: 1, chairs: [1, 2] },
  medium: { radius: 6, tents: 2, ezUps: [1, 1], torches: 3, tapestries: [1, 2], chairs: [2, 3] },
  large:  { radius: 8, tents: 3, ezUps: [1, 2], torches: 4, tapestries: 2, chairs: [3, 4] },
};

function pickCount(spec, rng) {
  if (typeof spec === 'number') return spec;
  // [min, max] inclusive
  const [a, b] = spec;
  return a + Math.floor(rng() * (b - a + 1));
}

export function buildCampsite(rng = Math.random, size = 'medium') {
  const cfg = SIZE_CONFIG[size] || SIZE_CONFIG.medium;
  const root = new THREE.Group();
  const animatables = [];

  // Firepit in the dead centre — always the visual anchor
  const fire = buildChiminea(rng);
  root.add(fire.group);
  animatables.push(fire);

  // Proxy PointLight — one per campsite, sitting at the firepit. Stands in
  // for the cumulative glow of the firepit + every tiki torch on the
  // perimeter. Intensity ramps with nightness (handled in
  // updateCampsiteProps) so the light is dim at noon and roaring at
  // midnight. PERF-gated so low-tier devices skip it and lean on emissive
  // + bloom to carry the visual.
  if (PERF.contextLights) {
    const proxy = new THREE.PointLight(0xffb060, 0, 14, 1.2);
    proxy.position.set(0, 1.2, 0);                  // just above the firepit
    proxy.castShadow = false;                       // shadow-casting is too expensive at scale
    root.add(proxy);
    // Tag this animatable so updateCampsiteProps knows to modulate the
    // intensity by nightness.
    animatables.push({ kind: 'contextLight', light: proxy, base: 1.6 });
  }

  // Helper: place a prop at polar (r, theta) and face it toward the centre.
  function placeAt(propGroup, r, theta, faceCenter = true) {
    propGroup.position.set(Math.cos(theta) * r, 0, Math.sin(theta) * r);
    if (faceCenter) {
      propGroup.rotation.y = -theta + Math.PI / 2 + Math.PI;
    }
    root.add(propGroup);
  }

  // Tents — arranged in an arc on one side of the firepit
  const tentCount = pickCount(cfg.tents, rng);
  const tentArcStart = rng() * Math.PI * 2;
  const tentArcSpread = Math.PI * 0.6;
  for (let i = 0; i < tentCount; i++) {
    const tent = buildCampTent(rng);
    const t = tentCount === 1 ? 0.5 : i / (tentCount - 1);
    const theta = tentArcStart + (t - 0.5) * tentArcSpread;
    placeAt(tent.group, cfg.radius * 0.75, theta);
  }

  // EZ-ups — usually opposite the tents
  const ezCount = pickCount(cfg.ezUps, rng);
  const ezArcStart = tentArcStart + Math.PI + (rng() - 0.5) * 0.5;
  for (let i = 0; i < ezCount; i++) {
    const ez = buildEzUp(rng);
    const theta = ezArcStart + (i - (ezCount - 1) / 2) * 0.55;
    placeAt(ez.group, cfg.radius * 0.7, theta, false);
    // Plant a few chairs under each EZ-up
    const chairsHere = 2 + Math.floor(rng() * 2);
    for (let j = 0; j < chairsHere; j++) {
      const chair = buildCampChair(rng);
      const localR = 0.8 + rng() * 0.4;
      const localA = rng() * Math.PI * 2;
      chair.group.position.set(
        Math.cos(theta) * cfg.radius * 0.7 + Math.cos(localA) * localR,
        0,
        Math.sin(theta) * cfg.radius * 0.7 + Math.sin(localA) * localR,
      );
      chair.group.rotation.y = rng() * Math.PI * 2;
      root.add(chair.group);
    }
  }

  // Standalone chairs around the firepit
  const standaloneChairs = pickCount(cfg.chairs, rng);
  for (let i = 0; i < standaloneChairs; i++) {
    const chair = buildCampChair(rng);
    // Place on a ring just outside the firepit (~1.8m)
    const theta = rng() * Math.PI * 2;
    const r = 1.6 + rng() * 0.6;
    chair.group.position.set(Math.cos(theta) * r, 0, Math.sin(theta) * r);
    // Face the fire
    chair.group.rotation.y = -theta + Math.PI / 2 + Math.PI;
    root.add(chair.group);
  }

  // Tiki torches — scattered at the perimeter, evenly spaced
  const torchCount = pickCount(cfg.torches, rng);
  const torchOffset = rng() * Math.PI * 2;
  for (let i = 0; i < torchCount; i++) {
    const torch = buildTikiTorch(rng);
    const theta = torchOffset + (i / torchCount) * Math.PI * 2;
    placeAt(torch.group, cfg.radius * 1.05, theta, false);
    animatables.push(torch);
  }

  // Tapestries — between the torches, picked spots
  const tapCount = pickCount(cfg.tapestries, rng);
  for (let i = 0; i < tapCount; i++) {
    const tap = buildTapestry(rng);
    const theta = rng() * Math.PI * 2;
    placeAt(tap.group, cfg.radius * 0.95, theta, false);
  }

  return {
    group: root,
    animatables,
    footprint: cfg.radius + 2,
  };
}

// ---------- Central animator ----------
//
// Each campsite returns its prop objects, and the campsite assembler keeps
// a list of "animatable" props (chimineas, torches). One global updater walks
// the list each frame and pulses the emissives / bobs the flames.

export function updateCampsiteProps(t, nightness, props) {
  // nightness 0..1: by day chimineas/torches are dim, by night they roar.
  const baseIntensity = 0.4 + 4.0 * nightness;
  for (let i = 0; i < props.length; i++) {
    const p = props[i];
    if (p.emberMat) {
      // Chiminea / firepit — gentle flicker
      const flick = 0.85 + 0.15 * Math.sin(t * 6 + p.phase);
      p.emberMat.emissiveIntensity = baseIntensity * flick;
    }
    if (p.flameMat) {
      // Tiki torch flame — sharper, faster flicker, plus a small scale bob
      const flick = 0.7 + 0.3 * Math.sin(t * 9 + p.phase);
      p.flameMat.emissiveIntensity = baseIntensity * 1.5 * flick;
      // Tiki flame goes invisible during full day so it doesn't read as
      // "always lit." Fade in over the dusk band.
      p.flameMat.opacity = THREE.MathUtils.clamp(0.2 + nightness * 1.2, 0, 0.95);
      // Mild vertical wobble on the flame mesh itself
      if (p.flame) {
        p.flame.scale.y = 1 + 0.15 * Math.sin(t * 12 + p.phase);
      }
      // Fancy-lights opt-in: dim the per-torch PointLight by nightness² so
      // it's invisible at noon and flickers warmly at midnight.
      if (p.flameLight) {
        p.flameLight.intensity = 0.7 * (nightness * nightness) * flick;
      }
    }
    if (p.kind === 'contextLight' && p.light) {
      // Proxy campsite light: dark by day, warm by night, with a slow
      // breathing flicker so it doesn't feel mathematically static. The
      // ^2 on nightness keeps the light off until dusk really sets in.
      const flick = 0.85 + 0.15 * Math.sin(t * 4 + (p.phase || 0));
      p.light.intensity = (p.base || 1.6) * (nightness * nightness) * flick;
    }
  }
}
