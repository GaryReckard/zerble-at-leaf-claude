// Blue Ridge backdrop: three rings of low-poly hills around the play area, autumn palette.
// Mountains ignore fog so they're always visible against the sky.

import * as THREE from 'three';

// Palettes inspired by Black Mountain in October — fall foliage on rolling hills.
const PALETTE_NEAR = [
  0xd1502b, 0xe07a3a, 0xebb12c, 0xc88a2e, // oranges/golds
  0x9a4423, 0x6b2f1a,                     // burnt reds/browns
  0x3f5d3b, 0x4f7a44,                     // deep evergreens
];

const PALETTE_MID = [
  0x8f5a3a, 0xa07a4a, 0x6e5232,           // muted browns
  0x5a6f4c, 0x435a45,                     // mossy greens
  0x7a4e3a,                                // rusty
];

const PALETTE_FAR = [
  0x7d7e9c, 0x8d8eaa, 0x6f7290,           // hazy blue-purple
  0x9089a5, 0x5a6388,
];

export function buildMountains(scene) {
  const root = new THREE.Group();
  root.name = 'Mountains';

  // The near ridge — bigger hills with vivid autumn colors
  buildHillLayer(root, {
    radius: 380,
    count: 56,
    minSize: 26,
    maxSize: 60,
    heightRatio: [0.35, 0.55],
    palette: PALETTE_NEAR,
    sink: 0.6,
    ignoreFog: true,
  });

  // Mid ridge — softer/duller hills, visible just behind the near ridge
  buildHillLayer(root, {
    radius: 520,
    count: 70,
    minSize: 34,
    maxSize: 80,
    heightRatio: [0.3, 0.5],
    palette: PALETTE_MID,
    sink: 0.55,
    ignoreFog: true,
  });

  // Far haze — barely there, just suggests endless ridges
  buildHillLayer(root, {
    radius: 680,
    count: 80,
    minSize: 50,
    maxSize: 130,
    heightRatio: [0.22, 0.38],
    palette: PALETTE_FAR,
    sink: 0.5,
    ignoreFog: true,
  });

  scene.add(root);
  return root;
}

function buildHillLayer(parent, opts) {
  const { radius, count, minSize, maxSize, heightRatio, palette, sink, ignoreFog } = opts;

  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * (Math.PI / count) * 0.8;
    const rJitter = (Math.random() - 0.5) * radius * 0.18;
    const r = radius + rJitter;

    const size = minSize + Math.random() * (maxSize - minSize);
    const hr = heightRatio[0] + Math.random() * (heightRatio[1] - heightRatio[0]);
    const tall = size * hr * 2; // total height

    // Use an icosahedron and squash it vertically — gives the rounded Blue Ridge silhouette.
    const detail = 1;
    const geo = new THREE.IcosahedronGeometry(size, detail);
    geo.scale(1.0, hr, 1.0);

    // Slight horizontal squish for variety (some hills wider than tall)
    const stretchX = 0.75 + Math.random() * 0.8;
    const stretchZ = 0.75 + Math.random() * 0.8;
    geo.scale(stretchX, 1.0, stretchZ);

    // Per-vertex color so each face has slight color variation — adds visual richness
    const colors = new Float32Array(geo.attributes.position.count * 3);
    const baseColor = new THREE.Color(palette[Math.floor(Math.random() * palette.length)]);
    const tmpColor = new THREE.Color();
    for (let v = 0; v < geo.attributes.position.count; v++) {
      const y = geo.attributes.position.getY(v);
      // Higher vertices get slightly lighter (sun-touched ridge tops)
      tmpColor.copy(baseColor);
      const lighten = THREE.MathUtils.clamp(y / (tall * 0.5), -0.2, 0.5);
      tmpColor.offsetHSL(0, 0, lighten * 0.06);
      // Slight per-face jitter
      tmpColor.offsetHSL((Math.random() - 0.5) * 0.02, 0, (Math.random() - 0.5) * 0.03);
      colors[v * 3] = tmpColor.r;
      colors[v * 3 + 1] = tmpColor.g;
      colors[v * 3 + 2] = tmpColor.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 1.0,
      metalness: 0,
      fog: !ignoreFog,
    });

    const hill = new THREE.Mesh(geo, mat);
    hill.position.set(
      Math.cos(angle) * r,
      -size * sink,
      Math.sin(angle) * r
    );
    hill.rotation.y = Math.random() * Math.PI * 2;
    hill.castShadow = false;
    hill.receiveShadow = false;
    parent.add(hill);
  }
}
