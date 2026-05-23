// Keyboard input. Tracks held keys and one-shot "edge" events.

const held = new Set();
const edges = new Set();

const KEY_ALIASES = {
  ArrowUp: 'W',
  ArrowDown: 'S',
  ArrowLeft: 'A',
  ArrowRight: 'D',
};

function normalize(e) {
  if (e.key in KEY_ALIASES) return KEY_ALIASES[e.key];
  if (e.key === ' ') return 'SPACE';
  if (e.key === 'Shift') return 'SHIFT';
  if (e.key.length === 1) return e.key.toUpperCase();
  return e.key.toUpperCase();
}

window.addEventListener('keydown', (e) => {
  const k = normalize(e);
  if (!held.has(k)) edges.add(k);
  held.add(k);
  if (['W', 'A', 'S', 'D', 'SPACE', 'SHIFT'].includes(k)) e.preventDefault();
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

  // Consume a one-frame edge event (true on the frame the key was first pressed).
  consumePressed(k) {
    if (edges.has(k)) {
      edges.delete(k);
      return true;
    }
    return false;
  },

  // Helpers shaped for driving.
  get throttle() {
    return (held.has('W') ? 1 : 0) - (held.has('S') ? 1 : 0);
  },
  get steer() {
    return (held.has('A') ? 1 : 0) - (held.has('D') ? 1 : 0);
  },
  get boost() {
    return held.has('SHIFT');
  },
};
