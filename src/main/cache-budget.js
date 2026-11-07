'use strict';
// === Keep Vex's cache under a size: a quiet, measured housekeeping pass ====================================
//
// Measured on a real profile (read-only): the partitions folder was about 5 GB, of which the big part was caches that
// Chromium rebuilds on its own (an HTTP cache, and a "Code Cache" of compiled scripts: 700 MB for Discord, 22,000 files for
// Claude). Nothing capped them. This is an opt-in (OFF by default) pass that clears ONLY those two disposable caches,
// one partition at a time, largest first, until the total is under the size the person chose.
//
// WHAT IT CLEARS (Electron's own session APIs, node_modules/electron/electron.d.ts):
//   session.clearCache()                     "Clears the session's HTTP cache."
//   session.clearCodeCaches({ urls: [] })    "If the list is empty then all entries in the cache directory will be removed."
// WHAT IT NEVER TOUCHES: cookies, local storage, IndexedDB, service worker registrations, passwords, history, and
// CacheStorage. clearStorageData({ storages: ['cachestorage'] }) is deliberately NOT used: the d.ts only says it clears
// that storage type, and nothing there shows that a web app which keeps its app shell or offline data in CacheStorage
// (WhatsApp, Discord) stays signed in and working afterwards, so it is measured and shown but never cleared.
//
// WHEN (the scheduled pass): switched on, at most once a day, the computer idle for 10 minutes, no game running, not in quiet
// hours, never twice at once; a site's own partition with a tab open is skipped. The main browsing partition holds every
// ordinary tab, so it is never "open" in that sense: it is cleared only by the idle pass (nobody at the keyboard for 10 minutes)
// or when the person presses the button. Clearing a cache under a running page is what Chrome's own "Clear browsing data" does.
// The folders are measured read-only, in chunks that give the event loop back, and the measuring stops at a time cap.
//
// Everything that touches the disk or a session is injected, so tests/main/cacheBudget.test.js runs it on a temp folder with
// fake sessions and a fake clock.
const path = require('path');
const { atomicWriteSync } = require('./file-store');

const FILE = 'cache-budget.json';
const GB = 1024 * 1024 * 1024;
const DAY_MS = 24 * 3600 * 1000;
const IDLE_SECONDS = 600;
const MIN_GB = 1;
const MAX_GB = 50;
const DEFAULT_GB = 3;
const MEASURE_CAP_MS = 4000;          // the whole measuring of all partitions
const MAX_ENTRIES = 300000;           // files and folders looked at in one measuring
const YIELD_EVERY = 400;              // entries between giving the event loop back
const MAIN_PARTITION = 'persist:main';

const DISPOSABLE = Object.freeze([
  Object.freeze({ key: 'cache', rel: ['Cache'] }),
  Object.freeze({ key: 'code', rel: ['Code Cache'] }),
]);
const REPORT_ONLY = Object.freeze({ key: 'cacheStorage', rel: ['Service Worker', 'CacheStorage'] });

// Partitions/<name> is the folder of persist:<name>. Only plain names are ever turned back into a partition.
function partitionIdOf(dirName) {
  let name;
  try { name = decodeURIComponent(String(dirName)); } catch { return null; }   // a name that is not valid escaping is not one of ours
  return /^[A-Za-z0-9._ -]{1,120}$/.test(name) ? 'persist:' + name : null;
}

function cleanLimitGB(v) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < MIN_GB || v > MAX_GB) throw new Error('The cache size is from ' + MIN_GB + ' to ' + MAX_GB + ' GB');
  return Math.round(v * 10) / 10;
}

// Total size of a folder, read-only, in chunks. { bytes, partial } - partial when the time cap or the entry cap stopped it
// (the figure is then at least this much). A folder that is not there is 0.
async function dirSize(dir, { fs, now, deadline, yieldFn, counter }) {
  let bytes = 0;
  const stack = [dir];
  while (stack.length) {
    if (now() > deadline || counter.n > MAX_ENTRIES) return { bytes, partial: true };
    const here = stack.pop();
    let entries;
    try { entries = await fs.promises.readdir(here, { withFileTypes: true }); }
    catch (err) { if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) continue; throw err; }
    for (const e of entries) {
      counter.n++;
      if (counter.n % YIELD_EVERY === 0) {
        await yieldFn();
        if (now() > deadline || counter.n > MAX_ENTRIES) return { bytes, partial: true };
      }
      const full = path.join(here, e.name);
      if (e.isDirectory()) { stack.push(full); continue; }
      if (!e.isFile()) continue;                                  // links and devices are not followed
      try { bytes += (await fs.promises.stat(full)).size; }
      catch (err) { if (!err || err.code !== 'ENOENT') throw err; }   // a cache file that went away while measuring
    }
  }
  return { bytes, partial: false };
}

// What would be cleared, from measured sizes. Pure.
//   parts   [{ id, label, cache, code, cacheStorage, partial }]
//   limit   bytes the two disposable caches together may use
//   open    Set of partition ids that have a tab open right now
function plan(parts, limit, { open = new Set() } = {}) {
  const disposable = (p) => (p.cache || 0) + (p.code || 0);
  const total = parts.reduce((n, p) => n + disposable(p), 0);
  const out = { limit, total, over: Math.max(0, total - limit), items: [], skipped: [], freeable: 0 };
  if (total <= limit) return out;
  let need = total - limit;
  const bySize = parts.filter(p => disposable(p) > 0).sort((a, b) => disposable(b) - disposable(a) || (a.id < b.id ? -1 : 1));
  for (const p of bySize) {
    if (need <= 0) break;
    // A site's own partition with a tab open is left alone (the main partition always has tabs and is not held by that rule).
    if (p.id !== MAIN_PARTITION && open.has(p.id)) { out.skipped.push({ id: p.id, label: p.label, bytes: disposable(p), reason: 'A tab of this site is open' }); continue; }
    out.items.push({ id: p.id, dir: p.dir, label: p.label, bytes: disposable(p), cache: p.cache || 0, code: p.code || 0 });
    out.freeable += disposable(p);
    need -= disposable(p);
  }
  return out;
}

function createCacheBudget({ userDataPath, fs, now = () => Date.now(), sessionFor, partitionsInUse = () => new Set(), isGaming = () => false, isQuiet = () => false, idleSeconds = () => 0, yieldFn = () => new Promise(r => setImmediate(r)), log = () => {}, capMs = MEASURE_CAP_MS, unitBytes = GB }) {
  if (!userDataPath) throw new Error('createCacheBudget needs the profile folder');
  if (typeof sessionFor !== 'function') throw new Error('createCacheBudget needs sessionFor(partition)');
  const stateFile = path.join(userDataPath, FILE);
  const partitionsDir = path.join(userDataPath, 'Partitions');
  let state = { enabled: false, limitGB: DEFAULT_GB, lastRunAt: 0, last: null };
  try {
    const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    state = {
      enabled: saved.enabled === true,
      limitGB: typeof saved.limitGB === 'number' && saved.limitGB >= MIN_GB && saved.limitGB <= MAX_GB ? saved.limitGB : DEFAULT_GB,
      lastRunAt: Number.isFinite(saved.lastRunAt) ? saved.lastRunAt : 0,
      last: saved.last && typeof saved.last === 'object' ? saved.last : null,
    };
  } catch (err) {
    if (!err || err.code !== 'ENOENT') log('[CacheBudget] could not read ' + FILE + ', starting with it off: ' + (err && err.message));
  }
  const save = () => atomicWriteSync(stateFile, JSON.stringify(state), { fsImpl: fs });
  let running = false;
  let timer = null;

  function get() { return { enabled: state.enabled, limitGB: state.limitGB, lastRunAt: state.lastRunAt, last: state.last }; }
  function set(next) {
    if (!next || typeof next !== 'object') throw new Error('Nothing to set');
    if (next.enabled !== undefined) { if (typeof next.enabled !== 'boolean') throw new Error('The cache budget is on or off'); state.enabled = next.enabled; }
    if (next.limitGB !== undefined) state.limitGB = cleanLimitGB(next.limitGB);
    save();
    return get();
  }

  // The partitions on disk with the size of each cache. Bounded: stops at capMs / MAX_ENTRIES and says so (partial).
  async function measure() {
    const started = now();
    const deadline = started + capMs;
    const counter = { n: 0 };
    let names;
    try { names = await fs.promises.readdir(partitionsDir, { withFileTypes: true }); }
    catch (err) { if (err && err.code === 'ENOENT') return { parts: [], partial: false, ms: 0 }; throw err; }
    const parts = [];
    let partial = false;
    for (const d of names) {
      if (!d.isDirectory()) continue;
      const id = partitionIdOf(d.name);
      if (!id) continue;
      const root = path.join(partitionsDir, d.name);
      const part = { id, dir: d.name, label: id === MAIN_PARTITION ? 'Main browsing' : id.slice('persist:'.length), cache: 0, code: 0, cacheStorage: 0, partial: false };
      for (const kind of [...DISPOSABLE, REPORT_ONLY]) {
        if (now() > deadline) { part.partial = true; partial = true; break; }
        const r = await dirSize(path.join(root, ...kind.rel), { fs, now, deadline, yieldFn, counter });
        part[kind.key] = r.bytes;
        if (r.partial) { part.partial = true; partial = true; }
      }
      parts.push(part);
    }
    return { parts, partial, ms: now() - started };
  }

  // unitBytes is one "GB" of the setting; only a test changes it (so a few kilobytes of files can stand for gigabytes).
  const limitBytes = () => Math.round(state.limitGB * unitBytes);

  async function preview() {
    const m = await measure();
    return { ...plan(m.parts, limitBytes(), { open: partitionsInUse() }), parts: m.parts, partial: m.partial, measuredMs: m.ms };
  }

  // Clears what plan() chose. A failure in one partition is reported and the others still run.
  async function clear() {
    if (running) throw new Error('The cache clean-up is already running');
    running = true;
    try {
      const before = await preview();
      const cleared = [];
      const errors = [];
      let freed = 0;
      for (const item of before.items) {
        // Re-check right before touching it: a tab may have been opened since the preview.
        if (item.id !== MAIN_PARTITION && partitionsInUse().has(item.id)) { before.skipped.push({ id: item.id, label: item.label, bytes: item.bytes, reason: 'A tab of this site is open' }); continue; }
        try {
          const ses = await sessionFor(item.id);
          await ses.clearCodeCaches({ urls: [] });
          await ses.clearCache();
        } catch (err) {
          log('[CacheBudget] could not clear ' + item.id + ': ' + (err && err.message));
          errors.push({ id: item.id, message: String((err && err.message) || err) });
          continue;
        }
        const root = path.join(partitionsDir, item.dir);
        let after = 0;
        const counter = { n: 0 };
        for (const kind of DISPOSABLE) after += (await dirSize(path.join(root, ...kind.rel), { fs, now, deadline: now() + capMs, yieldFn, counter })).bytes;
        const gone = Math.max(0, item.bytes - after);
        freed += gone;
        cleared.push({ id: item.id, label: item.label, freed: gone });
      }
      const report = { at: now(), limit: before.limit, totalBefore: before.total, freed, cleared, skipped: before.skipped, errors, partial: before.partial };
      state.last = report;
      state.lastRunAt = now();
      save();
      return report;
    } finally { running = false; }
  }

  // The scheduled pass: returns { ran: false, reason } or { ran: true, report }.
  async function housekeeping() {
    if (!state.enabled) return { ran: false, reason: 'off' };
    if (running) return { ran: false, reason: 'busy' };
    if (now() - state.lastRunAt < DAY_MS) return { ran: false, reason: 'already today' };
    if (isGaming()) return { ran: false, reason: 'a game is running' };
    if (isQuiet()) return { ran: false, reason: 'quiet hours' };
    if (idleSeconds() < IDLE_SECONDS) return { ran: false, reason: 'not idle' };
    return { ran: true, report: await clear() };
  }

  function start({ everyMs = 30 * 60 * 1000, firstMs = 10 * 60 * 1000, setTimer = setTimeout } = {}) {
    if (timer) return false;
    const loop = (wait) => {
      timer = setTimer(async () => {
        try { await housekeeping(); }
        catch (err) { log('[CacheBudget] the scheduled clean-up failed: ' + (err && err.message)); }
        loop(everyMs);
      }, wait);
      if (timer && typeof timer.unref === 'function') timer.unref();
    };
    loop(firstMs);
    return true;
  }
  function stop(clearTimer = clearTimeout) { if (timer) { clearTimer(timer); timer = null; } }

  async function status() { return { ...get(), minGB: MIN_GB, maxGB: MAX_GB, ...(await preview()) }; }

  return { get, set, measure, preview, clear, housekeeping, status, start, stop, file: stateFile };
}

module.exports = { createCacheBudget, plan, dirSize, partitionIdOf, cleanLimitGB, FILE, GB, DAY_MS, IDLE_SECONDS, MIN_GB, MAX_GB, DEFAULT_GB, MAIN_PARTITION, DISPOSABLE, REPORT_ONLY };
