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
// Four more lines, each from something Vex already holds (nothing new is read from a
// page, a game or Discord):
//
//   patch notes     the patch notes pages you watch (patch radar) that changed while you played
//   a free game     what the stores give away now, only when "tell me about free games" is on
//   missed Discord  the Discord notifications Vex kept while you played (count and chats)
//   resume          "Resume what I was doing": wakes the slept tabs and goes back to the tab
//                   (and panel) that was in front when the game started
//
// and, when the dossier is not already recording this game, an offer to add the web pages
// you opened during it. That offer is a confirm that names what is kept; nothing is added
// without the click, and sign-in, payment, private and never-remember pages are left out.
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
  MAX_OFFER: 20,                      // pages offered to the dossier at most

  _s: null,          // { app, gameId, start, jobsAtStart, inboxIds:Set, tabs:Map, activeTab, activePanel }
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
      this._s = {
        app: String(s.app || ''), gameId: String(s.id || ''), start: this._now(), jobsAtStart: this._jobsHeld(), inboxIds: this._inboxIds(),
        tabs: new Map(), activeTab: typeof TabManager !== 'undefined' ? TabManager.activeTabId : null,
        activePanel: typeof SidebarManager !== 'undefined' ? (SidebarManager.activePanel || SidebarManager.sidePanel || '') : '',
      };
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

  // A page finished loading in a tab while the game ran: remember its address and title for
  // the dossier offer (in memory only, until the card is made).
  noteTab(tabId) {
    if (!this._s || typeof TabManager === 'undefined') return false;
    const tab = (TabManager.tabs || []).find(t => t.id === tabId);
    if (!tab || (this._s.tabs.size >= 60 && !this._s.tabs.has(tabId))) return false;
    if (typeof GameDossier === 'undefined' || typeof GameDossier.pageSkipReason !== 'function') return false;
    if (GameDossier.pageSkipReason(tab, tab.title)) return false;
    this._s.tabs.set(tabId, { url: String(tab.url), title: String(tab.title || '').slice(0, 160) });
    return true;
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

  // ---- the four extra lines --------------------------------------------------------------
  // Patch notes pages that changed since the game began, for any game on the list.
  _patches(g) {
    if (typeof PatchRadar === 'undefined' || typeof GameSession === 'undefined' || typeof GameSession.games !== 'function') return [];
    const seen = new Map();
    for (const game of GameSession.games()) {
      for (const p of PatchRadar.pages(game.id)) {
        if (p.changedAt >= g.start) seen.set(game.id, { name: game.name, title: String(p.latest || '').slice(0, 100) });
      }
    }
    if (typeof PatchRadar.queue === 'function') {
      for (const q of PatchRadar.queue()) if (q && q.at >= g.start && !seen.has(q.gameId)) seen.set(q.gameId, { name: String(q.name || ''), title: String(q.title || '').slice(0, 100) });
    }
    return [...seen.values()].filter(x => x.name);
  },
  // A game that is free now and was not mentioned before; only with "tell me about free games" on.
  async _freeGames() {
    if (typeof FreeGames === 'undefined' || !FreeGames.tellMe()) return [];
    const list = await FreeGames.list();
    return FreeGames.fresh(list).slice(0, 3).map(x => ({ store: String(x.store || ''), title: String(x.title || '').slice(0, 80) }));
  },
  // The Discord notifications Vex kept while you played.
  _discord(g) {
    if (typeof PanelCapture === 'undefined' || typeof PanelCapture.list !== 'function') return null;
    const rows = PanelCapture.list({ source: 'discord', since: g.start });
    if (!rows.length) return null;
    const chats = new Set(rows.map(r => String(r.title || '').toLowerCase().slice(0, 80)));
    return { n: rows.length, chats: chats.size, vip: rows.filter(r => r.vip).length };
  },
  // Pages opened during the game that the dossier is not already keeping.
  _offer(g) {
    if (!g.gameId || typeof GameDossier === 'undefined' || typeof GameDossier.enabledFor !== 'function' || GameDossier.enabledFor(g.gameId)) return [];
    if (typeof GameSession === 'undefined' || !GameSession.games().some(x => x.id === g.gameId)) return [];
    return g.tabs ? [...g.tabs.values()].slice(0, this.MAX_OFFER) : [];
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

    let free = [];
    try { free = await this._freeGames(); }
    catch (err) { this._note('The free games could not be read for the card', err); }
    const card = {
      at: g.end, app: g.app || rep.app || 'A game', gameId: g.gameId, minutes: Math.round(ms / 60000),
      patches: this._patches(g), free, discord: this._discord(g), offer: this._offer(g),
      resume: { tab: g.activeTab == null ? null : g.activeTab, panel: g.activePanel || '' },
      notifications: { toasts: toasts.reduce((n, d) => n + (d.n || 1), 0), windows: os.reduce((n, d) => n + (d.n || 1), 0), inbox: rows.length },
      jobsHeld: Math.max(0, this._jobsHeld() - g.jobsAtStart),
      sync: !!(typeof GameSession !== 'undefined' && GameSession._lastResume && GameSession._lastResume.sync),
      indexing: (typeof GameSession !== 'undefined' && GameSession._lastResume && GameSession._lastResume.indexQueue) || 0,
      tabs, panels: Array.isArray(rep.panels) ? rep.panels.length : 0,
      models: rep.models || [], freedMB: rep.freedMB || 0,
      titles,
    };
    const worth = card.notifications.toasts + card.notifications.windows + card.notifications.inbox + card.jobsHeld + card.tabs.length + card.panels + card.models.length + (card.sync ? 1 : 0) + card.indexing
      + card.patches.length + card.free.length + (card.discord ? 1 : 0) + card.offer.length;
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
    if (card.patches && card.patches.length) bits.push('new patch notes for ' + card.patches.map(p => p.name).join(', '));
    if (card.free && card.free.length) bits.push(this._plural(card.free.length, 'free game'));
    if (card.discord) bits.push(this._plural(card.discord.n, 'Discord message') + ' missed');
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

  // ---- resume, and the dossier offer ---------------------------------------------------------
  canResume(card) {
    const r = card && card.resume;
    if (!r) return false;
    const tab = typeof TabManager !== 'undefined' && r.tab != null && (TabManager.tabs || []).some(t => t.id === r.tab && TabManager.activeTabId !== r.tab);
    return !!(this.sleepingNow(card).length || tab || (r.panel && typeof SidebarManager !== 'undefined' && SidebarManager.activePanel !== r.panel));
  },
  // Wake what was slept, go back to the tab that was in front and the panel that was open.
  resume(card) {
    const r = card.resume || {};
    const bits = [];
    const woke = this.wakeTabs(card);
    if (woke) bits.push('waking ' + this._plural(woke, 'tab'));
    if (typeof TabManager !== 'undefined' && r.tab != null && TabManager.activeTabId !== r.tab && (TabManager.tabs || []).some(t => t.id === r.tab)) { TabManager.switchTab(r.tab); bits.push('back to your tab'); }
    if (r.panel && typeof SidebarManager !== 'undefined' && SidebarManager.activePanel !== r.panel && typeof SidebarManager.openPanel === 'function') { SidebarManager.openPanel(r.panel); bits.push('panel reopened'); }
    if (!bits.length) throw new Error('There is nothing to resume');
    return 'Resuming: ' + bits.join(', ');
  },
  // The pages opened during the game go into the dossier only after a yes that says what is kept.
  async offerToDossier(card) {
    const pages = (card.offer || []).filter(p => p && p.url);
    if (!pages.length) throw new Error('There are no pages to add');
    if (typeof GameDossier === 'undefined') throw new Error('The game dossier is not available in this window');
    const ok = await window.vexConfirm({
      title: 'Add these pages to the ' + card.app + ' dossier?',
      message: pages.length + ' page' + (pages.length === 1 ? '' : 's') + ' you opened while you played: Vex keeps each address and title on this PC (never synced) so you can find them next time. Sign-in, payment, private and never-remember pages were already left out. You can delete any of them later from the game guide.',
      okLabel: 'Add them', cancelLabel: 'Not now',
    });
    if (!ok) return 0;
    let n = 0;
    for (const p of pages) if (GameDossier.record(card.gameId, { url: p.url, title: p.title }, card.at)) n++;
    card.offer = [];
    localStorage.setItem(this.LAST_KEY, JSON.stringify(card));
    return n;
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
    for (const p of card.patches || []) row('Patch notes: ' + p.name, p.title || 'changed');
    for (const f of card.free || []) row('Free game now', (f.store ? f.store + ': ' : '') + f.title);
    if (card.discord) row('Discord messages you missed', card.discord.n + ' in ' + this._plural(card.discord.chats, 'chat') + (card.discord.vip ? ' (' + card.discord.vip + ' from people you marked VIP)' : ''));
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
    const resumable = this.canResume(card);
    if (resumable) {
      const r = add(btns, 'button', 'gp-primary', 'Resume what I was doing');
      r.type = 'button';
      r.addEventListener('click', () => { try { const k = this.resume(card); window.showToast?.(k); this.hide(); } catch (err) { window.showToast?.(err.message, 'error'); } });
    }
    if ((card.offer || []).length) {
      const o = add(btns, 'button', null, 'Add ' + this._plural(card.offer.length, 'page') + ' to the game dossier');
      o.type = 'button';
      o.addEventListener('click', () => { this.offerToDossier(card).then(n => { if (n) { window.showToast?.('Added ' + this._plural(n, 'page') + ' to the dossier'); o.remove(); } }).catch(err => window.showToast?.(err.message, 'error')); });
    }
    const done = add(btns, 'button', asleep || resumable ? null : 'gp-primary', 'Done');
    done.type = 'button';
    done.addEventListener('click', () => this.hide());

    document.body.appendChild(root);
    if (typeof VexLayer !== 'undefined') VexLayer.track(root, { tier: 'panel', id: 'game-pitstop', keep: true });
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
    document.addEventListener('vex:tab-settled', (e) => {
      try { this.noteTab((e.detail || {}).tabId); } catch (err) { this._note('Could not note a page for the card', err); }
    });
    return true;
  },
};

if (typeof window !== 'undefined') window.GamePitstop = GamePitstop;
if (typeof module !== 'undefined' && module.exports) module.exports = { GamePitstop };
