// Bootstraps three.js, runs the game loop, owns scene/postprocessing/collision/scoring.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { Input } from './input.js';
import { Touch } from './touch.js';
import { HUD } from './hud.js';
import { buildWorld, updateWorld, getTimeOfDay } from './world.js';
import { forestAnimatables, forestDrumCircles, forestDrumMusic } from './forests.js';
import { lakeAnimatables } from './lakes.js';
import { updateCampsiteProps } from './models/campsite.js';
import { updateLeafDrumCircle } from './models/leafDrumCircle.js';
import { updateTribalFigures } from './models/tribalFigures.js';
import { updateStagePerformers, updateStageLightShow, stageLightLenses } from './chunks.js';
import { Zerble } from './zerble.js';
import { Bubbles } from './bubbles.js';
import { Smiles } from './smiles.js';
import { Crowd } from './crowd.js';
import { Lurleen } from './lurleen.js';
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
import { Trip } from './trip.js';
import { Analytics } from './analytics.js';
import * as ContextLights from './contextLights.js';

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
  new THREE.Vector2(window.innerWidth * 0.5, window.innerHeight * 0.5),
  PERF.bloomStrength, PERF.bloomRadius, PERF.bloomThreshold
);
// On the low profile we keep bloom but pass-through if it ever needs to be killed:
// set `bloomPass.enabled = false` to fall back to the plain render.
if (!PERF.bloom) bloomPass.enabled = false;
composer.addPass(bloomPass);
// Trip ShaderPass sits between bloom and output. At intensity=0 it's a no-op.
Trip.init();
composer.addPass(Trip.pass);
composer.addPass(new OutputPass());

// ---------- Wook offer prompt + trip narration wiring ----------
//
// The trip system fires onOffer/onAccept/onDecline around the wook offer
// flow, and onNarrate periodically during an active trip. We hook those to
// HUD toasts here. Keeping the copy in main.js means the trip module stays
// game-agnostic (no HUD imports inside it).
const WOOK_OFFER_TEXTS = [
  "🌿 the wook smiles and extends a hand... tap to accept",
  "🌿 the wook offers you something. tap to take it",
  "🌿 the wook is sharing the vibe. tap to receive",
  "🌿 the wook nods knowingly. tap to partake",
];
const WOOK_DECLINE_TEXTS = {
  moved:     "the wook watches you drive away",
  wook_gone: "the wook wanders off",
  timeout:   "the wook shrugs and drifts back to the circle",
};
const TRIP_NARRATIVE_TEXTS = [
  "the trees seem to be breathing",
  "you can taste the bass",
  "everything is connected, somehow",
  "is the sky usually that color?",
  "you forgot what you were doing",
  "a wook is watching from the trees",
  "the path is humming",
  "your hands feel like ideas",
  "the festival is alive",
  "time is doing that thing again",
  "you remember a song from before you were born",
  "the bubbles know your name",
  "the mountains are nodding along",
];
Trip.onOffer = () => {
  const msg = WOOK_OFFER_TEXTS[Math.floor(Math.random() * WOOK_OFFER_TEXTS.length)];
  // Toast is tappable so touch devices can accept. Desktop players can still
  // hit Y — both paths route through Trip.acceptOffer() and the toast clears
  // either way (a Y press replaces the toast via Trip.onAccept).
  HUD.toast(msg, 9000, {
    onTap: () => {
      if (Trip.state === 'awaiting_confirm') Trip.acceptOffer();
    },
  });
};
Trip.onAccept = () => {
  HUD.toast("...", 1500);
};
Trip.onDecline = (reason) => {
  const msg = WOOK_DECLINE_TEXTS[reason] || "the moment passes";
  HUD.toast(msg, 2000);
};
Trip.onNarrate = () => {
  const msg = TRIP_NARRATIVE_TEXTS[Math.floor(Math.random() * TRIP_NARRATIVE_TEXTS.length)];
  HUD.toast(msg, 3200);
};

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

// ---------- Lurleen (love interest, persistent across the world) ----------
const lurleen = new Lurleen(scene);
let lurleenMet = false;     // first-contact toast latch

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

// Touch + mouse cam toggle button — same as pressing V. Cycles through
// chase → first-person → top-down → chase.
const btnCam = document.getElementById('btn-cam');
if (btnCam) {
  const toggle = (e) => {
    e.preventDefault();
    chaseCam.toggleMode();
    HUD.toast(chaseCam.modeLabel, 1500);
  };
  btnCam.addEventListener('click', toggle);
  btnCam.addEventListener('touchstart', toggle, { passive: false });
}

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
  Analytics.gameStart();
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

  // Audio debug surfaced on-screen: ?sounddebug=1 in the URL pops a compact
  // toast a beat after Start with the unlock state, so we can diagnose iOS
  // audio without Safari Web Inspector. The promise resolutions land on the
  // next microtask, hence the short delay.
  if (new URLSearchParams(location.search).get('sounddebug') === '1') {
    setTimeout(() => {
      const d = Sound.diagnostics();
      const ms = d.restoredFromLocalStorage.master;
      const msg =
        `ctx ${d.live.ctxState} ` +
        `m${(d.live.masterGain ?? 0).toFixed(2)} ` +
        `html ${d.htmlUnlockPlayResolved ? '✓' : (d.htmlUnlockPlayRejected ? '✗' : '?')} ` +
        `buf ${d.webAudioBufferUnlocked ? '✓' : '✗'} ` +
        `rate ${d.live.ctxSampleRate}` +
        (ms ? ` LS:${ms.raw}→${ms.applied}` : '');
      HUD.toast(msg, 9000);
    }, 250);
  }
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
    const tod = getTimeOfDay();
    const nightness = tod ? tod.nightness : 0;
    zerble.update(dt, Input, nightness);
    Sound.setEngineSpeed(zerble.speed, zerble.isBoosting ? 1 : 0);
    // Push nightness into the audio module so the forest drum engine can
    // gate voices + the crackling-fire bed against the day/night cycle.
    Sound.setNightness(nightness);

    // SPACE = random honk (bell or clown). B = always bell. H = always clown.
    // All three share the honk ring + crowd reaction + cooldown.
    const spaceHonk = Input.consumePressed('SPACE');
    const bellHonk  = Input.consumePressed('B');
    const hornHonk  = Input.consumePressed('H');
    if ((spaceHonk || bellHonk || hornHonk) && zerble.canHonk()) {
      zerble.honk();
      honkAge = 0;
      crowd.applyHonk(zerble);
      if (bellHonk)      Sound.playBicycleBell();
      else if (hornHonk) Sound.playClownHorn();
      else               Sound.playHonk();   // SPACE → random
      Analytics.firstHonk();
    }

    // V cycles camera modes: chase → first-person → top-down → chase.
    if (Input.consumePressed('V')) {
      chaseCam.toggleMode();
      HUD.toast(chaseCam.modeLabel + ' (V to cycle)', 1500);
      Analytics.viewToggle(chaseCam.mode);
    }

    // Y accepts a pending wook trip offer. Outside of awaiting_confirm the
    // press is consumed silently — Y has no other binding so this is fine.
    if (Input.consumePressed('Y')) {
      if (Trip.state === 'awaiting_confirm') Trip.acceptOffer();
    }

    bubbles.update(dt, zerble, nightness);
    if (!npcsFrozen()) crowd.update(dt, zerble, bubbles);
    smiles.update(dt, zerble, (n) => {
      score += n;
      HUD.setSmiles(score);
      HUD.saveBest(score);
      Analytics.smileScore(score);
      Analytics.personalBest(score);
    });

    puppets.update(dt);
    band.update(dt);
    kids.update(dt, bubbles, zerble);
    wooks.update(dt, zerble.position, Math.abs(zerble.speed));
    // Collect wook world positions for proximity detection
    const _wookPositions = wooks.wooks.map(w => w.position);
    Trip.update(dt, zerble.position, Math.abs(zerble.speed), _wookPositions);
    lurleen.update(dt, zerble.position);
    if (!lurleenMet && lurleen.state === 'aware') {
      lurleenMet = true;
      HUD.toast('You found Lurleen! 💗', 3500);
      Analytics.lurleenFound();
    }
    const nowS = performance.now() * 0.001;
    updateStagePerformers(nowS);
    updateStageLightShow(nowS, nightness, zerble.position);

    // Campsite props (firepit ember pulse + tiki torch flicker) for both
    // forest-clearing campsites and lakeside ones. Two separate lists owned
    // by their respective systems (chunk vs lake lifecycle); single update fn.
    for (let i = 0; i < forestAnimatables.length; i++) {
      updateCampsiteProps(nowS, nightness, forestAnimatables[i].animatables);
    }
    for (let i = 0; i < lakeAnimatables.length; i++) {
      updateCampsiteProps(nowS, nightness, lakeAnimatables[i].animatables);
    }
    // LEAF drum-circle fire pulse + PointLight flicker + tribal figures
    // (drummers bobbing, dancers orbiting, firekeeper poking the fire).
    // One updater call set per visible drum circle.
    for (let i = 0; i < forestDrumCircles.length; i++) {
      const entry = forestDrumCircles[i];
      updateLeafDrumCircle(nowS, nightness, entry.dc);
      if (entry.figures && entry.figures.length > 0) {
        updateTribalFigures(nowS, nightness, entry.figures);
      }
    }
    // Forest drum-circle audio lowpass — woods absorb the highs as the
    // player drives away from the fire. Inside body = 14kHz (wide open).
    // Past the perimeter, cutoff ramps down to ~2.5kHz over the next 250m.
    for (let i = 0; i < forestDrumMusic.length; i++) {
      const entry = forestDrumMusic[i];
      if (!entry.handle?.setLowpassCutoff) continue;
      const dx = zerble.position.x - entry.centerX;
      const dz = zerble.position.z - entry.centerZ;
      const dist = Math.hypot(dx, dz);
      // outsideness in [0, 1] over 250m past the body perimeter.
      const r = entry.bodyRadius || 100;
      const outsideness = Math.max(0, Math.min(1, (dist - r) / 250));
      const cutoff = 14000 * (1 - outsideness) + 2500 * outsideness;
      entry.handle.setLowpassCutoff(cutoff);
    }

    // Procedural world expands around Zerble.
    updateWorld(zerble.position, dt);

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
        Analytics.collision(hit.kind);
      } else if (hit && hit.notify) {
        // Non-damaging but worth surfacing — e.g. Zerble bumps into Lurleen.
        HUD.toast(toastForKind(hit.kind), 1400);
        Sound.playSoftBump();
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

  // Distance-cull proxy lights (campsite firepits, drum circles, Sugar
  // Shack spots, etc). Anything past ~40m from the player is turned off
  // so it doesn't pay the per-fragment lighting cost in the shader. Per
  // threejs-lighting skill's "limit light count" guidance.
  ContextLights.update(zerble.position);

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
    // Passive colliders (e.g. the wook walking up to dose Zerble) are visible
    // but don't push Zerble or deal damage — otherwise their physical radius
    // would prevent Zerble from being inside the proximity trigger range.
    if (c.passive) continue;
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
      // Damage > 0 means "deduct smiles". Damage 0 entries (e.g. Lurleen, a
      // fleeing NPC) still need the bounce we just applied, plus a toast/SFX
      // for the named ones — return `notify` so the caller can react.
      const damaging = c.damage > 0;
      const notify = !damaging && (c.kind === 'lurleen');
      return { damaging, damage: c.damage, kind: c.kind, notify };
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
    case 'forest_tree': return 'Ow — that\'s a big tree!';
    case 'firepit': return 'Hot stone, ouch!';
    case 'bench_ring': return 'Easy on the benches!';
    case 'island': return 'Tiny island, busy day.';
    case 'lurleen': return 'Easy, lover — that\'s Lurleen.';
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
  bloomPass.setSize(w * 0.5, h * 0.5);
}
window.addEventListener('resize', handleResize);
window.addEventListener('orientationchange', () => {
  // iOS often reports the wrong dimensions on the synchronous event; defer.
  setTimeout(handleResize, 250);
});
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', handleResize);
}

window.__game = {
  camera, zerble, scene, renderer, crowd, registry, chaseCam, lurleen,
  getTimeOfDay, Trip,
  sound: Sound,
};

installDebug({
  scene, camera, renderer,
  zerble, crowd, bubbles, smiles, registry,
  puppets, band, kids, wooks,
  lurleen,                              // teleport menu uses .position
  getRunning: () => running,
  getTimeOfDay,
  Trip,
});

tick();
