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
};

export function install(hooks) {
  // hooks: { renderer, composer, bloomPass, hud, onLevelChange }
  state.hooks = hooks;
  // Cache the baseline pixel ratio so we can scale it instead of clobbering.
  state.basePixelRatio = hooks.renderer.getPixelRatio();
}

export function setEnabled(v) {
  state.enabled = v;
}

export function tick(dt) {
  if (!state.enabled || !state.hooks) return;
  const ms = dt * 1000;
  state.frameTimes.push(ms);
  if (state.frameTimes.length > WINDOW) state.frameTimes.shift();
  // Need a real sample window before judging — don't whipsaw at boot when
  // the first few frames include shader compile spikes.
  if (state.frameTimes.length < WINDOW) return;

  // Average frame time over the window. Median would be more robust against
  // GC spikes; mean is good enough for the coarse on/off transitions here.
  let sum = 0;
  for (const x of state.frameTimes) sum += x;
  const avg = sum / state.frameTimes.length;

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
  const { renderer, composer, bloomPass, hud } = state.hooks;

  // Bloom
  if (bloomPass) {
    bloomPass.enabled = lvl.bloom !== false ? PERF.bloom : false;
  }
  // Shadows
  renderer.shadowMap.enabled = lvl.shadows !== false ? PERF.shadows : false;
  renderer.shadowMap.needsUpdate = true;
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

export function getLevel() { return state.level; }
export function getLevelName() { return QUALITY_LEVELS[state.level].name; }
