// === What is slowing my browser? — cost per tab, site and extension ==========
//
// Running tasks and the Memory panel say what each OS process weighs RIGHT
// NOW. They cannot say what a site has cost over the last five minutes, which
// is the question "why is my fan on" / "why is my battery going" really asks:
// a tab that burns the processor for ten seconds an hour is innocent, and one
// that holds 8% of a core all afternoon is not, and an instantaneous
// percentage cannot tell them apart.
//
// This keeps a short in-memory ledger. Each sample reads app:processes (the
// same call Running tasks makes) and works out, per process, how much
// processor time it used since the last sample (Chromium's cumulative CPU
// seconds, so any number of other callers of getAppMetrics cannot skew it),
// then hands that to whoever lives in the process:
//
//   a tab (its site)      — the page's host; several tabs of one site add up
//   a shared renderer     — split EQUALLY between the tabs in it, flagged shared
//   a panel               — by name
//   an extension          — its background page
//   service workers       — one bucket, named by what is running
//   the interface, main, GPU, Chromium services — "Vex itself"
//   anything else         — "unidentified", never guessed at
//   private and Tor tabs  — ONE anonymous total. Never a title, an address or a
//                           count of tabs by site, and never kept per tab.
//
// Nothing is written to disk and nothing leaves the PC. The ledger holds the
// last five minutes of per-interval figures and session totals per entity,
// capped; closing Vex ends it.
//
// === Event shape: perf.tabcost ==============================================
// toEvent(snapshot) is the stable, privacy-reduced form. With the person's
// opt-in (TabCostLink, below; off by default) a trimmed copy is written to
// Game Control Center's PC Black Box (%LOCALAPPDATA%\PCBlackBox\events-*.ndjson)
// by src/main/pcbb-link.js, never creating that folder. One JSON object per
// sample, no titles, no tab ids, no addresses beyond the host:
//   {
//     "kind": "perf.tabcost", "v": 1, "at": <epoch ms>,
//     "windowMs": 300000,          // how much history the figures cover
//     "spanMs": 247000,            // how much of it was actually sampled
//     "totalCpuSec": 31.4,         // processor seconds, all of Vex, in the window
//     "totalMemMB": 2410, "totalNetBytes": 18200000,
//     "cpuMeasured": true,         // false: Electron gave no CPU seconds
//     "top": [                     // at most 8, heaviest processor first
//       { "kind": "site"|"panel"|"extension"|"system"|"workers"|"unknown"|"private"|"closed",
//         "name": "youtube.com",   // host / panel / extension name; "private" has none
//         "cpuSec": 19.2, "cpuPct": 7.8,   // pct of ONE core, averaged over spanMs
//         "cpuShare": 0.61,        // fraction of all Vex processor time
//         "memMB": 640, "netBytes": 9100000, "netUnsized": 3,
//         "tabs": 2, "shared": false }
//     ],
//     "verdict": "ok"|"notable"|"heavy"
//   }

const TAB_COST_WINDOW_MS = 5 * 60 * 1000;
const TAB_COST_MAX_ENTITIES = 300;
const TAB_COST_MAX_RECENT = 240;          // 5 min at the 5 s cadence is 60; headroom for jitter
const TAB_COST_BUSY_PCT = 25;             // of one core, averaged: same bar as WhySlow.BUSY_CPU
const TAB_COST_NOTABLE_PCT = 8;
const TAB_COST_HEAVY_MB = 700;
const TAB_COST_NET_MB = 50;

// ---- pure: who is a tab -----------------------------------------------------

// A private or Tor tab: not on a persistent session (the same test the tab's
// own badge uses), or any tab at all in a private window.
function tabCostIsPrivate(tab, privateWindow) {
  if (privateWindow) return true;
  const p = tab && tab.partition;
  return !!p && !String(p).startsWith('persist:');
}

function tabCostHost(url) {
  try {
    const u = new URL(String(url));
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.hostname.replace(/^www\./, '');
  } catch { return ''; }
}

// ---- pure: the ledger ------------------------------------------------------

function tabCostNewState(now) {
  return {
    t0: now,
    lastT: null,
    prevCum: new Map(),     // pid -> cumulative CPU seconds at the last sample
    prevNet: new Map(),     // webContents id -> bytes / requests / unsized at the last sample
    recent: [],             // { t, dt, cpu:{key:sec}, net:{key:{bytes,unsized,requests}}, mem:{key:MB} }
    session: new Map(),     // key -> entity totals
    samples: 0,
    cpuUnmeasured: 0,       // processes with no CPU seconds, last sample
    cpuMeasuredEver: false,
  };
}

function tabCostBlank(key, kind, label, host) {
  return { key, kind, label, host: host || '', cpuSec: 0, netBytes: 0, netUnsized: 0, netRequests: 0, memMB: 0, peakMemMB: 0, shared: false, tabs: [], lastSeen: 0 };
}

// Where one content (a page, a panel, a background page…) of a process goes.
// Returns { key, kind, label, host, tab? } — never a title for a private tab.
function tabCostOwner(c, ctx) {
  if (c.kind === 'webview') {
    const panel = ctx.panels && ctx.panels.get(c.id);
    if (panel) return { key: 'panel:' + panel.name, kind: 'panel', label: panel.label, host: '' };
    const tab = ctx.tabs && ctx.tabs.get(c.id);
    if (tab) {
      if (tab.private) return { key: 'private', kind: 'private', label: 'Private and Tor tabs', host: '' };
      if (tab.host) return { key: 'site:' + tab.host, kind: 'site', label: tab.host, host: tab.host, tab };
      return { key: 'tab:' + tab.id, kind: 'site', label: tab.title || 'New Tab', host: '', tab };
    }
    return { key: 'unknown', kind: 'unknown', label: 'Pages Vex cannot match to a tab (pop-ups, previews)', host: '' };
  }
  if (c.kind === 'backgroundPage') {
    const name = c.extension || 'extension';
    return { key: 'ext:' + name, kind: 'extension', label: name, host: '' };
  }
  if (c.kind === 'window') return { key: 'system:ui', kind: 'system', label: 'Vex interface', host: '' };
  return { key: 'unknown', kind: 'unknown', label: 'Unidentified processes', host: '' };
}

// The owners of one process: a list of entities that share it. One for most
// things; several for a renderer that backs more than one page.
function tabCostProcessOwners(p, workers, ctx) {
  if (p.type === 'Browser') return [{ key: 'system:main', kind: 'system', label: 'Vex itself (main process)', host: '' }];
  if (p.type === 'GPU') return [{ key: 'system:gpu', kind: 'system', label: 'Graphics process', host: '' }];
  if (p.type === 'Utility') return [{ key: 'system:services', kind: 'system', label: 'Chromium services (network, audio, video)', host: '' }];
  const contents = Array.isArray(p.contents) ? p.contents : [];
  const seen = new Map();
  for (const c of contents) {
    const o = tabCostOwner(c, ctx);
    if (!seen.has(o.key)) seen.set(o.key, o);
  }
  if (seen.size) {
    // A tab and a panel can share one renderer; the interface rarely does.
    // An extension background page sharing with a page is split just the same.
    return [...seen.values()];
  }
  if (workers && workers.length) {
    const names = [...new Set(workers.map(w => w.extension || tabCostHost(w.url) || 'worker'))];
    return [{ key: 'workers', kind: 'workers', label: 'Service workers (' + names.slice(0, 4).join(', ') + (names.length > 4 ? ', …' : '') + ')', host: '' }];
  }
  return [{ key: 'unknown', kind: 'unknown', label: 'Unidentified processes', host: '' }];
}

function tabCostFold(state, key) {
  // Cap the session table: the entity that is gone and cost least folds into
  // one "closed" row, so a day of opening tabs cannot grow it without end.
  while (state.session.size > TAB_COST_MAX_ENTITIES) {
    let victim = null;
    for (const e of state.session.values()) {
      if (e.key === key || e.key === 'closed' || e.kind !== 'site') continue;
      if (!victim || e.lastSeen < victim.lastSeen || (e.lastSeen === victim.lastSeen && e.cpuSec < victim.cpuSec)) victim = e;
    }
    if (!victim) break;
    state.session.delete(victim.key);
    let closed = state.session.get('closed');
    if (!closed) { closed = tabCostBlank('closed', 'closed', 'Sites you have since closed', ''); state.session.set('closed', closed); }
    closed.cpuSec += victim.cpuSec;
    closed.netBytes += victim.netBytes;
    closed.netUnsized += victim.netUnsized;
    closed.netRequests += victim.netRequests;
  }
}

// One sample. input = { procs: [...app:processes rows], workers: [...] },
// ctx = { tabs: Map(wcId -> { id, title, host, private, active, audible, muted }),
//         panels: Map(wcId -> { name, label }) }.
// Mutates and returns state. No clock, no DOM, no IPC: `now` is passed in.
function tabCostStep(state, input, ctx, now) {
  const procs = Array.isArray(input.procs) ? input.procs : [];
  const first = state.lastT === null;
  const dt = first ? 0 : Math.max(0, (now - state.lastT) / 1000);
  const interval = { t: now, dt, cpu: {}, net: {}, mem: {} };
  const touched = new Map();   // key -> entity (this sample)
  const entity = (o) => {
    let e = state.session.get(o.key);
    if (!e) { e = tabCostBlank(o.key, o.kind, o.label, o.host); state.session.set(o.key, e); }
    e.label = o.label;         // a tab's title moves; the latest wins
    e.host = o.host || e.host;
    e.lastSeen = now;
    touched.set(o.key, e);
    return e;
  };
  // What is not on screen any more has no tabs; rebuilt each sample.
  for (const e of state.session.values()) e.tabs = [];
  let unmeasured = 0;
  const curCum = new Map();
  const memOf = {};
  const sharedKeys = new Set();

  for (const p of procs) {
    const owners = tabCostProcessOwners(p, input.workers, ctx);
    const n = owners.length;
    const memMB = (p.memKB || 0) / 1024;
    // Processor seconds since the last sample. A pid seen for the first time
    // after the ledger began started in between, so all of it counts; on the
    // very first sample nothing does (there is no "since").
    let delta = 0;
    if (typeof p.cum === 'number') {
      state.cpuMeasuredEver = true;
      curCum.set(p.pid, p.cum);
      if (!first) {
        const prev = state.prevCum.get(p.pid);
        delta = prev === undefined || p.cum < prev ? p.cum : p.cum - prev;
      }
    } else unmeasured++;
    for (const o of owners) {
      const e = entity(o);
      if (n > 1) { e.shared = true; sharedKeys.add(o.key); }
      interval.cpu[o.key] = (interval.cpu[o.key] || 0) + delta / n;
      memOf[o.key] = (memOf[o.key] || 0) + memMB / n;
    }
  }

  // Network: exact per page (the counter is per webContents), so not split.
  // Walk every content once; private pages go to the one anonymous total.
  const curNet = new Map();
  for (const p of procs) {
    for (const c of (Array.isArray(p.contents) ? p.contents : [])) {
      if (!c.net) continue;
      curNet.set(c.id, c.net);
      const prev = state.prevNet.get(c.id);
      const was = prev || { bytes: 0, requests: 0, unsized: 0 };
      // A page that is new since the last sample started its counter at zero.
      const d = {
        bytes: Math.max(0, c.net.bytes - was.bytes),
        requests: Math.max(0, c.net.requests - was.requests),
        unsized: Math.max(0, c.net.unsized - was.unsized),
      };
      if (first) continue;
      const o = tabCostOwner(c, ctx);
      const e = entity(o);
      const slot = interval.net[o.key] || (interval.net[o.key] = { bytes: 0, requests: 0, unsized: 0 });
      slot.bytes += d.bytes; slot.requests += d.requests; slot.unsized += d.unsized;
      e.netBytes += d.bytes; e.netRequests += d.requests; e.netUnsized += d.unsized;
    }
  }

  for (const [key, e] of touched) {
    e.cpuSec += interval.cpu[key] || 0;
    e.memMB = memOf[key] || 0;
    if (e.memMB > e.peakMemMB) e.peakMemMB = e.memMB;
    interval.mem[key] = e.memMB;
  }
  // Tabs, for the buttons: every tab in the context belongs to its site's row.
  // Private tabs are NOT listed anywhere: that is the point.
  for (const tab of ctx.tabs ? ctx.tabs.values() : []) {
    if (tab.private) continue;
    const key = tab.host ? 'site:' + tab.host : 'tab:' + tab.id;
    const e = state.session.get(key);
    if (e) e.tabs.push({ id: tab.id, title: tab.title, active: !!tab.active, audible: !!tab.audible, muted: !!tab.muted });
  }
  // Memory of things that were not seen this time is zero, not stale.
  for (const e of state.session.values()) if (!touched.has(e.key)) e.memMB = 0;
  for (const e of state.session.values()) if (!sharedKeys.has(e.key)) e.shared = false;

  state.prevCum = curCum;
  state.prevNet = curNet;
  state.cpuUnmeasured = unmeasured;
  state.lastT = now;
  state.samples++;
  if (!first) {
    state.recent.push(interval);
    const cut = now - TAB_COST_WINDOW_MS;
    while (state.recent.length && state.recent[0].t < cut) state.recent.shift();
    while (state.recent.length > TAB_COST_MAX_RECENT) state.recent.shift();
  }
  tabCostFold(state, null);
  return state;
}

// ---- pure: the answer ------------------------------------------------------

function tabCostFmtMB(mb) { return mb >= 1024 ? (mb / 1024).toFixed(1) + ' GB' : Math.round(mb) + ' MB'; }
function tabCostFmtBytes(b) {
  if (b >= 1073741824) return (b / 1073741824).toFixed(1) + ' GB';
  if (b >= 1048576) return (b / 1048576).toFixed(b >= 10485760 ? 0 : 1) + ' MB';
  if (b >= 1024) return Math.round(b / 1024) + ' KB';
  return b + ' B';
}
function tabCostFmtDur(ms) {
  const s = Math.round(ms / 1000);
  if (s < 90) return s + ' seconds';
  const m = Math.round(s / 60);
  return m < 60 ? m + ' minutes' : (m / 60).toFixed(1) + ' hours';
}

// Which one-click actions Vex already has apply to a row. Names only; the
// screen maps each to the existing call (TabManager.sleepTab / closeTab /
// toggleMuteTab, VexTasks.hold). Nothing here is a new capability.
function tabCostActions(row) {
  const out = [];
  if (row.kind === 'site') {
    const sleepable = row.tabList.filter(t => !t.active);
    if (sleepable.length) out.push('sleep');
    if (row.tabList.some(t => t.audible && !t.muted)) out.push('mute');
    if (row.tabList.length) out.push('close');
    if (row.host && sleepable.length) out.push('always-sleep-site');
  } else if (row.kind === 'panel') {
    out.push('sleep-panel');
  }
  return out;
}

// scope: 'recent' (the last five minutes) or 'session' (since sampling began).
function tabCostSnapshot(state, opts = {}) {
  const now = opts.now != null ? opts.now : (state.lastT || Date.now());
  const scope = opts.scope === 'session' ? 'session' : 'recent';
  const windowMs = scope === 'session' ? Math.max(1, now - state.t0) : TAB_COST_WINDOW_MS;
  const cut = now - windowMs;
  const inWin = state.recent.filter(r => r.t >= cut);
  const spanMs = scope === 'session'
    ? Math.max(0, (state.lastT || now) - state.t0)
    : inWin.reduce((s, r) => s + r.dt * 1000, 0);

  const agg = new Map();       // key -> { cpuSec, netBytes, netUnsized, netRequests }
  const bump = (k) => { let a = agg.get(k); if (!a) { a = { cpuSec: 0, netBytes: 0, netUnsized: 0, netRequests: 0 }; agg.set(k, a); } return a; };
  if (scope === 'session') {
    for (const e of state.session.values()) { const a = bump(e.key); a.cpuSec = e.cpuSec; a.netBytes = e.netBytes; a.netUnsized = e.netUnsized; a.netRequests = e.netRequests; }
  } else {
    for (const r of inWin) {
      for (const [k, v] of Object.entries(r.cpu)) bump(k).cpuSec += v;
      for (const [k, v] of Object.entries(r.net)) { const a = bump(k); a.netBytes += v.bytes; a.netUnsized += v.unsized; a.netRequests += v.requests; }
    }
  }

  const rows = [];
  let totalCpu = 0, totalMem = 0, totalNet = 0;
  for (const [key, a] of agg) {
    const e = state.session.get(key);
    if (!e) continue;
    totalCpu += a.cpuSec; totalNet += a.netBytes; totalMem += e.memMB;
  }
  for (const [key, a] of agg) {
    const e = state.session.get(key);
    if (!e) continue;
    // Gone and never cost anything: not a row.
    if (a.cpuSec <= 0 && a.netBytes <= 0 && e.memMB <= 0) continue;
    const row = {
      key, kind: e.kind, label: e.label, host: e.host,
      cpuSec: a.cpuSec,
      cpuPct: spanMs > 0 ? (a.cpuSec / (spanMs / 1000)) * 100 : 0,
      cpuShare: totalCpu > 0 ? a.cpuSec / totalCpu : 0,
      memMB: e.memMB, memShare: totalMem > 0 ? e.memMB / totalMem : 0,
      netBytes: a.netBytes, netUnsized: a.netUnsized, netRequests: a.netRequests,
      shared: e.shared,
      tabCount: e.kind === 'site' ? e.tabs.length : 0,
      // Nothing in a private row can be acted on or named.
      tabList: e.kind === 'site' ? e.tabs.map(t => ({ ...t })) : [],
    };
    row.actions = tabCostActions(row);
    rows.push(row);
  }
  rows.sort((x, y) => (y.cpuSec - x.cpuSec) || (y.memMB - x.memMB));

  const snap = {
    kind: 'perf.tabcost', v: 1, at: now, scope, windowMs, spanMs,
    samples: state.samples, cpuMeasured: state.cpuMeasuredEver,
    cpuUnmeasuredProcesses: state.cpuUnmeasured,
    totals: { cpuSec: totalCpu, memMB: totalMem, netBytes: totalNet },
    rows,
  };
  snap.verdict = tabCostVerdict(snap);
  return snap;
}

// The plain-English answer. Pure over a snapshot.
function tabCostVerdict(snap) {
  const rows = snap.rows;
  const span = tabCostFmtDur(snap.spanMs);
  const where = snap.scope === 'session' ? 'since Vex started measuring (' + span + ')' : 'over the last ' + (snap.spanMs >= TAB_COST_WINDOW_MS - 15000 ? '5 minutes' : span);
  if (!snap.samples || snap.spanMs < 10000) {
    return { level: 'ok', headline: 'Vex is still measuring', lines: ['Give it a minute: it needs a few samples before it can say which site is using the processor.'], top: null };
  }
  if (!snap.cpuMeasured) {
    return { level: 'ok', headline: 'This build of Vex cannot read processor time per process', lines: ['Memory and downloads are still listed below.'], top: null };
  }
  const lines = [];
  let level = 'ok';
  const top = rows.find(r => r.cpuSec > 0) || null;
  const named = (r) => r.kind === 'private' ? 'Your private and Tor tabs together'
    : r.kind === 'site' ? r.label
    : r.kind === 'system' ? r.label
    : r.label;
  let headline;
  if (top && top.cpuPct >= TAB_COST_BUSY_PCT) {
    level = 'heavy';
    headline = named(top) + ' used ' + Math.round(top.cpuShare * 100) + '% of the processor time ' + where + ' — about ' + Math.round(top.cpuPct) + '% of one core, held steadily.';
    lines.push('That is what keeps the fan up and drains a battery. Sleeping or closing it is the fix; the rest of Vex is cheap by comparison.');
  } else if (top && top.cpuPct >= TAB_COST_NOTABLE_PCT) {
    level = 'notable';
    headline = named(top) + ' is the busiest ' + where + ': ' + Math.round(top.cpuShare * 100) + '% of the processor time, about ' + Math.round(top.cpuPct) + '% of one core.';
    lines.push('Not a problem on its own, but it is the one doing the most.');
  } else {
    headline = 'Nothing is using the processor in a way that matters ' + where + '.';
    if (top) lines.push('The busiest, ' + named(top) + ', averaged ' + top.cpuPct.toFixed(1) + '% of one core.');
  }
  const heavyMem = rows.filter(r => r.memMB >= TAB_COST_HEAVY_MB && r.kind !== 'system').sort((a, b) => b.memMB - a.memMB)[0];
  if (heavyMem) {
    if (level === 'ok') level = 'notable';
    lines.push(named(heavyMem) + ' holds ' + tabCostFmtMB(heavyMem.memMB) + ' of memory' + (heavyMem.shared ? ' (shared with other pages in the same process)' : '') + '.');
  }
  const heavyNet = rows.filter(r => r.netBytes >= TAB_COST_NET_MB * 1048576 && r.kind !== 'private').sort((a, b) => b.netBytes - a.netBytes)[0];
  if (heavyNet) lines.push(named(heavyNet) + ' downloaded ' + tabCostFmtBytes(heavyNet.netBytes) + ' ' + where + '. A page that keeps fetching keeps the network and the processor awake.');
  const sys = rows.find(r => r.kind === 'system' && r.cpuShare >= 0.4);
  if (sys && level === 'ok') lines.push(sys.label + ' accounts for ' + Math.round(sys.cpuShare * 100) + '% — that is Vex or Chromium working for you, not a page.');
  const priv = rows.find(r => r.kind === 'private');
  if (priv && priv.cpuShare >= 0.3) lines.push('Private and Tor tabs are shown as one total on purpose: ' + Math.round(priv.cpuShare * 100) + '% of the processor time is theirs, but which tab is not recorded.');
  return { level, headline, lines, top: top ? top.key : null };
}

// The privacy-reduced record described at the top of this file.
function tabCostToEvent(snap) {
  const top = snap.rows.filter(r => r.cpuSec > 0 || r.memMB > 0 || r.netBytes > 0).slice(0, 8).map(r => ({
    kind: r.kind,
    // A site with no host (a new-tab page) is labelled by its tab TITLE, which is not a host: not named.
    name: r.kind === 'private' || r.kind === 'unknown' || r.kind === 'closed' || (r.kind === 'site' && !r.host) ? '' : (r.host || r.label),
    cpuSec: Math.round(r.cpuSec * 10) / 10,
    cpuPct: Math.round(r.cpuPct * 10) / 10,
    cpuShare: Math.round(r.cpuShare * 100) / 100,
    memMB: Math.round(r.memMB),
    netBytes: r.netBytes,
    netUnsized: r.netUnsized,
    tabs: r.tabCount,
    shared: !!r.shared,
  }));
  return {
    kind: 'perf.tabcost', v: 1, at: snap.at, windowMs: snap.windowMs, spanMs: Math.round(snap.spanMs),
    totalCpuSec: Math.round(snap.totals.cpuSec * 10) / 10,
    totalMemMB: Math.round(snap.totals.memMB),
    totalNetBytes: snap.totals.netBytes,
    cpuMeasured: !!snap.cpuMeasured,
    top,
    verdict: snap.verdict.level,
  };
}

// ---- the link to Game Control Center's Black Box --------------------------
//
// What a perf.tabcost line holds (the Black Box library's own schema decides
// what is kept; this only picks the fields): the top five rows, host names
// only, the private/Tor row as an anonymous total.
function tabCostLinkPayload(event) {
  const top = (event.top || []).slice(0, 5).map(r => {
    const anon = r.kind === 'private' || r.kind === 'unknown' || r.kind === 'closed' || (r.kind === 'site' && !r.name);
    const row = { kind: r.kind === 'site' && !r.name ? 'unknown' : r.kind, cpuPct: r.cpuPct, cpuShare: r.cpuShare, memMB: r.memMB, tabs: anon ? 0 : r.tabs };
    if (!anon && r.name) row.name = r.name;
    return row;
  });
  return { windowMs: event.windowMs, spanMs: event.spanMs, totalCpuSec: event.totalCpuSec, cpuMeasured: !!event.cpuMeasured, verdict: event.verdict, top };
}

// Whether to write one now. Pure: the clock and the game state are passed in.
//   - never more than one line a minute;
//   - nothing until there is a measurement (cpu seconds, a few samples);
//   - while a game runs: every minute, because that is when Game Control
//     Center is listening;
//   - otherwise only when a site's tab averages at least the "notable" bar,
//     so an ordinary day writes nothing.
const TAB_COST_LINK_GAP_MS = 60 * 1000;
function tabCostLinkDecision({ event, gaming, now, lastWrittenAt }) {
  if (lastWrittenAt && now - lastWrittenAt < TAB_COST_LINK_GAP_MS) return { write: false, reason: 'too-soon' };
  if (!event.cpuMeasured || event.spanMs < 10000) return { write: false, reason: 'no-measurement' };
  if (gaming) return { write: true, reason: 'gaming' };
  const site = event.top.find(r => r.kind === 'site' && r.name);
  if (site && site.cpuPct >= TAB_COST_NOTABLE_PCT) return { write: true, reason: 'notable' };
  return { write: false, reason: 'quiet' };
}

// ---- the live ledger -------------------------------------------------------
//
// Cadence: every 5 s while the Memory panel is open (it calls sample() on its
// own 3 s refresh and the 5 s floor decides), once a minute otherwise, held
// by VexJobs while a game is running or Vex is hidden. Opening the panel
// during a game is the user asking, so that samples regardless.
const TabCost = {
  PANEL_GAP_MS: 5000,
  JOB_MS: 60000,
  state: null,
  _busy: false,

  _ensure(now) { if (!this.state) this.state = tabCostNewState(now); return this.state; },

  // The join the Memory panel and Running tasks do: which webContents is
  // which tab or panel, and whether the tab is private.
  _context() {
    const ctx = { tabs: new Map(), panels: new Map() };
    const wcOf = (wv) => { try { return wv && typeof wv.getWebContentsId === 'function' ? wv.getWebContentsId() : null; } catch { return null; } };
    const privateWindow = !!(window.VexTabPolicy && window.VexTabPolicy.isPrivateWindow);
    if (typeof TabManager !== 'undefined' && typeof WebviewManager !== 'undefined') {
      for (const t of TabManager.tabs || []) {
        const id = wcOf(WebviewManager.webviews.get(t.id));
        if (id == null) continue;
        const priv = tabCostIsPrivate(t, privateWindow);
        ctx.tabs.set(id, priv
          ? { id: t.id, private: true }
          : { id: t.id, private: false, title: t.title || t.url || 'Tab', host: tabCostHost(t.url), active: t.id === TabManager.activeTabId, audible: !!t.audible, muted: !!t.muted });
      }
    }
    if (typeof SidebarManager !== 'undefined' && SidebarManager.panelWebviews) {
      for (const [name, wv] of Object.entries(SidebarManager.panelWebviews)) {
        const id = wcOf(wv);
        if (id != null) ctx.panels.set(id, { name, label: SidebarManager.panelLabel(name) });
      }
    }
    return ctx;
  },

  // One sample, unless the last one was less than minGapMs ago. Errors are
  // returned to the caller, not swallowed: a ledger that quietly stopped
  // would answer "nothing is wrong" over nothing.
  async sample({ minGapMs = 0 } = {}) {
    const now = Date.now();
    const st = this._ensure(now);
    if (this._busy) return null;
    if (st.lastT !== null && now - st.lastT < minGapMs) return null;
    if (!window.vex || typeof window.vex.processes !== 'function') throw new Error('The process list is not available in this build');
    this._busy = true;
    try {
      const got = await window.vex.processes();
      const procs = Array.isArray(got) ? got : (got && got.processes) || [];
      tabCostStep(st, { procs, workers: (got && got.workers) || [] }, this._context(), Date.now());
      return st;
    } finally { this._busy = false; }
  },

  snapshot(opts) {
    const st = this._ensure(Date.now());
    return tabCostSnapshot(st, opts);
  },

  event(opts) { return tabCostToEvent(this.snapshot(opts)); },

  // The minute-by-minute ledger. Held while a game runs or Vex is hidden.
  start() {
    if (typeof VexJobs === 'undefined') return;
    VexJobs.every('Tab cost', this.JOB_MS, () => this.sample({ minGapMs: this.JOB_MS - 5000 }), { when: 'ui' });
    // The baseline now, so the first minute is not lost to "there is no since".
    this.sample().catch(err => console.error('[tab-cost] first sample failed:', err));
  },

  // ---- one-click actions: only calls Vex already has ----------------------
  async act(action, row) {
    if (!row) throw new Error('Nothing to act on');
    const tabs = row.tabList || [];
    if (action === 'sleep') {
      const ids = tabs.filter(t => !t.active).map(t => t.id);
      if (!ids.length) throw new Error('That is the tab you are looking at — open another tab first');
      for (const id of ids) await TabManager.sleepTab(id, true);
      return ids.length === 1 ? 'Tab put to sleep' : ids.length + ' tabs put to sleep';
    }
    if (action === 'mute') {
      const ids = tabs.filter(t => t.audible && !t.muted).map(t => t.id);
      if (!ids.length) throw new Error('Nothing here is playing sound');
      for (const id of ids) TabManager.toggleMuteTab(id);
      return ids.length === 1 ? 'Tab muted' : ids.length + ' tabs muted';
    }
    if (action === 'close') {
      const ids = tabs.map(t => t.id);
      if (!ids.length) throw new Error('No tab to close');
      TabManager.closeTabsWithUndo(ids, ids.length === 1 ? 'Closed the tab' : 'Closed ' + ids.length + ' tabs');
      return ids.length === 1 ? 'Tab closed' : ids.length + ' tabs closed';
    }
    if (action === 'always-sleep-site') {
      if (!row.host) throw new Error('This page has no site to hold');
      if (typeof VexTasks === 'undefined') throw new Error('Running tasks is not available in this window');
      // The same "end, and keep it off until I let it back" as Running tasks:
      // the site's background tabs are put to sleep whenever they wake.
      VexTasks.hold('site:' + row.host, null, row.host, 'tab');
      VexTasks.enforce();
      return row.host + ' will be put back to sleep whenever it is in the background — let it back from Running tasks';
    }
    if (action === 'sleep-panel') {
      const name = String(row.key || '').replace(/^panel:/, '');
      if (typeof SidebarManager === 'undefined') throw new Error('The sidebar is not available in this window');
      const busy = (SidebarManager.panelBusy && SidebarManager.panelBusy(name)) || '';
      if (busy) throw new Error(SidebarManager.panelLabel(name) + ' is in use — ' + busy);
      if (name === SidebarManager.activePanel || name === SidebarManager.sidePanel) SidebarManager.hideActivePanel();
      SidebarManager.sleepPanel(name);
      return SidebarManager.panelLabel(name) + ' is asleep';
    }
    throw new Error('Unknown action: ' + action);
  },

  ACTION_LABELS: {
    sleep: 'Sleep', mute: 'Mute', close: 'Close', 'always-sleep-site': 'Always sleep this site', 'sleep-panel': 'Sleep panel',
  },
};

// Settings › Gaming and streaming › "Tell Game Control Center which tab was
// busy". OFF until switched on. It has its own once-a-minute timer on purpose:
// VexJobs holds the ledger while a game runs, and a game is exactly when this
// is wanted. One process-list read a minute, and only while the switch is on.
const TabCostLink = {
  KEY: 'vex.tabcost.link',
  _timer: null,
  _lastWrittenAt: 0,
  last: null,        // { at, reason, written } for Settings

  enabled() { try { return localStorage.getItem(this.KEY) === 'on'; } catch { return false; } },

  async setEnabled(on) {
    if (!window.vex || typeof window.vex.pcbbLinkSet !== 'function') throw new Error('Game Control Center link is not available in this window');
    try { localStorage.setItem(this.KEY, on ? 'on' : 'off'); } catch (err) { throw new Error('Could not save the setting: ' + err.message); }
    const st = await window.vex.pcbbLinkSet(!!on);
    this._arm();
    return st;
  },

  // Main starts OFF every run; tell it what the person chose.
  async start() {
    if (!this.enabled()) return;
    if (!window.vex || typeof window.vex.pcbbLinkSet !== 'function') return;
    // A private window never writes, whatever the main window chose.
    if (window.VexTabPolicy && window.VexTabPolicy.isPrivateWindow) return;
    await window.vex.pcbbLinkSet(true);
    this._arm();
  },

  _arm() {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    if (!this.enabled()) return;
    this._timer = setTimeout(() => {
      this._timer = null;
      this.tick().catch(err => window.VexProblems?.note('Tab cost', 'Could not tell Game Control Center', err)).finally(() => this._arm());
    }, TAB_COST_LINK_GAP_MS);
  },

  // One look. Returns { write, reason, written? }.
  async tick(now = Date.now()) {
    const gaming = typeof GameMode !== 'undefined' && !!GameMode.gaming;
    if (!gaming && typeof document !== 'undefined' && document.hidden) return { write: false, reason: 'hidden' };
    await TabCost.sample({ minGapMs: TAB_COST_LINK_GAP_MS - 10000 });
    const event = TabCost.event({ scope: 'recent' });
    const d = tabCostLinkDecision({ event, gaming, now, lastWrittenAt: this._lastWrittenAt });
    if (!d.write) return d;
    const r = await window.vex.pcbbTabCost(tabCostLinkPayload(event));
    this.last = { at: now, reason: r.written ? d.reason : r.reason, written: !!r.written };
    if (r.written) this._lastWrittenAt = now;
    return { ...d, written: !!r.written, skipped: r.written ? undefined : r.reason };
  },

  // The Settings row: a switch, and a plain account of what it does.
  async renderSettings(host) {
    if (!host || !window.vex || typeof window.vex.pcbbLinkState !== 'function') return;
    const wrap = document.createElement('div');
    wrap.className = 'tabcost-link';
    const row = document.createElement('div');
    row.className = 'setting-toggle-row';
    const label = 'Tell Game Control Center which tab was busy';
    row.innerHTML = '<span></span><label class="toggle"><input type="checkbox" aria-label="' + label + '"><span class="toggle-slider"></span></label>';
    row.querySelector('span').textContent = label;
    const box = row.querySelector('input');
    box.checked = this.enabled();
    const info = document.createElement('p');
    info.className = 'muted';
    info.id = 'tabcost-link-info';
    info.textContent = 'Off by default. When on, Vex writes one short line a minute to the PC Black Box folder that Game Control Center keeps '
      + '(%LOCALAPPDATA%\\PCBlackBox), naming the site whose tab used the most processor time, and only while a game is running or one site stands out. '
      + 'Game Control Center can then say "a browser tab on example.com was using about 30% of a core" next to a lag spike. '
      + 'The file is local and readable by any program on this PC; Vex never creates the folder, and private and Tor tabs only ever count as one anonymous total. '
      + 'Vex cannot see Game Control Center’s own Black Box switch: to stop it from that side, delete the folder.';
    box.setAttribute('aria-describedby', info.id);
    const status = document.createElement('p');
    status.className = 'muted';
    status.setAttribute('role', 'status');
    const paint = async () => {
      const st = await window.vex.pcbbLinkState();
      status.textContent = !box.checked ? '' : st.folderFound
        ? 'The Black Box folder was found, so lines will be written.'
        : 'The Black Box folder was not found (Game Control Center creates it), so nothing is written yet.';
    };
    box.addEventListener('change', async () => {
      try { await this.setEnabled(box.checked); await paint(); }
      catch (err) { box.checked = !box.checked; window.showToast?.('Game Control Center link: ' + ((err && err.message) || err), 'error'); }
    });
    wrap.append(row, info, status);
    host.appendChild(wrap);
    paint().catch(err => { status.textContent = 'Could not check the Black Box folder: ' + err.message; });
  },
};

if (typeof window !== 'undefined') { window.TabCost = TabCost; window.TabCostLink = TabCostLink; window.tabCostSnapshot = tabCostSnapshot; }
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    TabCostLink, tabCostLinkPayload, tabCostLinkDecision, TAB_COST_LINK_GAP_MS,
    TabCost, tabCostNewState, tabCostStep, tabCostSnapshot, tabCostVerdict, tabCostToEvent,
    tabCostIsPrivate, tabCostHost, tabCostActions, TAB_COST_WINDOW_MS, TAB_COST_MAX_ENTITIES,
  };
}
