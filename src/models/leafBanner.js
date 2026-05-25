// Cached "LEAF" banner texture used on the entrance arch and the main stage.
// Two textures per (textColor, bgColor) pair: a diffuse map + an emissive map.

import * as THREE from 'three';

const _cache = new Map();

function makeOne(textColor, bgColor) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 256;
  const cx = c.getContext('2d');

  cx.fillStyle = bgColor;
  cx.fillRect(0, 0, c.width, c.height);

  cx.strokeStyle = 'rgba(0,0,0,0.18)';
  cx.lineWidth = 8;
  cx.strokeRect(8, 8, c.width - 16, c.height - 16);

  cx.fillStyle = textColor;
  cx.font = 'bold 200px "Trebuchet MS", "Helvetica Neue", Helvetica, Arial, sans-serif';
  cx.textAlign = 'center';
  cx.textBaseline = 'middle';
  cx.fillText('LEAF', c.width / 2, c.height / 2 + 8);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export function leafBannerTexture(textColor, bgColor) {
  const key = `${textColor}|${bgColor}`;
  if (_cache.has(key)) return _cache.get(key);
  const tex = makeOne(textColor, bgColor);
  _cache.set(key, tex);
  return tex;
}

// Returns the diffuse + emissive pair the stage / arch builders consume.
export function leafBannerTextures(textColor, bgColor, emissiveColor) {
  return {
    diffuse: leafBannerTexture(textColor, bgColor),
    emissive: leafBannerTexture(emissiveColor, '#000000'),
  };
}
