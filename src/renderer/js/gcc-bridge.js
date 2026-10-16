// === Vex follows Game Control Center =========================================
//
// T2-068. Game Control Center (GCC) writes one small JSON file; this reads it
// (through the main process, from one fixed path) and lets Vex follow:
//
//   a game GCC says is running -> Game mode starts for it, exactly as if Vex's
//     own watcher had seen it (so the owner's answer "on / ask / off" still
//     decides; this does not force Game mode on) and Focus profiles see the game;
//   GCC says the screen is being shared -> Streamer mode is switched on, and put
//     back to what it was when GCC says it stopped;
//   GCC's profile name is shown; its clips folder appears in the clips inbox,
//     read-only, with the game and session GCC wrote against each clip.
//
// The contract of the file (path, shape, staleness) is in src/main/gcc-bridge.js
// and docs/gcc-bridge.md. GCC is not modified by this and nothing is ever written
// to GCC's folder. Off until switched on.
//
// It polls every few seconds with a self-rescheduling timer rather than
// VexJobs, because VexJobs holds every job while a game runs, and the moment
// that matters most here is the game ending. One read of a file under 64 KB.
const VexGccBridge = {
  ON_KEY: 'vex.gccBridge.enabled',
  PRIOR_KEY: 'vex.gccBridge.prior',
  EVERY_MS: 5000,

  _timer: null,
  _last: null,             // the newest read: a state, { present:false } or { error }
  _tellingFor: '',         // the game we have told Game mode about
  _started: false,         // we began Game mode (so we may end it)
  _lastError: '',

  enabled() { return VexLifeKit.flag(this.ON_KEY, false); },
  setEnabled(on) {
    VexLifeKit.setFlag(this.ON_KEY, !!on);
    if (on) this.start();
    else { this.stop(); this.release('switched off'); }
  },

  // What the last read said, for the Settings line and for other surfaces.
  snapshot() {
    const s = this._last;
    if (!s) return { state: 'not read yet' };
    if (s.error) return { state: 'error', error: s.error };
    if (!s.present) return { state: 'not running' };
    return { state: s.game && s.game.running ? 'game' : 'idle', game: s.game ? s.game.name : '', profile: s.profile || '', streamer: !!s.streamer, capture: !!s.capture, stale: !!s.stale };
  },
  profile() { const s = this._last; return s && s.present && !s.stale ? (s.profile || '') : ''; },
  clipsDir() { const s = this._last; return s && s.present && s.clipsDir ? s.clipsDir : ''; },
  // What GCC wrote against a clip file: { game, session } | null.
  clipInfo(fileName) {
    const s = this._last;
    if (!s || !s.present) return null;
    const hit = s.recentClips.find(c => c.file.toLowerCase() === String(fileName).toLowerCase());
    return hit ? { game: hit.game || '', session: hit.session || '' } : null;
  },

  // ---- one read ------------------------------------------------------------------
  async tick() {
    if (!this.enabled()) return null;
    const b = window.vex;
    if (!b || typeof b.gccBridgeRead !== 'function') throw new Error('The Game Control Center bridge is not available here');
    let st;
    try { st = await b.gccBridgeRead(); }
    catch (err) {
      this._last = { error: err.message };
      if (err.message !== this._lastError) { this._lastError = err.message; window.VexProblems?.note('Game Control Center', 'Its file could not be read: ' + err.message, err); }
      return null;
    }
    this._lastError = '';
    this._last = st;
    this.follow(st);
    return st;
  },

  follow(st) {
    const running = !!(st && st.present && st.game && st.game.running);
    this._followGame(running ? st.game : null);
    this._followStreamer(!!(st && st.present && !st.stale && st.streamer));
  },

  _followGame(game) {
    if (typeof GameSession === 'undefined') return;
    if (game) {
      const key = GameSession.exeKey(game.exe || game.name);
      if (this._tellingFor === key) return;
      this._tellingFor = key;
      // Vex's own watcher already has a game: it is the authority, nothing to add.
      if (GameSession.active) return;
      GameSession.onState({ game: true, app: game.exe || game.name, listed: true, id: '' });
      if (GameSession.active) {
        this._started = true;
        this._ledger('Started Game mode for ' + game.name, 'Game Control Center said ' + game.name + ' is running.', { kind: 'gcc-game-undo' });
      }
      if (typeof FocusProfiles !== 'undefined' && typeof FocusProfiles.setExternalGame === 'function') FocusProfiles.setExternalGame(true, game.exe || game.name);
    } else if (this._tellingFor) {
      this._tellingFor = '';
      if (typeof FocusProfiles !== 'undefined' && typeof FocusProfiles.setExternalGame === 'function') FocusProfiles.setExternalGame(false, '');
      if (this._started) {
        this._started = false;
        GameSession.onState({ game: false });
        this._ledger('Ended Game mode', 'Game Control Center said the game stopped.');
      }
    }
  },

  _followStreamer(want) {
    if (typeof GameMode === 'undefined') return;
    const saved = VexLifeKit.read(this.PRIOR_KEY, null);
    if (want && !saved && GameMode.mode() !== 'on') {
      VexLifeKit.write(this.PRIOR_KEY, { streamer: GameMode.mode() });
      GameMode.setMode('on');
      this._ledger('Turned Streamer mode on', 'Game Control Center said your screen is being shared.', { kind: 'gcc-streamer-undo' });
    } else if (!want && saved) {
      this._restoreStreamer(saved);
    }
  },
  _restoreStreamer(saved) {
    localStorage.removeItem(this.PRIOR_KEY);
    // Changed by the person in the meantime: theirs.
    if (GameMode.mode() === 'on') GameMode.setMode(saved.streamer);
  },

  _ledger(what, why, undo) {
    if (typeof VexLedger === 'undefined') return;
    VexLedger.record({ feature: 'gcc-bridge', what, why, undo });
  },

  // Put back what we changed (switched off, or at start-up after a crash).
  release(reason) {
    const saved = VexLifeKit.read(this.PRIOR_KEY, null);
    if (saved && typeof GameMode !== 'undefined') this._restoreStreamer(saved);
    if (this._started && typeof GameSession !== 'undefined') { this._started = false; GameSession.onState({ game: false }); }
    if (this._tellingFor && typeof FocusProfiles !== 'undefined' && typeof FocusProfiles.setExternalGame === 'function') FocusProfiles.setExternalGame(false, '');
    this._tellingFor = '';
    this._last = null;
    return reason;
  },

  // ---- the loop ----------------------------------------------------------------------
  start() {
    if (this._timer || !this.enabled()) return;
    const loop = async () => {
      try { await this.tick(); }
      catch (err) { window.VexProblems?.note('Game Control Center', 'The bridge stopped working', err); }
      if (this.enabled()) this._timer = setTimeout(loop, this.EVERY_MS); else this._timer = null;
    };
    this._timer = setTimeout(loop, 0);
  },
  stop() { clearTimeout(this._timer); this._timer = null; },

  // ---- Settings --------------------------------------------------------------------------
  group(el) {
    el.appendChild(VexSettingsGroups.note('Lets Vex follow Game Control Center through one small file it writes (docs/gcc-bridge.md): Game mode starts when it says a game runs, Streamer mode follows its screen sharing, and its clips folder shows in the clips inbox. Vex only reads that file; it never writes to Game Control Center.'));
    const line = document.createElement('div');
    line.className = 'vex-platform-note';
    const snap = this.snapshot();
    line.textContent = 'Now: ' + snap.state + (snap.game ? ' (' + snap.game + ')' : '') + (snap.profile ? ', profile ' + snap.profile : '') + (snap.error ? ': ' + snap.error : '');
    el.append(VexSettingsGroups.button(this.enabled() ? 'Turn the bridge off' : 'Turn the bridge on', () => { this.setEnabled(!this.enabled()); VexSettingsGroups.inject(); }, { primary: !this.enabled() }), line);
  },
};

if (typeof window !== 'undefined') {
  window.VexGccBridge = VexGccBridge;
  if (typeof VexLedger !== 'undefined') {
    VexLedger.registerUndo('gcc-game-undo', async () => { if (typeof GameSession !== 'undefined') GameSession.turnOffForNow(); });
    VexLedger.registerUndo('gcc-streamer-undo', async () => {
      const saved = VexLifeKit.read(VexGccBridge.PRIOR_KEY, null);
      if (!saved) throw new Error('Streamer mode was already put back');
      VexGccBridge._restoreStreamer(saved);
    });
  }
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({
      id: 'gcc-bridge',
      title: 'Game Control Center link',
      keywords: 'game control center gcc bridge profile streamer clips link',
      before: 'about',
      build: (el) => VexGccBridge.group(el),
    });
  }
  if (typeof VexLifeKit !== 'undefined' && typeof document !== 'undefined') {
    // A crash in the middle of a stream left Streamer mode on: put it back first.
    try { if (!VexGccBridge.enabled()) VexGccBridge.release('start-up'); else VexGccBridge.start(); }
    catch (err) { window.VexProblems?.note('Game Control Center', 'Could not set up the link', err); }
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexGccBridge };
