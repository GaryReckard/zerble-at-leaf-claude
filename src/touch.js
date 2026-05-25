// Touch controls: left-side virtual thumbstick (throttle + steer), right-side
// Honk and Boost buttons, and drag-anywhere-else for camera orbit/tilt.
//
// Wires directly into the Input module (input.js) — it exposes the same
// throttle/steer/boost getters and consumePressed('SPACE') edge so the rest of
// the game keeps working unchanged. Camera drag is consumed via
// Input.consumeCamDeltas() which ChaseCamera now reads each frame.

const STICK_RADIUS = 60;            // px — how far the knob can travel
const STICK_DEADZONE = 0.12;        // ignore tiny wobbles
const DRAG_YAW_SCALE = 0.0055;      // rad per px of horizontal drag
const DRAG_PITCH_SCALE = 0.0040;    // rad per px of vertical drag

const state = {
  // axes are -1..1; the Input module blends these with the keyboard.
  throttle: 0,
  steer: 0,
  boost: false,
  // one-shot honk press, consumed by Input.consumePressed('SPACE').
  honkLatched: false,
  // accumulated camera drag, consumed per frame.
  camYawDelta: 0,
  camPitchDelta: 0,
};

// Active touch tracking — we allow simultaneous stick + button + drag, so we
// have to identify touches by Touch.identifier.
let stickTouchId = null;
// The stick anchors at the point where the finger first lands so the initial
// reading is always (0, 0). Subsequent reads are relative to this anchor, not
// the base's geometric center. Standard mobile thumbstick feel.
const stickStart = { x: 0, y: 0 };
// Base center (cached at touchstart) — only used to position the knob's CSS
// transform, which is relative to the base.
const stickBaseCenter = { x: 0, y: 0 };

let dragTouchId = null;
let dragLastX = 0;
let dragLastY = 0;

let honkTouchId = null;
let boostTouchId = null;

let installed = false;
let $stickBase = null;
let $stickKnob = null;
let $btnHonk = null;
let $btnBoost = null;

export const Touch = {
  state,

  // "Show the touch UI" sniff. `(pointer: coarse)` is true on phones/tablets
  // where touch is the *primary* input, and false on desktops with a
  // secondary touchscreen — exactly what we want. iOS Safari, Android Chrome
  // and iPadOS Safari all match. Fall back to `ontouchstart` for any pre-
  // matchMedia browsers (vanishingly rare in 2026 but cheap).
  isTouchDevice() {
    if (typeof window === 'undefined') return false;
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return true;
    return ('ontouchstart' in window) && (navigator.maxTouchPoints || 0) > 0;
  },

  install() {
    if (installed) return;
    installed = true;

    $stickBase = document.getElementById('stick-base');
    $stickKnob = document.getElementById('stick-knob');
    $btnHonk = document.getElementById('btn-honk');
    $btnBoost = document.getElementById('btn-boost');

    if (!$stickBase || !$stickKnob || !$btnHonk || !$btnBoost) return;

    if (Touch.isTouchDevice()) {
      document.body.classList.add('is-touch');
    }

    // ----- Thumbstick -----
    // Touch starting anywhere on the stick base re-centers the stick at the
    // touch position (within the base's bounds) — feels much better than a
    // fixed center because users don't always land their thumb dead-center.
    $stickBase.addEventListener('touchstart', onStickStart, { passive: false });
    $stickBase.addEventListener('touchmove', onStickMove, { passive: false });
    $stickBase.addEventListener('touchend', onStickEnd, { passive: false });
    $stickBase.addEventListener('touchcancel', onStickEnd, { passive: false });

    // ----- Honk + Boost buttons -----
    $btnHonk.addEventListener('touchstart', onHonkStart, { passive: false });
    $btnHonk.addEventListener('touchend', onHonkEnd, { passive: false });
    $btnHonk.addEventListener('touchcancel', onHonkEnd, { passive: false });

    $btnBoost.addEventListener('touchstart', onBoostStart, { passive: false });
    $btnBoost.addEventListener('touchend', onBoostEnd, { passive: false });
    $btnBoost.addEventListener('touchcancel', onBoostEnd, { passive: false });

    // ----- Camera drag (anywhere outside the controls) -----
    // We listen on the canvas so taps on HUD elements (toast, score panel)
    // don't get hijacked.
    const canvas = document.getElementById('game');
    canvas.addEventListener('touchstart', onCanvasStart, { passive: false });
    canvas.addEventListener('touchmove', onCanvasMove, { passive: false });
    canvas.addEventListener('touchend', onCanvasEnd, { passive: false });
    canvas.addEventListener('touchcancel', onCanvasEnd, { passive: false });

    // ----- Mouse drag for desktop — same camera deltas as touch -----
    // Pointer events filtered to mouse (touches already handled above).
    canvas.addEventListener('pointerdown', onMouseDown);
    canvas.addEventListener('pointermove', onMouseMove);
    canvas.addEventListener('pointerup', onMouseUp);
    canvas.addEventListener('pointercancel', onMouseUp);
    canvas.style.cursor = 'grab';
  },

  // Consumed each frame by Input.consumePressed('SPACE').
  _consumeHonk() {
    const v = state.honkLatched;
    state.honkLatched = false;
    return v;
  },

  // Consumed each frame by Input.consumeCamDeltas() (camera.js reads this).
  _consumeCamDeltas() {
    const yaw = state.camYawDelta;
    const pitch = state.camPitchDelta;
    state.camYawDelta = 0;
    state.camPitchDelta = 0;
    return { yaw, pitch };
  },
};

// ---------- Thumbstick handlers ----------

function onStickStart(e) {
  e.preventDefault();
  if (stickTouchId !== null) return;
  const t = e.changedTouches[0];
  stickTouchId = t.identifier;
  // Cache base center for the knob's CSS transform.
  const r = $stickBase.getBoundingClientRect();
  stickBaseCenter.x = r.left + r.width / 2;
  stickBaseCenter.y = r.top + r.height / 2;
  // Anchor the math at the finger's landing point so initial reading is 0.
  stickStart.x = t.clientX;
  stickStart.y = t.clientY;
  updateStick(t.clientX, t.clientY); // produces (0, 0); knob moves to finger
}

function onStickMove(e) {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier === stickTouchId) {
      updateStick(t.clientX, t.clientY);
      return;
    }
  }
}

function onStickEnd(e) {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier === stickTouchId) {
      stickTouchId = null;
      state.throttle = 0;
      state.steer = 0;
      $stickKnob.style.transform = 'translate(-50%, -50%)';
      return;
    }
  }
}

function updateStick(clientX, clientY) {
  // Drag vector from anchor (where finger first landed), clamped to STICK_RADIUS.
  let dx = clientX - stickStart.x;
  let dy = clientY - stickStart.y;
  const len = Math.hypot(dx, dy);
  if (len > STICK_RADIUS) {
    dx = (dx / len) * STICK_RADIUS;
    dy = (dy / len) * STICK_RADIUS;
  }

  // Visual: knob sits at (anchor + drag), expressed relative to base center.
  const knobX = (stickStart.x - stickBaseCenter.x) + dx;
  const knobY = (stickStart.y - stickBaseCenter.y) + dy;
  $stickKnob.style.transform = `translate(calc(-50% + ${knobX}px), calc(-50% + ${knobY}px))`;

  // Normalize and deadzone the *drag* (not the anchor offset).
  let nx = dx / STICK_RADIUS;
  let ny = dy / STICK_RADIUS;
  const mag = Math.hypot(nx, ny);
  if (mag < STICK_DEADZONE) {
    nx = 0;
    ny = 0;
  } else {
    // Rescale post-deadzone so output ramps from 0 to 1 across the live range.
    const scaled = (mag - STICK_DEADZONE) / (1 - STICK_DEADZONE);
    nx = (nx / mag) * scaled;
    ny = (ny / mag) * scaled;
  }

  // Map: push up = forward (+throttle), push down = reverse (-throttle).
  // Push left = steer left (+steer to match A key), push right = steer right.
  state.throttle = -ny;
  state.steer = -nx;
}

// ---------- Button handlers ----------

function onHonkStart(e) {
  e.preventDefault();
  if (honkTouchId !== null) return;
  honkTouchId = e.changedTouches[0].identifier;
  state.honkLatched = true;
  $btnHonk.classList.add('pressed');
}

function onHonkEnd(e) {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier === honkTouchId) {
      honkTouchId = null;
      $btnHonk.classList.remove('pressed');
      return;
    }
  }
}

function onBoostStart(e) {
  e.preventDefault();
  if (boostTouchId !== null) return;
  boostTouchId = e.changedTouches[0].identifier;
  state.boost = true;
  $btnBoost.classList.add('pressed');
}

function onBoostEnd(e) {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier === boostTouchId) {
      boostTouchId = null;
      state.boost = false;
      $btnBoost.classList.remove('pressed');
      return;
    }
  }
}

// ---------- Canvas drag (camera orbit/tilt) ----------

function onCanvasStart(e) {
  // Only claim a touch that isn't already on a control. Since the stick/
  // buttons stop propagation via preventDefault on their own touchstart, we
  // shouldn't normally see them here — but be defensive.
  if (dragTouchId !== null) return;
  // Pick the first changedTouch — ignore if it landed on a control element.
  const t = e.changedTouches[0];
  const target = t.target;
  if (target && (target.closest('#stick-base') || target.closest('#btn-honk') || target.closest('#btn-boost'))) {
    return;
  }
  e.preventDefault();
  dragTouchId = t.identifier;
  dragLastX = t.clientX;
  dragLastY = t.clientY;
}

function onCanvasMove(e) {
  if (dragTouchId === null) return;
  for (const t of e.changedTouches) {
    if (t.identifier !== dragTouchId) continue;
    e.preventDefault();
    const dx = t.clientX - dragLastX;
    const dy = t.clientY - dragLastY;
    dragLastX = t.clientX;
    dragLastY = t.clientY;
    // Drag right → camera orbits right (yawOffset decreases).
    // Drag up   → camera tilts up   (pitchOffset increases).
    state.camYawDelta += -dx * DRAG_YAW_SCALE;
    state.camPitchDelta += -dy * DRAG_PITCH_SCALE;
    return;
  }
}

function onCanvasEnd(e) {
  for (const t of e.changedTouches) {
    if (t.identifier === dragTouchId) {
      dragTouchId = null;
      return;
    }
  }
}

// ---------- Mouse drag (desktop) ----------

let mouseDragging = false;
let mouseLastX = 0;
let mouseLastY = 0;

function onMouseDown(e) {
  if (e.pointerType !== 'mouse') return;
  // Right-click and middle-click are reserved.
  if (e.button !== 0) return;
  const canvas = e.currentTarget;
  mouseDragging = true;
  mouseLastX = e.clientX;
  mouseLastY = e.clientY;
  canvas.setPointerCapture(e.pointerId);
  canvas.style.cursor = 'grabbing';
}

function onMouseMove(e) {
  if (e.pointerType !== 'mouse' || !mouseDragging) return;
  const dx = e.clientX - mouseLastX;
  const dy = e.clientY - mouseLastY;
  mouseLastX = e.clientX;
  mouseLastY = e.clientY;
  state.camYawDelta += -dx * DRAG_YAW_SCALE;
  state.camPitchDelta += -dy * DRAG_PITCH_SCALE;
}

function onMouseUp(e) {
  if (e.pointerType !== 'mouse') return;
  if (mouseDragging) {
    mouseDragging = false;
    e.currentTarget.style.cursor = 'grab';
  }
}
