// Vendor / craft tent — 4 legs, pyramid roof, table with small items.
// Returns a THREE.Group anchored at (0,0,0).

import * as THREE from 'three';

export function buildTent(rng = Math.random) {
  const g = new THREE.Group();

  const baseColors = [0xfff4d0, 0xe7c995, 0xfddfa5, 0xd0c2a8];
  const roofColors = [0xff6f9c, 0x6fcf6a, 0xffd28a, 0xb285ff, 0x66d9ff];
  const baseColor = baseColors[Math.floor(rng() * baseColors.length)];
  const roofColor = roofColors[Math.floor(rng() * roofColors.length)];

  const legMat = new THREE.MeshStandardMaterial({
    color: 0x3a2e22, roughness: 0.8, flatShading: true,
  });
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
      new THREE.BoxGeometry(0.25 + rng() * 0.2, 0.2 + rng() * 0.3, 0.25),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(rng(), 0.7, 0.55),
        roughness: 0.7,
        flatShading: true,
      })
    );
    obj.position.set(-1 + i * 1, 1.2, 0);
    g.add(obj);
  }

  return g;
}
