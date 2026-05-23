// Keyboard input. Tracks held keys + edge events.
// WASD steers Zerble; arrow keys orbit/tilt the camera.

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

export const Input = {
  isDown(k) {
    return held.has(k);
  },

  consumePressed(k) {
    if (edges.has(k)) {
      edges.delete(k);
      return true;
    }
    return false;
  },

  // ----- Driving (WASD) -----
  get throttle() {
    return (held.has('W') ? 1 : 0) - (held.has('S') ? 1 : 0);
  },
  get steer() {
    return (held.has('A') ? 1 : 0) - (held.has('D') ? 1 : 0);
  },
  get boost() {
    return held.has('SHIFT');
  },

  // ----- Camera (arrow keys) -----
  get camYaw() {
    // LEFT yaws the camera left around Zerble; RIGHT yaws right.
    return (held.has('LEFT') ? 1 : 0) - (held.has('RIGHT') ? 1 : 0);
  },
  get camPitch() {
    // UP tilts the camera up; DOWN tilts down.
    return (held.has('UP') ? 1 : 0) - (held.has('DOWN') ? 1 : 0);
  },
};
