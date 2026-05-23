// Smile pickups: glowing yellow orbs that float up from happy NPCs and drift toward Zerble.

import * as THREE from 'three';

const PICKUP_RADIUS = 2.4;
const SEEK_RANGE = 14;
const SEEK_SPEED = 12;
const RISE_SPEED = 1.5;
const LIFETIME = 9;

export class Smiles {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'Smiles';
    this.active = [];

    // Reusable geometry/material for visual smile bodies
    this._geo = new THREE.IcosahedronGeometry(0.32, 1);
    this._mat = new THREE.MeshStandardMaterial({
      color: 0xffe066,
      emissive: 0xffcc33,
      emissiveIntensity: 2.4,
      roughness: 0.4,
    });
  }

  spawn(worldPos) {
    const mesh = new THREE.Mesh(this._geo, this._mat);
    mesh.position.copy(worldPos);
    mesh.position.y += 1.6;
    this.group.add(mesh);

    // Soft halo
    const halo = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 0.7, 18),
      new THREE.MeshBasicMaterial({
        color: 0xffe066,
        transparent: true,
        opacity: 0.5,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = -0.25;
    mesh.add(halo);

    this.active.push({
      mesh,
      halo,
      age: 0,
      seeking: false,
    });
  }

  update(dt, zerble, onCollect) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const s = this.active[i];
      s.age += dt;

      const toZerble = new THREE.Vector3().subVectors(zerble.position, s.mesh.position);
      toZerble.y += 1.5;
      const dist = toZerble.length();

      if (!s.seeking && dist < SEEK_RANGE) s.seeking = true;

      if (s.seeking) {
        toZerble.normalize().multiplyScalar(SEEK_SPEED * dt);
        s.mesh.position.add(toZerble);
      } else {
        s.mesh.position.y += RISE_SPEED * dt;
      }

      // Bobble & spin
      s.mesh.rotation.y += dt * 2.5;
      s.mesh.position.y += Math.sin(s.age * 4 + i) * 0.005;

      // Halo pulse
      s.halo.scale.setScalar(1 + Math.sin(s.age * 5) * 0.2);

      // Collect
      if (dist < PICKUP_RADIUS) {
        this.group.remove(s.mesh);
        s.mesh.geometry = null;
        this.active.splice(i, 1);
        onCollect(1);
        continue;
      }

      // Despawn after lifetime
      if (s.age >= LIFETIME) {
        this.group.remove(s.mesh);
        this.active.splice(i, 1);
      }
    }
  }
}
