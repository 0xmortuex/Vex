// === Tuning advisor: what costs the most, what to do about it ===============
//
// The interface gathers what Vex already measures (TabCost's per-site, panel
// and extension cost; VexJobs' per-job timings; battery state; the startup
// time main recorded) into one plain `metrics` object and asks for advice.
// Everything here is a pure function of that object, so it is tested with
// fixture metrics and never touches a process:
//
//   advise(metrics)        -> recommendations, each with an optional ONE-CLICK
//                             action drawn from a closed list (ACTION_KINDS);
//   compareSamples(list)   -> "what slowed Vex down since yesterday";
//   createSampleStore()    -> the bounded history that comparison reads.
//
// What it will never do: kill an OS process, or name a process that is not
// one of Vex's own. Every action goes through an API Vex already has (put a
// tab to sleep, switch battery mode or reduced motion on, turn Recall off)
// and each one carries its own undo. Private and Tor tabs arrive as one
// anonymous row and are never given an action or a name.
'use strict';
const fs = require('fs');
const path = require('path');

const ACTION_KINDS = Object.freeze(['sleep-tab', 'battery-mode-on', 'reduce-motion-on', 'recall-off']);

// Job name (js/jobs.js) -> the feature it belongs to and the switch for it.
// A job not listed here is reported but has no one-click action.
const JOB_FEATURES = Object.freeze({
  'Recall by meaning': { feature: 'Recall (page memory)', action: { kind: 'recall-off' } },
});
function featureOf(jobName) {
  if (JOB_FEATURES[jobName]) return JOB_FEATURES[jobName];
  if (/^recall/i.test(jobName)) return JOB_FEATURES['Recall by meaning'];
  return null;
}

const T = Object.freeze({
  sleepMemMB: 300,        // a site holding this much, with tabs that can sleep
  hotCpuPct: 10,          // of one core, averaged, for a tab that is not in front
  jobCpuPct: 1,           // of the interface thread
  extCpuPct: 3, extMemMB: 250,
  slowStartupMs: 8000,
  pressure: 0.35,         // Vex's share of this machine's memory
});

const num = (v) => (Number.isFinite(v) ? v : 0);
const mb = (v) => Math.round(num(v));

function sleepable(row) {
  return (row.tabList || []).filter(t => t && !t.active && !t.audible && !t.sleeping && typeof t.id === 'string');
}

// metrics: see the header. → { recommendations, table }
function advise(metrics) {
  const m = metrics || {};
  const rows = Array.isArray(m.rows) ? m.rows : [];
  const jobs = Array.isArray(m.jobs) ? m.jobs : [];
  const recs = [];
  const used = new Set();   // a tab is recommended once

  // 1. Tabs worth sleeping: heavy, or hot while out of sight.
  for (const row of rows) {
    if (row.kind !== 'site') continue;
    const tabs = sleepable(row).filter(t => !used.has(t.id));
    if (!tabs.length) continue;
    const heavy = num(row.memMB) >= T.sleepMemMB;
    const hot = num(row.cpuPct) >= T.hotCpuPct;
    if (!heavy && !hot) continue;
    tabs.forEach(t => used.add(t.id));
    const name = row.host || row.label || 'this site';
    const why = [];
    if (heavy) why.push(mb(row.memMB) + ' MB of memory');
    if (hot) why.push(num(row.cpuPct).toFixed(1) + '% of a core while you are not looking at it');
    recs.push({
      id: 'sleep:' + (row.key || name),
      rule: 'sleep-tab',
      severity: heavy && mb(row.memMB) >= 800 ? 'high' : 'medium',
      title: 'Sleep ' + name + ' (' + mb(row.memMB) + ' MB)',
      detail: name + ' is using ' + why.join(' and ') + '. Sleeping it frees the memory; the tab wakes when you click it.',
      savesMB: row.shared ? Math.round(num(row.memMB) / 2) : mb(row.memMB),
      savesCpuPct: Math.round(num(row.cpuPct) * 10) / 10,
      action: { kind: 'sleep-tab', tabIds: tabs.map(t => t.id), label: name },
    });
  }

  // 2. On battery: the two switches Vex already has.
  if (m.onBattery === true && !m.gaming) {
    if (!m.batteryModeOn) {
      recs.push({
        id: 'battery-mode', rule: 'battery-mode', severity: 'medium',
        title: 'Turn on battery mode',
        detail: 'This PC is on its battery. Battery mode puts idle tabs to sleep sooner and holds background jobs until it is plugged in.',
        savesMB: 0, savesCpuPct: 0, action: { kind: 'battery-mode-on' },
      });
    }
    if (!m.reduceMotionOn) {
      recs.push({
        id: 'animations-battery', rule: 'animations', severity: 'low',
        title: 'Turn off animations on battery',
        detail: 'Vex’s own animations keep the graphics chip awake. Reduced motion stops them; switch it back in Settings any time.',
        savesMB: 0, savesCpuPct: 0, action: { kind: 'reduce-motion-on' },
      });
    }
  }

  // 3. Features: a background job that takes a real share of the interface thread.
  for (const j of jobs) {
    const span = num(j.spanMs);
    if (span <= 0) continue;
    const pct = (num(j.totalMs) / span) * 100;
    if (pct < T.jobCpuPct) continue;
    const f = featureOf(String(j.name || ''));
    const label = f ? f.feature : String(j.name || 'A background job');
    if (f && f.action.kind === 'recall-off' && m.recallOn === false) continue;
    recs.push({
      id: 'job:' + j.name, rule: 'feature-cost', severity: pct >= 5 ? 'high' : 'medium',
      title: f ? 'Turn off ' + label + ' (cost ' + pct.toFixed(1) + '% CPU)' : label + ' uses ' + pct.toFixed(1) + '% of the interface thread',
      detail: '"' + j.name + '" ran ' + num(j.runs) + ' time' + (num(j.runs) === 1 ? '' : 's') + ' and kept the interface busy for ' + (num(j.totalMs) / 1000).toFixed(1) + ' s over ' + Math.round(span / 60000) + ' min.' + (f ? '' : ' It has no single off switch, so this is information only.'),
      savesMB: 0, savesCpuPct: Math.round(pct * 10) / 10,
      action: f ? { ...f.action, label } : null,
    });
  }

  // 4. Extensions: no safe undoable switch here, so they are named, not changed.
  for (const row of rows) {
    if (row.kind !== 'extension') continue;
    if (num(row.cpuPct) < T.extCpuPct && num(row.memMB) < T.extMemMB) continue;
    recs.push({
      id: 'ext:' + (row.key || row.label), rule: 'extension-cost', severity: 'low',
      title: (row.label || 'An extension') + ' costs ' + mb(row.memMB) + ' MB and ' + num(row.cpuPct).toFixed(1) + '% CPU',
      detail: 'Disable it in Settings › Extensions if you do not need it right now. Vex will not turn an extension off for you.',
      savesMB: mb(row.memMB), savesCpuPct: Math.round(num(row.cpuPct) * 10) / 10, action: null,
    });
  }

  // 5. Startup and overall pressure: information.
  if (m.startup && num(m.startup.ms) >= T.slowStartupMs) {
    recs.push({
      id: 'startup', rule: 'startup', severity: 'low',
      title: 'Vex took ' + (num(m.startup.ms) / 1000).toFixed(1) + ' s to appear',
      detail: 'Many restored tabs, extensions and a busy disk all add to it. Fewer pinned tabs or sleeping groups at start helps.',
      savesMB: 0, savesCpuPct: 0, action: null,
    });
  }
  const machine = num(m.machineMemMB);
  if (machine > 0 && num(m.totals && m.totals.memMB) / machine >= T.pressure && !recs.some(r => r.rule === 'sleep-tab')) {
    recs.push({
      id: 'pressure', rule: 'pressure', severity: 'medium',
      title: 'Vex holds ' + Math.round(100 * num(m.totals.memMB) / machine) + '% of this PC’s memory',
      detail: 'No single tab stands out. Closing tabs you are done with is the biggest lever.',
      savesMB: 0, savesCpuPct: 0, action: null,
    });
  }

  const rank = { high: 0, medium: 1, low: 2 };
  recs.sort((a, b) => (rank[a.severity] - rank[b.severity]) || (b.savesMB - a.savesMB) || (b.savesCpuPct - a.savesCpuPct));
  return { recommendations: recs, table: buildTable(m) };
}

// The cost table the panel shows: one line per site, panel, extension, job.
function buildTable(m) {
  const rows = (Array.isArray(m.rows) ? m.rows : []).map(r => ({
    kind: r.kind, name: r.kind === 'private' ? 'Private and Tor tabs' : (r.host || r.label || 'unnamed'),
    memMB: mb(r.memMB), cpuPct: Math.round(num(r.cpuPct) * 10) / 10, tabs: r.tabList ? r.tabList.length : 0, shared: !!r.shared,
  })).sort((a, b) => (b.memMB - a.memMB) || (b.cpuPct - a.cpuPct));
  const jobs = (Array.isArray(m.jobs) ? m.jobs : []).filter(j => num(j.spanMs) > 0).map(j => ({
    name: String(j.name), runs: num(j.runs), totalMs: Math.round(num(j.totalMs)), maxMs: Math.round(num(j.maxMs)),
    pct: Math.round((num(j.totalMs) / num(j.spanMs)) * 1000) / 10,
  })).sort((a, b) => b.totalMs - a.totalMs);
  return { rows, jobs, totals: { memMB: mb(m.totals && m.totals.memMB), cpuPct: Math.round(num(m.totals && m.totals.cpuPct) * 10) / 10 }, startupMs: m.startup ? mb(m.startup.ms) : null };
}

// ---- stored samples ---------------------------------------------------------

// A sample is only names and numbers: hosts, panel and extension names. No
// address, no title, nothing from a private or Tor tab.
function toSample(metrics, now) {
  const m = metrics || {};
  const top = (Array.isArray(m.rows) ? m.rows : [])
    .filter(r => r.kind !== 'private' && r.kind !== 'unknown')
    .map(r => ({ k: String(r.kind).slice(0, 12) + ':' + String(r.host || r.label || '').slice(0, 60), mem: mb(r.memMB), cpu: Math.round(num(r.cpuPct) * 10) / 10 }))
    .sort((a, b) => (b.mem - a.mem) || (b.cpu - a.cpu)).slice(0, 12);
  const jobs = (Array.isArray(m.jobs) ? m.jobs : []).filter(j => num(j.spanMs) > 0)
    .map(j => ({ n: String(j.name).slice(0, 60), pct: Math.round((num(j.totalMs) / num(j.spanMs)) * 1000) / 10 }))
    .sort((a, b) => b.pct - a.pct).slice(0, 8);
  return {
    ts: now, mem: mb(m.totals && m.totals.memMB), cpu: Math.round(num(m.totals && m.totals.cpuPct) * 10) / 10,
    startup: m.startup ? mb(m.startup.ms) : null, top, jobs,
  };
}

const HOUR = 3600 * 1000;
// Compare what the last two hours cost with what the same entities cost about
// a day ago (the samples from 18 to 30 hours back).
function compareSamples(samples, now) {
  const list = Array.isArray(samples) ? samples : [];
  const recent = list.filter(s => s.ts >= now - 2 * HOUR);
  const base = list.filter(s => s.ts >= now - 30 * HOUR && s.ts <= now - 18 * HOUR);
  if (!recent.length || !base.length) {
    return { haveBaseline: false, summary: recent.length ? 'Not enough history yet. Vex needs samples from about a day ago to compare.' : 'No recent samples yet.', items: [] };
  }
  const avg = (arr, f) => arr.reduce((s, x) => s + f(x), 0) / arr.length;
  const totals = {
    memFrom: Math.round(avg(base, s => s.mem)), memTo: Math.round(avg(recent, s => s.mem)),
    cpuFrom: Math.round(avg(base, s => s.cpu) * 10) / 10, cpuTo: Math.round(avg(recent, s => s.cpu) * 10) / 10,
  };
  const startups = (arr) => arr.map(s => s.startup).filter(Number.isFinite);
  const sb = startups(base), sr = startups(recent);
  const startup = sb.length && sr.length ? { from: Math.round(avg(sb, x => x)), to: Math.round(avg(sr, x => x)) } : null;

  const collect = (arr) => {
    const acc = new Map();
    for (const s of arr) for (const e of s.top || []) {
      const a = acc.get(e.k) || { mem: 0, cpu: 0, n: 0 };
      a.mem += e.mem; a.cpu += e.cpu; a.n++;
      acc.set(e.k, a);
    }
    for (const a of acc.values()) { a.mem /= arr.length; a.cpu /= arr.length; }   // absent = 0 in a sample
    return acc;
  };
  const A = collect(base), B = collect(recent);
  const items = [];
  for (const [k, b] of B) {
    const a = A.get(k) || { mem: 0, cpu: 0 };
    const dMem = Math.round(b.mem - a.mem), dCpu = Math.round((b.cpu - a.cpu) * 10) / 10;
    const memUp = dMem >= 100 || (dMem >= 50 && a.mem > 0 && b.mem >= a.mem * 1.5);
    const cpuUp = dCpu >= 2;
    if (!memUp && !cpuUp) continue;
    const name = k.slice(k.indexOf(':') + 1) || k;
    items.push({ key: k, name, kind: k.slice(0, k.indexOf(':')), memFrom: Math.round(a.mem), memTo: Math.round(b.mem), dMem, cpuFrom: Math.round(a.cpu * 10) / 10, cpuTo: Math.round(b.cpu * 10) / 10, dCpu, isNew: !A.has(k) });
  }
  // Jobs that grew.
  const jobAvg = (arr) => {
    const acc = new Map();
    for (const s of arr) for (const j of s.jobs || []) acc.set(j.n, (acc.get(j.n) || 0) + j.pct);
    for (const [k, v] of acc) acc.set(k, v / arr.length);
    return acc;
  };
  const JA = jobAvg(base), JB = jobAvg(recent);
  for (const [n, p] of JB) {
    const d = Math.round((p - (JA.get(n) || 0)) * 10) / 10;
    if (d >= 1) items.push({ key: 'job:' + n, name: n, kind: 'job', cpuFrom: Math.round((JA.get(n) || 0) * 10) / 10, cpuTo: Math.round(p * 10) / 10, dCpu: d, dMem: 0, memFrom: 0, memTo: 0, isNew: !JA.has(n) });
  }
  items.sort((x, y) => (y.dMem - x.dMem) || (y.dCpu - x.dCpu));
  const dMemTotal = totals.memTo - totals.memFrom;
  let summary;
  if (!items.length && Math.abs(dMemTotal) < 100) summary = 'Nothing has slowed Vex down since yesterday.';
  else if (items.length) summary = items.length + ' thing' + (items.length === 1 ? '' : 's') + ' cost more than at this time yesterday; the biggest is ' + items[0].name + '.';
  else summary = 'Overall memory is ' + (dMemTotal > 0 ? 'up ' : 'down ') + Math.abs(dMemTotal) + ' MB, with no single cause.';
  return { haveBaseline: true, summary, totals, startup, items: items.slice(0, 12) };
}

function createSampleStore({ dir, now = () => Date.now(), maxSamples = 600, keepDays = 14, minGapMs = 10 * 60 * 1000 } = {}) {
  if (!dir) throw new TypeError('createSampleStore: dir is required');
  const file = path.join(dir, 'tuning-samples.json');
  let samples = null;
  let chain = Promise.resolve();
  const enqueue = (fn) => { const run = chain.then(fn, fn); chain = run.catch(() => {}); return run; };
  async function load() {
    if (samples) return samples;
    samples = [];
    try {
      const j = JSON.parse(await fs.promises.readFile(file, 'utf8'));
      if (Array.isArray(j)) samples = j.filter(s => s && Number.isFinite(s.ts));
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
    return samples;
  }
  async function save() {
    await fs.promises.mkdir(dir, { recursive: true });
    const tmp = file + '.tmp';
    await fs.promises.writeFile(tmp, JSON.stringify(samples));
    await fs.promises.rename(tmp, file);
  }
  return {
    add: (metrics) => enqueue(async () => {
      const list = await load();
      const t = now();
      const last = list[list.length - 1];
      if (last && t - last.ts < minGapMs) return { stored: false, count: list.length };
      list.push(toSample(metrics, t));
      const cutoff = t - keepDays * 24 * HOUR;
      while (list.length && list[0].ts < cutoff) list.shift();
      while (list.length > maxSamples) list.shift();
      await save();
      return { stored: true, count: list.length };
    }),
    compare: () => enqueue(async () => compareSamples(await load(), now())),
    all: () => enqueue(async () => (await load()).slice()),
    forget: () => enqueue(async () => { samples = []; await fs.promises.rm(file, { force: true }); }),
  };
}

// Running an action is the interface's job (js/tuning-advisor-ui.js runAction):
// it needs the live tabs and settings, and asks first.
module.exports = { advise, buildTable, toSample, compareSamples, createSampleStore, ACTION_KINDS, JOB_FEATURES, THRESHOLDS: T };
