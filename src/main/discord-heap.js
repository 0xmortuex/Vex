// === Which Vencord plugin allocates how much: Chromium's sampling heap profiler ==========
//
// Discord's panel is one renderer; every Vencord plugin lives in it, so the OS reports one number. Chromium's own
// sampling heap profiler can say, for objects still alive, which function allocated them. This module attaches the
// debugger to the Discord panel for a short window the person asks for, reads that profile and adds it up per plugin.
//
// What it does to the page, all of it read-only:
//   - attaches the debugger (protocol 1.3) and detaches again right after; it refuses when DevTools or anything else
//     is already attached, when Discord is audible (a call), and for any page that is not the Discord panel;
//   - sends exactly five commands (ALLOWED below): Runtime.getHeapUsage, HeapProfiler.collectGarbage (a major
//     garbage collection, a short pause), startSampling, getSamplingProfile, stopSampling. No breakpoint, no pause,
//     no evaluation, no DOM or network domain is ever enabled;
//   - keeps nothing: the profile (function names and addresses of Vencord's and Discord's code) is added up here and
//     only numbers and plugin names go back to the window.
// A session that nobody ends is ended by itself after MAX_SESSION_MS, and when the page goes away.
//
// What the sampling profile is, and is not: with includeObjectsCollectedBy*GC off it lists the objects that were
// allocated AFTER startSampling and are STILL ALIVE when the profile is read. So it shows what each plugin
// allocated and kept during the window, not everything it has ever allocated (a message log filled before the window
// is not in it: the one-plugin-at-a-time test is the way to see that). Native memory (decoded images, emoji, video) is
// not JavaScript heap and is never attributed per plugin.
//
// How a stack is attributed to a plugin: the line map. The Vencord build writes dist/vencord-plugin-ranges.json
// (Vencord repository, scripts/build/pluginRanges.mjs); this module reads it from the installed extension folder
// (never a path from a window), refuses it unless the size and sha256 of dist/Vencord.js match, and looks every frame
// of the Vencord bundle up in it. An allocation is counted for the plugin nearest the allocation on its call stack;
// a stack with only Vencord core frames is "Vencord core"; anything else is "Discord itself / unattributed". Without
// a usable line map, frames are matched by the plugin's name in the function name or in a dev-build source path
// (a much weaker guess, and the result says so).

const nodeCrypto = require('crypto');
const nodeFs = require('fs');
const nodePath = require('path');

const ALLOWED = new Set(['Runtime.getHeapUsage', 'HeapProfiler.collectGarbage', 'HeapProfiler.startSampling', 'HeapProfiler.getSamplingProfile', 'HeapProfiler.stopSampling']);
const SAMPLING_INTERVAL = 32768;
const MAX_SESSION_MS = 6 * 60000;
// Every debugger command waits on Discord's page. A page that does not answer (frozen, throttled, busy) used to leave the
// measurement waiting for ever at "0 s left"; now each step has a limit and says which step it was.
const STEP_TIMEOUT_MS = 90000;
// Measured 2026-10-18 (a disposable profile, webContents.debugger, Electron 42): HeapProfiler.getSamplingProfile answers in
// about 30 ms for call stacks up to 60 frames deep and NEVER answers once they are 100 frames deep or more, however small the
// heap (100 MB, 600 MB, any sampling interval, visible or hidden; stopSampling, which returns the same profile, hangs too). The
// profile is a tree that nests two JSON levels per frame, and Electron's debugger drops a message nested more than about 200
// levels without an error. Discord's stacks (React, Vencord's patches) are that deep, so waiting longer cannot help: this step
// gets a short limit and says why, and the person is pointed at the one-plugin-at-a-time test, which reads flat numbers only.
const PROFILE_TIMEOUT_MS = 30000;
const PROFILE_TOO_DEEP = 'Discord\u2019s allocation profile did not come back. Electron drops a profile whose call stacks are about 100 frames deep or more, and Discord\u2019s usually are, so this quick method cannot read it here. Use "One at a time..." instead: it measures each plugin by turning it off and does not need the profile.';
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_NAMES = 600;
const MAX_NODES = 2000000;
const RANGES_SCHEMA = 'vex-plugin-ranges/1';
const BUNDLE_URL_RE = /^file:\/\/\/VencordWeb$|\/dist\/Vencord\.js$/;

const toMB = (bytes) => Math.round((bytes / 1048576) * 10) / 10;

// ---- the line map ---------------------------------------------------------------------------------------------
// Validates the parsed file; throws a plain sentence for anything else than the exact shape.
function checkManifest(m) {
  if (!m || typeof m !== 'object' || m.schema !== RANGES_SCHEMA) throw new Error('The plugin line map is not a ' + RANGES_SCHEMA + ' file');
  if (!Array.isArray(m.owners) || !m.owners.length || m.owners[0] !== '' || !m.owners.every(o => typeof o === 'string' && o.length <= 100)) throw new Error('The plugin line map has no valid owner list');
  if (!Array.isArray(m.runs) || m.runs.length % 3 !== 0 || m.runs.length > 3000000) throw new Error('The plugin line map has no valid runs');
  let pl = -1, pc = -1;
  for (let i = 0; i < m.runs.length; i += 3) {
    const l = m.runs[i], c = m.runs[i + 1], o = m.runs[i + 2];
    if (!Number.isInteger(l) || !Number.isInteger(c) || !Number.isInteger(o) || l < 0 || c < 0 || o < 0 || o >= m.owners.length) throw new Error('The plugin line map has a run that is not valid');
    if (l < pl || (l === pl && c <= pc)) throw new Error('The plugin line map is not sorted');
    pl = l; pc = c;
  }
  if (!Number.isInteger(m.bundleBytes) || typeof m.bundleSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(m.bundleSha256)) throw new Error('The plugin line map does not name its bundle');
  return m;
}

// Binary search: the owner at a 0-based line and column. '' is Vencord core; null is before the first run.
function lookupOwner(m, line, column) {
  const runs = m.runs;
  let lo = 0, hi = runs.length / 3 - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const l = runs[mid * 3], c = runs[mid * 3 + 1];
    if (l < line || (l === line && c <= column)) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found < 0 ? null : m.owners[runs[found * 3 + 2]];
}

// The line map next to the installed Vencord, or the reason there is none. status: 'ok' | 'missing' | 'stale' | 'unreadable'.
function loadRanges(extensionDir, fs = nodeFs) {
  if (!extensionDir) return { status: 'missing', manifest: null, why: 'Vencord is not installed' };
  const file = nodePath.join(extensionDir, 'dist', 'vencord-plugin-ranges.json');
  const bundle = nodePath.join(extensionDir, 'dist', 'Vencord.js');
  let stat;
  try { stat = fs.statSync(file); } catch (err) {
    if (err && err.code === 'ENOENT') return { status: 'missing', manifest: null, why: 'this Vencord build has no plugin line map (build it with pnpm buildWeb from the w6-plugin-ram branch)' };
    return { status: 'unreadable', manifest: null, why: 'the plugin line map could not be read: ' + err.message };
  }
  if (stat.size > MAX_MANIFEST_BYTES) return { status: 'unreadable', manifest: null, why: 'the plugin line map is bigger than 4 MB' };
  let manifest;
  try { manifest = checkManifest(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch (err) {
    return { status: 'unreadable', manifest: null, why: err.message };
  }
  let bytes;
  try { bytes = fs.readFileSync(bundle); } catch (err) { return { status: 'unreadable', manifest: null, why: 'Vencord.js could not be read to check the line map: ' + err.message }; }
  const sha = nodeCrypto.createHash('sha256').update(bytes).digest('hex');
  if (bytes.length !== manifest.bundleBytes || sha !== manifest.bundleSha256) {
    return { status: 'stale', manifest: null, why: 'the plugin line map was made for a different Vencord.js than the installed one (rebuild and reinstall Vencord)' };
  }
  return { status: 'ok', manifest, why: '' };
}

// ---- attribution ------------------------------------------------------------------------------------------------
function cleanNames(names) {
  if (names == null) return [];
  if (!Array.isArray(names) || names.length > MAX_NAMES) throw new Error('The plugin name list is not valid');
  const out = [];
  for (const n of names) {
    if (typeof n !== 'string' || !/^[A-Za-z0-9_$][A-Za-z0-9_$ .-]{0,63}$/.test(n)) throw new Error('A plugin name is not valid: ' + JSON.stringify(typeof n === 'string' ? n.slice(0, 40) : typeof n));
    out.push(n);
  }
  return out;
}

// By name only (no usable line map): a dev-build source path ".../plugins/<folder>/..." whose folder is the plugin's name
// with a lower-case first letter, or a function name that starts with the plugin's name. Weak on purpose; names under six
// letters are skipped because they match too much.
function makeNameMatcher(names) {
  // Longest name first, so MessageLoggerEnhanced is not taken for MessageLogger.
  const lower = names.filter(n => n.length >= 6).sort((a, b) => b.length - a.length).map(n => [n, n.toLowerCase()]);
  return (frame) => {
    const url = String(frame.url || '');
    const folder = /[\\/](?:user)?plugins[\\/](?:_api[\\/]|_core[\\/])?([^\\/]+)[\\/]/i.exec(url);
    if (folder) {
      const f = folder[1].toLowerCase();
      const hit = lower.find(([, l]) => l === f);
      if (hit) return hit[0];
    }
    const fn = String(frame.functionName || '');
    if (fn.length < 6) return null;
    const fl = fn.toLowerCase();
    for (const [n, l] of lower) {
      if (fl.startsWith(l) && (fl.length === l.length || /[._$:]/.test(fn[l.length]) || /[A-Z]/.test(fn[l.length]))) return n;
    }
    return null;
  };
}

// profile = the Chromium SamplingHeapProfile ({ head: { callFrame, selfSize, children } }).
// Returns bytes per plugin (nearest plugin on the stack, and the plugin's own function), core, other and total.
function attribute(profile, { manifest = null, names = [] } = {}) {
  if (!profile || !profile.head || typeof profile.head !== 'object') throw new Error('The heap profile has no call tree');
  const byName = makeNameMatcher(names);
  const plugins = new Map();
  const bucket = (name) => { let b = plugins.get(name); if (!b) { b = { stack: 0, self: 0 }; plugins.set(name, b); } return b; };
  let core = 0, other = 0, total = 0, bundleFrames = 0, nodes = 0;
  const ownerOf = (frame) => {
    if (!frame) return { plugin: null, core: false };
    if (manifest && BUNDLE_URL_RE.test(String(frame.url || ''))) {
      bundleFrames++;
      const o = lookupOwner(manifest, Number(frame.lineNumber) || 0, Number(frame.columnNumber) || 0);
      if (o === null) return { plugin: null, core: true };
      return o === '' ? { plugin: null, core: true } : { plugin: o, core: false };
    }
    const n = byName(frame);
    return { plugin: n, core: false };
  };
  const stack = [{ node: profile.head, plugin: null, core: false }];
  while (stack.length) {
    const { node, plugin: inherited, core: sawCore } = stack.pop();
    if (++nodes > MAX_NODES) throw new Error('The heap profile is too big to add up');
    const own = ownerOf(node.callFrame);
    const plugin = own.plugin || inherited;
    const core2 = sawCore || own.core;
    const size = Number(node.selfSize) || 0;
    if (size > 0) {
      total += size;
      if (plugin) { bucket(plugin).stack += size; if (own.plugin) bucket(plugin).self += size; }
      else if (core2) core += size;
      else other += size;
    }
    if (Array.isArray(node.children)) for (const c of node.children) stack.push({ node: c, plugin, core: core2 });
  }
  return { plugins, core, other, total, bundleFrames, nodes };
}

// ---- a session: begin, wait (the window checks for a call), end -------------------------------------------------------
function createDiscordHeap({ webContents, isDiscordContents, loadManifest, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout, now = Date.now, stepTimeoutMs = STEP_TIMEOUT_MS, profileTimeoutMs = PROFILE_TIMEOUT_MS, log = (line) => console.warn(line) }) {
  const sessions = new Map();

  // Races one debugger command against the step limit. `label` is what the person is told.
  const step = (label, promise, { ms = stepTimeoutMs, why = '' } = {}) => new Promise((resolve, reject) => {
    const timer = setTimeoutFn(() => reject(new Error(why || ('Discord did not answer "' + label + '" within ' + Math.round(ms / 1000) + ' seconds, so nothing was kept. Try again with Discord left alone, or a shorter window.'))), ms);
    Promise.resolve(promise)
      .then((v) => { clearTimeoutFn(timer); resolve(v); })
      .catch((e) => { clearTimeoutFn(timer); reject(e); });
  });

  function attach(id) {
    const wc = Number.isInteger(id) ? webContents.fromId(id) : null;
    if (!wc || wc.isDestroyed()) throw new Error('Discord has closed or is not loaded');
    if (!isDiscordContents(wc)) throw new Error('Only the Discord panel can be measured this way');
    if (sessions.has(id)) throw new Error('Discord is already being measured');
    const dbg = wc.debugger;
    if (dbg.isAttached()) throw new Error('DevTools (or another tool) is already attached to Discord - close it and try again');
    if (typeof wc.isCurrentlyAudible === 'function' && wc.isCurrentlyAudible()) throw new Error('Discord is playing sound (a call?) - not measured');
    try { dbg.attach('1.3'); } catch (err) { throw new Error('Could not attach to Discord: ' + err.message, { cause: err }); }
    return { wc, dbg };
  }
  const sender = (dbg) => (method, params) => {
    if (!ALLOWED.has(method)) throw new Error('Debugger command not allowed: ' + method);
    return dbg.sendCommand(method, params || {});
  };
  const heapOf = async (send) => {
    const r = await send('Runtime.getHeapUsage');
    if (!r || !Number.isFinite(r.usedSize) || !Number.isFinite(r.totalSize)) throw new Error('Discord did not report its heap');
    return { usedMB: toMB(r.usedSize), totalMB: toMB(r.totalSize) };
  };
  const detach = (dbg) => { try { if (dbg.isAttached()) dbg.detach(); } catch { /* vex-allow-empty-catch: the page is already gone */ } };

  // One heap reading after a garbage collection (the one-plugin-at-a-time test).
  async function usage(id) {
    const { dbg } = attach(id);
    try {
      const send = sender(dbg);
      await send('HeapProfiler.collectGarbage');
      return await heapOf(send);
    } finally { detach(dbg); }
  }

  async function begin(id, names) {
    const list = cleanNames(names);
    const { wc, dbg } = attach(id);
    let s = null;
    try {
      const send = sender(dbg);
      await step('collecting memory', send('HeapProfiler.collectGarbage'));
      const before = await step('reading the heap size', heapOf(send));
      await step('starting the profiler', send('HeapProfiler.startSampling', { samplingInterval: SAMPLING_INTERVAL, includeObjectsCollectedByMajorGC: false, includeObjectsCollectedByMinorGC: false }));
      s = { id, wc, dbg, send, before, names: list, startedAt: now(), timer: null, over: false };
      s.timer = setTimeoutFn(() => { end(id, false).catch(err => console.error('[Discord heap] the unattended session could not be ended:', err)); }, MAX_SESSION_MS);
      if (s.timer && typeof s.timer.unref === 'function') s.timer.unref();
      dbg.on('detach', () => { if (sessions.get(id) === s) { clearTimeoutFn(s.timer); sessions.delete(id); } });
      sessions.set(id, s);
      return { ok: true, beforeMB: before.usedMB, startedAt: s.startedAt };
    } catch (err) {
      detach(dbg);
      throw err;
    }
  }

  // keep=false throws the profile away (a call started, or the person cancelled). Always detaches.
  async function end(id, keep) {
    const s = sessions.get(id);
    if (!s) throw new Error('No Discord measurement is running');
    sessions.delete(id);
    clearTimeoutFn(s.timer);
    try {
      if (!keep) { try { await s.send('HeapProfiler.stopSampling'); } catch { /* vex-allow-empty-catch: discarding, and the page may be gone */ } return { ok: true, discarded: true }; }
      if (s.wc.isDestroyed()) throw new Error('Discord closed during the measurement');
      if (typeof s.wc.isCurrentlyAudible === 'function' && s.wc.isCurrentlyAudible()) throw new Error('Discord started playing sound (a call?) - the measurement was dropped');
      const t0 = now();
      await step('collecting memory', s.send('HeapProfiler.collectGarbage'));
      const t1 = now();
      const got = await step('reading the allocation profile', s.send('HeapProfiler.getSamplingProfile'), { ms: profileTimeoutMs, why: PROFILE_TOO_DEEP });
      const t2 = now();
      const after = await step('reading the heap size', heapOf(s.send));
      await step('stopping the profiler', s.send('HeapProfiler.stopSampling'));
      const t3 = now();
      const ranges = loadManifest();
      const a = attribute(got && got.profile, { manifest: ranges.manifest, names: s.names });
      log('[Discord heap] finished: collect ' + (t1 - t0) + ' ms, profile ' + (t2 - t1) + ' ms, size+stop ' + (t3 - t2) + ' ms, adding up ' + (now() - t3) + ' ms, ' + a.nodes + ' nodes');
      const kb = (b) => Math.round(b / 1024);
      const rows = [...a.plugins].map(([name, v]) => ({ name, kb: kb(v.stack), selfKB: kb(v.self) })).filter(r => r.kb > 0 || r.selfKB > 0).sort((x, y) => y.kb - x.kb);
      return {
        ok: true, windowMs: Math.max(0, now() - s.startedAt),
        heap: { beforeMB: s.before.usedMB, afterMB: after.usedMB, totalMB: after.totalMB },
        map: { status: ranges.status, why: ranges.why, bundleFrames: a.bundleFrames },
        plugins: rows, coreKB: kb(a.core), otherKB: kb(a.other), totalKB: kb(a.total)
      };
    } finally { detach(s.dbg); }
  }

  return { begin, end, usage, active: () => sessions.size, ALLOWED };
}

module.exports = { createDiscordHeap, attribute, lookupOwner, checkManifest, loadRanges, makeNameMatcher, cleanNames, ALLOWED, MAX_SESSION_MS, SAMPLING_INTERVAL, BUNDLE_URL_RE };
