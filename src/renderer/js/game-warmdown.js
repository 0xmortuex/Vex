// === Pre-launch warm-down (T1-035) ===========================================
//
// A game is rarely the first thing that starts. Steam, Epic or the game's own
// launcher opens first, and for the minute before the game's window appears Vex
// is still syncing, indexing and checking for updates. This lets Vex get out of
// the way a little earlier: when a LAUNCHER from the watch list opens, and Game
// mode is on, Vex
//
//   saves what a crash would lose        (js/game-flush.js)
//   holds sync, history indexing, Recall, background AI, extension update
//     checks and its own background jobs
//   after 20 s, if the launcher is still open, sleeps background tabs the way
//     Game mode does (never the tab in front, a pinned or kept-awake tab, one
//     playing sound or on a call) and only when Game mode's consent allows it
//
// and it ends by itself: when the launcher closes, when the game starts (Game
// mode takes over), or after 15 minutes (Steam can stay open all day), with
// everything put back and the tabs it slept woken.
//
// How it knows: the process NAMES of the launchers, read by the poll Game mode
// already runs (src/main/game-mode.js) with the same list call. No new polling,
// and nothing about any program is opened or read.
//
// It acts only when Game mode is turned on (Settings › Game mode); it is its own
// switch, "Warm down when a game launcher opens", and writes a line to the
// "Why did that happen?" ledger with an Undo that ends it now.
const GameWarmdown = {
  KEY: 'vex.game.warmdown',            // 'off' turns it off
  LAUNCHERS_KEY: 'vex.game.launchers', // the list of launchers: [{ id, name, exe }]
  MAX_MS: 15 * 60 * 1000,
  SETTLE_MS: 20000,                    // a launcher that is gone in 20 s only holds work; tabs are not touched
  MAX_LAUNCHERS: 12,
  // Program names as Task Manager shows them, without .exe.
  DEFAULTS: [
    { id: 'l_steam', name: 'Steam', exe: 'steam' },
    { id: 'l_epic', name: 'Epic Games Launcher', exe: 'epicgameslauncher' },
    { id: 'l_battlenet', name: 'Battle.net', exe: 'battle.net' },
    { id: 'l_riot', name: 'Riot Client', exe: 'riotclientservices' },
    { id: 'l_ea', name: 'EA app', exe: 'eadesktop' },
    { id: 'l_ubisoft', name: 'Ubisoft Connect', exe: 'ubisoftconnect' },
    { id: 'l_gog', name: 'GOG Galaxy', exe: 'galaxyclient' },
    { id: 'l_roblox', name: 'Roblox launcher', exe: 'robloxplayerlauncher' },
  ],

  active: false,
  app: '',
  startedAt: 0,
  sleptIds: [],
  _timer: null,
  _settle: null,

  enabled() { try { return localStorage.getItem(this.KEY) !== 'off'; } catch { return true; } },
  setEnabled(on) {
    localStorage.setItem(this.KEY, on ? 'on' : 'off');
    if (!on && this.active) this.release('switched off');
    if (typeof GameSession !== 'undefined') GameSession.syncWatch();
    return !!on;
  },

  // ---- the list ------------------------------------------------------------------
  launchers() {
    let raw = null;
    try { raw = localStorage.getItem(this.LAUNCHERS_KEY); } catch (err) { throw new Error('The launcher list could not be read: ' + err.message, { cause: err }); }
    if (raw == null) return this.DEFAULTS.map(l => ({ ...l }));
    let v;
    try { v = JSON.parse(raw); } catch (err) { throw new Error('The saved launcher list is not readable: ' + err.message, { cause: err }); }
    return Array.isArray(v) ? v.filter(l => l && typeof l.id === 'string' && typeof l.exe === 'string' && l.exe) : [];
  },
  _saveLaunchers(list) { localStorage.setItem(this.LAUNCHERS_KEY, JSON.stringify(list)); },
  addLauncher({ name, exe }) {
    const key = typeof GameSession !== 'undefined' ? GameSession.exeKey(exe) : String(exe || '').trim().toLowerCase().replace(/\.exe$/, '');
    if (!key) throw new Error('Type the launcher’s program name, for example Steam.exe');
    if (!/^[\w .()+-]{1,100}$/.test(key)) throw new Error('A program name is letters, digits, spaces and . _ - ( ) +');
    const list = this.launchers();
    if (list.some(l => l.exe === key)) throw new Error('That launcher is already in the list');
    if (list.length >= this.MAX_LAUNCHERS) throw new Error('The launcher list is full (' + this.MAX_LAUNCHERS + ')');
    const l = { id: 'l_' + key.replace(/[^a-z0-9]+/g, '_'), name: String(name || '').trim().slice(0, 120) || key, exe: key };
    list.push(l);
    this._saveLaunchers(list);
    if (typeof GameSession !== 'undefined') GameSession.syncWatch();
    return l;
  },
  removeLauncher(id) {
    const list = this.launchers();
    if (!list.some(l => l.id === id)) throw new Error('That launcher is not in the list');
    this._saveLaunchers(list.filter(l => l.id !== id));
    if (typeof GameSession !== 'undefined') GameSession.syncWatch();
  },
  resetLaunchers() { localStorage.removeItem(this.LAUNCHERS_KEY); if (typeof GameSession !== 'undefined') GameSession.syncWatch(); },

  // What goes to main with the game list: launchers, marked, and never one that is
  // also a game the person listed (a listed game is a game). Only for someone whose
  // Game mode is on AND who has listed a game: that is when the process poll already
  // runs, so a launcher adds names to a read that happens anyway and starts no poll.
  watchList() {
    if (!this.enabled() || typeof GameSession === 'undefined' || GameSession.mode() !== 'on') return [];
    const listed = GameSession.games();
    if (!listed.length) return [];
    const games = listed.map(g => g.exe);
    return this.launchers().filter(l => !games.includes(l.exe)).map(l => ({ id: l.id, name: l.name, exe: l.exe, launcher: true }));
  },

  // Does the person's Game mode consent let Vex act on a launcher? Game mode on, not
  // switched off for this game, not a private window.
  _allowed() {
    if (!this.enabled()) return false;
    if (typeof GameSession === 'undefined' || GameSession.mode() !== 'on' || GameSession.suspended()) return false;
    if (window.VexTabPolicy && window.VexTabPolicy.isPrivateWindow) return false;
    return true;
  },

  _note(what, err) { if (typeof VexProblems !== 'undefined') VexProblems.note('Game mode', what, err); },
  _tellMain(on) {
    const b = window.vex;
    if (!b || typeof b.gameModeSession !== 'function' || typeof GameSession === 'undefined') return Promise.resolve(null);
    return Promise.resolve(b.gameModeSession({ on, warm: true, holds: on ? GameSession.HOLDS : [] })).catch(err => this._note('Could not tell Vex to hold update checks', err));
  },

  // ---- the state machine -------------------------------------------------------------
  // s is the newest game:state from main.
  onState(s) {
    if (!s) return 'idle';
    if (s.game) { if (this.active) this.handover(); return 'game'; }
    if (s.launcher) { if (!this.active && this._allowed()) this.start(s.launcherApp || 'a launcher'); return this.active ? 'warm' : 'ignored'; }
    if (this.active) this.release('launcher closed');
    return 'idle';
  },

  start(app) {
    if (this.active) return false;
    this.active = true;
    this.app = String(app || '');
    this.startedAt = Date.now();
    this.sleptIds = [];
    this._tellMain(true);
    this._timer = setTimeout(() => this.release('15 minutes passed'), this.MAX_MS);
    this._settle = setTimeout(() => { this._settle = null; this._sleepTabs().catch(err => this._note('Could not sleep tabs before the game', err)); }, this.SETTLE_MS);
    if (typeof VexLedger !== 'undefined') {
      VexLedger.note({
        feature: 'game-warmdown',
        what: 'Held background work because ' + this.app + ' opened',
        why: 'A launcher opened and a game usually follows. Everything comes back when it closes, when the game ends, or after 15 minutes',
        undo: { kind: 'warmdown-release' },
      });
    }
    document.dispatchEvent(new CustomEvent('vex:game-warmdown', { detail: { active: true, app: this.app } }));
    return true;
  },

  // The tabs Game mode would sleep for a game, with its consent (CommitGuard keeps the one list of who is spared).
  async _sleepTabs() {
    if (!this.active || !this._allowed()) return 0;
    if (typeof GameMode !== 'undefined' && !GameMode.gamingSetting('sleepTabs')) return 0;
    if (typeof CommitGuard === 'undefined' || typeof CommitGuard._sleepable !== 'function' || typeof TabManager === 'undefined') return 0;
    let n = 0;
    for (const tab of CommitGuard._sleepable()) {
      if (!this.active) break;
      try { await TabManager.sleepTab(tab.id); if (tab.sleeping) { this.sleptIds.push(tab.id); n++; } }
      catch (err) { this._note('Could not sleep a tab before the game', err); }
    }
    if (n && typeof VexLedger !== 'undefined') {
      VexLedger.note({ feature: 'game-warmdown', what: 'Slept ' + n + ' background tab' + (n === 1 ? '' : 's') + ' because ' + this.app + ' is open', why: 'Game mode is on and a game is about to start; they wake when it is over', undo: { kind: 'warmdown-release' } });
    }
    return n;
  },

  _stopTimers() {
    if (this._timer) clearTimeout(this._timer);
    if (this._settle) clearTimeout(this._settle);
    this._timer = this._settle = null;
  },

  // The game started: Game mode holds from here. The tabs slept now belong to the game.
  handover() {
    if (!this.active) return false;
    this._stopTimers();
    this.active = false;
    const ids = this.sleptIds;
    this.sleptIds = [];
    this._tellMain(false);
    this.handedOver = ids;           // the pit-stop panel lists them with the game's
    // Game mode's own report wakes its tabs when the game ends; add these once it exists.
    setTimeout(() => {
      try {
        const rep = typeof GameMode !== 'undefined' ? GameMode._gamingReport : null;
        if (rep && Array.isArray(rep.sleptIds)) for (const id of ids) if (!rep.sleptIds.includes(id)) { rep.sleptIds.push(id); rep.slept = (rep.slept || 0) + 1; }
      } catch (err) { this._note('Could not hand the slept tabs to Game mode', err); }
    }, 1500);
    document.dispatchEvent(new CustomEvent('vex:game-warmdown', { detail: { active: false, app: this.app, handedOver: true } }));
    return true;
  },

  // Over without a game: everything comes back.
  release(why) {
    if (!this.active) return false;
    this._stopTimers();
    this.active = false;
    const ids = this.sleptIds;
    this.sleptIds = [];
    this.handedOver = [];
    this._tellMain(false);
    if (typeof GameSession !== 'undefined' && GameSession._resume) GameSession._resume();
    if (typeof VexJobs !== 'undefined') VexJobs.resume();
    // The tabs it slept wake one at a time, as Game mode wakes its own.
    if (ids.length && typeof GameMode !== 'undefined' && GameMode.gamingSetting('wakeAfter') && typeof TabManager !== 'undefined') {
      ids.forEach((id, i) => setTimeout(() => {
        const tab = (TabManager.tabs || []).find(t => t.id === id);
        if (!tab || !tab.sleeping) return;
        try { TabManager.wakeTab(id); } catch (err) { this._note('Could not wake a tab', err); }
      }, i * (GameMode.WAKE_GAP_MS || 1500)));
    }
    document.dispatchEvent(new CustomEvent('vex:game-warmdown', { detail: { active: false, app: this.app, why } }));
    return true;
  },

  init() {
    if (this._wired) return false;
    this._wired = true;
    if (typeof VexLedger !== 'undefined') VexLedger.registerUndo('warmdown-release', async () => { this.release('undone from the ledger'); });
    return true;
  },
};

if (typeof window !== 'undefined') window.GameWarmdown = GameWarmdown;
if (typeof module !== 'undefined' && module.exports) module.exports = { GameWarmdown };
