// The theme, the look and the font as the interface sends them (js/folder-viewer-host.js themePayload).

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
  const langChanged = payload.lang ? setLang(payload.lang) : false;
  refreshScheme();
  for (const fn of listeners) { try { fn(langChanged); } catch (err) { console.error('[Folder browser] a theme listener failed:', err); } }
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
const toHex = (rgb) => '#' + rgb.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('');
function cssColor(expression) {
  const el = document.createElement('span');
  el.style.color = expression;
  el.style.display = 'none';
  document.body.appendChild(el);
  const value = getComputedStyle(el).color;
  el.remove();
  return value;
}
function luminance([r, g, b]) {
  const lin = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrast(a, b) { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); }

// Whether the interface is dark right now, by the colour of its surface and not by the theme's name (a light browser look over a dark theme is light).
export function interfaceIsDark() { return luminance(resolveColor(cssColor('var(--fv-surface)'))) < 0.4; }

export function refreshScheme() {
  const dark = interfaceIsDark();
  document.body.dataset.dark = dark ? 'true' : 'false';
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  // The text on the accent colour: white or near black, whichever reads better; when even that is under 4.7:1 the accent used as a
  // background is darkened (for white text) or lightened (for dark text) until it reads.
  const accent = resolveColor(cssColor('var(--fv-accent)')).slice(0, 3);
  const white = [255, 255, 255], ink = [17, 19, 24];
  const useWhite = contrast(accent, white) >= contrast(accent, ink);
  const text = useWhite ? white : ink;
  let bg = accent;
  for (let guard = 0; contrast(bg, text) < 4.7 && guard < 40; guard++) bg = bg.map((v) => Math.round(useWhite ? v * 0.94 : v + (255 - v) * 0.08));
  const root = document.documentElement.style;
  root.setProperty('--fv-on-accent', useWhite ? '#ffffff' : '#111318');
  root.setProperty('--fv-accent-bg', bg === accent ? 'var(--fv-accent)' : toHex(bg));
}
