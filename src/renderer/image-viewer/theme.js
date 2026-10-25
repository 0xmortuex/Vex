// The theme, the look and the font as the interface sends them (js/image-viewer-host.js imageThemePayload).

import { setLang } from './strings.js';

const listeners = new Set();
export function onThemeChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

let probe = null;
function resolveColor(css) {
  if (!probe) { probe = document.createElement('canvas'); probe.width = probe.height = 1; }
  const ctx = probe.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = '#000';
  ctx.fillStyle = String(css);
  ctx.fillRect(0, 0, 1, 1);
  const d = ctx.getImageData(0, 0, 1, 1).data;
  return [d[0], d[1], d[2]];
}
function luminance([r, g, b]) {
  const lin = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

function cssColor(expression) {
  const node = document.createElement('span');
  node.style.color = expression;
  node.style.display = 'none';
  document.body.appendChild(node);
  const value = getComputedStyle(node).color;
  node.remove();
  return value;
}

// Dark or light by the colour of the interface's surface right now (a browser look can be light over a dark theme), and the
// text colour on the accent: white or near black, whichever reads better.
export function refreshScheme() {
  const dark = luminance(resolveColor(cssColor('var(--iv-chrome)'))) < 0.4;
  document.body.dataset.dark = dark ? 'true' : 'false';
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  const accent = resolveColor(cssColor('var(--iv-accent)'));
  document.documentElement.style.setProperty('--iv-on-accent', contrast(accent, [255, 255, 255]) >= contrast(accent, [17, 19, 24]) ? '#ffffff' : '#111318');
}

// payload: { vars: { '--name': value }, attrs: { 'data-theme': .. }, lang }
export function applyThemePayload(payload) {
  if (!payload || typeof payload !== 'object') return;
  const root = document.documentElement;
  for (const [name, value] of Object.entries(payload.attrs || {})) {
    if (!/^data-[a-z-]+$/.test(name)) continue;
    if (value) root.setAttribute(name, String(value)); else root.removeAttribute(name);
  }
  for (const [name, value] of Object.entries(payload.vars || {})) {
    if (!/^--[a-z0-9-]+$/.test(name)) continue;
    root.style.setProperty(name, String(value));
  }
  if (payload.lang) setLang(payload.lang);
  refreshScheme();
  for (const fn of listeners) { try { fn(); } catch (err) { console.error('[Image viewer] a theme listener failed:', err); } }
}
