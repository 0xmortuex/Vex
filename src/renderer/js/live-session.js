// === One browser across devices: the pure state layer ======================
//
// Everything here is plain data in, plain data out (no DOM, no storage, no
// network), so the main window, the tests and the companion page can share it.
// docs/SYNC_PROTOCOL.md §4.10 is the wire contract.
//
//   - a hybrid logical clock (HLC): ordering that survives a wrong wall clock;
//   - redaction: what may leave this device at all (never a private, Tor or
//     routed tab, never a sensitive site);
//   - the device snapshot: this device's open tabs plus tombstones for closed
//     ones, size-capped and compacted. It is the value of `sync:tabs:<id>`;
//     version 1 of that value ({ tabs: [{ url, title }] }) is a subset of it, so
//     a device that only knows version 1 keeps working;
//   - the Devices view model and "Continue where I left off".
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) globalThis.VexLiveSession = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const LIMITS = Object.freeze({
    MAX_TABS: 100,
    MAX_CLOSED: 50,
    CLOSED_TTL_MS: 7 * 24 * 3600 * 1000,
    MAX_BYTES: 24 * 1024,        // one device's snapshot, as JSON
    MAX_URL: 2048,
    MAX_TITLE: 300,
    MAX_FAVICON: 512,
    MAX_GROUP: 60,
    MAX_DRIFT_MS: 3600 * 1000,   // how far ahead of our own clock a remote clock is believed
    STALE_MS: 14 * 24 * 3600 * 1000,
    SCROLL_STEP: 500,            // scroll hints are rounded, so scrolling is not a sync change
  });

  // ---- Hybrid logical clock ---------------------------------------------------
  // "<wall ms, base 36, 9 digits>.<counter, base 36, 4 digits>.<node, 8 chars>":
  // equal-length fields, so plain string comparison is the clock order.
  const HLC_RE = /^[0-9a-z]{9}\.[0-9a-z]{4}\.[0-9a-z]{1,16}$/;
  const nodeOf = id => String(id || 'x').toLowerCase().replace(/[^0-9a-z]/g, '').slice(0, 8) || 'x';
  const hlcValid = value => typeof value === 'string' && HLC_RE.test(value);
  function hlcParse(value) {
    if (!hlcValid(value)) return { wall: 0, counter: 0, node: '' };
    const [wall, counter, node] = value.split('.');
    return { wall: parseInt(wall, 36), counter: parseInt(counter, 36), node };
  }
  function hlcFormat(wall, counter, node) {
    return Math.max(0, Math.floor(wall)).toString(36).padStart(9, '0') + '.' + Math.min(counter, 36 ** 4 - 1).toString(36).padStart(4, '0') + '.' + nodeOf(node);
  }
  const hlcCompare = (a, b) => (a === b ? 0 : (hlcValid(a) ? a : '') < (hlcValid(b) ? b : '') ? -1 : 1);
  const hlcMax = (a, b) => (hlcCompare(a, b) >= 0 ? a : b);
  // A new local event.
  function hlcTick(previous, now, node) {
    const p = hlcParse(previous);
    const wall = Math.max(p.wall, now);
    return hlcFormat(wall, wall === p.wall ? p.counter + 1 : 0, node);
  }
  // Seeing a remote clock. A remote that claims to be more than MAX_DRIFT_MS
  // ahead of this device's clock is believed only that far, so one device with
  // a clock set to 2099 cannot push every other device's clock there.
  function hlcReceive(local, remote, now, node) {
    const l = hlcParse(local);
    const r = hlcParse(remote);
    const rWall = Math.min(r.wall, now + LIMITS.MAX_DRIFT_MS);
    const wall = Math.max(l.wall, rWall, now);
    let counter = 0;
    if (wall === l.wall && wall === rWall) counter = Math.max(l.counter, rWall === r.wall ? r.counter : 0) + 1;
    else if (wall === l.wall) counter = l.counter + 1;
    else if (wall === rWall && rWall === r.wall) counter = r.counter + 1;
    return hlcFormat(wall, counter, node);
  }
  // The wall time an HLC carries, never later than `now` (display only).
  const hlcWall = (value, now = Infinity) => Math.min(hlcParse(value).wall, now);

  // ---- Redaction --------------------------------------------------------------
  // Hosts whose pages are about money, identity, mail or health. They never
  // leave the device, whatever the person turned on.
  const SENSITIVE_HOST = [
    /(^|\.)(paypal|stripe|wise|venmo|revolut|klarna|coinbase|binance|kraken)\.(com|me|net)$/,
    /(^|[.-])(bank|banking|ebanking|onlinebanking|netbanking|creditunion|cu)([.-]|$)/,
    /(^|\.)(1password|bitwarden|lastpass|dashlane|keepersecurity|nordpass|enpass)\.(com|eu)$/,
    /^(mail|webmail|outlook|inbox)\.(google|yahoo|proton|live|office|zoho|fastmail)\./,
    /^(accounts|login|signin|sign-in|sso|auth|id|myaccount|secure|oauth)\./,
    /(^|\.)(mychart|patientportal|myhealth)\./,
    /(^|\.)(irs|ssa|hmrc|cra-arc)\.(gov|gc\.ca)$/,
  ];
  const SENSITIVE_QUERY = /^(token|access_token|id_token|refresh_token|session|sessionid|sid|code|auth|key|apikey|api_key|secret|password|passwd|pwd|otp|jwt|signature|sig|state|nonce|ticket|magic)$/i;
  const PRIVATE_IPV4 = /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/;

  function sensitiveHost(host, extra) {
    const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
    if (!h) return true;
    if (h === 'localhost' || /\.(local|internal|lan|home|corp|localdomain)$/.test(h) || PRIVATE_IPV4.test(h) || h.includes(':') || !h.includes('.')) return true;
    if (SENSITIVE_HOST.some(re => re.test(h))) return true;
    return Array.isArray(extra) && extra.some(x => {
      const e = String(x || '').toLowerCase().trim().replace(/^\*?\.?/, '');
      return e && (h === e || h.endsWith('.' + e));
    });
  }

  // The address that may be sent, or null.
  function shareableUrl(raw, extraHosts) {
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > LIMITS.MAX_URL || /[\x00-\x20\x7f]/.test(raw)) return null;
    let u;
    try { u = new URL(raw); } catch { return null; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.username || u.password) return null;
    if (sensitiveHost(u.hostname, extraHosts)) return null;
    for (const name of u.searchParams.keys()) if (SENSITIVE_QUERY.test(name)) return null;
    return raw;
  }

  // ctx: { privateWindow, isRouted(partition), extraHosts }
  function shareableTab(tab, ctx = {}) {
    if (!tab || typeof tab !== 'object' || ctx.privateWindow) return false;
    const p = tab.partition ? String(tab.partition) : '';
    if (p && !p.startsWith('persist:')) return false;                  // private, Off-the-Record, Tor
    if (/^persist:(?:route-|container-tor-)/.test(p)) return false;     // routed by name
    if (p && typeof ctx.isRouted === 'function' && ctx.isRouted(p)) return false;
    if (tab.ownSession === true) return false;
    return shareableUrl(tab.url, ctx.extraHosts) !== null;
  }

  // ---- Device snapshot ----------------------------------------------------------
  const clean = (value, max) => String(value == null ? '' : value).replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, max);
  const idOf = tab => clean(tab.id, 40).replace(/[^\w-]/g, '') || null;
  const httpIcon = value => (typeof value === 'string' && /^https?:\/\//i.test(value) && value.length <= LIMITS.MAX_FAVICON && !/[\x00-\x20]/.test(value) ? value : null);
  function scrollHint(tab) {
    const s = tab && tab.scrollPosition;
    const y = typeof s === 'number' ? s : s && typeof s === 'object' ? s.y : 0;
    if (!Number.isFinite(y) || y <= 0) return 0;
    return Math.min(1e7, Math.round(y / LIMITS.SCROLL_STEP) * LIMITS.SCROLL_STEP);
  }

  const size = value => JSON.stringify(value).length;

  // ctx: { prev (the snapshot value last sent, or null), now, node, groupName(groupId),
  //        activeId, privateWindow, isRouted, extraHosts, maxBytes }
  function buildSnapshot(tabs, ctx = {}) {
    const now = Number.isFinite(ctx.now) ? ctx.now : Date.now();
    const node = nodeOf(ctx.node);
    let prev = parseSnapshot(ctx.prev);
    // A version 1 list has no tab ids: nothing in it can be told closed.
    if (prev.v !== 2) prev = { ...prev, tabs: [], closed: [], active: null };
    const before = new Map(prev.tabs.map(t => [t.id, t]));
    let clock = prev.hlc || hlcFormat(0, 0, node);
    const out = [];
    const seen = new Set();
    for (const tab of Array.isArray(tabs) ? tabs : []) {
      if (out.length >= LIMITS.MAX_TABS) break;
      if (!shareableTab(tab, ctx)) continue;
      const id = idOf(tab);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const group = ctx.groupName && tab.groupId ? clean(ctx.groupName(tab.groupId), LIMITS.MAX_GROUP) : '';
      // Key order is the order parseSnapshot writes, so an unchanged snapshot
      // is byte-for-byte what was sent.
      const entry = { id, url: tab.url, title: clean(tab.title, LIMITS.MAX_TITLE) || tab.url, h: '' };
      const fav = httpIcon(tab.favicon);
      if (fav) entry.fav = fav;
      if (group) entry.g = group;
      if (tab.pinned) entry.p = 1;
      const s = scrollHint(tab);
      if (s) entry.s = s;
      const viewed = Number.isFinite(tab.lastViewedAt) ? Math.min(tab.lastViewedAt, now) : 0;
      const active = ctx.activeId != null && String(ctx.activeId) === String(tab.id);
      // "Last used" moves when the tab is switched to, and at most every ten
      // minutes while it stays in use: an idle device must not look edited on
      // every round (a snapshot that differs is a push).
      const prevA = (before.get(id) || {}).a || 0;
      let a = Math.max(viewed, prevA);
      if (active && (prev.active !== id || now - prevA > 10 * 60 * 1000)) a = now;
      if (a) entry.a = a;
      const old = before.get(id);
      const same = old && old.url === entry.url && old.title === entry.title && (old.g || '') === (entry.g || '') && !!old.p === !!entry.p;
      if (same) entry.h = old.h;
      else { clock = hlcTick(clock, now, node); entry.h = clock; }
      out.push(entry);
    }
    // A tab that was there and is not any more leaves a tombstone, so another
    // device holding an older copy can tell "closed" from "never heard of".
    const closed = new Map();
    for (const t of prev.closed) if (!seen.has(t.id)) closed.set(t.id, t);
    for (const t of prev.tabs) {
      if (seen.has(t.id) || closed.has(t.id)) continue;
      clock = hlcTick(clock, now, node);
      closed.set(t.id, { id: t.id, h: clock });
    }
    const snapshot = {
      v: 2,
      hlc: clock,
      seen: now,
      la: out.reduce((m, t) => Math.max(m, t.a || 0), 0),
      tabs: out,
      closed: compactClosed([...closed.values()], now),
    };
    if (ctx.activeId != null) {
      const a = out.find(t => String(t.id) === String(idOf({ id: ctx.activeId })));
      if (a) snapshot.active = a.id;
    }
    const fitted = fitSnapshot(snapshot, ctx.maxBytes || LIMITS.MAX_BYTES);
    // `seen` is the freshness of an unchanged snapshot, refreshed at most once
    // a day (the server's own last-seen time is what the Devices view trusts).
    const content = s => JSON.stringify([s.tabs, s.closed, s.active || null, s.cut || 0]);
    if (prev.seen && prev.v === 2 && content(prev) === content(fitted) && now - prev.seen < 24 * 3600 * 1000) fitted.seen = prev.seen;
    return fitted;
  }

  // Tombstones older than the TTL go; so do all but the newest MAX_CLOSED.
  function compactClosed(list, now = Date.now()) {
    return list
      .filter(t => t && typeof t.id === 'string' && hlcValid(t.h) && now - hlcWall(t.h) <= LIMITS.CLOSED_TTL_MS)
      .sort((a, b) => hlcCompare(b.h, a.h))
      .slice(0, LIMITS.MAX_CLOSED)
      .map(t => ({ id: t.id, h: t.h }));
  }

  // The snapshot stays under `max` bytes. What goes first is what costs most
  // and means least: icons, then long titles, then tombstones, then the tabs
  // that were used longest ago (pinned ones last). `cut` says how many tabs
  // were left out, so the Devices view can say "and N more".
  function fitSnapshot(snapshot, max = LIMITS.MAX_BYTES) {
    const s = { ...snapshot, tabs: snapshot.tabs.map(t => ({ ...t })), closed: snapshot.closed.slice() };
    let cut = 0;
    const fits = () => size(s) <= max;
    if (!fits()) for (const t of s.tabs) delete t.fav;
    if (!fits()) for (const t of s.tabs) if (t.title.length > 100) t.title = t.title.slice(0, 100);
    while (!fits() && s.closed.length > 10) s.closed.pop();
    if (!fits()) s.closed = [];
    if (!fits()) {
      // Least valuable first: unpinned, longest unused.
      const order = s.tabs.slice().sort((x, y) => (x.p ? 1 : 0) - (y.p ? 1 : 0) || (x.a || 0) - (y.a || 0));
      while (!fits() && order.length) {
        const gone = order.shift();
        s.tabs = s.tabs.filter(t => t !== gone);
        cut++;
      }
    }
    if (cut) s.cut = cut;
    return s;
  }

  // Any value of `sync:tabs:<id>` (version 1 or 2) as a snapshot; nothing here
  // is trusted, since another device wrote it.
  function parseSnapshot(value, extraHosts) {
    const out = { v: 1, hlc: '', seen: 0, la: 0, tabs: [], closed: [], active: null, cut: 0 };
    if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
    if (value.v === 2) out.v = 2;
    if (hlcValid(value.hlc)) out.hlc = value.hlc;
    if (Number.isSafeInteger(value.seen) && value.seen >= 0) out.seen = value.seen;
    if (Number.isSafeInteger(value.la) && value.la >= 0) out.la = value.la;
    if (Number.isSafeInteger(value.cut) && value.cut > 0) out.cut = Math.min(value.cut, 1e6);
    const ids = new Set();
    for (const [i, t] of (Array.isArray(value.tabs) ? value.tabs : []).entries()) {
      if (out.tabs.length >= LIMITS.MAX_TABS) break;
      if (!t || typeof t !== 'object' || shareableUrl(t.url, extraHosts) === null) continue;
      let id = typeof t.id === 'string' && /^[\w-]{1,40}$/.test(t.id) ? t.id : 'i' + i;
      if (ids.has(id)) id = 'i' + i;
      ids.add(id);
      const e = { id, url: t.url, title: clean(t.title, LIMITS.MAX_TITLE) || t.url, h: hlcValid(t.h) ? t.h : '' };
      const fav = httpIcon(t.fav);
      if (fav) e.fav = fav;
      if (typeof t.g === 'string' && t.g) e.g = clean(t.g, LIMITS.MAX_GROUP);
      if (t.p) e.p = 1;
      if (Number.isFinite(t.s) && t.s > 0) e.s = Math.min(1e7, Math.round(t.s));
      if (Number.isSafeInteger(t.a) && t.a > 0) e.a = t.a;
      out.tabs.push(e);
    }
    if (Array.isArray(value.closed)) {
      out.closed = value.closed.filter(t => t && typeof t.id === 'string' && /^[\w-]{1,40}$/.test(t.id) && hlcValid(t.h)).slice(0, LIMITS.MAX_CLOSED).map(t => ({ id: t.id, h: t.h }));
    }
    if (typeof value.active === 'string' && ids.has(value.active)) out.active = value.active;
    return out;
  }

  // Two snapshots of the same device (say, the copy cached here and one that
  // just arrived): last writer wins per tab by clock, and a tombstone newer
  // than a tab removes it. Commutative, associative and idempotent.
  function mergeSnapshots(a, b, now = Date.now()) {
    const A = parseSnapshot(a), B = parseSnapshot(b);
    const tabs = new Map();
    for (const t of [...A.tabs, ...B.tabs]) {
      const have = tabs.get(t.id);
      if (!have || hlcCompare(t.h, have.h) > 0 || (hlcCompare(t.h, have.h) === 0 && JSON.stringify(t) > JSON.stringify(have))) tabs.set(t.id, t);
    }
    const closed = new Map();
    for (const t of [...A.closed, ...B.closed]) {
      const have = closed.get(t.id);
      if (!have || hlcCompare(t.h, have.h) > 0) closed.set(t.id, t);
    }
    for (const [id, tomb] of closed) {
      const t = tabs.get(id);
      if (t && hlcCompare(tomb.h, t.h) > 0) tabs.delete(id);
    }
    // A tab that came back after its tombstone is no longer closed.
    for (const [id, tomb] of [...closed]) { const t = tabs.get(id); if (t && hlcCompare(t.h, tomb.h) >= 0) closed.delete(id); }
    const list = [...tabs.values()].sort((x, y) => (y.a || 0) - (x.a || 0) || (x.id < y.id ? -1 : 1)).slice(0, LIMITS.MAX_TABS);
    const newer = hlcCompare(A.hlc, B.hlc) >= 0 ? A : B;
    return {
      v: 2, hlc: hlcMax(A.hlc, B.hlc), seen: Math.max(A.seen, B.seen), la: list.reduce((m, t) => Math.max(m, t.a || 0), 0),
      tabs: list, closed: compactClosed([...closed.values()], now),
      ...(newer.active && tabs.has(newer.active) ? { active: newer.active } : {}),
    };
  }

  // ---- Devices view model --------------------------------------------------------
  const looksLikePhone = name => /\b(iphone|ipad|android|pixel|galaxy|phone|mobile|tablet|oneplus|xiaomi|redmi|huawei|nokia|motorola|moto)\b/i.test(String(name || ''));

  // listed: the server's device list [{ deviceId, deviceName, lastSeenAt }].
  // snapshots: { [deviceId]: raw value of sync:tabs:<id> } (this device's too).
  // names: { [deviceId]: display name } (a device's own chosen name).
  // -> [{ deviceId, name, kind, self, lastSeen, lastActive, stale, tabCount, cut, tabs[] }]
  // The Devices-view contract: the same JSON the companion page is sent.
  function devicesView({ listed = [], snapshots = {}, names = {}, selfId = '', now = Date.now(), extraHosts } = {}) {
    const out = [];
    const ids = new Set([...listed.map(d => d && d.deviceId), ...Object.keys(snapshots)].filter(id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(id)));
    for (const deviceId of ids) {
      const dev = listed.find(d => d && d.deviceId === deviceId);
      // A device the server no longer lists was removed from the account.
      if (listed.length && !dev) continue;
      const snap = parseSnapshot(snapshots[deviceId], extraHosts);
      const server = dev && Date.parse(dev.lastSeenAt);
      // The server's clock is the one everybody shares; a device's own `seen`
      // is believed only when the server has not heard of it, and never in the future.
      const lastSeen = Number.isFinite(server) ? Math.min(server, now) : snap.seen ? Math.min(snap.seen, now) : null;
      const lastActive = Math.min(Math.max(snap.la, ...snap.tabs.map(t => t.a || 0), 0), now);
      const name = clean(names[deviceId] || (dev && dev.deviceName) || 'Unnamed device', 60);
      out.push({
        deviceId, name, kind: looksLikePhone(name) ? 'phone' : 'computer', self: deviceId === selfId,
        lastSeen, lastActive, stale: lastSeen != null && now - lastSeen > LIMITS.STALE_MS,
        tabCount: snap.tabs.length, cut: snap.cut,
        tabs: snap.tabs.map(t => ({ id: t.id, url: t.url, title: t.title, ...(t.fav ? { favicon: t.fav } : {}), ...(t.g ? { group: t.g } : {}), pinned: !!t.p, scroll: t.s || 0, lastActive: Math.min(t.a || 0, now), active: snap.active === t.id })),
      });
    }
    return out.sort((a, b) => (b.self ? 1 : 0) - (a.self ? 1 : 0) || b.lastActive - a.lastActive || (a.name < b.name ? -1 : 1));
  }

  // "Continue where I left off": this device has been idle and another one was
  // used since. -> { device, tabs, idleFor } or null.
  function continueWhereLeftOff(view, { now = Date.now(), selfLastActive = 0, idleMs = 10 * 60 * 1000, maxAgeMs = 7 * 24 * 3600 * 1000 } = {}) {
    if (!Array.isArray(view) || now - selfLastActive < idleMs) return null;
    let best = null;
    for (const d of view) {
      if (d.self || d.stale || !d.tabCount || !d.lastActive) continue;
      if (now - d.lastActive > maxAgeMs || d.lastActive <= selfLastActive) continue;
      if (!best || d.lastActive > best.lastActive) best = d;
    }
    if (!best) return null;
    const tabs = best.tabs.slice().sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0) || b.lastActive - a.lastActive);
    return { device: best, tabs, idleFor: now - best.lastActive };
  }

  // ---- Reading queue (vex.readLater) -----------------------------------------------
  // Items from a tab with a session of its own (ownSession) or on a sensitive
  // site stay on this device. -> { send, kept }
  function readingQueueForSync(list, extraHosts) {
    const send = [], kept = [];
    for (const item of Array.isArray(list) ? list : []) {
      const ok = item && typeof item === 'object' && item.ownSession !== true && shareableUrl(item.url, extraHosts) !== null;
      (ok ? send : kept).push(item);
    }
    return { send, kept };
  }
  // What a pull gives back, with this device's own held-back items after it.
  function readingQueueApply(synced, kept) {
    const have = new Set((Array.isArray(synced) ? synced : []).map(i => i && i.id));
    return [...(Array.isArray(synced) ? synced : []), ...(Array.isArray(kept) ? kept : []).filter(i => !(i && have.has(i.id)))];
  }

  return {
    LIMITS,
    hlcValid, hlcParse, hlcFormat, hlcCompare, hlcMax, hlcTick, hlcReceive, hlcWall,
    sensitiveHost, shareableUrl, shareableTab,
    buildSnapshot, fitSnapshot, compactClosed, parseSnapshot, mergeSnapshots,
    devicesView, continueWhereLeftOff, looksLikePhone,
    readingQueueForSync, readingQueueApply,
  };
});
