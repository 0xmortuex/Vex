// The theme, the look and the font as the interface sends them (js/webview.js pdfThemePayload), and the colours the marks use.

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
  for (const fn of listeners) { try { fn(); } catch (err) { console.error('[PDF viewer] a theme listener failed:', err); } }
}

let probe = null;
function canvasContext() {
  if (!probe) { probe = document.createElement('canvas'); probe.width = probe.height = 1; }
  return probe.getContext('2d', { willReadFrequently: true });
}

// Any CSS colour (rgb(), hex, color-mix(), color(srgb ...)) -> [r, g, b, a] in 0..255. Resolved by the engine itself.
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

// Whether the interface is dark RIGHT NOW: by the colour of its surface, not by the theme's name, because a browser look in
// its own colours (Firefox light over a dark theme) is light whatever the theme is.
export function interfaceIsDark() {
  return luminance(resolveColor(cssColor('var(--pv-surface)'))) < 0.4;
}

function refreshScheme() {
  document.body.dataset.dark = interfaceIsDark() ? 'true' : 'false';
  document.documentElement.style.colorScheme = interfaceIsDark() ? 'dark' : 'light';
}
export { refreshScheme };

// The colours a mark can be: tokens of the theme, resolved to a fixed hex when the mark is made (so a saved copy and the mark on
// screen stay the same colour if the theme changes later). `yellow` is the theme's warning colour pulled toward a highlighter.
export const SWATCHES = [
  { id: 'yellow', css: 'color-mix(in srgb, var(--vex-warning, #c2611a) 40%, #ffe44d)', name: 'Yellow' },
  { id: 'accent', css: 'var(--pv-accent)', name: 'Accent' },
  { id: 'success', css: 'var(--success, var(--vex-success, #2f6b3f))', name: 'Green' },
  { id: 'danger', css: 'var(--pv-danger)', name: 'Red' },
  { id: 'warning', css: 'var(--vex-warning, #c2611a)', name: 'Orange' },
  // Ink is the one fixed colour: the page it is written on is white (or dimmed to look dark), whatever the theme's text colour is.
  { id: 'ink', css: '#14161a', name: 'Ink' },
];
export function swatchHex(id) {
  const s = SWATCHES.find((x) => x.id === id) || SWATCHES[0];
  return toHex(resolveColor(cssColor(s.css)));
}
// A line, a note or a shape is drawn on a white page: a theme colour that is pale (a dark theme's accent) is darkened until it reads there.
export function onPaper(hex) {
  const rgb = resolveColor(hex);
  if (luminance(rgb) <= 0.4) return hex;
  return toHex(rgb.slice(0, 3).map((v) => Math.round(v * 0.55)));
}
