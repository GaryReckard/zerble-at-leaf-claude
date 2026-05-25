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
import { Sound } from './sound.js';

const PANEL_ID = 'debug-panel';
const TRIP_PANEL_ID = 'trip-panel';
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
  // Trip panel
  tripVisible: false,
  tripPanelEl: null,
  tripStateEl: null,
  tripSliders: {},
};

export function installDebug(hooks) {
  // hooks: { scene, camera, renderer, zerble, crowd, bubbles, smiles, registry,
  //          puppets, band, kids, wooks, chunkManagerRef, getRunning, Trip }
  state.hooks = hooks;
  buildPanel();
  buildTripPanel();
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
  if (state.tripVisible) updateTripPanel();
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
    background: 'rgba(8, 18, 28, 0.85)',
    padding: '8px 10px',
    borderRadius: '6px',
    border: '1px solid #2a4a5a',
    maxWidth: '280px',
    pointerEvents: 'auto',  // need clicks for the sliders
    display: 'none',
  });

  // Text readout (pre-formatted)
  const text = document.createElement('div');
  text.style.whiteSpace = 'pre';
  el.appendChild(text);
  state.textEl = text;

  // ----- Keybindings cheat sheet -----
  const helpBlock = document.createElement('div');
  helpBlock.style.marginTop = '8px';
  helpBlock.style.borderTop = '1px solid #2a4a5a';
  helpBlock.style.paddingTop = '6px';
  helpBlock.style.fontSize = '11px';
  helpBlock.style.lineHeight = '1.5';
  helpBlock.innerHTML = `
    <div style="margin-bottom:4px;opacity:0.7">Controls</div>
    <div><b>W A S D</b> drive · <b>Shift</b> boost · <b>Space</b> honk</div>
    <div><b>← ↑ ↓ →</b> orbit/tilt camera</div>
    <div><b>V</b> first-person / chase view</div>
    <div><b>I</b> / <b>O</b> eye glow brighter / dimmer</div>
    <div><b>\`</b> toggle this debug panel</div>
    <div><b>T</b> toggle trip/psychedelic debug panel</div>
  `;
  el.appendChild(helpBlock);

  // ----- Time-of-day controls -----
  // A horizontal slider 0..1 maps to TimeOfDay.t. Three preset shortcut
  // buttons jump to common times.
  const todBlock = document.createElement('div');
  todBlock.style.marginTop = '8px';
  todBlock.style.borderTop = '1px solid #2a4a5a';
  todBlock.style.paddingTop = '6px';
  todBlock.innerHTML = `
    <div style="margin-bottom:4px;opacity:0.7">Time of day <span id="dbg-tod-readout" style="float:right"></span></div>
    <input id="dbg-tod-slider" type="range" min="0" max="1" step="0.001" value="0.15"
      style="width:100%;accent-color:#ffe066;cursor:pointer" />
    <div style="display:flex;gap:4px;margin-top:6px">
      <button data-t="0.10" class="dbg-tod-preset">Morning</button>
      <button data-t="0.30" class="dbg-tod-preset">Noon</button>
      <button data-t="0.50" class="dbg-tod-preset">Dusk</button>
      <button data-t="0.75" class="dbg-tod-preset">Midnight</button>
    </div>
  `;
  el.appendChild(todBlock);

  document.body.appendChild(el);

  // Wire slider + buttons to the timeOfDay hook (which may be null until
  // world.js finishes booting — getTimeOfDay() resolves lazily).
  const slider = todBlock.querySelector('#dbg-tod-slider');
  const readout = todBlock.querySelector('#dbg-tod-readout');
  state.todSlider = slider;
  state.todReadout = readout;
  slider.addEventListener('input', () => {
    const tod = state.hooks.getTimeOfDay && state.hooks.getTimeOfDay();
    if (tod) tod.setT(parseFloat(slider.value));
  });
  for (const btn of todBlock.querySelectorAll('.dbg-tod-preset')) {
    Object.assign(btn.style, {
      flex: '1', font: 'inherit', padding: '3px 4px', cursor: 'pointer',
      background: 'rgba(255,224,102,0.15)', color: 'inherit',
      border: '1px solid rgba(255,224,102,0.4)', borderRadius: '4px',
    });
    btn.addEventListener('click', () => {
      const t = parseFloat(btn.dataset.t);
      const tod = state.hooks.getTimeOfDay && state.hooks.getTimeOfDay();
      if (tod) { tod.setT(t); slider.value = t; }
    });
  }

  // ----- Audio volume controls -----
  const audioBlock = document.createElement('div');
  audioBlock.style.marginTop = '8px';
  audioBlock.style.borderTop = '1px solid #2a4a5a';
  audioBlock.style.paddingTop = '6px';

  const masterVol = Sound.isReady() ? Sound.getMasterVolume() : 0.55;
  const musicVol  = Sound.isReady() ? Sound.getMusicVolume()  : 1.6;
  const sfxVol    = Sound.isReady() ? Sound.getSfxVolume()    : 1.0;

  audioBlock.innerHTML = `
    <div style="margin-bottom:4px;opacity:0.7">Audio</div>
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
      <span style="width:48px;opacity:0.8">Master</span>
      <input id="dbg-vol-master" type="range" min="0" max="2" step="0.01" value="${masterVol.toFixed(2)}"
        style="flex:1;accent-color:#ffe066;cursor:pointer" />
      <span id="dbg-vol-master-readout" style="width:32px;text-align:right">${masterVol.toFixed(2)}</span>
    </div>
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
      <span style="width:48px;opacity:0.8">Music</span>
      <input id="dbg-vol-music" type="range" min="0" max="2" step="0.01" value="${musicVol.toFixed(2)}"
        style="flex:1;accent-color:#ffe066;cursor:pointer" />
      <span id="dbg-vol-music-readout" style="width:32px;text-align:right">${musicVol.toFixed(2)}</span>
    </div>
    <div style="display:flex;align-items:center;gap:6px">
      <span style="width:48px;opacity:0.8">SFX</span>
      <input id="dbg-vol-sfx" type="range" min="0" max="2" step="0.01" value="${sfxVol.toFixed(2)}"
        style="flex:1;accent-color:#ffe066;cursor:pointer" />
      <span id="dbg-vol-sfx-readout" style="width:32px;text-align:right">${sfxVol.toFixed(2)}</span>
    </div>
  `;
  el.appendChild(audioBlock);

  // Wire audio sliders
  audioBlock.querySelector('#dbg-vol-master').addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    Sound.setMasterVolume(v);
    audioBlock.querySelector('#dbg-vol-master-readout').textContent = v.toFixed(2);
  });
  audioBlock.querySelector('#dbg-vol-music').addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    Sound.setMusicVolume(v);
    audioBlock.querySelector('#dbg-vol-music-readout').textContent = v.toFixed(2);
  });
  audioBlock.querySelector('#dbg-vol-sfx').addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    Sound.setSfxVolume(v);
    audioBlock.querySelector('#dbg-vol-sfx-readout').textContent = v.toFixed(2);
  });

  state.panelEl = el;
}

function bindKeys() {
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Backquote') {
      e.preventDefault();
      window.__debug.toggle();
    }
    // T key: toggle Trip debug panel (works any time, not just when debug is open)
    if (e.code === 'KeyT' && !e.target.matches('input, textarea, select')) {
      e.preventDefault();
      toggleTripPanel();
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

function toggleTripPanel() {
  state.tripVisible = !state.tripVisible;
  if (state.tripPanelEl) {
    state.tripPanelEl.style.display = state.tripVisible ? 'block' : 'none';
  }
  if (state.tripVisible) updateTripPanel();
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

  const tod = h.getTimeOfDay && h.getTimeOfDay();
  const todStr = tod
    ? `t=${tod.t.toFixed(2)} night=${tod.nightness.toFixed(2)}`
    : 'n/a';

  state.textEl.textContent =
    `~ debug (P pause · . step · C colliders · G god · F freeze)\n` +
    `fps          ${fps}    ${state.paused ? '[PAUSED]' : ''}\n` +
    `running      ${running}\n` +
    `pos          ${z.position.x.toFixed(1)}, ${z.position.z.toFixed(1)}\n` +
    `heading      ${(z.heading * 180 / Math.PI).toFixed(0)}°  speed ${z.speed.toFixed(2)}\n` +
    `chunk        (${cx}, ${cz})\n` +
    `npcs         ${npcs}  riding ${riders}  watch ${watching}  flee ${fleeing}\n` +
    `registry     ${registryCount}  colliders ${colliderCount}\n` +
    `time of day  ${todStr}\n` +
    `flags        god=${state.god} freezeNPCs=${state.freezeNPCs} colliderViz=${state.showColliders}`;

  // Keep the slider in sync if t advances naturally — but don't fight the
  // user mid-drag.
  if (tod && state.todSlider && document.activeElement !== state.todSlider) {
    state.todSlider.value = String(tod.t);
    if (state.todReadout) state.todReadout.textContent = todStr;
  }
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

// ---- Trip panel ----

function buildTripPanel() {
  const Trip = state.hooks.Trip;
  if (!Trip) return;

  const el = document.createElement('div');
  el.id = TRIP_PANEL_ID;
  Object.assign(el.style, {
    position: 'fixed',
    bottom: '8px',
    left: '8px',
    zIndex: '999',
    font: '11px/1.4 ui-monospace, Menlo, monospace',
    color: '#dff',
    background: 'rgba(8, 18, 28, 0.88)',
    padding: '8px 10px',
    borderRadius: '6px',
    border: '1px solid #2a4a5a',
    maxWidth: '300px',
    pointerEvents: 'auto',
    display: 'none',
    userSelect: 'none',
  });

  // Title
  const title = document.createElement('div');
  title.textContent = 'T  Trip (psychedelic)';
  title.style.cssText = 'opacity:0.7;margin-bottom:6px;';
  el.appendChild(title);

  // State readout
  const stateEl = document.createElement('pre');
  stateEl.style.cssText = 'margin:0 0 6px;white-space:pre;';
  stateEl.textContent = 'state: idle | env: 0.00 | wook: — m';
  el.appendChild(stateEl);
  state.tripStateEl = stateEl;

  // Divider helper
  const divider = () => {
    const d = document.createElement('div');
    d.style.cssText = 'border-top:1px solid #2a4a5a;margin:6px 0;';
    return d;
  };

  // Presets row
  el.appendChild(divider());
  const presetsRow = document.createElement('div');
  presetsRow.style.cssText = 'display:flex;gap:4px;margin-bottom:6px;';
  for (const [label, name] of [['Microdose', 'microdose'], ['Standard', 'standard'], ['Full trip', 'full']]) {
    const btn = document.createElement('button');
    btn.textContent = label;
    Object.assign(btn.style, {
      flex: '1', font: 'inherit', padding: '3px 4px', cursor: 'pointer',
      background: 'rgba(255,224,102,0.15)', color: 'inherit',
      border: '1px solid rgba(255,224,102,0.4)', borderRadius: '4px',
    });
    btn.addEventListener('click', () => {
      Trip.setPreset(name);
      // Sync sliders to new config values
      syncSlidersFromConfig();
    });
    presetsRow.appendChild(btn);
  }
  el.appendChild(presetsRow);

  // Fire button
  const fireBtn = document.createElement('button');
  fireBtn.textContent = 'FIRE TRIP';
  Object.assign(fireBtn.style, {
    width: '100%', font: 'inherit', padding: '4px 6px', cursor: 'pointer',
    background: 'rgba(255,100,100,0.25)', color: '#fdd',
    border: '1px solid rgba(255,100,100,0.5)', borderRadius: '4px',
    marginBottom: '6px',
  });
  fireBtn.addEventListener('click', () => Trip.trigger());
  el.appendChild(fireBtn);

  // ---- Timing sliders ----
  el.appendChild(divider());
  const timingLabel = document.createElement('div');
  timingLabel.textContent = 'Timing';
  timingLabel.style.cssText = 'opacity:0.7;margin-bottom:4px;';
  el.appendChild(timingLabel);

  const timingDefs = [
    { key: 'duration',           label: 'Duration (s)',       min: 5,   max: 120, step: 1   },
    { key: 'fadeIn',             label: 'Fade in (s)',        min: 0,   max: 5,   step: 0.1 },
    { key: 'fadeOut',            label: 'Fade out (s)',       min: 0,   max: 10,  step: 0.1 },
    { key: 'proximityThreshold', label: 'Proximity (m)',      min: 1,   max: 10,  step: 0.1 },
    { key: 'restDuration',       label: 'Rest needed (s)',    min: 1,   max: 15,  step: 0.5 },
  ];
  for (const def of timingDefs) {
    el.appendChild(buildSliderRow(def.label, def.key, def.min, def.max, def.step, Trip, 'timing'));
  }

  // ---- Effect sliders ----
  el.appendChild(divider());
  const fxLabel = document.createElement('div');
  fxLabel.textContent = 'Effects';
  fxLabel.style.cssText = 'opacity:0.7;margin-bottom:4px;';
  el.appendChild(fxLabel);

  const effectDefs = [
    { key: 'hueShift',            label: 'Hue shift'           },
    { key: 'saturation',          label: 'Saturation'          },
    { key: 'uvRipple',            label: 'UV ripple'           },
    { key: 'chromaticAberration', label: 'Chromatic aber.'     },
    { key: 'lensDistortion',      label: 'Lens distortion'     },
    { key: 'kaleidoscope',        label: 'Kaleidoscope'        },
    { key: 'posterize',           label: 'Posterize'           },
    { key: 'vignettePulse',       label: 'Vignette pulse'      },
    { key: 'brightnessPulse',     label: 'Brightness pulse'    },
  ];
  for (const def of effectDefs) {
    el.appendChild(buildSliderRow(def.label, def.key, 0, 1, 0.01, Trip, 'effect'));
  }

  document.body.appendChild(el);
  state.tripPanelEl = el;

  function syncSlidersFromConfig() {
    for (const [key, s] of Object.entries(state.tripSliders)) {
      if (key in Trip.config) {
        s.input.value = Trip.config[key];
        s.readout.textContent = Trip.config[key].toFixed(2);
      }
    }
  }
}

function buildSliderRow(label, key, min, max, step, Trip, group) {
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:3px;';

  const lbl = document.createElement('span');
  lbl.textContent = label;
  lbl.style.cssText = 'flex:0 0 120px;opacity:0.85;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;';
  row.appendChild(lbl);

  const target = group === 'effect' ? Trip.config : Trip;
  const currentVal = target[key] !== undefined ? target[key] : 0;

  const input = document.createElement('input');
  input.type = 'range';
  input.min = min;
  input.max = max;
  input.step = step;
  input.value = currentVal;
  input.style.cssText = 'flex:1;accent-color:#ffe066;cursor:pointer;';
  row.appendChild(input);

  const readout = document.createElement('span');
  readout.textContent = Number(currentVal).toFixed(step < 0.1 ? 2 : 1);
  readout.style.cssText = 'width:36px;text-align:right;';
  row.appendChild(readout);

  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    target[key] = v;
    readout.textContent = v.toFixed(step < 0.1 ? 2 : 1);
  });

  state.tripSliders[key] = { input, readout };
  return row;
}

function updateTripPanel() {
  const Trip = state.hooks && state.hooks.Trip;
  if (!Trip || !state.tripStateEl) return;
  const dist = Trip._nearestWookDist;
  const distStr = (dist !== undefined && dist < Infinity) ? dist.toFixed(1) + 'm' : '—';
  state.tripStateEl.textContent =
    `state: ${Trip.state.padEnd(11)} env: ${Trip._envelope.toFixed(2)}\n` +
    `wook: ${distStr}  prox-timer: ${Trip._proximityTimer.toFixed(1)}s`;
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
