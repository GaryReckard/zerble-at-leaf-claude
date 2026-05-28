// Adaptive quality monitor. Watches frame time over a rolling window and
// downgrades render quality (pixel ratio, bloom, shadows) when sustained
// performance drops below a threshold. Ramps back up if the budget
// recovers. Surfaces transitions as a HUD toast so the player knows what
// changed.
//
// Design notes:
//   * We tweak the LIVE renderer/composer/PERF settings rather than
//     reloading. Pixel ratio change forces a renderer.setSize() recompute.
//   * Shadows toggle dynamically by setting `renderer.shadowMap.enabled`
//     (cheap), but on transitions we have to flag shadowMap.needsUpdate
//     so it actually re-renders.
//   * Bloom toggle is just `bloomPass.enabled = false/true`.
//   * Hysteresis: we use different "drop" and "raise" thresholds so the
//     system doesn't oscillate when FPS sits near the boundary.
//
// Usage from main.js (per frame, after composer.render):
//   AdaptiveQuality.tick(dt);

import { PERF } from './perf.js';

const TARGET_FPS = 50;          // we aim to stay above this
const DROP_FRAME_MS = 24;       // ~42 fps — drop quality if sustained
const RAISE_FRAME_MS = 15;      // ~66 fps — safe to raise quality
const WINDOW = 90;              // ~1.5 sec of frames at 60fps
const SUSTAIN_FRAMES = 60;      // need this many consecutive bad/good frames

const QUALITY_LEVELS = [
  // Level 0 = the saved PERF tier (whatever the user / detection picked).
  { name: 'baseline' },
  // Each subsequent level peels something off.
  { name: 'no-bloom',     bloom: false },
  { name: 'no-shadows',   bloom: false, shadows: false },
  { name: 'half-pixels',  bloom: false, shadows: false, pixelRatioMul: 0.5 },
];

const state = {
  enabled: true,
  level: 0,
  badRun: 0,
  goodRun: 0,
  frameTimes: [],
  hooks: null,
  // List of meshes whose castShadow we turned off when we dropped to the
  // no-shadows level. Restored on raise. See `_setShadowsOn` below.
  _castersTurnedOff: null,
  // Derived frame-time stats — updated once per second from the rolling
  // frameTimes window. Exposed via getFrameStats() for the debug HUD.
  // Phase 1 instrumentation (perf-pass-4).
  _statsCache: { avg: 0, p95: 0, max: 0 },
  _statsTick: 0,
  // Raw wall-clock tracking — performance.now() at the previous tick call.
  // We track this independently of dt because dt is capped at 50ms in
  // main.js (Math.min(clock.getDelta(), 0.05)), so using dt would clamp
  // every frame over 50fps, making avg/p95/max useless for diagnosing jitter.
  _lastPerfTime: 0,
};

export function install(hooks) {
  // hooks: { renderer, scene, composer, bloomPass, hud, onLevelChange }
  state.hooks = hooks;
  // Cache the baseline pixel ratio so we can scale it instead of clobbering.
  state.basePixelRatio = hooks.renderer.getPixelRatio();
}

export function setEnabled(v) {
  state.enabled = v;
}

export function tick(dt) {
  if (!state.enabled || !state.hooks) return;

  // Use raw wall-clock delta for frame-time stats so we capture actual
  // jitter instead of the dt-capped value (which is clamped at 50ms by
  // main.js and would make p95/max meaningless for anything under 20fps).
  const now = performance.now();
  const wallMs = state._lastPerfTime > 0 ? now - state._lastPerfTime : dt * 1000;
  state._lastPerfTime = now;

  // Adaptive quality uses the original dt-based ms for its drop/raise
  // thresholds (those are calibrated against the clamped game tick), but
  // the stats window records wall-clock time so the HUD is truthful.
  const ms = dt * 1000;
  state.frameTimes.push(wallMs);
  if (state.frameTimes.length > WINDOW) state.frameTimes.shift();
  // Need a real sample window before judging — don't whipsaw at boot when
  // the first few frames include shader compile spikes.
  if (state.frameTimes.length < WINDOW) return;

  // Average frame time over the window. Median would be more robust against
  // GC spikes; mean is good enough for the coarse on/off transitions here.
  let sum = 0;
  for (const x of state.frameTimes) sum += x;
  const avg = sum / state.frameTimes.length;

  // Derived stats (p95 + max) — computed once per ~60 frames to avoid
  // a sorted copy every tick. p95 catches sustained jitter; max catches
  // single-frame hitches like chunk-load spikes.
  state._statsTick++;
  if (state._statsTick >= 60) {
    state._statsTick = 0;
    const sorted = state.frameTimes.slice().sort((a, b) => a - b);
    const p95Idx = Math.floor(sorted.length * 0.95);
    state._statsCache = {
      avg,
      p95: sorted[p95Idx] ?? 0,
      max: sorted[sorted.length - 1] ?? 0,
    };
  }

  if (avg > DROP_FRAME_MS) {
    state.badRun++;
    state.goodRun = 0;
    if (state.badRun >= SUSTAIN_FRAMES && state.level < QUALITY_LEVELS.length - 1) {
      _apply(state.level + 1, avg);
      state.badRun = 0;
    }
  } else if (avg < RAISE_FRAME_MS) {
    state.goodRun++;
    state.badRun = 0;
    if (state.goodRun >= SUSTAIN_FRAMES && state.level > 0) {
      _apply(state.level - 1, avg);
      state.goodRun = 0;
    }
  } else {
    // In the middle band — neither drop nor raise.
    state.badRun = Math.max(0, state.badRun - 1);
    state.goodRun = Math.max(0, state.goodRun - 1);
  }
}

function _apply(newLevel, avgMs) {
  const lvl = QUALITY_LEVELS[newLevel];
  state.level = newLevel;
  const { renderer, scene, composer, bloomPass, hud } = state.hooks;

  // Bloom
  if (bloomPass) {
    bloomPass.enabled = lvl.bloom !== false ? PERF.bloom : false;
  }
  // Shadows
  _setShadowsOn(scene, renderer, lvl.shadows !== false && PERF.shadows);
  // Pixel ratio
  const pixMul = lvl.pixelRatioMul ?? 1;
  renderer.setPixelRatio(state.basePixelRatio * pixMul);
  // Composer needs its size re-applied so the bloom render target tracks.
  composer.setSize(window.innerWidth, window.innerHeight);

  // Tell the player what happened. Short toast — easy to miss is fine.
  const fps = (1000 / avgMs).toFixed(0);
  const msg = newLevel > 0
    ? `perf: ${lvl.name} (~${fps}fps)`
    : `perf: full quality (~${fps}fps)`;
  hud?.toast?.(msg, 1800);
  state.hooks.onLevelChange?.(newLevel, lvl);
}

// Toggle shadows in a way that doesn't leave stale ghost shadows on the
// ground.
//
// The naive approach — `renderer.shadowMap.enabled = false` — stops the
// shadow map from being re-rendered, but materials compiled with shadow
// support still SAMPLE the depth texture, which keeps its stale contents.
// Result: frozen shadows frozen exactly where they last drew, looking
// like a bug.
//
// Instead: leave `shadowMap.enabled` alone and walk every casting mesh,
// turning off `castShadow` (saving the list for restore). The next
// shadow-map render is then EMPTY, so every receive-shadow mesh samples
// a clear depth texture and reads "fully lit" — no stale shadows. Cost
// is one shadow render with no occluders (cheap) instead of skipping
// the render entirely; net perf is still much better than full shadows
// because the per-caster fill cost is gone.
function _setShadowsOn(scene, renderer, on) {
  if (on) {
    // Restore the casters we'd previously turned off. Skip any that were
    // already nulled out by other systems (defensive).
    if (state._castersTurnedOff) {
      for (const m of state._castersTurnedOff) {
        if (m && !m.castShadow) m.castShadow = true;
      }
      state._castersTurnedOff = null;
    }
    renderer.shadowMap.enabled = true;
  } else {
    // Collect every casting mesh + flip its flag off. Save the list so we
    // can flip them back on a future raise. Set `shadowMap.needsUpdate`
    // so the next render writes a clean empty depth texture.
    const turned = [];
    scene.traverse((o) => {
      if (o.isMesh && o.castShadow) {
        o.castShadow = false;
        turned.push(o);
      }
    });
    state._castersTurnedOff = turned;
    renderer.shadowMap.needsUpdate = true;
  }
}

export function getLevel() { return state.level; }
export function getLevelName() { return QUALITY_LEVELS[state.level].name; }

// Phase 1 instrumentation — frame-time stats for the debug HUD.
// Returns the most recently computed { avg, p95, max } (ms). Updated once
// per ~60 frames, so it lags reality slightly — good enough for display.
export function getFrameStats() { return state._statsCache; }
