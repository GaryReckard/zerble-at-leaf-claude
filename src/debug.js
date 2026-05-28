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
import { Analytics } from './analytics.js';
import { getForestAt } from './forests.js';
import { PERF } from './perf.js';
import { getSessionSeed } from './rng.js';
import { chunkGenStats } from './chunks.js';
import {
  getFrameStats, getLevelName, getLevelNames, getLevelCount,
  getLevel, setEnabled as aqSetEnabled, applyLevel as aqApplyLevel,
  getBloomEnabled, getShadowsEnabled, getBasePixelRatio,
  setShadows as aqSetShadows, setPixelRatio as aqSetPixelRatio,
} from './adaptiveQuality.js';

// Per-tier perf budgets. Numbers come from the r/threejs perf thread
// guidance — these are "stay under or you're hurting low-end devices"
// targets, not hard limits. The HUD colors the live counts against
// these so it's obvious at a glance whether the current scene is in or
// out of budget.
//
//   triangles: low 150k / mid 400k / high 1.2M
//   draws:     low 80   / mid 200   / high 400
const PERF_BUDGETS = {
  low:  { tris: 150_000, draws: 80  },
  mid:  { tris: 400_000, draws: 200 },
  high: { tris: 1_200_000, draws: 400 },
};

// Format a count with a budget marker — green if under 75%, yellow if
// 75–100%, red if over. Returns the string with terminal-style
// brackets/symbols; the panel is monospace text so ANSI codes won't
// render — we use ` ok`, ` !`, ` !!` markers instead.
function fmtWithBudget(value, budget) {
  if (typeof value !== 'number') return String(value);
  const pretty = value.toLocaleString();
  if (!budget) return pretty;
  const pct = value / budget;
  let marker;
  if (pct < 0.75)      marker = 'ok';
  else if (pct < 1.0)  marker = '! ';
  else                 marker = '!!';
  return `${pretty} / ${budget.toLocaleString()} [${marker}]`;
}

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
  // hooks: { scene, camera, renderer, bloomPass, zerble, crowd, bubbles, smiles,
  //          registry, puppets, band, kids, wooks, getRunning, getTimeOfDay, Trip }
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

// ---- Landmark locator ----
//
// Given a category string, finds the nearest landmark of that type to
// Zerble's current position. Returns { x, z, heading?, label } or null.
//
// Forest entrances are computed from the deterministic getForestAt hash —
// we don't need the forest to be loaded yet; we scan a chunk-coord window
// around the player and pick the nearest matching center. For dynamic
// things (lurleen, lakes, campsites) we walk the live registry.
function locateLandmark(kind) {
  const h = state.hooks;
  if (!h || !h.zerble) return null;
  const zx = h.zerble.position.x;
  const zz = h.zerble.position.z;

  // Helper: closest item from an iterable of { position, ... }.
  function nearestRegistryEntry(predicate) {
    let best = null;
    for (const e of h.registry.entries.values()) {
      if (!predicate(e)) continue;
      const d = Math.hypot(e.position.x - zx, e.position.z - zz);
      if (!best || d < best.d) best = { entry: e, d };
    }
    return best ? best.entry : null;
  }

  // Helper: closest forest center from a hash scan.
  function nearestForestCenter(filter) {
    let best = null;
    // 60-chunk window each side from the player → ~4.8km diameter. Plenty
    // for a "nearest" query across the whole reasonably-explored world.
    const cxz = Math.round(zx / 80);
    const czz = Math.round(zz / 80);
    for (let cx = cxz - 60; cx <= cxz + 60; cx++) {
      for (let cz = czz - 60; cz <= czz + 60; cz++) {
        const f = getForestAt(cx, cz);
        if (!f || f.role !== 'center') continue;
        if (filter && !filter(f)) continue;
        const d = Math.hypot(f.centerX - zx, f.centerZ - zz);
        if (!best || d < best.d) best = { f, d };
      }
    }
    return best ? best.f : null;
  }

  // Drop the player at the OUTSIDE end of a forest's entrance path so they
  // can drive in. pathDirIdx: 0=N, 1=E, 2=S, 3=W.
  function forestEntrancePoint(forest) {
    const off = 80 + 25;  // a bit further out than the path starts so the cart sits clear of the woods
    let x = forest.centerX, z = forest.centerZ, heading = 0;
    switch (forest.pathDirIdx) {
      case 0: z -= off; heading = Math.PI;            break; // N → face south to drive in
      case 1: x += off; heading = -Math.PI / 2;       break; // E → face west
      case 2: z += off; heading = 0;                  break; // S → face north
      case 3: x -= off; heading = Math.PI / 2;        break; // W → face east
    }
    return { x, z, heading };
  }

  switch (kind) {
    case 'drum_circle': {
      const f = nearestForestCenter((f) => f.interiorContent === 'drum_circle');
      if (!f) return null;
      const p = forestEntrancePoint(f);
      return { ...p, label: `drum-circle forest at (${f.centerCx}, ${f.centerCz})` };
    }
    case 'campsite_forest': {
      const f = nearestForestCenter((f) => f.interiorContent === 'campsite');
      if (!f) return null;
      const p = forestEntrancePoint(f);
      return { ...p, label: `campsite forest at (${f.centerCx}, ${f.centerCz})` };
    }
    case 'any_forest': {
      const f = nearestForestCenter((f) => f.hasInterior);
      if (!f) return null;
      const p = forestEntrancePoint(f);
      return { ...p, label: `forest at (${f.centerCx}, ${f.centerCz})` };
    }
    case 'lurleen': {
      const l = h.lurleen;
      if (!l || !l.position) return null;
      return { x: l.position.x, z: l.position.z + 8, heading: Math.PI, label: 'Lurleen' };
    }
    case 'lake': {
      const e = nearestRegistryEntry((e) => e.kind === 'lake');
      if (!e) return null;
      // Sit on the shore — outside the lake radius — facing the centre.
      const dx = zx - e.position.x;
      const dz = zz - e.position.z;
      const d = Math.hypot(dx, dz) || 1;
      const reach = (e.footprint || 0) + 8;
      return {
        x: e.position.x + (dx / d) * reach,
        z: e.position.z + (dz / d) * reach,
        heading: Math.atan2(-dx, -dz),
        label: 'nearest lake',
      };
    }
    case 'campsite': {
      const e = nearestRegistryEntry((e) => e.kind === 'campsite');
      if (!e) return null;
      return { x: e.position.x + 4, z: e.position.z + 4, label: 'nearest campsite' };
    }
    case 'spawn':
      return { x: 0, z: 65, heading: 0, label: 'spawn' };
  }
  return null;
}

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
    toggle() {
      state.visible = !state.visible;
      state.panelEl.style.display = state.visible ? 'block' : 'none';
      Analytics.debugMenuToggle(state.visible);
    },
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

// Creates a collapsible panel section. Returns { wrapper, content }.
// The wrapper has the border-top divider; content is the div to append
// children to. Clicking the header row toggles content visibility.
function makeSection(label, defaultOpen = true) {
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'margin-top:8px;border-top:1px solid #2a4a5a;padding-top:6px';

  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;gap:5px;cursor:pointer;user-select:none;margin-bottom:4px;opacity:0.7';

  const arrow = document.createElement('span');
  const title  = document.createElement('span');
  title.textContent = label;
  header.appendChild(arrow);
  header.appendChild(title);
  wrapper.appendChild(header);

  const content = document.createElement('div');
  wrapper.appendChild(content);

  let open = defaultOpen;
  const refresh = () => {
    arrow.textContent = open ? '▾' : '▸';
    content.style.display = open ? '' : 'none';
  };
  refresh();
  header.addEventListener('click', () => { open = !open; refresh(); });

  return { wrapper, content };
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
  const { wrapper: helpWrapper, content: helpContent } = makeSection('Controls', false);
  helpContent.style.fontSize = '11px';
  helpContent.style.lineHeight = '1.5';
  helpContent.innerHTML = `
    <div><b>W A S D</b> drive · <b>Shift</b> boost · <b>Space</b> honk (random)</div>
    <div><b>B</b> bicycle bell · <b>H</b> clown horn (specific)</div>
    <div><b>← ↑ ↓ →</b> orbit/tilt camera</div>
    <div><b>V</b> first-person / chase view</div>
    <div><b>I</b> / <b>O</b> eye glow brighter / dimmer</div>
    <div><b>\`</b> toggle this debug panel</div>
    <div><b>T</b> toggle trip/psychedelic debug panel</div>
  `;
  el.appendChild(helpWrapper);

  // ----- Time-of-day controls -----
  // A horizontal slider 0..1 maps to TimeOfDay.t. Three preset shortcut
  // buttons jump to common times.
  const { wrapper: todWrapper, content: todContent } = makeSection('Time of day');
  todContent.innerHTML = `
    <span id="dbg-tod-readout" style="float:right;opacity:0.6;font-size:10px"></span>
    <input id="dbg-tod-slider" type="range" min="0" max="1" step="0.001" value="0.15"
      style="width:100%;accent-color:#ffe066;cursor:pointer" />
    <div style="display:flex;gap:4px;margin-top:6px">
      <button data-t="0.10" class="dbg-tod-preset">Morning</button>
      <button data-t="0.30" class="dbg-tod-preset">Noon</button>
      <button data-t="0.50" class="dbg-tod-preset">Dusk</button>
      <button data-t="0.75" class="dbg-tod-preset">Midnight</button>
    </div>
  `;
  el.appendChild(todWrapper);

  // ----- Teleport menu -----
  // Like Minecraft's /locate + /tp combined: pick a landmark type, click Go,
  // and Zerble drops at the nearest one. For forests with paths, we drop
  // him just outside the entrance so he can drive in.
  const { wrapper: tpWrapper, content: tpContent } = makeSection('Teleport', false);
  tpContent.innerHTML = `
    <div style="display:flex;gap:4px">
      <select id="dbg-tp-select" style="flex:1;font:inherit;background:#0e1c28;color:#dff;border:1px solid #2a4a5a;border-radius:3px;padding:2px 4px">
        <option value="drum_circle">Drum circle (forest entrance)</option>
        <option value="campsite_forest">Campsite forest (entrance)</option>
        <option value="any_forest">Any forest (entrance)</option>
        <option value="lurleen">Lurleen</option>
        <option value="lake">Lake</option>
        <option value="campsite">Campsite (any)</option>
        <option value="spawn">Spawn</option>
      </select>
      <button id="dbg-tp-go" style="font:inherit;padding:2px 10px;background:rgba(255,224,102,0.20);color:#ffe066;border:1px solid rgba(255,224,102,0.45);border-radius:3px;cursor:pointer">Go</button>
    </div>
    <div id="dbg-tp-status" style="margin-top:3px;font-size:10px;opacity:0.6;min-height:13px"></div>
  `;
  el.appendChild(tpWrapper);

  document.body.appendChild(el);

  // Wire the teleport menu.
  const tpSelect = tpContent.querySelector('#dbg-tp-select');
  const tpStatus = tpContent.querySelector('#dbg-tp-status');
  tpContent.querySelector('#dbg-tp-go').addEventListener('click', () => {
    const dest = locateLandmark(tpSelect.value);
    if (dest) {
      state.hooks.zerble.position.set(dest.x, state.hooks.zerble.position.y, dest.z);
      state.hooks.zerble.speed = 0;
      if (typeof dest.heading === 'number') state.hooks.zerble.heading = dest.heading;
      tpStatus.textContent = `→ ${dest.label}`;
    } else {
      tpStatus.textContent = 'no nearby landmark of that type';
    }
  });

  // Wire slider + buttons to the timeOfDay hook (which may be null until
  // world.js finishes booting — getTimeOfDay() resolves lazily).
  const slider = todContent.querySelector('#dbg-tod-slider');
  const readout = todContent.querySelector('#dbg-tod-readout');
  state.todSlider = slider;
  state.todReadout = readout;
  slider.addEventListener('input', () => {
    const tod = state.hooks.getTimeOfDay && state.hooks.getTimeOfDay();
    if (tod) tod.setT(parseFloat(slider.value));
  });
  for (const btn of todContent.querySelectorAll('.dbg-tod-preset')) {
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
  const { wrapper: audioWrapper, content: audioContent } = makeSection('Audio');

  const masterVol = Sound.isReady() ? Sound.getMasterVolume() : 0.55;
  const musicVol  = Sound.isReady() ? Sound.getMusicVolume()  : 1.6;
  const sfxVol    = Sound.isReady() ? Sound.getSfxVolume()    : 1.0;
  const midiVol   = Sound.isReady() ? Sound.getMidiVolume()   : 1.0;

  audioContent.innerHTML = `
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
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
      <span style="width:48px;opacity:0.8">MIDI</span>
      <input id="dbg-vol-midi" type="range" min="0" max="2" step="0.01" value="${midiVol.toFixed(2)}"
        style="flex:1;accent-color:#ffe066;cursor:pointer" />
      <span id="dbg-vol-midi-readout" style="width:32px;text-align:right">${midiVol.toFixed(2)}</span>
    </div>
    <div style="display:flex;align-items:center;gap:6px">
      <span style="width:48px;opacity:0.8">SFX</span>
      <input id="dbg-vol-sfx" type="range" min="0" max="2" step="0.01" value="${sfxVol.toFixed(2)}"
        style="flex:1;accent-color:#ffe066;cursor:pointer" />
      <span id="dbg-vol-sfx-readout" style="width:32px;text-align:right">${sfxVol.toFixed(2)}</span>
    </div>
  `;
  el.appendChild(audioWrapper);

  // Wire audio sliders
  audioContent.querySelector('#dbg-vol-master').addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    Sound.setMasterVolume(v);
    audioContent.querySelector('#dbg-vol-master-readout').textContent = v.toFixed(2);
  });
  audioContent.querySelector('#dbg-vol-music').addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    Sound.setMusicVolume(v);
    audioContent.querySelector('#dbg-vol-music-readout').textContent = v.toFixed(2);
  });
  audioContent.querySelector('#dbg-vol-midi').addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    Sound.setMidiVolume(v);
    audioContent.querySelector('#dbg-vol-midi-readout').textContent = v.toFixed(2);
  });
  audioContent.querySelector('#dbg-vol-sfx').addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    Sound.setSfxVolume(v);
    audioContent.querySelector('#dbg-vol-sfx-readout').textContent = v.toFixed(2);
  });

  // ----- Render / adaptive quality overrides -----
  // Quality preset dropdown locks to a specific level (disabling auto-tuning).
  // Individual checkboxes become active when locked and let you override
  // specific settings independently of the level preset.
  // In "auto" mode the checkboxes are read-only — they just mirror reality.
  const { wrapper: renderWrapper, content: renderContent } = makeSection('Render');

  const levelNames = getLevelNames();
  const levelOpts  = levelNames.map((n, i) => `<option value="${i}">${n}</option>`).join('');
  const prOpts = [
    ['auto', 'auto'],
    ['2',    '2×'],
    ['1.5',  '1.5×'],
    ['1',    '1×'],
    ['0.875','0.875×'],
    ['0.75', '0.75×'],
    ['0.5',  '0.5×'],
  ].map(([v, l]) => `<option value="${v}">${l}</option>`).join('');

  renderContent.innerHTML = `
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:5px">
      <span style="opacity:0.8;min-width:40px">Level</span>
      <select id="dbg-aq-level" style="flex:1;font:inherit;background:#0e1c28;color:#dff;border:1px solid #2a4a5a;border-radius:3px;padding:2px 4px">
        <option value="auto">auto</option>
        ${levelOpts}
      </select>
    </div>
    <label id="dbg-aq-bloom-label" style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-bottom:3px">
      <input id="dbg-aq-bloom" type="checkbox" style="cursor:pointer">
      <span>Bloom</span>
    </label>
    <label id="dbg-aq-shadows-label" style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-bottom:3px">
      <input id="dbg-aq-shadows" type="checkbox" style="cursor:pointer">
      <span>Shadows</span>
    </label>
    <label id="dbg-aq-bubbles-label" style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-bottom:5px">
      <input id="dbg-aq-bubbles-cheap" type="checkbox" style="cursor:pointer">
      <span>Cheap bubbles</span>
    </label>
    <div style="display:flex;align-items:center;gap:6px">
      <span style="opacity:0.8;min-width:40px">Pixel ratio</span>
      <select id="dbg-aq-pr" style="flex:1;font:inherit;background:#0e1c28;color:#dff;border:1px solid #2a4a5a;border-radius:3px;padding:2px 4px">
        ${prOpts}
      </select>
    </div>
    <div style="opacity:0.55;font-size:10px;margin-top:4px" id="dbg-aq-hint">
      Pick a level to lock and enable overrides.
    </div>
  `;
  el.appendChild(renderWrapper);

  // Helpers to get/set the locked-vs-auto state of the Render panel.
  const aqLevelSel     = renderContent.querySelector('#dbg-aq-level');
  const aqBloomCb      = renderContent.querySelector('#dbg-aq-bloom');
  const aqShadowsCb    = renderContent.querySelector('#dbg-aq-shadows');
  const aqBubblesCb    = renderContent.querySelector('#dbg-aq-bubbles-cheap');
  const aqPrSel        = renderContent.querySelector('#dbg-aq-pr');
  const aqHint         = renderContent.querySelector('#dbg-aq-hint');
  const aqBloomLabel   = renderContent.querySelector('#dbg-aq-bloom-label');
  const aqShadowsLabel = renderContent.querySelector('#dbg-aq-shadows-label');
  const aqBubblesLabel = renderContent.querySelector('#dbg-aq-bubbles-label');

  function aqRefreshCheckboxStates() {
    aqBloomCb.checked     = getBloomEnabled();
    aqShadowsCb.checked   = getShadowsEnabled();
    aqBubblesCb.checked   = state.hooks.bubbles?.mesh?.material !== state.hooks.bubbles?._fancyMat;
  }
  function aqSetLocked(locked) {
    const opacity = locked ? '1' : '0.45';
    const ptr     = locked ? 'pointer' : 'not-allowed';
    for (const el of [aqBloomLabel, aqShadowsLabel, aqBubblesLabel]) {
      el.style.opacity = opacity;
      el.style.cursor  = ptr;
    }
    aqBloomCb.disabled   = !locked;
    aqShadowsCb.disabled = !locked;
    aqBubblesCb.disabled = !locked;
    aqPrSel.disabled     = !locked;
    aqPrSel.style.opacity = opacity;
    aqHint.textContent   = locked
      ? 'Adaptive quality paused. Overrides active.'
      : 'Pick a level to lock and enable overrides.';
  }

  // Initialise to "auto" state.
  aqLevelSel.value = 'auto';
  aqRefreshCheckboxStates();
  aqSetLocked(false);

  aqLevelSel.addEventListener('change', () => {
    const v = aqLevelSel.value;
    if (v === 'auto') {
      aqSetEnabled(true);
      aqSetLocked(false);
    } else {
      aqSetEnabled(false);
      aqApplyLevel(parseInt(v, 10));
      aqRefreshCheckboxStates();
      aqSetLocked(true);
    }
  });
  aqBloomCb.addEventListener('change', () => {
    const bp = state.hooks.bloomPass ?? null;
    if (bp) bp.enabled = aqBloomCb.checked;
  });
  aqShadowsCb.addEventListener('change', () => {
    aqSetShadows(aqShadowsCb.checked);
  });
  aqBubblesCb.addEventListener('change', () => {
    state.hooks.bubbles?.setCheapMaterial?.(aqBubblesCb.checked);
  });
  aqPrSel.addEventListener('change', () => {
    const v = aqPrSel.value;
    if (v !== 'auto') aqSetPixelRatio(parseFloat(v));
  });

  // ----- Graphics opt-ins -----
  // Two tiers, both off by default everywhere (per-fragment light cost).
  // Toggling persists to localStorage and prompts a reload.
  const { wrapper: gfxWrapper, content: gfxContent } = makeSection('Lights', false);
  let contextNow = false, fancyNow = false;
  try {
    contextNow = localStorage.getItem('zerble.contextLights') === '1';
    fancyNow   = localStorage.getItem('zerble.fancyLights')   === '1';
  } catch (e) {}
  gfxContent.innerHTML = `
    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-bottom:3px">
      <input id="dbg-context-lights" type="checkbox" ${contextNow ? 'checked' : ''} style="cursor:pointer">
      <span style="flex:1">Context lights <span style="opacity:0.55">(firepits, Sugar Shack)</span></span>
    </label>
    <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
      <input id="dbg-fancy-lights" type="checkbox" ${fancyNow ? 'checked' : ''} style="cursor:pointer">
      <span style="flex:1">Fancy lights <span style="opacity:0.55">(per-torch, per-bulb)</span></span>
    </label>
    <div style="opacity:0.55;font-size:10px;margin-top:3px">Reload to apply. Heavier on the GPU.</div>
  `;
  el.appendChild(gfxWrapper);

  function bindLightsToggle(id, key, label) {
    gfxContent.querySelector(id).addEventListener('change', (e) => {
      const on = e.target.checked;
      try { localStorage.setItem(key, on ? '1' : '0'); } catch (err) {}
      if (confirm(`${label} ${on ? 'ON' : 'OFF'}. Reload now to apply?`)) {
        location.reload();
      }
    });
  }
  bindLightsToggle('#dbg-context-lights', 'zerble.contextLights', 'Context lights');
  bindLightsToggle('#dbg-fancy-lights',   'zerble.fancyLights',   'Fancy lights');

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
  Analytics.tripMenuToggle(state.tripVisible);
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

  // renderer.info — draw calls / triangles / GPU memory. Each frame three.js
  // resets `render.calls` and `render.triangles` when the next render starts,
  // so we sample BEFORE the panel updates (which runs after the frame's
  // render). Memory counts (geometries/textures) are cumulative current
  // allocation, not per-frame.
  const r = h.renderer;
  const info = r && r.info;
  const drawCalls = info ? info.render.calls : '-';
  const triangles = info ? info.render.triangles : '-';
  const geoCount  = info ? info.memory.geometries : '-';
  const texCount  = info ? info.memory.textures : '-';
  // performance.memory is Chrome-only; treat as best-effort.
  const heap = (typeof performance !== 'undefined' && performance.memory)
    ? `  heap ${(performance.memory.usedJSHeapSize / 1048576).toFixed(0)}MB`
    : '';

  // Per-tier budgets from the r/threejs perf thread. The current tier's
  // numbers get inlined next to draws/tris so it's obvious at a glance
  // whether the scene fits the budget. Markers: ok (<75%) / ! (75-100%) /
  // !! (over budget).
  const budget = PERF_BUDGETS[PERF.name] || null;
  const drawsStr = budget ? fmtWithBudget(drawCalls, budget.draws) : String(drawCalls);
  const trisStr  = budget ? fmtWithBudget(triangles, budget.tris)  : (typeof triangles === 'number' ? triangles.toLocaleString() : String(triangles));

  // Session seed — echo the resolved 32-bit int and (if any) the raw URL
  // string the player passed in. So "?seed=bananas" reads "seed bananas
  // (0xdeadbeef)" and a fresh load reads just "seed 0x12345678".
  const seedInt = getSessionSeed();
  const seedHex = '0x' + seedInt.toString(16).padStart(8, '0');
  const seedStr = typeof window !== 'undefined' && window.__seedInput
    ? `${window.__seedInput} (${seedHex})`
    : seedHex;

  // Frame-time stats from adaptiveQuality rolling window (updated ~1/s).
  const ft = getFrameStats();
  const ftStr = ft.avg > 0
    ? `avg=${ft.avg.toFixed(1)}  p95=${ft.p95.toFixed(1)}  max=${ft.max.toFixed(1)}ms`
    : 'warming up…';

  // Chunk generation stats.
  const cg = chunkGenStats;
  const cgStr = cg.count > 0
    ? `${cg.count} gen  slow=${cg.slowCount}  worst=${cg.slowest.toFixed(1)}  last=${cg.lastMs.toFixed(1)}  avg=${cg.avgMs.toFixed(1)}ms`
    : 'none yet';

  state.textEl.textContent =
    `~ debug (P pause · . step · C colliders · G god · F freeze)\n` +
    `fps          ${fps}    ${state.paused ? '[PAUSED]' : ''}\n` +
    `frame        ${ftStr}\n` +
    `quality      ${getLevelName()}\n` +
    `draws        ${drawsStr}\n` +
    `tris         ${trisStr}\n` +
    `gpu mem      geo ${geoCount}  tex ${texCount}${heap}\n` +
    `chunks       ${cgStr}\n` +
    `running      ${running}\n` +
    `seed         ${seedStr}\n` +
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

  // Keep Render panel checkboxes in sync with the adaptive quality system.
  // When the dropdown is "auto" the checkboxes are greyed but still show
  // the current effective state so there's no mystery about what AQ did.
  if (state.panelEl) {
    const aqLvSel = state.panelEl.querySelector('#dbg-aq-level');
    if (aqLvSel && aqLvSel.value === 'auto') {
      const bloomCb   = state.panelEl.querySelector('#dbg-aq-bloom');
      const shadowsCb = state.panelEl.querySelector('#dbg-aq-shadows');
      const bubblesCb = state.panelEl.querySelector('#dbg-aq-bubbles-cheap');
      if (bloomCb)   bloomCb.checked   = getBloomEnabled();
      if (shadowsCb) shadowsCb.checked = getShadowsEnabled();
      if (bubblesCb) bubblesCb.checked =
        h.bubbles?.mesh?.material !== h.bubbles?._fancyMat;
    }
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
    // Was 300px — the Duration row's "180.0" readout overflowed the right
    // edge. Bumped to 340px and widened the readout column (see buildSliderRow).
    maxWidth: '340px',
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

  // Action buttons — FIRE TRIP / DYNAMIC TRIP / COME DOWN
  const fireRow = document.createElement('div');
  fireRow.style.cssText = 'display:flex;gap:4px;margin-bottom:6px;';

  const fireBtn = document.createElement('button');
  fireBtn.textContent = 'FIRE TRIP';
  Object.assign(fireBtn.style, {
    flex: '1', font: 'inherit', padding: '4px 6px', cursor: 'pointer',
    background: 'rgba(255,100,100,0.25)', color: '#fdd',
    border: '1px solid rgba(255,100,100,0.5)', borderRadius: '4px',
  });
  fireBtn.addEventListener('click', () => Trip.trigger());
  fireRow.appendChild(fireBtn);

  const dynamicBtn = document.createElement('button');
  dynamicBtn.textContent = 'DYNAMIC TRIP';
  Object.assign(dynamicBtn.style, {
    flex: '1', font: 'inherit', padding: '4px 6px', cursor: 'pointer',
    background: 'rgba(200,100,255,0.25)', color: '#fdf',
    border: '1px solid rgba(200,100,255,0.5)', borderRadius: '4px',
  });
  dynamicBtn.title = "Scripted per-effect timelines — this is what the wook does";
  dynamicBtn.addEventListener('click', () => Trip.triggerDynamic());
  fireRow.appendChild(dynamicBtn);

  el.appendChild(fireRow);

  const comeDownBtn = document.createElement('button');
  comeDownBtn.textContent = 'COME DOWN';
  Object.assign(comeDownBtn.style, {
    width: '100%', font: 'inherit', padding: '4px 6px',
    background: 'rgba(80,180,180,0.18)', color: '#bdf',
    border: '1px solid rgba(80,180,180,0.4)', borderRadius: '4px',
    marginBottom: '6px',
  });
  comeDownBtn.addEventListener('click', () => Trip.comeDown());
  el.appendChild(comeDownBtn);
  state.tripComeDownBtn = comeDownBtn;

  // ---- Timing sliders ----
  el.appendChild(divider());
  const timingLabel = document.createElement('div');
  timingLabel.textContent = 'Timing';
  timingLabel.style.cssText = 'opacity:0.7;margin-bottom:4px;';
  el.appendChild(timingLabel);

  const timingDefs = [
    { key: 'duration',           label: 'Duration (s)',       min: 5,   max: 300, step: 1   },
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
  // 36px was too narrow for "180.0" — bumped to 48px so 3-digit values fit
  // without the row hanging off the panel.
  readout.style.cssText = 'width:48px;text-align:right;';
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
  const mode = Trip.dynamic ? 'DYNAMIC' : 'static ';
  state.tripStateEl.textContent =
    `state: ${Trip.state.padEnd(11)} env: ${Trip._envelope.toFixed(2)}  ${mode}\n` +
    `wook: ${distStr}  prox-timer: ${Trip._proximityTimer.toFixed(1)}s`;

  // Come Down button only active during fading_in / sustaining.
  const cd = state.tripComeDownBtn;
  if (cd) {
    const canComeDown = Trip.state === 'fading_in' || Trip.state === 'sustaining';
    cd.disabled = !canComeDown;
    cd.style.cursor = canComeDown ? 'pointer' : 'not-allowed';
    cd.style.opacity = canComeDown ? '1' : '0.4';
  }

  // While Dynamic mode is driving a trip, mirror the live values into the
  // sliders so the user can SEE the scripted timeline animating.
  if (Trip.dynamic && Trip.isActive() && Trip.live) {
    for (const [key, s] of Object.entries(state.tripSliders)) {
      if (key in Trip.live) {
        const v = Trip.live[key];
        s.input.value = v;
        s.readout.textContent = v.toFixed(2);
      }
    }
  }
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
