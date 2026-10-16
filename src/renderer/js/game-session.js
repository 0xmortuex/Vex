// === Game mode: Vex gets out of a game's way, and brings its guide ===========
//
// Two things, for the games the user names (Settings › Privacy Hardening ›
// Gaming and streaming › Game mode), or any full-screen game Vex notices:
//
//   While the game runs, Vex gets out of the way. Background tabs and hidden
//   panels sleep (never the tab in front, a pinned tab, one kept awake, or one
//   playing sound or on a call); background AI, Vex Sync, history indexing,
//   page recall and extension update checks wait and catch up afterwards; Vex's
//   animations stop and its page processes run at below-normal priority. A
//   small "Game mode on" chip in the toolbar has a one-click "Turn off for
//   now".
//
//   Its guide opens. Pages saved for that game (Ctrl+K › "Add this page to a
//   game's guide") open as pinned side panels in the user's current look, and
//   close again when the game ends.
//
// What it is NOT: it never touches the game's process, injects into it or reads
// its memory — nothing an anti-cheat could see — and it does not raise the
// game's frame rate. It stops Vex using CPU, memory and network the game could
// have had.
//
// Everything it does while a game runs is for that game only and is put back
// exactly when it ends (also if Vex starts while the game is already running,
// and after a crash — nothing is written to the profile). The only things
// saved are the user's own choices: the switch, the game list and the guide
// pages.
//
// The decisions live here; the two things only the main process can do — notice
// a program by its name, and lower Vex's own process priority — are in
// src/main/game-mode.js.
const GameSession = {
  KEYS: { mode: 'vex.gameMode', games: 'vex.gameMode.games', pages: 'vex.gameMode.pages' },
  // What waits during a game. 'extensionUpdates' is held in main; the rest are
  // read through holds() by the sync engine, the history indexer and Recall.
  HOLDS: ['extensionUpdates', 'sync', 'indexing', 'recall'],
  MAX_GAMES: 50,
  MAX_PAGES: 12,

  active: false,
  app: '',
  gameId: '',
  _suspended: false,        // "Turn off for now": until this game ends
  _asked: false,
  _last: null,              // the newest game:state from main
  _guide: null,             // { ids, prevActive, prevSide } while the guide is open
  _calm: false,             // we set data-reduce-motion ourselves
  _wired: false,

  _t(s) { try { return (typeof VexI18nUI !== 'undefined' && VexI18nUI.lookup(s)) || s; } catch { return s; } },
  _note(what, err) { window.VexProblems?.note('Game mode', what, err); },

  // ---- what the user chose (the only things saved) ---------------------------
  // 'ask' until they answer; 'on' and 'off' are remembered.
  mode() {
    try { const v = localStorage.getItem(this.KEYS.mode); return v === 'on' || v === 'off' ? v : 'ask'; }
    catch { return 'ask'; }
  },
  enabled() { return this.mode() === 'on'; },
  setMode(mode) {
    if (mode !== 'on' && mode !== 'off') throw new Error('Game mode is on or off; it asks only until you answer');
    try { localStorage.setItem(this.KEYS.mode, mode); }
    catch (err) { this._note('Could not save the Game mode choice', err); throw new Error('Game mode could not save your choice: ' + err.message); }
    this.syncWatch();
    // Turned on while a game is already running: it starts now. Turned off:
    // whatever it did is put back now.
    const s = this._last;
    if (mode === 'on' && s && s.game && !this.active && !this._suspended) this.begin(s);
    if (mode === 'off' && this.active) this.end();
    return mode;
  },

  _read(key, fallback) {
    let raw = null;
    try { raw = localStorage.getItem(key); } catch { return fallback; }
    if (raw == null || raw === '') return fallback;
    try { return JSON.parse(raw); }
    catch (err) { this._note('A saved Game mode list could not be read and was ignored', err); return fallback; }
  },
  _write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch (err) { this._note('Could not save the Game mode list', err); throw new Error('Could not save: ' + err.message); }
  },

  games() {
    const list = this._read(this.KEYS.games, []);
    return Array.isArray(list) ? list.filter(g => g && typeof g.id === 'string' && typeof g.exe === 'string' && g.exe) : [];
  },
  pagesByGame() {
    const o = this._read(this.KEYS.pages, {});
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  },
  pages(gameId) {
    const list = this.pagesByGame()[gameId];
    return Array.isArray(list) ? list.filter(p => p && /^https?:\/\//i.test(String(p.url || ''))) : [];
  },

  // "C:\Games\Foo\Foo.exe", "foo.EXE" and "Foo" are one program.
  exeKey(v) { return String(v || '').trim().toLowerCase().replace(/^.*[\\/]/, '').replace(/\.exe$/, ''); },

  addGame({ name, exe }) {
    const key = this.exeKey(exe);
    if (!key) throw new Error('Type the game’s program name, for example RobloxPlayerBeta.exe');
    if (!/^[\w .()+-]{1,100}$/.test(key)) throw new Error('A program name is letters, digits, spaces and . _ - ( ) +');
    const list = this.games();
    if (list.some(g => this.exeKey(g.exe) === key)) throw new Error('That game is already in the list');
    if (list.length >= this.MAX_GAMES) throw new Error('The game list is full (' + this.MAX_GAMES + ')');
    const game = { id: 'g_' + key.replace(/[^a-z0-9]+/g, '_'), name: String(name || '').trim().slice(0, 120) || key, exe: key };
    list.push(game);
    this._write(this.KEYS.games, list);
    this.syncWatch();
    return game;
  },
  removeGame(id) {
    const list = this.games();
    if (!list.some(g => g.id === id)) throw new Error('That game is not in the list');
    this._write(this.KEYS.games, list.filter(g => g.id !== id));
    const pages = this.pagesByGame();
    if (pages[id]) { delete pages[id]; this._write(this.KEYS.pages, pages); }
    // Its automatic dossier goes with it (js/game-dossier.js).
    if (typeof GameDossier !== 'undefined') GameDossier.forgetGame(id);
    if (typeof PatchRadar !== 'undefined') PatchRadar.forgetGame(id);
    if (this.active && this.gameId === id) this.closeGuide();
    this.syncWatch();
  },

  addPage(gameId, { url, title }) {
    const game = this.games().find(g => g.id === gameId);
    if (!game) throw new Error('That game is not in the list');
    let clean;
    try { const u = new URL(String(url)); if (!/^https?:$/.test(u.protocol)) throw new Error('not http'); clean = u.href; }
    catch { throw new Error('Only a web page (https://…) can go in a game’s guide'); }
    const all = this.pagesByGame();
    const list = Array.isArray(all[gameId]) ? all[gameId] : [];
    if (list.some(p => p.url === clean)) throw new Error('That page is already in ' + game.name + '’s guide');
    if (list.length >= this.MAX_PAGES) throw new Error(game.name + '’s guide is full (' + this.MAX_PAGES + ' pages)');
    const page = { url: clean, title: String(title || '').trim().slice(0, 160) || new URL(clean).hostname };
    list.push(page);
    all[gameId] = list;
    this._write(this.KEYS.pages, all);
    // The game is running now: the page is there at once.
    if (this.active && this.gameId === gameId && this._guide) this._mountPage(game, page, list.length - 1);
    return { game, page };
  },
  removePage(gameId, url) {
    const all = this.pagesByGame();
    const list = Array.isArray(all[gameId]) ? all[gameId] : [];
    all[gameId] = list.filter(p => p.url !== url);
    this._write(this.KEYS.pages, all);
    if (this.active && this.gameId === gameId) { this.closeGuide(); this.openGuide(); }
  },

  // The user's own saved values are checked once at start: a corrupt list is
  // dropped (and said in Problems) rather than breaking the feature. Nothing
  // else is migrated — the Gaming switches (vex.game.*) are left exactly as
  // they are, and a profile that never saw Game mode simply asks on its first
  // game.
  migrate() {
    const changed = [];
    for (const [key, want] of [[this.KEYS.games, Array.isArray], [this.KEYS.pages, v => !!v && typeof v === 'object' && !Array.isArray(v)]]) {
      let raw = null;
      try { raw = localStorage.getItem(key); } catch { continue; }
      if (raw == null) continue;
      let ok = false;
      try { ok = want(JSON.parse(raw)); } catch { ok = false; }
      if (!ok) {
        try { localStorage.removeItem(key); changed.push(key); } catch (err) { this._note('Could not drop an unreadable Game mode list', err); }
      }
    }
    try {
      const m = localStorage.getItem(this.KEYS.mode);
      if (m != null && m !== 'on' && m !== 'off') { localStorage.removeItem(this.KEYS.mode); changed.push(this.KEYS.mode); }
    } catch { /* storage unreadable: mode() already says ask */ }
    return changed;
  },

  // ---- what the legacy gaming code asks us -----------------------------------
  // May Game mode's own consent stand in for "Before Vex puts anything to sleep
  // on its own"? Turning Game mode on is that consent, for games only.
  sleepAllowed() { return this.enabled() && !this._suspended; },
  suspended() { return this._suspended; },
  // Is this kind of work waiting right now? (sync engine, history indexer, Recall)
  // A launcher is open and Game mode is on: the same work waits (js/game-warmdown.js).
  holds(kind) { return (this.active || (typeof GameWarmdown !== 'undefined' && GameWarmdown.active)) && this.HOLDS.includes(kind); },

  // Should the older full-screen gaming code run for this state? A full-screen
  // game always did; a game that is only on the list does when Game mode is on.
  legacyWants(s) {
    if (!s || !s.game) return false;
    if (typeof s.fullscreen === 'undefined') return true;   // an older main
    if (this._suspended) return false;
    return !!(s.fullscreen || (s.listed && this.enabled()));
  },

  // ---- the state machine -----------------------------------------------------
  onState(s) {
    this._last = s || { game: false };
    // The helpers around Game mode hear the same news first (js/game-helpers.js).
    if (typeof GameHelpers !== 'undefined') GameHelpers.onState(s);
    const game = !!(s && s.game);
    if (!game) {
      this._suspended = false;
      this._asked = false;
      if (this.active) this.end();
      return 'idle';
    }
    if (this.active) {
      // The same game under another name (a launcher handing over): keep going.
      this.app = s.app || this.app;
      return 'running';
    }
    if (this._suspended) return 'off-for-now';
    const mode = this.mode();
    if (mode === 'on') { this.begin(s); return 'running'; }
    if (mode === 'ask') { this._askLater(s); return 'asking'; }
    return 'off';
  },

  _gameFor(s) {
    const games = this.games();
    if (s && s.id) { const hit = games.find(g => g.id === s.id); if (hit) return hit; }
    const key = this.exeKey(s && s.app);
    return games.find(g => this.exeKey(g.exe) === key || this.exeKey(g.name) === key) || null;
  },

  begin(s) {
    if (this.active) return false;
    if (window.VexTabPolicy && window.VexTabPolicy.isPrivateWindow) return false;   // a private window is not the one that plays
    const game = this._gameFor(s);
    this.active = true;
    this._suspended = false;
    this.app = (s && s.app) || (game && game.name) || '';
    this.gameId = game ? game.id : '';
    // Animations: the Reduce motion machinery, for this game only. The saved
    // setting (vex.reduceMotion) is not touched.
    const html = document.documentElement;
    if (!html.hasAttribute('data-reduce-motion')) { html.setAttribute('data-reduce-motion', ''); this._calm = true; }
    document.body.classList.add('vex-game-mode');
    this._chip(true);
    // The older gaming code does the sleeping, freeing the graphics card and
    // holding AI; asking it here makes it work whichever listener ran first.
    try {
      if (typeof GameMode !== 'undefined' && GameMode.onGameStart) {
        Promise.resolve(GameMode.onGameStart(this.app)).catch(err => this._note('Could not start the gaming behaviours', err));
      }
    } catch (err) { this._note('Could not start the gaming behaviours', err); }
    this._tellMain({ on: true, app: this.app, holds: this.HOLDS });
    try { this.openGuide(); } catch (err) { this._note('Could not open the guide', err); }
    document.dispatchEvent(new CustomEvent('vex:game-mode', { detail: { active: true, app: this.app, gameId: this.gameId } }));
    return true;
  },

  end() {
    if (!this.active) return false;
    this.active = false;
    const was = { app: this.app, gameId: this.gameId };
    this.app = '';
    this.gameId = '';
    try { this.closeGuide(); } catch (err) { this._note('Could not close the guide', err); }
    if (this._calm) { document.documentElement.removeAttribute('data-reduce-motion'); this._calm = false; }
    // Reduce motion set by the user is left as it is; if they turned it on
    // while the game ran, it is theirs.
    if (typeof ReduceMotion !== 'undefined' && ReduceMotion.apply) { try { ReduceMotion.apply(); } catch (err) { this._note('Could not restore Reduce motion', err); } }
    document.body.classList.remove('vex-game-mode');
    this._chip(false);
    this._tellMain({ on: false });
    try { if (typeof GameMode !== 'undefined' && GameMode.onGameEnd) GameMode.onGameEnd(); }
    catch (err) { this._note('Could not restore after the game', err); }
    this._resume();
    document.dispatchEvent(new CustomEvent('vex:game-mode', { detail: { active: false, app: was.app, gameId: was.gameId } }));
    return true;
  },

  // Work that was held, once: one sync round, and the history queue picks up.
  _resume() {
    // What was owed, kept for the after-game card (js/game-pitstop.js).
    const r = { sync: false, indexQueue: 0 };
    try { if (window.SyncEngine && SyncEngine.resumeAfterGame) r.sync = SyncEngine.resumeAfterGame() === true; }
    catch (err) { this._note('Could not catch Vex Sync up', err); }
    try { if (window.HistoryIndexer && HistoryIndexer.resume) r.indexQueue = Number(HistoryIndexer.resume()) || 0; }
    catch (err) { this._note('Could not catch the history index up', err); }
    this._lastResume = r;
  },

  // The chip's button: all of it comes back now, for the rest of this game.
  turnOffForNow() {
    if (!this.active) return false;
    this._suspended = true;
    this.end();
    window.showToast?.(this._t('Game mode is off until this game ends'));
    return true;
  },

  _tellMain(payload) {
    const b = window.vex;
    if (!b || typeof b.gameModeSession !== 'function') return Promise.resolve(null);
    return Promise.resolve(b.gameModeSession(payload)).catch(err => this._note('Could not tell Vex to lower its priority', err));
  },

  // The list of games to watch for goes to main whenever it, or the switch,
  // changes. Nothing is watched once the user has said no.
  syncWatch() {
    const b = window.vex;
    if (!b || typeof b.gameModeGames !== 'function') return Promise.resolve(null);
    const games = this.games().map(g => ({ id: g.id, name: g.name, exe: g.exe }));
    // Launchers (Steam, Epic ...) ride the same list, marked, for the pre-launch warm-down.
    const launchers = typeof GameWarmdown !== 'undefined' ? GameWarmdown.watchList() : [];
    const all = games.concat(launchers);
    return Promise.resolve(b.gameModeGames(all, this.mode() !== 'off' && all.length > 0))
      .catch(err => this._note('Could not watch for your games', err));
  },

  // ---- the first game: ask once, when somebody is there to answer ------------
  // "Not now" is about THIS app, THIS time: the choice stays "ask", and the app
  // is not asked about again until Vex restarts (_declined is never saved). A
  // different full-screen app asks again. "Don't ask again" is the permanent
  // answer and the only one that saves 'off'.
  _declined: new Set(),
  _askLater(s) {
    if (this._asked) return false;
    const key = this.exeKey(s && s.app);
    if (key && this._declined.has(key)) return false;
    this._asked = true;
    const ask = async () => {
      if (this.mode() !== 'ask') return;
      const game = this._gameFor(s);
      const listed = !!(game || (s && s.listed));
      const shown = (game && game.name) || (s && s.app) || '';
      // Whole sentences, so each can be translated as one; {app} is filled in after.
      const named = !!shown;
      const text = listed
        ? (named ? '{app} is running. Game mode makes Vex stay out of its way while it does: background tabs sleep, sync, AI tasks and indexing wait, and Vex runs quieter. It never touches the game itself. Everything comes back when the game ends.'
          : 'A game is running. Game mode makes Vex stay out of its way while it does: background tabs sleep, sync, AI tasks and indexing wait, and Vex runs quieter. It never touches the game itself. Everything comes back when the game ends.')
        : (named ? 'A full-screen app ({app}) is in front. If it is a game, Game mode makes Vex stay out of its way while you play: background tabs sleep, sync, AI tasks and indexing wait, and Vex runs quieter. It never touches the game itself. Everything comes back when it ends.'
          : 'A full-screen app is in front. If it is a game, Game mode makes Vex stay out of its way while you play: background tabs sleep, sync, AI tasks and indexing wait, and Vex runs quieter. It never touches the game itself. Everything comes back when it ends.');
      const message = this._t(text).split('{app}').join(shown);
      let never = false;
      let yes;
      try {
        yes = await window.vexConfirm({
          title: this._t('Turn on Game mode?'),
          message,
          okLabel: this._t('Turn on'),
          cancelLabel: this._t('Not now'),
          extra: { label: this._t('Don’t ask again'), run: () => { never = true; this.setMode('off'); } },
        });
      } catch (err) { this._note('The Game mode question failed', err); return; }
      if (never) { window.showToast?.(this._t('Game mode is off — Settings › Privacy Hardening › Gaming and streaming turns it on')); return; }
      if (yes) {
        this.setMode('on');
        window.showToast?.(this._t('Game mode is on — Settings › Privacy Hardening › Gaming and streaming changes it'));
        return;
      }
      if (key) this._declined.add(key);
      window.showToast?.(this._t('Vex will ask again for a different app. To stop being asked, choose “Don’t ask again” in the question, or turn Game mode off in Settings › Privacy Hardening › Gaming and streaming'));
    };
    // A full-screen game has the screen: the question waits for Vex to be seen.
    const when = () => document.visibilityState === 'visible' && (typeof document.hasFocus !== 'function' || document.hasFocus());
    if (when()) { setTimeout(ask, 0); return true; }
    const onShow = () => { if (!when()) return; document.removeEventListener('visibilitychange', onShow); window.removeEventListener('focus', onShow); ask(); };
    document.addEventListener('visibilitychange', onShow);
    window.addEventListener('focus', onShow);
    return true;
  },

  // ---- the guide --------------------------------------------------------------
  _mountPage(game, page, index, label) {
    const id = SidebarManager.TEMPORARY_PREFIX + game.id + '_' + index;
    SidebarManager.mountTemporarySitePanel({ id, name: game.name + (label || ' guide' + (index ? ' ' + (index + 1) : '')) + ' — ' + page.title, url: page.url });
    this._guide.ids.push(id);
    return id;
  },

  openGuide() {
    if (this._guide || !this.active || !this.gameId) return false;
    if (typeof SidebarManager === 'undefined') return false;
    const game = this.games().find(g => g.id === this.gameId);
    const pages = game ? this.pages(game.id) : [];
    // Recently used pages from the game's dossier, when the user asked for them.
    const extra = game && typeof GameDossier !== 'undefined' ? GameDossier.suggestions(game.id) : [];
    if (!pages.length && !extra.length) return false;
    this._guide = { ids: [], prevActive: SidebarManager.activePanel || null };
    pages.forEach((p, i) => this._mountPage(game, p, i));
    extra.forEach((p, i) => this._mountPage(game, p, 100 + i, ' suggested'));
    const first = this._guide.ids[0];
    // Beside what is open when it can sit there; instead of it when it cannot.
    if (SidebarManager.activePanel && SidebarManager._canSit && SidebarManager._canSit(first) && SidebarManager._canSit(SidebarManager.activePanel)) SidebarManager.openBeside(first);
    else SidebarManager.showPanel(first);
    return true;
  },

  closeGuide() {
    const g = this._guide;
    if (!g) return false;
    this._guide = null;
    const wasFront = g.ids.includes(SidebarManager.activePanel);
    for (const id of g.ids) SidebarManager.unmountSitePanel(id);
    // The guide had taken the place of a panel: that panel comes back.
    if (wasFront && g.prevActive && document.getElementById('panel-' + g.prevActive)) SidebarManager.showPanel(g.prevActive);
    return true;
  },

  // ---- Ctrl+K: Add this page to <game>'s guide -------------------------------
  // The one game the page would go to without asking: the running one, else the
  // only one there is.
  defaultGame() {
    const games = this.games();
    if (this.active && this.gameId) { const g = games.find(x => x.id === this.gameId); if (g) return g; }
    return games.length === 1 ? games[0] : null;
  },
  addPageLabel() {
    const g = this.defaultGame();
    return g ? 'Add this page to ' + g.name + '’s guide' : 'Add this page to a game’s guide';
  },
  async addCurrentPage() {
    const tab = typeof TabManager !== 'undefined' ? TabManager.getActiveTab() : null;
    if (!tab || !/^https?:\/\//i.test(String(tab.url || ''))) throw new Error('Open a web page first');
    const games = this.games();
    if (!games.length) throw new Error('Add a game first — Settings › Privacy Hardening › Gaming and streaming › Game mode');
    let game = this.defaultGame();
    if (!game) {
      const answer = await window.vexPrompt({
        title: this._t('Add this page to which game?'),
        message: games.map(g => g.name).join(', '),
        okLabel: this._t('Add'),
      });
      if (answer == null) return null;
      const key = this.exeKey(answer);
      game = games.find(g => this.exeKey(g.name) === key || this.exeKey(g.exe) === key);
      if (!game) throw new Error('No game called “' + String(answer).trim() + '” in your list');
    }
    const r = this.addPage(game.id, { url: tab.url, title: tab.title });
    window.showToast?.('Added to ' + game.name + '’s guide');
    return r;
  },

  // ---- the chip ----------------------------------------------------------------
  _chip(on) {
    const el = document.getElementById('game-mode-chip');
    if (!el) return;
    if (!el.dataset.wired) {
      el.dataset.wired = '1';
      const icon = el.querySelector('.game-mode-chip-icon');
      if (icon && window.VexIcons) icon.innerHTML = VexIcons.svg('gamepad', { size: 14 });
      el.querySelector('#game-mode-off')?.addEventListener('click', () => this.turnOffForNow());
    }
    el.hidden = !on;
    if (on) el.title = this._t('Vex is staying out of the way of ') + (this.app || this._t('your game'));
  },

  // ---- start ---------------------------------------------------------------
  init() {
    if (this._wired) return false;
    this._wired = true;
    try {
      const dropped = this.migrate();
      if (dropped.length) console.warn('[GameMode] dropped unreadable saved values:', dropped.join(', '));
    } catch (err) { this._note('Could not check the saved Game mode values', err); }
    const b = window.vex;
    if (!b || typeof b.onGameState !== 'function') return false;
    b.onGameState((s) => this.onState(s));
    // A renderer that reloaded mid-game finds main still holding the last
    // session: end it first, and begin again only if the game is still there.
    const start = async () => {
      try { if (typeof b.gameModeSession === 'function') await b.gameModeSession({ on: false }); }
      catch (err) { this._note('Could not reset the previous Game mode session', err); }
      await this.syncWatch();
      // Vex started while the game was already running.
      if (typeof b.gameState === 'function') {
        try { const s = await b.gameState(); if (s && s.game) this.onState(s); }
        catch (err) { this._note('Could not read whether a game is running', err); }
      }
    };
    return start();
  },

  // ---- Settings --------------------------------------------------------------
  renderSettings(host) {
    host = host || document.getElementById('game-session-settings');
    if (!host) return;
    const t = (s) => this._t(s);
    host.innerHTML = '';
    const add = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el; };

    const row = add('div', 'setting-toggle-row');
    const label = add('span', null, t('Game mode'));
    const sw = document.createElement('label');
    sw.className = 'toggle';
    sw.innerHTML = '<input type="checkbox" id="setting-game-session" aria-label="Game mode"><span class="toggle-slider"></span>';
    const box = sw.querySelector('input');
    box.checked = this.enabled();
    box.addEventListener('change', () => {
      try { this.setMode(box.checked ? 'on' : 'off'); }
      catch (err) { box.checked = !box.checked; window.showToast?.(err.message, 'error'); }
      this.renderSettings(host);
    });
    row.append(label, sw);
    host.appendChild(row);
    if (this.mode() === 'ask') host.appendChild(add('p', 'setting-info muted', t('Off for now — Vex asks once, the first time a game starts.')));

    const what = add('p', 'setting-info muted');
    what.textContent = t('What it does while a game runs: background tabs and hidden panels sleep (never the tab in front, a pinned tab, one kept awake, or one playing sound or on a call); background AI tasks, Vex Sync, history indexing, page recall and extension update checks wait and catch up afterwards; Vex stops its own animations and its page processes run at below-normal priority. Nothing you play or listen to is muted or blocked, and a chip in the toolbar turns it off for the rest of the game.');
    host.appendChild(what);
    const not = add('p', 'setting-info muted');
    not.textContent = t('What it does not do: it never touches the game — no injection, no reading its memory, nothing an anti-cheat could see — and it does not raise your frame rate. It frees the CPU, memory and network Vex would have used. Everything is put back exactly when the game ends; nothing it does is saved to your profile.');
    host.appendChild(not);
    // Commit-charge guard (js/commit-guard.js): its own switch, on unless turned off.
    if (typeof CommitGuard !== 'undefined') {
      const grow = add('div', 'setting-toggle-row');
      const glabel = add('span', null, t('Protect Windows from running out of memory'));
      glabel.title = t('If Windows has less than about 8 GB of memory left to promise while a game runs, Vex sleeps its own tabs, unloads its AI model and holds its background work, and tells you once. It never touches the game or any other program.');
      const gsw = document.createElement('label');
      gsw.className = 'toggle';
      gsw.innerHTML = '<input type="checkbox" id="setting-commit-guard" aria-label="Protect Windows from running out of memory"><span class="toggle-slider"></span>';
      const gbox = gsw.querySelector('input');
      gbox.checked = CommitGuard.enabled();
      gbox.addEventListener('change', () => {
        try { CommitGuard.setEnabled(gbox.checked); }
        catch (err) { gbox.checked = !gbox.checked; window.showToast?.(err.message, 'error'); }
      });
      grow.append(glabel, gsw);
      host.appendChild(grow);
    }
    if (typeof GameDossier !== 'undefined') GameDossier.renderGlobal(host);

    const games = this.games();
    const head = add('div', 'setting-label');
    head.appendChild(add('strong', null, t('My games')));
    head.appendChild(add('span', 'setting-hint', t('Game mode starts for these programs, and for any full-screen game Vex notices. Give the program name as Task Manager shows it, for example RobloxPlayerBeta.exe.')));
    host.appendChild(head);
    if (!games.length) host.appendChild(add('p', 'setting-info muted', t('No games yet.')));
    const failed = (err) => window.showToast?.((err && err.message) || String(err), 'error');
    for (const g of games) {
      const wrap = add('div', 'gs-game');
      const top = add('div', 'setting-toggle-row');
      const name = add('span', null, g.name + ' — ' + g.exe + '.exe');
      const btns = add('span', 'gs-btns');
      const pagesBtn = add('button', 'btn-secondary', t('Guide pages') + ' (' + this.pages(g.id).length + ')');
      pagesBtn.type = 'button';
      const rm = add('button', 'btn-secondary', t('Remove'));
      rm.type = 'button';
      rm.addEventListener('click', async () => {
        const ok = await window.vexConfirm({ title: t('Remove this game?'), message: g.name + ' — ' + t('its guide pages are removed too.'), okLabel: t('Remove') });
        if (!ok) return;
        try { this.removeGame(g.id); } catch (err) { failed(err); }
        this.renderSettings(host);
      });
      btns.append(pagesBtn, rm);
      top.append(name, btns);
      wrap.appendChild(top);
      const list = add('div', 'gs-pages');
      list.hidden = true;
      pagesBtn.addEventListener('click', () => { list.hidden = !list.hidden; });
      for (const p of this.pages(g.id)) {
        const r = add('div', 'setting-toggle-row');
        r.appendChild(add('span', null, p.title + ' — ' + p.url));
        const x = add('button', 'btn-secondary', t('Remove'));
        x.type = 'button';
        x.addEventListener('click', () => { try { this.removePage(g.id, p.url); } catch (err) { failed(err); } this.renderSettings(host); });
        r.appendChild(x);
        list.appendChild(r);
      }
      const addHere = add('button', 'btn-secondary', t('Add the page in front'));
      addHere.type = 'button';
      addHere.addEventListener('click', () => {
        try {
          const tab = typeof TabManager !== 'undefined' ? TabManager.getActiveTab() : null;
          if (!tab) throw new Error('Open a web page first');
          this.addPage(g.id, { url: tab.url, title: tab.title });
          window.showToast?.('Added to ' + g.name + '’s guide');
        } catch (err) { failed(err); }
        this.renderSettings(host);
      });
      list.appendChild(addHere);
      wrap.appendChild(list);
      if (typeof GameDossier !== 'undefined') GameDossier.renderGame(wrap, g, () => this.renderSettings(host));
      if (typeof PatchRadar !== 'undefined') PatchRadar.renderGame(wrap, g, () => this.renderSettings(host));
      host.appendChild(wrap);
    }

    const addBtn = add('button', 'btn-secondary', t('Add a game…'));
    addBtn.type = 'button';
    addBtn.addEventListener('click', async () => {
      try {
        const exe = await window.vexPrompt({ title: t('Add a game'), label: t('Program name'), message: t('As Task Manager shows it, for example RobloxPlayerBeta.exe'), okLabel: t('Next') });
        if (exe == null) return;
        const key = this.exeKey(exe);
        const name = await window.vexPrompt({ title: t('Add a game'), label: t('Name'), value: key, okLabel: t('Add') });
        if (name == null) return;
        this.addGame({ name, exe });
      } catch (err) { failed(err); }
      this.renderSettings(host);
    });
    host.appendChild(addBtn);
    // The game Vex has just seen full screen, one click away.
    const s = this._last;
    if (s && s.game && s.app && !s.listed) {
      const quick = add('button', 'btn-secondary', t('Add the running game') + ' (' + s.app + ')');
      quick.type = 'button';
      quick.style.marginLeft = '8px';
      quick.addEventListener('click', () => { try { this.addGame({ name: s.app, exe: s.app }); } catch (err) { failed(err); } this.renderSettings(host); });
      host.appendChild(quick);
    }
    if (typeof VexI18nUI !== 'undefined' && VexI18nUI.translateEl) { try { VexI18nUI.translateEl(host); } catch { /* English stays */ } }
  },
};

if (typeof window !== 'undefined') window.GameSession = GameSession;
if (typeof module !== 'undefined' && module.exports) module.exports = { GameSession };
