// === Daily one-minute challenge ===============================================
//
// One tiny idea a day. Skipping is fine and costs nothing: there is no streak,
// no "you missed yesterday", and a skipped day is simply a skipped day.
//
//   VexDailyChallenge.snapshot() -> { enabled, day, id, text, status, progress,
//                                     target, manual, reward, completedTotal }
//   VexDailyChallenge.complete()  manual challenges: "I did it"
//   VexDailyChallenge.skip()
//
// status: 'open' | 'done' | 'skipped'. Automatic challenges notice for
// themselves (tabs closed, commands used, a feature tried); the manual ones
// take the person's word.
const VexDailyChallenge = {
  KEY: 'vex.fun.challenge',

  POOL: [
    { id: 'close-tabs',   text: 'Close 5 tabs you no longer need.',        auto: 'tabs',     target: 5 },
    { id: 'try-feature',  text: 'Try one Vex feature you have not used.',   auto: 'feature',  target: 1 },
    { id: 'command-bar',  text: 'Use the command bar (Ctrl+K) 3 times.',    auto: 'commands', target: 3 },
    { id: 'clear-one',    text: 'Finish or delete one item on your task list.', manual: true, target: 1 },
    { id: 'look-away',    text: 'Look away from the screen for one minute.', manual: true, target: 1 },
    { id: 'pin-one',      text: 'Pin the one tab you use the most.',        manual: true, target: 1 },
  ],

  // The same challenge for the whole day, a different one the next.
  pickFor(day) {
    const [y, m, d] = day.split('-').map(Number);
    const n = Math.floor(Date.UTC(y, m - 1, d) / 86400000);
    return this.POOL[n % this.POOL.length];
  },

  _commandTotal() {
    const u = JSON.parse(localStorage.getItem('vex.commandUsage') || '{}') || {};
    return Object.values(u).reduce((t, v) => t + ((v && Number(v.n)) || 0), 0);
  },
  _unusedCount() {
    const F = globalThis.VexFeatures;
    return F && typeof F.unused === 'function' ? F.unused().length : 0;
  },

  _state() {
    const s = VexProgress.load(this.KEY, {});
    return Object.assign({ day: '', id: '', status: 'open', progress: 0, base: 0, total: 0 }, s);
  },

  // The record for today, made on first use. Only when the feature is on.
  _today() {
    const day = VexProgress.today();
    let s = this._state();
    if (s.day !== day) {
      const c = this.pickFor(day);
      s = { day, id: c.id, status: 'open', progress: 0, total: s.total || 0,
        base: c.auto === 'commands' ? this._commandTotal() : c.auto === 'feature' ? this._unusedCount() : 0 };
      VexProgress.save(this.KEY, s);
    }
    return s;
  },

  _def(id) {
    const c = this.POOL.find(p => p.id === id);
    if (!c) throw new Error('Unknown challenge: ' + id);
    return c;
  },

  _finish(s) {
    s.status = 'done';
    s.total = (s.total || 0) + 1;
    VexProgress.save(this.KEY, s);
    VexProgress.medal('challenge-first');
    if (s.total >= 7) VexProgress.medal('challenge-7');
    if (globalThis.VexLevels) globalThis.VexLevels.award('challenge');
    try { document.dispatchEvent(new CustomEvent('vex:challenge-changed')); } catch { /* no document */ }
  },

  // Re-reads an automatic challenge's progress and finishes it at the target.
  refresh() {
    if (!VexProgress.enabled('challenge')) return;
    const s = this._today();
    if (s.status !== 'open') return;
    const c = this._def(s.id);
    if (c.auto === 'commands') s.progress = Math.max(0, this._commandTotal() - s.base);
    else if (c.auto === 'feature') s.progress = Math.max(0, s.base - this._unusedCount());
    else if (c.auto !== 'tabs') return;
    if (s.progress >= c.target) { s.progress = c.target; this._finish(s); }
    else VexProgress.save(this.KEY, s);
  },

  _onTabClosed() {
    if (!VexProgress.enabled('challenge') || !VexProgress.allows('delight')) return;
    const s = this._today();
    if (s.status !== 'open' || this._def(s.id).auto !== 'tabs') return;
    s.progress += 1;
    if (s.progress >= this._def(s.id).target) this._finish(s);
    else VexProgress.save(this.KEY, s);
  },

  complete() {
    if (!VexProgress.enabled('challenge')) throw new Error('The daily challenge is off');
    const s = this._today();
    if (s.status !== 'open') throw new Error('Today\'s challenge is already ' + s.status);
    if (!this._def(s.id).manual) throw new Error('This challenge notices by itself when it is done');
    s.progress = 1;
    this._finish(s);
  },

  skip() {
    if (!VexProgress.enabled('challenge')) throw new Error('The daily challenge is off');
    const s = this._today();
    if (s.status !== 'open') throw new Error('Today\'s challenge is already ' + s.status);
    s.status = 'skipped';
    VexProgress.save(this.KEY, s);
    try { document.dispatchEvent(new CustomEvent('vex:challenge-changed')); } catch { /* no document */ }
  },

  snapshot() {
    const enabled = VexProgress.enabled('challenge');
    if (!enabled) return { enabled, day: VexProgress.today(), id: '', text: '', status: 'open', progress: 0, target: 0, manual: false, reward: 0, completedTotal: this._state().total || 0 };
    this.refresh();
    const s = this._today();
    const c = this._def(s.id);
    const lv = globalThis.VexLevels;
    return {
      enabled, day: s.day, id: s.id, text: c.text, status: s.status,
      progress: s.progress, target: c.target, manual: !!c.manual,
      reward: lv ? lv.ACTIONS.challenge.xp : 0,
      completedTotal: s.total || 0,
    };
  },

  render(el) {
    if (!el) throw new Error('No place to draw the daily challenge');
    const s = this.snapshot();
    const icon = (n) => (globalThis.VexIcons ? globalThis.VexIcons.svg(n, { size: 15 }) : '');
    if (!s.enabled) { el.innerHTML = '<p class="setting-info muted">The daily challenge is off.</p>'; return; }
    let body;
    if (s.status === 'done') body = '<p class="setting-info">Done for today. Nice.</p>';
    else if (s.status === 'skipped') body = '<p class="setting-info muted">Skipped. A new one tomorrow.</p>';
    else body = '<p class="setting-info">' + VexProgress.esc(s.text) + (s.manual ? '' : ' <span class="muted">(' + s.progress + ' of ' + s.target + ')</span>') + '</p>' +
      '<div class="fun-actions">' +
        (s.manual ? '<button type="button" class="btn-primary" data-fun-done>I did it</button>' : '') +
        '<button type="button" class="btn-secondary" data-fun-skip>Skip</button>' +
      '</div>';
    el.innerHTML = '<div class="fun-card" role="group" aria-label="Daily challenge"><div class="fun-card-head">' + icon('target') + '<strong>Today</strong></div>' + body + '</div>';
    const redraw = () => this.render(el);
    const run = (fn) => () => { try { fn(); } catch (err) { window.showToast?.(err.message, 'error'); } redraw(); };
    const d = el.querySelector('[data-fun-done]'); if (d) d.addEventListener('click', run(() => this.complete()));
    const k = el.querySelector('[data-fun-skip]'); if (k) k.addEventListener('click', run(() => this.skip()));
  },

  init() {
    if (this._wired || typeof document === 'undefined') return;
    this._wired = true;
    document.addEventListener('vex:tab-closed', () => {
      try { this._onTabClosed(); } catch (err) { VexProgress.report('The daily challenge could not count a tab', err); }
    });
    // Commands and features are read when a tab changes, at most once a minute.
    let last = 0;
    document.addEventListener('vex:tab-activated', () => {
      const t = VexProgress.now();
      if (t - last < 60000 || !VexProgress.allows('delight')) return;
      last = t;
      try { this.refresh(); } catch (err) { VexProgress.report('The daily challenge could not update', err); }
    });
  },
};

if (typeof document !== 'undefined') VexDailyChallenge.init();
globalThis.VexDailyChallenge = VexDailyChallenge;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexDailyChallenge };
