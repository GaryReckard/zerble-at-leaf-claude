// Festival kid — small capsule body + head. children[0] is the body so the
// caller can do a "lil hop" bob each frame.

import * as THREE from 'three';

export function buildKid(rng = Math.random) {
  const g = new THREE.Group();

  const shirtColor = new THREE.Color().setHSL(rng(), 0.7, 0.6).getHex();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.22, 0.55, 4, 8),
    new THREE.MeshStandardMaterial({ color: shirtColor, roughness: 0.85, flatShading: true })
  );
  body.position.y = 0.55;
  body.castShadow = true;
  g.add(body);

  const head = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.22, 1),
    new THREE.MeshStandardMaterial({ color: 0xe6c098, roughness: 0.9, flatShading: true })
  );
  head.position.y = 1.15;
  head.castShadow = true;
  g.add(head);

  // 50% chance of a colorful streamer / glow stick — sells the festival kid vibe
  if (rng() < 0.5) {
    const accColors = [0xff5577, 0xffe066, 0x66ff88, 0x66d9ff, 0xc080ff];
    const acc = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, 0.6, 6),
      new THREE.MeshStandardMaterial({
        color: accColors[Math.floor(rng() * accColors.length)],
        emissive: accColors[Math.floor(rng() * accColors.length)],
        emissiveIntensity: 1.2,
        roughness: 0.4,
      }),
    );
    acc.position.set(0.22, 0.85, 0);
    acc.rotation.z = -0.4;
    g.add(acc);
  }

  return g;
}
