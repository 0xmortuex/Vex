// === Needs me: one list of what is waiting on you =================================
//
// Discord, WhatsApp, the Attention Inbox, mail, GitHub and reminders each keep
// their own idea of "something is waiting". This puts them in ONE list with a
// one-line reason on every row, so the question "what needs me?" has one place
// to be asked:
//
//   panel notifications   from js/panel-capture.js (only what the person opted in)
//   panel unread counts   the number in the panel's title (js/panel-badges.js);
//                         the count only, never a message
//   Vex's Inbox           what the Attention Budget held back (js/attention-inbox.js)
//   Autopilot             mail, GitHub, reminders, watched pages, with its own
//                         ranking and its own reasons (js/autopilot.js), where it is on
//   any other source      NeedsMe.registerSource(id, async () => rows)
//
// RANKING. Plain numbers with a reason each, so it can be read and argued with:
// a VIP person, word or panel (js/vip-rules.js) goes first; a conversation with
// several notifications and a recent one counts for more; what you usually
// dismiss counts for less, what you usually open for more (a few counters on
// this computer, Settings can forget them). Snooze hides a row until a time
// and Dismiss until it changes. The UNRANKED view (newest first) is always one
// click away, so the ranking can never hide something from you.
//
// Nothing here reads a page or sends anything: it only joins lists Vex already has.
const NeedsMe = {
  KEYS: { on: 'vex.needsMe.on', weights: 'vex.needsMe.weights', snoozed: 'vex.needsMe.snoozed', dismissed: 'vex.needsMe.dismissed', ranked: 'vex.needsMe.ranked' },
  MAX_WEIGHT: 15,
  VIP_BONUS: 50,
  _sources: new Map(),
  _now() { return Date.now(); },

  // ---- storage ------------------------------------------------------------------------
  _map(key) {
    const raw = localStorage.getItem(key);
    if (raw === null) return {};
    let v;
    try { v = JSON.parse(raw); } catch (err) { throw new Error('The saved Needs me data "' + key + '" is not readable', { cause: err }); }
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  },
  _put(key, value) { localStorage.setItem(key, JSON.stringify(value)); },

  enabled() { return localStorage.getItem(this.KEYS.on) !== '0'; },
  setEnabled(on) { localStorage.setItem(this.KEYS.on, on ? '1' : '0'); },
  ranked() { return localStorage.getItem(this.KEYS.ranked) !== '0'; },
  setRanked(on) { localStorage.setItem(this.KEYS.ranked, on ? '1' : '0'); },
  forgetLearning() { localStorage.removeItem(this.KEYS.weights); localStorage.removeItem(this.KEYS.snoozed); localStorage.removeItem(this.KEYS.dismissed); },

  registerSource(id, fn) {
    if (!/^[a-z][a-z0-9-]{0,40}$/.test(String(id || ''))) throw new Error('A Needs me source needs a short name');
    if (typeof fn !== 'function') throw new Error('A Needs me source must be a function');
    this._sources.set(id, fn);
  },

  // ---- the learned part ---------------------------------------------------------------------
  weight(key) { return Number(this._map(this.KEYS.weights)[key]) || 0; },
  _learn(key, delta) {
    if (!key) return;
    const w = this._map(this.KEYS.weights);
    w[key] = Math.max(-this.MAX_WEIGHT, Math.min(this.MAX_WEIGHT, (Number(w[key]) || 0) + delta));
    this._put(this.KEYS.weights, w);
  },

  // ---- the rows ---------------------------------------------------------------------------------
  _vip(text, source) { return typeof VipRules !== 'undefined' ? VipRules.hit(text, source) : null; },
  _label(source) { return typeof PanelCapture !== 'undefined' ? PanelCapture.label(source) : source; },

  _fromCaptured(now) {
    if (typeof PanelCapture === 'undefined' || !PanelCapture.enabled()) return [];
    const groups = new Map();
    for (const n of PanelCapture.list({ unreadOnly: true })) {
      const k = n.source + '::' + n.title.toLowerCase();
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(n);
    }
    const rows = [];
    for (const [k, list] of groups) {
      const newest = list[0];
      const why = ['a notification from ' + this._label(newest.source)];
      let score = 40;
      const vip = list.map(n => n.vip).find(Boolean) || this._vip(newest.title + ' ' + newest.body, newest.source);
      if (vip) { score += this.VIP_BONUS; why.push(vip.kind === 'person' ? vip.label + ' is a VIP' : vip.kind === 'keyword' ? 'it says "' + vip.label + '"' : this._label(vip.label) + ' is a VIP panel'); }
      if (list.length > 1) { score += Math.min(10, list.length * 2); why.push(list.length + ' notifications'); }
      if (now - newest.ts < 3600000) { score += 8; why.push('in the last hour'); }
      rows.push({ id: 'pc:' + k, origin: 'panel', learnKey: 'panel:' + newest.source, title: this._label(newest.source) + ': ' + newest.title, sub: newest.body, ts: newest.ts, score, why, vip: !!vip, source: newest.source, ref: { ids: list.map(n => n.id), conversation: newest.title } });
    }
    return rows;
  },

  _fromCounts(now) {
    const counts = typeof PanelBadges !== 'undefined' ? PanelBadges.counts : {};
    const rows = [];
    for (const [panel, n] of Object.entries(counts || {})) {
      if (!(n > 0)) continue;
      // The captured rows already speak for a panel that is opted in and has something unread.
      if (typeof PanelCapture !== 'undefined' && PanelCapture.enabled() && PanelCapture.siteOn(panel) && PanelCapture.unreadCount(panel) > 0) continue;
      const why = ['the unread count in its title'];
      let score = 25 + Math.min(n, 20);
      const vip = this._vip('', panel);
      if (vip) { score += this.VIP_BONUS; why.push(this._label(panel) + ' is a VIP panel'); }
      rows.push({ id: 'pu:' + panel, origin: 'panel', learnKey: 'panel:' + panel, title: this._label(panel) + ': ' + n + ' unread', sub: '', ts: now, score, why, vip: !!vip, source: panel, ref: { count: n } });
    }
    return rows;
  },

  _fromInbox() {
    if (typeof AttentionInbox === 'undefined') return [];
    return AttentionInbox.list().map((r) => {
      const why = ['Vex held this back so it would not interrupt you'];
      let score = 20;
      const vip = this._vip(r.title + ' ' + (r.body || ''), '');
      if (vip) { score += this.VIP_BONUS; why.push(vip.label + ' is on your VIP list'); }
      return { id: 'ai:' + r.id, origin: 'inbox', learnKey: 'inbox:' + r.feature, title: r.title, sub: r.body || '', ts: r.ts, score, why, vip: !!vip, source: r.feature, ref: { rowId: r.id } };
    });
  },

  async _fromAutopilot() {
    if (typeof VexAutopilot === 'undefined' || typeof VexAutopilot.stream !== 'function') return { rows: [], problems: [] };
    const g = await VexAutopilot.stream();
    const rows = [];
    for (const tier of ['now', 'today', 'fyi']) {
      for (const it of g[tier] || []) {
        const why = (it.why || []).slice();
        let score = it.score;
        const vip = this._vip(it.title + ' ' + (it.sub || ''), '');
        if (vip) { score += 25; why.push(vip.label + ' is on your VIP list'); }
        rows.push({ id: 'ap:' + it.id, origin: 'autopilot', learnKey: '', title: it.title, sub: it.sub || '', ts: it.ts || 0, score: Math.min(100, score), why: why.length ? why : [it.kind], vip: !!vip, source: it.kind, ref: { item: it } });
      }
    }
    return { rows, problems: g.problems || [] };
  },

  // -> { rows, problems }. Rows are ranked unless the person chose the unranked view.
  async collect({ now = this._now(), ranked = this.ranked() } = {}) {
    const problems = [];
    let rows = [].concat(this._fromCaptured(now), this._fromCounts(now), this._fromInbox());
    try { const a = await this._fromAutopilot(); rows = rows.concat(a.rows); problems.push(...a.problems); }
    catch (err) { problems.push('Autopilot: ' + err.message); }
    for (const [id, fn] of this._sources) {
      try { rows = rows.concat((await fn()) || []); } catch (err) { problems.push(id + ': ' + err.message); }
    }
    const snoozed = this._map(this.KEYS.snoozed), dismissed = this._map(this.KEYS.dismissed);
    rows = rows.filter((r) => {
      if (snoozed[r.id] && snoozed[r.id] > now) return false;
      // A dismissed count comes back when it grows; anything else stays gone.
      if (dismissed[r.id] != null) return r.ref && typeof r.ref.count === 'number' ? r.ref.count > dismissed[r.id] : false;
      return true;
    });
    if (ranked) {
      for (const r of rows) {
        const w = r.learnKey ? this.weight(r.learnKey) : 0;
        if (w) { r.score = Math.max(0, Math.min(100, r.score + w)); if (w <= -6) r.why.push('you usually dismiss these'); else if (w >= 6) r.why.push('you usually open these'); }
      }
      rows.sort((a, b) => b.score - a.score || b.ts - a.ts);
    } else {
      rows.sort((a, b) => b.ts - a.ts);
    }
    return { rows, problems };
  },

  // ---- what the person does with a row ------------------------------------------------------------
  open(row) {
    this._learn(row.learnKey, 3);
    if (row.origin === 'panel') {
      if (row.ref.ids && typeof PanelCapture !== 'undefined') for (const id of row.ref.ids) PanelCapture.markRead(id);
      if (typeof SidebarManager === 'undefined') throw new Error('The sidebar is not loaded, so the panel cannot be opened');
      SidebarManager.showPanel(row.source);
      return true;
    }
    if (row.origin === 'inbox') {
      if (typeof AttentionInbox === 'undefined') throw new Error('The Attention Inbox is not loaded');
      AttentionInbox.open();
      return true;
    }
    if (row.origin === 'autopilot') { Autopilot.open(row.ref.item); return true; }
    throw new Error('This row has nothing to open');
  },
  async dismiss(row) {
    this._learn(row.learnKey, -3);
    if (row.origin === 'panel') {
      if (row.ref.ids && typeof PanelCapture !== 'undefined') for (const id of row.ref.ids) PanelCapture.markRead(id);
      else { const d = this._map(this.KEYS.dismissed); d[row.id] = row.ref.count || 0; this._put(this.KEYS.dismissed, d); }
      return true;
    }
    if (row.origin === 'inbox') return AttentionInbox.dismiss(row.ref.rowId);
    if (row.origin === 'autopilot') { await Autopilot.done(row.ref.item); return true; }
    const d = this._map(this.KEYS.dismissed); d[row.id] = 0; this._put(this.KEYS.dismissed, d);
    return true;
  },
  // when: 'hour' | 'evening' | 'tomorrow'
  snooze(row, when, now = this._now()) {
    this._learn(row.learnKey, -1);
    if (row.origin === 'autopilot') return Autopilot.snooze(row.ref.item, when, now);
    const d = new Date(now);
    let at;
    if (when === 'hour') at = now + 3600000;
    else if (when === 'evening') { d.setHours(18, 0, 0, 0); if (d.getTime() <= now + 15 * 60000) d.setDate(d.getDate() + 1); at = d.getTime(); }
    else if (when === 'tomorrow') { d.setDate(d.getDate() + 1); d.setHours(8, 0, 0, 0); at = d.getTime(); }
    else throw new Error('Snooze for an hour, this evening or tomorrow morning');
    const s = this._map(this.KEYS.snoozed);
    s[row.id] = at;
    for (const k of Object.keys(s)) if (s[k] <= now) delete s[k];
    this._put(this.KEYS.snoozed, s);
    return at;
  },
  // Mute the conversation a panel row is about, inside Vex's list only.
  muteConversation(row, ms) {
    if (row.origin !== 'panel' || !row.ref.conversation) throw new Error('Only a panel conversation can be muted');
    PanelCapture.mute(row.source, row.ref.conversation, ms);
    for (const id of row.ref.ids || []) PanelCapture.markRead(id);
    return true;
  },
};

if (typeof window !== 'undefined') window.NeedsMe = NeedsMe;
if (typeof module !== 'undefined' && module.exports) module.exports = { NeedsMe };
