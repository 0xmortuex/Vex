// Shared by the theme contrast tests: every built-in theme's tokens as the
// window resolves them (theme-tokens.css + theme-extra.css) and as the New Tab
// page does (start.html's own copy), plus WCAG contrast maths.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const css = (f) => fs.readFileSync(path.join(ROOT, 'src/renderer/css', f), 'utf8');
const tokensCss = (css('theme-tokens.css') + '\n' + css('theme-extra.css')).replace(/\/\*[\s\S]*?\*\//g, '');
const startHtml = fs.readFileSync(path.join(ROOT, 'src/renderer/start.html'), 'utf8');
const startStyle = startHtml.slice(0, startHtml.indexOf('</style>')).replace(/\/\*[\s\S]*?\*\//g, '');
const { ThemeManager } = require(path.join(ROOT, 'src/renderer/js/theme-manager.js'));

function decls(body) {
  const out = {};
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
// Every top-level block whose selector list holds exactly `sel`.
function blocksFor(src, sel) {
  const out = {};
  for (const m of src.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].split(',').map(s => s.trim()).includes(sel)) Object.assign(out, decls(m[2]));
  }
  return out;
}
function chromeTokens(id) {
  const t = { ...blocksFor(tokensCss, ':root') };
  if (id !== 'oxford') Object.assign(t, blocksFor(tokensCss, 'html[data-theme]:not([data-theme="oxford"])'));
  Object.assign(t, blocksFor(tokensCss, `[data-theme="${id}"]`));
  return t;
}
function startTokens(id) {
  return { ...blocksFor(startStyle, ':root'), ...blocksFor(startStyle, `[data-theme="${id}"]`) };
}

function hex(v) {
  v = String(v || '').trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(v);
  if (m) v = '#' + m[1].replace(/./g, c => c + c);
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(v);
  if (m) return { r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16), b: parseInt(m[1].slice(4, 6), 16), a: m[2] ? parseInt(m[2], 16) / 255 : 1 };
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(v);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
  return null;
}
const lum = (c) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
function ratio(fg, bg) {
  const a = typeof fg === 'string' ? hex(fg) : fg, b = typeof bg === 'string' ? hex(bg) : bg;
  const x = lum(a.a < 1 ? over(a, b) : a) + 0.05, y = lum(b) + 0.05;
  return x > y ? x / y : y / x;
}

const IDS = ThemeManager.THEMES.map(t => t.id);

module.exports = { ROOT, IDS, ThemeManager, tokensCss, startHtml, startStyle, chromeTokens, startTokens, hex, ratio, over };
