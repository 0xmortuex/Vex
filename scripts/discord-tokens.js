#!/usr/bin/env node
// Writes src/renderer/js/discord-tokens.js: every colour variable Discord's
// own CSS defines and uses, with Discord's dark and light values, the
// surfaces text is drawn on, and the text-on-background pairs Discord's rules
// put together. "Match Discord to my Vex theme" (js/discord-theme.js) maps a
// Vex theme onto all of them and checks every pair for contrast.
//
// Run it again when Discord changes its CSS:
//   node scripts/discord-tokens.js <empty scratch folder>
// It downloads https://discord.com/app and every stylesheet that page names
// (plain unauthenticated GETs, nothing else) into the folder, then has
// Electron's Chromium resolve each variable under html.visual-refresh.theme-*
// (the classes Discord's app puts on <html>). With --offline it reuses the
// CSS already in the folder.
'use strict';

const fs = require('fs');
const path = require('path');

const MODES = ['dark', 'light', 'darker', 'midnight'];
// Rules that only define Discord's variables (on <html>, its popout roots and
// its theme layers), as opposed to the rules of its components.
const PAGE = /^(:root|html|\[data-popout-root\]|\.root|\.visual-refresh|\.theme-(dark|light|darker|midnight))$/;
const THEME = /^\.theme-(dark|light|darker|midnight)$/;
const TOKEN_ONLY = /high-contrast-mode|custom-user-profile-theme|enable-forced-colors|mobile-visual-refresh|:lang\(/;
// Fixed colours Discord means literally (white text on a coloured button, a
// black scrim over a picture): never recoloured, and what they sit on is.
const ABSOLUTE = /^--(white|black)(-\d+)?(-hsl)?$|^--opacity-(white|black)-\d+(-hsl)?$/;

// ---- CSS ------------------------------------------------------------------

function parseCss(text) {
  text = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  let i = 0;
  const skipString = () => { const q = text[i]; i++; while (i < text.length && text[i] !== q) { if (text[i] === '\\') i++; i++; } };
  function block() {
    while (i < text.length) {
      while (i < text.length && /\s/.test(text[i])) i++;
      if (i >= text.length) return;
      if (text[i] === '}') { i++; return; }
      let start = i, depth = 0;
      while (i < text.length) {
        const ch = text[i];
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        else if ((ch === '{' || ch === ';') && depth === 0) break;
        else if (ch === '"' || ch === "'") skipString();
        i++;
      }
      const prelude = text.slice(start, i).trim();
      if (text[i] === ';') { i++; continue; }
      i++;
      if (prelude.startsWith('@')) {
        if (/^@(media|supports|container|layer|document)/.test(prelude)) { block(); continue; }
        let d = 1;
        while (i < text.length && d > 0) { if (text[i] === '{') d++; else if (text[i] === '}') d--; i++; }
        continue;
      }
      start = i;
      let d = 1;
      while (i < text.length && d > 0) {
        const ch = text[i];
        if (ch === '{') d++; else if (ch === '}') d--;
        else if (ch === '"' || ch === "'") skipString();
        i++;
      }
      const body = text.slice(start, i - 1);
      const decls = [];
      let buf = '', pd = 0;
      for (const ch of body + ';') {
        if (ch === '(') pd++; else if (ch === ')') pd--;
        if (ch === ';' && pd === 0) {
          const k = buf.indexOf(':');
          if (k > 0) decls.push([buf.slice(0, k).trim(), buf.slice(k + 1).replace(/\s*!important\s*$/, '').trim()]);
          buf = '';
        } else buf += ch;
      }
      rules.push({ sel: prelude, decls });
    }
  }
  block();
  return rules;
}

const parts = (sel) => sel.split(',').map(s => s.trim());
const isPage = (r) => parts(r.sel).every(s => PAGE.test(s));
const isTheme = (r) => parts(r.sel).every(s => THEME.test(s));
const isTokenOnly = (r) => isPage(r) || (TOKEN_ONLY.test(r.sel) && r.decls.every(([p]) => p.startsWith('--')));

// ---- colour maths (only what this script needs) -----------------------------

const lum = ([r, g, b]) => {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (x, y) => { const a = lum(x), b = lum(y); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
const over = (fg, bg) => { const a = fg[3]; return [0, 1, 2].map(i => fg[i] * a + bg[i] * (1 - a)).concat(1); };
const chroma = ([r, g, b]) => {
  const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const R = lin(r), G = lin(g), B = lin(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  return [L, Math.hypot(a, bb)];
};
const hexOf = (c) => '#' + c.slice(0, 3).map(v => Math.round(v).toString(16).padStart(2, '0')).join('') + (c[3] < 1 ? Math.round(c[3] * 255).toString(16).padStart(2, '0') : '');

// ---- Electron: resolve every variable to a colour --------------------------

function resolveInElectron(dir) {
  const { app, BrowserWindow } = require('electron');
  app.commandLine.appendSwitch('disable-gpu');
  app.whenReady().then(async () => {
    const names = JSON.parse(fs.readFileSync(path.join(dir, 'names.json'), 'utf8'));
    const css = fs.readFileSync(path.join(dir, 'resolve.css'), 'utf8');
    const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true, javascript: true } });
    await win.loadURL('data:text/html,<!doctype html><html><head></head><body></body></html>');
    await win.webContents.executeJavaScript(`(() => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(css)}; document.head.appendChild(s); })()`);
    const out = {};
    for (const mode of MODES) {
      out[mode] = await win.webContents.executeJavaScript(`(() => {
        document.documentElement.className = 'visual-refresh theme-${mode}';
        const host = document.createElement('div'); host.style.color = 'rgb(1, 2, 3)'; document.body.appendChild(host);
        const el = document.createElement('div'); host.appendChild(el);
        const parse = (c) => {
          let m = /^rgba?\\((\\d+), (\\d+), (\\d+)(?:, ([\\d.]+))?\\)$/.exec(c);
          if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
          m = /^color\\(srgb ([-\\d.e]+) ([-\\d.e]+) ([-\\d.e]+)(?: \\/ ([\\d.e]+))?\\)$/.exec(c);
          const cl = (v) => Math.max(0, Math.min(255, Math.round(parseFloat(v) * 255)));
          if (m) return [cl(m[1]), cl(m[2]), cl(m[3]), m[4] === undefined ? 1 : +parseFloat(m[4]).toFixed(3)];
          return null;
        };
        const res = {}, odd = [];
        for (const n of ${JSON.stringify(names)}) {
          const ref = n.endsWith('-hsl') ? 'hsl(var(' + n + ') / 1)' : 'var(' + n + ')';
          el.style.color = '';
          el.style.color = ref;
          const c = getComputedStyle(el).color;
          if (c === 'rgb(1, 2, 3)') continue;
          let v = parse(c);
          if (!v) { el.style.color = 'color-mix(in srgb, ' + ref + ' 100%, transparent 0%)'; v = parse(getComputedStyle(el).color); }
          if (!v) { odd.push(n + ' = ' + c); continue; }
          res[n] = v;
        }
        host.remove();
        return { res, odd };
      })()`);
      if (out[mode].odd.length) throw new Error('Colours Chromium gave in a form this script does not read: ' + out[mode].odd.slice(0, 5).join('; '));
      out[mode] = out[mode].res;
    }
    fs.writeFileSync(path.join(dir, 'resolved.json'), JSON.stringify(out));
    app.quit();
  }).catch((err) => { console.error(err); app.exit(1); });
}

// ---- download ---------------------------------------------------------------

async function download(dir) {
  const r = await fetch('https://discord.com/app');
  if (!r.ok) throw new Error('discord.com/app answered ' + r.status);
  const html = await r.text();
  fs.writeFileSync(path.join(dir, 'app.html'), html);
  const files = new Set([...html.matchAll(/"(\/assets\/[^"]+\.css)"/g)].map(m => m[1]));
  if (files.size < 20) throw new Error('discord.com/app named only ' + files.size + ' stylesheets');
  // The rest load when a part of the app opens (settings, reactions,
  // popouts...): the app's webpack runtime names them, a few as
  // "<chunk>"===e?""+e+".<hash>.css" and the rest as ({ chunk: "<hash>" })[e]+".css".
  const web = (/\/assets\/web\.[0-9a-f]+\.js/.exec(html) || [])[0];
  if (!web) throw new Error('discord.com/app names no web.*.js runtime');
  const wr = await fetch('https://discord.com' + web);
  if (!wr.ok) throw new Error(web + ' answered ' + wr.status);
  const js = await wr.text();
  const end = js.indexOf(')[e]+".css"');
  if (end < 0) throw new Error('The webpack runtime has no stylesheet map (Discord changed its build)');
  const start = js.lastIndexOf('({', end);
  const fnStart = js.lastIndexOf('=e=>', start);
  let lazy = 0;
  for (const m of js.slice(fnStart, start).matchAll(/"(\d+)"===e\?""\+e\+"\.([0-9a-f]{16})\.css"/g)) { files.add(`/assets/${m[1]}.${m[2]}.css`); lazy++; }
  for (const m of js.slice(start + 1, end).matchAll(/\d+:"([0-9a-f]{16})"/g)) { files.add(`/assets/${m[1]}.css`); lazy++; }
  if (lazy < 50) throw new Error('The webpack stylesheet map named only ' + lazy + ' files');
  fs.mkdirSync(path.join(dir, 'css'), { recursive: true });
  for (const f of files) {
    const res = await fetch('https://discord.com' + f);
    if (!res.ok) throw new Error(f + ' answered ' + res.status);
    fs.writeFileSync(path.join(dir, 'css', path.basename(f)), await res.text());
  }
  return files.size;
}

// ---- what Discord's rules put together -------------------------------------

function analyse(rules, R) {
  const colour = new Set(Object.keys(R.dark));
  const semantic = new Set();
  for (const r of rules) if (isTheme(r)) for (const [p] of r.decls) if (colour.has(p)) semantic.add(p);

  // A value that is exactly one variable: var(--x) or hsl(var(--x-hsl)/a).
  const single = (v, local) => {
    // var(--background-gradient-chat, var(--x)): no gradient is set unless a
    // Nitro app theme is on, so the colour is --x.
    const fb = /^var\((--[\w-]+),\s*(var\(--[\w-]+\))\)$/.exec(v);
    if (fb && !colour.has(fb[1]) && !local.has(fb[1])) v = fb[2];
    let m = /^var\((--[\w-]+)(?:,[^()]*)?\)$/.exec(v);
    let a;
    if (!m) { m = /^hsl\(var\((--[\w-]+-hsl)\)\s*\/\s*([\d.]+)\)$/.exec(v); if (m) a = +m[2]; }
    if (!m) return null;
    let name = m[1];
    for (let hop = 0; hop < 4 && local.has(name); hop++) {
      const inner = single(local.get(name), new Map());
      if (!inner) return null;
      name = inner.name; if (inner.a !== undefined) a = inner.a;
    }
    return colour.has(name) ? { name, a } : null;
  };
  const modesOf = (sel) => {
    const ps = parts(sel);
    const ms = new Set();
    for (const p of ps) {
      if (/\.theme-light\b/.test(p)) ms.add('light');
      else if (/\.theme-darker\b/.test(p)) ms.add('darker');
      else if (/\.theme-midnight\b/.test(p)) ms.add('midnight');
      else if (/\.theme-dark\b/.test(p)) ms.add('dark');
      else return '';
    }
    return [...ms].sort().join(' ');
  };

  const used = new Set();
  const pairs = new Map();
  const free = new Map();
  const bgUsed = new Set();
  const COLOURISH = /^(color|background|background-color|background-image|border(-(top|right|bottom|left))?(-color)?|outline(-color)?|fill|stroke|box-shadow|text-decoration-color|caret-color|--.*)$/;
  let literalColours = 0;
  for (const r of rules) {
    if (isTokenOnly(r)) continue;
    const local = new Map(r.decls.filter(([p]) => p.startsWith('--')).map(([p, v]) => [p, v]));
    for (const [p, v] of r.decls) {
      if (!COLOURISH.test(p)) continue;
      for (const m of v.matchAll(/var\((--[\w-]+)/g)) if (colour.has(m[1])) used.add(m[1]);
      if (/^(color|background|background-color|fill)$/.test(p) && /#[0-9a-f]{3,8}\b|\brgba?\(\d|\bhsla?\(\d/i.test(v)) literalColours++;
    }
    const get = (props) => { for (const [p, v] of r.decls) if (props.includes(p)) { const s = single(v, local); if (s) return s; } return null; };
    const fg = get(['color']) || get(['fill']);
    const bg = get(['background-color', 'background']);
    if (bg) bgUsed.add(bg.name);
    const m = modesOf(r.sel);
    if (fg && bg) {
      const icon = !get(['color']);
      const key = [fg.name, bg.name, fg.a ?? '', bg.a ?? '', m].join('|');
      pairs.set(key, { fg: fg.name, bg: bg.name, fa: fg.a, ba: bg.a, min: icon ? 3 : 4.5, modes: m });
    } else if (fg && !r.decls.some(([p]) => /^background(-color|-image)?$/.test(p))) {
      const icon = !get(['color']);
      const prev = free.get(fg.name + '|' + (fg.a ?? ''));
      const modes = prev ? (prev.modes === '' || m === '' ? '' : [...new Set((prev.modes + ' ' + m).split(' '))].sort().join(' ')) : m;
      free.set(fg.name + '|' + (fg.a ?? ''), { fg: fg.name, fa: fg.a, min: prev && prev.min === 4.5 ? 4.5 : (icon ? 3 : 4.5), modes });
    }
  }
  // Pairs by name: --x-text-y is drawn on --x-background-y.
  for (const t of semantic) {
    const segs = t.slice(2).split('-');
    segs.forEach((s, i) => {
      if (s !== 'text' && s !== 'icon') return;
      const b = '--' + [...segs.slice(0, i), 'background', ...segs.slice(i + 1)].join('-');
      if (semantic.has(b)) pairs.set([t, b, '', '', ''].join('|'), { fg: t, bg: b, min: s === 'icon' ? 3 : 4.5, modes: '' });
    });
  }

  const value = (name, mode, a) => { const v = R[mode][name]; return a === undefined ? v : [v[0], v[1], v[2], a]; };
  const base = (mode) => R[mode]['--background-base-low'];
  // The surfaces: neutral, opaque backgrounds near the chat's own colour (a
  // theme variable, or one set per mode elsewhere, like the member list's).
  const perMode = (n) => semantic.has(n) || MODES.some(m => String(R[m][n]) !== String(R.dark[n]));
  const floors = [...bgUsed].filter(n => perMode(n) && ['dark', 'light'].every(mode => {
    const v = R[mode][n];
    return v[3] === 1 && chroma(v)[1] < 0.035 && Math.abs(chroma(v)[0] - chroma(base(mode))[0]) < 0.1;
  })).sort();
  const layers = ['--background-mod-subtle', '--background-mod-normal', '--background-mod-strong'].filter(n => semantic.has(n));
  const discordReads = (fg, fa, bgs, mode) => bgs.some(b => ratio(over(value(fg, mode, fa), b), b) >= 3);
  const opaque = (name, a, mode) => { const v = value(name, mode, a); return v[3] < 1 ? floors.map(f => over(v, R[mode][f])) : [v]; };

  // The Discord modes in which Discord's own design makes a pairing
  // readable (3:1 or more). Under 3:1 it is not text meant to be read there:
  // a disabled control, a decoration, or a rule that never meets that
  // background in that mode. A rule only for some modes (.theme-dark .x) is
  // looked at in those modes only.
  const polarity = (fg, fa, bgsOf, modes) => (modes ? modes.split(' ') : MODES)
    .filter(mode => discordReads(fg, fa, bgsOf(mode), mode)).join(' ');
  const outPairs = [];
  for (const p of pairs.values()) {
    const pol = polarity(p.fg, p.fa, (mode) => opaque(p.bg, p.ba, mode), p.modes);
    if (!pol) continue;
    outPairs.push([p.fg, p.bg, p.min, p.fa ?? null, p.ba ?? null, p.modes, pol]);
  }
  const outFree = [];
  for (const f of free.values()) {
    if (ABSOLUTE.test(f.fg)) continue;
    // A placeholder is text people read, even where Discord's own grey is
    // too faint to (its dark message box): checked in every mode.
    const pol = /placeholder/.test(f.fg) ? (f.modes ? f.modes : MODES.join(' ')) : polarity(f.fg, f.fa, (mode) => [base(mode)], f.modes);
    if (!pol) continue;
    outFree.push([f.fg, f.min, f.fa ?? null, f.modes, pol]);
  }
  outPairs.sort((a, b) => (a[0] + a[1]).localeCompare(b[0] + b[1]));
  outFree.sort((a, b) => a[0].localeCompare(b[0]));
  const primitives = [...used].filter(n => !semantic.has(n) && !ABSOLUTE.test(n)).sort();
  return { colour, semantic, used, primitives, floors, layers, pairs: outPairs, free: outFree, literalColours };
}

function writeFixture(dir, out, fetchedFiles) {
  const css = path.join(dir, 'css');
  const rules = [];
  for (const f of fs.readdirSync(css).filter(f => f.endsWith('.css')).sort()) rules.push(...parseCss(fs.readFileSync(path.join(css, f), 'utf8')));
  const R = JSON.parse(fs.readFileSync(path.join(dir, 'resolved.json'), 'utf8'));
  const a = analyse(rules, R);
  // Every variable a pair names must have a value.
  const absolute = new Set();
  for (const p of a.pairs) for (const n of [p[0], p[1]]) if (ABSOLUTE.test(n)) absolute.add(n);
  const semantic = {};
  for (const n of [...a.semantic].sort()) semantic[n] = [hexOf(R.dark[n]), hexOf(R.light[n])];
  const primitive = {};
  for (const n of a.primitives) {
    const vals = MODES.map(m => hexOf(R[m][n]));
    primitive[n] = vals.every(v => v === vals[0]) ? vals[0] : vals;
  }
  const abs = {};
  for (const n of [...absolute].sort()) abs[n] = hexOf(R.dark[n]);
  const axes = {};
  for (const m of MODES) axes[m] = ['--background-base-low', '--text-muted', '--text-default'].map(n => hexOf(R[m][n]));
  const refs = {};
  for (const m of MODES) refs[m] = { brand: hexOf(R[m]['--control-primary-background-default']), danger: hexOf(R[m]['--status-danger']), success: hexOf(R[m]['--status-positive']), warning: hexOf(R[m]['--status-warning']) };
  const html = fs.existsSync(path.join(dir, 'app.html')) ? fs.readFileSync(path.join(dir, 'app.html'), 'utf8') : '';
  const build = (/\/assets\/(web\.[0-9a-f]+\.js)/.exec(html) || [])[1] || 'unknown';
  const data = {
    source: { from: 'https://discord.com/app', build, stylesheets: fetchedFiles, checked: new Date().toISOString().slice(0, 10) },
    counts: {
      colourVariables: a.colour.size, semantic: a.semantic.size, usedByComponents: a.used.size,
      primitivesUsedDirectly: a.primitives.length, pairs: a.pairs.length, freeText: a.free.length,
      literalColoursInRules: a.literalColours,
    },
    modes: MODES, axes, refs, floors: a.floors, layers: a.layers,
    semantic, primitive, absolute: abs, pairs: a.pairs, freeText: a.free,
  };
  const target = path.join(__dirname, '..', 'src', 'renderer', 'js', 'discord-tokens.js');
  const body = '// Generated by scripts/discord-tokens.js from Discord\'s own CSS; do not edit.\n'
    + '// Discord\'s colour variables, their dark and light values, the surfaces text\n'
    + '// sits on and the text-on-background pairs its rules use (js/discord-theme.js).\n'
    + '// semantic: [dark, light]; primitive: one value, or one per mode; pairs:\n'
    + '// [text, background, minimum contrast, text alpha, background alpha,\n'
    + '// Discord modes the rule is limited to (\'\' = all), Discord modes in\n'
    + '// which Discord\'s own colours read]; freeText: [text, minimum, alpha,\n'
    + '// modes, reads], drawn on the floors and on the floors under the layers.\n'
    + 'const DiscordTokens = ' + JSON.stringify(data, null, 0).replace(/\],"/g, '],\n"').replace(/,"(?=[a-z]+":)/g, ',\n"') + ';\n'
    + 'if (typeof window !== \'undefined\') window.DiscordTokens = DiscordTokens;\n'
    + 'if (typeof module !== \'undefined\' && module.exports) module.exports = { DiscordTokens };\n';
  fs.writeFileSync(target, body);
  console.log('wrote', path.relative(process.cwd(), target), JSON.stringify(data.counts), 'floors', a.floors.length);
}

module.exports = { parseCss, analyse };

if (process.versions.electron) {
  resolveInElectron(process.argv[process.argv.length - 1]);
} else if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    const dir = args.find(a => !a.startsWith('--'));
    if (!dir) throw new Error('usage: node scripts/discord-tokens.js <scratch folder> [--offline]');
    fs.mkdirSync(dir, { recursive: true });
    let fetched;
    if (args.includes('--offline')) fetched = fs.readdirSync(path.join(dir, 'css')).filter(f => f.endsWith('.css')).length;
    else fetched = await download(dir);
    // What Chromium resolves the variables from: the stylesheets the app page
    // itself loads, whole, then only the variables the later ones add. A
    // later one may redefine the whole palette (one sets every colour to
    // hotpink, to flag old names in a design tool), which is not what the
    // app shows.
    const html = fs.readFileSync(path.join(dir, 'app.html'), 'utf8');
    const initial = new Set([...html.matchAll(/"\/assets\/([^"]+\.css)"/g)].map(m => m[1]));
    const files = fs.readdirSync(path.join(dir, 'css')).filter(f => f.endsWith('.css')).sort();
    const names = new Set();
    let resolveCss = '';
    for (const f of files.filter(f => initial.has(f))) {
      const text = fs.readFileSync(path.join(dir, 'css', f), 'utf8');
      resolveCss += text + '\n';
      for (const r of parseCss(text)) if (isPage(r)) for (const [p] of r.decls) if (p.startsWith('--')) names.add(p);
    }
    const added = new Set();
    for (const f of files.filter(f => !initial.has(f))) {
      for (const r of parseCss(fs.readFileSync(path.join(dir, 'css', f), 'utf8'))) {
        if (!isPage(r)) continue;
        const fresh = r.decls.filter(([p]) => p.startsWith('--') && !names.has(p));
        if (!fresh.length) continue;
        resolveCss += `${r.sel}{${fresh.map(([p, v]) => p + ':' + v).join(';')}}\n`;
        for (const [p] of fresh) added.add(p);
      }
    }
    for (const p of added) names.add(p);
    fs.writeFileSync(path.join(dir, 'resolve.css'), resolveCss);
    fs.writeFileSync(path.join(dir, 'names.json'), JSON.stringify([...names].sort()));
    const { spawnSync } = require('child_process');
    const res = spawnSync(require('electron'), [__filename, dir], { stdio: 'inherit' });
    if (res.status !== 0) throw new Error('Electron could not resolve Discord\'s variables (exit ' + res.status + ')');
    writeFixture(dir, null, fetched);
  })().catch((err) => { console.error(err); process.exit(1); });
}
