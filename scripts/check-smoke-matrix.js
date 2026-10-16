#!/usr/bin/env node
// Integration smoke matrix (T0-003): opens every VexFeatures item (panel, Settings
// section, Ctrl+K command) in the real Vex over the DevTools protocol, in three
// looks, and fails on
//   * a console error or an uncaught exception while the item opens,
//   * a click that would land on something else (elementFromPoint hijack) when
//     the item names a control (`sel`),
//   * a layer left over after the item is closed (a new child of <body>),
//   * growth over budget in DOM nodes, event listeners or live intervals after
//     N open/close cycles (the leak canary).
//
//   node scripts/check-smoke-matrix.js                 firefox, glass, classic; 3 cycles
//   node scripts/check-smoke-matrix.js --list          what would run and what is held back (no Electron)
//   node scripts/check-smoke-matrix.js --looks=firefox --cycles=20 --only=notes,memory
//   node scripts/check-smoke-matrix.js --allow='^Clear'  also run held-back items whose name matches
//   npm run smoke:matrix
//
// Not part of the full suite (it opens ~250 things in 3 looks: minutes). Safety:
//   * real Electron from source, VEX_NO_OS_SCHEDULE=1, a fresh temp profile, a free
//     debugging port, started and stopped through scripts/lib/probe-harness.js
//     (only its own PIDs);
//   * scripts/lib/probe-main-hook.js stubs native dialogs, shell.openExternal and
//     default-app registration, and records each call;
//   * input is CDP only (Input.dispatchKeyEvent inside the page), never OS input;
//   * destructive or outward-reaching items are held back by DENY below unless
//     --allow names them; the run refuses while a game runs or memory is short
//     (scripts/heavy-gate.js).
// Exit 0 clean, 1 findings, 2 harness failure (could not start or connect).
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LOOKS = ['firefox', 'glass', 'classic'];

// Items that act on the outside world or on the person's data when run. Held back by
// default; the list is a regex over the item's name and command id.
const DENY = /clear|delete|remove|erase|wipe|reset|quit|exit|restart|relaunch|close (?:all|other|every)|sign.?out|log.?out|uninstall|install|update|default browser|launch|start with windows|login item|lock vex|disconnect|publish|upload|send|share|back ?up|restore|export|import|record|capture|screenshot|download|print|picture.in.picture|fullscreen|tor\b|vpn|proxy|zapret|byedpi|bypass|dpi|kill|panic|shutdown|hibernate|sleep|game|paste|clipboard|call|microphone|camera|screen/i;
// Panels that load a live website in a webview: network and third-party pages.
const SERVICE_PANELS = new Set(['whatsapp', 'claude', 'spotify', 'discord', 'roblox', 'github', 'netflix']);
// Console lines that are the network, not Vex.
const CONSOLE_IGNORE = [/Failed to load resource/i, /net::ERR_/i, /favicon/i, /ERR_BLOCKED_BY_CLIENT/i, /DevTools/i, /Autofill\.(?:enable|setAddresses)/i];

const BUDGETS = { nodes: 200, listeners: 60, intervals: 0 };

// ---- pure parts (unit-tested) -------------------------------------------------

function parseArgs(argv) {
  const o = { looks: LOOKS.slice(), cycles: 3, only: null, allow: null, list: false, json: false, limit: 0, budgets: { ...BUDGETS } };
  for (const a of argv) {
    const [k, v] = a.startsWith('--') ? [a.slice(2).split('=')[0], a.includes('=') ? a.slice(a.indexOf('=') + 1) : null] : [a, null];
    if (k === 'list') o.list = true;
    else if (k === 'json') o.json = true;
    else if (k === 'looks') { o.looks = String(v).split(',').filter(Boolean); }
    else if (k === 'cycles') o.cycles = Number(v);
    else if (k === 'only') o.only = String(v).split(',').filter(Boolean);
    else if (k === 'allow') o.allow = new RegExp(v, 'i');
    else if (k === 'limit') o.limit = Number(v);
    else if (k === 'node-budget') o.budgets.nodes = Number(v);
    else if (k === 'listener-budget') o.budgets.listeners = Number(v);
    else throw new Error('unknown argument ' + a);
  }
  for (const l of o.looks) if (!LOOKS.includes(l)) throw new Error(`unknown look "${l}" (have: ${LOOKS.join(', ')})`);
  if (!Number.isInteger(o.cycles) || o.cycles < 1 || o.cycles > 100) throw new Error('--cycles is 1 to 100');
  return o;
}

// How an item is exercised: { kind: 'panel'|'setting'|'command', ... } or a reason it is held back.
function planItem(item, opts = {}) {
  const label = [item.name || '', item.cmd || ''].join(' ');
  const allowed = opts.allow && opts.allow.test(label);
  if (item.panel) {
    if (SERVICE_PANELS.has(item.panel)) return { skip: 'loads a live website (' + item.panel + ')' };
    return { kind: 'panel', panel: item.panel };
  }
  if (item.setting && (item.setting.id || item.setting.section)) return { kind: 'setting', target: item.setting.id || item.setting.section };
  if (item.cmd) {
    if (DENY.test(label) && !allowed) return { skip: 'held back (acts on data or the outside world): ' + label.trim() };
    return { kind: 'command', cmd: item.cmd };
  }
  return { skip: 'manual (no command, panel or Settings section)' };
}

function selectItems(items, opts) {
  const run = [], skipped = [];
  for (const item of items) {
    if (opts.only && !opts.only.includes(item.id)) continue;
    const plan = planItem(item, opts);
    if (plan.skip) skipped.push({ id: item.id, reason: plan.skip });
    else run.push({ item, plan });
  }
  return { run: opts.limit ? run.slice(0, opts.limit) : run, skipped };
}

function consoleIsIgnorable(text) { return CONSOLE_IGNORE.some(re => re.test(String(text))); }

// before/after: { nodes, listeners, intervals }. Returns the budget breaches.
function leakBreaches(before, after, budgets = BUDGETS) {
  const out = [];
  for (const k of ['nodes', 'listeners', 'intervals']) {
    const grew = (after[k] || 0) - (before[k] || 0);
    if (grew > budgets[k]) out.push(`${k} grew by ${grew} (budget ${budgets[k]})`);
  }
  return out;
}

function newLayers(before, after) {
  const had = new Set(before);
  return after.filter(l => !had.has(l));
}

// ---- the page side: plain strings run with Runtime.evaluate ------------------------

const PAGE_SETUP = `(() => {
  if (window.__smoke) return 'already';
  const live = new Set();
  const si = window.setInterval.bind(window), ci = window.clearInterval.bind(window);
  window.setInterval = (fn, ms, ...a) => { const id = si(fn, ms, ...a); live.add(id); return id; };
  window.clearInterval = (id) => { live.delete(id); return ci(id); };
  const layer = (el) => (el.id ? '#' + el.id : '') + '.' + String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className).trim().split(/\\s+/).slice(0, 2).join('.') + '<' + el.tagName.toLowerCase() + '>';
  const visible = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden'; };
  window.__smoke = {
    layers: () => [...document.body.children].filter(e => !/^(SCRIPT|STYLE|LINK)$/.test(e.tagName)).map(layer),
    intervals: () => live.size,
    visible,
    reset() {
      try { if (typeof SidebarManager !== 'undefined') { if (SidebarManager.activePanel) SidebarManager.hideActivePanel(); if (SidebarManager.sidePanel) SidebarManager.closeBeside(); } }
      catch (e) { return 'reset failed: ' + e.message; }
      return 'ok';
    },
    async open(plan) {
      if (plan.kind === 'panel') {
        if (typeof SidebarManager === 'undefined') throw new Error('SidebarManager is not loaded');
        SidebarManager.openPanel(plan.panel);
        const el = document.getElementById('panel-' + plan.panel);
        return { opened: visible(el), what: 'panel-' + plan.panel };
      }
      if (plan.kind === 'setting') {
        if (typeof SettingsUI === 'undefined') throw new Error('SettingsUI is not loaded');
        SettingsUI.openSection(plan.target);
        await new Promise(r => setTimeout(r, 450));
        const el = document.getElementById(plan.target);
        return { opened: visible(el), what: plan.target };
      }
      const cmds = (typeof CommandBar !== 'undefined' && CommandBar.commands) || [];
      const cmd = cmds.find(c => c.id === plan.cmd);
      if (!cmd) return { opened: false, missing: true, what: plan.cmd };
      const before = window.__smoke.layers().length;
      await Promise.resolve(cmd.action());
      return { opened: window.__smoke.layers().length > before || !!(typeof SidebarManager !== 'undefined' && SidebarManager.activePanel), what: plan.cmd };
    },
    hijack(sel) {
      const el = sel ? document.querySelector(sel) : null;
      if (!el || !visible(el)) return null;
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!hit || el.contains(hit) || hit.contains(el)) return null;
      return layer(hit.closest('body > *') || hit);
    },
  };
  return 'installed';
})()`;

// ---- the run ------------------------------------------------------------------------

async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  const { VexFeatures } = require('../src/renderer/js/feature-catalog.js');
  const { run, skipped } = selectItems(VexFeatures.ITEMS, opts);

  if (opts.list) {
    console.log(`smoke matrix would run ${run.length} item(s) in ${opts.looks.length} look(s) (${opts.looks.join(', ')}), ${opts.cycles} cycle(s) each:`);
    for (const { item, plan } of run) console.log(`  ${plan.kind.padEnd(8)} ${item.id}  ${plan.panel || plan.target || plan.cmd}`);
    console.log(`\nheld back (${skipped.length}):`);
    for (const s of skipped) console.log(`  ${s.id}: ${s.reason}`);
    return 0;
  }

  const gate = spawnSync(process.execPath, [path.join(__dirname, 'heavy-gate.js'), 'smoke-matrix'], { stdio: 'inherit' });
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
  try {
    fs.writeFileSync(path.join(probe.userDataDir, 'vex-persist.json'), JSON.stringify(cdpLib.seededPreferences()));
    const target = await cdpLib.waitForTarget(probe.port, 60000);
    cdp = await cdpLib.connect(target.webSocketDebuggerUrl);
    const errors = [];
    cdp.on('Runtime.consoleAPICalled', (p) => { if (p.type === 'error') errors.push(p.args.map(a => a.value || a.description || '').join(' ')); });
    cdp.on('Runtime.exceptionThrown', (p) => errors.push('uncaught: ' + ((p.exceptionDetails.exception && p.exceptionDetails.exception.description) || p.exceptionDetails.text)));
    cdp.on('Log.entryAdded', (p) => { if (p.entry.level === 'error') errors.push(p.entry.text); });
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Network.enable');
    await cdp.send('Network.setBlockedURLs', { urls: ['*/favicon.ico'] });
    await cdpLib.waitForRenderer(cdp, 60000);
    await cdpLib.waitForStable(cdp, 30000);
    await cdpLib.assertNothingCovers(cdp);
    if ((await cdpLib.evaluate(cdp, PAGE_SETUP)) !== 'installed') throw new Error('the page helpers did not install');

    const counters = async () => {
      await cdp.send('HeapProfiler.collectGarbage');
      const c = await cdp.send('Memory.getDOMCounters');
      return { nodes: c.nodes, listeners: c.jsEventListeners, intervals: await cdpLib.evaluate(cdp, 'window.__smoke.intervals()') };
    };
    const escape = async () => {
      for (let i = 0; i < 2; i++) {
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
        await cdpLib.sleep(80);
      }
    };
    const closeAll = async () => { await escape(); await cdpLib.evaluate(cdp, 'window.__smoke.reset()'); await cdpLib.sleep(200); };

    let done = 0;
    for (const look of opts.looks) {
      await cdpLib.evaluate(cdp, `window.VexGuiStyle.set(${JSON.stringify(look)})`);
      await cdpLib.sleep(400);
      await closeAll();
      for (const { item, plan } of run) {
        const at = `${look}/${item.id}`;
        const baseline = await cdpLib.evaluate(cdp, 'window.__smoke.layers()');
        const mark = errors.length;
        let result;
        try {
          result = await cdpLib.evaluate(cdp, `window.__smoke.open(${JSON.stringify(plan)})`);
        } catch (err) {
          findings.push({ at, kind: 'threw', detail: err.message });
          await closeAll();
          continue;
        }
        await cdpLib.sleep(250);
        if (result.missing) notes.push({ at, note: `command ${result.what} is not registered in this build` });
        else if (!result.opened && plan.kind !== 'command') findings.push({ at, kind: 'did-not-open', detail: `${plan.kind} ${result.what} is not visible after opening` });
        if (item.sel) {
          const hit = await cdpLib.evaluate(cdp, `window.__smoke.hijack(${JSON.stringify(item.sel)})`);
          if (hit) findings.push({ at, kind: 'hijacked-click', detail: `${item.sel} is covered by ${hit}` });
        }
        await closeAll();
        for (const layer of newLayers(baseline, await cdpLib.evaluate(cdp, 'window.__smoke.layers()'))) findings.push({ at, kind: 'leaked-layer', detail: layer + ' is still in <body> after closing' });

        // Leak canary: the first open/close is the warm-up (lazy init); the rest must not grow.
        if (opts.cycles > 1) {
          const before = await counters();
          for (let i = 1; i < opts.cycles; i++) { await cdpLib.evaluate(cdp, `window.__smoke.open(${JSON.stringify(plan)})`); await cdpLib.sleep(120); await closeAll(); }
          for (const b of leakBreaches(before, await counters(), opts.budgets)) findings.push({ at, kind: 'leak', detail: `${b} over ${opts.cycles - 1} more cycles` });
        }

        for (const text of errors.slice(mark)) if (!consoleIsIgnorable(text)) findings.push({ at, kind: 'console-error', detail: String(text).slice(0, 300) });
        done++;
      }
    }

    const summary = { ok: findings.length === 0, looks: opts.looks, cycles: opts.cycles, ran: done, heldBack: skipped.length, seconds: Math.round((Date.now() - started) / 1000), findings, notes };
    if (opts.json) console.log(JSON.stringify(summary, null, 2));
    else {
      console.log(`smoke matrix: ${done} item run(s) over ${opts.looks.length} look(s), ${skipped.length} held back, ${summary.seconds}s`);
      for (const n of notes) console.log(`  note ${n.at}: ${n.note}`);
      for (const f of findings) console.log(`  FINDING ${f.at} [${f.kind}] ${f.detail}`);
      console.log(findings.length ? `${findings.length} finding(s)` : 'clean');
    }
    return findings.length ? 1 : 0;
  } finally {
    try { if (cdp) cdp.close(); } catch (err) { console.warn('smoke matrix: closing the debugging socket: ' + err.message); }
    try { harness.dispose(probe); } catch (err) { console.warn('smoke matrix: ' + err.message); }
  }
}

module.exports = { parseArgs, planItem, selectItems, consoleIsIgnorable, leakBreaches, newLayers, PAGE_SETUP, DENY, SERVICE_PANELS, BUDGETS, LOOKS };

if (require.main === module) {
  main().then(code => { process.exitCode = code; }, err => { console.error('smoke matrix: harness failure: ' + err.message); process.exitCode = 2; });
}
