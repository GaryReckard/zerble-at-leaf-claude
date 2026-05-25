// Thin wrapper around gtag.js. No-ops gracefully if the GA tag failed to load
// (ad blockers, offline dev, etc.) so analytics never breaks gameplay.

const SMILE_MILESTONES = [10, 25, 50, 100, 250, 500, 1000, 2500];

const state = {
  reachedSmileMilestones: new Set(),
  lastBestReported: 0,
  honked: false,
  sessionStartMs: performance.now(),
};

function send(name, params) {
  try {
    if (typeof window === 'undefined') return;
    if (typeof window.gtag !== 'function') return;
    window.gtag('event', name, params || {});
  } catch (_) {
    // never let analytics throw into game code
  }
}

function secondsIn() {
  return Math.round((performance.now() - state.sessionStartMs) / 1000);
}

export const Analytics = {
  gameStart() {
    state.sessionStartMs = performance.now();
    send('game_start');
  },

  debugMenuToggle(open) {
    if (open) send('debug_menu_open', { time_in_run_s: secondsIn() });
  },

  tripMenuToggle(open) {
    if (open) send('trip_menu_open', { time_in_run_s: secondsIn() });
  },

  smileScore(score) {
    for (const m of SMILE_MILESTONES) {
      if (score >= m && !state.reachedSmileMilestones.has(m)) {
        state.reachedSmileMilestones.add(m);
        send('smile_milestone', {
          milestone: m,
          time_in_run_s: secondsIn(),
        });
      }
    }
  },

  personalBest(score) {
    // Only report when we actually clear a previous best by a notable jump,
    // to avoid spamming on every +1.
    if (score > state.lastBestReported + 9) {
      state.lastBestReported = score;
      send('personal_best', {
        value: Math.floor(score),
        time_in_run_s: secondsIn(),
      });
    }
  },

  lurleenFound() {
    send('lurleen_found', { time_in_run_s: secondsIn() });
  },

  tripStart(source) {
    // source: 'wook' | 'manual_static' | 'manual_dynamic'
    send('trip_start', { source, time_in_run_s: secondsIn() });
  },

  collision(kind) {
    send('collision', { kind, time_in_run_s: secondsIn() });
  },

  firstHonk() {
    if (state.honked) return;
    state.honked = true;
    send('first_honk', { time_in_run_s: secondsIn() });
  },

  viewToggle(mode) {
    send('view_toggle', { mode, time_in_run_s: secondsIn() });
  },
};
