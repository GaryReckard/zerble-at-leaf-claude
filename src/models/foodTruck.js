// Festival food truck — cab + cargo box + service window + canopy + sign.
// Faces -X (the serving window opens to +Z). Caller positions/rotates the group.

import * as THREE from 'three';

// Trucks read as too dainty next to Zerble — bump them up so they feel like
// proper rigs you have to drive around, not toy cars. Caller-side colliders
// (chunks.js) scale to match.
export const FOOD_TRUCK_SCALE = 1.7;

// Shared geometries — every truck uses the same buffers. With 3-5 trucks
// per food-plaza chunk × multiple visible chunks, the per-instance cost of
// fresh BoxGeometry/CylinderGeometry adds up fast. Tagged userData.shared
// so chunk-unload disposal doesn't free them.
const _GEO = {
  box:    new THREE.BoxGeometry(6, 3, 3.2),
  cab:    new THREE.BoxGeometry(2, 2.2, 3.0),
  wind:   new THREE.BoxGeometry(0.05, 1.0, 2.5),
  serv:   new THREE.BoxGeometry(3.5, 1.0, 0.05),
  canopy: new THREE.BoxGeometry(3.6, 0.1, 1.2),
  wheel:  new THREE.CylinderGeometry(0.5, 0.5, 0.3, 14),
  sign:   new THREE.BoxGeometry(4, 0.7, 0.15),
};
for (const g of Object.values(_GEO)) g.userData.shared = true;

// Materials that don't vary by truck — pool them too.
const _SHARED_MATS = {
  dark:   new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.8, flatShading: true }),
  window: new THREE.MeshStandardMaterial({
    color: 0x97e6ff, emissive: 0x97e6ff, emissiveIntensity: 0.15, roughness: 0.2,
  }),
  canopy: new THREE.MeshStandardMaterial({ color: 0xfff4d0, roughness: 0.8, flatShading: true }),
  sign:   new THREE.MeshStandardMaterial({
    color: 0xfff4d0, emissive: 0xffe066, emissiveIntensity: 0.4, roughness: 0.5,
  }),
};
for (const m of Object.values(_SHARED_MATS)) m.userData.shared = true;

// Body material varies by truck color; pool by color so two pink trucks
// share their bodyMat (which means three.js can batch their box+cab draws).
const _bodyMatPool = new Map();
function _bodyMatFor(hex) {
  let m = _bodyMatPool.get(hex);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.55, flatShading: true });
    m.userData.shared = true;
    _bodyMatPool.set(hex, m);
  }
  return m;
}

const _COLORS = [0xff6f9c, 0xffd28a, 0x66d9ff, 0x6fcf6a, 0xb285ff, 0xff8a5b];

export function buildFoodTruck(rng = Math.random) {
  const g = new THREE.Group();

  const color = _COLORS[Math.floor(rng() * _COLORS.length)];
  const bodyMat = _bodyMatFor(color);

  const box = new THREE.Mesh(_GEO.box, bodyMat);
  box.position.set(0.5, 1.9, 0);
  box.castShadow = true;
  box.receiveShadow = true;
  g.add(box);

  const cab = new THREE.Mesh(_GEO.cab, bodyMat);
  cab.position.set(-2.5, 1.4, 0);
  cab.castShadow = true;
  g.add(cab);

  const wind = new THREE.Mesh(_GEO.wind, _SHARED_MATS.window);
  wind.position.set(-3.55, 1.9, 0);
  g.add(wind);

  const serv = new THREE.Mesh(_GEO.serv, _SHARED_MATS.window);
  serv.position.set(0.5, 2.4, 1.6);
  g.add(serv);

  const canopy = new THREE.Mesh(_GEO.canopy, _SHARED_MATS.canopy);
  canopy.position.set(0.5, 3.1, 2.3);
  canopy.rotation.x = -0.2;
  // Thin canopy — skip shadow casting; box + cab carry the truck silhouette.
  g.add(canopy);

  for (const [wx, wz] of [[-2.5, -1.5], [-2.5, 1.5], [1.5, -1.5], [1.5, 1.5]]) {
    const w = new THREE.Mesh(_GEO.wheel, _SHARED_MATS.dark);
    w.rotation.z = Math.PI / 2;
    w.position.set(wx, 0.5, wz);
    g.add(w);
  }

  const sign = new THREE.Mesh(_GEO.sign, _SHARED_MATS.sign);
  sign.position.set(0.5, 3.8, 1);
  sign.rotation.x = -0.15;
  g.add(sign);

  // Uniform scale so all interior offsets stay correct.
  g.scale.setScalar(FOOD_TRUCK_SCALE);
  return g;
}
