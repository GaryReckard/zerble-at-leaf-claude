// Heart shape — extruded 2D heart using THREE.Shape. Centered at origin.
// Used for Lurleen's heart particles and the sandbox preview.

import * as THREE from 'three';

export function createHeartGeometry() {
  const shape = new THREE.Shape();
  const x = -0.5;
  const y = -0.95;
  shape.moveTo(x + 0.5, y + 0.5);
  shape.bezierCurveTo(x + 0.5, y + 0.5, x + 0.4, y, x, y);
  shape.bezierCurveTo(x - 0.6, y, x - 0.6, y + 0.7, x - 0.6, y + 0.7);
  shape.bezierCurveTo(x - 0.6, y + 1.1, x - 0.3, y + 1.54, x + 0.5, y + 1.9);
  shape.bezierCurveTo(x + 1.2, y + 1.54, x + 1.6, y + 1.1, x + 1.6, y + 0.7);
  shape.bezierCurveTo(x + 1.6, y + 0.7, x + 1.6, y, x + 1, y);
  shape.bezierCurveTo(x + 0.7, y, x + 0.5, y + 0.5, x + 0.5, y + 0.5);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.18,
    bevelEnabled: true,
    bevelSegments: 2,
    bevelSize: 0.05,
    bevelThickness: 0.05,
    curveSegments: 8,
  });
  geo.center();
  // ExtrudeGeometry leaves the heart oriented +Z forward. Flip vertically so
  // the point hangs DOWN when seen face-on.
  geo.rotateZ(Math.PI);
  geo.scale(0.18, 0.18, 0.18);
  return geo;
}

// Shared instance — cheap to clone refs across particles.
export const sharedHeartGeometry = createHeartGeometry();
