// ===== BOMB ICONS THEME =====
// Manages bomb display theme: 'letters' (default) or 'icons' (SVG)

const BOMB_THEME_STORAGE_KEY = 'tetrinet_bombtheme';

// SVG inner content for each bomb type (viewBox="0 0 16 16", uses currentColor)
const BOMB_ICONS = {
  a: '<rect x="1" y="12.5" width="14" height="2.5" rx="1" fill="currentColor"/><rect x="7" y="2" width="2" height="8" fill="currentColor"/><rect x="3" y="5.5" width="10" height="2" fill="currentColor"/>',
  c: '<rect x="1" y="12.5" width="14" height="2.5" rx="1" fill="currentColor"/><rect x="3" y="6.5" width="10" height="2" fill="currentColor"/>',
  b: '<rect x="6.5" y="1" width="3" height="1.5" rx="0.5" fill="currentColor"/><rect x="1.5" y="2.5" width="13" height="2" rx="0.5" fill="currentColor"/><polygon points="3.5,4.5 12.5,4.5 12,14.5 4,14.5" fill="currentColor"/>',
  r: '<path d="M5.5 5.5 Q5.5 2 8 2 Q11 2 11 5 Q11 7 8 8 L8 10" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="8" cy="13" r="1.2" fill="currentColor"/>',
  o: '<circle cx="7.5" cy="10" r="5.5" fill="currentColor"/><path d="M7.5 4.5 Q10 1.5 13 3" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/><circle cx="13.2" cy="2.8" r="1.3" fill="currentColor"/>',
  q: '<polyline points="1,8 3,4 5,11 7.5,5 10,9.5 12.5,6 15,8" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  g: '<circle cx="8" cy="3.5" r="2" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="7.2" y="5.2" width="1.6" height="1" fill="currentColor"/><polygon points="4,6.5 12,6.5 14,15 2,15" fill="currentColor"/>',
  s: '<path d="M2 6 Q8 1 14 6" stroke="currentColor" stroke-width="1.8" fill="none"/><polygon points="14,3 15.5,6.5 11.5,6.5" fill="currentColor"/><path d="M14 10 Q8 15 2 10" stroke="currentColor" stroke-width="1.8" fill="none"/><polygon points="2,13 0.5,9.5 4.5,9.5" fill="currentColor"/>',
  n: '<path d="M 6.75 5.84 L 4.75 2.37 A 6.5 6.5 0 0 1 11.25 2.37 L 9.25 5.84 A 2.5 2.5 0 0 0 6.75 5.84 Z" fill="currentColor"/><path d="M 10.5 8 L 14.5 8 A 6.5 6.5 0 0 1 11.25 13.63 L 9.25 10.17 A 2.5 2.5 0 0 0 10.5 8 Z" fill="currentColor"/><path d="M 6.75 10.17 L 4.75 13.63 A 6.5 6.5 0 0 1 1.5 8 L 5.5 8 A 2.5 2.5 0 0 0 6.75 10.17 Z" fill="currentColor"/><circle cx="8" cy="8" r="2.2" fill="currentColor"/>',
};

// Bomb colors (for icon fill via CSS currentColor in HUD, and for canvas background)
const BOMB_ICON_COLORS = {
  a: '#ff1744',
  c: '#00e676',
  b: '#40c4ff',
  r: '#ff9100',
  o: '#ff6d00',
  q: '#e040fb',
  g: '#64dd17',
  s: '#00e5ff',
  n: '#ffffff',
};

// Darkened backgrounds for canvas cells in icon theme
const BOMB_ICON_BG = {
  a: '#c01030',
  c: '#007a40',
  b: '#1a6090',
  r: '#a05500',
  o: '#a04000',
  q: '#7a1aaa',
  g: '#3a7a00',
  s: '#007080',
  n: '#555555',
};

// ===== IMAGE CACHE FOR CANVAS RENDERING =====
const _bombImgCache = {};

function getBombImg(sp) {
  if (_bombImgCache[sp]) return _bombImgCache[sp];
  const color = BOMB_ICON_COLORS[sp] || '#ffffff';
  const inner = BOMB_ICONS[sp] || '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" style="color:${color}">${inner}</svg>`;
  const img = new Image();
  img.src = 'data:image/svg+xml,' + encodeURIComponent(svg);
  _bombImgCache[sp] = img;
  return img;
}

// ===== DOM ELEMENT FACTORY FOR HUD =====
function makeBombIconEl(sp, sizePx) {
  const color = BOMB_ICON_COLORS[sp] || '#ffffff';
  const inner = BOMB_ICONS[sp] || '';
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width',  sizePx);
  svg.setAttribute('height', sizePx);
  svg.style.color = color;
  svg.style.display = 'block';
  svg.style.flexShrink = '0';
  svg.innerHTML = inner;
  return svg;
}

// ===== THEME PERSISTENCE =====
function loadBombTheme() {
  return localStorage.getItem(BOMB_THEME_STORAGE_KEY) || 'letters';
}

function saveBombTheme(t) {
  localStorage.setItem(BOMB_THEME_STORAGE_KEY, t);
}

// Global variable read by render.js and ui.js
const bombTheme = loadBombTheme();
