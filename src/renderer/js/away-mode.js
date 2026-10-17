// === Away mode, and what happened while you were away =============================
//
// One click (Ctrl+K "Go away"), or Vex locking itself, says "I am not here".
// While away Vex is QUIET like it is in Focus mode: AttentionState gains an
// "away" reason, so the Attention Budget holds everything that is not urgent
// (the held items wait in the Inbox, nothing is thrown away), and a VIP person
// or word still gets through (js/vip-rules.js).
//
// When you come back, or press "I am back", a short summary of what happened is
// written from lists Vex already keeps, in five lines at most, all of it local
// and made by plain counting (no AI model, nothing sent anywhere):
//
//   how long you were away
//   the notifications panels raised (only where "Notifications from panels" is on)
//   how each panel's unread count moved
//   the busiest conversation
//   what waited in the Inbox, and what the attention rules held back
//
// Away starts by itself when Vex is locked (js/vex-lock.js) unless the person
// switched that off, and every start Vex made on its own is written to "Why did
// that happen?" with a way to cancel it. Idle time without a PIN lock is not
// detected: Windows' own idle time is only read by the lock.
const AwayMode = {
  KEYS: { on: 'vex.away.on', state: 'vex.away.state', auto: 'vex.away.autoLock' },
  _now() { return Date.now(); },

  enabled() { return localStorage.getItem(this.KEYS.on) !== '0'; },
  setEnabled(on) {
    localStorage.setItem(this.KEYS.on, on ? '1' : '0');
    if (!on && this.active()) { this.cancel(); }
  },
  autoOnLock() { return localStorage.getItem(this.KEYS.auto) !== '0'; },
  setAutoOnLock(on) { localStorage.setItem(this.KEYS.auto, on ? '1' : '0'); },

  _state() {
    const raw = localStorage.getItem(this.KEYS.state);
    if (raw === null) return null;
    let v;
    try { v = JSON.parse(raw); } catch (err) { throw new Error('The saved away state is not readable', { cause: err }); }
    return v && Number.isFinite(v.since) ? v : null;
  },
  active() { return this.enabled() && !!this._state(); },
  since() { const s = this._state(); return s ? s.since : 0; },
  reason() { const s = this._state(); return s ? s.reason : ''; },

  _changed() { if (typeof AttentionState !== 'undefined') AttentionState.changed(); },

  // reason: 'manual' | 'lock'. -> true when it started.
  start(reason = 'manual') {
    if (!this.enabled()) throw new Error('Away mode is switched off: Settings, Panels and messages');
    if (this._state()) return false;
    localStorage.setItem(this.KEYS.state, JSON.stringify({ since: this._now(), reason }));
    this._changed();
    return true;
  },

  // Ends away and returns the summary ({ since, until, lines, ... }), or null when not away.
  end() {
    const s = this._state();
    if (!s) return null;
    const until = this._now();
    const summary = this.summarise(s.since, until);
    localStorage.removeItem(this.KEYS.state);
    this._changed();
    document.dispatchEvent(new CustomEvent('vex:away-summary', { detail: summary }));
    return summary;
  },

  // Ends away without a summary (turned off, or an auto start the person undid).
  cancel() {
    if (!this._state()) return false;
    localStorage.removeItem(this.KEYS.state);
    this._changed();
    return true;
  },

  toggle() { return this.active() ? this.end() : this.start('manual'); },

  _dur(ms) {
    const m = Math.round(ms / 60000);
    if (m < 1) return 'less than a minute';
    if (m < 60) return m + ' minute' + VexPlural.s(m);
    const h = Math.floor(m / 60), r = m % 60;
    return h + ' hour' + VexPlural.s(h) + (r ? ' ' + r + ' min' : '');
  },
  _name(source) { return typeof PanelCapture !== 'undefined' ? PanelCapture.label(source) : source; },
  _top(map, n = 3) { return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, n); },

  // Plain counting over lists Vex already keeps. Five lines at most.
  summarise(since, until = this._now()) {
    const lines = [];
    lines.push('You were away for ' + this._dur(until - since) + '.');
    const data = { captured: 0, vip: 0, unread: [], inbox: 0, held: 0, busiest: null };

    // Panel notifications.
    if (typeof PanelCapture !== 'undefined' && PanelCapture.enabled()) {
      const items = PanelCapture.list({ since });
      data.captured = items.length;
      data.vip = items.filter(i => i.vip).length;
      if (!items.length) lines.push('No panel notifications were kept.');
      else {
        const per = {};
        for (const i of items) per[i.source] = (per[i.source] || 0) + 1;
        let t = items.length + ' notification' + VexPlural.s(items.length) + ' from panels (' + this._top(per).map(([s, n]) => this._name(s) + ' ' + n).join(', ') + ')';
        if (data.vip) t += ', ' + data.vip + ' from people or words you marked VIP';
        lines.push(t + '.');
        const conv = {};
        for (const i of items) { const k = i.source + '::' + i.title; conv[k] = (conv[k] || 0) + 1; }
        const [top] = this._top(conv, 1);
        if (top) { data.busiest = { source: top[0].split('::')[0], title: top[0].slice(top[0].indexOf('::') + 2), count: top[1] }; }
      }
    } else {
      lines.push('Panel notifications are not being kept (Settings, Panels and messages).');
    }

    // Unread movement, from the ledger.
    if (typeof PanelState !== 'undefined' && PanelState.enabled()) {
      const moves = {};
      for (const e of PanelState.ledger()) {
        if (e.ts <= since || e.ts > until) continue;
        if (!moves[e.p]) moves[e.p] = { from: e.from, to: e.to };
        moves[e.p].to = e.to;
      }
      data.unread = Object.entries(moves).filter(([, m]) => m.from !== m.to).map(([p, m]) => ({ panel: p, from: m.from, to: m.to }));
      lines.push(data.unread.length ? 'Unread: ' + data.unread.map(u => this._name(u.panel) + ' ' + u.from + ' to ' + u.to).join(', ') + '.' : 'No panel\'s unread count changed.');
    }
    if (data.busiest) lines.push('Busiest conversation: ' + data.busiest.title + ' in ' + this._name(data.busiest.source) + ' (' + data.busiest.count + ').');

    // What waited.
    const inbox = typeof AttentionInbox !== 'undefined' ? AttentionInbox.list().filter(r => r.ts > since).length : 0;
    let held = 0;
    if (typeof VexAttention !== 'undefined') for (const d of VexAttention.denied()) if (d.t > since && d.t <= until) held += d.n || 1;
    data.inbox = inbox; data.held = held;
    lines.push(inbox || held
      ? inbox + ' suggestion' + VexPlural.s(inbox) + ' waited in the Inbox' + (held ? ' and ' + held + ' more ' + (held === 1 ? 'was' : 'were') + ' held back by the attention rules' : '') + '.'
      : 'Nothing was held back for you.');
    return { since, until, lines: lines.slice(0, 5), data };
  },

  init() {
    if (this._wired || typeof window === 'undefined') return false;
    this._wired = true;
    window.addEventListener('vex-locked', () => {
      if (!this.enabled() || !this.autoOnLock()) return;
      try {
        if (this.start('lock') && typeof VexLedger !== 'undefined') {
          VexLedger.note({ feature: 'away-mode', what: 'Started away mode because Vex was locked', why: 'Away mode starts by itself when you lock Vex (Settings, Panels and messages); a summary comes when you unlock', undo: { kind: 'cancel-away' } });
        }
      } catch (err) { window.VexProblems?.note('Away', 'Away mode could not start when Vex locked', err); }
    });
    window.addEventListener('vex-unlocked', () => {
      if (this.active() && this.reason() === 'lock') {
        try { this.end(); } catch (err) { window.VexProblems?.note('Away', 'The away summary could not be made', err); }
      }
    });
    if (typeof VexLedger !== 'undefined') VexLedger.registerUndo('cancel-away', async () => { AwayMode.cancel(); });
    return true;
  },
};

if (typeof window !== 'undefined') {
  window.AwayMode = AwayMode;
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => AwayMode.init());
    else AwayMode.init();
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { AwayMode };
