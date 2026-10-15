// === Privacy report card, the cookie half ===================================
//
// Tracker Receipts (src/renderer/js/tracker-receipts.js) already keeps the
// weekly story of what was BLOCKED. This is the other half of the weekly page:
// which cookies sites kept anyway, who set the most, and which of those belong
// to a company Vex's blocker saw tracking you. It also does the cleanup.
//
// What it can and cannot know, stated so the page never overclaims:
//   * Cookies currently stored: read from the main session's cookie jar.
//   * Cookies SET this week: counted from the jar's own change events while
//     Vex runs, per day, per site (names and values are never kept — only a
//     count per registrable domain). Cookies set while Vex was closed are not.
//   * Fingerprinting attempts: NOT detectable. Vex's fingerprint protection
//     farbles canvas/audio/etc. silently (main-helpers.js seed); the page that
//     asked gets slightly different numbers and nothing reports that it asked.
//     So the report card says so instead of showing an invented number.
//
// Everything is injected so the module is testable without Electron.
'use strict';

const DAY_MS = 24 * 3600 * 1000;
const KEEP_DAYS = 14;
const MAX_SITES_PER_DAY = 300;
const MAX_CLEAN = 50;
const LONG_LIVED_DAYS = 365;
const STORE_KEY = 'privacy-cookie-tally';
// Second-level labels that make "co.uk"-style suffixes: example.co.uk is the
// site, not co.uk. Not the public suffix list; right for the common cases and
// a wrong guess only widens what counts as "the same site".
const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'gov', 'edu', 'ac', 'or', 'ne', 'go', 'gob', 'nom']);

function baseDomain(host) {
  const h = String(host || '').trim().toLowerCase().replace(/^\.+/, '').replace(/\.+$/, '');
  if (!h || /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(':')) return h;
  const parts = h.split('.');
  if (parts.length <= 2) return h;
  const tail = parts.slice(-2);
  if (SECOND_LEVEL.has(tail[0]) && tail[1].length === 2) return parts.slice(-3).join('.');
  return tail.join('.');
}

const dayKey = (ms) => {
  const d = new Date(ms);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};

// cookies: Electron cookie objects. trackerHosts: hosts the blocker has seen
// trackers on. Returns the per-site list, worst first.
function summarizeCookies(cookies, { trackerHosts = [], now = Date.now() } = {}) {
  const trackers = new Set([...trackerHosts].map(baseDomain));
  const sites = new Map();
  for (const c of Array.isArray(cookies) ? cookies : []) {
    if (!c || typeof c.domain !== 'string') continue;
    const base = baseDomain(c.domain);
    if (!base) continue;
    let s = sites.get(base);
    if (!s) { s = { domain: base, count: 0, tracker: trackers.has(base), persistent: 0, longLived: 0, insecure: 0 }; sites.set(base, s); }
    s.count++;
    if (!c.session && Number.isFinite(c.expirationDate)) {
      s.persistent++;
      if (c.expirationDate * 1000 - now > LONG_LIVED_DAYS * DAY_MS) s.longLived++;
    }
    if (!c.secure) s.insecure++;
  }
  const list = [...sites.values()].sort((a, b) => (b.tracker - a.tracker) || (b.count - a.count) || a.domain.localeCompare(b.domain));
  return { total: list.reduce((n, s) => n + s.count, 0), sites: list, trackerCookies: list.filter(s => s.tracker).reduce((n, s) => n + s.count, 0) };
}

// The cookies set per day, kept as counts only.
function createCookieTally({ store, now = () => Date.now(), log, flushMs = 30000, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const note = typeof log === 'function' ? log : () => {};
  let data = null;      // { 'YYYY-MM-DD': { 'site.example': n } }
  let loading = null;
  let timer = null;

  function load() {
    if (data) return Promise.resolve(data);
    if (!loading) {
      loading = store.read(STORE_KEY).then((v) => {
        data = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
        return data;
      });
    }
    return loading;
  }
  function prune() {
    const keys = Object.keys(data).sort();
    for (const k of keys.slice(0, Math.max(0, keys.length - KEEP_DAYS))) delete data[k];
  }
  function schedule() {
    if (timer) return;
    timer = setTimer(() => { timer = null; flush().catch(err => note('[PrivacyReport] could not save the cookie tally: ' + err.message)); }, flushMs);
    if (timer && typeof timer.unref === 'function') timer.unref();
  }
  async function flush() {
    if (!data) return false;
    if (timer) { clearTimer(timer); timer = null; }
    prune();
    return store.write(STORE_KEY, data);
  }

  // One cookie jar 'changed' event. Only cookies being SET count; a cookie
  // that expired, was overwritten by the same site or was removed does not.
  async function record(cookie, cause, removed) {
    if (removed || cause !== 'explicit' || !cookie || typeof cookie.domain !== 'string') return false;
    const d = await load();
    const day = dayKey(now());
    const today = d[day] || (d[day] = {});
    const base = baseDomain(cookie.domain);
    if (!base) return false;
    if (!(base in today) && Object.keys(today).length >= MAX_SITES_PER_DAY) return false;
    today[base] = (today[base] || 0) + 1;
    schedule();
    return true;
  }

  // The last `days` days, oldest first, with each site's count.
  async function week(days = 7) {
    const d = await load();
    const out = [];
    const t = now();
    for (let i = days - 1; i >= 0; i--) {
      const key = dayKey(t - i * DAY_MS);
      out.push({ day: key, sites: { ...(d[key] || {}) } });
    }
    return out;
  }

  return { record, week, flush };
}

function createPrivacyReport({ getCookieJar, trackerHosts = () => [], tally, now = () => Date.now(), log }) {
  if (!getCookieJar) throw new Error('createPrivacyReport needs the cookie jar');
  const note = typeof log === 'function' ? log : () => {};

  async function report() {
    const jar = getCookieJar();
    const cookies = await jar.get({});
    const current = summarizeCookies(cookies, { trackerHosts: trackerHosts(), now: now() });
    const days = tally ? await tally.week(7) : [];
    const trackers = new Set([...trackerHosts()].map(baseDomain));
    const setBySite = {};
    for (const d of days) for (const [site, n] of Object.entries(d.sites)) setBySite[site] = (setBySite[site] || 0) + n;
    const setTotal = Object.values(setBySite).reduce((a, b) => a + b, 0);
    const topSet = Object.entries(setBySite)
      .map(([domain, count]) => ({ domain, count, tracker: trackers.has(domain) }))
      .sort((a, b) => b.count - a.count).slice(0, 10);
    return {
      stored: { total: current.total, trackerCookies: current.trackerCookies, sites: current.sites.slice(0, 40) },
      setThisWeek: { total: setTotal, perDay: days.map(d => ({ day: d.day, count: Object.values(d.sites).reduce((a, b) => a + b, 0) })), top: topSet },
      // Said out loud rather than shown as a zero.
      fingerprinting: { detectable: false, why: 'Vex changes what fingerprinting scripts can read, but a script that tried leaves nothing to count.' },
      at: now(),
    };
  }

  // Removes every cookie that belongs to the given registrable domains.
  async function clean(domains) {
    if (!Array.isArray(domains) || !domains.length) throw new Error('Pick at least one site to clean up');
    if (domains.length > MAX_CLEAN) throw new Error('Too many sites at once (limit ' + MAX_CLEAN + ')');
    const wanted = new Set(domains.map(d => baseDomain(String(d))).filter(Boolean));
    const jar = getCookieJar();
    const cookies = await jar.get({});
    let removed = 0;
    const failed = [];
    for (const c of cookies) {
      if (!c || typeof c.domain !== 'string' || !wanted.has(baseDomain(c.domain))) continue;
      const host = c.domain.replace(/^\./, '');
      const url = (c.secure ? 'https://' : 'http://') + host + (c.path || '/');
      try { await jar.remove(url, c.name); removed++; }
      catch (err) { failed.push(c.domain); note('[PrivacyReport] could not remove a cookie of ' + c.domain + ': ' + err.message); }
    }
    return { removed, failed: [...new Set(failed)], sites: [...wanted] };
  }

  return { report, clean };
}

module.exports = { baseDomain, summarizeCookies, createCookieTally, createPrivacyReport, MAX_CLEAN };
