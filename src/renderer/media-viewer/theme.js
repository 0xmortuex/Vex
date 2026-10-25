// The theme, the look and the font as the interface sends them (js/media-viewer-host.js themePayload).

import { setLang } from './strings.js';

const listeners = new Set();
export function onThemeChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

let probe = null;
function canvasContext() {
  if (!probe) { probe = document.createElement('canvas'); probe.width = probe.height = 1; }
  return probe.getContext('2d', { willReadFrequently: true });
}

// Any CSS colour (rgb(), hex, color-mix()) -> [r, g, b, a] in 0..255, resolved by the engine itself.
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

export function cssColor(expression) {
  const el = document.createElement('span');
  el.style.color = expression;
  el.style.display = 'none';
  document.body.appendChild(el);
  const value = getComputedStyle(el).color;
  el.remove();
  return value;
}

export function luminance([r, g, b]) {
  const lin = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
export function contrast(a, b) { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); }

// The text colour on the accent: white or near black, whichever reads better; when even that is under 4.7:1 the accent used as a
// background is darkened (for white text) or lightened (for dark text) until it reads.
export function refreshScheme() {
  const surface = resolveColor(cssColor('var(--mv-surface)'));
  const dark = luminance(surface) < 0.4;
  document.body.dataset.dark = dark ? 'true' : 'false';
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  const accent = resolveColor(cssColor('var(--mv-accent)')).slice(0, 3);
  const white = [255, 255, 255], ink = [17, 19, 24];
  const useWhite = contrast(accent, white) >= contrast(accent, ink);
  const text = useWhite ? white : ink;
  let bg = accent;
  for (let guard = 0; contrast(bg, text) < 4.7 && guard < 40; guard++) bg = bg.map((v) => Math.round(useWhite ? v * 0.94 : v + (255 - v) * 0.08));
  const root = document.documentElement.style;
  root.setProperty('--mv-on-accent', useWhite ? '#ffffff' : '#111318');
  root.setProperty('--mv-accent-bg', bg.every((v, i) => v === accent[i]) ? 'var(--mv-accent)' : toHex(bg));
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
  for (const fn of listeners) { try { fn(); } catch (err) { console.error('[Player] a theme listener failed:', err); } }
}
