// Sugar Shack — long white gable canopy behind a stand-alone signage facade.
// Modelled on Tom's Sugar Shack at LEAF festival. Geometry split into two
// parts:
//
//   1. The TENT — a 4×8m white gable canopy, gable ridge along Z, white
//      side walls, open at both gable ends.
//   2. The FACADE — a separate frame in FRONT of the tent, on its own
//      vertical posts that extend higher than the tent peak. Holds:
//        - the beige "Festival Famous / the SUGAR SHACK / BREAKFAST ALL
//          DAY + NIGHT" header banner across the top
//        - one long wooden menu plank below the banner with all four
//          items painted on it in colored text
//        - a white DRINKS price-list panel on the customer's left
//        - a white FOOD price-list panel on the customer's right
//
// The facade is in front of and OUTSIDE the tent width, so the signage
// reads cleanly from the customer's POV without clipping through the tent
// roof. Customer walks under the signage to reach the counter inside.
//
// Convention matches foodTruck.js: front of the structure faces +Z, so the
// food_plaza chunk's `rotation.y = atan2(centerX-x, centerZ-z)` rotation
// also makes the shack face inward.

import * as THREE from 'three';
import { buildSimpleNPC } from './puppet.js';
import { PERF } from '../perf.js';
import { register as registerContextLight } from '../contextLights.js';

const WIDTH = 4.0;
const DEPTH = 8.0;
const WALL_H = 2.8;
const ROOF_RISE = 1.4;
const PEAK_H = WALL_H + ROOF_RISE;        // 4.2 — height of tent ridge

// Facade frame sits in FRONT of the tent at this z, with its own posts.
const FACADE_Z = DEPTH / 2 + 0.5;
const FACADE_WIDTH = 6.4;                  // wider than tent so side panels jut out
// Facade post height — just above the banner top. The banner now stacks
// directly on top of the menu plank (its bottom touches the plank top),
// so the posts only need to reach a bit above the banner.
//   plankY = WALL_H + 0.55      (= 3.35)
//   plankTop = plankY + 0.475   (= 3.825)
//   bannerTop = plankTop + 1.4  (= 5.225)
//   FACADE_HEIGHT = bannerTop + small buffer
const FACADE_HEIGHT = WALL_H + 2.50;

export const SUGAR_SHACK_WIDTH = FACADE_WIDTH;  // collider should cover signage width
export const SUGAR_SHACK_DEPTH = DEPTH + 1.0;   // include facade depth

// ==================== Sign textures ====================

const _texCache = new Map();

function cachedTexture(key, build) {
  if (_texCache.has(key)) return _texCache.get(key);
  const tex = build();
  _texCache.set(key, tex);
  return tex;
}

// Build a CanvasTexture from a canvas, with the colorspace + filtering we
// want everywhere. Saves repeating the three lines after every helper.
function finishCanvasTexture(canvas) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// Auto-shrink a string to fit a width. Sets cx.font to whatever size fit.
function fitFont(cx, str, targetSize, weight = 'bold', maxW = Infinity, family = '"Trebuchet MS", "Helvetica Neue", Helvetica, Arial, sans-serif') {
  let size = targetSize;
  while (size > 10) {
    cx.font = `${weight} ${size}px ${family}`;
    if (cx.measureText(str).width <= maxW) return size;
    size -= 2;
  }
  return 10;
}

// ----- Top banner: "Festival Famous / the SUGAR SHACK / BREAKFAST ALL DAY + NIGHT"
function buildHeaderBannerTexture() {
  return cachedTexture('headerBanner', () => {
    const c = document.createElement('canvas');
    c.width = 2048;
    c.height = 512;
    const cx = c.getContext('2d');

    // Beige wood background with subtle horizontal grain.
    cx.fillStyle = '#f0e2c0';
    cx.fillRect(0, 0, c.width, c.height);
    cx.strokeStyle = 'rgba(140, 100, 50, 0.10)';
    cx.lineWidth = 2;
    for (let y = 0; y < c.height; y += 14) {
      cx.beginPath(); cx.moveTo(0, y); cx.lineTo(c.width, y); cx.stroke();
    }
    // Thin dark border.
    cx.strokeStyle = 'rgba(70, 50, 30, 0.5)';
    cx.lineWidth = 6;
    cx.strokeRect(12, 12, c.width - 24, c.height - 24);

    cx.textAlign = 'center';
    cx.textBaseline = 'middle';

    // "FESTIVAL FAMOUS" — small caps, pinkish, near top
    cx.fillStyle = '#a63a4a';
    fitFont(cx, 'FESTIVAL · FAMOUS', 84, 'bold', c.width - 80);
    cx.fillText('FESTIVAL · FAMOUS', c.width / 2, 95);

    // "the SUGAR SHACK" — hand-painted feel, very large
    // "the" smaller and offset left like a cursive flourish
    cx.fillStyle = '#5b3a1f';
    cx.font = 'italic bold 120px "Brush Script MT", "Snell Roundhand", "Trebuchet MS", cursive';
    const theW = cx.measureText('the').width;
    fitFont(cx, 'SUGAR SHACK', 220, 'bold', c.width - theW - 100);
    const shackW = cx.measureText('SUGAR SHACK').width;
    const totalW = theW + 50 + shackW;
    const startX = (c.width - totalW) / 2 + theW / 2;
    cx.font = 'italic bold 120px "Brush Script MT", "Snell Roundhand", "Trebuchet MS", cursive';
    cx.fillText('the', startX - 30, 250);
    fitFont(cx, 'SUGAR SHACK', 220, 'bold', c.width - theW - 100);
    cx.fillText('SUGAR SHACK', startX + theW / 2 + 50 + shackW / 2, 270);

    // "BREAKFAST ALL DAY + NIGHT" — small caps, brown, bottom
    cx.fillStyle = '#5b3a1f';
    fitFont(cx, 'BREAKFAST  ALL  DAY  +  NIGHT', 76, 'bold', c.width - 80);
    cx.fillText('BREAKFAST  ALL  DAY  +  NIGHT', c.width / 2, 430);

    // Decorative red dots flanking the title (the "berry" garnishes).
    cx.fillStyle = '#c63a2a';
    cx.beginPath(); cx.arc(c.width * 0.18, 95, 16, 0, Math.PI * 2); cx.fill();
    cx.beginPath(); cx.arc(c.width * 0.82, 95, 16, 0, Math.PI * 2); cx.fill();

    // Sun (yellow circle) before "BREAKFAST" and crescent moon after "NIGHT".
    cx.fillStyle = '#f4c430';
    cx.beginPath(); cx.arc(c.width * 0.25, 430, 22, 0, Math.PI * 2); cx.fill();
    cx.fillStyle = '#dcdce4';
    cx.beginPath();
    cx.arc(c.width * 0.75, 430, 22, 0, Math.PI * 2);
    cx.fill();
    cx.fillStyle = '#f0e2c0';
    cx.beginPath();
    cx.arc(c.width * 0.75 + 8, 425, 20, 0, Math.PI * 2);
    cx.fill();

    return finishCanvasTexture(c);
  });
}

// ----- Menu plank: one long brown wooden board, hand-painted text in 4 colors
function buildMenuPlankTexture() {
  return cachedTexture('menuPlank', () => {
    const c = document.createElement('canvas');
    c.width = 2048;
    c.height = 384;
    const cx = c.getContext('2d');

    // Worn orange-brown wood with horizontal grain.
    cx.fillStyle = '#a8682e';
    cx.fillRect(0, 0, c.width, c.height);
    cx.strokeStyle = 'rgba(60, 30, 10, 0.22)';
    cx.lineWidth = 2;
    for (let y = 0; y < c.height; y += 16) {
      cx.beginPath();
      // Wobbly grain
      cx.moveTo(0, y);
      for (let x = 0; x < c.width; x += 64) {
        cx.lineTo(x, y + Math.sin(x * 0.013 + y * 0.07) * 3);
      }
      cx.stroke();
    }
    // Knots — small darker ovals.
    cx.fillStyle = 'rgba(60, 30, 10, 0.45)';
    for (let i = 0; i < 6; i++) {
      const kx = (i + 0.5) * (c.width / 6) + (i % 2 === 0 ? 40 : -40);
      const ky = 60 + (i * 71) % (c.height - 120);
      cx.beginPath(); cx.ellipse(kx, ky, 18, 10, 0, 0, Math.PI * 2); cx.fill();
    }
    // Outer border.
    cx.strokeStyle = 'rgba(0,0,0,0.55)';
    cx.lineWidth = 8;
    cx.strokeRect(10, 10, c.width - 20, c.height - 20);

    cx.textAlign = 'center';
    cx.textBaseline = 'middle';

    // 4 items, each in its own colored hand-painted lockup.
    const items = [
      { lines: ['FRENCH', 'TOAST'],            color: '#c63a2a' },
      { lines: ['VEGGIE', 'THING'],            color: '#3a7b3a' },
      { lines: ['VERMONT', 'MAPLE', 'TREATS'], color: '#e09818' },
      { lines: ['HOT & COLD', 'DRINKS'],       color: '#c63a2a' },
    ];
    const slotW = c.width / items.length;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const cxX = (i + 0.5) * slotW;
      const n = item.lines.length;
      // 3-line items get slightly smaller font to fit vertically.
      const fontSize = n === 3 ? 92 : 120;
      cx.fillStyle = item.color;
      const lineHeight = fontSize * 1.05;
      const totalH = n * lineHeight;
      for (let j = 0; j < n; j++) {
        fitFont(cx, item.lines[j], fontSize, 'bold', slotW - 40);
        const y = c.height / 2 - totalH / 2 + (j + 0.5) * lineHeight;
        cx.fillText(item.lines[j], cxX, y);
      }
    }

    return finishCanvasTexture(c);
  });
}

// ----- DRINKS price list panel (left side)
const DRINKS_ITEMS = [
  { name: 'COFFEE',         note: 'Good + Strong!', prices: ['Hot 2.00', 'Iced 2.50'] },
  { name: 'ICED MOCHA',     prices: ['3.00'] },
  { name: 'ICED Wild Berry TEA', prices: ['3.00'] },
  { name: 'OREGON CHAI',    prices: ['Hot 2.50', 'Iced 3.00'] },
  { name: 'HOT CHOCOLATE',  note: 'our special recipe', prices: ['2.50'] },
  { name: 'JUICE',          note: 'Apple, Orange, Grape, Cranberry', prices: ['2.00 / 2.50'] },
  { name: 'WHOLE MILK',     prices: ['2.00 / 2.50'] },
  { name: 'CHOCOLATE MILK', prices: ['2.50 / 3.00'] },
  { name: 'MAPLE MILK',     prices: ['2.50 / 3.00'] },
  { name: 'SPRING WATER',   prices: ['1.00'] },
  { name: 'TEA',            note: 'selection below', prices: ['Hot 2.00', 'Iced 2.50'] },
];

// ----- FOOD price list panel (right side)
const FOOD_ITEMS = [
  { name: 'FRENCH TOAST',       price: '6.00' },
  { name: 'COMBO',              price: '8.00', sub: 'french toast & eggs' },
  { name: 'FRIED EGG SANDWICH', price: '7.00' },
  { name: 'VEGGIE THING',       price: '9.00', sub: 'tortilla, cheese, greens', highlight: '#3a7b3a' },
  { name: 'BREAKFAST THING',    price: '11.00', sub: '3 scrambled eggs +', highlight: '#3a7b3a' },
  { name: 'CHEESE QUESADILLA',  price: '5.00' },
  { name: 'SCRAMBLED EGGS',     price: '4.00' },
  { name: 'MAPLE NUTS',         price: '4.00' },
  { name: 'FUDGE OATY BAR',     price: '3.00' },
  { name: 'PURE MAPLE CANDY',   price: '1.00' },
];

function buildPriceListTexture(key, title, items, panelW = 1.3, panelH = 2.0) {
  // Round dimensions so different sized panels still cache cleanly.
  const cacheKey = `${key}|${panelW.toFixed(2)}|${panelH.toFixed(2)}`;
  return cachedTexture(cacheKey, () => {
    const c = document.createElement('canvas');
    // Match the panel's aspect so text doesn't squish vertically when the
    // panel gets shorter. Width capped at 512 for memory.
    c.width = 512;
    c.height = Math.round(512 * (panelH / panelW));
    const cx = c.getContext('2d');

    // White-ish board.
    cx.fillStyle = '#fbf6e8';
    cx.fillRect(0, 0, c.width, c.height);
    // Two nested borders give it a "painted wood sign" look.
    cx.strokeStyle = 'rgba(50,30,10,0.55)';
    cx.lineWidth = 8;
    cx.strokeRect(10, 10, c.width - 20, c.height - 20);
    cx.strokeStyle = 'rgba(50,30,10,0.30)';
    cx.lineWidth = 3;
    cx.strokeRect(28, 28, c.width - 56, c.height - 56);

    // Title — pink, hand-painted feel.
    cx.fillStyle = '#c63a2a';
    cx.textAlign = 'center';
    cx.textBaseline = 'middle';
    fitFont(cx, title, 110, 'bold', c.width - 80);
    cx.fillText(title, c.width / 2, 80);

    // Items.
    const padTop = 160;
    const padBot = 40;
    const rowH = (c.height - padTop - padBot) / items.length;
    cx.textBaseline = 'middle';
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const yBase = padTop + (i + 0.5) * rowH;

      // Name (left-aligned, highlight color if specified)
      cx.fillStyle = item.highlight || '#1c1330';
      cx.textAlign = 'left';
      fitFont(cx, item.name, 44, 'bold', c.width * 0.62);
      cx.fillText(item.name, 40, yBase - (item.sub || item.note ? 10 : 0));

      // Sub/note (below name, smaller, italic)
      if (item.sub || item.note) {
        cx.fillStyle = 'rgba(28, 19, 48, 0.7)';
        cx.font = 'italic 26px "Trebuchet MS", "Helvetica Neue", Helvetica, Arial, sans-serif';
        cx.fillText(item.sub || item.note, 40, yBase + 22);
      }

      // Prices (right-aligned)
      cx.fillStyle = '#1c1330';
      cx.textAlign = 'right';
      if (item.price) {
        fitFont(cx, item.price, 42, 'bold', c.width * 0.30);
        cx.fillText(item.price, c.width - 40, yBase);
      } else if (item.prices) {
        cx.font = 'bold 30px "Trebuchet MS", "Helvetica Neue", Helvetica, Arial, sans-serif';
        for (let j = 0; j < item.prices.length; j++) {
          const py = yBase - 14 + j * 28;
          cx.fillText(item.prices[j], c.width - 40, py);
        }
      }
    }

    return finishCanvasTexture(c);
  });
}

// ----- Pink THANK YOU banner across the counter front
function buildThankYouBannerTexture() {
  return cachedTexture('thankYou', () => {
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 256;
    const cx = c.getContext('2d');
    cx.fillStyle = '#c63d8a';
    cx.fillRect(0, 0, c.width, c.height);
    cx.strokeStyle = 'rgba(0,0,0,0.25)';
    cx.lineWidth = 6;
    cx.strokeRect(10, 10, c.width - 20, c.height - 20);
    cx.fillStyle = '#fff4d0';
    cx.textAlign = 'center';
    cx.textBaseline = 'middle';
    fitFont(cx, 'THANK YOU', 110, 'bold', c.width - 60);
    cx.fillText('THANK YOU', c.width / 2, 100);
    fitFont(cx, 'for a real good time', 56, '', c.width - 60);
    cx.fillText('for a real good time', c.width / 2, 200);
    return finishCanvasTexture(c);
  });
}

// ==================== Workers ====================

// Tie-dye texture used for Tom's shirt — a few overlapping radial color
// blobs on a blue base. Cached so all Toms across all shacks share one.
function buildTieDyeTexture() {
  return cachedTexture('tieDye', () => {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const cx = c.getContext('2d');
    cx.fillStyle = '#3a6fd0';
    cx.fillRect(0, 0, c.width, c.height);
    const blob = (bx, by, r, color) => {
      const g = cx.createRadialGradient(bx, by, 0, bx, by, r);
      g.addColorStop(0, color);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      cx.fillStyle = g;
      cx.fillRect(0, 0, c.width, c.height);
    };
    blob( 60, 80,  90, '#f5a623');   // orange swirl
    blob(180, 50,  80, '#d040a8');   // magenta
    blob(140, 180, 110, '#8b3fce');  // purple
    blob( 70, 220, 90, '#3fce5e');   // green
    blob(210, 170, 80, '#e74c3c');   // red
    blob(180, 110, 60, '#f5e030');   // yellow pop
    return finishCanvasTexture(c);
  });
}

// Tom — proprietor. Tie-dye shirt, white/grey ponytail, grey beard stubble.
function buildTom() {
  // Build with a placeholder white shirt so we can identify-and-swap the
  // shirt-colored meshes for the tie-dye material below.
  const g = buildSimpleNPC(0xffffff, 0xe6c098, { pantsHex: 0x4a3520 });
  const tieDyeMat = new THREE.MeshStandardMaterial({
    map: buildTieDyeTexture(), roughness: 0.9, flatShading: true,
  });
  // Swap white-shirt meshes (torso + upper arms) for the tie-dye material.
  g.traverse((obj) => {
    if (
      obj.isMesh && obj.material && obj.material.color &&
      obj.material.color.r > 0.95 && obj.material.color.g > 0.95 && obj.material.color.b > 0.95
    ) {
      obj.material = tieDyeMat;
    }
  });

  // White/grey hair — wraps the top of the head AND domes above it so the
  // skin-colored crown isn't visible. Bigger than the head, positioned
  // slightly back so the face stays exposed. NPC faces -Z, back of head +Z.
  const hairMat = new THREE.MeshStandardMaterial({
    color: 0xd6d2c8, roughness: 0.85, flatShading: true,
  });
  const topHair = new THREE.Mesh(new THREE.IcosahedronGeometry(0.30, 1), hairMat);
  topHair.position.set(0, 1.78, 0.08);
  topHair.scale.set(1.05, 0.80, 1.05);
  g.add(topHair);
  // Hair-band at the base of the skull where the ponytail starts.
  const band = new THREE.Mesh(
    new THREE.TorusGeometry(0.07, 0.025, 6, 12),
    new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.8, flatShading: true }),
  );
  band.position.set(0, 1.55, 0.20);
  band.rotation.x = Math.PI / 2;
  g.add(band);
  // The ponytail — slight forward droop so it reads as hanging, not stuck on.
  const ponytail = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.08, 0.48, 8),
    hairMat,
  );
  ponytail.position.set(0, 1.34, 0.24);
  ponytail.rotation.x = 0.12;
  g.add(ponytail);

  // Grey beard stubble — small dots scattered along the jawline. NPC's face
  // is at -Z; jaw is right below the eyes at z ≈ -0.22.
  const stubbleMat = new THREE.MeshStandardMaterial({
    color: 0x7a7a72, roughness: 0.85, flatShading: true,
  });
  const stubblePts = [
    [-0.12, 1.52, -0.20], [ 0.12, 1.52, -0.20],
    [-0.08, 1.49, -0.23], [ 0.08, 1.49, -0.23],
    [ 0,    1.47, -0.24],
    [-0.13, 1.55, -0.18], [ 0.13, 1.55, -0.18],
    [-0.05, 1.51, -0.23], [ 0.05, 1.51, -0.23],
  ];
  for (const [x, y, z] of stubblePts) {
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.022, 4, 4), stubbleMat);
    dot.position.set(x, y, z);
    g.add(dot);
  }

  return g;
}

// Generic apron-wearing cook — solid shirt + white apron.
function buildApronCook(rng = Math.random) {
  const shirtColors = [0xc63a2a, 0x3a72c2, 0xe09818, 0x6b513a];
  const skinTones   = [0xe6c098, 0xc09478, 0x8b6f50, 0xf2d4b2];
  const shirt = shirtColors[Math.floor(rng() * shirtColors.length)];
  const skin  = skinTones[Math.floor(rng() * skinTones.length)];
  const g = buildSimpleNPC(shirt, skin, { pantsHex: 0x2a2a3c });

  // Apron — flat panel covering the front of the torso. NPC's chest is -Z.
  const apronMat = new THREE.MeshStandardMaterial({
    color: 0xfff4d0, roughness: 0.9, flatShading: true,
  });
  const apron = new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.95, 0.05), apronMat);
  apron.position.set(0, 0.95, -0.26);
  g.add(apron);
  // Apron bib + neck strap.
  const bib = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, 0.04), apronMat);
  bib.position.set(0, 1.36, -0.26);
  g.add(bib);
  const strap = new THREE.Mesh(
    new THREE.TorusGeometry(0.16, 0.018, 6, 14, Math.PI),
    apronMat,
  );
  strap.position.set(0, 1.52, -0.18);
  strap.rotation.y = Math.PI / 2;
  strap.rotation.z = Math.PI;
  g.add(strap);

  // Short cropped hair.
  const hairColors = [0x2a2018, 0x5a3920, 0x7b5a3a, 0xb8956a];
  const hairMat = new THREE.MeshStandardMaterial({
    color: hairColors[Math.floor(rng() * hairColors.length)],
    roughness: 0.85, flatShading: true,
  });
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.27, 10, 8), hairMat);
  hair.position.set(0, 1.74, 0.0);
  hair.scale.set(1.0, 0.5, 1.0);
  g.add(hair);

  return g;
}

// ==================== Shared materials + geometries ====================
//
// Per the threejs-materials skill ("same material = batched draw calls")
// and threejs-geometry skill ("reuse geometries"). Every Sugar Shack
// previously created ~20 fresh MeshStandardMaterials and many duplicate
// geometries. Hoisting the static ones here means N shacks share ONE
// allocation and three.js can batch their draws.
const SHACK_MATS = {
  wood:         new THREE.MeshStandardMaterial({ color: 0x5a3920, roughness: 0.78, flatShading: true }),
  darkWood:     new THREE.MeshStandardMaterial({ color: 0x6b513a, roughness: 0.7,  flatShading: true }),
  dark:         new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.5,  metalness: 0.4,  flatShading: true }),
  chrome:       new THREE.MeshStandardMaterial({ color: 0xc8c8c8, roughness: 0.35, metalness: 0.75, flatShading: true }),
  bulb:         new THREE.MeshStandardMaterial({ color: 0xfff6c0, emissive: 0xffe066, emissiveIntensity: 2.6, roughness: 0.2 }),
  white:        new THREE.MeshStandardMaterial({ color: 0xfff8eb, roughness: 0.88, flatShading: true, side: THREE.DoubleSide }),
  tentPole:     new THREE.MeshStandardMaterial({ color: 0xe5e0d0, roughness: 0.7,  flatShading: true }),
  facadePole:   new THREE.MeshStandardMaterial({ color: 0x6b513a, roughness: 0.75, flatShading: true }),
  counterBoard: new THREE.MeshStandardMaterial({ color: 0xc8b896, roughness: 0.85, flatShading: true }),
  counterTop:   new THREE.MeshStandardMaterial({ color: 0x6b513a, roughness: 0.6,  flatShading: true }),
  station:      new THREE.MeshStandardMaterial({ color: 0xa9adb0, roughness: 0.4,  metalness: 0.55, flatShading: true }),
  grillTop:     new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.55, flatShading: true }),
  supply:       new THREE.MeshStandardMaterial({ color: 0xd4c8a8, roughness: 0.8,  flatShading: true }),
  stringBulb:   new THREE.MeshStandardMaterial({ color: 0xfff0c0, emissive: 0xffe066, emissiveIntensity: 1.2, roughness: 0.4 }),
};
const STRING_BULB_GEO = new THREE.SphereGeometry(0.07, 8, 6);
const SUPPLY_CAN_GEO  = new THREE.CylinderGeometry(0.12, 0.12, 0.32, 12);

// Light bracket — a TRIANGULAR FRAME (two wooden poles, not a solid plate)
// projecting forward from the banner side, meeting at an apex point in
// front. A chrome work light hangs at the apex, dome opening facing back
// at the sign so it spotlights the banner at night.
//
// Geometry, all in the YZ plane at the bracket's local X=0:
//   - top pole: from (0, 0, 0)            to (0, -bannerH/2, FORWARD)
//   - bottom pole: from (0, -bannerH, 0)  to (0, -bannerH/2, FORWARD)
//   - apex (light fixture): (0, -bannerH/2, FORWARD)
//
// The bracket's origin (top vertex) attaches at the banner's top corner.
// `bannerHeight` is needed so the bottom pole reaches the banner's
// bottom corner — the wedge spans the full sign height.
function buildLightBracket(bannerHeight, side) {
  const g = new THREE.Group();

  const FORWARD = 0.45;      // distance from the banner to the front apex
  const POLE_R = 0.028;      // wooden pole radius
  // Tilt the fixture inward toward sign center — straight-back aims at the
  // banner's outer edge, which only lights the corner. ~40° inward lets the
  // beam land on the bulk of the sign. AIM_ANGLE = side * (PI/4.5):
  //   side=-1 (left mount) → negative rotation → opening rotates toward +X
  //   side=+1 (right mount) → positive rotation → opening rotates toward -X
  // Both end up aiming inward toward the banner center.
  const AIM_ANGLE = side * (Math.PI / 4.5);

  // Shared materials (one allocation per process, see SHACK_MATS above).
  const woodMat   = SHACK_MATS.wood;
  const darkMat   = SHACK_MATS.dark;
  const chromeMat = SHACK_MATS.chrome;
  const bulbMat   = SHACK_MATS.bulb;

  // Helper — build a cylindrical pole between two Vector3 endpoints.
  const upY = new THREE.Vector3(0, 1, 0);
  function pole(start, end) {
    const vec = end.clone().sub(start);
    const len = vec.length();
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(POLE_R, POLE_R, len, 8),
      woodMat,
    );
    mesh.position.copy(start).addScaledVector(vec, 0.5);
    mesh.quaternion.setFromUnitVectors(upY, vec.clone().normalize());
    // No castShadow on these thin bracket poles — the shadow contribution
    // is invisible at their scale, and skipping the shadow-map render for
    // them is one of the cheap wins from the threejs-lighting skill's
    // "selective shadows" guidance (small objects often don't need to cast).
    return mesh;
  }

  const topCorner = new THREE.Vector3(0,  0,              0);
  const botCorner = new THREE.Vector3(0, -bannerHeight,    0);
  const apex      = new THREE.Vector3(0, -bannerHeight / 2, FORWARD);

  g.add(pole(topCorner, apex));
  g.add(pole(botCorner, apex));

  // Light fixture lives in a sub-group anchored at the apex and rotated
  // inward as a whole, so the head + dome + bulb all aim together.
  const fixture = new THREE.Group();
  fixture.position.copy(apex);
  fixture.rotation.y = AIM_ANGLE;
  g.add(fixture);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.07, 0.10), darkMat);
  head.position.set(0, 0, -0.02);
  fixture.add(head);

  // Dome opens along the fixture's local -Z (after the inward rotation,
  // that's "inward + back at the sign"). Small chrome detail — no shadow.
  const dome = new THREE.Mesh(
    new THREE.ConeGeometry(0.11, 0.20, 16), chromeMat,
  );
  dome.rotation.x = Math.PI / 2;
  dome.position.set(0, 0, -0.16);
  fixture.add(dome);

  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10), bulbMat);
  bulb.position.set(0, 0, -0.23);
  fixture.add(bulb);

  // Real SpotLight — shines from the bulb along fixture-local -Z (after the
  // inward rotation, that direction lands on the banner). The target is
  // also parented to the fixture, so it rotates with the rest of the
  // assembly — the cone tracks wherever the fixture aims. PERF-gated so
  // low-tier devices skip these lights and rely on the bulb's emissive +
  // bloom alone.
  if (PERF.contextLights) {
    const spot = new THREE.SpotLight(
      0xfff0c4,         // warm tungsten
      5.0,              // intensity
      4.5,              // distance — comfortably past the far edge of the sign
      Math.PI / 3.8,    // half-angle (~47°, ~94° full cone)
      0.6,              // penumbra — wide soft edge so cones blend across center
      0.8,              // decay — slow falloff so the inner banner stays lit
    );
    spot.position.set(0, 0, -0.22);
    spot.castShadow = false;
    const spotTarget = new THREE.Object3D();
    spotTarget.position.set(0, 0, -2.0);
    fixture.add(spotTarget);
    spot.target = spotTarget;
    fixture.add(spot);
    // Distance-cull from the global manager so spots ignore frames where
    // the player is nowhere near the shack.
    registerContextLight(spot);
  }

  return g;
}

// Make a thin "wood board with a printed front" — solves the z-fighting we
// had when we layered a textured PlaneGeometry on top of a BoxGeometry back.
// Material array order on BoxGeometry: [+X, -X, +Y, -Y, +Z, -Z]. The front
// face is +Z (index 4); everything else uses the wood-edge material.
function buildSignedBoard(width, height, depth, frontTex, edgeColor, opts = {}) {
  const edgeMat = new THREE.MeshStandardMaterial({
    color: edgeColor, roughness: 0.75, flatShading: true,
  });
  // `opts.glow` makes the front self-illuminate using the texture itself as
  // the emissive map — the painted background glows while dark ink stays
  // dark, mimicking a real sign lit from outside. `opts.glowColor` tints the
  // glow (warm tungsten by default).
  const frontMat = new THREE.MeshStandardMaterial({
    map: frontTex, roughness: 0.9,
    emissive: opts.glow ? (opts.glowColor || 0xffe0a0) : 0x000000,
    emissiveMap: opts.glow ? frontTex : null,
    emissiveIntensity: opts.glow || 0,
  });
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    [edgeMat, edgeMat, edgeMat, edgeMat, frontMat, edgeMat],
  );
  // Signed boards are thin flat planes facing the customer — the cast
  // shadow on the ground is a tiny dark line that doesn't read at game
  // scale. Skip the shadow-map render for them (selective shadows, per
  // threejs-lighting skill).
  return mesh;
}

// ==================== Build geometry ====================

function buildSideWall(material, sign) {
  const x = sign * WIDTH / 2;
  const hz = DEPTH / 2;
  const verts = new Float32Array([
    x, 0,      hz,
    x, WALL_H, hz,
    x, WALL_H,-hz,
    x, 0,     -hz,
  ]);
  const idx = sign > 0
    ? [0, 3, 1,  1, 3, 2]
    : [0, 1, 3,  1, 2, 3];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// Counter dimensions hoisted so the facade-build can use COUNTER_H to size
// the side panels (which bottom out at the counter top).
const COUNTER_H = 1.05;
const COUNTER_D = 0.65;

export function buildSugarShack(rng = Math.random) {
  const g = new THREE.Group();
  g.userData.kind = 'sugarShack';

  // Shared across all shacks; see SHACK_MATS at module top.
  const whiteMat      = SHACK_MATS.white;
  const poleMat       = SHACK_MATS.tentPole;
  const facadePoleMat = SHACK_MATS.facadePole;

  // ---------------------- TENT (behind the facade) ----------------------

  // Corner + mid poles along the long sides + back ridge support.
  // No castShadow on the poles — they're 16cm thin and their shadow
  // contribution under the tent canopy is invisible.
  const POLE_T = 0.16;
  for (const sz of [-DEPTH / 2, 0, DEPTH / 2]) {
    for (const sx of [-WIDTH / 2, WIDTH / 2]) {
      const pole = new THREE.Mesh(new THREE.BoxGeometry(POLE_T, WALL_H, POLE_T), poleMat);
      pole.position.set(sx, WALL_H / 2, sz);
      g.add(pole);
    }
  }
  const ridgePost = new THREE.Mesh(
    new THREE.BoxGeometry(POLE_T, PEAK_H, POLE_T),
    poleMat,
  );
  ridgePost.position.set(0, PEAK_H / 2, -DEPTH / 2);
  g.add(ridgePost);

  // Long-side walls.
  g.add(buildSideWall(whiteMat, -1));
  g.add(buildSideWall(whiteMat,  1));

  // Roof panels.
  const hyp = Math.sqrt((WIDTH / 2) ** 2 + ROOF_RISE ** 2);
  const roofAngle = Math.atan2(ROOF_RISE, WIDTH / 2);
  const ROOF_T = 0.08;
  const roofGeo = new THREE.BoxGeometry(hyp + 0.1, ROOF_T, DEPTH + 0.4);
  const rightPanel = new THREE.Mesh(roofGeo, whiteMat);
  rightPanel.position.set(WIDTH / 4, WALL_H + ROOF_RISE / 2, 0);
  rightPanel.rotation.z = -roofAngle;
  rightPanel.castShadow = true;
  g.add(rightPanel);
  const leftPanel = new THREE.Mesh(roofGeo, whiteMat);
  leftPanel.position.set(-WIDTH / 4, WALL_H + ROOF_RISE / 2, 0);
  leftPanel.rotation.z = roofAngle;
  leftPanel.castShadow = true;
  g.add(leftPanel);

  // Back gable triangle (front stays open — facade obscures it from view).
  const backGableVerts = new Float32Array([
    -WIDTH / 2, WALL_H, -DEPTH / 2,
     WIDTH / 2, WALL_H, -DEPTH / 2,
            0, PEAK_H, -DEPTH / 2,
  ]);
  const backGableGeo = new THREE.BufferGeometry();
  backGableGeo.setAttribute('position', new THREE.BufferAttribute(backGableVerts, 3));
  backGableGeo.setIndex([0, 1, 2]);
  backGableGeo.computeVertexNormals();
  const backGable = new THREE.Mesh(backGableGeo, whiteMat);
  backGable.castShadow = true;
  g.add(backGable);

  // ---------------------- FACADE (in front of tent) ----------------------

  // Two tall vertical posts that hold the banner + menu plank + side
  // panels. Each post extends from the ground to FACADE_HEIGHT, which is
  // above the tent peak so the banner clears it.
  const FP_T = 0.18;
  for (const sx of [-FACADE_WIDTH / 2, FACADE_WIDTH / 2]) {
    const post = new THREE.Mesh(
      new THREE.BoxGeometry(FP_T, FACADE_HEIGHT, FP_T),
      facadePoleMat,
    );
    post.position.set(sx, FACADE_HEIGHT / 2, FACADE_Z);
    // Slim post — skip shadow casting.
    g.add(post);
  }

  // All facade signage is a thin solid board with the printed face on +Z.
  // Each board's center sits forward of FACADE_Z by half its depth so the
  // BACK of the board lines up with the facade plane.
  const SIGN_DEPTH = 0.12;
  const SIGN_Z = FACADE_Z + SIGN_DEPTH / 2;

  // ---- Menu plank ----
  // Built first so the banner can stack directly on top of it.
  const plankW = FACADE_WIDTH - 0.3;
  const plankH = 0.95;
  const plankY = WALL_H + 0.55;
  const plank = buildSignedBoard(plankW, plankH, SIGN_DEPTH, buildMenuPlankTexture(), 0x5a3920);
  plank.position.set(0, plankY, SIGN_Z);
  g.add(plank);

  // ---- Top banner ----
  // Bottom of the banner sits flush against the top of the menu plank (no
  // gap) so the SUGAR SHACK header and the menu items read as one unit,
  // matching the reference photo.
  const bannerW = plankW;
  const bannerH = 1.4;
  const bannerY = plankY + plankH / 2 + bannerH / 2;
  // No emissive on the banner — the two SpotLights inside the brackets
  // light it for real. The banner reads as "lit by the work lights" at
  // night via actual directional illumination, not by self-glow.
  const banner = buildSignedBoard(
    bannerW, bannerH, SIGN_DEPTH,
    buildHeaderBannerTexture(), 0x6b513a,
  );
  banner.position.set(0, bannerY, SIGN_Z);
  g.add(banner);

  // ---- DRINKS + FOOD side panels ----
  // Shrunk so their BOTTOMS sit at the counter top (matching the photo —
  // they hang from beside the menu plank down to roughly counter height,
  // not all the way to the ground).
  const sidePanelW = 1.3;
  const sidePanelTop = plankY - plankH / 2 - 0.05;          // just under the menu plank
  const sidePanelBot = COUNTER_H + 0.05;                    // bottom at counter
  const sidePanelH = sidePanelTop - sidePanelBot;
  const sidePanelY = (sidePanelTop + sidePanelBot) / 2;

  const drinksPanel = buildSignedBoard(
    sidePanelW, sidePanelH, SIGN_DEPTH,
    buildPriceListTexture('drinks', 'DRINKS', DRINKS_ITEMS, sidePanelW, sidePanelH),
    0xfff4d0,
  );
  drinksPanel.position.set(
    -FACADE_WIDTH / 2 + sidePanelW / 2 + 0.15,
    sidePanelY,
    SIGN_Z,
  );
  g.add(drinksPanel);

  const foodPanel = buildSignedBoard(
    sidePanelW, sidePanelH, SIGN_DEPTH,
    buildPriceListTexture('food', 'FOOD', FOOD_ITEMS, sidePanelW, sidePanelH),
    0xfff4d0,
  );
  foodPanel.position.set(
    FACADE_WIDTH / 2 - sidePanelW / 2 - 0.15,
    sidePanelY,
    SIGN_Z,
  );
  g.add(foodPanel);

  // ---- Counter (inside the tent, behind the menu plank) ----
  const counter = new THREE.Mesh(
    new THREE.BoxGeometry(WIDTH - 0.4, COUNTER_H, COUNTER_D),
    SHACK_MATS.counterBoard,
  );
  counter.position.set(0, COUNTER_H / 2, DEPTH / 2 - COUNTER_D / 2);
  // Counter sits inside the tent — its cast shadow falls onto the tent
  // floor (which the sun-light barely reaches anyway). Keep receiveShadow
  // so the tent roof's shadow lands on it; skip castShadow.
  counter.receiveShadow = true;
  g.add(counter);
  const counterTop = new THREE.Mesh(
    new THREE.BoxGeometry(WIDTH - 0.3, 0.08, COUNTER_D + 0.1),
    SHACK_MATS.counterTop,
  );
  counterTop.position.set(0, COUNTER_H + 0.04, DEPTH / 2 - COUNTER_D / 2);
  g.add(counterTop);

  // ---- Pink THANK YOU banner on the counter face ----
  const thankTex = buildThankYouBannerTexture();
  const thankBanner = new THREE.Mesh(
    new THREE.PlaneGeometry(WIDTH - 0.6, 0.7),
    new THREE.MeshStandardMaterial({
      map: thankTex, roughness: 0.95, side: THREE.DoubleSide,
    }),
  );
  thankBanner.position.set(0, COUNTER_H / 2, DEPTH / 2 + 0.02);
  g.add(thankBanner);

  // ---- Interior cooking stations against the side walls ----
  // Stations line both long walls so the center stays clear as a worker
  // walkway. Each station's long axis runs along Z (parallel to the wall),
  // so the cooking surface faces inward toward the walkway.
  const stationMat  = SHACK_MATS.station;
  const grillTopMat = SHACK_MATS.grillTop;
  const STATION_W = 0.85;    // X — depth-from-wall
  const STATION_H = 1.0;     // Y
  const STATION_L = 1.4;     // Z — long axis along the wall
  const stationZs = [
    DEPTH / 2 - COUNTER_D - 1.2,   // front station (just behind counter)
    DEPTH / 2 - COUNTER_D - 3.4,   // back station
  ];
  for (const sx of [-WIDTH / 2 + STATION_W / 2 + 0.05, WIDTH / 2 - STATION_W / 2 - 0.05]) {
    for (const sz of stationZs) {
      const station = new THREE.Mesh(
        new THREE.BoxGeometry(STATION_W, STATION_H, STATION_L),
        stationMat,
      );
      station.position.set(sx, STATION_H / 2, sz);
      // Inside the tent — cast shadow is hidden by the tent shadow anyway.
      g.add(station);
      const top = new THREE.Mesh(
        new THREE.BoxGeometry(STATION_W - 0.1, 0.08, STATION_L - 0.1),
        grillTopMat,
      );
      top.position.set(sx, STATION_H + 0.04, sz);
      g.add(top);
    }
  }
  // Supplies / cans sitting on the back of the counter — workers reach over
  // for these as they take orders. All 5 cans per shack share the same
  // cylinder geometry + material (shared module-level constants).
  for (let i = 0; i < 5; i++) {
    const can = new THREE.Mesh(SUPPLY_CAN_GEO, SHACK_MATS.supply);
    can.position.set(-1.0 + i * 0.25, COUNTER_H + 0.24, DEPTH / 2 - COUNTER_D + 0.15);
    g.add(can);
  }

  // ---- Workers ----
  // Two figures inside the tent, in the center walkway, facing the customer
  // (+Z). Tom on the left near the counter, the apron cook deeper inside
  // working a back station.
  const tom = buildTom();
  tom.rotation.y = Math.PI;                                // face +Z (customer)
  tom.position.set(-0.45, 0, DEPTH / 2 - COUNTER_D - 0.6);
  g.add(tom);

  const cook = buildApronCook(rng);
  cook.rotation.y = Math.PI - 0.2;                         // turned slightly so the two don't look identical
  cook.position.set(0.45, 0, DEPTH / 2 - COUNTER_D - 2.4);
  g.add(cook);

  // ---- String lights along each long tent eave ----
  // All 20 bulbs share the same sphere geometry + emissive material
  // (module-level constants). Same draw call gets batched on the GPU.
  const lightCount = 10;
  for (let i = 0; i < lightCount; i++) {
    const t = (i + 0.5) / lightCount;
    const z = -DEPTH / 2 + DEPTH * t;
    for (const sx of [-WIDTH / 2 + 0.05, WIDTH / 2 - 0.05]) {
      const bulb = new THREE.Mesh(STRING_BULB_GEO, SHACK_MATS.stringBulb);
      bulb.position.set(sx, WALL_H - 0.05, z);
      g.add(bulb);
      // Fancy-lights opt-in: real PointLight per bulb. Each is tiny —
      // short distance, low intensity — so 20 of them together approximate
      // a soft string-light wash instead of doubling up on the proxy.
      if (PERF.fancyLights) {
        const bulbLight = new THREE.PointLight(0xfff0c0, 0.18, 1.6, 1.5);
        bulbLight.position.copy(bulb.position);
        bulbLight.castShadow = false;
        g.add(bulbLight);
        registerContextLight(bulbLight);
      }
    }
  }
  // One PointLight stands in for the cumulative glow of all 20 bulbs along
  // both eaves. A real light per bulb would be ~40 lights per shack — way
  // too many. This single light is hung at front-center of the tent so it
  // catches the workers, the counter back, and the front grills; the
  // distance falloff handles the dark deep-back corners. PERF-gated.
  if (PERF.contextLights) {
    const interiorGlow = new THREE.PointLight(
      0xfff0c0,        // matches the bulb color
      1.8,             // moderate — present at night, not overpowering at noon
      5.0,             // distance
      1.0,             // decay
    );
    interiorGlow.position.set(0, WALL_H - 0.3, DEPTH / 2 - 2.0);
    interiorGlow.castShadow = false;
    g.add(interiorGlow);
    registerContextLight(interiorGlow);
  }
  // Light brackets — triangular wooden FRAMES (two poles meeting at an
  // apex point in front of the sign) at the left and right of the banner.
  // A chrome work light hangs at each apex, aimed back at the banner.
  // Origin of the bracket = top corner of the banner; wedge spans the
  // full banner height down to the bottom corner.
  for (const side of [-1, 1]) {
    const bracket = buildLightBracket(bannerH, side);
    bracket.position.set(
      side * (bannerW / 2 + 0.02),                 // just outside banner edge
      bannerY + bannerH / 2,                       // top corner of banner
      FACADE_Z + SIGN_DEPTH,                       // banner front face
    );
    g.add(bracket);
  }

  // Tiny per-instance rotation jitter so two side-by-side shacks don't look
  // like exact clones.
  g.rotation.y = (rng() - 0.5) * 0.02;

  return g;
}
