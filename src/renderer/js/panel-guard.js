// === Per-panel CPU guard during a game (T3-024) ==============================
//
// A game wants every bit of the processor. Vex's side panels (a music site, a chat, a
// dashboard) are web pages, and now and then one of them burns a core in the
// background. While a game runs, this watches what Vex's OWN panels cost (the tab-cost
// ledger, js/tab-cost.js: Electron's per-process figures for Vex's own processes),
// and puts the heaviest hidden panel to sleep when it stays above a limit. It says so
// once, when the game ends, and the ledger ("Why did that happen?") has an Undo that
// opens the panel again.
//
// Two ways to hold a hot panel back, your choice (Settings):
//
//   sleep      the panel page is closed until you open it (the default, as before)
//   throttle   the panel stays loaded but its own process is set to the lowest priority
//              (main/panel-throttle.js), so it yields to the game; Undo (and the end of
//              the game) puts the priority back. Refused for a process that any other
//              page shares. Panels you keep awake can be throttled too (never one in a
//              call or making sound); they are not slept.
//
// A graphics figure is shown as well: Vex's graphics process, the one process that
// draws every page. Electron reports it for that process only, not per panel, so the
// figure sits beside the panel's processor figure and is never divided among panels.
//
// Hard limits, by construction:
//   - it only ever reads Vex's own process list and only ever sleeps a Vex panel
//     (SidebarManager.sleepPanel); it never looks at, signals or changes any other
//     program, and never a game;
//   - a panel that is open, in a call or making sound (panelBusy), or that you keep
//     awake (Discord by default), is never slept;
//   - at most MAX_PER_GAME panels per game, and only after the panel has been above
//     the limit for most of a full minute of samples;
//   - OFF until switched on.
// What picks a panel is the processor figure. Electron reports no graphics use per panel,
// so none is guessed. Checked again for Wave 6 against Electron 42's ProcessMetric (app.getAppMetrics): it has cpu,
// memory, pid and type, no graphics field, and Chromium draws every page in the one GPU process, so a per-panel figure
// cannot be read from the process list or from a process id mapping either (tests/main/electronGpuMetric.test.js fails
// the day Electron adds one).
//
// It samples on its own timer chain, not VexJobs: VexJobs holds every job while a game
// runs, and a game is exactly when this is wanted (as the memory guard does).
const VexPanelGuard = {
  KEYS: { on: 'vex.panelGuard.enabled', prefs: 'vex.panelGuard.prefs' },
  FEATURE: 'panel-guard',
  DEFAULTS: { cpuPct: 15, action: 'sleep' },   // % of one core, averaged over the sample window; sleep | throttle
  ACTIONS: ['sleep', 'throttle'],
  STEP_MS: 30 * 1000,
  MIN_SPAN_MS: 60 * 1000,          // do not judge on less than a minute of samples
  MAX_PER_GAME: 2,
  _timer: null,
  _gameName: '',
  slept: [],                       // this game's, for the summary: { name, label, cpuPct, at, action, gpu }

  enabled() { return VexMediaKit.flag(this.KEYS.on, false); },
  setEnabled(on) {
    VexMediaKit.setFlag(this.KEYS.on, !!on);
    if (!on) this._stopLoop();
    else if (VexMediaKit.gaming()) this._startLoop();
  },
  prefs() {
    const v = VexMediaKit.read(this.KEYS.prefs, null);
    const out = { ...this.DEFAULTS };
    if (v && typeof v === 'object' && Number.isFinite(v.cpuPct) && v.cpuPct >= 3 && v.cpuPct <= 90) out.cpuPct = v.cpuPct;
    if (v && typeof v === 'object' && this.ACTIONS.includes(v.action)) out.action = v.action;
    return out;
  },
  setLimit(pct) {
    const n = Number(pct);
    if (!Number.isFinite(n) || n < 3 || n > 90) throw new Error('The limit is 3 to 90 percent of one processor core');
    VexMediaKit.write(this.KEYS.prefs, { ...this.prefs(), cpuPct: n });
  },
  setAction(action) {
    if (!this.ACTIONS.includes(action)) throw new Error('The panel guard sleeps a panel or throttles it');
    VexMediaKit.write(this.KEYS.prefs, { ...this.prefs(), action });
  },

  // ---- the graphics figure -----------------------------------------------------------------
  // Vex's graphics process right now: { cpuPct, memMB }. One process draws every page, so this
  // is not a per-panel number. Throws when the process list cannot be read.
  async gpu() {
    if (!window.vex || typeof window.vex.processes !== 'function') throw new Error('The process list is not available in this window');
    const got = await window.vex.processes();
    const rows = (Array.isArray(got) ? got : (got && got.processes) || []).filter(p => p && p.type === 'GPU');
    if (!rows.length) throw new Error('Vex has no graphics process to measure right now');
    return { cpuPct: Math.round(rows.reduce((n, p) => n + (p.cpu || 0), 0) * 10) / 10, memMB: Math.round(rows.reduce((n, p) => n + (p.memKB || 0), 0) / 1024) };
  },

  // ---- pure: which panel, if any ---------------------------------------------------------
  // rows: TabCost snapshot rows. keep: panel names that must not be slept. → a row or null.
  pick(rows, { cpuPct, keep = [], already = [] }) {
    const list = (rows || [])
      .filter(r => r && r.kind === 'panel' && typeof r.key === 'string' && r.cpuPct >= cpuPct)
      .filter(r => { const n = r.key.replace(/^panel:/, ''); return !keep.includes(n) && !already.includes(n); })
      .sort((a, b) => b.cpuPct - a.cpuPct);
    return list[0] || null;
  },
  // Panels that must stay: the open ones, those kept awake, those in use.
  // Throttling leaves a panel loaded, so a panel you keep awake may be throttled; sleeping may not touch it.
  _keep(action = 'sleep') {
    if (typeof SidebarManager === 'undefined') throw new Error('The sidebar is not available in this window');
    const keep = new Set([SidebarManager.activePanel, SidebarManager.sidePanel].filter(Boolean));
    const prefs = SidebarManager.panelSleepPrefs ? SidebarManager.panelSleepPrefs() : { exempt: [] };
    if (action !== 'throttle') for (const n of prefs.exempt || []) keep.add(n);
    for (const n of Object.keys(SidebarManager.panelWebviews || {})) if (SidebarManager.panelBusy(n)) keep.add(n);
    return [...keep];
  },

  // ---- one look ----------------------------------------------------------------------------
  async step() {
    if (!this.enabled() || !VexMediaKit.gaming()) return null;
    if (typeof TabCost === 'undefined') throw new Error('The cost ledger is not available in this window');
    if (this.slept.length >= this.MAX_PER_GAME) return null;
    await TabCost.sample({ minGapMs: this.STEP_MS - 5000 });
    const snap = TabCost.snapshot();
    if (!snap.cpuMeasured || snap.spanMs < this.MIN_SPAN_MS) return null;
    const action = this.prefs().action;
    const row = this.pick(snap.rows, { cpuPct: this.prefs().cpuPct, keep: this._keep(action), already: this.slept.map(s => s.name) });
    if (!row) return null;
    const name = row.key.replace(/^panel:/, '');
    const label = row.label || (SidebarManager.panelLabel ? SidebarManager.panelLabel(name) : name);
    let gpu = null;
    try { gpu = await this.gpu(); } catch (err) { VexMediaKit.problem('Panel guard', 'The graphics figure could not be read', err); }
    if (action === 'throttle') await this.throttle(name, true);
    else await TabCost.act('sleep-panel', row);      // refuses a panel in use; the error is the answer
    const rec = { name, label, cpuPct: Math.round(row.cpuPct), at: Date.now(), action, gpu };
    this.slept.push(rec);
    if (typeof VexLedger !== 'undefined') {
      VexLedger.note({
        feature: this.FEATURE, what: (action === 'throttle' ? 'Lowered the priority of the ' + label + ' panel during a game' : 'Put the ' + label + ' panel to sleep during a game'),
        why: 'It used about ' + rec.cpuPct + '% of one processor core for a minute while ' + (this._gameName || 'a game') + ' was running (your limit is ' + this.prefs().cpuPct + '%)'
          + (gpu ? '. Vex\'s graphics process was at ' + gpu.cpuPct + '% and ' + gpu.memMB + ' MB then (one process draws every page, so this is not the panel\'s own share)' : ''),
        undo: { kind: action === 'throttle' ? 'panel-guard-unthrottle' : 'panel-guard-open', panel: name },
      });
    }
    return rec;
  },
  // Lower (on) or put back (off) the priority of the process behind one panel.
  async throttle(name, on) {
    if (typeof SidebarManager === 'undefined') throw new Error('The sidebar is not available in this window');
    if (!window.vex || typeof window.vex.throttlePanel !== 'function') throw new Error('Throttling is not available in this window');
    const wv = SidebarManager.panelWebviews[name];
    if (!wv) {
      if (on) throw new Error('That panel is not loaded');
      return false;          // gone already: nothing to put back
    }
    await window.vex.throttlePanel(wv.getWebContentsId(), !!on);
    return true;
  },
  async _unthrottleAll() {
    for (const s of this.slept.filter(x => x.action === 'throttle')) {
      try { await this.throttle(s.name, false); }
      catch (err) { VexMediaKit.problem('Panel guard', 'The priority of the ' + s.label + ' panel could not be put back', err); }
    }
  },
  _loop() {
    this._timer = null;
    if (!this.enabled() || !VexMediaKit.gaming()) return;
    this.step()
      .catch((err) => VexMediaKit.problem('Panel guard', 'A look at the panels failed', err))
      .finally(() => { if (this.enabled() && VexMediaKit.gaming() && !this._timer) this._timer = setTimeout(() => this._loop(), this.STEP_MS); });
  },
  _startLoop() { if (!this._timer) this._timer = setTimeout(() => this._loop(), this.STEP_MS); },
  _stopLoop() { if (this._timer) { clearTimeout(this._timer); this._timer = null; } },

  onGame(detail) {
    if (detail && detail.active) {
      this.slept = [];
      this._gameName = String(detail.app || '').replace(/\.exe$/i, '');
      if (this.enabled()) this._startLoop();
      return;
    }
    this._stopLoop();
    // A throttled panel gets its priority back with the game's end; the summary is said once.
    this._unthrottleAll().then(() => this.report()).catch((err) => VexMediaKit.problem('Panel guard', 'Could not finish after the game', err));
  },
  // Said once, when the game is over.
  report() {
    const slept = this.slept;
    this.slept = [];
    if (!slept.length) return null;
    const text = slept.map(s => s.label + ' (' + s.cpuPct + '%)').join(', ');
    const throttled = slept.every(s => s.action === 'throttle');
    const msg = throttled
      ? 'During the game Vex slowed ' + text + ' down because ' + (slept.length === 1 ? 'it was' : 'they were') + ' using the processor. ' + (slept.length === 1 ? 'It runs' : 'They run') + ' at normal speed again now.'
      : 'During the game Vex put ' + text + ' to sleep because ' + (slept.length === 1 ? 'it was' : 'they were') + ' using the processor. Open ' + (slept.length === 1 ? 'it' : 'one') + ' to wake it.';
    const show = () => VexMediaKit.toast(msg, 'info', 12000);
    if (typeof VexAttention !== 'undefined') VexAttention.notify({ feature: this.FEATURE, urgency: 'useful', id: vexId('r'), title: msg }, show);
    else show();
    return msg;
  },

  render(body) {
    const K = VexMediaKit;
    body.textContent = '';
    body.appendChild(K.info('While a game runs, a Vex side panel that keeps using the processor in the background is put to sleep, and you are told when the game ends. It only ever touches Vex\'s own panels, never a game or any other program, and never a panel you have open, are in a call on, or keep awake.'));
    body.appendChild(K.switchRow('Per-panel processor guard', this.enabled(), (on) => this.setEnabled(on)));
    const limit = K.input('Processor limit, percent of one core', { type: 'number', value: String(this.prefs().cpuPct), max: 3 });
    limit.min = '3'; limit.max = '90';
    limit.addEventListener('change', () => { try { this.setLimit(limit.value); } catch (err) { K.fail(err); limit.value = String(this.prefs().cpuPct); } });
    body.appendChild(K.row('Hold a panel back above this (percent of one core)', limit));
    const act = document.createElement('select');
    act.setAttribute('aria-label', 'What to do with a hot panel');
    for (const [v, t] of [['sleep', 'Put it to sleep'], ['throttle', 'Slow it down (keep it loaded)']]) { const o = document.createElement('option'); o.value = v; o.textContent = t; act.appendChild(o); }
    act.value = this.prefs().action;
    act.addEventListener('change', () => { try { this.setAction(act.value); } catch (err) { K.fail(err); act.value = this.prefs().action; } });
    body.appendChild(K.row('When a panel is over the limit', act));
    const gpuLine = K.info('Graphics process: not read yet.');
    body.appendChild(gpuLine);
    body.appendChild(K.button('Read the graphics figure now', () => this.gpu().then((g) => { gpuLine.textContent = 'Graphics process: ' + g.cpuPct + '% of one core, ' + g.memMB + ' MB. One process draws every page, so this is not split by panel.'; }).catch((err) => K.fail(err))));
  },
  init() {
    if (this._wired) return false;
    this._wired = true;
    document.addEventListener('vex:game-mode', (e) => {
      try { this.onGame(e.detail); } catch (err) { VexMediaKit.problem('Panel guard', 'Could not follow the game', err); }
    });
    if (typeof VexLedger !== 'undefined') {
      VexLedger.registerUndo('panel-guard-open', async (token) => {
        if (typeof SidebarManager === 'undefined') throw new Error('The sidebar is not available in this window');
        SidebarManager.openPanel(String(token.panel));
        return 'Opened the panel';
      });
      VexLedger.registerUndo('panel-guard-unthrottle', async (token) => {
        const did = await this.throttle(String(token.panel), false);
        return did ? 'The panel runs at normal speed again' : 'The panel was already closed';
      });
    }
    // A game that was already running when Vex started.
    if (VexMediaKit.gaming() && this.enabled()) this._startLoop();
    VexMediaKit.register({ id: 'panel-guard', title: 'Per-panel processor guard', keywords: 'game panel cpu gpu sleep throttle processor', render: (b) => this.render(b) });
    return true;
  },
};

if (typeof window !== 'undefined') window.VexPanelGuard = VexPanelGuard;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexPanelGuard };
