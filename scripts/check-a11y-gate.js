#!/usr/bin/env node
// Look matrix and accessibility gate (T2-028): the part that needs no running app.
//
//   node scripts/check-a11y-gate.js            exit 0 clean, 1 findings, 2 harness failure
//   node scripts/check-a11y-gate.js --json     machine-readable
//   node scripts/check-a11y-gate.js --tighten  rewrite the baseline to today's (lower) numbers
//
// scripts/check-ui.js drives the real window and measures it; it needs Electron and a
// free machine, so it cannot be a gate on every push. This reads the style sheets and
// the page that loads them and checks what can be known from text, across the three
// looks (Firefox, Glass, Classic - the gui-*.css sheets) and every colour theme:
//
//   order    a11y.css is the LAST sheet index.html loads (it must win over every look)
//   motion   a11y.css has a prefers-reduced-motion rule that shortens every animation and
//            transition (the universal selector, !important), and no look sheet switches it
//            off again with its own !important animation or transition rule after it
//   focus    a11y.css draws a :focus-visible outline with !important, and no look or theme
//            sheet removes the outline of :focus-visible (outline: none / 0)
//   colour   for each theme block with solid hex colours: text, secondary and muted text
//            against the base, elevated and deep surfaces, at WCAG AA (4.5, 4.5, 4.5)
//
// The colour rule has failures that were there before it; they are listed in
// scripts/a11y-gate-baseline.json with the ratio they have. A listed pair may not get
// worse, an unlisted pair may not fail. The numbers only go up (--tighten).
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CSS_DIR = path.join(ROOT, 'src/renderer/css');
const INDEX = path.join(ROOT, 'src/renderer/index.html');
const BASELINE = path.join(__dirname, 'a11y-gate-baseline.json');
const LOOKS = { firefox: 'gui-browser.css', glass: 'gui-glass.css', classic: 'app.css' };
const MIN = { 'text-primary': 4.5, 'text-secondary': 4.5, 'text-muted': 4.5 };
const SURFACES = ['bg-base', 'bg-elevated', 'bg-deep'];

// ---- colour (pure) ----------------------------------------------------------------
function parseHex(value) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(value || '').trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
}
function luminance([r, g, b]) {
  const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(a, b) {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// ---- reading CSS (pure) -------------------------------------------------------------
function stripComments(css) { return String(css).replace(/\/\*[\s\S]*?\*\//g, ''); }

// Top-level blocks "selector { body }" (nesting inside @media is flattened one level).
function blocks(css) {
  const out = [];
  const src = stripComments(css);
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(src))) out.push({ selector: m[1].trim().replace(/\s+/g, ' '), body: m[2] });
  return out;
}
function vars(body) {
  const v = {};
  for (const m of body.matchAll(/--vex-([a-z0-9-]+)\s*:\s*([^;]+);/gi)) v[m[1]] = m[2].trim();
  return v;
}

// -> { "<theme>": { 'text-primary': '#..', ... } } from every [data-theme="x"] (or :root) block that sets hex colours.
function themeTokens(cssFiles) {
  const themes = {};
  for (const css of cssFiles) {
    for (const b of blocks(css)) {
      for (const sel of b.selector.split(',')) {
        const s = sel.trim();
        const m = /^(?::root|\[data-theme="([^"]+)"\])$/.exec(s);
        if (!m) continue;
        const name = m[1] || 'oxford (root)';
        themes[name] = { ...(themes[name] || {}), ...vars(b.body) };
      }
    }
  }
  return themes;
}

function contrastFindings(themes) {
  const out = [];
  for (const [theme, t] of Object.entries(themes)) {
    for (const [fgName, min] of Object.entries(MIN)) {
      const fg = parseHex(t[fgName]);
      if (!fg) continue;
      for (const bgName of SURFACES) {
        const bg = parseHex(t[bgName]);
        if (!bg) continue;
        const ratio = contrast(fg, bg);
        if (ratio < min) out.push({ key: theme + '|' + fgName + '|' + bgName, theme, fg: fgName, bg: bgName, ratio: Math.round(ratio * 100) / 100, min });
      }
    }
  }
  return out;
}

// Findings after the baseline: a pair listed there may not drop below its ratio.
function applyBaseline(found, baseline) {
  const bad = [], improved = [];
  for (const f of found) {
    const was = baseline[f.key];
    if (was === undefined) bad.push({ check: 'a11y-gate-contrast', message: f.theme + ': ' + f.fg + ' on ' + f.bg + ' is ' + f.ratio + ':1, under ' + f.min + ':1 (not in the baseline)' });
    else if (f.ratio < was - 0.005) bad.push({ check: 'a11y-gate-contrast', message: f.theme + ': ' + f.fg + ' on ' + f.bg + ' got worse, ' + f.ratio + ':1 against ' + was + ':1 in the baseline' });
  }
  const now = new Set(found.map(f => f.key));
  for (const k of Object.keys(baseline)) if (!now.has(k)) improved.push(k);
  return { bad, improved };
}

// ---- the structural rules (pure) ------------------------------------------------------
function sheetOrder(indexHtml) {
  const sheets = [...String(indexHtml).matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)].map(m => m[1]);
  if (!sheets.length) return [{ check: 'a11y-gate-order', message: 'index.html loads no style sheets' }];
  const last = sheets[sheets.length - 1];
  return /(^|\/)a11y\.css$/.test(last) ? [] : [{ check: 'a11y-gate-order', message: 'a11y.css must be the last style sheet; the last one is ' + last }];
}

function motionRule(a11yCss) {
  const css = stripComments(a11yCss);
  const m = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/.exec(css);
  if (!m) return [{ check: 'a11y-gate-motion', message: 'a11y.css has no prefers-reduced-motion: reduce rule' }];
  const body = m[1];
  const out = [];
  if (!/\*\s*,[\s\S]*?\{/.test(body) && !/(^|[\s,])\*\s*\{/.test(body)) out.push({ check: 'a11y-gate-motion', message: 'the reduced-motion rule is not on every element (*)' });
  if (!/animation-duration:[^;]*!important/.test(body)) out.push({ check: 'a11y-gate-motion', message: 'the reduced-motion rule does not shorten animations with !important' });
  if (!/transition-duration:[^;]*!important/.test(body)) out.push({ check: 'a11y-gate-motion', message: 'the reduced-motion rule does not shorten transitions with !important' });
  return out;
}

function focusRule(a11yCss) {
  const css = stripComments(a11yCss);
  const m = /:focus-visible\s*\{([^}]*)\}/.exec(css);
  if (!m || !/outline:[^;]*!important/.test(m[1])) return [{ check: 'a11y-gate-focus', message: 'a11y.css does not draw a :focus-visible outline with !important' }];
  return [];
}

// Selectors that may take the global outline off because the control shows focus another way.
const FOCUS_EXCEPTIONS = [
  { selector: '#url-input:focus-visible', reason: 'the address field draws its own focus ring (#url-bar:has(:focus-visible)); the global outline would be a second ring inside it' },
];

// A look or theme sheet that takes the outline off a :focus-visible element.
function focusRemovals(name, css) {
  const out = [];
  for (const b of blocks(css)) {
    if (!/:focus-visible/.test(b.selector)) continue;
    if (FOCUS_EXCEPTIONS.some(x => b.selector.endsWith(x.selector))) continue;
    if (/outline(-style)?:\s*(none|0)\b[^;]*!important/.test(b.body)) {
      out.push({ check: 'a11y-gate-focus', message: name + ': "' + b.selector.slice(0, 80) + '" removes the focus outline with !important' });
    }
  }
  return out;
}

// Reduced motion must still win over a look: a look sheet with an !important animation or
// transition duration that is not the reduced one would beat the media query only if it came after
// it, which index.html order rules out (order check). What is checked here is the rule that
// would defeat it regardless: "animation-duration: ... !important" inside a look's own media query.
function lookMotion(name, css) {
  const out = [];
  const src = stripComments(css);
  for (const m of src.matchAll(/@media\s*\(prefers-reduced-motion:\s*no-preference\)\s*\{([\s\S]*?)\n\}/g)) {
    if (/!important/.test(m[1])) out.push({ check: 'a11y-gate-motion', message: name + ': a prefers-reduced-motion: no-preference block forces motion with !important' });
  }
  return out;
}

function run({ readFile = (p) => fs.readFileSync(p, 'utf8'), baseline = null } = {}) {
  const findings = [];
  const index = readFile(INDEX);
  findings.push(...sheetOrder(index));
  const a11y = readFile(path.join(CSS_DIR, 'a11y.css'));
  findings.push(...motionRule(a11y), ...focusRule(a11y));
  const looks = {};
  for (const [look, file] of Object.entries(LOOKS)) {
    let css;
    try { css = readFile(path.join(CSS_DIR, file)); }
    catch (err) { findings.push({ check: 'a11y-gate-look', message: 'the ' + look + ' look sheet ' + file + ' could not be read: ' + err.message }); continue; }
    looks[look] = file;
    findings.push(...focusRemovals(file, css), ...lookMotion(file, css));
  }
  const themeFiles = ['theme-tokens.css', 'theme-extra.css'].map(f => readFile(path.join(CSS_DIR, f)));
  for (const f of ['theme-tokens.css', 'theme-extra.css']) findings.push(...focusRemovals(f, readFile(path.join(CSS_DIR, f))));
  const themes = themeTokens(themeFiles);
  const found = contrastFindings(themes);
  const base = baseline || JSON.parse(readFile(BASELINE));
  const { bad, improved } = applyBaseline(found, base);
  findings.push(...bad);
  return { findings, themes: Object.keys(themes).length, looks: Object.keys(looks), contrastFound: found, improved };
}

function main(argv) {
  let res;
  try { res = run(); }
  catch (err) { console.error('[a11y-gate] harness failure:', err.message); return 2; }
  if (argv.includes('--tighten')) {
    const next = {};
    for (const f of res.contrastFound) next[f.key] = f.ratio;
    fs.writeFileSync(BASELINE, JSON.stringify(next, null, 1) + '\n');
    console.log('[a11y-gate] baseline written: ' + Object.keys(next).length + ' pairs');
    return 0;
  }
  if (argv.includes('--json')) console.log(JSON.stringify(res, null, 1));
  else {
    console.log('[a11y-gate] ' + res.themes + ' themes, looks: ' + res.looks.join(', '));
    for (const f of res.findings) console.log('  ' + f.check + ': ' + f.message);
    if (res.improved.length) console.log('  ' + res.improved.length + ' baseline pair(s) now pass: run with --tighten');
    console.log(res.findings.length ? '[a11y-gate] ' + res.findings.length + ' finding(s)' : '[a11y-gate] clean');
  }
  return res.findings.length ? 1 : 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { parseHex, contrast, blocks, vars, themeTokens, contrastFindings, applyBaseline, sheetOrder, motionRule, focusRule, focusRemovals, lookMotion, run, LOOKS };
