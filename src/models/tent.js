// Vendor / craft tent — 4 legs, white pyramid roof, and an interior arranged
// into one or more table "slots" (each filled with a product spread) plus a
// shopkeeper standing the booth. Roof is always white per the festival
// aesthetic; trim band + cloth color + slot arrangement + per-table product
// spread + shopkeeper outfit all vary per-tent so a row of tents reads as a
// real market lineup instead of clones.
//
// Returns a THREE.Group anchored at (0,0,0), opening facing +Z.

import * as THREE from 'three';
import { buildSimpleNPC } from './puppet.js';

const CLOTH_COLORS = [0xfff4d0, 0xe7c995, 0xfddfa5, 0xd0c2a8, 0xf4d6c4];
const TRIM_COLORS  = [0xff6f9c, 0x6fcf6a, 0xffd28a, 0xb285ff, 0x66d9ff, 0xff8a5b];

// ----- Shared resources --------------------------------------------------
// Each vendor row chunk spawns 10–14 tents; before pooling, every tent
// re-allocated identical leg / roof / trim / table geometry and a fresh
// material. Pool by topology + color-key per .claude/rules/perf-pooling.md
// so a row of tents shares draw-batchable resources. All entries are tagged
// userData.shared = true so chunk-unload disposal walks skip them.
const _LEG_GEO  = new THREE.BoxGeometry(0.15, 2.5, 0.15);   _LEG_GEO.userData.shared = true;
const _ROOF_GEO = new THREE.ConeGeometry(3.2, 1.8, 4);      _ROOF_GEO.userData.shared = true;
const _TRIM_GEO = new THREE.BoxGeometry(4.5, 0.18, 4.5);    _TRIM_GEO.userData.shared = true;

const _LEG_MAT = new THREE.MeshStandardMaterial({
  color: 0x3a2e22, roughness: 0.8, flatShading: true,
});
_LEG_MAT.userData.shared = true;
const _ROOF_MAT = new THREE.MeshStandardMaterial({
  color: 0xfff8eb, roughness: 0.85, flatShading: true,
});
_ROOF_MAT.userData.shared = true;

// Table geometry + cloth/trim material pools — keyed for reuse.
const _TABLE_GEOS = new Map(); // 'lengthxdepth' → BoxGeometry
function _tableGeo(length, depth) {
  const k = `${length}x${depth}`;
  let g = _TABLE_GEOS.get(k);
  if (!g) {
    g = new THREE.BoxGeometry(length, 0.1, depth);
    g.userData.shared = true;
    _TABLE_GEOS.set(k, g);
  }
  return g;
}
const _CLOTH_MATS = new Map(); // colorHex → material
function _clothMat(hex) {
  let m = _CLOTH_MATS.get(hex);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color: hex, roughness: 0.9, flatShading: true,
    });
    m.userData.shared = true;
    _CLOTH_MATS.set(hex, m);
  }
  return m;
}
const _TRIM_MATS = new Map();
function _trimMat(hex) {
  let m = _TRIM_MATS.get(hex);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color: hex, roughness: 0.85, flatShading: true,
    });
    m.userData.shared = true;
    _TRIM_MATS.set(hex, m);
  }
  return m;
}

// Shopkeeper palette — earthy/warm, vendor-coded (think apron-cooks +
// crafter types). Skin tones from the same set used by the sugar shack
// cook so the festival reads as one population.
const SHOPKEEPER_SHIRTS = [
  0xc63a2a, 0x3a72c2, 0xe09818, 0x6b513a,
  0x5a7e3a, 0x2a4b6e, 0xa53a7a, 0x3a8b73,
];
const SHOPKEEPER_SKINS  = [0xe6c098, 0xc09478, 0x8b6f50, 0xf2d4b2];

const PRODUCT_LAYOUTS = ['pottery', 'hats', 'jars', 'paintings', 'boxes', 'plants'];

// Table slots, local to the tent canopy. Tent footprint is 4.5x4.5 with
// legs at corners (±2, ±2); the opening faces +Z, the back wall is -Z.
// Side slots are slightly shorter than the back to leave room for the
// front opening.
const SLOT_BACK   = { length: 3.0, depth: 0.8, x: 0,    z: -1.4, yaw: 0 };
const SLOT_LEFT   = { length: 2.6, depth: 0.8, x: -1.4, z: 0,    yaw: -Math.PI / 2 };
const SLOT_RIGHT  = { length: 2.6, depth: 0.8, x: 1.4,  z: 0,    yaw:  Math.PI / 2 };
const SLOT_CENTER = { length: 3.0, depth: 1.2, x: 0,    z: 0,    yaw: 0 };

// Booth arrangements, weighted random. The U-shape (back + both sides) is
// the most common per Gary's note — it's the "lived-in market stall" shape.
// L-shapes are the next most common; single-back and single-center keep the
// original variety so a row of tents still feels mixed.
const BOOTH_LAYOUTS = [
  { name: 'u',       weight: 5, slots: [SLOT_BACK, SLOT_LEFT, SLOT_RIGHT] },
  { name: 'l_left',  weight: 2, slots: [SLOT_BACK, SLOT_LEFT] },
  { name: 'l_right', weight: 2, slots: [SLOT_BACK, SLOT_RIGHT] },
  { name: 'back',    weight: 2, slots: [SLOT_BACK] },
  { name: 'center',  weight: 2, slots: [SLOT_CENTER] },
];
const _BOOTH_TOTAL = BOOTH_LAYOUTS.reduce((s, b) => s + b.weight, 0);

function pickBooth(rng) {
  let r = rng() * _BOOTH_TOTAL;
  for (const b of BOOTH_LAYOUTS) {
    if (r < b.weight) return b;
    r -= b.weight;
  }
  return BOOTH_LAYOUTS[0];
}

export function buildTent(rng = Math.random) {
  const g = new THREE.Group();

  // One cloth color per tent — every table in this booth shares it so the
  // booth reads as a single vendor's space rather than an improvised pile.
  const baseColor = CLOTH_COLORS[Math.floor(rng() * CLOTH_COLORS.length)];

  // ----- Legs -----
  for (const [lx, lz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) {
    const leg = new THREE.Mesh(_LEG_GEO, _LEG_MAT);
    leg.position.set(lx, 1.25, lz);
    g.add(leg);
  }

  // ----- Roof — always white festival canvas; angle jitter avoids clones.
  const roof = new THREE.Mesh(_ROOF_GEO, _ROOF_MAT);
  roof.position.y = 3.4;
  roof.rotation.y = Math.PI / 4 + (rng() - 0.5) * 0.06;
  roof.castShadow = true;
  g.add(roof);

  // ----- Trim band — saturated festival color, vendor-personality cue.
  const trimColor = TRIM_COLORS[Math.floor(rng() * TRIM_COLORS.length)];
  const trim = new THREE.Mesh(_TRIM_GEO, _trimMat(trimColor));
  trim.position.y = 2.55;
  g.add(trim);

  // ----- Booth interior — pick a slot arrangement, then fill each table
  // with an independently-rolled product layout. A U-shape booth might have
  // pottery on the back, hats on the left, jars on the right — that's the
  // variety Gary asked for.
  const booth = pickBooth(rng);
  for (const slot of booth.slots) {
    g.add(buildTableSlot(rng, slot, baseColor));
  }

  // ----- Shopkeeper — minds the booth. 70% inside (behind tables, facing
  // out the tent opening), 30% out front (loitering, facing back in).
  const shopkeeper = buildShopkeeper(rng);
  placeShopkeeper(shopkeeper, booth.name, rng);
  g.add(shopkeeper);

  return g;
}

// ----- Slot + layout helpers --------------------------------------------

// Build a tablecloth-covered table at a given slot, with a product spread
// rolled from PRODUCT_LAYOUTS. Returns a group rooted at the tent's origin
// (the group itself is positioned/rotated to land in the slot).
function buildTableSlot(rng, slot, baseColor) {
  const group = new THREE.Group();
  group.position.set(slot.x, 0, slot.z);
  group.rotation.y = slot.yaw;

  const table = new THREE.Mesh(_tableGeo(slot.length, slot.depth), _clothMat(baseColor));
  table.position.set(0, 1.0, 0);
  table.castShadow = true;
  table.receiveShadow = true;
  group.add(table);

  const layoutKey = PRODUCT_LAYOUTS[Math.floor(rng() * PRODUCT_LAYOUTS.length)];
  fillProducts(layoutKey, group, rng, slot.length, slot.depth);
  return group;
}

function fillProducts(key, g, rng, length, depth) {
  switch (key) {
    case 'pottery':   layoutPottery(g, rng, length, depth); break;
    case 'hats':      layoutHats(g, rng, length, depth); break;
    case 'jars':      layoutJars(g, rng, length, depth); break;
    case 'paintings': layoutPaintings(g, rng, length, depth); break;
    case 'boxes':     layoutBoxes(g, rng, length, depth); break;
    case 'plants':    layoutPlantStand(g, rng, length, depth); break;
  }
}

function hslMat(rng, sat = 0.7, light = 0.55) {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color().setHSL(rng(), sat, light),
    roughness: 0.7, flatShading: true,
  });
}

// Each layout fills a table of `length` along local X, `depth` along local
// Z, with products above the table top (y >= 1.05). z-jitter scales with
// depth so the narrow side tables don't overshoot their cloth.

function layoutPottery(g, rng, length, depth) {
  const count = 4 + Math.floor(rng() * 3);
  const xa = -length / 2 + 0.25;
  const xb =  length / 2 - 0.25;
  const xs = spread(count, xa, xb);
  const zJit = depth * 0.20;
  for (let i = 0; i < count; i++) {
    const tall = rng() < 0.6;
    const r = 0.16 + rng() * 0.10;
    const h = tall ? (0.55 + rng() * 0.35) : (0.30 + rng() * 0.15);
    const pot = new THREE.Mesh(
      new THREE.CylinderGeometry(r * 0.85, r, h, 12),
      hslMat(rng, 0.4, 0.5),
    );
    pot.position.set(xs[i], 1.05 + h / 2, (rng() - 0.5) * zJit);
    g.add(pot);
  }
}

function layoutHats(g, rng, length, depth) {
  const count = 5 + Math.floor(rng() * 3);
  const xa = -length / 2 + 0.25;
  const xb =  length / 2 - 0.25;
  const xs = spread(count, xa, xb);
  const zJit = depth * 0.15;
  for (let i = 0; i < count; i++) {
    const stack = rng() < 0.4 ? 2 + Math.floor(rng() * 2) : 1;
    for (let s = 0; s < stack; s++) {
      const brim = new THREE.Mesh(
        new THREE.CylinderGeometry(0.22, 0.22, 0.04, 14),
        hslMat(rng, 0.5, 0.55),
      );
      brim.position.set(xs[i], 1.06 + s * 0.10, (rng() - 0.5) * zJit);
      g.add(brim);
      const crown = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.12, 0.12, 12),
        brim.material,
      );
      crown.position.copy(brim.position);
      crown.position.y += 0.07;
      g.add(crown);
    }
  }
}

function layoutJars(g, rng, length, depth) {
  const count = 7 + Math.floor(rng() * 4);
  const xa = -length / 2 + 0.20;
  const xb =  length / 2 - 0.20;
  const xs = spread(count, xa, xb);
  const zRow = depth * 0.18;
  for (let i = 0; i < count; i++) {
    const jar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.10, 0.10, 0.30, 10),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(rng(), 0.55, 0.45),
        roughness: 0.3, metalness: 0.2,
        transparent: true, opacity: 0.85,
      }),
    );
    const z = (i % 2 === 0 ? -zRow : zRow) + (rng() - 0.5) * 0.06;
    jar.position.set(xs[i], 1.20, z);
    g.add(jar);
    const lid = new THREE.Mesh(
      new THREE.CylinderGeometry(0.105, 0.105, 0.04, 10),
      new THREE.MeshStandardMaterial({
        color: 0xcfcfcf, roughness: 0.4, metalness: 0.6,
      }),
    );
    lid.position.copy(jar.position);
    lid.position.y += 0.17;
    g.add(lid);
  }
}

function layoutPaintings(g, rng, length, depth) {
  const count = 3 + Math.floor(rng() * 2);
  const xa = -length / 2 + 0.3;
  const xb =  length / 2 - 0.3;
  const xs = spread(count, xa, xb);
  const backZ = -depth / 2 + 0.15;   // hugging the back edge of the table
  for (let i = 0; i < count; i++) {
    const w = 0.55 + rng() * 0.25;
    const h = 0.5 + rng() * 0.35;
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, 0.04),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(rng(), 0.6, 0.45),
        roughness: 0.7, flatShading: true,
      }),
    );
    frame.position.set(xs[i], 1.05 + h / 2, backZ);
    frame.rotation.x = -0.18;
    g.add(frame);
    const art = new THREE.Mesh(
      new THREE.BoxGeometry(w * 0.82, h * 0.82, 0.01),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(rng(), 0.7, 0.6),
        emissive: new THREE.Color().setHSL(rng(), 0.5, 0.4),
        emissiveIntensity: 0.25,
      }),
    );
    art.position.copy(frame.position);
    art.position.z += 0.025;
    art.rotation.x = frame.rotation.x;
    g.add(art);
  }
}

function layoutBoxes(g, rng, length, depth) {
  const count = 5 + Math.floor(rng() * 4);
  const xa = -length / 2 + 0.25;
  const xb =  length / 2 - 0.25;
  const xs = spread(count, xa, xb);
  const zJit = depth * 0.22;
  for (let i = 0; i < count; i++) {
    const stacked = rng() < 0.35;
    for (let s = 0; s < (stacked ? 2 : 1); s++) {
      const bw = 0.22 + rng() * 0.22;
      const bh = 0.18 + rng() * 0.20;
      const bd = 0.22 + rng() * 0.18;
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(bw, bh, bd),
        new THREE.MeshStandardMaterial({
          color: new THREE.Color().setHSL(rng(), 0.7, 0.55),
          roughness: 0.7, flatShading: true,
        }),
      );
      box.position.set(
        xs[i] + (rng() - 0.5) * 0.08,
        1.05 + bh / 2 + s * (bh + 0.04),
        (rng() - 0.5) * zJit,
      );
      box.rotation.y = (rng() - 0.5) * 0.5;
      g.add(box);
    }
  }
}

function layoutPlantStand(g, rng, length, depth) {
  const tiers = 2 + Math.floor(rng() * 2);
  const xa = -length / 2 + 0.3;
  const xb =  length / 2 - 0.3;
  const zRow = depth * 0.18;
  for (let t = 0; t < tiers; t++) {
    const shelfY = 1.05 + t * 0.30;
    const count = 3 + Math.floor(rng() * 2);
    const xs = spread(count, xa, xb);
    for (let i = 0; i < count; i++) {
      const pot = new THREE.Mesh(
        new THREE.CylinderGeometry(0.13, 0.10, 0.16, 10),
        new THREE.MeshStandardMaterial({
          color: 0x8b5a2b, roughness: 0.85, flatShading: true,
        }),
      );
      pot.position.set(xs[i], shelfY + 0.08, t === 0 ? -zRow : zRow);
      g.add(pot);
      const leaves = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.16 + rng() * 0.05, 0),
        new THREE.MeshStandardMaterial({
          color: new THREE.Color().setHSL(0.28 + (rng() - 0.5) * 0.06, 0.55, 0.45),
          roughness: 0.85, flatShading: true,
        }),
      );
      leaves.position.copy(pot.position);
      leaves.position.y += 0.22;
      g.add(leaves);
    }
  }
}

function spread(count, a, b) {
  if (count === 1) return [(a + b) * 0.5];
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push(a + (b - a) * (i / (count - 1)));
  }
  return out;
}

// ----- Shopkeeper -------------------------------------------------------

function buildShopkeeper(rng) {
  const shirt = SHOPKEEPER_SHIRTS[Math.floor(rng() * SHOPKEEPER_SHIRTS.length)];
  const skin  = SHOPKEEPER_SKINS[Math.floor(rng() * SHOPKEEPER_SKINS.length)];
  return buildSimpleNPC(shirt, skin);
}

// 70% inside the booth (behind tables, facing the customer at +Z), 30% out
// front (loitering on the customer side, facing back into the booth).
// Interior spot depends on the booth layout — the shopkeeper has to fit
// between whichever tables are there.
function placeShopkeeper(npc, layoutName, rng) {
  if (rng() < 0.30) {
    npc.position.set((rng() - 0.5) * 2.2, 0, 2.3 + rng() * 0.4);
    npc.rotation.y = 0;                // NPC default eyes face -Z (into booth)
    return;
  }
  let x = 0, z = -0.5;
  if (layoutName === 'u') {
    x = (rng() - 0.5) * 0.8;
    z = -0.4;
  } else if (layoutName === 'l_left') {
    x = 0.4 + (rng() - 0.5) * 0.4;     // open side is the right; shopkeeper sits center-right
    z = -0.5;
  } else if (layoutName === 'l_right') {
    x = -0.4 + (rng() - 0.5) * 0.4;
    z = -0.5;
  } else if (layoutName === 'back') {
    x = (rng() - 0.5) * 1.2;
    z = -0.7;
  } else {                              // 'center' — table fills the middle
    x = (rng() < 0.5 ? -1.2 : 1.2) + (rng() - 0.5) * 0.3;
    z = -1.0;
  }
  npc.position.set(x, 0, z);
  npc.rotation.y = Math.PI;             // face +Z (out the tent opening)
}
