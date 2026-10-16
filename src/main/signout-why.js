// === "Why was I signed out?" (T0-016) ========================================
//
// 122 password fills in 23 days (amazon.com.tr 48, discord 45): the sign-ins are
// being lost and nothing says why. This module watches the one place the answer
// lives, the cookie jar, and keeps a small local record of WHEN a site's
// sign-in cookie went and which rule ended it:
//
//   - while Vex runs: every removal event of a sign-in-looking cookie, with
//     Chromium's own cause (explicit / expired / evicted) and, when the removal
//     followed something Vex itself did (Clear browsing data, Clear this site's
//     data, the privacy cleanup, the cookie tool), that action;
//   - across a restart: a snapshot of each site's sign-in cookies (names, whether
//     they are session cookies, when they expire) is compared with what is in the
//     jar at the next start. Cookies without an expiry date end when the browser
//     closes; that is the site's rule, and the snapshot is what shows it.
//
// Read-only. It clears nothing and changes no setting. It keeps cookie NAMES,
// the session flag and the expiry date; never a cookie value, and no page
// address beyond the registrable domain.
'use strict';

const DAY_MS = 24 * 3600 * 1000;
const STORE_KEY = 'signout-why';
const MAX_EVENTS = 200;
const MAX_SNAPSHOT_SITES = 120;
const MAX_NAMES_PER_SITE = 12;
const ACTION_TTL_MS = 30000;
const REPORT_DAYS = 30;
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

// A cookie that plausibly IS the sign-in: by name only. Analytics, consent and
// request-forgery tokens are left out so a cleaned tracker does not read as a
// lost sign-in.
const AUTH_NAME = /(sess|(^|[_-])sid($|[_-])|ssid|auth|token|login|logged|jwt|remember|user_?id|account|identity|sso|credential)/i;
const NOT_AUTH = /^(_ga|_gid|_gat|_fb|__utm|_gcl|ajs_|_hj|amplitude|mp_|optimizely|_pk_|__cf|cf_|AMP_)|csrf|xsrf|consent|analytics|tracking/i;
function looksLikeSignIn(cookie) {
  return !!cookie && typeof cookie.name === 'string' && AUTH_NAME.test(cookie.name) && !NOT_AUTH.test(cookie.name);
}

// What Vex itself did, said as a cause and as the place the person can change it.
const VEX_ACTIONS = {
  'clear-all': { cause: 'vex-cleared-all', line: 'You (or a schedule) ran Clear browsing data, which removes every site\'s cookies.', where: 'Settings > Privacy > Clear browsing data' },
  'clear-site': { cause: 'vex-cleared-site', line: 'This site\'s data was cleared with "Clear this site\'s data".', where: 'Site settings > Clear data' },
  'privacy-cleanup': { cause: 'vex-cleanup', line: 'The cookie cleanup in the privacy report card removed this site\'s cookies.', where: 'Privacy report card > Clean up' },
  'kill-switch': { cause: 'vex-kill-switch', line: 'You used "My session leaked" on this site, which removes its cookies and stored data in every container.', where: 'Settings > What am I signed in to' },
  'cookie-tool': { cause: 'vex-cookie-tool', line: 'A cookie was deleted with the cookie tool (or an extension using it).', where: 'The cookie tool / extension that called it' },
};

function when(t) { return new Date(t).toISOString().slice(0, 10); }

// The one sentence for an event.
function lineFor(e) {
  switch (e.cause) {
    case 'vex-cleared-all': case 'vex-cleared-site': case 'vex-cleanup': case 'vex-cookie-tool': case 'vex-kill-switch':
      return VEX_ACTIONS[e.action].line;
    case 'site-removed':
      return `${e.domain} removed its own sign-in cookie "${e.name}" (usually when you sign out there, or when it decides the session is no longer valid). Vex did not clear it.`;
    case 'expired':
      return `${e.domain}'s sign-in cookie "${e.name}" reached the expiry date the site gave it. The site chooses how long a sign-in lasts.`;
    case 'evicted':
      return `Chromium dropped ${e.domain}'s cookie "${e.name}" to stay under its limit on cookies per site.`;
    case 'ended-with-vex':
      return `${e.domain}'s sign-in cookie "${e.name}" had no expiry date, so the site meant it to last only until the browser closes. It ended when Vex was closed.`;
    case 'expired-while-closed':
      return `${e.domain}'s sign-in cookie "${e.name}" expired (${e.expires ? when(e.expires) : 'its date'}) while Vex was closed.`;
    case 'gone-while-closed':
      return `${e.domain}'s sign-in cookie "${e.name}" was still valid when Vex closed (until ${e.expires ? when(e.expires) : 'a later date'}) but was gone at the next start. Vex cannot tell what removed it while it was not running (a clean-up tool, a profile reset or the site).`;
    default:
      return `${e.domain}: ${e.cause}`;
  }
}

function createSignoutWhy({ store, now = () => Date.now(), log, flushMs = 20000, setTimer = setTimeout, clearTimer = clearTimeout }) {
  if (!store) throw new Error('createSignoutWhy needs a store');
  const note = typeof log === 'function' ? log : () => {};
  let data = null;
  let loading = null;
  let timer = null;
  let actions = [];   // { action, domains|null, until }

  function load() {
    if (data) return Promise.resolve(data);
    if (!loading) {
      loading = store.read(STORE_KEY).then((v) => {
        const ok = v && typeof v === 'object' && !Array.isArray(v);
        data = { events: ok && Array.isArray(v.events) ? v.events : [], snapshots: ok && v.snapshots && typeof v.snapshots === 'object' ? v.snapshots : {} };
        return data;
      });
    }
    return loading;
  }
  function schedule() {
    if (timer) return;
    timer = setTimer(() => { timer = null; flush().catch(err => note('[SignoutWhy] could not save: ' + err.message)); }, flushMs);
    if (timer && typeof timer.unref === 'function') timer.unref();
  }
  async function flush() {
    if (!data) return false;
    if (timer) { clearTimer(timer); timer = null; }
    data.events = data.events.slice(-MAX_EVENTS);
    return store.write(STORE_KEY, data);
  }
  function push(event) {
    data.events.push(event);
    if (data.events.length > MAX_EVENTS * 2) data.events = data.events.slice(-MAX_EVENTS);
    schedule();
  }

  // Vex is about to remove cookies on purpose. `domains` (registrable domains)
  // limits the attribution; null means any site.
  function noteAction(action, domains) {
    if (!VEX_ACTIONS[action]) throw new Error('Not a known clearing action: ' + action);
    const t = now();
    actions = actions.filter(a => a.until > t);
    actions.push({ action, domains: Array.isArray(domains) ? domains.map(baseDomain) : null, until: t + ACTION_TTL_MS });
  }
  function actionFor(domain) {
    const t = now();
    return actions.find(a => a.until > t && (!a.domains || a.domains.includes(domain))) || null;
  }

  // One 'changed' event of a cookie jar. Only the removal of a sign-in-looking
  // cookie is kept; an overwrite is the site refreshing it, not a loss.
  async function onCookieChanged(partition, cookie, cause, removed) {
    if (!removed || !looksLikeSignIn(cookie) || cause === 'overwrite' || cause === 'expired-overwrite') return false;
    const domain = baseDomain(cookie.domain);
    if (!domain) return false;
    await load();
    let kind = cause === 'expired' ? 'expired' : cause === 'evicted' ? 'evicted' : null;
    let action = null;
    if (!kind) {
      const a = actionFor(domain);
      if (a) { kind = VEX_ACTIONS[a.action].cause; action = a.action; } else kind = 'site-removed';
    }
    push({ t: now(), partition: String(partition || ''), domain, name: cookie.name, cause: kind, ...(action ? { action } : {}), session: !!cookie.session, expires: Number.isFinite(cookie.expirationDate) ? Math.round(cookie.expirationDate * 1000) : 0 });
    return true;
  }

  // The jar's sign-in cookies per site: names, session flag, expiry. Replaces the
  // saved snapshot of this partition.
  function summarize(cookies) {
    const sites = {};
    for (const c of Array.isArray(cookies) ? cookies : []) {
      if (!looksLikeSignIn(c) || typeof c.domain !== 'string') continue;
      const d = baseDomain(c.domain);
      if (!d) continue;
      const list = sites[d] || (sites[d] = []);
      if (list.length < MAX_NAMES_PER_SITE) list.push({ n: c.name, s: c.session || !Number.isFinite(c.expirationDate) ? 1 : 0, e: Number.isFinite(c.expirationDate) ? Math.round(c.expirationDate * 1000) : 0 });
    }
    return sites;
  }
  async function snapshot(partition, cookies) {
    await load();
    const sites = summarize(cookies);
    const names = Object.keys(sites).slice(0, MAX_SNAPSHOT_SITES);
    const kept = {};
    for (const d of names) kept[d] = sites[d];
    data.snapshots[partition] = { t: now(), sites: kept };
    schedule();
    return names.length;
  }

  // At start: what the last run knew against what the jar holds now. Anything
  // that was there and is gone explains a sign-in lost while Vex was closed.
  async function compareAtStart(partition, cookies) {
    await load();
    const before = data.snapshots[partition];
    if (!before || !before.sites) return 0;
    const nowSites = summarize(cookies);
    const t = now();
    let found = 0;
    for (const [domain, list] of Object.entries(before.sites)) {
      const present = new Set((nowSites[domain] || []).map(c => c.n));
      for (const c of list) {
        if (present.has(c.n)) continue;
        let cause;
        if (c.s) cause = 'ended-with-vex';
        else if (c.e && c.e <= t) cause = 'expired-while-closed';
        else cause = 'gone-while-closed';
        push({ t: before.t, partition: String(partition), domain, name: c.n, cause, session: !!c.s, expires: c.e || 0, atStart: true });
        found++;
      }
    }
    return found;
  }

  // For one site (a host or registrable domain), or null for the latest of all.
  async function explain(host) {
    await load();
    const cutoff = now() - REPORT_DAYS * DAY_MS;
    const domain = host ? baseDomain(host) : null;
    const events = data.events.filter(e => e.t >= cutoff && (!domain || e.domain === domain)).sort((a, b) => b.t - a.t);
    // One line per site and cause, newest first, so a burst of cookies is one answer.
    const seen = new Set();
    const lines = [];
    for (const e of events) {
      const key = e.domain + '|' + e.cause;
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push({ t: e.t, domain: e.domain, cause: e.cause, name: e.name, atStart: !!e.atStart, action: e.action || null, where: e.action ? VEX_ACTIONS[e.action].where : null, line: lineFor(e) });
      if (lines.length >= 12) break;
    }
    const known = Object.values(data.snapshots).reduce((n, s) => n + Object.keys(s.sites || {}).length, 0);
    return { domain, lines, watching: known, windowDays: REPORT_DAYS, at: now() };
  }

  return { noteAction, onCookieChanged, snapshot, compareAtStart, explain, flush, summarize };
}

module.exports = { createSignoutWhy, looksLikeSignIn, baseDomain, lineFor, VEX_ACTIONS, STORE_KEY };
