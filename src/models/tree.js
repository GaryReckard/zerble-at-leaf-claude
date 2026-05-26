// Festival tree — trunk + either rounded leaf or pine cone. Group-anchored
// at (0,0,0); caller sets position/rotation.
//
// `buildTree` is the standard chunk tree (small, sparse, no collider).
// `buildForestTree` is the bigger, more varied forest tree — taller, with
// three subspecies (tall pine, oak, birch). Forest trees register as
// `forest_tree` in the registry with a hard collider (the forests module
// handles registration; this just builds geometry).

import * as THREE from 'three';

const TREE_GREENS = [0x4f8a4d, 0x5fa55d, 0x6dba6a, 0x4b7c4a, 0x82c277];
const FOREST_GREENS = [0x355a32, 0x3f6d3a, 0x2d4e2a, 0x4a7a45, 0x537f4d, 0x325438, 0x2b5532];

const _trunkGeo = new THREE.CylinderGeometry(0.35, 0.5, 3.6, 8);
const _trunkMat = new THREE.MeshStandardMaterial({
  color: 0x6a4a2a, roughness: 0.95, flatShading: true,
});

// Shared materials for forest trees so we don't allocate per-tree.
// Caller still constructs new geometries (sizes vary) but materials pool.
const _forestTrunkMat = new THREE.MeshStandardMaterial({
  color: 0x5a3f24, roughness: 1.0, flatShading: true,
});
const _birchTrunkMat = new THREE.MeshStandardMaterial({
  color: 0xe8e4d6, roughness: 0.95, flatShading: true,
});
// Foliage materials by green index (so all trees of one shade share a mat).
const _foliageMats = FOREST_GREENS.map((hex) =>
  new THREE.MeshStandardMaterial({ color: hex, roughness: 1.0, flatShading: true })
);

export function buildTree(rng = Math.random) {
  const tree = new THREE.Group();
  const trunk = new THREE.Mesh(_trunkGeo, _trunkMat);
  trunk.position.y = 1.8;
  trunk.castShadow = true;
  tree.add(trunk);

  if (rng() < 0.65) {
    const r = 1.6 + rng() * 1.0;
    const leaf = new THREE.Mesh(
      new THREE.IcosahedronGeometry(r, 1),
      new THREE.MeshStandardMaterial({
        color: TREE_GREENS[Math.floor(rng() * TREE_GREENS.length)],
        roughness: 0.95,
        flatShading: true,
      })
    );
    leaf.position.y = 3.8 + rng() * 0.4;
    leaf.castShadow = true;
    tree.add(leaf);
  } else {
    const h = 4 + rng() * 2.5;
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(1.4, h, 8),
      new THREE.MeshStandardMaterial({ color: 0x2d5d3e, roughness: 0.95, flatShading: true })
    );
    cone.position.y = 2 + h / 2;
    cone.castShadow = true;
    tree.add(cone);
  }
  return tree;
}

// ---------- Forest trees ----------
//
// Three subspecies, picked randomly:
//   - Tall pine: stacked cones, total height 8-11m
//   - Old oak: broad rounded foliage on a thick trunk, 7-9m
//   - Birch: narrow white trunk with smaller crown, 6-8m
//
// Sizes are 1.7-2.5x the chunk tree so a forest feels like real woods.

export function buildForestTree(rng = Math.random) {
  const r = rng();
  if (r < 0.45) return buildTallPine(rng);
  if (r < 0.80) return buildOak(rng);
  return buildBirch(rng);
}

// Exported for sandbox inspection — buildForestTree() picks one at random,
// but the sandbox lets the user pick a specific variant.
export function buildTallPine(rng) {
  const group = new THREE.Group();

  // Trunk: tall and slim, slight taper
  const trunkH = 6 + rng() * 3;          // 6-9m bare trunk
  const trunkR = 0.4 + rng() * 0.15;
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(trunkR * 0.55, trunkR, trunkH, 7),
    _forestTrunkMat,
  );
  trunk.position.y = trunkH / 2;
  trunk.castShadow = true;
  group.add(trunk);

  // 3-4 stacked cones, decreasing radius going up.
  // Only the lowest tier casts shadow — the rest stack visually but adding
  // their shadow passes barely changes the ground silhouette and burns
  // shadow-map budget.
  const greenIdx = Math.floor(rng() * _foliageMats.length);
  const mat = _foliageMats[greenIdx];
  const tiers = 3 + Math.floor(rng() * 2);
  let baseY = trunkH - 0.5;
  let baseR = 1.5 + rng() * 0.5;
  for (let i = 0; i < tiers; i++) {
    const h = 1.6 - i * 0.15;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(baseR, h, 8), mat);
    cone.position.y = baseY + h / 2;
    cone.castShadow = (i === 0);
    group.add(cone);
    baseY += h * 0.7;
    baseR *= 0.78;
  }
  return group;
}

export function buildOak(rng) {
  const group = new THREE.Group();

  // Trunk: thick and shorter than pine
  const trunkH = 3.5 + rng() * 1.5;       // 3.5-5m bare trunk
  const trunkR = 0.55 + rng() * 0.2;
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(trunkR * 0.7, trunkR, trunkH, 8),
    _forestTrunkMat,
  );
  trunk.position.y = trunkH / 2;
  trunk.castShadow = true;
  group.add(trunk);

  // Broad rounded crown: one big icosphere + 2-3 smaller bumps offset
  const greenIdx = Math.floor(rng() * _foliageMats.length);
  const mat = _foliageMats[greenIdx];
  const mainR = 2.2 + rng() * 0.8;
  const main = new THREE.Mesh(new THREE.IcosahedronGeometry(mainR, 1), mat);
  main.position.y = trunkH + mainR * 0.6;
  main.castShadow = true;
  group.add(main);

  // Bumps don't cast shadow — main crown's shadow already covers them visually.
  const bumpCount = 2 + Math.floor(rng() * 2);
  for (let i = 0; i < bumpCount; i++) {
    const br = 0.9 + rng() * 0.7;
    const ang = rng() * Math.PI * 2;
    const dist = mainR * 0.6;
    const bump = new THREE.Mesh(new THREE.IcosahedronGeometry(br, 1), mat);
    bump.position.set(
      Math.cos(ang) * dist,
      trunkH + mainR * 0.6 + (rng() - 0.3) * 0.8,
      Math.sin(ang) * dist,
    );
    group.add(bump);
  }
  return group;
}

export function buildBirch(rng) {
  const group = new THREE.Group();

  // Trunk: thin and tall, white-grey
  const trunkH = 5 + rng() * 2;           // 5-7m
  const trunkR = 0.22 + rng() * 0.08;
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(trunkR * 0.7, trunkR, trunkH, 7),
    _birchTrunkMat,
  );
  trunk.position.y = trunkH / 2;
  trunk.castShadow = true;
  group.add(trunk);

  // Small narrow crown — a few tight icospheres
  const greenIdx = Math.floor(rng() * _foliageMats.length);
  const mat = _foliageMats[greenIdx];
  // Only the lowest crown puff casts shadow — the upper stack reads fine
  // without (birch crowns are small to begin with).
  const crownCount = 2 + Math.floor(rng() * 2);
  for (let i = 0; i < crownCount; i++) {
    const cr = 0.9 + rng() * 0.4;
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(cr, 1), mat);
    crown.position.set(
      (rng() - 0.5) * 0.6,
      trunkH + cr * 0.5 + i * cr * 0.7,
      (rng() - 0.5) * 0.6,
    );
    if (i === 0) crown.castShadow = true;
    group.add(crown);
  }
  return group;
}
