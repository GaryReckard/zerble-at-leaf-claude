// Dev-only overlay + helpers. Toggle with backtick (`). All side-effects opt-in.
//
//   window.__debug.teleport(x, z)        — jump Zerble to xz
//   window.__debug.god(true|false)       — invincible
//   window.__debug.freezeNPCs(true|false)— pause crowd state machine
//   window.__debug.showColliders(true|false) — wire-ring viz over every collider
//   window.__debug.step(n=1)             — single-step the frame loop (when paused)
//   window.__debug.pause(true|false)     — freeze game time but keep camera live
//   window.__debug.dropSmile(n=10)       — spawn n smiles at Zerble for testing pickup
//   window.__debug.spawnNPC(n=20)        — force-spawn n watchers near Zerble

import * as THREE from 'three';

const PANEL_ID = 'debug-panel';
const COLLIDER_LAYER_NAME = '__debug_colliders';

const state = {
  visible: false,
  paused: false,
  pendingSteps: 0,
  god: false,
  freezeNPCs: false,
  showColliders: false,
  panelEl: null,
  rafSamples: [],
  lastSample: 0,
  hooks: null,
};

export function installDebug(hooks) {
  // hooks: { scene, camera, renderer, zerble, crowd, bubbles, smiles, registry,
  //          puppets, band, kids, wooks, chunkManagerRef, getRunning }
  state.hooks = hooks;
  buildPanel();
  bindKeys();
  window.__debug = api();
  // first paint
  updatePanel(0);
}

// Called from the game tick. Returns true if the body should run, false to skip
// (paused). `dt` is whatever the loop computed; we don't override it.
export function shouldRunFrame(dt) {
  sampleFPS(dt);
  if (state.visible) updatePanel(dt);
  if (state.showColliders) refreshColliderViz();
  if (!state.paused) return true;
  if (state.pendingSteps > 0) { state.pendingSteps--; return true; }
  return false;
}

export function isGod() { return state.god; }
export function npcsFrozen() { return state.freezeNPCs; }

// ---------------- internals ----------------

function api() {
  const h = state.hooks;
  return {
    teleport(x = 0, z = 0) {
      h.zerble.position.set(x, h.zerble.position.y, z);
      h.zerble.speed = 0;
    },
    god(on = true) { state.god = !!on; logToast(`god: ${state.god}`); },
    freezeNPCs(on = true) { state.freezeNPCs = !!on; logToast(`freezeNPCs: ${state.freezeNPCs}`); },
    showColliders(on = true) {
      state.showColliders = !!on;
      if (!on) clearColliderViz();
      logToast(`showColliders: ${state.showColliders}`);
    },
    pause(on = true) { state.paused = !!on; logToast(`paused: ${state.paused}`); },
    step(n = 1) { state.pendingSteps += Math.max(1, n | 0); },
    toggle() { state.visible = !state.visible; state.panelEl.style.display = state.visible ? 'block' : 'none'; },
    dropSmile(n = 10) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = 2 + Math.random() * 5;
        h.smiles.spawn(
          h.zerble.position.x + Math.cos(a) * r,
          h.zerble.position.z + Math.sin(a) * r
        );
      }
    },
    spawnNPC(n = 20) {
      // Crowd has a private spawner; we cheat by promoting idle NPCs near Zerble
      // into 'watching' state so they cluster on us.
      let promoted = 0;
      for (const npc of h.crowd.npcs) {
        if (promoted >= n) break;
        const dx = npc.pos.x - h.zerble.position.x;
        const dz = npc.pos.z - h.zerble.position.z;
        if (dx * dx + dz * dz > 60 * 60) continue;
        npc.state = 'watching';
        promoted++;
      }
      logToast(`promoted ${promoted} NPC(s) to watching`);
    },
  };
}

function buildPanel() {
  const el = document.createElement('div');
  el.id = PANEL_ID;
  Object.assign(el.style, {
    position: 'fixed',
    top: '8px',
    right: '8px',
    zIndex: '999',
    font: '11px/1.35 ui-monospace, Menlo, monospace',
    color: '#dff',
    background: 'rgba(8, 18, 28, 0.78)',
    padding: '8px 10px',
    borderRadius: '6px',
    border: '1px solid #2a4a5a',
    maxWidth: '260px',
    whiteSpace: 'pre',
    pointerEvents: 'none',
    display: 'none',
  });
  document.body.appendChild(el);
  state.panelEl = el;
}

function bindKeys() {
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Backquote') {
      e.preventDefault();
      window.__debug.toggle();
    }
    // Only-when-visible shortcuts (so they don't fight gameplay keys)
    if (!state.visible) return;
    if (e.code === 'KeyP') window.__debug.pause(!state.paused);
    if (e.code === 'Period' && state.paused) window.__debug.step(1);
    if (e.code === 'KeyC') window.__debug.showColliders(!state.showColliders);
    if (e.code === 'KeyG') window.__debug.god(!state.god);
    if (e.code === 'KeyF') window.__debug.freezeNPCs(!state.freezeNPCs);
  });
}

function sampleFPS(dt) {
  const now = performance.now();
  state.rafSamples.push(now);
  while (state.rafSamples.length && state.rafSamples[0] < now - 1000) state.rafSamples.shift();
}

function updatePanel(dt) {
  const h = state.hooks;
  const z = h.zerble;
  const cx = Math.floor(z.position.x / 80);
  const cz = Math.floor(z.position.z / 80);
  const fps = state.rafSamples.length;
  const npcs = h.crowd.npcs.length;
  const riders = h.crowd.npcs.filter(n => n.state === 'riding').length;
  const watching = h.crowd.npcs.filter(n => n.state === 'watching').length;
  const fleeing = h.crowd.npcs.filter(n => n.state === 'fleeing').length;
  const registryCount = h.registry.entries.size;
  const colliderCount = [...h.registry.colliders()].length;
  const running = h.getRunning();

  state.panelEl.textContent =
    `~ debug (P pause · . step · C colliders · G god · F freeze)\n` +
    `fps          ${fps}    ${state.paused ? '[PAUSED]' : ''}\n` +
    `running      ${running}\n` +
    `pos          ${z.position.x.toFixed(1)}, ${z.position.z.toFixed(1)}\n` +
    `heading      ${(z.heading * 180 / Math.PI).toFixed(0)}°  speed ${z.speed.toFixed(2)}\n` +
    `chunk        (${cx}, ${cz})\n` +
    `npcs         ${npcs}  riding ${riders}  watch ${watching}  flee ${fleeing}\n` +
    `registry     ${registryCount}  colliders ${colliderCount}\n` +
    `flags        god=${state.god} freezeNPCs=${state.freezeNPCs} colliderViz=${state.showColliders}`;
}

let _colliderGroup = null;
function refreshColliderViz() {
  const h = state.hooks;
  if (!_colliderGroup) {
    _colliderGroup = new THREE.Group();
    _colliderGroup.name = COLLIDER_LAYER_NAME;
    h.scene.add(_colliderGroup);
  }
  // Rebuild every frame — cheap enough for dev, avoids tracking dynamic colliders.
  while (_colliderGroup.children.length) {
    const c = _colliderGroup.children.pop();
    c.geometry?.dispose?.();
    c.material?.dispose?.();
  }
  const sources = [
    ...h.registry.colliders(),
    ...h.puppets.colliders,
    ...h.band.colliders,
    ...h.kids.colliders,
    ...h.wooks.colliders,
  ];
  for (const c of sources) addColliderRing(_colliderGroup, c.position.x, c.position.z, c.radius, 0xff7766);
  // crowd NPCs use a synthetic radius (must match main.js)
  for (const n of h.crowd.npcs) {
    if (n.state === 'riding') continue;
    const dx = n.pos.x - h.zerble.position.x;
    const dz = n.pos.z - h.zerble.position.z;
    if (dx * dx + dz * dz > 30 * 30) continue;
    addColliderRing(_colliderGroup, n.pos.x, n.pos.z, 0.45, 0x66cc88);
  }
  // Zerble's own collider
  addColliderRing(_colliderGroup, h.zerble.position.x, h.zerble.position.z, h.zerble.radius, 0xffe066);
}

function clearColliderViz() {
  if (!_colliderGroup) return;
  state.hooks.scene.remove(_colliderGroup);
  while (_colliderGroup.children.length) {
    const c = _colliderGroup.children.pop();
    c.geometry?.dispose?.();
    c.material?.dispose?.();
  }
  _colliderGroup = null;
}

function addColliderRing(parent, x, z, r, color) {
  const geo = new THREE.RingGeometry(Math.max(0.05, r - 0.04), r, 24);
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false });
  const m = new THREE.Mesh(geo, mat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, 0.05, z);
  parent.add(m);
}

function logToast(msg) {
  // best-effort; HUD may not be loaded yet
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.remove('hidden');
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 900);
}
