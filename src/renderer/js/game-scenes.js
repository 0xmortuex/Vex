// === Per-game audio scenes and the floating video's memory ===================
//
// T2-059. When a game starts, Vex's OWN sound can follow a scene the person set
// for that game: "Marvel: Vex 20 percent", "Arc Raiders: muted". When the game
// ends the sound goes back to exactly what it was. The floating video (PiP)
// remembers where it was put for each game, and, if asked, hides itself while a
// game is fullscreen so it can never sit over one.
//
// It touches Vex's own pages only (MasterVolume, the same slider as Ctrl+K
// "Master Volume"). It never reads, hooks or changes a game or the system mixer;
// it knows a game is running from the program name Game mode already watches.
//
// Safety, in order:
//   - off until switched on; nothing happens for a game with no scene;
//   - the volume that was in force is saved BEFORE it is changed
//     (vex.gameScenes.prior), put back when the game ends, and put back at
//     start-up if Vex was closed in the middle of a game;
//   - if the person moved the slider themselves during the game, theirs wins:
//     the old level is not forced back over it;
//   - what it did is in "Why did that happen?" with an Undo.
const GameScenes = {
  KEY: 'vex.gameScenes',
  ON_KEY: 'vex.gameScenes.enabled',
  PRIOR_KEY: 'vex.gameScenes.prior',
  MAX_PERCENT: 500,

  // ---- what the person chose ---------------------------------------------------
  enabled() { return VexLifeKit.flag(this.ON_KEY, false); },
  setEnabled(on) {
    VexLifeKit.setFlag(this.ON_KEY, !!on);
    if (!on) { try { this.restore('switched off'); } catch (err) { window.VexProblems?.note('Game scenes', 'Could not put the sound back', err); } }
    this.syncPip();
  },
  data() {
    const d = VexLifeKit.read(this.KEY, null);
    return d && typeof d === 'object' && d.scenes ? d : { v: 1, scenes: {}, pip: { hideOverGame: false } };
  },
  save(d) { VexLifeKit.write(this.KEY, d); },
  // gameId -> { volume: percent | null, mute: bool }
  scene(gameId) { return this.data().scenes[gameId] || null; },
  setScene(gameId, { volume, mute }) {
    if (!gameId) throw new Error('Choose a game first');
    let v = null;
    if (volume !== null && volume !== undefined && volume !== '') {
      v = Number(volume);
      if (!Number.isFinite(v) || v < 0 || v > this.MAX_PERCENT) throw new Error('Volume is a number from 0 to ' + this.MAX_PERCENT);
    }
    const d = this.data();
    if (v === null && !mute) delete d.scenes[gameId];
    else d.scenes[gameId] = { volume: v, mute: !!mute };
    this.save(d);
    return d.scenes[gameId] || null;
  },
  hideOverGame() { return this.data().pip.hideOverGame === true; },
  setHideOverGame(on) { const d = this.data(); d.pip = { ...d.pip, hideOverGame: !!on }; this.save(d); this.syncPip(); },

  // ---- the sound ---------------------------------------------------------------
  // What a scene means as a Master Volume level (1 = 100%).
  levelFor(scene) {
    if (!scene) return null;
    if (scene.mute) return 0;
    return scene.volume == null ? null : scene.volume / 100;
  },

  apply(gameId, app) {
    if (!this.enabled() || !gameId) return false;
    if (typeof MasterVolume === 'undefined') throw new Error('Master volume is not available');
    const scene = this.scene(gameId);
    const level = this.levelFor(scene);
    if (level === null) return false;
    const prior = VexLifeKit.read(this.PRIOR_KEY, null);
    const before = prior ? prior.before : MasterVolume.level();
    VexLifeKit.write(this.PRIOR_KEY, { before, set: level, gameId });
    MasterVolume.apply(level);
    const name = app || gameId;
    if (typeof VexLedger !== 'undefined') {
      VexLedger.record({
        feature: 'game-scenes',
        what: 'Set Vex’s sound to ' + (scene.mute ? 'muted' : Math.round(level * 100) + '%') + ' for ' + name,
        why: 'You gave ' + name + ' an audio scene. It goes back to ' + Math.round(before * 100) + '% when the game ends.',
        undo: { kind: 'game-scene-restore' },
      });
    }
    return true;
  },

  // Put the sound back. Not forced over a slider the person moved themselves.
  restore(reason) {
    const prior = VexLifeKit.read(this.PRIOR_KEY, null);
    if (!prior) return false;
    localStorage.removeItem(this.PRIOR_KEY);
    if (typeof MasterVolume === 'undefined') throw new Error('Master volume is not available');
    if (Math.abs(MasterVolume.level() - prior.set) > 0.001) return false;     // theirs now
    MasterVolume.apply(prior.before);
    return reason || true;
  },

  // ---- the floating video --------------------------------------------------------
  keyOf(app) { return typeof GameSession !== 'undefined' ? GameSession.exeKey(app) : String(app || '').toLowerCase(); },
  syncPip(app) {
    const b = window.vex;
    if (!b || typeof b.pipMemory !== 'function') return Promise.resolve(null);
    const on = this.enabled();
    return Promise.resolve(b.pipMemory({ context: on && app ? this.keyOf(app) : '', hideOverGame: on && this.hideOverGame() }))
      .catch(err => window.VexProblems?.note('Game scenes', 'Could not tell the floating video about the game', err));
  },

  // ---- the game starting and ending ---------------------------------------------
  onGame(detail) {
    if (!detail) return;
    if (detail.active) {
      try { this.apply(detail.gameId, detail.app); }
      catch (err) { window.VexProblems?.note('Game scenes', 'Could not apply the scene', err); }
      this.syncPip(detail.app);
    } else {
      try { this.restore('game ended'); }
      catch (err) { window.VexProblems?.note('Game scenes', 'Could not put the sound back', err); }
      this.syncPip('');
    }
  },

  start() {
    if (this._started) return;
    this._started = true;
    document.addEventListener('vex:game-mode', (e) => this.onGame(e.detail));
    // Vex was closed in the middle of a game: the sound is still the scene's.
    const active = typeof GameSession !== 'undefined' && GameSession.active;
    if (!active) {
      try { this.restore('start-up'); }
      catch (err) { window.VexProblems?.note('Game scenes', 'Could not put the sound back after a restart', err); }
    }
    this.syncPip(active ? GameSession.app : '');
  },

  // ---- Settings ---------------------------------------------------------------------
  group(el) {
    el.appendChild(VexSettingsGroups.note('Vex’s own sound for each game, put back when the game ends. The floating video remembers its place for each game and can hide while a game is fullscreen. Nothing here touches a game or the Windows mixer.'));
    const games = typeof GameSession !== 'undefined' ? GameSession.games() : [];
    if (!games.length) el.appendChild(VexSettingsGroups.note('Add a game first: Settings, Game mode.'));
    const field = (css) => `background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:4px 6px;font-size:12px;${css || ''}`;
    for (const g of games) {
      const sc = this.scene(g.id) || { volume: null, mute: false };
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:6px 0';
      const name = document.createElement('span');
      name.textContent = g.name;
      name.style.cssText = 'min-width:120px;font-size:12.5px';
      const vol = document.createElement('input');
      vol.type = 'number'; vol.min = '0'; vol.max = String(this.MAX_PERCENT); vol.placeholder = 'leave';
      vol.value = sc.volume == null ? '' : String(sc.volume);
      vol.style.cssText = field('width:70px');
      vol.setAttribute('aria-label', 'Vex volume percent while ' + g.name + ' runs');
      const mute = document.createElement('input');
      mute.type = 'checkbox'; mute.checked = !!sc.mute;
      mute.setAttribute('aria-label', 'Mute Vex while ' + g.name + ' runs');
      const mlabel = document.createElement('label');
      mlabel.style.cssText = 'display:flex;gap:4px;align-items:center;font-size:12px';
      mlabel.append(mute, document.createTextNode('mute'));
      const commit = () => {
        try { this.setScene(g.id, { volume: vol.value, mute: mute.checked }); }
        catch (err) { window.showToast?.(err.message, 'error'); }
      };
      vol.addEventListener('change', commit);
      mute.addEventListener('change', commit);
      row.append(name, document.createTextNode('Vex volume %'), vol, mlabel);
      el.appendChild(row);
    }
    const hide = document.createElement('label');
    hide.style.cssText = 'display:flex;gap:6px;align-items:center;font-size:12.5px;margin-top:8px';
    const box = document.createElement('input');
    box.type = 'checkbox'; box.checked = this.hideOverGame();
    box.addEventListener('change', () => this.setHideOverGame(box.checked));
    hide.append(box, document.createTextNode('Hide the floating video while a game is fullscreen'));
    el.appendChild(hide);
  },
};

if (typeof window !== 'undefined') {
  window.GameScenes = GameScenes;
  if (typeof VexLedger !== 'undefined') {
    VexLedger.registerUndo('game-scene-restore', async () => {
      const done = GameScenes.restore('undo');
      if (!done) throw new Error('The sound was already changed by you, so it was left alone');
    });
  }
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({
      id: 'game-scenes',
      title: 'Game audio scenes',
      keywords: 'game audio scene volume mute pip picture in picture floating video fullscreen hide',
      before: 'about',
      build: (el) => {
        el.appendChild(VexSettingsGroups.button(GameScenes.enabled() ? 'Turn scenes off' : 'Turn scenes on', () => { GameScenes.setEnabled(!GameScenes.enabled()); VexSettingsGroups.inject(); }, { primary: !GameScenes.enabled() }));
        GameScenes.group(el);
      },
    });
  }
  if (typeof document !== 'undefined' && typeof VexLifeKit !== 'undefined') GameScenes.start();
}
if (typeof module !== 'undefined' && module.exports) module.exports = { GameScenes };
