// Festival tree — trunk + either rounded leaf or pine cone. Group-anchored
// at (0,0,0); caller sets position/rotation.

import * as THREE from 'three';

const TREE_GREENS = [0x4f8a4d, 0x5fa55d, 0x6dba6a, 0x4b7c4a, 0x82c277];
const _trunkGeo = new THREE.CylinderGeometry(0.35, 0.5, 3.6, 8);
const _trunkMat = new THREE.MeshStandardMaterial({
  color: 0x6a4a2a, roughness: 0.95, flatShading: true,
});

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
