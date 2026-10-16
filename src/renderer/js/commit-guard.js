// === Commit-charge guard: the part that sheds Vex's own load (T0-018) =========
//
// main/commit-guard.js watches Windows' commit headroom and tells us when it
// gets short ('commit:pressure'). While Game mode is on and it is short, Vex
// gives back what is Vex's to give, in this order:
//
//   1. its own background tabs and hidden panels go to sleep (never the tab in
//      front, a pinned tab, one kept awake, one playing sound or on a call; and
//      only when sleeping is allowed at all: Game mode's own consent or the
//      "gaming" auto-sleep answer);
//   2. its own AI model is unloaded (ModelManager.freeGpu: Ollama's loaded
//      models, which hold RAM as well as video memory);
//   3. its own background work waits (VexJobs, background AI and the holds Game
//      mode already has are kept on whatever the other switches say).
//
// It never closes, pauses, lowers or asks anything of a program that is not Vex.
// Nothing is announced over the game: main shows ONE Windows notification when
// the headroom is critical; the rest is said when the game ends.
const CommitGuard = {
  KEY: 'vex.game.commitGuard',   // 'off' turns it off (Settings > Game mode, and Minimal Vex)
  REPEAT_MS: 30000,              // while short, look again for tabs that woke

  level: 'ok',
  _report: null,                 // what this stretch of pressure shed
  _last: null,                   // the newest { availMB, limitMB, usedMB }
  _timer: null,
  _wired: false,

  enabled() { try { return localStorage.getItem(this.KEY) !== 'off'; } catch { return true; } },
  setEnabled(on) { localStorage.setItem(this.KEY, on ? 'on' : 'off'); },

  _gaming() {
    return (typeof GameMode !== 'undefined' && !!GameMode.gaming) || (typeof GameSession !== 'undefined' && !!GameSession.active);
  },
  // Read by VexJobs and the AI hold: background work waits while we are short.
  holding() { return this.enabled() && this.level !== 'ok' && this._gaming(); },

  _note(what, err) { window.VexProblems?.note('Commit guard', what, err); },

  // The tabs that may be put to sleep now. Same protections as Game mode's own.
  _sleepable() {
    if (typeof TabManager === 'undefined') return [];
    const modeSaidYes = typeof GameSession !== 'undefined' && GameSession.sleepAllowed();
    return (TabManager.tabs || []).filter((tab) => {
      if (tab.id === TabManager.activeTabId || tab.sleeping) return false;
      if (tab.pinned) return false;
      if (tab.audible && !tab.muted) return false;
      if (TabManager.isCapturing && TabManager.isCapturing(tab)) return false;
      return modeSaidYes || this._mayAutoSleep();
    });
  },
  _mayAutoSleep() {
    return (typeof GameSession !== 'undefined' && GameSession.sleepAllowed())
      || (typeof SleepConsent !== 'undefined' && SleepConsent.modeFor('gaming') === 'auto');
  },

  async shed(p) {
    const r = this._report || (this._report = { at: Date.now(), slept: 0, sleptIds: [], panels: 0, freedMB: 0, models: [], tabsLeft: false, worst: p });
    if (p.availMB < r.worst.availMB) r.worst = p;
    if (!this._mayAutoSleep()) r.tabsLeft = true;
    for (const tab of this._sleepable()) {
      try {
        await TabManager.sleepTab(tab.id);
        if (tab.sleeping) {
          r.slept++; r.sleptIds.push(tab.id);
          // Game mode wakes the tabs IT slept when the game ends; these too.
          if (typeof GameMode !== 'undefined' && GameMode._gamingReport && Array.isArray(GameMode._gamingReport.sleptIds)) GameMode._gamingReport.sleptIds.push(tab.id);
        }
      } catch (err) { this._note('Could not sleep a tab', err); }
    }
    if (this._mayAutoSleep() && typeof SidebarManager !== 'undefined' && SidebarManager.sleepHiddenPanels) {
      try { r.panels += (SidebarManager.sleepHiddenPanels() || []).length; }
      catch (err) { this._note('Could not sleep the panels', err); }
    }
    if (typeof ModelManager !== 'undefined' && ModelManager.freeGpu) {
      try { const f = await ModelManager.freeGpu(); r.freedMB += f.freed || 0; for (const m of (f.models || [])) if (!r.models.includes(m)) r.models.push(m); }
      catch (err) { this._note('Could not unload the AI model', err); }
    }
    return r;
  },

  async onPressure(p) {
    this.level = p.level;
    this._last = p;
    if (p.level === 'ok') { this._stopRepeat(); return null; }
    if (!this.enabled() || !this._gaming()) return null;
    const r = await this.shed(p);
    this._armRepeat();
    return r;
  },

  _armRepeat() {
    if (this._timer) return;
    this._timer = setInterval(() => {
      if (this.level === 'ok' || !this._gaming()) { this._stopRepeat(); return; }
      this.shed(this._last).catch(err => this._note('Could not shed load', err));
    }, this.REPEAT_MS);
  },
  _stopRepeat() { if (this._timer) clearInterval(this._timer); this._timer = null; },

  // The game ended: say what happened, once, now that someone is looking.
  onGameEnded() {
    this._stopRepeat();
    const r = this._report;
    this._report = null;
    if (!r) return null;
    const parts = [];
    if (r.slept) parts.push('slept ' + r.slept + ' tab' + (r.slept === 1 ? '' : 's'));
    if (r.panels) parts.push('slept ' + r.panels + ' panel' + (r.panels === 1 ? '' : 's'));
    if (r.models.length) parts.push('unloaded ' + (r.models.length === 1 ? 'the AI model' : 'the AI models'));
    parts.push('held its background work');
    const left = (r.worst.availMB / 1024).toFixed(1), limit = (r.worst.limitMB / 1024).toFixed(0);
    const msg = 'Windows was running short of memory while you played (down to ' + left + ' GB of ' + limit + ' GB left to promise), so Vex ' + parts.join(', ') + '.'
      + (r.tabsLeft ? ' Your tabs were left awake because sleeping them on its own is not allowed (Settings > Performance).' : '');
    window.showToast?.(msg, 'info', 15000);
    return msg;
  },

  async read() { return window.vex.commitState(); },

  init() {
    if (this._wired || !window.vex || typeof window.vex.onCommitPressure !== 'function') return false;
    this._wired = true;
    window.vex.onCommitPressure((p) => { this.onPressure(p).catch(err => this._note('Could not react to low memory', err)); });
    document.addEventListener('vex:game-mode', (e) => { if (e.detail && e.detail.active === false) this.onGameEnded(); });
    return true;
  },
};

if (typeof window !== 'undefined') {
  window.CommitGuard = CommitGuard;
  if (typeof document !== 'undefined') CommitGuard.init();
}
if (typeof module !== 'undefined' && module.exports) module.exports = { CommitGuard };
