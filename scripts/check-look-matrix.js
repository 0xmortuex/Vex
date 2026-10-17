#!/usr/bin/env node
// Look matrix (T2-028): the real Vex window in several looks and colour themes, at 1920x1080 and 2560x1440 and
// at 200 percent zoom, with a screenshot and an accessibility pass for every panel. OPT-IN: it is not part of the
// default CI (a full run opens a few hundred surfaces and writes a few hundred pictures); the static gate
// `npm run check:a11y` stays the always-on part.
//
//   node scripts/check-look-matrix.js                          firefox, firefox-dark, glass, classic; default theme and
//                                                              Oxford; 1920 and 2560; zoom 200 check; a sample of panels
//   node scripts/check-look-matrix.js --list                   the cells that would run (no Electron)
//   node scripts/check-look-matrix.js --looks=firefox --themes=oxford --widths=2560 --panels=notes,memory
//   node scripts/check-look-matrix.js --panels=all             every panel of the catalogue (slow)
//   node scripts/check-look-matrix.js --no-zoom                skip the 200 percent zoom pass
//   node scripts/check-look-matrix.js --out=scratchpad/look-matrix   where the pictures go
//   npm run check:looks
//
// Per cell (look x theme x width) and per panel it records
//   * the picture (PNG);
//   * horizontal overflow of the page (a scroll bar that appears at that size);
//   * top-of-window controls that a click would not reach (elementFromPoint);
//   * the accessibility pass of js/a11y-check.js (auditPage) run on the Vex window: errors only, counted;
// and at 200 percent zoom (the same screen at half the CSS width and twice the pixel density) overflow and
// unreachable controls again. The panels are opened with the helpers of the smoke matrix.
//
// Safety, as the smoke matrix: real Electron from source, VEX_NO_OS_SCHEDULE=1, a fresh temp profile, a free debugging
// port, started and stopped through scripts/lib/probe-harness.js (only its own PIDs); input is CDP only, never OS input;
// refuses while a game runs or memory is short (scripts/heavy-gate.js). A picture of a minimised or covered window
// would hang the capture call for ever: every capture has a 20 s limit and a hang is reported as such (exit 2).
// Exit 0 clean, 1 findings, 2 harness failure.
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_LOOKS = ['firefox', 'firefox-dark', 'glass', 'classic'];
// Oxford is a colour theme (cream and serif, with its own rules in gui-browser.css), not a look: named here so it is always in the matrix.
const DEFAULT_THEMES = ['default', 'oxford'];
const SIZES = { 1920: { w: 1920, h: 1080 }, 2560: { w: 2560, h: 1440 } };
const DEFAULT_PANELS = ['notes', 'memory', 'downloads', 'history', 'bookmarks', 'tasks', 'clock', 'settings'];
const CAPTURE_LIMIT_MS = 20000;

// ---- pure parts (unit-tested) ---------------------------------------------------------------

function parseArgs(argv) {
  const o = { looks: DEFAULT_LOOKS.slice(), themes: DEFAULT_THEMES.slice(), widths: [1920, 2560], panels: DEFAULT_PANELS.slice(), allPanels: false, zoom: true, list: false, json: false, out: path.join(ROOT, 'scratchpad', 'look-matrix') };
  for (const a of argv) {
    if (!a.startsWith('--')) throw new Error('unknown argument ' + a);
    const [k, v] = [a.slice(2).split('=')[0], a.includes('=') ? a.slice(a.indexOf('=') + 1) : null];
    const csv = () => String(v).split(',').filter(Boolean);
    if (k === 'list') o.list = true;
    else if (k === 'json') o.json = true;
    else if (k === 'no-zoom') o.zoom = false;
    else if (k === 'looks') o.looks = csv();
    else if (k === 'themes') o.themes = csv();
    else if (k === 'widths') o.widths = csv().map(Number);
    else if (k === 'panels') { if (v === 'all') o.allPanels = true; else o.panels = csv(); }
    else if (k === 'out') o.out = path.resolve(ROOT, String(v));
    else throw new Error('unknown argument ' + a);
  }
  for (const w of o.widths) if (!SIZES[w]) throw new Error(`unknown width ${w} (have: ${Object.keys(SIZES).join(', ')})`);
  if (!o.looks.length || !o.themes.length || !o.widths.length) throw new Error('--looks, --themes and --widths each need at least one value');
  return o;
}

// Every cell of the matrix: look x theme x width, then the zoom pass of each look x theme at the larger width.
function cells(o) {
  const out = [];
  for (const look of o.looks) for (const theme of o.themes) {
    for (const width of o.widths) out.push({ look, theme, width, zoom: 100, ...SIZES[width] });
    if (o.zoom) {
      const base = SIZES[Math.max(...o.widths)];
      // 200 percent zoom of that screen: half the CSS pixels in each direction, twice the density.
      out.push({ look, theme, width: Math.max(...o.widths), zoom: 200, w: base.w / 2, h: base.h / 2, dsf: 2 });
    }
  }
  return out;
}

function cellName(c) { return `${c.look}-${c.theme}-${c.width}${c.zoom === 200 ? '-zoom200' : ''}`; }
function shotPath(out, c, panel) { return path.join(out, cellName(c), (panel || 'window').replace(/[^a-z0-9_-]/gi, '_') + '.png'); }

// measure: what the page side returns. -> [{ kind, detail }]
function judge(measure, c, panel) {
  const at = `${cellName(c)}/${panel || 'window'}`;
  const f = [];
  if (measure.overflowX > 1) f.push({ at, kind: 'horizontal-overflow', detail: `the page is ${measure.overflowX}px wider than the window` });
  for (const miss of measure.unreachable || []) f.push({ at, kind: 'unreachable-control', detail: `${miss} is covered or outside the window` });
  const errors = (measure.a11y || []).filter(i => i.severity === 'error');
  if (errors.length) f.push({ at, kind: 'a11y', detail: `${errors.length} accessibility error(s): ` + errors.slice(0, 3).map(i => i.rule + ' (' + String(i.message).slice(0, 60) + ')').join('; ') });
  return f;
}

// ---- the page side: a string run with Runtime.evaluate ---------------------------------------------

const CONTROLS = ['#top-bar', '#address-bar, #url-input, .url-input', '#tab-strip, #tabs, .tab-strip', '#sidebar, .sidebar'];
const PAGE_MEASURE = `(() => {
  const CONTROLS = ${JSON.stringify(CONTROLS)};
  const el = document.scrollingElement || document.documentElement;
  const unreachable = [];
  for (const sel of CONTROLS) {
    const node = document.querySelector(sel);
    if (!node) continue;
    const r = node.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const x = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 1), y = Math.min(Math.max(r.top + r.height / 2, 1), innerHeight - 1);
    const hit = document.elementFromPoint(x, y);
    if (!hit || !(node.contains(hit) || hit.contains(node))) unreachable.push(sel);
  }
  let a11y = [];
  if (typeof auditPage === 'function') { try { a11y = auditPage(document, window, {}).issues || []; } catch (e) { a11y = [{ rule: 'audit-failed', severity: 'error', message: e.message }]; } }
  return { overflowX: Math.max(0, el.scrollWidth - innerWidth), innerWidth, innerHeight, unreachable, a11y: a11y.map(i => ({ rule: i.rule, severity: i.severity, message: i.message })) };
})()`;

// ---- the run ----------------------------------------------------------------------------------------

async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  const smoke = require('./check-smoke-matrix.js');
  const { VexFeatures } = require('../src/renderer/js/feature-catalog.js');
  const panelItems = VexFeatures.ITEMS.filter(i => i.panel && !smoke.SERVICE_PANELS.has(i.panel));
  const chosen = opts.allPanels ? panelItems.map(i => i.panel) : opts.panels;
  const panels = [...new Set(chosen)];
  const grid = cells(opts);

  if (opts.list) {
    console.log(`look matrix: ${grid.length} cell(s), ${panels.length} panel(s) each, plus the bare window`);
    for (const c of grid) console.log(`  ${cellName(c)}  ${c.w}x${c.h}${c.dsf ? ' @' + c.dsf + 'x' : ''}`);
    console.log('panels: ' + panels.join(', '));
    return 0;
  }

  const gate = spawnSync(process.execPath, [path.join(__dirname, 'heavy-gate.js'), 'look-matrix'], { stdio: 'inherit' });
  if (gate.status !== 0) return gate.status === 2 ? 2 : 1;

  const harness = require('./lib/probe-harness');
  const cdpLib = require('./lib/cdp-client');
  const probe = await harness.launchWithPort({
    args: ['-r', path.join(__dirname, 'check-ui-probe.js'), '-r', path.join(__dirname, 'lib', 'probe-main-hook.js'), '.'],
    env: { VEX_SKIP_VMP_VERIFY: '1' },
  });
  let cdp = null;
  const findings = [];
  const notes = [];
  const started = Date.now();
  let pictures = 0;
  try {
    fs.writeFileSync(path.join(probe.userDataDir, 'vex-persist.json'), JSON.stringify(cdpLib.seededPreferences()));
    const target = await cdpLib.waitForTarget(probe.port, 60000);
    cdp = await cdpLib.connect(target.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdpLib.waitForRenderer(cdp, 60000);
    await cdpLib.waitForStable(cdp, 30000);
    await cdpLib.assertNothingCovers(cdp);
    if ((await cdpLib.evaluate(cdp, smoke.PAGE_SETUP)) !== 'installed') throw new Error('the page helpers did not install');

    const capture = async (file) => {
      const shot = await Promise.race([
        cdp.send('Page.captureScreenshot', { format: 'png' }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('Page.captureScreenshot did not answer in ' + CAPTURE_LIMIT_MS / 1000 + ' s: the window is minimised or covered, so it cannot be captured')), CAPTURE_LIMIT_MS)),
      ]);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
      pictures++;
    };
    const closeAll = async () => { await cdpLib.evaluate(cdp, 'window.__smoke.reset()'); await cdpLib.sleep(150); };

    for (const c of grid) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: c.w, height: c.h, deviceScaleFactor: c.dsf || 1, mobile: false });
      await cdpLib.evaluate(cdp, `window.VexGuiStyle.set(${JSON.stringify(c.look)})`);
      if (c.theme !== 'default') await cdpLib.evaluate(cdp, `window.ThemeManager.applyTheme(${JSON.stringify(c.theme)}, { persist: false })`);
      await cdpLib.sleep(500);
      await closeAll();
      for (const panel of [null, ...panels]) {
        if (panel) {
          const r = await cdpLib.evaluate(cdp, `window.__smoke.open(${JSON.stringify({ kind: 'panel', panel })})`);
          await cdpLib.sleep(300);
          if (!r.opened) { notes.push({ at: `${cellName(c)}/${panel}`, note: 'the panel did not become visible (skipped)' }); await closeAll(); continue; }
        }
        findings.push(...judge(await cdpLib.evaluate(cdp, PAGE_MEASURE), c, panel));
        await capture(shotPath(opts.out, c, panel));
        if (panel) await closeAll();
      }
    }
    await cdp.send('Emulation.clearDeviceMetricsOverride');

    const summary = { ok: findings.length === 0, cells: grid.length, panels: panels.length, pictures, out: opts.out, seconds: Math.round((Date.now() - started) / 1000), findings, notes };
    if (opts.json) console.log(JSON.stringify(summary, null, 2));
    else {
      console.log(`look matrix: ${grid.length} cell(s) x ${panels.length + 1} surface(s), ${pictures} picture(s) in ${path.relative(ROOT, opts.out)}, ${summary.seconds}s`);
      for (const n of notes) console.log(`  note ${n.at}: ${n.note}`);
      for (const f of findings) console.log(`  FINDING ${f.at} [${f.kind}] ${f.detail}`);
      console.log(findings.length ? `${findings.length} finding(s)` : 'clean');
    }
    return findings.length ? 1 : 0;
  } finally {
    try { if (cdp) cdp.close(); } catch (err) { console.warn('look matrix: closing the debugging socket: ' + err.message); }
    try { harness.dispose(probe); } catch (err) { console.warn('look matrix: ' + err.message); }
  }
}

module.exports = { parseArgs, cells, cellName, shotPath, judge, PAGE_MEASURE, CONTROLS, SIZES, DEFAULT_LOOKS, DEFAULT_THEMES, DEFAULT_PANELS };

if (require.main === module) {
  main().then(code => { process.exitCode = code; }, err => { console.error('look matrix: harness failure: ' + err.message); process.exitCode = 2; });
}
