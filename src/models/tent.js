// Vendor / craft tent — 4 legs, white pyramid roof, table with a varied
// spread of products. Roof is always white per the festival aesthetic; the
// table cloth + product layout vary per-tent so a row of tents reads as a
// real market instead of clones.
//
// Returns a THREE.Group anchored at (0,0,0).

import * as THREE from 'three';

const CLOTH_COLORS = [0xfff4d0, 0xe7c995, 0xfddfa5, 0xd0c2a8, 0xf4d6c4];

export function buildTent(rng = Math.random) {
  const g = new THREE.Group();

  const baseColor = CLOTH_COLORS[Math.floor(rng() * CLOTH_COLORS.length)];

  const legMat = new THREE.MeshStandardMaterial({
    color: 0x3a2e22, roughness: 0.8, flatShading: true,
  });
  for (const [lx, lz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.15, 2.5, 0.15), legMat);
    leg.position.set(lx, 1.25, lz);
    // Tent leg — 15cm slim, skip shadow casting (roof + table cast).
    g.add(leg);
  }

  // Roof — always white festival canvas, per Gary's note. Per-tent angle
  // jitter so a row of identical tents doesn't read as clones.
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(3.2, 1.8, 4),
    new THREE.MeshStandardMaterial({
      color: 0xfff8eb, roughness: 0.85, flatShading: true,
    }),
  );
  roof.position.y = 3.4;
  roof.rotation.y = Math.PI / 4 + (rng() - 0.5) * 0.06;
  roof.castShadow = true;
  g.add(roof);

  // Per-tent colored "valance" — a narrow trim band that hangs from the
  // roof edge in a saturated festival color. Sells the vendor-personality.
  const trimColors = [0xff6f9c, 0x6fcf6a, 0xffd28a, 0xb285ff, 0x66d9ff, 0xff8a5b];
  const trimColor = trimColors[Math.floor(rng() * trimColors.length)];
  const trim = new THREE.Mesh(
    new THREE.BoxGeometry(4.5, 0.18, 4.5),
    new THREE.MeshStandardMaterial({
      color: trimColor, roughness: 0.85, flatShading: true,
    }),
  );
  trim.position.y = 2.55;
  g.add(trim);

  const table = new THREE.Mesh(
    new THREE.BoxGeometry(3.0, 0.1, 1.2),
    new THREE.MeshStandardMaterial({
      color: baseColor, roughness: 0.9, flatShading: true,
    }),
  );
  table.position.set(0, 1.0, 0);
  table.castShadow = true;
  table.receiveShadow = true;
  g.add(table);

  // ---- Product spread — one of several layouts, picked by rng ----
  // The layout grammar gives each tent a real visual personality (pottery,
  // hats, jewelry, food jars, paintings, etc.) without a bespoke model per
  // vendor type.
  const layoutPicker = rng();
  if (layoutPicker < 0.20) {
    layoutPottery(g, rng);
  } else if (layoutPicker < 0.40) {
    layoutHats(g, rng);
  } else if (layoutPicker < 0.55) {
    layoutJars(g, rng);
  } else if (layoutPicker < 0.72) {
    layoutPaintings(g, rng);
  } else if (layoutPicker < 0.88) {
    layoutBoxes(g, rng);
  } else {
    layoutPlantStand(g, rng);
  }

  return g;
}

// ----- Layout helpers ----------------------------------------------------
// Each layout fills the area roughly x:[-1.4, 1.4], z:[-0.45, 0.45] on top
// of the table at y ≈ 1.05.

function hslMat(rng, sat = 0.7, light = 0.55) {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color().setHSL(rng(), sat, light),
    roughness: 0.7, flatShading: true,
  });
}

// Pottery — tall cylinders/cones with a glaze.
function layoutPottery(g, rng) {
  const count = 4 + Math.floor(rng() * 3);
  const xs = spread(count, -1.3, 1.3);
  for (let i = 0; i < count; i++) {
    const tall = rng() < 0.6;
    const r = 0.16 + rng() * 0.10;
    const h = tall ? (0.55 + rng() * 0.35) : (0.30 + rng() * 0.15);
    // Slightly belled at the top — a TruncatedConeGeometry would be nicer
    // but CylinderGeometry with different top/bottom radii gives the look.
    const pot = new THREE.Mesh(
      new THREE.CylinderGeometry(r * 0.85, r, h, 12),
      hslMat(rng, 0.4, 0.5),
    );
    pot.position.set(xs[i], 1.05 + h / 2, (rng() - 0.5) * 0.2);
    g.add(pot);
  }
}

// Hats — saucer-shaped discs stacked or scattered.
function layoutHats(g, rng) {
  const count = 5 + Math.floor(rng() * 3);
  const xs = spread(count, -1.3, 1.3);
  for (let i = 0; i < count; i++) {
    const stack = Math.random() < 0.4 ? 2 + Math.floor(rng() * 2) : 1;
    for (let s = 0; s < stack; s++) {
      const brim = new THREE.Mesh(
        new THREE.CylinderGeometry(0.22, 0.22, 0.04, 14),
        hslMat(rng, 0.5, 0.55),
      );
      brim.position.set(xs[i], 1.06 + s * 0.10, (rng() - 0.5) * 0.15);
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

// Mason jars of preserves / kombucha — short cylinders with bright lids.
function layoutJars(g, rng) {
  const count = 7 + Math.floor(rng() * 4);
  const xs = spread(count, -1.3, 1.3);
  for (let i = 0; i < count; i++) {
    const jar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.10, 0.10, 0.30, 10),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(rng(), 0.55, 0.45),
        roughness: 0.3, metalness: 0.2,
        transparent: true, opacity: 0.85,
      }),
    );
    const z = (i % 2 === 0 ? -0.15 : 0.15) + (rng() - 0.5) * 0.06;
    jar.position.set(xs[i], 1.20, z);
    g.add(jar);
    // Lid
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

// Paintings — vertical canvases displayed at an angle on a back rack.
function layoutPaintings(g, rng) {
  const count = 3 + Math.floor(rng() * 2);
  const xs = spread(count, -1.2, 1.2);
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
    frame.position.set(xs[i], 1.05 + h / 2, -0.25);
    frame.rotation.x = -0.18;       // tilt back
    g.add(frame);
    // Inner "art" panel — different color for contrast.
    const art = new THREE.Mesh(
      new THREE.BoxGeometry(w * 0.82, h * 0.82, 0.01),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(rng(), 0.7, 0.6),
        emissive: new THREE.Color().setHSL(rng(), 0.5, 0.4),
        emissiveIntensity: 0.25,
      }),
    );
    art.position.copy(frame.position);
    art.position.y += 0;
    art.position.z += 0.025;
    art.rotation.x = frame.rotation.x;
    g.add(art);
  }
}

// Boxes — assorted package shapes piled on the table.
function layoutBoxes(g, rng) {
  const count = 5 + Math.floor(rng() * 4);
  const xs = spread(count, -1.3, 1.3);
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
        (rng() - 0.5) * 0.20,
      );
      box.rotation.y = (rng() - 0.5) * 0.5;
      g.add(box);
    }
  }
}

// Plant stand — tiered pots with tall green tops, evokes the herb /
// succulent stalls.
function layoutPlantStand(g, rng) {
  const tiers = 2 + Math.floor(rng() * 2);
  for (let t = 0; t < tiers; t++) {
    const shelfY = 1.05 + t * 0.30;
    const count = 3 + Math.floor(rng() * 2);
    const xs = spread(count, -1.2, 1.2);
    for (let i = 0; i < count; i++) {
      const pot = new THREE.Mesh(
        new THREE.CylinderGeometry(0.13, 0.10, 0.16, 10),
        new THREE.MeshStandardMaterial({
          color: 0x8b5a2b, roughness: 0.85, flatShading: true,
        }),
      );
      pot.position.set(xs[i], shelfY + 0.08, t === 0 ? -0.15 : 0.15);
      g.add(pot);
      // Leaves: a clump of icospheres in green
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

// Evenly distribute `count` x-values along [a, b].
function spread(count, a, b) {
  if (count === 1) return [(a + b) * 0.5];
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push(a + (b - a) * (i / (count - 1)));
  }
  return out;
}
