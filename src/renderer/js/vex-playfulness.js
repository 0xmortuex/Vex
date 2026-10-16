// === Playfulness: one master level for everything playful ======================
//
// Medals, the pet, sound packs, streaks, tab games and the living layers each had
// a switch of their own plus the quiet switch, and a Game-mode check of their own.
// They now read ONE level (T0-009):
//
//   off    nothing playful appears, makes a sound or celebrates
//   calm   (the default) quiet things: the pet, streaks, tab games, the living
//          layers. No sounds, no medal or level toasts, no confetti
//   full   everything, as before
//
// VexPlayfulness.allowed(kind) is the one question each of them asks:
//   kinds: 'medal' (the award itself), 'medal-toast', 'pet', 'streak', 'tabgame',
//          'living', 'sound', 'celebrate'
//
// A level other than Off is lowered to Off, with the reason on record, while:
//   - Game mode is on, a meeting is running, or a Focus session or flow is on
//     (AttentionState: js/attention-state.js);
//   - the laptop is saving battery (BatteryMode);
//   - the system asks for reduced motion;
//   - Simple mode or Minimal Vex is on. Playfulness may never overlay work.
//
// The old global quiet switch (vex.fun.quiet, Settings › Play › Quiet) is kept as
// an alias: turning it on is the same as choosing Off (and remembers the level to
// bring back), turning it off brings that level back.
//
// The level is a choice stored with VexDefaults: the default (Calm) is Vex's, a
// level the person picks is theirs and no release changes it.
const VexPlayfulness = {
  LEVELS: ['off', 'calm', 'full'],
  DEFAULT: 'calm',
  KEY: 'playfulness',
  PRIOR_KEY: 'vex.playfulness.prior',
  QUIET_KEY: 'vex.fun.quiet',

  // The level each kind needs at least.
  // 'jingle' is the one sound that needs only Calm: a tune the person composed and switched on
  // for a slot (startup, focus finish), at most a few notes, off until they do. It still goes
  // quiet in Game mode, Focus, a meeting, Simple mode, Minimal Vex, battery saver and reduced motion.
  NEEDS: { medal: 'calm', pet: 'calm', streak: 'calm', tabgame: 'calm', living: 'calm', delight: 'calm', jingle: 'calm', 'medal-toast': 'full', sound: 'full', celebrate: 'full' },

  // ---- the playfulness quarantine (Wave 4, section 11) ------------------------------------------
  // EVERY fun or ambient module, and how each one asks the question above. tests/renderer/
  // playfulQuarantine.test.js reads this list, opens each file and fails when the gate is not
  // there, and fails when a file that makes a sound, signals a medal or registers a living-layer
  // switch is not on the list. A new fun module is added HERE, in the same change.
  //   file     the module (under js/)
  //   kind     the VexPlayfulness kind it needs (NEEDS above)
  //   gate     text that must appear in `gateFile` (default: file): the call that asks
  //   uses     text that must appear in `file` when the gate lives in another file
  //   explicit true: it has no ambient surface (it only runs after the person opens it); `why` says so
  // Off in Simple mode and Minimal Vex: automatic, because those two lower the level to Off (autoOffReason).
  // Sound: none is on by default (every sound switch below is off until chosen; the test reads them).
  MODULES: [
    { id: 'medals', file: 'vex-medals.js', kind: 'medal-toast', gate: "allowed('medal-toast')" },
    { id: 'levels', file: 'fun/levels.js', kind: 'celebrate', gate: "VexProgress.allows('celebrate')", gateFile: 'fun/fun-core.js', gateRoot: 'VexPlayfulness.allowed(kind)' },
    { id: 'vex-pet', file: 'fun/vex-pet.js', kind: 'pet', gate: "VexProgress.allows('pet')", gateFile: 'fun/fun-core.js', gateRoot: 'VexPlayfulness.allowed(kind)' },
    { id: 'discovery-log', file: 'fun/discovery-log.js', kind: 'delight', gate: "VexProgress.allows('delight')", gateFile: 'fun/fun-core.js', gateRoot: 'VexPlayfulness.allowed(kind)' },
    { id: 'daily-challenge', file: 'fun/daily-challenge.js', kind: 'delight', gate: "VexProgress.allows('delight')", gateFile: 'fun/fun-core.js', gateRoot: 'VexPlayfulness.allowed(kind)' },
    { id: 'streaks', file: 'brief-extras/streaks.js', kind: 'streak', gate: "allowed('streak')" },
    { id: 'sound-packs', file: 'vex-sounds.js', kind: 'sound', gate: "allowed('sound')" },
    { id: 'jingle', file: 'vex-jingle.js', kind: 'jingle', gate: "allowed('jingle')" },
    { id: 'mood-themes', file: 'mood-themes.js', kind: 'delight', gate: "allowed('delight')" },
    { id: 'seasonal-worlds', file: 'seasonal-worlds.js', kind: 'living', gate: "allowed('living')", gateFile: 'living-core.js', uses: 'createLayer' },
    { id: 'weather-layer', file: 'weather-layer.js', kind: 'living', gate: "allowed('living')", gateFile: 'living-core.js', uses: 'createLayer' },
    { id: 'tab-personality', file: 'tab-personality.js', kind: 'living', gate: "allowed('living')", gateFile: 'living-core.js', uses: 'quietReason' },
    { id: 'sticker-sheet', file: 'sticker-sheet.js', kind: 'living', gate: "allowed('living')" },
    { id: 'mini-games', file: 'vex-mini-games.js', kind: 'tabgame', gate: "VexFun.may('games')", gateFile: 'vex-fun.js', gateRoot: 'VexPlayfulness.why(this.KIND[name])' },
    { id: 'tab-tetris', file: 'vex-tab-tetris.js', kind: 'tabgame', gate: "VexFun.may('tetris')", gateFile: 'vex-fun.js', gateRoot: 'VexPlayfulness.why(this.KIND[name])' },
    { id: 'daily-word', file: 'vex-daily-word.js', kind: 'tabgame', gate: "VexFun.may('word')", gateFile: 'vex-fun.js', gateRoot: 'VexPlayfulness.why(this.KIND[name])' },
    { id: 'fortune', file: 'vex-fortune.js', kind: 'delight', gate: "allowed('delight')" },
    { id: 'widgets', file: 'vex-integration.js', kind: 'delight', gate: "allowed('delight')" },
    { id: 'year-in-vex', file: 'year-in-vex.js', kind: 'delight', gate: "allowed('delight')" },
    { id: 'badges', file: 'achievement-badges.js', kind: 'medal-toast', gate: "allowed('medal-toast')" },
    { id: 'coop-timer', file: 'coop-timer.js', explicit: true, why: 'runs only after the person creates or joins a room; no sound, no Brief or New Tab card' },
    { id: 'friend-card', file: 'friend-card.js', explicit: true, why: 'builds a picture only when asked; no sound, no Brief or New Tab card' },
    { id: 'rabbit-hole', file: 'rabbit-hole.js', explicit: true, why: 'opens a page only when the person runs the command; its small bar is the answer to that command' },
    { id: 'time-capsule', file: 'time-capsule.js', explicit: true, why: 'a reminder the person set for a date they chose; it is a tool, not decoration' },
    { id: 'focus-scenes', file: 'focus-scenes.js', explicit: true, why: 'the soundscape starts only when the person presses play (or opted in to start with a focus session) and never in Game mode' },
  ],
  // Audio that is NOT playful: it does a job the person asked for. Listed so the test can tell it from a new toy.
  FUNCTIONAL_AUDIO: ['brief-extras/audio-digest.js', 'clock-panel.js', 'dictation.js', 'listen-reader.js', 'master-volume.js', 'night-audio.js', 'page-extras.js', 'queue-podcast.js'],

  _rank(level) { return this.LEVELS.indexOf(level); },
  _quietSwitch() { try { return localStorage.getItem(this.QUIET_KEY) === '1'; } catch { return false; } },
  _def() {
    if (typeof VexDefaults === 'undefined') throw new Error('VexDefaults is not loaded: js/vex-defaults.js must come before js/vex-playfulness.js');
    return VexDefaults;
  },

  // The level that was chosen (or the default), before any automatic lowering.
  chosen() {
    const v = this._def().get(this.KEY, this.DEFAULT);
    return this.LEVELS.includes(v) ? v : this.DEFAULT;
  },
  isExplicit() { return this._def().isExplicit(this.KEY); },

  // Why the chosen level is being treated as Off right now, or ''.
  autoOffReason() {
    if (this._quietSwitch()) return 'the quiet switch is on';
    if (typeof AttentionState !== 'undefined') {
      const src = AttentionState.get().sources.map(s => s.id);
      if (src.includes('game')) return 'Game mode is on';
      if (src.includes('meeting')) return 'a meeting is running';
      if (src.includes('focus')) return 'Focus is on';
    }
    try { if (typeof BatteryMode !== 'undefined' && BatteryMode && typeof BatteryMode.isLean === 'function' && BatteryMode.isLean()) return 'the PC is saving battery'; } catch (err) { console.error('[Playfulness] battery state unreadable:', err); }
    try { if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return 'reduced motion is on'; } catch { /* vex-allow-empty-catch: no media queries here */ }
    try { if (typeof document !== 'undefined' && document.documentElement.hasAttribute('data-reduce-motion')) return 'reduced motion is on'; } catch { /* vex-allow-empty-catch: no document */ }
    try { if (typeof VexSimpleMode !== 'undefined' && VexSimpleMode.isSimple()) return 'Simple mode is on'; } catch (err) { console.error('[Playfulness] Simple mode unreadable:', err); }
    try { if (typeof VexMinimalMode !== 'undefined' && VexMinimalMode.isOn()) return 'Minimal Vex is on'; } catch (err) { console.error('[Playfulness] Minimal mode unreadable:', err); }
    return '';
  },

  // The level in force now.
  level() {
    const chosen = this.chosen();
    if (chosen === 'off') return 'off';
    return this.autoOffReason() ? 'off' : chosen;
  },
  isOff() { return this.level() === 'off'; },

  allowed(kind) {
    const need = this.NEEDS[kind];
    if (!need) throw new Error('Unknown playful thing "' + kind + '"');
    return this._rank(this.level()) >= this._rank(need);
  },
  // '' when allowed, else a sentence for a tooltip.
  why(kind) {
    if (this.allowed(kind)) return '';
    const chosen = this.chosen();
    if (chosen === 'off') return 'Playfulness is off';
    const auto = this.autoOffReason();
    if (auto) return 'Playfulness is paused because ' + auto;
    return 'Playfulness is set to ' + chosen + ' (this needs ' + this.NEEDS[kind] + ')';
  },

  setLevel(level) {
    if (!this.LEVELS.includes(level)) throw new Error('Playfulness is off, calm or full');
    const was = this.chosen();
    this._def().set(this.KEY, level);
    if (level === 'off') {
      if (was !== 'off') localStorage.setItem(this.PRIOR_KEY, was);
      localStorage.setItem(this.QUIET_KEY, '1');
    } else {
      localStorage.removeItem(this.PRIOR_KEY);
      localStorage.setItem(this.QUIET_KEY, '0');
    }
    this._changed(level);
    return level;
  },

  // The old quiet switch was flipped (VexFun.setFlag('quiet', on)).
  quietAlias(on) {
    if (on) { if (this.chosen() !== 'off') this.setLevel('off'); return 'off'; }
    const prior = localStorage.getItem(this.PRIOR_KEY);
    const back = this.LEVELS.includes(prior) && prior !== 'off' ? prior : this.DEFAULT;
    if (this.chosen() === 'off') this.setLevel(back);
    return this.chosen();
  },

  _changed(level) {
    try {
      document.dispatchEvent(new CustomEvent('vex:playfulness-changed', { detail: { level } }));
      document.dispatchEvent(new CustomEvent('vex:play-changed', { detail: { name: 'quiet', on: level === 'off' } }));
    } catch { /* vex-allow-empty-catch: no document: a test */ }
  },

  // Once per profile: someone who already uses the playful extras keeps them.
  // A new profile gets Calm. Nothing is ever lowered for a level already chosen.
  FUN_FLAGS: ['vex.fun.games', 'vex.fun.tetris', 'vex.fun.word', 'vex.fun.sounds'],
  MIGRATION: 'playfulness.keep-what-is-used',
  migrate() { return VexMigrations.migrateOnce(this.MIGRATION, () => this._migrateBody()); },
  _migrateBody() {
    {
      if (this._def().isExplicit(this.KEY)) return 'kept';
      let uses = this.FUN_FLAGS.some(k => localStorage.getItem(k) === '1');
      if (!uses) {
        const f = localStorage.getItem('vex.fun');
        if (f) { try { const o = JSON.parse(f); uses = !!o && typeof o === 'object' && Object.values(o).some(v => v === true); } catch (err) { throw new Error('The saved fun settings are not readable', { cause: err }); } }
      }
      if (!uses && localStorage.getItem('vex.medals') != null) uses = true;
      if (this._quietSwitch()) { this._def().set(this.KEY, 'off'); return 'off'; }
      if (uses) { this._def().set(this.KEY, 'full'); return 'full'; }
      return 'calm';
    }
  },

  // ---- Settings › Playfulness ------------------------------------------------------------
  renderSettings(body) {
    body.textContent = '';
    const info = document.createElement('p');
    info.className = 'setting-info';
    info.textContent = 'One level for medals, the pet, sounds, streaks, tab games and the living backgrounds. Off shows none of them. Calm keeps the quiet ones (no sounds, no medal or level pop-ups). Full is everything. It switches itself off while a game, a meeting or Focus is on, on battery saver, with reduced motion, and in Simple mode.';
    body.appendChild(info);
    const row = document.createElement('div');
    row.className = 'setting-row';
    const label = document.createElement('label');
    label.textContent = 'Playfulness';
    label.setAttribute('for', 'setting-playfulness-level');
    const sel = document.createElement('select');
    sel.id = 'setting-playfulness-level';
    for (const [v, t] of [['off', 'Off'], ['calm', 'Calm'], ['full', 'Full']]) {
      const o = document.createElement('option'); o.value = v; o.textContent = t; sel.appendChild(o);
    }
    sel.value = this.chosen();
    sel.addEventListener('change', () => {
      try { this.setLevel(sel.value); this.renderSettings(body); }
      catch (err) { sel.value = this.chosen(); window.showToast?.((err && err.message) || String(err), 'error'); }
    });
    row.append(label, sel);
    body.appendChild(row);
    const status = document.createElement('p');
    status.className = 'setting-info';
    const auto = this.chosen() !== 'off' ? this.autoOffReason() : '';
    status.textContent = auto ? 'Paused right now because ' + auto + '.' : 'Active level: ' + this.level() + '.';
    body.appendChild(status);
  },
};

if (typeof window !== 'undefined') {
  window.VexPlayfulness = VexPlayfulness;
  if (typeof VexMigrations !== 'undefined') VexMigrations.register(VexPlayfulness.MIGRATION, () => VexPlayfulness._migrateBody());
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'playfulness', title: 'Playfulness', keywords: 'fun play quiet calm full off medals pet sounds games gamification', render: (body) => VexPlayfulness.renderSettings(body) });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexPlayfulness };
