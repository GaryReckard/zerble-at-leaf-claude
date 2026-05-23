// Bootstraps three.js, runs the game loop, owns scene/postprocessing/collision/scoring.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { Input } from './input.js';
import { HUD } from './hud.js';
import { buildWorld, updateWorld } from './world.js';
import { Zerble } from './zerble.js';
import { Bubbles } from './bubbles.js';
import { Smiles } from './smiles.js';
import { Crowd } from './crowd.js';
import { ChaseCamera } from './camera.js';
import { registry } from './registry.js';
import {
  PuppetParade,
  BrassBand,
  KidGaggle,
  Wooks,
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
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.5, 1500);

// ---------- Post-processing ----------
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.6, 0.85, 0.78
);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

// ---------- Zerble + Smiles + Bubbles ----------
const zerble = new Zerble();
zerble.position.set(0, 0, 65);
zerble.heading = 0;
scene.add(zerble.root);

const bubbles = new Bubbles();
scene.add(bubbles.mesh);

const smiles = new Smiles();
scene.add(smiles.group);

// ---------- Crowd (before world so chunks can spawn into it) ----------
const crowd = new Crowd(smiles);
scene.add(crowd.group);

// ---------- World (sky/lights/ground/mountains + chunk manager) ----------
buildWorld(scene, crowd);

// ---------- Moving obstacles (global — not chunk-bound) ----------
const puppets = new PuppetParade();
scene.add(puppets.group);
const band = new BrassBand();
scene.add(band.group);
const kids = new KidGaggle();
scene.add(kids.group);
const wooks = new Wooks();
scene.add(wooks.group);

// ---------- Camera ----------
const chaseCam = new ChaseCamera(camera, zerble);

// ---------- Honk ring ----------
const honkRing = new THREE.Mesh(
  new THREE.RingGeometry(0.5, 0.55, 48),
  new THREE.MeshBasicMaterial({
    color: 0xffd28a, transparent: true, opacity: 0,
    side: THREE.DoubleSide, depthWrite: false,
  })
);
honkRing.rotation.x = -Math.PI / 2;
scene.add(honkRing);
let honkAge = 999;

// ---------- HUD ----------
let score = 0;
HUD.loadBest();
let running = false;

HUD.showTitle();
HUD.onStart(() => {
  HUD.hideTitle();
  running = true;
  HUD.toast('Drive around — make people smile, dodge the parade.', 2800);
});

// ---------- Game loop ----------
const clock = new THREE.Clock();

function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);

  if (running) {
    zerble.update(dt, Input);

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

    // Procedural world expands around Zerble.
    updateWorld(zerble.position);

    // Collisions: iterate everything in the registry.
    if (zerble.invulnLeft <= 0) {
      for (const c of registry.colliders()) {
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
      // Movers (parade, band, kids, wooks) still own their own collider arrays.
      if (zerble.invulnLeft <= 0) {
        const moverSources = [puppets.colliders, band.colliders, kids.colliders, wooks.colliders];
        outer: for (const list of moverSources) {
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
              break outer;
            }
          }
        }
      }
    }

    // Honk ring expansion
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

  chaseCam.update(dt, Input);

  composer.render();
  requestAnimationFrame(tick);
}

function toastForKind(kind) {
  switch (kind) {
    case 'puppet': return 'A giant puppet bonked you!';
    case 'brass': return 'You blocked the brass band. Sorry, tuba.';
    case 'truck': return "Don't hit the food trucks!";
    case 'tent': return 'You knocked over a craft tent!';
    case 'kid': return 'Oof — watch the kids!';
    case 'wook': return 'You spooked a wook.';
    case 'stage': return "That's the stage. Drive around it!";
    case 'arch': return 'Mind the arch.';
    case 'lamppost': return 'Bonked a lamppost.';
    case 'drum_circle': return 'You crashed the drum circle!';
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

window.__game = { camera, zerble, scene, renderer, crowd, registry };
tick();
