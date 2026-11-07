// === Clear history, cookies and cache when Vex closes (opt-in) =================
//
// Off unless the person turned it on (vex.autoClear = { on, keep: [host] }, written by js/clear-recent.js). When on, at a
// normal quit, before the quit is allowed to finish:
//
//   - in the ordinary sessions only (persist:main and the containers, as the forget-a-site sweep): every cookie that does not
//     belong to a kept site is removed, the stored data of every origin that is not kept is cleared, and the cache is emptied;
//   - the history list, Recall's page index and the closed-tab list are cleared by the injected clearHistory();
//   - the sign-in baseline is told it was deliberate (so the "many logins look gone" notice stays quiet).
//
// Kept: the hosts the person listed, and the video, music and chat sites Vex needs signed in (SiteRules.FORGET_PROTECTED).
// A kept host covers its subdomains. A panel's own session (Spotify, Discord, ...) and a private, burner or Tor tab are never
// touched here: only persist:main and the containers are swept.
//
// NEVER on a crash or a forced end: it runs only when the exit was marked as a deliberate one (exit-kinds ending()), and a
// crashed Vex does not reach will-quit at all. Every failure is collected and logged; none stops the rest or blocks the quit.
const SiteRules = require('./site-rules');

const partitionAllowed = (partition) => partition === 'persist:main' || /^persist:container-[A-Za-z0-9_-]+$/.test(String(partition || ''));
const bare = (h) => String(h || '').replace(/^\./, '').replace(/^www\./, '').toLowerCase();
const HOST = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/;
const STORAGE_TYPES = ['localStorage', 'indexedDB', 'serviceWorkers', 'webSQL', 'fileSystems', 'backgroundFetch'];

// What the window saved. -> { on: boolean, keep: [host] }; anything unreadable means off.
function parseConfig(raw) {
  let o = raw;
  if (typeof raw === 'string') { try { o = JSON.parse(raw); } catch { return { on: false, keep: [] }; } }
  if (!o || typeof o !== 'object' || o.on !== true) return { on: false, keep: [] };
  const keep = [];
  for (const h of Array.isArray(o.keep) ? o.keep : []) {
    const b = bare(typeof h === 'string' ? h : '');
    if (b && HOST.test(b) && !keep.includes(b)) keep.push(b);
  }
  return { on: true, keep: keep.slice(0, 200) };
}

// Is a cookie/origin host kept: a listed host (or its subdomain), or a site Vex needs signed in.
function isKept(host, keep) {
  const b = bare(host);
  if (!b) return false;
  if (SiteRules.forgetProtected(b)) return true;
  return keep.some(k => b === k || b.endsWith('.' + k));
}

// deps: getConfig() -> saved value; partitions() -> [partition]; sessionFor(partition) -> session; ending() -> truthy for a
// deliberate exit; noteDeliberate(): the sign-in baseline hook; clearHistory(): async; log.
function createQuitClear(deps) {
  const log = deps.log || console;

  async function sweep(partition, keep, result) {
    const ses = deps.sessionFor(partition);
    let cookies;
    try { cookies = await ses.cookies.get({}); }
    catch (err) { result.errors.push(partition + ': cookies could not be listed (' + err.message + ')'); return; }
    const keepOrigins = new Set();
    for (const c of cookies) {
      const dom = String(c && c.domain || '').replace(/^\./, '');
      if (!dom) continue;
      if (isKept(dom, keep)) { keepOrigins.add('https://' + dom); continue; }
      try {
        await ses.cookies.remove('http' + (c.secure ? 's' : '') + '://' + dom + (c.path || '/'), c.name);
        result.cookies += 1;
      } catch (err) { result.errors.push(partition + ' cookie ' + c.name + ': ' + err.message); }
    }
    for (const k of keep) { keepOrigins.add('https://' + k); keepOrigins.add('https://www.' + k); }
    for (const p of SiteRules.FORGET_PROTECTED) { keepOrigins.add('https://' + p); keepOrigins.add('https://www.' + p); }
    try {
      await ses.clearData({ dataTypes: STORAGE_TYPES, excludeOrigins: [...keepOrigins] });
    } catch (err) { result.errors.push(partition + ' stored data: ' + err.message); }
    try { await ses.clearCache(); } catch (err) { result.errors.push(partition + ' cache: ' + err.message); }
    try { await ses.flushStorageData(); } catch (err) { result.errors.push(partition + ' save: ' + err.message); }
  }

  // -> { skipped } or { cookies, history, errors }
  async function run() {
    const cfg = parseConfig(deps.getConfig());
    if (!cfg.on) return { skipped: 'off' };
    if (!deps.ending()) return { skipped: 'not a deliberate exit' };
    const result = { cookies: 0, history: false, errors: [] };
    try { deps.noteDeliberate(); } catch (err) { result.errors.push('sign-in baseline: ' + err.message); }
    for (const partition of deps.partitions()) {
      if (!partitionAllowed(partition)) continue;
      await sweep(partition, cfg.keep, result);
    }
    try { await deps.clearHistory(); result.history = true; }
    catch (err) { result.errors.push('history: ' + err.message); }
    for (const e of result.errors) log.error('[AutoClear] at quit:', e);
    return result;
  }

  return { run };
}

module.exports = { createQuitClear, parseConfig, isKept, partitionAllowed };
