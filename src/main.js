// Bootstraps three.js, runs the game loop, owns the camera, post-processing, and
// collision/scoring orchestration.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { Input } from './input.js';
import { HUD } from './hud.js';
import { buildWorld, getWorldColliders } from './world.js';
import { Zerble } from './zerble.js';
import { Bubbles } from './bubbles.js';
import { Smiles } from './smiles.js';
import { Crowd } from './crowd.js';
import {
  PuppetParade,
  BrassBand,
  KidGaggle,
  Wooks,
  buildFoodTrucks,
} from './obstacles.js';

const canvas = document.getElementById('game');

// ---------- Renderer ----------
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

// ---------- Scene & Camera ----------
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  62,
  window.innerWidth / window.innerHeight,
  0.5,
  900
);

// ---------- Post-processing (bloom on emissives) ----------
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.6,    // strength
  0.85,   // radius
  0.78    // threshold — only really bright (emissive) stuff blooms
);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

// ---------- World ----------
buildWorld(scene);

// ---------- Zerble ----------
const zerble = new Zerble();
zerble.position.set(0, 0, 150);
zerble.heading = 0; // forward = -Z, toward the festival
scene.add(zerble.root);

// ---------- Bubbles ----------
const bubbles = new Bubbles();
scene.add(bubbles.mesh);

// ---------- Smiles ----------
const smiles = new Smiles();
scene.add(smiles.group);

// ---------- Crowd ----------
const crowd = new Crowd(smiles);
scene.add(crowd.group);

// ---------- Obstacles ----------
const puppets = new PuppetParade();
scene.add(puppets.group);
const band = new BrassBand();
scene.add(band.group);
const kids = new KidGaggle();
scene.add(kids.group);
const wooks = new Wooks();
scene.add(wooks.group);
const truckColliders = buildFoodTrucks(scene);

const obstacleSources = [
  () => puppets.colliders,
  () => band.colliders,
  () => kids.colliders,
  () => wooks.colliders,
  () => truckColliders,
  () => getWorldColliders(),
];

// ---------- Honk ring ----------
const honkRing = new THREE.Mesh(
  new THREE.RingGeometry(0.5, 0.55, 48),
  new THREE.MeshBasicMaterial({
    color: 0xffd28a,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  })
);
honkRing.rotation.x = -Math.PI / 2;
scene.add(honkRing);
let honkAge = 999;

// ---------- HUD ----------
let score = 0;
let best = HUD.loadBest();
let running = false;

HUD.showTitle();
HUD.onStart(() => {
  HUD.hideTitle();
  running = true;
  HUD.toast('Honk to spread joy. Avoid the parade!', 2500);
});

// ---------- Camera follow state ----------
const camOffset = new THREE.Vector3(0, 6.5, 12);
const camLookOffset = new THREE.Vector3(0, 1.8, -4);
const camPos = new THREE.Vector3();
const camLook = new THREE.Vector3();

// Snap camera to chase position immediately so we never have to lerp across the world.
function computeChaseTarget(target, lookTarget) {
  // Camera sits BEHIND Zerble: position - forward * distance.
  // forward = (-sin(h), 0, -cos(h)), so camera.x = position.x + sin(h) * dist.
  target.set(
    zerble.position.x + Math.sin(zerble.heading) * camOffset.z,
    zerble.position.y + camOffset.y,
    zerble.position.z + Math.cos(zerble.heading) * camOffset.z
  );
  lookTarget.set(
    zerble.position.x - Math.sin(zerble.heading) * 4,
    zerble.position.y + camLookOffset.y,
    zerble.position.z - Math.cos(zerble.heading) * 4
  );
}
computeChaseTarget(camPos, camLook);
camera.position.copy(camPos);
camera.lookAt(camLook);

// ---------- Game loop ----------
const clock = new THREE.Clock();

function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);

  if (running) {
    zerble.update(dt, Input);

    // Honk
    if (Input.consumePressed('SPACE') && zerble.canHonk()) {
      zerble.honk();
      honkAge = 0;
      crowd.applyHonk(zerble);
    }

    bubbles.update(dt, zerble);
    crowd.update(dt, zerble, bubbles);
    smiles.update(dt, zerble, (n) => {
      score += n;
      HUD.setSmiles(score);
      HUD.saveBest(score);
    });

    puppets.update(dt);
    band.update(dt);
    kids.update(dt);
    wooks.update(dt);

    // Collisions: gather, check, deduct
    if (zerble.invulnLeft <= 0) {
      for (const src of obstacleSources) {
        const list = src();
        for (const c of list) {
          const dx = c.position.x - zerble.position.x;
          const dz = c.position.z - zerble.position.z;
          const d = Math.hypot(dx, dz);
          const minD = c.radius + zerble.radius;
          if (d < minD) {
            const inv = 1 / (d || 0.0001);
            const pushDir = new THREE.Vector3(-dx * inv, 0, -dz * inv);
            zerble.applyHit(pushDir);
            score = Math.max(0, score - c.damage);
            HUD.setSmiles(score);
            HUD.flashHit();
            HUD.toast(toastForKind(c.kind), 1400);
            break;
          }
        }
        if (zerble.invulnLeft > 0) break;
      }
    }

    // Honk ring animation
    if (honkAge < 1.2) {
      honkAge += dt;
      const t = honkAge / 1.2;
      honkRing.position.set(zerble.position.x, 0.1, zerble.position.z);
      const r = 1 + t * 14;
      honkRing.scale.set(r, r, r);
      honkRing.material.opacity = (1 - t) * 0.65;
    } else {
      honkRing.material.opacity = 0;
    }
  }

  // ----- Camera follow -----
  computeChaseTarget(camPos, camLook);
  // Smooth interp — fast enough that we don't drift inside the cart.
  camera.position.lerp(camPos, Math.min(1, dt * 6));
  camera.lookAt(camLook);

  composer.render();
  requestAnimationFrame(tick);
}

function toastForKind(kind) {
  switch (kind) {
    case 'puppet': return 'A giant puppet bonked you. -smile';
    case 'brass': return 'You blocked the brass band. Sorry, tuba.';
    case 'truck': return 'Don\'t hit the food trucks!';
    case 'kid': return 'Oof — watch the kids!';
    case 'wook': return 'You spooked a wook.';
    case 'stage': return 'That\'s the stage. Drive around it!';
    case 'arch': return 'Mind the arch.';
    default: return 'Ouch.';
  }
}

window.addEventListener('resize', () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  bloomPass.setSize(w, h);
});

// Debug hook for the preview pane.
window.__game = { camera, zerble, scene, renderer };

tick();
