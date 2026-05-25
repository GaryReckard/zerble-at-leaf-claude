// Canoe + paddler(s). Long axis along Z. Builds at the group's origin so
// callers can position/rotate the parent group freely.

import * as THREE from 'three';

export function buildCanoe(group, rng = Math.random) {
  const woodMat = new THREE.MeshStandardMaterial({
    color: 0x8b5a2b, roughness: 0.95, flatShading: true,
  });
  const insideMat = new THREE.MeshStandardMaterial({
    color: 0xd4a874, roughness: 0.95, flatShading: true,
  });

  // Hull
  const hull = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.4, 4.0), woodMat);
  hull.position.y = 0.2;
  hull.castShadow = true;
  hull.receiveShadow = true;
  group.add(hull);

  // Pointed bow + stern — cone apex points AWAY from center so the canoe
  // narrows to a point at each end. ConeGeometry's default apex is at +Y;
  // rotating +π/2 on X swings it to +Z and -π/2 swings it to -Z, so we
  // need the rotation sign to MATCH the cone's z-side, not oppose it.
  for (const ez of [-2.0, 2.0]) {
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.48, 1.0, 6), woodMat);
    tip.rotation.x = ez < 0 ? -Math.PI / 2 : Math.PI / 2;
    tip.position.set(0, 0.2, ez);
    tip.castShadow = true;
    group.add(tip);
  }

  // Inside floor (slightly raised, lighter wood)
  const floor = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.05, 3.6), insideMat);
  floor.position.y = 0.40;
  group.add(floor);

  // Two thwarts (seat planks)
  for (const ez of [-0.7, 0.7]) {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.06, 0.18), insideMat);
    seat.position.set(0, 0.50, ez);
    group.add(seat);
  }

  // 1-2 paddlers — front always taken; rear 55% of the time.
  const shirts = [0x66d9ff, 0xff6f9c, 0xffd28a, 0x6fcf6a, 0xb285ff, 0xff8a5b];
  const seatPositions = [-0.7, 0.7];
  const rearOccupied = rng() < 0.55;
  for (const ez of seatPositions) {
    if (ez > 0 && !rearOccupied) continue;

    const shirt = shirts[Math.floor(rng() * shirts.length)];
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.18, 0.55, 4, 6),
      new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.85, flatShading: true }),
    );
    body.position.set(0, 0.85, ez);
    body.castShadow = true;
    group.add(body);

    const head = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.20, 1),
      new THREE.MeshStandardMaterial({ color: 0xe6c098, roughness: 0.9, flatShading: true }),
    );
    head.position.set(0, 1.30, ez);
    head.castShadow = true;
    group.add(head);

    // Paddle — handle + blade, tilted to one side as if mid-stroke
    const paddleSide = ez < 0 ? -1 : 1;
    const paddle = new THREE.Group();
    const paddleHandle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, 1.4, 6),
      new THREE.MeshStandardMaterial({ color: 0x6a4a2a, roughness: 0.95, flatShading: true }),
    );
    paddle.add(paddleHandle);
    const paddleBlade = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.04, 0.45),
      new THREE.MeshStandardMaterial({ color: 0x8b6f47, roughness: 0.95, flatShading: true }),
    );
    paddleBlade.position.y = -0.75;
    paddle.add(paddleBlade);

    paddle.position.set(paddleSide * 0.55, 0.85, ez);
    paddle.rotation.z = paddleSide * -0.6;
    group.add(paddle);
  }
}
