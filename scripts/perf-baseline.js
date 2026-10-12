#!/usr/bin/env node
// Prints how fast and how heavy Vex is, so a change can be compared with the
// last one. It starts Vex (from source, a throwaway profile, no OS tasks),
// drives its window over the DevTools protocol and reports:
//
//   boot      main process: ready / window / first paint / loaded, event-loop
//             stalls; window: domInteractive, load, first paint, long tasks
//   panels    first and repeat open of Settings; the other sidebar panels
//   ctrl+k    open, and the time of each search
//   tabs      create / switch / close at 1 and at N tabs; idle cost at N tabs
//   memory    window heap, DOM nodes and listeners after GC, before and after
//             open/close cycles of panels and of tabs; main process memory
//   idle      messages per second between window and main, and window CPU
//   writes    how often a normal run of actions rewrites vex-persist.json
//
// Usage:  node scripts/perf-baseline.js [--tabs 20] [--json] [--root <dir>] [--no-warmup]
//   --tabs N      how many tabs the scaling step opens (default 20; 60 is heavy)
//   --no-warmup   measure the very first start of a new profile (it builds the
//                 ad blocker's engine, which downloads the filter lists)
//   --root D   a Vex folder to measure instead of this one (e.g. an older
//              checkout, to compare)
//   --json     one JSON object instead of the table
//
// It measures; it asserts nothing, and is not part of CI: timings depend on
// the machine (close other programs, and expect a few percent of noise).
// Every number is milliseconds unless it says otherwise. A source run opens
// DevTools at start (src/main.js, enableDevToolsAtStartup), which inflates
// every DOM measurement, so they are closed first.
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf('--' + name); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback; };
const ROOT = path.resolve(opt('root', path.join(__dirname, '..')));
const TABS = Math.max(2, Number(opt('tabs', 20)) || 20);
const AS_JSON = args.includes('--json');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---- the main-process side: marks, stalls, counters ------------------------
// Loaded with `electron -r`, so it runs before src/main.js. It writes one JSON
// file twice a second.
const HOOK = `
const fs = require('fs');
const Module = require('module');
const T0 = process.hrtime.bigint();
const now = () => Number(process.hrtime.bigint() - T0) / 1e6;
const marks = {}; const cnt = { ipcIn: {}, send: {} }; const stalls = [];
let modMs = 0, depth = 0;
const load = Module._load;
Module._load = function () {
  const t = process.hrtime.bigint(); depth++;
  try { return load.apply(this, arguments); }
  finally { depth--; if (depth === 0) modMs += Number(process.hrtime.bigint() - t) / 1e6; }
};
const bump = (o, k) => { o[k] = (o[k] || 0) + 1; };
let patched = false;
const patch = (el) => {
  if (patched || !el || !el.ipcMain) return; patched = true;
  for (const m of ['handle', 'on']) { const o = el.ipcMain[m].bind(el.ipcMain); el.ipcMain[m] = (ch, fn) => o(ch, function () { bump(cnt.ipcIn, ch); return fn.apply(this, arguments); }); }
  el.app.on('web-contents-created', (e, wc) => { const s = wc.send.bind(wc); wc.send = function (ch, ...a) { bump(cnt.send, ch); return s(ch, ...a); }; });
  el.app.whenReady().then(() => { marks.ready = now(); });
  el.app.on('browser-window-created', (e, w) => {
    if (marks.windowCreated === undefined) marks.windowCreated = now();
    w.once('ready-to-show', () => { if (marks.readyToShow === undefined) marks.readyToShow = now(); });
    w.webContents.once('did-finish-load', () => { if (marks.didFinishLoad === undefined) marks.didFinishLoad = now(); });
  });
};
const load2 = Module._load;
Module._load = function (request) { const r = load2.apply(this, arguments); if (request === 'electron') { try { patch(r); } catch {} } return r; };
const writes = {};
const fsw = fs.promises;
for (const [obj, name] of [[fs, 'rename'], [fsw, 'rename'], [fs, 'renameSync']]) {
  const o = obj[name]; obj[name] = function (a, b, ...r) { if (/vex-persist\\.json$/.test(String(b))) bump(writes, 'persist'); return o.call(this, a, b, ...r); };
}
let last = process.hrtime.bigint();
setInterval(() => { const n = process.hrtime.bigint(); const d = Number(n - last) / 1e6 - 10; if (d > 40) stalls.push([Math.round(Number(n - T0) / 1e6), Math.round(d)]); last = n; }, 10).unref();
const out = process.env.VEX_PERF_OUT;
setInterval(() => {
  try {
    const mu = process.memoryUsage();
    fs.writeFileSync(out + '.tmp', JSON.stringify({ marks, cnt, stalls, writes, modMs, mem: { rss: mu.rss, heapUsed: mu.heapUsed, external: mu.external } }));
    fs.renameSync(out + '.tmp', out);
  } catch {}
}, 500).unref();
`;

// ---- a small DevTools-protocol client --------------------------------------
function cdp(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl); let id = 0; const pending = new Map();
    ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
    ws.addEventListener('error', reject);
    ws.addEventListener('open', () => resolve({
      send: (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); }),
      close: () => ws.close(),
    }));
  });
}
const getJson = (url) => new Promise((res, rej) => http.get(url, (r) => { let b = ''; r.on('data', d => { b += d; }); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } }); }).on('error', rej));
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });

const DIR = path.join(os.tmpdir(), `vex-perf-baseline-${process.pid}-${Date.now()}`);

// A new profile builds the ad blocker's engine from the downloaded lists (a
// second of main-process work and a lot of memory) and then caches it; every
// later start loads the cache. So the first start is not what anyone runs
// day to day: it is made once here, and the measured start is the second.
async function warmUp(electron) {
  const port = await freePort();
  const child = spawn(electron, ['.', `--user-data-dir=${path.join(DIR, 'profile')}`, `--remote-debugging-port=${port}`], {
    cwd: ROOT, env: { ...process.env, VEX_NO_OS_SCHEDULE: '1', VEX_SKIP_VMP_VERIFY: '1' }, stdio: 'ignore',
  });
  const cache = path.join(DIR, 'profile', 'vex-adblock-engine-full.bin');
  try {
    for (let i = 0; i < 60; i++) { await sleep(1000); if (fs.existsSync(cache) && fs.statSync(cache).size > 0 && i > 8) { await sleep(1500); break; } }
  } finally { try { child.kill(); } catch { /* gone */ } await sleep(2500); }
  return fs.existsSync(cache);
}

async function main() {
  if (!fs.existsSync(path.join(ROOT, 'src', 'main.js'))) throw new Error('no src/main.js under ' + ROOT);
  const electron = require(path.join(ROOT, 'node_modules', 'electron'));
  const dir = DIR;
  fs.mkdirSync(dir, { recursive: true });
  const warm = args.includes('--no-warmup') ? null : await warmUp(electron);
  const port = await freePort();
  const hookFile = path.join(dir, 'main-hook.js');
  const outFile = path.join(dir, 'main-state.json');
  fs.writeFileSync(hookFile, HOOK);
  // A few small pages to navigate to, so tabs have a real page without the internet.
  const site = http.createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end(`<title>Perf page ${q.url}</title><h1>${q.url}</h1>`); });
  await new Promise(r => site.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${site.address().port}`;

  const child = spawn(electron, ['-r', hookFile, '.', `--user-data-dir=${path.join(dir, 'profile')}`, `--remote-debugging-port=${port}`], {
    cwd: ROOT,
    env: { ...process.env, VEX_NO_OS_SCHEDULE: '1', VEX_SKIP_VMP_VERIFY: '1', VEX_PERF_OUT: outFile },
    stdio: 'ignore',
  });
  let exited = false; child.on('exit', () => { exited = true; });
  const result = {};
  let page = null;
  try {
    let target = null;
    for (let i = 0; i < 90 && !target; i++) {
      await sleep(1000);
      if (exited) throw new Error('Vex exited while starting');
      try { target = (await getJson(`http://127.0.0.1:${port}/json/list`)).find(t => /renderer\/index\.html/.test((t.url || '').split('?')[0])); } catch { /* not listening yet */ }
    }
    if (!target) throw new Error('the Vex window never appeared');
    page = await cdp(target.webSocketDebuggerUrl);
    const ev = async (expression) => {
      const r = await page.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
      if (r.error) throw new Error(r.error.message);
      if (r.result.exceptionDetails) throw new Error(String((r.result.exceptionDetails.exception || {}).description || r.result.exceptionDetails.text).split('\n')[0]);
      return r.result.result.value;
    };
    await page.send('Runtime.enable'); await page.send('Performance.enable');
    for (let i = 0; i < 60; i++) { if (await ev(`typeof TabManager !== 'undefined' && typeof SidebarManager !== 'undefined' && document.readyState === 'complete'`) === true) break; await sleep(500); }
    await ev(`(() => { try { if (typeof Onboarding !== 'undefined' && Onboarding.finish) Onboarding.finish(); } catch (e) {} document.querySelectorAll('.onboarding-overlay, #onboarding, .tour-overlay').forEach(e => e.remove()); return 1; })()`);
    await sleep(4000);
    const state = () => { try { return JSON.parse(fs.readFileSync(outFile, 'utf8')); } catch { return null; } };
    const metrics = async () => { const r = await page.send('Performance.getMetrics'); const o = {}; for (const m of r.result.metrics) o[m.name] = m.value; return o; };
    const round = (n, d = 0) => { const k = 10 ** d; return Math.round(n * k) / k; };

    // boot (before the DevTools that a source run opens are closed)
    await ev(`(() => { window.__lt = []; try { new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lt.push(e.duration); }).observe({ type: 'longtask', buffered: true }); } catch (e) {} return 1; })()`);
    await sleep(300);
    const nav = await ev(`(() => { const n = performance.getEntriesByType('navigation')[0]; const f = performance.getEntriesByType('paint').find(p => p.name === 'first-contentful-paint'); return { responseEnd: n.responseEnd, domInteractive: n.domInteractive, load: n.loadEventEnd, firstPaint: f ? f.startTime : null, scripts: document.scripts.length, longTasks: window.__lt.length, longTaskMs: window.__lt.reduce((a, b) => a + b, 0) }; })()`);
    const s0 = state() || {};
    result.boot = {
      mainReadyMs: round(s0.marks && s0.marks.ready), mainWindowCreatedMs: round(s0.marks && s0.marks.windowCreated),
      mainReadyToShowMs: round(s0.marks && s0.marks.readyToShow), mainDidFinishLoadMs: round(s0.marks && s0.marks.didFinishLoad),
      mainModuleLoadMs: round(s0.modMs), mainStallsOver40ms: (s0.stalls || []).filter(s => s[0] < 5000).length,
      mainWorstStallMs: Math.max(0, ...(s0.stalls || []).filter(s => s[0] < 5000).map(s => s[1])),
      windowResponseEndMs: round(nav.responseEnd), windowDomInteractiveMs: round(nav.domInteractive), windowLoadMs: round(nav.load),
      windowFirstPaintMs: round(nav.firstPaint), windowScripts: nav.scripts, windowLongTasks: nav.longTasks, windowLongTaskTotalMs: round(nav.longTaskMs),
    };

    // DevTools of a source run
    const ver = await getJson(`http://127.0.0.1:${port}/json/version`);
    const br = await cdp(ver.webSocketDebuggerUrl);
    for (const t of (await getJson(`http://127.0.0.1:${port}/json/list`)).filter(t => /^devtools:/.test(t.url))) await br.send('Target.closeTarget', { targetId: t.id });
    br.close(); await sleep(1000);

    const gc = async () => { await page.send('HeapProfiler.collectGarbage'); await sleep(250); await page.send('HeapProfiler.collectGarbage'); };
    const mem = async () => {
      await gc();
      const h = await page.send('Runtime.getHeapUsage'); const c = (await page.send('Memory.getDOMCounters')).result;
      const s = state() || { mem: {} };
      return { windowHeapMB: round(h.result.usedSize / 1048576, 1), domNodes: c.nodes, jsListeners: c.jsEventListeners, mainRssMB: round((s.mem.rss || 0) / 1048576), mainHeapMB: round((s.mem.heapUsed || 0) / 1048576, 1) };
    };
    const idle = async (seconds) => {
      const a = await metrics(); const c0 = JSON.parse(JSON.stringify((state() || { cnt: { ipcIn: {}, send: {} } }).cnt)); const t0 = Date.now();
      await sleep(seconds * 1000);
      const b = await metrics(); const c1 = (state() || { cnt: { ipcIn: {}, send: {} } }).cnt; const sec = (Date.now() - t0) / 1000;
      const total = (x, y) => Object.keys(y).reduce((n, k) => n + (y[k] - (x[k] || 0)), 0);
      return { windowCpuPct: round((b.TaskDuration - a.TaskDuration) / sec * 100, 2), ipcToMainPerSec: round(total(c0.ipcIn, c1.ipcIn) / sec, 1), sendsToWindowPerSec: round(total(c0.send, c1.send) / sec, 1), styleRecalcsPerSec: round((b.RecalcStyleCount - a.RecalcStyleCount) / sec, 1) };
    };
    const frames = `await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))`;
    // sync = time inside the call; wall = until two frames have been drawn
    const timed = (call) => ev(`(async () => { const t = performance.now(); ${call}; const sync = performance.now() - t; ${frames}; return { sync: Math.round(sync * 10) / 10, wall: Math.round((performance.now() - t) * 10) / 10 }; })()`);

    result.memoryStart = await mem();
    result.idleOneTab = await idle(8);

    // panels
    result.panels = {};
    result.panels.settingsFirst = await timed(`SidebarManager.openPanel('settings')`);
    await ev(`SidebarManager.openPanel('start')`); await sleep(400);
    result.panels.settingsAgain = await timed(`SidebarManager.openPanel('settings')`);
    await ev(`SidebarManager.openPanel('start')`); await sleep(400);
    for (const name of ['notes', 'bookmarks', 'history', 'downloads', 'library', 'queue']) {
      try {
        result.panels[name + 'First'] = await timed(`SidebarManager.openPanel(${JSON.stringify(name)})`);
        await ev(`SidebarManager.openPanel('start')`); await sleep(300);
      } catch (e) { result.panels[name + 'First'] = { error: e.message }; }
    }

    // Ctrl+K
    result.commandBar = { open: await timed(`CommandBar.open()`) };
    for (const q of ['a', 'ab', 's', 'se', 'settings']) result.commandBar['search_' + q] = await timed(`CommandBar.search(${JSON.stringify(q)})`);
    await ev(`CommandBar.close()`); await sleep(200);

    // tabs: cost of one more tab at 1, and at N
    const tabCost = async (label) => {
      const create = await timed(`TabManager.createTab(${JSON.stringify(base + '/one-more')}, true)`);
      await sleep(1200);
      const sw = await ev(`(async () => { const ids = TabManager.tabs.map(t => t.id); const out = []; for (const id of ids.slice(0, 6)) { const a = performance.now(); TabManager.switchTab(id); out.push(performance.now() - a); await new Promise(r => setTimeout(r, 120)); } out.sort((a, b) => a - b); return Math.round(out[out.length >> 1] * 10) / 10; })()`);
      const close = await timed(`(() => { const t = TabManager.tabs[TabManager.tabs.length - 1]; TabManager.closeTab(t.id); })()`);
      await sleep(600);
      result.tabs[label] = { openedCreate: create, switchMedianSync: sw, close };
    };
    result.tabs = {};
    await tabCost('at2');
    await ev(`(async () => { for (let i = 0; i < ${TABS}; i++) { TabManager.createTab(${JSON.stringify(base + '/t')} + i, i === 0); await new Promise(r => setTimeout(r, 90)); } })()`);
    await sleep(6000);
    result.tabs.count = await ev(`TabManager.tabs.length`);
    await tabCost('atN');
    result.idleManyTabs = await idle(8);

    // memory: panel cycles, tab cycles
    await ev(`(async () => { const ids = TabManager.tabs.slice(1).map(t => t.id); ids.forEach(id => TabManager.closeTab(id)); })()`);
    await sleep(3000);
    const before = await mem();
    for (let c = 0; c < 3; c++) {
      for (const name of ['settings', 'notes', 'history', 'bookmarks', 'downloads']) { await ev(`SidebarManager.openPanel(${JSON.stringify(name)})`); await sleep(150); }
      await ev(`SidebarManager.openPanel('start')`); await sleep(300);
    }
    result.memoryAfterPanelCycles = await mem();
    for (let c = 0; c < 3; c++) {
      await ev(`(() => { for (let i = 0; i < 10; i++) TabManager.createTab(${JSON.stringify(base + '/cycle')} + i, i === 0); })()`);
      await sleep(4000);
      await ev(`(() => { TabManager.tabs.slice(1).map(t => t.id).forEach(id => TabManager.closeTab(id)); })()`);
      await sleep(2000);
    }
    result.memoryAfterTabCycles = await mem();
    result.memoryBefore = before;

    // writes
    const w0 = (state() || { writes: {} }).writes.persist || 0;
    const actions = [`SidebarManager.openPanel('notes')`, `SidebarManager.openPanel('history')`, `SidebarManager.openPanel('settings')`, `SidebarManager.openPanel('start')`,
      `TabManager.createTab(${JSON.stringify(base + '/w')}, true)`, `TabManager.switchTab(TabManager.tabs[0].id)`, `CommandBar.open()`, `CommandBar.close()`, `SidebarManager.openPanel('bookmarks')`, `SidebarManager.openPanel('start')`];
    for (const a of actions) { await ev(a); await sleep(1600); }
    await sleep(2000);
    result.writes = { actions: actions.length, persistFileRewrites: ((state() || { writes: {} }).writes.persist || 0) - w0 };
    const endState = state() || { stalls: [] };
    const late = endState.stalls.filter(s => s[0] >= 6000);
    result.mainLoop = { stallsOver40msAfterBoot: late.length, worstStallMsAfterBoot: Math.max(0, ...late.map(s => s[1])) };
    result.generatedAt = new Date().toISOString();
    result.root = ROOT;
    result.warmProfile = warm === null ? 'skipped (--no-warmup)' : warm ? 'ad blocker cache present' : 'no ad blocker cache (offline?)';
    result.tabsRequested = TABS;
  } finally {
    try { if (page) page.close(); } catch { /* closing */ }
    try { child.kill(); } catch { /* already gone */ }
    site.close();
    await sleep(1500);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* leave it to the temp cleaner */ }
  }
  return result;
}

function table(r) {
  const row = (k, v) => `  ${k.padEnd(34)} ${v}`;
  const t = (x) => x && typeof x === 'object' ? `${x.sync} sync / ${x.wall} to 2 frames` : String(x);
  const out = [];
  out.push(`Vex perf baseline   ${r.generatedAt}   ${r.root}`, `profile: ${r.warmProfile}`);
  out.push('', 'boot (ms)'); for (const [k, v] of Object.entries(r.boot)) out.push(row(k, v));
  out.push('', 'sidebar panels (ms)'); for (const [k, v] of Object.entries(r.panels)) out.push(row(k, v.error ? 'ERROR ' + v.error : t(v)));
  out.push('', 'Ctrl+K (ms)'); for (const [k, v] of Object.entries(r.commandBar)) out.push(row(k, t(v)));
  out.push('', `tabs (${r.tabs.count} open at N)`);
  for (const k of ['at2', 'atN']) out.push(row(k + ' create', t(r.tabs[k].openedCreate)), row(k + ' switch (median sync)', r.tabs[k].switchMedianSync), row(k + ' close', t(r.tabs[k].close)));
  out.push('', 'idle'); out.push(row('1 tab', JSON.stringify(r.idleOneTab))); out.push(row(r.tabs.count + ' tabs', JSON.stringify(r.idleManyTabs)));
  out.push('', 'memory (after GC)');
  for (const k of ['memoryStart', 'memoryBefore', 'memoryAfterPanelCycles', 'memoryAfterTabCycles']) out.push(row(k, JSON.stringify(r[k])));
  out.push('', 'main process event loop, after boot'); out.push(row('stalls over 40 ms', r.mainLoop.stallsOver40msAfterBoot), row('worst stall', r.mainLoop.worstStallMsAfterBoot + ' ms'));
  out.push('', 'file writes'); out.push(row(`${r.writes.actions} actions`, `${r.writes.persistFileRewrites} rewrites of vex-persist.json`));
  return out.join('\n');
}

main().then((r) => { console.log(AS_JSON ? JSON.stringify(r, null, 2) : table(r)); process.exit(0); })
  .catch((e) => { console.error('perf-baseline failed:', e && e.message ? e.message : e); process.exit(1); });
