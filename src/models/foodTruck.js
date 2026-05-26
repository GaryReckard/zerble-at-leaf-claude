// Festival food truck — cab + cargo box + service window + canopy + sign.
// Faces -X (the serving window opens to +Z). Caller positions/rotates the group.

import * as THREE from 'three';

// Trucks read as too dainty next to Zerble — bump them up so they feel like
// proper rigs you have to drive around, not toy cars. Caller-side colliders
// (chunks.js) scale to match.
export const FOOD_TRUCK_SCALE = 1.7;

export function buildFoodTruck(rng = Math.random) {
  const g = new THREE.Group();

  const colors = [0xff6f9c, 0xffd28a, 0x66d9ff, 0x6fcf6a, 0xb285ff, 0xff8a5b];
  const color = colors[Math.floor(rng() * colors.length)];

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
  // Thin canopy — skip shadow casting; box + cab carry the truck silhouette.
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

  // Uniform scale so all interior offsets stay correct.
  g.scale.setScalar(FOOD_TRUCK_SCALE);
  return g;
}
