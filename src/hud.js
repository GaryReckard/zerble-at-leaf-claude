// Lightweight HUD bindings. Pure DOM, no framework.

const $smiles = document.getElementById('smiles');
const $best = document.getElementById('best');
const $toast = document.getElementById('toast');
const $flash = document.getElementById('hit-flash');
const $title = document.getElementById('title-card');
const $start = document.getElementById('start-btn');

let toastTimer = 0;

const BEST_KEY = 'zerble-best-smiles';

export const HUD = {
  showTitle() {
    $title.classList.remove('hidden');
  },

  hideTitle() {
    $title.classList.add('hidden');
  },

  onStart(cb) {
    $start.addEventListener('click', cb, { once: true });
  },

  setSmiles(n) {
    $smiles.textContent = String(Math.floor(n));
  },

  loadBest() {
    const v = parseInt(localStorage.getItem(BEST_KEY) || '0', 10);
    $best.textContent = String(v || 0);
    return v || 0;
  },

  saveBest(n) {
    const cur = parseInt(localStorage.getItem(BEST_KEY) || '0', 10);
    if (n > cur) {
      localStorage.setItem(BEST_KEY, String(Math.floor(n)));
      $best.textContent = String(Math.floor(n));
    }
  },

  toast(msg, ms = 1600) {
    $toast.textContent = msg;
    $toast.classList.remove('hidden');
    $toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $toast.classList.remove('show'), ms);
  },

  flashHit() {
    $flash.classList.add('on');
    setTimeout(() => $flash.classList.remove('on'), 180);
  },
};
