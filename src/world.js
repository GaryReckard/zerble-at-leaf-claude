// Global world setup: sky, lights, ground, mountains, fog. Owns the chunk manager
// that lazily generates festival content as Zerble explores.

import * as THREE from 'three';
import { buildMountains } from './mountains.js';
import { ChunkManager } from './chunks.js';
import { LakeManager } from './lakes.js';
import { terrainHeight } from './rng.js';

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
let sun = null;
let _scene = null;

export function buildWorld(scene, crowd) {
  _scene = scene;
  skyMesh = buildSky(scene);
  sun = buildLightsAndFog(scene);
  groundMesh = buildGround(scene);
  mountainsGroup = buildMountains(scene);

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

export function updateWorld(playerPos) {
  // Lakes update first (same reason as boot: chunks consult lake footprints).
  if (lakeManager) lakeManager.update(_scene, playerPos);
  if (chunkManager) chunkManager.update(playerPos);
  // Keep the sky dome, ground plane and mountain ring centered on the player
  // so the world feels infinite — chunks at fixed world coords slide past,
  // but the backdrops always look the same distance away.
  if (skyMesh) skyMesh.position.set(playerPos.x, 0, playerPos.z);
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
  // continue to render no matter how far Zerble drives.
  if (sun) {
    sun.position.set(playerPos.x + 80, 130, playerPos.z + 60);
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

function buildLightsAndFog(scene) {
  scene.fog = new THREE.Fog(FOG_COLOR, 120, 520);

  const hemi = new THREE.HemisphereLight(HEMI_SKY, HEMI_GROUND, 0.75);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(SUN_COLOR, 1.35);
  sun.position.set(80, 130, 60);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 400;
  const shadowD = 160;
  sun.shadow.camera.left = -shadowD;
  sun.shadow.camera.right = shadowD;
  sun.shadow.camera.top = shadowD;
  sun.shadow.camera.bottom = -shadowD;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.04;
  scene.add(sun);
  scene.add(sun.target);

  scene.add(new THREE.AmbientLight(0xffffff, 0.15));
  return sun;
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
