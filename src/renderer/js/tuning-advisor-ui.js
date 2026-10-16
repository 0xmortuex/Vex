// === Tuning advisor: what slows Vex down, and one click to fix it ============
//
// The numbers already exist: TabCost (js/tab-cost.js) says what each site,
// panel and extension costs in memory and processor time; VexJobs (js/jobs.js)
// says how long each background job held the interface; main knows how long
// Vex took to appear. This gathers them, asks main for advice
// (src/main/tuning-advisor.js, a pure rule engine), and shows:
//
//   * the table: per site / panel / extension and per background job;
//   * recommendations, each with at most one action from a closed list:
//       sleep a site's tabs, battery mode, reduced motion, Recall off;
//   * "what slowed Vex down since yesterday", from a bounded history of
//     samples main keeps (names and numbers only, no addresses).
//
// Rules this keeps:
//   * nothing changes without a confirmation (runAction asks first);
//   * every action goes through an API Vex already has, and returns an undo;
//   * it never closes, kills or reads an operating-system process, and the
//     numbers are Vex's own processes only.
// Not in a private window; nothing is sampled while a game runs (main).
const TUNING_ACTION_KINDS = ['sleep-tab', 'battery-mode-on', 'reduce-motion-on', 'recall-off'];

// The only door an action goes through. `env` holds the existing APIs;
// `confirm` is vexConfirm. → { applied, undo? }.
async function tuningRunAction(action, { confirm: confirmFn, env }) {
  if (!action || !TUNING_ACTION_KINDS.includes(action.kind)) throw new Error('Unknown tuning action: ' + (action && action.kind));
  if (typeof confirmFn !== 'function') throw new Error('A tuning action needs a confirmation function');
  if (!env || typeof env !== 'object') throw new Error('A tuning action needs the environment');
  const need = (name) => { if (typeof env[name] !== 'function') throw new Error('Not available in this build: ' + name); return env[name]; };
  const ids = Array.isArray(action.tabIds) ? action.tabIds : [];
  const ask = {
    'sleep-tab': () => 'Put ' + ids.length + ' tab' + (ids.length === 1 ? '' : 's') + ' of ' + (action.label || 'this site') + ' to sleep? They wake when you click them.',
    'battery-mode-on': () => 'Turn on battery mode? Idle tabs sleep sooner and background jobs wait until the PC is plugged in.',
    'reduce-motion-on': () => 'Turn on reduced motion? Vex’s animations stop; you can turn it off in Settings.',
    'recall-off': () => 'Turn off ' + (action.label || 'Recall') + '? Pages are no longer indexed until you turn it back on.',
  }[action.kind]();
  const ok = await confirmFn({ title: 'Apply this change?', message: ask, okLabel: 'Apply' });
  if (!ok) return { applied: false };
  if (action.kind === 'sleep-tab') {
    const sleep = need('sleepTab'), wake = need('wakeTab');
    const done = [];
    // sleepTab refuses a tab that is in front, kept awake or in a split; only
    // the tabs that really slept are counted and woken by the undo.
    for (const id of ids) { if (await sleep(id)) done.push(id); }
    return { applied: true, count: done.length, undo: async () => { for (const id of done) await wake(id); } };
  }
  if (action.kind === 'battery-mode-on') {
    const was = !!need('batteryModeEnabled')();
    await need('setBatteryMode')(true);
    return { applied: true, undo: async () => { await env.setBatteryMode(was); } };
  }
  if (action.kind === 'reduce-motion-on') {
    const was = !!need('reduceMotionOn')();
    need('setReduceMotion')(true);
    return { applied: true, undo: async () => { env.setReduceMotion(was); } };
  }
  const was = !!need('recallEnabled')();
  need('setRecall')(false);
  return { applied: true, undo: async () => { env.setRecall(was); } };
}

const VexTuning = {
  // ---- gathering ---------------------------------------------------------------
  // snap: TabCost snapshot; jobs: VexJobs.timings(); extra: battery etc.
  // → the metrics object main's advise() takes. Pure.
  toMetrics(snap, jobs, extra = {}) {
    const rows = ((snap && snap.rows) || []).map(r => ({
      key: r.key, kind: r.kind, label: r.label, host: r.host || '',
      cpuPct: r.cpuPct || 0, memMB: r.memMB || 0, shared: !!r.shared,
      tabList: (r.kind === 'site' && Array.isArray(r.tabList))
        ? r.tabList.map(t => ({ id: t.id, title: t.title || '', active: !!t.active, audible: !!t.audible, muted: !!t.muted })) : [],
    }));
    return {
      rows,
      jobs: (jobs || []).map(j => ({ name: j.name, runs: j.runs, totalMs: j.totalMs, maxMs: j.maxMs, spanMs: j.spanMs })),
      totals: { memMB: rows.reduce((s, r) => s + r.memMB, 0), cpuPct: rows.reduce((s, r) => s + r.cpuPct, 0) },
      ...extra,
    };
  },

  async gather() {
    if (typeof TabCost === 'undefined') throw new Error('The cost ledger is not available in this build');
    await TabCost.sample();
    const snap = TabCost.snapshot();
    let onBattery = null, batteryModeOn = false;
    if (typeof BatteryMode !== 'undefined') {
      batteryModeOn = BatteryMode.enabled();
      onBattery = BatteryMode.hw && BatteryMode.hw.hasBattery ? !!BatteryMode.hw.onBattery : (BatteryMode.hw && BatteryMode.hw.hasBattery === false ? false : null);
    }
    return this.toMetrics(snap, typeof VexJobs !== 'undefined' && VexJobs.timings ? VexJobs.timings() : [], {
      onBattery, batteryModeOn,
      reduceMotionOn: typeof ReduceMotion !== 'undefined' ? ReduceMotion.on() : false,
      recallOn: typeof Recall !== 'undefined' ? Recall.enabled() : null,
    });
  },

  // The existing APIs the actions use.
  env() {
    return {
      sleepTab: async (id) => {
        if (typeof TabManager === 'undefined') throw new Error('Tabs are not available');
        await TabManager.sleepTab(id);
        const t = (TabManager.tabs || []).find(x => x.id === id);
        return !!(t && t.sleeping);
      },
      wakeTab: (id) => { if (typeof TabManager !== 'undefined') TabManager.wakeTab(id); },
      batteryModeEnabled: () => typeof BatteryMode !== 'undefined' && BatteryMode.enabled(),
      setBatteryMode: (on) => { if (typeof BatteryMode === 'undefined') throw new Error('Battery mode is not available'); return BatteryMode.setEnabled(on); },
      reduceMotionOn: () => typeof ReduceMotion !== 'undefined' && ReduceMotion.on(),
      setReduceMotion: (on) => { if (typeof ReduceMotion === 'undefined') throw new Error('Reduced motion is not available'); ReduceMotion.set(on); },
      recallEnabled: () => typeof Recall !== 'undefined' && Recall.enabled(),
      setRecall: (on) => { if (typeof Recall === 'undefined') throw new Error('Recall is not available'); Recall.setEnabled(on); },
    };
  },

  async advise() {
    if (!window.vex || typeof window.vex.tuningAdvise !== 'function') throw new Error('The tuning advisor is not available in this build');
    return window.vex.tuningAdvise(await this.gather());
  },

  // Brief-ready: the since-yesterday comparison as a short section.
  async briefSection() {
    if (!window.vex || typeof window.vex.tuningHistory !== 'function') return null;
    const c = await window.vex.tuningHistory();
    if (!c.haveBaseline || !c.items.length) return null;
    return { id: 'tuning', title: 'What slowed Vex down since yesterday', icon: 'activity', lines: [c.summary].concat(c.items.slice(0, 4).map(i => VexTuning.describeItem(i))) };
  },

  describeItem(i) {
    const parts = [];
    if (i.dMem >= 50) parts.push('+' + i.dMem + ' MB (' + i.memFrom + ' to ' + i.memTo + ')');
    if (i.dCpu >= 1) parts.push('+' + i.dCpu + '% CPU');
    return i.name + (i.isNew ? ' (new)' : '') + ': ' + parts.join(', ');
  },

  // ---- the panel ------------------------------------------------------------------
  _esc(s) { return window.escapeHtml ? window.escapeHtml(String(s == null ? '' : s)) : String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },
  _icon(name, size = 14) { return (typeof VexIcons !== 'undefined' && VexIcons.has(name)) ? VexIcons.svg(name, { size }) : ''; },

  _close() {
    if (this._onKey) { document.removeEventListener('keydown', this._onKey, true); this._onKey = null; }
    document.getElementById('vex-tuning')?.remove();
  },

  async open() {
    if (window.VexTabPolicy && window.VexTabPolicy.isPrivateWindow) { window.showToast?.('The tuning advisor is not available in a private window'); return; }
    this._close();
    const root = document.createElement('div');
    root.id = 'vex-tuning';
    root.className = 'vex-tt-overlay';
    root.innerHTML = '<div class="vex-tt-card" role="dialog" aria-modal="true" aria-label="Tuning advisor">'
      + '<div class="vex-tt-head"><span class="vex-tt-title">' + this._icon('activity', 16) + ' Tuning advisor</span>'
      + '<button class="vex-tt-btn" id="vex-tn-refresh">' + this._icon('refresh') + ' Measure again</button>'
      + '<button class="vex-tt-btn" id="vex-tn-close" aria-label="Close">' + this._icon('x') + '</button></div>'
      + '<div class="vex-tt-body" id="vex-tn-body"><div class="vex-tt-empty">Measuring…</div></div></div>';
    document.body.appendChild(root);
    root.addEventListener('click', (e) => { if (e.target === root) this._close(); });
    root.querySelector('#vex-tn-close').addEventListener('click', () => this._close());
    root.querySelector('#vex-tn-refresh').addEventListener('click', () => this._paint());
    this._onKey = (e) => {
      if (e.key !== 'Escape' || document.querySelector('.vex-dialog-overlay')) return;
      e.preventDefault(); e.stopPropagation(); this._close();
    };
    document.addEventListener('keydown', this._onKey, true);
    await this._paint();
  },

  // → html. Pure over VexCost.report() / VexBreaker.status(); empty when neither is loaded.
  budgetSection(e, report = (typeof VexCost !== 'undefined' ? VexCost.report() : []), tripped = (typeof VexBreaker !== 'undefined' ? VexBreaker.status().filter(s => s.state !== 'closed') : [])) {
    if (!report.length && !tripped.length) return '';
    const over = report.filter(r => r.over.length);
    const used = report.filter(r => r.totalMs || r.fetches || r.ipc || r.over.length).slice(0, 12);
    const off = tripped.map(t => '<div class="vex-tn-rec sev-medium"><div class="vex-tn-rec-main"><div class="vex-tn-rec-title">' + e(t.id) + ' is switched off for now</div><div class="vex-tn-rec-detail">' + e(t.reason || 'It failed repeatedly') + '</div></div></div>').join('');
    const overHtml = over.map(r => '<div class="vex-tn-rec sev-medium"><div class="vex-tn-rec-main"><div class="vex-tn-rec-title">' + e(r.title) + ' is over what it declared</div><div class="vex-tn-rec-detail">' + r.over.map(o => e(o.item + ': ' + o.used + ' against ' + o.budget + (o.unit ? ' ' + o.unit : ''))).join('; ') + '</div></div></div>').join('');
    const rows = used.map(r => '<tr><td>' + e(r.title) + '</td><td class="n">' + r.jobMsPerMin + ' ms/min</td><td class="n">' + r.fetchesLastHour + '/h</td><td class="n">' + r.gameFetches + '</td><td class="n">' + r.domNodes + '</td><td class="n">' + r.storageKB + ' KB</td></tr>').join('');
    return '<div class="vex-tt-h">What each feature costs, against what it declared</div>' + off + overHtml
      + (rows ? '<table class="vex-tn-table"><thead><tr><th>Feature</th><th>Timers</th><th>Requests</th><th>In a game</th><th>Elements</th><th>Storage</th></tr></thead><tbody>' + rows + '</tbody></table>'
        : '<div class="vex-tt-empty">Nothing has run long enough to measure yet. Nothing is over its budget.</div>');
  },

  async _paint() {
    const body = document.getElementById('vex-tn-body');
    if (!body) return;
    const e = (s) => this._esc(s);
    let res;
    try { res = await this.advise(); } catch (err) { console.error('[tuning]', err); body.innerHTML = '<div class="vex-tt-empty">Could not measure: ' + e(err.message) + '</div>'; return; }
    this._last = res;
    const recs = res.recommendations;
    const t = res.table;
    const cmp = res.comparison;
    const recHtml = recs.length ? recs.map((r, i) => '<div class="vex-tn-rec sev-' + e(r.severity) + '">'
      + '<div class="vex-tn-rec-main"><div class="vex-tn-rec-title">' + e(r.title) + '</div><div class="vex-tn-rec-detail">' + e(r.detail) + '</div></div>'
      + (r.action ? '<button class="vex-tt-btn primary" data-rec="' + i + '">Apply</button>' : '<span class="vex-tn-info">Information</span>') + '</div>').join('')
      : '<div class="vex-tt-empty">Nothing stands out. Vex is using its share quietly.</div>';
    const rowHtml = t.rows.slice(0, 25).map(r => '<tr><td>' + e(r.name) + '</td><td>' + e(r.kind) + '</td><td class="n">' + r.memMB + ' MB</td><td class="n">' + r.cpuPct + '%</td><td class="n">' + (r.tabs || '') + '</td></tr>').join('');
    const jobHtml = t.jobs.slice(0, 12).map(j => '<tr><td>' + e(j.name) + '</td><td class="n">' + j.runs + '</td><td class="n">' + (j.totalMs / 1000).toFixed(2) + ' s</td><td class="n">' + j.pct + '%</td></tr>').join('');
    // What each feature costs against what its manifest declared (js/vex-cost.js), and any
    // feature the breaker has switched off for a while (js/vex-breaker.js).
    const budgetHtml = this.budgetSection(e);
    const cmpHtml = cmp && cmp.haveBaseline
      ? '<div class="vex-tn-cmp"><strong>' + e(cmp.summary) + '</strong>' + (cmp.items.length ? '<ul>' + cmp.items.map(i => '<li>' + e(this.describeItem(i)) + '</li>').join('') + '</ul>' : '') + '</div>'
      : '<div class="vex-tn-cmp">' + e((cmp && cmp.summary) || '') + '</div>';
    body.innerHTML = '<div class="vex-tt-h">Since yesterday</div>' + cmpHtml
      + '<div class="vex-tt-h">Recommendations</div>' + recHtml
      + '<div class="vex-tt-h">Cost by site, panel and extension' + (t.startupMs ? ' · started in ' + (t.startupMs / 1000).toFixed(1) + ' s' : '') + '</div>'
      + '<table class="vex-tn-table"><thead><tr><th>Name</th><th>Kind</th><th>Memory</th><th>CPU</th><th>Tabs</th></tr></thead><tbody>' + (rowHtml || '<tr><td colspan="5">No measurements yet.</td></tr>') + '</tbody></table>'
      + budgetHtml
      + '<div class="vex-tt-h">Background jobs (time on the interface thread)</div>'
      + '<table class="vex-tn-table"><thead><tr><th>Job</th><th>Runs</th><th>Total</th><th>Share</th></tr></thead><tbody>' + (jobHtml || '<tr><td colspan="4">No jobs measured yet.</td></tr>') + '</tbody></table>'
      + '<div class="vex-tt-settings"><span>Samples hold names and numbers only.</span><button class="vex-tt-btn danger" id="vex-tn-forget">' + this._icon('trash') + ' Forget history</button></div>';
    body.querySelectorAll('[data-rec]').forEach(btn => btn.addEventListener('click', () => this.apply(recs[Number(btn.dataset.rec)]).catch(err => this._fail(err))));
    body.querySelector('#vex-tn-forget').addEventListener('click', async () => {
      try {
        const ok = await vexConfirm({ title: 'Forget the cost history?', message: 'The stored samples used for "since yesterday" are deleted.', okLabel: 'Forget', danger: true });
        if (!ok) return;
        await window.vex.tuningForget();
        await this._paint();
      } catch (err) { this._fail(err); }
    });
  },

  async apply(rec) {
    if (!rec || !rec.action) throw new Error('This recommendation has no action');
    const res = await tuningRunAction(rec.action, { confirm: vexConfirm, env: this.env() });
    if (!res.applied) return res;
    window.showToast?.('Done: ' + rec.title + (res.count === 0 ? ' (nothing could be changed)' : ''), 'info', 10000, res.undo ? { action: { label: 'Undo', run: () => res.undo().catch(err => this._fail(err)) } } : undefined);
    this._lastUndo = res.undo || null;
    await this._paint();
    return res;
  },

  _fail(err) {
    console.error('[tuning]', err);
    window.VexProblems?.note('Tuning advisor', 'Something went wrong', err);
    window.showToast?.('Tuning advisor: ' + (err && err.message ? err.message : err), 'error');
  },
};

if (typeof window !== 'undefined') window.VexTuning = VexTuning;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexTuning, tuningRunAction, TUNING_ACTION_KINDS };
