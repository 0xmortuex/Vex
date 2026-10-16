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
// Hard limits, by construction:
//   - it only ever reads Vex's own process list and only ever sleeps a Vex panel
//     (SidebarManager.sleepPanel); it never looks at, signals or changes any other
//     program, and never a game;
//   - a panel that is open, in a call or making sound (panelBusy), or that you keep
//     awake (Discord by default), is never slept;
//   - at most MAX_PER_GAME panels per game, and only after the panel has been above
//     the limit for most of a full minute of samples;
//   - OFF until switched on.
// Only the processor is measured. Electron reports no graphics-card use per panel, so
// there is no GPU figure and none is guessed.
//
// It samples on its own timer chain, not VexJobs: VexJobs holds every job while a game
// runs, and a game is exactly when this is wanted (as the memory guard does).
const VexPanelGuard = {
  KEYS: { on: 'vex.panelGuard.enabled', prefs: 'vex.panelGuard.prefs' },
  FEATURE: 'panel-guard',
  DEFAULTS: { cpuPct: 15 },        // % of one core, averaged over the sample window
  STEP_MS: 30 * 1000,
  MIN_SPAN_MS: 60 * 1000,          // do not judge on less than a minute of samples
  MAX_PER_GAME: 2,
  _timer: null,
  _gameName: '',
  slept: [],                       // this game's, for the summary

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
    return out;
  },
  setLimit(pct) {
    const n = Number(pct);
    if (!Number.isFinite(n) || n < 3 || n > 90) throw new Error('The limit is 3 to 90 percent of one processor core');
    VexMediaKit.write(this.KEYS.prefs, { cpuPct: n });
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
  _keep() {
    if (typeof SidebarManager === 'undefined') throw new Error('The sidebar is not available in this window');
    const keep = new Set([SidebarManager.activePanel, SidebarManager.sidePanel].filter(Boolean));
    const prefs = SidebarManager.panelSleepPrefs ? SidebarManager.panelSleepPrefs() : { exempt: [] };
    for (const n of prefs.exempt || []) keep.add(n);
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
    const row = this.pick(snap.rows, { cpuPct: this.prefs().cpuPct, keep: this._keep(), already: this.slept.map(s => s.name) });
    if (!row) return null;
    const name = row.key.replace(/^panel:/, '');
    const label = row.label || (SidebarManager.panelLabel ? SidebarManager.panelLabel(name) : name);
    await TabCost.act('sleep-panel', row);      // refuses a panel in use; the error is the answer
    const rec = { name, label, cpuPct: Math.round(row.cpuPct), at: Date.now() };
    this.slept.push(rec);
    if (typeof VexLedger !== 'undefined') {
      VexLedger.note({
        feature: this.FEATURE, what: 'Put the ' + label + ' panel to sleep during a game',
        why: 'It used about ' + rec.cpuPct + '% of one processor core for a minute while ' + (this._gameName || 'a game') + ' was running (your limit is ' + this.prefs().cpuPct + '%)',
        undo: { kind: 'panel-guard-open', panel: name },
      });
    }
    return rec;
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
    this.report();
  },
  // Said once, when the game is over.
  report() {
    const slept = this.slept;
    this.slept = [];
    if (!slept.length) return null;
    const text = slept.map(s => s.label + ' (' + s.cpuPct + '%)').join(', ');
    const msg = 'During the game Vex put ' + text + ' to sleep because ' + (slept.length === 1 ? 'it was' : 'they were') + ' using the processor. Open ' + (slept.length === 1 ? 'it' : 'one') + ' to wake it.';
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
    body.appendChild(K.row('Sleep a panel above this (percent of one core)', limit));
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
    }
    // A game that was already running when Vex started.
    if (VexMediaKit.gaming() && this.enabled()) this._startLoop();
    VexMediaKit.register({ id: 'panel-guard', title: 'Per-panel processor guard', keywords: 'game panel cpu gpu sleep throttle processor', render: (b) => this.render(b) });
    return true;
  },
};

if (typeof window !== 'undefined') window.VexPanelGuard = VexPanelGuard;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexPanelGuard };
