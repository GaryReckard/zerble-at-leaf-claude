// Global world setup: sky, lights, ground, mountains, fog. Owns the chunk manager
// that lazily generates festival content as Zerble explores.

import * as THREE from 'three';
import { buildMountains } from './mountains.js';
import { ChunkManager } from './chunks.js';
import { LakeManager } from './lakes.js';
import { terrainHeight } from './rng.js';
import { TimeOfDay } from './timeOfDay.js';
import { PERF } from './perf.js';

const SKY_TOP = 0x6fb6e8;
const SKY_BOTTOM = 0xffd0a8;
const SUN_COLOR = 0xffe1b0;
const HEMI_SKY = 0xa9d6ff;
const HEMI_GROUND = 0xc89265;
const FOG_COLOR = 0xffcfae;
const GROUND_GREEN = 0x7cb37a;
const DIRT = 0xc69566;

const GROUND_SIZE = 1400; // very large flat-ish plane
const GROUND_SEG = 220;

let chunkManager = null;
let lakeManager = null;
let groundMesh = null;
let mountainsGroup = null;
let skyMesh = null;
let starsMesh = null;
let moonMesh = null;
let sun = null;
let hemi = null;
let ambient = null;
let _scene = null;
let timeOfDay = null;

export function getTimeOfDay() {
  return timeOfDay;
}

export function buildWorld(scene, crowd) {
  _scene = scene;
  skyMesh = buildSky(scene);
  starsMesh = buildStars(scene);
  moonMesh = buildMoon(scene);
  const lights = buildLightsAndFog(scene);
  sun = lights.sun;
  hemi = lights.hemi;
  ambient = lights.ambient;
  groundMesh = buildGround(scene);
  mountainsGroup = buildMountains(scene);

  timeOfDay = new TimeOfDay(scene);
  timeOfDay.attach({ sky: skyMesh, sun, hemi, ambient });

  // Lakes must materialize BEFORE the initial chunk pass — they register
  // footprints + colliders that chunks consult to avoid placing paths and
  // props on top of water.
  lakeManager = new LakeManager();
  lakeManager.update(scene, new THREE.Vector3(0, 0, 0));

  chunkManager = new ChunkManager(scene, crowd);
  // Pre-load the chunks around the origin so the first frame looks alive.
  chunkManager.update(new THREE.Vector3(0, 0, 0));

  return { chunkManager, lakeManager };
}

// Track ground "world center" so we can re-sample terrain heights at world
// coords whenever the player moves a noticeable amount. Without this, the
// terrain hills were locked to the ground's local geometry — they translated
// with the player and occluded fixed-world chunk paths ("the green ground
// swallows the path as you move").
let _groundLastResampleX = NaN;
let _groundLastResampleZ = NaN;
const GROUND_RESAMPLE_THRESHOLD = 40; // re-derive heights when player moves > 40m

export function updateWorld(playerPos, dt = 0.016) {
  // Lakes update first (same reason as boot: chunks consult lake footprints).
  if (lakeManager) lakeManager.update(_scene, playerPos, dt);
  if (chunkManager) chunkManager.update(playerPos);
  if (timeOfDay) timeOfDay.update(dt);
  // Keep the sky dome, ground plane and mountain ring centered on the player
  // so the world feels infinite — chunks at fixed world coords slide past,
  // but the backdrops always look the same distance away.
  if (skyMesh) skyMesh.position.set(playerPos.x, 0, playerPos.z);
  if (starsMesh) {
    starsMesh.position.set(playerPos.x, 0, playerPos.z);
    // Drive the star shader's nightness uniform so they fade in at dusk and
    // disappear at dawn. Also push current time for the twinkle wobble.
    const n = timeOfDay ? timeOfDay.nightness : 0;
    starsMesh.material.uniforms.nightness.value = n;
    starsMesh.material.uniforms.time.value += dt;
    starsMesh.visible = n > 0.05;   // hard-skip the draw at full daylight
  }
  if (moonMesh && timeOfDay) {
    // Moon arcs through the sky during the night phase (t in 0.55..0.95),
    // east → overhead → west, parallel to how the sun behaves during the day.
    // Hidden during the day so it doesn't compete with the sun.
    const t = timeOfDay.t;
    const nightPhase = t > 0.55 && t < 0.95;
    if (nightPhase) {
      const moonArc = (t - 0.55) * Math.PI / 0.40;
      const moonDist = 850;
      // Same east → west sweep as the sun, parametric on moonArc instead of arcAng
      const mx = Math.cos(moonArc) * moonDist * 0.55;     // 55% of sky radius
      const my = Math.max(40, Math.sin(moonArc) * moonDist * 0.55);
      const mz = -moonDist * 0.45;                         // opposite of sun's z=60 → opposite half of sky
      moonMesh.position.set(playerPos.x + mx, my, playerPos.z + mz);
      moonMesh.visible = true;
    } else {
      moonMesh.visible = false;
    }
  }
  if (groundMesh) {
    groundMesh.position.set(playerPos.x, 0, playerPos.z);
    // Re-sample terrain heights using WORLD coords so hills stay put as the
    // player drives across them. Throttled to avoid per-frame attribute work.
    if (
      isNaN(_groundLastResampleX) ||
      Math.abs(playerPos.x - _groundLastResampleX) > GROUND_RESAMPLE_THRESHOLD ||
      Math.abs(playerPos.z - _groundLastResampleZ) > GROUND_RESAMPLE_THRESHOLD
    ) {
      resampleGroundHeights(groundMesh, playerPos.x, playerPos.z);
      _groundLastResampleX = playerPos.x;
      _groundLastResampleZ = playerPos.z;
    }
  }
  if (mountainsGroup) mountainsGroup.position.set(playerPos.x, 0, playerPos.z);
  // Keep the sun's shadow frustum centered on the player too, so shadows
  // continue to render no matter how far Zerble drives. The TimeOfDay system
  // owns the *offset* (sun arc + below-horizon at night); we only translate
  // that offset to the player's position so the shadow camera stays on top
  // of where the action is.
  if (sun) {
    // TimeOfDay sets sun.position to the WORLD offset relative to origin —
    // add the player position so the sun stays at that bearing relative to
    // them rather than at world (0,0).
    sun.position.x += playerPos.x;
    sun.position.z += playerPos.z;
    sun.target.position.set(playerPos.x, 0, playerPos.z);
    sun.target.updateMatrixWorld();
  }
}

function resampleGroundHeights(mesh, originX, originZ) {
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  const centerOffset = terrainHeight(originX, originZ);
  for (let i = 0; i < pos.count; i++) {
    const lx = pos.getX(i);
    const lz = pos.getZ(i);
    pos.setY(i, terrainHeight(originX + lx, originZ + lz) - centerOffset);
  }
  pos.needsUpdate = true;
  // Normals stay close enough at this scale; recomputing them every 40m hurts perf.
}

// ---------------- internals ----------------

function buildSky(scene) {
  const skyGeo = new THREE.SphereGeometry(900, 32, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      topColor: { value: new THREE.Color(SKY_TOP) },
      bottomColor: { value: new THREE.Color(SKY_BOTTOM) },
      offset: { value: 30 },
      exponent: { value: 0.85 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPos.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 topColor;
      uniform vec3 bottomColor;
      uniform float offset;
      uniform float exponent;
      varying vec3 vWorldPosition;
      void main() {
        float h = normalize(vWorldPosition + vec3(0.0, offset, 0.0)).y;
        gl_FragColor = vec4(mix(bottomColor, topColor, max(pow(max(h, 0.0), exponent), 0.0)), 1.0);
      }
    `,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  scene.add(sky);
  return sky;
}

// Starfield — 1200 points scattered across the upper hemisphere of a sphere
// just inside the sky dome. Each star gets a random size, a randomized colour
// (mostly white, with a sprinkle of warm + cool tints), and an independent
// twinkle phase so the field shimmers rather than blinking uniformly.
//
// Driven entirely by a custom ShaderMaterial — uses gl_PointSize for per-star
// scale and AdditiveBlending so they glow against the dark sky. nightness
// uniform fades them in/out as the day cycles.
function buildStars(scene) {
  const STAR_COUNT = 1200;
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(STAR_COUNT * 3);
  const sizes = new Float32Array(STAR_COUNT);
  const colors = new Float32Array(STAR_COUNT * 3);

  for (let i = 0; i < STAR_COUNT; i++) {
    // Upper hemisphere distribution: phi all the way around, theta only the
    // top ~80° (some stars near the horizon, none below).
    const phi = Math.random() * Math.PI * 2;
    const theta = Math.acos(Math.random() * 0.95);  // 0..~78° from straight-up
    const r = 850;                                    // just inside sky radius 900
    positions[i * 3]     = r * Math.sin(theta) * Math.cos(phi);
    positions[i * 3 + 1] = r * Math.cos(theta);
    positions[i * 3 + 2] = r * Math.sin(theta) * Math.sin(phi);

    // Size — pow(rand, 4) biases toward small with a few bright "named star"
    // outliers. Range roughly 1.0..5.5 device-pixel units.
    sizes[i] = 1.0 + Math.pow(Math.random(), 4) * 4.5;

    // Colour — 70% white, 15% blue-white, 10% yellow-white, 5% orange-white.
    const cp = Math.random();
    let r0, g0, b0;
    if      (cp < 0.70) { r0 = 1.00; g0 = 1.00; b0 = 1.00; }
    else if (cp < 0.85) { r0 = 0.85; g0 = 0.92; b0 = 1.00; }
    else if (cp < 0.95) { r0 = 1.00; g0 = 0.95; b0 = 0.85; }
    else                { r0 = 1.00; g0 = 0.85; b0 = 0.72; }
    colors[i * 3]     = r0;
    colors[i * 3 + 1] = g0;
    colors[i * 3 + 2] = b0;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('size',     new THREE.BufferAttribute(sizes, 1));
  geo.setAttribute('color',    new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      nightness: { value: 0 },
      time:      { value: 0 },
      pixelRatio:{ value: Math.min(window.devicePixelRatio || 1, 2) },
    },
    vertexShader: /* glsl */ `
      attribute float size;
      attribute vec3 color;
      varying vec3 vColor;
      varying float vTwinkle;
      uniform float time;
      uniform float pixelRatio;
      void main() {
        vColor = color;
        // Per-star twinkle phase from position — deterministic, unique per star.
        float phase = position.x * 0.013 + position.z * 0.019 + position.y * 0.007;
        vTwinkle = 0.65 + 0.35 * sin(time * 1.6 + phase);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * pixelRatio;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float nightness;
      varying vec3 vColor;
      varying float vTwinkle;
      void main() {
        // Soft round splat — alpha falls off from center to edge.
        vec2 uv = gl_PointCoord - vec2(0.5);
        float d = length(uv);
        if (d > 0.5) discard;
        float falloff = smoothstep(0.5, 0.0, d);
        float alpha = falloff * nightness * vTwinkle;
        gl_FragColor = vec4(vColor * vTwinkle, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
  });

  const stars = new THREE.Points(geo, mat);
  stars.renderOrder = -1;   // draw early — keeps additive blend out of crowd of bubbles
  scene.add(stars);
  return stars;
}

// Moon — visible sphere mesh that orbits the night sky in parallel to the
// sun's day arc. Slightly emissive so it glows against the dark sky, with a
// subtler "highlight + shadow" feel from a secondary darker patch on one
// side. Not a light source — the hemisphere/sun handle world illumination.
function buildMoon(scene) {
  const group = new THREE.Group();
  group.name = 'moon';

  // Main moon body — pale cream, slight emissive so it pops against the
  // night sky. Big enough to read from anywhere in the world (radius 14 at
  // sky distance ~850 subtends ~1° — about real-moon size).
  const moon = new THREE.Mesh(
    new THREE.IcosahedronGeometry(14, 2),
    new THREE.MeshBasicMaterial({
      color: 0xfaf2dc,
      // MeshBasicMaterial ignores lighting — exactly what we want for a
      // self-luminous moon. The MeshStandardMaterial sun wouldn't light it
      // anyway since they're both above the horizon together (well, never;
      // moon only when sun is down — but still cleaner this way).
    }),
  );
  group.add(moon);

  // Slightly darker patch offset to one side — gives the moon a subtle
  // "mare" / phase hint without going full lunar map. Small icosphere
  // overlapping the front face of the main sphere.
  const mare = new THREE.Mesh(
    new THREE.IcosahedronGeometry(11, 2),
    new THREE.MeshBasicMaterial({ color: 0xc8b89a }),
  );
  mare.position.set(2.5, 1.5, 4);
  mare.scale.set(0.65, 0.55, 0.45);
  group.add(mare);

  // Soft halo — a larger faintly-emissive sphere with additive blending so it
  // looks like the moon has a gentle glow around it.
  const halo = new THREE.Mesh(
    new THREE.IcosahedronGeometry(22, 1),
    new THREE.MeshBasicMaterial({
      color: 0xb8c4e0,
      transparent: true,
      opacity: 0.22,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  group.add(halo);

  group.renderOrder = 0;  // after stars (-1), before bubbles
  group.visible = false;  // updateWorld toggles based on night phase
  scene.add(group);
  return group;
}

function buildLightsAndFog(scene) {
  scene.fog = new THREE.Fog(FOG_COLOR, 120, 520);

  const hemi = new THREE.HemisphereLight(HEMI_SKY, HEMI_GROUND, 0.75);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(SUN_COLOR, 1.35);
  sun.position.set(80, 130, 60);
  sun.castShadow = PERF.shadows;
  // Tier-aware shadow map size (per threejs-lighting skill: "smaller shadow
  // maps; 512-1024 often sufficient"). The world's sun is the only shadow
  // caster in the scene, so map size is the lever — 512 on mid, 1024 on
  // high. Low tier has shadows off entirely.
  const shadowMapSize = PERF.name === 'high' ? 1024 : 512;
  sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 200;
  // Tighter shadow frustum on mid (the chunk draw radius is smaller, so we
  // don't need to cover the full 100m × 100m area) — gets more resolution
  // out of the smaller map.
  const shadowD = PERF.name === 'high' ? 100 : 60;
  sun.shadow.camera.left = -shadowD;
  sun.shadow.camera.right = shadowD;
  sun.shadow.camera.top = shadowD;
  sun.shadow.camera.bottom = -shadowD;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.04;
  scene.add(sun);
  scene.add(sun.target);

  const ambient = new THREE.AmbientLight(0xffffff, 0.15);
  scene.add(ambient);
  return { sun, hemi, ambient };
}

function buildGround(scene) {
  const geo = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE, GROUND_SEG, GROUND_SEG);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const color = new THREE.Color();
  const grass = new THREE.Color(GROUND_GREEN);
  const dirt = new THREE.Color(DIRT);

  // The ground follows the player; subtract the center's Y so the cart sits at y=0.
  const centerOffset = terrainHeight(0, 0);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, terrainHeight(x, z) - centerOffset);

    const patch = Math.sin(x * 0.04) * Math.cos(z * 0.045);
    const dirtAmt = THREE.MathUtils.clamp((patch + 1.1) * 0.4, 0, 1) * 0.35;
    color.copy(grass).lerp(dirt, dirtAmt);
    color.offsetHSL((Math.sin(i * 12.9898) * 0.5 + 0.5) * 0.05 - 0.025, 0, 0);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0,
    flatShading: true,
  });
  const ground = new THREE.Mesh(geo, mat);
  ground.receiveShadow = true;
  scene.add(ground);
  return ground;
}
