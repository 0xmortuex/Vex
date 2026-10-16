// === Delivery windows: what was held, released as ONE digest ========================
//
// The Attention Budget (js/vex-attention.js) already holds what is not urgent
// while Vex is quiet and keeps it in the Attention Inbox (js/attention-inbox.js),
// and the notifications panels raised wait in js/panel-capture.js. Without this
// each of them is a separate place to look. With "Delivery windows" on, Vex tells
// the person ONCE, at the times they chose, what has piled up since the last time:
//
//   at set times of day       "12:30, 17:30" (up to six)
//   on the hour and half hour every :00 and :30 (instead of the list)
//   when a Focus block ends   the moment Focus mode / a Focus flow is over
//
// The digest is one toast ("4 things waited: 3 in the Inbox, 1 panel
// notification") with a button that opens Needs me. It is never a second copy of
// the items: they stay where they are. It is never shown while Vex is quiet (a
// game, a meeting, a Focus block, quiet hours...); it waits for the next minute
// that is not. People and words marked VIP are not in it: they already came through.
//
// OFF until the person turns it on. Reminders and anything asked for are not
// held by any of this, and the Windows quiet hours (src/main/quiet-hours.js) keep
// their own digest for the toasts Vex itself sends: this one is for the lists
// above, and does not replace it.
const AttentionDigest = {
  KEYS: { on: 'vex.digest.on', times: 'vex.digest.times', last: 'vex.digest.last', half: 'vex.digest.half', focusEnd: 'vex.digest.focusEnd' },
  MAX_TIMES: 6,
  HHMM: /^([01]\d|2[0-3]):([0-5]\d)$/,
  _now() { return Date.now(); },
  _wasFocus: false,

  enabled() { return localStorage.getItem(this.KEYS.on) === '1'; },
  // Switching it on starts counting from now: what piled up before is not a "digest".
  setEnabled(on) {
    localStorage.setItem(this.KEYS.on, on ? '1' : '0');
    if (on) localStorage.setItem(this.KEYS.last, String(this._now()));
  },
  times() {
    const raw = localStorage.getItem(this.KEYS.times);
    if (raw === null) return [];
    let v;
    try { v = JSON.parse(raw); } catch (err) { throw new Error('The saved digest times are not readable', { cause: err }); }
    return Array.isArray(v) ? v.filter(t => typeof t === 'string' && this.HHMM.test(t)) : [];
  },
  setTimes(list) {
    if (!Array.isArray(list) || list.length > this.MAX_TIMES) throw new Error('At most ' + this.MAX_TIMES + ' times');
    for (const t of list) if (typeof t !== 'string' || !this.HHMM.test(t)) throw new Error('"' + String(t).slice(0, 12) + '" is not a time like 12:30');
    localStorage.setItem(this.KEYS.times, JSON.stringify([...new Set(list)].sort()));
  },
  halfHours() { return localStorage.getItem(this.KEYS.half) === '1'; },
  setHalfHours(on) { localStorage.setItem(this.KEYS.half, on ? '1' : '0'); },
  atFocusEnd() { return localStorage.getItem(this.KEYS.focusEnd) !== '0'; },
  setAtFocusEnd(on) { localStorage.setItem(this.KEYS.focusEnd, on ? '1' : '0'); },
  last() { return Number(localStorage.getItem(this.KEYS.last)) || 0; },

  // What has piled up since `since`, without the VIP items (they were delivered).
  pending(since) {
    const inbox = typeof AttentionInbox !== 'undefined'
      ? AttentionInbox.list().filter(r => r.ts > since && !(typeof VipRules !== 'undefined' && VipRules.hit(r.title + ' ' + (r.body || ''), ''))) : [];
    const panel = typeof PanelCapture !== 'undefined' && PanelCapture.enabled() ? PanelCapture.list({ since }).filter(n => !n.vip && !n.read) : [];
    return { inbox, panel };
  },

  // The latest window that has opened since the last digest, or 0.
  dueWindow(now = this._now()) {
    const last = this.last();
    let best = 0;
    if (this.halfHours()) {
      const d = new Date(now);
      d.setMinutes(d.getMinutes() < 30 ? 0 : 30, 0, 0);
      if (d.getTime() > last) best = d.getTime();
    }
    const d = new Date(now);
    for (const t of this.times()) {
      const [h, m] = t.split(':').map(Number);
      const at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, 0, 0).getTime();
      if (at <= now && at > last && at > best) best = at;
    }
    return best;
  },

  // reason: 'window' | 'focus-end' | 'now'. -> the digest text, or null when nothing was shown.
  release(reason, now = this._now()) {
    if (!this.enabled()) return null;
    if (typeof AttentionState !== 'undefined' && AttentionState.get().quiet && reason !== 'now') return null;
    const since = this.last();
    const p = this.pending(since);
    localStorage.setItem(this.KEYS.last, String(now));
    const n = p.inbox.length + p.panel.length;
    if (!n) return null;
    const parts = [];
    if (p.inbox.length) parts.push(p.inbox.length + ' in the Inbox');
    if (p.panel.length) parts.push(p.panel.length + ' panel notification' + (p.panel.length === 1 ? '' : 's'));
    const text = n + ' thing' + (n === 1 ? '' : 's') + ' waited for you: ' + parts.join(', ') + '.';
    const show = () => {
      if (!window.showToast) return;
      window.showToast(text, 'info', 9000, { action: { label: 'Open', title: 'See what is waiting', run: () => {
        if (typeof NeedsMeUI !== 'undefined') NeedsMeUI.open();
        else if (typeof AttentionInbox !== 'undefined') AttentionInbox.open();
      } } });
    };
    if (typeof VexAttention === 'undefined') throw new Error('VexAttention is not loaded: js/vex-attention.js must come before js/attention-digest.js');
    // The person chose these times, so the digest is "asked" (the budget lets it through).
    VexAttention.notify({ feature: 'attention-digest', urgency: 'asked', id: 'd' + now, title: text }, show);
    if (typeof VexLedger !== 'undefined') {
      VexLedger.note({ feature: 'attention-digest', what: 'Showed one digest of ' + n + ' held item' + (n === 1 ? '' : 's'), why: reason === 'focus-end' ? 'Your Focus block ended and Delivery windows is on' : 'A delivery window you chose opened' });
    }
    return text;
  },

  check(now = this._now()) {
    if (!this.enabled()) return null;
    const at = this.dueWindow(now);
    return at ? this.release('window', now) : null;
  },

  init() {
    if (this._wired || typeof document === 'undefined') return false;
    this._wired = true;
    if (typeof VexJobs !== 'undefined') VexJobs.every('Digest windows', 60 * 1000, () => this.check(), { feature: 'attention-digest' });
    // A Focus block ending is a window too.
    document.addEventListener('vex:attention-state', (e) => {
      const sources = (e.detail && e.detail.sources) || [];
      const focus = sources.some(s => s.id === 'focus');
      const ended = this._wasFocus && !focus;
      this._wasFocus = focus;
      if (ended && this.enabled() && this.atFocusEnd()) {
        try { this.release('focus-end'); } catch (err) { window.VexProblems?.note('Attention', 'The digest at the end of Focus could not be shown', err); }
      }
    });
    return true;
  },
};

if (typeof window !== 'undefined') {
  window.AttentionDigest = AttentionDigest;
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => AttentionDigest.init());
    else AttentionDigest.init();
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { AttentionDigest };
