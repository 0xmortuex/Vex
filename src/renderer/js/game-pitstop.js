// === After-game pit-stop panel (T1-032) ======================================
//
// The moment a game ends is the moment you come back to Vex. One card, read at a
// glance, says what happened while you were away:
//
//   how long you played
//   what Vex held back and now lets through: toasts and Windows notifications,
//     background jobs, sync, history indexing
//   what is waiting for you in the Attention Inbox (and a digest of the titles)
//   the tabs and panels it slept, with one button to wake them
//   the AI model it unloaded and the video memory that gave back
//
// It replaces the two-line "While you played..." toast that Game mode showed
// (js/game-mode.js) when it is switched on; with it off the toast is as it was.
//
// Nothing here reads the game or any other program: it reads Vex's own counters
// (the attention log, the inbox, the job table, Game mode's own report) and the
// game's name from the game state Vex already has. Not held by Game mode today,
// so not on the card: downloads and Vex's own update (they are never paused).
//
// The card goes through the Attention Budget as a "useful" notice (a quiet
// moment puts it in the Attention Inbox instead), and the last one is always one
// command away: Ctrl+K "Last game pit stop".
const GamePitstop = {
  KEY: 'vex.game.pitstop',            // 'off' turns it off
  LAST_KEY: 'vex.game.pitstop.last',  // the newest card, as data
  MIN_MS: 2 * 60 * 1000,              // a shorter game has nothing worth a card
  COMPILE_DELAY_MS: 1500,             // let Game mode and Vex Sync finish putting things back first
  MAX_TITLES: 8,

  _s: null,          // { app, gameId, start, jobsAtStart, inboxIds:Set, denied0:number }
  _report: null,     // Game mode's report for this game, handed over by GameMode.onGameEnd
  _resumed: null,    // what resuming did (sync, indexing)
  _ui: null,

  enabled() { try { return localStorage.getItem(this.KEY) !== 'off'; } catch { return true; } },
  setEnabled(on) { localStorage.setItem(this.KEY, on ? 'on' : 'off'); return !!on; },

  _now() { return Date.now(); },
  _note(what, err) { if (typeof VexProblems !== 'undefined') VexProblems.note('Game mode', what, err); },

  // ---- watching a game -----------------------------------------------------------
  _jobsHeld() {
    if (typeof VexJobs === 'undefined' || !VexJobs._jobs) return 0;
    let n = 0;
    for (const j of VexJobs._jobs.values()) n += j.held || 0;
    return n;
  },
  _inboxIds() {
    if (typeof AttentionInbox === 'undefined' || typeof AttentionInbox.list !== 'function') return new Set();
    return new Set(AttentionInbox.list().map(r => r.id));
  },

  // The newest game:state: a game starting begins the count, the game ending compiles the card.
  onState(s) {
    if (!s) return;
    if (s.game && !this._s) {
      this._s = { app: String(s.app || ''), gameId: String(s.id || ''), start: this._now(), jobsAtStart: this._jobsHeld(), inboxIds: this._inboxIds() };
      this._report = null;
      this._resumed = null;
    } else if (s.game && this._s && s.app && !this._s.app) {
      this._s.app = String(s.app);
    } else if (!s.game && this._s) {
      const g = this._s;
      this._s = null;
      g.end = this._now();
      setTimeout(() => {
        this.compile(g).then(card => card && this.deliver(card)).catch(err => this._note('Could not put together the after-game card', err));
      }, this.COMPILE_DELAY_MS);
    }
  },

  // Game mode hands its report over as the game ends. true = this card says it, so the toast is not shown.
  takeOver(report) {
    if (!this.enabled()) return false;
    this._report = report || null;
    return true;
  },

  // ---- the card ----------------------------------------------------------------------
  _tabTitle(id) {
    const t = typeof TabManager !== 'undefined' ? (TabManager.tabs || []).find(x => x.id === id) : null;
    return t ? { id, title: String(t.title || t.url || 'Tab').slice(0, 80), sleeping: !!t.sleeping } : null;
  },

  async _osDenied(since) {
    const b = typeof window !== 'undefined' && window.vex && window.vex.attention;
    if (!b || typeof b.denied !== 'function') return [];
    const list = await b.denied();
    return (Array.isArray(list) ? list : []).filter(d => d && d.t >= since && /^quiet/.test(String(d.reason || '')));
  },

  // → the card, or null when there is nothing worth saying.
  async compile(g) {
    if (!this.enabled()) return null;
    const ms = g.end - g.start;
    const rep = this._report || {};
    const warm = (typeof GameWarmdown !== 'undefined' && Array.isArray(GameWarmdown.handedOver)) ? GameWarmdown.handedOver : [];
    const sleptIds = [...new Set([...(rep.sleptIds || []), ...warm])];
    const tabs = sleptIds.map(id => this._tabTitle(id)).filter(Boolean);

    const toasts = (typeof VexAttention !== 'undefined' ? VexAttention.denied() : []).filter(d => d && d.t >= g.start && /^quiet/.test(String(d.reason || '')));
    const os = await this._osDenied(g.start);
    const rows = typeof AttentionInbox !== 'undefined' ? AttentionInbox.list().filter(r => !g.inboxIds.has(r.id)) : [];
    const titles = [];
    for (const r of rows) if (r.title && titles.length < this.MAX_TITLES) titles.push({ from: r.feature, title: String(r.title).slice(0, 100) });
    for (const d of [...toasts, ...os]) if (d.title && titles.length < this.MAX_TITLES && !titles.some(t => t.title === String(d.title).slice(0, 100))) titles.push({ from: d.feature, title: String(d.title).slice(0, 100) });

    const card = {
      at: g.end, app: g.app || rep.app || 'A game', gameId: g.gameId, minutes: Math.round(ms / 60000),
      notifications: { toasts: toasts.reduce((n, d) => n + (d.n || 1), 0), windows: os.reduce((n, d) => n + (d.n || 1), 0), inbox: rows.length },
      jobsHeld: Math.max(0, this._jobsHeld() - g.jobsAtStart),
      sync: !!(typeof GameSession !== 'undefined' && GameSession._lastResume && GameSession._lastResume.sync),
      indexing: (typeof GameSession !== 'undefined' && GameSession._lastResume && GameSession._lastResume.indexQueue) || 0,
      tabs, panels: Array.isArray(rep.panels) ? rep.panels.length : 0,
      models: rep.models || [], freedMB: rep.freedMB || 0,
      titles,
    };
    const worth = card.notifications.toasts + card.notifications.windows + card.notifications.inbox + card.jobsHeld + card.tabs.length + card.panels + card.models.length + (card.sync ? 1 : 0) + card.indexing;
    // Nothing held, nothing slept: nothing to say. A game under two minutes (a launcher
    // handing over) only gets a card when Vex really slept tabs or unloaded the model.
    if (!worth) return null;
    if (ms < this.MIN_MS && !card.tabs.length && !card.models.length) return null;
    return card;
  },

  // Through the Attention Budget: a useful notice, so a quiet moment keeps it in the inbox.
  deliver(card) {
    localStorage.setItem(this.LAST_KEY, JSON.stringify(card));
    if (typeof VexAttention === 'undefined') { this.show(card); return 'shown'; }
    const d = VexAttention.request({ feature: 'game-pitstop', urgency: 'useful', id: String(card.at), title: card.app + ': a pit stop is ready', body: this.summaryLine(card), action: { label: 'Open', key: 'open' }, label: 'After-game pit stop' });
    if (d.route === 'toast') { this.show(card); return 'shown'; }
    return d.route;
  },

  last() {
    let v = null;
    try { v = JSON.parse(localStorage.getItem(this.LAST_KEY) || 'null'); } catch (err) { throw new Error('The last pit stop is not readable: ' + err.message, { cause: err }); }
    return v && typeof v === 'object' ? v : null;
  },

  _plural(n, w) { return n + ' ' + w + VexPlural.s(n); },
  _duration(min) { return min >= 60 ? Math.floor(min / 60) + ' h' + (min % 60 ? ' ' + (min % 60) + ' min' : '') : this._plural(min, 'minute'); },

  summaryLine(card) {
    const bits = [];
    const n = card.notifications.toasts + card.notifications.windows;
    if (n) bits.push(this._plural(n, 'notification') + ' held');
    if (card.notifications.inbox) bits.push(this._plural(card.notifications.inbox, 'item') + ' waiting in the Attention Inbox');
    if (card.tabs.length) bits.push(this._plural(card.tabs.length, 'tab') + ' slept');
    if (card.sync) bits.push('sync caught up');
    return bits.length ? bits.join(', ') : 'Nothing was waiting';
  },

  // ---- the panel -------------------------------------------------------------------------
  _style() {
    if (document.getElementById('game-pitstop-style')) return;
    const st = document.createElement('style');
    st.id = 'game-pitstop-style';
    st.textContent = `
      #game-pitstop { position:fixed; z-index:9100; right:14px; bottom:14px; width:min(380px,92vw); max-height:min(80vh,560px); overflow:auto; background:var(--bg); color:var(--text); border:1px solid var(--border); border-radius:12px; box-shadow:0 14px 40px var(--vex-shadow-color, rgba(0,0,0,.28)); padding:12px 14px; font-size:12.5px; }
      #game-pitstop h2 { margin:0; font-size:14px; font-weight:650; display:flex; align-items:center; gap:8px; }
      #game-pitstop .gp-sub { color:var(--text-muted); font-size:11.5px; margin:2px 0 8px; }
      #game-pitstop ul { margin:0; padding:0; list-style:none; }
      #game-pitstop li { padding:5px 0; border-top:1px solid var(--border); display:flex; gap:8px; justify-content:space-between; align-items:baseline; }
      #game-pitstop li:first-child { border-top:none; }
      #game-pitstop .gp-n { font-weight:600; white-space:nowrap; }
      #game-pitstop .gp-digest { margin-top:8px; font-size:11.5px; color:var(--text-muted); }
      #game-pitstop .gp-digest div { padding:2px 0; }
      #game-pitstop .gp-btns { display:flex; flex-wrap:wrap; gap:6px; margin-top:10px; }
      #game-pitstop button { font-size:12px; color:var(--text); background:none; border:1px solid var(--border); border-radius:6px; padding:4px 10px; cursor:pointer; }
      #game-pitstop button.gp-primary { background:var(--primary, #4f8cff); color:var(--on-primary, #fff); border-color:transparent; }
    `;
    document.head.appendChild(st);
  },

  // Tabs from the card that are asleep right now.
  sleepingNow(card) { return (card.tabs || []).map(t => this._tabTitle(t.id)).filter(t => t && t.sleeping); },

  wakeTabs(card) {
    const list = this.sleepingNow(card);
    if (!list.length) return 0;
    list.forEach((t, i) => setTimeout(() => {
      try { TabManager.wakeTab(t.id); } catch (err) { this._note('Could not wake a tab', err); }
    }, i * ((typeof GameMode !== 'undefined' && GameMode.WAKE_GAP_MS) || 1500)));
    return list.length;
  },

  hide() {
    if (!this._ui) return;
    this._ui.remove();
    this._ui = null;
    document.removeEventListener('keydown', this._onKey, true);
  },

  show(card) {
    if (typeof document === 'undefined') return null;
    card = card || this.last();
    if (!card) throw new Error('There is no game pit stop yet');
    this.hide();
    this._style();
    const root = document.createElement('div');
    root.id = 'game-pitstop';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'After-game pit stop');
    const add = (parent, tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; parent.appendChild(el); return el; };
    const h = add(root, 'h2');
    const ic = add(h, 'span');
    if (window.VexIcons) ic.innerHTML = VexIcons.svg('gamepad', { size: 16 });
    add(h, 'span', null, card.app + ': pit stop');
    add(root, 'div', 'gp-sub', 'You played ' + this._duration(card.minutes) + '. Here is what Vex held back and what it has done since.');

    const ul = add(root, 'ul');
    const row = (label, value) => { const li = add(ul, 'li'); add(li, 'span', null, label); add(li, 'span', 'gp-n', value); };
    const n = card.notifications;
    if (n.toasts + n.windows) row('Notifications held while you played', String(n.toasts + n.windows) + (n.windows ? ' (' + n.windows + ' from Windows)' : ''));
    if (n.inbox) row('Waiting in your Attention Inbox', String(n.inbox));
    if (card.jobsHeld) row('Background job runs held', String(card.jobsHeld));
    if (card.sync) row('Vex Sync', 'caught up now');
    if (card.indexing) row('History indexing', this._plural(card.indexing, 'page') + ' to do');
    if (card.tabs.length) row('Tabs slept', String(card.tabs.length));
    if (card.panels) row('Panels slept', String(card.panels));
    if (card.models.length) row('AI model unloaded', (card.freedMB ? (card.freedMB >= 1024 ? (card.freedMB / 1024).toFixed(1) + ' GB' : card.freedMB + ' MB') + ' freed' : card.models.join(', ')));
    if (!ul.children.length) add(ul, 'li', null, 'Nothing was held back or slept.');

    if (card.titles.length) {
      const dg = add(root, 'div', 'gp-digest');
      add(dg, 'div', null, 'What was held:');
      for (const t of card.titles) add(dg, 'div', null, '• ' + t.title);
    }

    const btns = add(root, 'div', 'gp-btns');
    const asleep = this.sleepingNow(card).length;
    if (asleep) {
      const w = add(btns, 'button', 'gp-primary', 'Wake the ' + this._plural(asleep, 'tab'));
      w.type = 'button';
      w.addEventListener('click', () => { const k = this.wakeTabs(card); window.showToast?.('Waking ' + this._plural(k, 'tab')); w.remove(); });
    }
    if (n.inbox && typeof AttentionInbox !== 'undefined') {
      const o = add(btns, 'button', null, 'Open the held items');
      o.type = 'button';
      o.addEventListener('click', () => { this.hide(); AttentionInbox.open(); });
    }
    if (typeof GameHolds !== 'undefined') {
      const all = add(btns, 'button', null, 'See everything held');
      all.type = 'button';
      all.addEventListener('click', () => { this.hide(); GameHolds.open().catch(err => window.showToast?.(err.message, 'error')); });
    }
    const done = add(btns, 'button', asleep ? null : 'gp-primary', 'Done');
    done.type = 'button';
    done.addEventListener('click', () => this.hide());

    document.body.appendChild(root);
    this._ui = root;
    this._onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.vex-dialog-overlay')) this.hide(); };
    document.addEventListener('keydown', this._onKey, true);
    return root;
  },

  _registerCommands() {
    if (typeof window === 'undefined' || !window.VexModuleCommands) return;
    VexModuleCommands.set('gamepitstop:', [{
      id: 'gamepitstop:last', label: 'Last game pit stop', hint: 'What Vex held back while you played, and the tabs it slept', icon: 'gamepad',
      action: () => { try { this.show(); } catch (err) { window.showToast?.(err.message, 'error'); } },
    }]);
  },

  init() {
    if (this._wired) return false;
    this._wired = true;
    if (typeof AttentionInbox !== 'undefined') AttentionInbox.handle('game-pitstop', (key) => { if (key === 'open') return this.show(); throw new Error('Unknown pit stop action ' + key); });
    this._registerCommands();
    return true;
  },
};

if (typeof window !== 'undefined') window.GamePitstop = GamePitstop;
if (typeof module !== 'undefined' && module.exports) module.exports = { GamePitstop };
