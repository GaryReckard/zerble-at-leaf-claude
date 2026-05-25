// Keyboard + touch input. Tracks held keys + edge events for the keyboard,
// and blends in axis values + edge presses from the Touch module so the rest
// of the game can stay input-source-agnostic.
//
// WASD steers Zerble; arrow keys orbit/tilt the camera.
// On touch devices: left thumbstick steers + throttles, right buttons honk +
// boost, drag-canvas orbits the camera.

import { Touch } from './touch.js';

const held = new Set();
const edges = new Set();

function normalize(e) {
  if (e.key === ' ') return 'SPACE';
  if (e.key === 'Shift') return 'SHIFT';
  if (e.key === 'ArrowUp') return 'UP';
  if (e.key === 'ArrowDown') return 'DOWN';
  if (e.key === 'ArrowLeft') return 'LEFT';
  if (e.key === 'ArrowRight') return 'RIGHT';
  if (e.key.length === 1) return e.key.toUpperCase();
  return e.key.toUpperCase();
}

const BLOCK_DEFAULT = new Set(['W', 'A', 'S', 'D', 'SPACE', 'SHIFT', 'UP', 'DOWN', 'LEFT', 'RIGHT']);

window.addEventListener('keydown', (e) => {
  const k = normalize(e);
  if (!held.has(k)) edges.add(k);
  held.add(k);
  if (BLOCK_DEFAULT.has(k)) e.preventDefault();
});

window.addEventListener('keyup', (e) => {
  const k = normalize(e);
  held.delete(k);
});

window.addEventListener('blur', () => {
  held.clear();
});

// Combine a keyboard {-1,0,1} digital axis with a touch [-1..1] analog axis.
// Touch wins when active; otherwise keyboard. Clamped to [-1, 1].
function blendAxis(kbd, touch) {
  if (touch !== 0) return Math.max(-1, Math.min(1, touch));
  return kbd;
}

export const Input = {
  isDown(k) {
    return held.has(k);
  },

  // Honk edge: either a keyboard SPACE keydown OR a touch-honk tap this frame.
  consumePressed(k) {
    const kbdEdge = edges.has(k);
    if (kbdEdge) edges.delete(k);
    if (k === 'SPACE') {
      const touchEdge = Touch._consumeHonk();
      return kbdEdge || touchEdge;
    }
    return kbdEdge;
  },

  // ----- Driving (WASD + thumbstick) -----
  get throttle() {
    const kbd = (held.has('W') ? 1 : 0) - (held.has('S') ? 1 : 0);
    return blendAxis(kbd, Touch.state.throttle);
  },
  get steer() {
    const kbd = (held.has('A') ? 1 : 0) - (held.has('D') ? 1 : 0);
    return blendAxis(kbd, Touch.state.steer);
  },
  get boost() {
    return held.has('SHIFT') || Touch.state.boost;
  },

  // ----- Camera (arrow keys — rate-based, persistent) -----
  get camYaw() {
    // LEFT yaws the camera left around Zerble; RIGHT yaws right.
    return (held.has('LEFT') ? 1 : 0) - (held.has('RIGHT') ? 1 : 0);
  },
  get camPitch() {
    // UP tilts the camera up; DOWN tilts down.
    return (held.has('UP') ? 1 : 0) - (held.has('DOWN') ? 1 : 0);
  },

  // ----- Camera drag (touch — direct one-shot deltas in radians) -----
  // ChaseCamera consumes these each frame in addition to camYaw/camPitch.
  consumeCamDeltas() {
    return Touch._consumeCamDeltas();
  },
};
