// Bootstraps three.js, runs the game loop, owns scene/postprocessing/collision/scoring.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { Input } from './input.js';
import { Touch } from './touch.js';
import { HUD } from './hud.js';
import { buildWorld, updateWorld } from './world.js';
import { updateStagePerformers } from './chunks.js';
import { Zerble } from './zerble.js';
import { Bubbles } from './bubbles.js';
import { Smiles } from './smiles.js';
import { Crowd } from './crowd.js';
import { ChaseCamera } from './camera.js';
import { registry } from './registry.js';
import { Sound } from './sound.js';
import {
  PuppetParade,
  BrassBand,
  KidGaggle,
  Wooks,
} from './obstacles.js';
import { installDebug, shouldRunFrame, isGod, npcsFrozen } from './debug.js';
import { PERF } from './perf.js';

const canvas = document.getElementById('game');

// ---------- Renderer ----------
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, PERF.pixelRatioCap));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = PERF.shadows;
renderer.shadowMap.type = PERF.shadowType === 'soft' ? THREE.PCFSoftShadowMap : THREE.BasicShadowMap;
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
  PERF.bloomStrength, PERF.bloomRadius, PERF.bloomThreshold
);
// On the low profile we keep bloom but pass-through if it ever needs to be killed:
// set `bloomPass.enabled = false` to fall back to the plain render.
if (!PERF.bloom) bloomPass.enabled = false;
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

// Touch overlay (no-op on desktop; reveals thumbstick/buttons on touch devices).
Touch.install();

// iOS Safari still fires deprecated GestureEvents for pinch — those can zoom
// the page even with user-scalable=no. Swallow them so the canvas stays
// locked to 1.0 scale.
['gesturestart', 'gesturechange', 'gestureend'].forEach((ev) => {
  document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
});
// Block the iOS double-tap-to-zoom on the canvas + HUD.
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });

HUD.showTitle();
HUD.onStart(() => {
  HUD.hideTitle();
  running = true;
  // Sound.init() MUST run synchronously inside the tap handler on iOS — any
  // await/setTimeout boundary loses the "user gesture" status and the
  // AudioContext starts suspended (silent).
  Sound.init();
  // Reveal the touch overlay only now (avoids ghost controls behind the
  // title-card's backdrop-filter) and mark it as the active control surface
  // for assistive tech.
  document.body.classList.add('game-started');
  const tc = document.getElementById('touch-controls');
  if (tc) tc.setAttribute('aria-hidden', 'false');
  HUD.toast('Drive around — make people smile, dodge the parade.', 2800);
});

// iOS suspends the AudioContext on tab switch / device lock. Resume on return.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) Sound.resume();
});
window.addEventListener('pageshow', () => Sound.resume());
// Belt-and-suspenders: any touch/click after we're running revives audio if
// iOS dropped it for a reason we didn't see (route changes, headset unplug).
function audioRecover() { if (running) Sound.resume(); }
window.addEventListener('pointerdown', audioRecover);
window.addEventListener('touchstart', audioRecover, { passive: true });

// ---------- Game loop ----------
const clock = new THREE.Clock();
const _camFwd = new THREE.Vector3();

function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (shouldRunFrame(dt)) tickBody(dt);
  scheduleNext();
}

function tickBody(dt) {
  if (running) {
    zerble.update(dt, Input);
    Sound.setEngineSpeed(zerble.speed);

    if (Input.consumePressed('SPACE') && zerble.canHonk()) {
      zerble.honk();
      honkAge = 0;
      crowd.applyHonk(zerble);
      Sound.playHonk();
    }

    bubbles.update(dt, zerble);
    if (!npcsFrozen()) crowd.update(dt, zerble, bubbles);
    smiles.update(dt, zerble, (n) => {
      score += n;
      HUD.setSmiles(score);
      HUD.saveBest(score);
    });

    puppets.update(dt);
    band.update(dt);
    kids.update(dt);
    wooks.update(dt);
    updateStagePerformers(performance.now() * 0.001);

    // Procedural world expands around Zerble.
    updateWorld(zerble.position);

    // Collisions: deduct smiles only when Zerble is actively driving into the obstacle.
    // If something brushes a stationary Zerble, just resolve the overlap silently.
    if (zerble.invulnLeft <= 0) {
      // Build a per-frame collider list for nearby crowd NPCs so Zerble can actually
      // bump them. Skip riders + anyone more than 5m away (cheap broad-phase reject).
      const npcColliders = [];
      const broadphaseR2 = 36; // 6m broadphase
      for (const n of crowd.npcs) {
        if (n.state === 'riding' || n.state === 'boarding') continue;
        const dx = n.pos.x - zerble.position.x;
        const dz = n.pos.z - zerble.position.z;
        if (dx * dx + dz * dz > broadphaseR2) continue;
        // Already fleeing? They were trying to get out of the way — overlap-resolve
        // silently. We do this by leaving damage at 0 and relying on the approach-
        // threshold logic to either nudge or skip.
        const alreadyFleeing = n.state === 'fleeing';
        npcColliders.push({
          position: { x: n.pos.x, y: 0.85, z: n.pos.z },
          radius: 0.45,
          damage: alreadyFleeing ? 0 : 1,
          kind: 'person',
          npc: n,
        });
      }
      const allColliders = [
        ...registry.colliders(),
        ...puppets.colliders,
        ...band.colliders,
        ...kids.colliders,
        ...wooks.colliders,
        ...npcColliders,
      ];
      const hit = resolveCollision(zerble, allColliders);
      if (hit && hit.damaging && !isGod()) {
        score = Math.max(0, score - hit.damage);
        HUD.setSmiles(score);
        HUD.flashHit();
        HUD.toast(toastForKind(hit.kind), 1400);
        Sound.playCollision(hit.kind);
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

  // Keep spatial audio in sync with the camera
  camera.getWorldDirection(_camFwd);
  Sound.updateAudioListener(
    camera.position.x, camera.position.y, camera.position.z,
    _camFwd.x, _camFwd.y, _camFwd.z
  );

  composer.render();
}

// RAF is throttled to ~0 fps when the tab is backgrounded (e.g. the Claude
// Preview MCP runs the page document.hidden). Fall back to setTimeout in that
// case so the game keeps ticking and the preview tools see real motion.
function scheduleNext() {
  if (document.hidden) setTimeout(tick, 16);
  else requestAnimationFrame(tick);
}

// Threshold: Zerble must be closing on the obstacle at least this fast (m/s) for it
// to count as "driving into" — anything below this is a glancing/passive touch.
const APPROACH_DAMAGE_THRESHOLD = 1.2;

function resolveCollision(zerble, colliders) {
  // forward = (-sin(h), 0, -cos(h)); velocity = forward * speed
  const fx = -Math.sin(zerble.heading);
  const fz = -Math.cos(zerble.heading);
  const velX = fx * zerble.speed;
  const velZ = fz * zerble.speed;

  for (const c of colliders) {
    const tox = c.position.x - zerble.position.x;
    const toz = c.position.z - zerble.position.z;
    const d = Math.hypot(tox, toz);
    const minD = c.radius + zerble.radius;
    if (d >= minD) continue;

    const inv = 1 / (d || 0.0001);
    const approachSpeed = (velX * tox + velZ * toz) * inv;

    if (approachSpeed > APPROACH_DAMAGE_THRESHOLD) {
      // Damaging — Zerble is driving into it
      const pushDir = new THREE.Vector3(-tox * inv, 0, -toz * inv);
      zerble.applyHit(pushDir);
      // NPC-specific reaction: panic, knockback, infect neighbors.
      if (c.kind === 'person' && c.npc) {
        crowd.onZerbleHit(c.npc, tox * inv, toz * inv);
      }
      // If c.damage is 0 (e.g. fleeing NPC), treat as non-damaging.
      return { damaging: c.damage > 0, damage: c.damage, kind: c.kind };
    }

    // Non-damaging contact: nudge Zerble out of overlap, kill any small approach speed.
    const overlap = minD - d;
    zerble.position.x -= tox * inv * overlap;
    zerble.position.z -= toz * inv * overlap;
    if (approachSpeed > 0 && zerble.speed > 0) {
      zerble.speed = Math.max(0, zerble.speed - approachSpeed * 0.6);
    }
    return { damaging: false };
  }
  return null;
}

function toastForKind(kind) {
  switch (kind) {
    case 'puppet': return 'A giant puppet bonked you!';
    case 'brass': return 'You blocked the brass band. Sorry, tuba.';
    case 'truck': return "Don't hit the food trucks!";
    case 'tent': return 'You knocked over a craft tent!';
    case 'kid': return 'Oof — watch the kids!';
    case 'wook': return 'You spooked a wook.';
    case 'person': return 'Watch where you\'re going!';
    case 'stage': return "That's the stage. Drive around it!";
    case 'arch': return 'Mind the arch.';
    case 'lamppost': return 'Bonked a lamppost.';
    case 'drum_circle': return 'You crashed the drum circle!';
    case 'lake_edge': return 'Splash! Carts don\'t float.';
    case 'island': return 'Tiny island, busy day.';
    default: return 'Ouch.';
  }
}

function handleResize() {
  // visualViewport reports the *actual visible area* on iOS Safari, which
  // shrinks/grows as the URL bar appears/disappears. Fall back to innerWidth.
  const vv = window.visualViewport;
  const w = Math.round((vv && vv.width) || window.innerWidth);
  const h = Math.round((vv && vv.height) || window.innerHeight);
  // Use default updateStyle=true so the canvas's inline width/height tracks
  // the viewport. Mixing default-true at boot with false here used to leave
  // the canvas displayed at boot dimensions after the URL bar collapsed.
  renderer.setSize(w, h);
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  bloomPass.setSize(w, h);
}
window.addEventListener('resize', handleResize);
window.addEventListener('orientationchange', () => {
  // iOS often reports the wrong dimensions on the synchronous event; defer.
  setTimeout(handleResize, 250);
});
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', handleResize);
}

window.__game = { camera, zerble, scene, renderer, crowd, registry, chaseCam };

installDebug({
  scene, camera, renderer,
  zerble, crowd, bubbles, smiles, registry,
  puppets, band, kids, wooks,
  getRunning: () => running,
});

tick();
