// The theme, the look and the font as the interface sends them (js/webview.js officeThemePayload), and a few colour helpers.

import { setLang } from './strings.js';

const listeners = new Set();
export function onThemeChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

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
  for (const fn of listeners) { try { fn(); } catch (err) { console.error('[Document viewer] a theme listener failed:', err); } }
}

let probe = null;
function canvasContext() {
  if (!probe) { probe = document.createElement('canvas'); probe.width = probe.height = 1; }
  return probe.getContext('2d', { willReadFrequently: true });
}

// Any CSS colour (rgb(), hex, color-mix(), color(srgb ...)) -> [r, g, b, a] in 0..255, resolved by the engine itself.
export function resolveColor(css) {
  const ctx = canvasContext();
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = '#000';
  ctx.fillStyle = String(css);
  ctx.fillRect(0, 0, 1, 1);
  const d = ctx.getImageData(0, 0, 1, 1).data;
  return [d[0], d[1], d[2], d[3]];
}
export const toHex = (rgb) => '#' + rgb.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('');

// The colour a var() or any expression comes to on the page, as the engine computes it.
export function cssColor(expression) {
  const node = document.createElement('span');
  node.style.color = expression;
  node.style.display = 'none';
  document.body.appendChild(node);
  const value = getComputedStyle(node).color;
  node.remove();
  return value;
}

export function luminance([r, g, b]) {
  const lin = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

// Whether the interface is dark RIGHT NOW: by the colour of its surface, not by the theme's name (a browser look in its own
// colours is light whatever the theme is).
export const interfaceIsDark = () => luminance(resolveColor(cssColor('var(--od-surface)'))) < 0.4;
export const surfaceHex = () => toHex(resolveColor(cssColor('var(--od-surface)')));

export function refreshScheme() {
  const dark = interfaceIsDark();
  document.body.dataset.dark = dark ? 'true' : 'false';
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  // The text on the accent colour: white or near black, whichever reads better on it, whatever the theme says.
  const accent = resolveColor(cssColor('var(--od-accent)'));
  const white = [255, 255, 255], ink = [17, 19, 24];
  document.documentElement.style.setProperty('--od-on-accent', contrast(accent, white) >= contrast(accent, ink) ? '#ffffff' : '#111318');
}
