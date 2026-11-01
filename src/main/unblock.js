'use strict';
// === Unblock centre: the rules of it, with nothing from Electron in here ==================
//
// A site that your network blocks fails to load in a few recognisable ways (the connection is
// reset, times out, or the TLS handshake is cut). This file holds the decisions around that, so
// they can be tested with fakes:
//
//   looksBlocked / assess   when a failed load is worth offering help for, and only then
//   createUnblock           tries the ways Vex can open the site WITHOUT admin rights, in order,
//                           and remembers which one worked, per site
//   buildPac                the proxy rules for the sites that are on, as a PAC script
//
// The ways, in order (each one is only used for the sites that need it, never for all browsing):
//   doh      the site's address is looked up over encrypted DNS (a DNS block is beaten)
//   light    the same, and the first TLS packet is split so a name filter cannot read it
//   byedpi   the ByeDPI helper (a program Vex downloads on request, no admin rights) with a
//            desync preset that beats the filter
//   admin    Zapret / WinDivert: needs administrator rights, is NEVER started by Vex, and is only
//            shown as a way that exists (the Game Control Center tool runs it, not Vex).
//
// Nothing here opens a network connection by itself: `request`, `control`, `resolveHost` and the
// methods are handed in.

const { checkUrl } = require('./bypass-probe');

// ERR_CONNECTION_CLOSED, ERR_CONNECTION_RESET, ERR_NAME_NOT_RESOLVED, ERR_SSL_PROTOCOL_ERROR,
// ERR_CONNECTION_TIMED_OUT, ERR_EMPTY_RESPONSE. A certificate error (-200..-299) is somebody in
// the middle and is never treated as a block to route around.
const BLOCK_CODES = [-100, -101, -105, -107, -118, -324];
const DNS_CODES = [-105];
const ONE_HOUR = 3600 * 1000;
const MODES = ['ask', 'always', 'never', 'once'];

function looksBlocked(code) { return BLOCK_CODES.includes(Number(code)); }

// "www.example.com" and "example.com" are one site here; anything but letters, digits, dots and
// hyphens is refused (the name goes into a PAC script).
function normalizeHost(raw) {
  let h = String(raw == null ? '' : raw).trim().toLowerCase();
  if (/^https?:\/\//.test(h)) h = new URL(h).hostname;
  h = h.replace(/\.$/, '').replace(/^www\./, '');
  if (!h || h.length > 253 || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(h)) throw new Error('That is not a site name Vex can open for you');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h) || /(^|\.)(localhost|local|internal|lan|home)$/.test(h)) throw new Error('Only sites on the internet can be opened this way, not this computer or your home network');
  return h;
}

// The proxy a route stands for: rules for a session ("proxyRules") and for a PAC script.
function proxyRulesOf(route) {
  if (!route || !Number.isInteger(route.port) || route.port < 1 || route.port > 65535) throw new Error('A route needs a port');
  if (route.kind === 'http') return 'http://127.0.0.1:' + route.port;
  if (route.kind === 'socks5') return 'socks5://127.0.0.1:' + route.port;
  throw new Error('Unknown route kind "' + route.kind + '"');
}
function pacOf(route) {
  proxyRulesOf(route);
  return (route.kind === 'http' ? 'PROXY 127.0.0.1:' : 'SOCKS5 127.0.0.1:') + route.port;
}

// A PAC script that sends the listed sites (and their subdomains) through their route, and
// everything else direct. The Discord rules of the bypass are kept when its port is given.
// A site's route ends in DIRECT, so a helper that has stopped makes the site what it was before,
// not worse.
function buildPac(discordPort, routes) {
  const clauses = [];
  if (discordPort) {
    clauses.push("if(shExpMatch(h,'discord.com')||shExpMatch(h,'*.discord.com')||"
      + "shExpMatch(h,'discordapp.com')||shExpMatch(h,'*.discordapp.com')||"
      + "shExpMatch(h,'discord.gg')||shExpMatch(h,'*.discord.gg')||"
      + "shExpMatch(h,'*.discordapp.net'))return 'SOCKS5 127.0.0.1:" + discordPort + "';");
  }
  for (const r of routes) {
    const host = normalizeHost(r.host);
    clauses.push("if(h==='" + host + "'||dnsDomainIs(h,'." + host + "'))return '" + pacOf(r.route) + "; DIRECT';");
  }
  return 'function FindProxyForURL(u,h){' + clauses.join('') + "return 'DIRECT';}";
}

// partition: the tab's session. Only the ordinary browsing sessions are ever helped: a private
// or Tor tab, a site route through Tor or a proxy, or another panel is left alone.
function partitionAllowed(partition) {
  if (partition == null || partition === '') return true;
  return partition === 'persist:main' || /^persist:container-(?:work|personal|shopping)$/.test(String(partition));   // the sessions main.js BROWSING_SESSIONS covers
}

function createUnblock({ methods, request, control, resolveHost, applyRoutes, isRouted = () => false, now = Date.now, log = () => {}, offerEveryMs = ONE_HOUR }) {
  if (!Array.isArray(methods) || !methods.length) throw new Error('createUnblock needs its methods');
  for (const fn of ['request', 'control', 'resolveHost', 'applyRoutes']) {
    if (typeof { request, control, resolveHost, applyRoutes }[fn] !== 'function') throw new Error('createUnblock needs ' + fn);
  }
  const byId = new Map(methods.map(m => [m.id, m]));
  let enabled = true;
  let sites = new Map();              // host -> { host, mode, method, preset }
  const active = new Map();           // host -> { method, route, preset }
  const sessionOn = new Set();        // hosts a Try opened this run
  const offered = new Map();          // host -> time of the last offer
  const errors = new Map();           // host -> why it could not be switched on
  let queue = Promise.resolve();      // one thing at a time: a helper process is shared
  const serial = (job) => { const run = queue.then(job, job); queue = run.then(() => {}, () => {}); return run; };

  const routesNow = () => [...active.entries()].map(([host, a]) => ({ host, route: a.route }));
  const push = () => applyRoutes(routesNow());
  const releaseUnused = async () => {
    for (const m of methods) {
      if (typeof m.releaseIfUnused === 'function') await m.releaseIfUnused([...active.values()].filter(a => a.method === m.id).length);
    }
  };
  const deactivate = (host) => { active.delete(host); sessionOn.delete(host); };

  // ---- should we offer? ---------------------------------------------------------------------
  // Everything is checked in the order that costs least; the two network checks come last and run
  // only for a load that already failed in a blocking way.
  async function assess({ url, code, partition, isPrivate }) {
    const no = (reason) => ({ suggest: false, reason });
    if (!enabled) return no('off');
    if (isPrivate) return no('private');
    if (!partitionAllowed(partition)) return no('session');
    if (isRouted(partition)) return no('session-routed');   // it already goes through Tor or a proxy the person chose
    if (!looksBlocked(code)) return no('error');
    let host;
    try { host = normalizeHost(new URL(checkUrl(url)).hostname); } catch { return no('address'); }   // vex-allow-empty-catch: not a site on the internet, so nothing to offer
    const known = sites.get(host);
    if (known && known.mode === 'never') return no('never');
    if (active.has(host)) return no('routed');
    const last = offered.get(host);
    if (last != null && now() - last < offerEveryMs) return no('recently');
    offered.set(host, now());
    // The network is up, or this is just being offline.
    const ctl = await control();
    if (!ctl.ok) return no('offline');
    // The site exists (a mistyped name is not a block).
    const addr = await resolveHost(host);
    if (!addr) return no('unknown-site');
    return { suggest: true, host, dns: DNS_CODES.includes(Number(code)) };
  }

  // ---- opening the site ---------------------------------------------------------------------
  // Tries the methods in order, using the recorded one first when there is one. Resolves with every
  // step, so the person can read what was tried and why a step was skipped or failed.
  function tryHost(rawHost, { prefer, allowDownload = false, keep = true } = {}) {
    return serial(async () => {
      const host = normalizeHost(rawHost);
      const steps = [];
      const direct = await request(host, null);
      if (direct.ok) return { ok: true, host, direct: true, steps };
      const order = prefer && byId.has(prefer) ? [byId.get(prefer), ...methods.filter(m => m.id !== prefer)] : methods;
      let needsDownload = false;
      for (const m of order) {
        if (m.adminOnly) { steps.push({ id: m.id, label: m.label, skipped: 'admin' }); continue; }
        const avail = await m.available({ allowDownload });
        if (!avail.ok) {
          if (avail.needsDownload) needsDownload = true;
          steps.push({ id: m.id, label: m.label, skipped: avail.needsDownload ? 'download' : 'unavailable', error: avail.reason });
          continue;
        }
        let found;
        try { found = await m.find(host, (route) => request(host, route), { allowDownload }); }
        catch (err) {
          log('[Unblock] ' + m.id + ' failed for ' + host + ': ' + (err && err.message));
          steps.push({ id: m.id, label: m.label, ok: false, error: (err && err.message) || String(err) });
          continue;
        }
        if (!found || !found.route) { steps.push({ id: m.id, label: m.label, ok: false, error: (found && found.reason) || 'the site still did not open' }); continue; }
        steps.push({ id: m.id, label: m.label, ok: true });
        if (keep) {
          active.set(host, { method: m.id, route: found.route, preset: found.preset == null ? null : found.preset });
          sessionOn.add(host);
          errors.delete(host);
          push();
        }
        await releaseUnused();
        return { ok: true, host, method: m.id, label: m.label, preset: found.preset == null ? null : found.preset, steps };
      }
      await releaseUnused();
      return { ok: false, host, steps, needsDownload };
    });
  }

  // ---- the list the person keeps ------------------------------------------------------------
  // The window sends its whole list whenever it changes and at start. A site is on when it is
  // "always" and has a method, or is "once" and a Try opened it during this run; nothing else is.
  function sync(input) {
    return serial(async () => {
      if (!input || typeof input !== 'object' || !Array.isArray(input.sites)) throw new Error('sync needs { enabled, sites }');
      enabled = input.enabled !== false;
      const next = new Map();
      for (const s of input.sites) {
        const host = normalizeHost(s.host);
        if (!MODES.includes(s.mode)) throw new Error('Unknown mode "' + s.mode + '"');
        next.set(host, { host, mode: s.mode, method: s.method || null, preset: s.preset == null ? null : s.preset });
      }
      sites = next;
      const wanted = new Map();
      if (enabled) {
        for (const s of sites.values()) {
          // 'ask' is a site the person switched off; 'never' is one never to be offered.
          if (s.mode === 'always' && s.method) wanted.set(s.host, s);
          else if (s.mode === 'once' && sessionOn.has(s.host) && active.has(s.host)) wanted.set(s.host, s);
        }
      }
      for (const host of [...active.keys()]) if (!wanted.has(host)) deactivate(host);
      for (const [host, s] of wanted) {
        if (active.has(host)) continue;
        const m = byId.get(s.method);
        try {
          if (!m || m.adminOnly) throw new Error('The way that worked for this site is not available');
          const route = await m.restore({ host, preset: s.preset });
          active.set(host, { method: m.id, route, preset: s.preset });
          errors.delete(host);
        } catch (err) {
          errors.set(host, (err && err.message) || String(err));
          log('[Unblock] could not switch ' + host + ' on: ' + errors.get(host));
        }
      }
      push();
      await releaseUnused();
      return status();
    });
  }

  // A helper that other parts of Vex share moved to another port, or is gone (port 0).
  function methodPortChanged(methodId, port) {
    let changed = false;
    for (const [host, a] of [...active.entries()]) {
      if (a.method !== methodId) continue;
      changed = true;
      if (!port) { active.delete(host); errors.set(host, 'The helper stopped, so this site is open directly again'); }
      else a.route = { ...a.route, port };
    }
    if (changed) push();
    return changed;
  }

  function status() {
    return {
      enabled,
      methods: methods.map(m => ({ id: m.id, label: m.label, adminOnly: !!m.adminOnly, note: m.note || '' })),
      active: [...active.entries()].map(([host, a]) => ({ host, method: a.method, preset: a.preset })),
      errors: Object.fromEntries(errors),
    };
  }

  // Everything off: no site routed, every helper this started stopped. Used when Vex closes.
  function stopAll() {
    return serial(async () => {
      active.clear(); sessionOn.clear();
      push();
      await releaseUnused();
    });
  }

  return { assess, try: tryHost, sync, status, stopAll, methodPortChanged, routes: routesNow, isActive: (h) => active.has(h) };
}

module.exports = { createUnblock, looksBlocked, normalizeHost, buildPac, proxyRulesOf, pacOf, partitionAllowed, BLOCK_CODES, MODES, ONE_HOUR };
