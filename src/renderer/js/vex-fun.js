// === Play: the shared rules for Vex's optional playful features ============
//
// Mini games on the offline page, Tab Tetris, the daily word and the sound
// packs are all small pleasures, and they follow one set of rules, kept here so
// that no feature can quietly bend them:
//
//   - every one is OFF until the person switches it on;
//   - none of them runs while Game mode is on (a game is running, or a Game
//     Control Center session), because the screen is the game's then;
//   - none of them runs while the global quiet switch is on;
//   - motion honours prefers-reduced-motion;
//   - nothing counts against you: no penalties, no "you missed a day", no
//     nudges, nothing is shared anywhere.
//
// VexFun.gate() is the single pure decision; each feature asks it.
// VexFun.group() injects a feature's own group into Settings at runtime.
//
// Medals: a feature that earned something dispatches `vex:medal-signal` with
// { id } (VexFun.medal). Whoever owns the medals listens; nothing here depends
// on that listener existing.
const VexFun = {
  KEYS: {
    quiet: 'vex.fun.quiet',
    games: 'vex.fun.games',
    tetris: 'vex.fun.tetris',
    word: 'vex.fun.word',
    sounds: 'vex.fun.sounds',
  },

  // The one decision. Pure: everything it needs is passed in.
  //   enabled  the feature's own switch
  //   quiet    the global quiet switch
  //   gaming   Game mode is on
  // Returns '' when it may run, else the reason it may not (for tooltips).
  gate({ enabled, quiet, gaming } = {}) {
    if (!enabled) return 'switched off';
    if (quiet) return 'quiet switch is on';
    if (gaming) return 'Game mode is on';
    return '';
  },

  _read(key) { try { return localStorage.getItem(key); } catch { return null; } },
  _write(key, value) {
    try { localStorage.setItem(key, value); return true; } catch (err) {
      console.warn('[Play] could not save ' + key + ':', err && err.message);
      return false;
    }
  },

  // A switch is on only when it was saved as '1': a missing value is OFF, so
  // a profile that never saw these features never has them.
  flag(name) {
    if (!this.KEYS[name]) throw new Error('Unknown Play switch ' + name);
    return this._read(this.KEYS[name]) === '1';
  },
  setFlag(name, on) {
    if (!this.KEYS[name]) throw new Error('Unknown Play switch ' + name);
    this._write(this.KEYS[name], on ? '1' : '0');
    // The quiet switch is an alias of the master level (js/vex-playfulness.js).
    if (name === 'quiet' && typeof VexPlayfulness !== 'undefined') VexPlayfulness.quietAlias(!!on);
    // Switching a playful extra on under a level that does not allow it: say so, do not stay silent.
    if (on && this.KIND[name] && typeof VexPlayfulness !== 'undefined' && VexPlayfulness.chosen() !== 'off' && VexPlayfulness._rank(VexPlayfulness.chosen()) < VexPlayfulness._rank(VexPlayfulness.NEEDS[this.KIND[name]])) {
      window.showToast?.('This needs Playfulness set to ' + VexPlayfulness.NEEDS[this.KIND[name]] + ' (Settings › Playfulness).', 'info', 6000);
    }
    document.dispatchEvent(new CustomEvent('vex:play-changed', { detail: { name, on: !!on } }));
  },

  // The quiet switch, or the master level being Off (Focus, a meeting, battery
  // saver, reduced motion and Simple mode lower it to Off).
  quiet() { return this.flag('quiet') || (typeof VexPlayfulness !== 'undefined' && VexPlayfulness.isOff()); },

  // Game mode: a game is running (GameMode.gaming) or a game session is open
  // (GameSession.active). Both are lexical globals, so bare identifiers.
  gaming() {
    if (typeof AttentionState !== 'undefined') return AttentionState.has('game');
    return (typeof GameMode !== 'undefined' && !!GameMode.gaming)
      || (typeof GameSession !== 'undefined' && !!GameSession.active);
  },

  // May this feature run right now? Returns '' or the reason.
  // Which playful kind each Play switch is (js/vex-playfulness.js).
  KIND: { games: 'tabgame', tetris: 'tabgame', word: 'tabgame', sounds: 'sound' },
  why(name) {
    const why = this.gate({ enabled: this.flag(name), quiet: this.quiet(), gaming: this.gaming() });
    if (why || typeof VexPlayfulness === 'undefined' || !this.KIND[name]) return why;
    return VexPlayfulness.why(this.KIND[name]);
  },
  may(name) { return this.why(name) === ''; },

  reducedMotion() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch { return false; }
  },

  medal(id) {
    if (typeof id !== 'string' || !id) throw new Error('A medal signal needs an id');
    document.dispatchEvent(new CustomEvent('vex:medal-signal', { detail: { id } }));
  },

  // ---- dates and seeds (pure) ---------------------------------------------
  // The local calendar day as 'YYYY-MM-DD': a day ends at the person's
  // midnight, not UTC's.
  dayKey(date) {
    const d = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(d.getTime())) throw new Error('Not a date');
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  },
  // FNV-1a, 32 bit: a small stable hash, the same on every machine.
  hash(text) {
    let h = 0x811c9dc5;
    const s = String(text);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  },
  // mulberry32: a seeded random number generator, so a puzzle can be rebuilt.
  rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  },

  // ---- A window of play -----------------------------------------------------
  // The one shell every playful screen uses: a labelled dialog that closes on
  // Escape, on a click outside, and by itself the moment Game mode or the quiet
  // switch turns on. `feature` is the Play switch it belongs to.
  // Returns { root, body, close } and calls onClose once.
  open({ title, feature, onClose, wide } = {}) {
    if (feature) {
      const reason = this.why(feature);
      if (reason) throw new Error('Not available: ' + reason);
    }
    const previous = document.activeElement;
    const root = document.createElement('div');
    root.className = 'vexfun-overlay';
    const box = document.createElement('div');
    box.className = 'vexfun-box' + (wide ? ' vexfun-wide' : '');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', title || 'Play');
    const head = document.createElement('div');
    head.className = 'vexfun-head';
    const h = document.createElement('span');
    h.className = 'vexfun-title';
    h.textContent = title || '';
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'vexfun-close';
    x.setAttribute('aria-label', 'Close');
    x.innerHTML = (typeof VexIcons !== 'undefined') ? VexIcons.svg('x', { size: 16 }) : '';
    head.append(h, x);
    const body = document.createElement('div');
    body.className = 'vexfun-body';
    box.append(head, body);
    root.appendChild(box);
    document.body.appendChild(root);

    let closed = false;
    const poll = VexJobs.every('Fun panel game state ' + Math.random().toString(36).slice(2, 8), 2000, () => onState());   // GameMode.gaming has no event of its own
    const stop = () => { poll.stop(); try { document.removeEventListener('vex:game-mode', onState); document.removeEventListener('vex:play-changed', onState); } catch { /* gone */ } };
    const close = () => {
      if (closed) return;
      closed = true;
      stop();
      root.removeEventListener('keydown', onKey, true);
      root.remove();
      try { if (previous && previous.focus) previous.focus(); } catch { /* the opener is gone */ }
      if (typeof onClose === 'function') onClose();
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    const onState = () => { if (feature && this.why(feature)) close(); };
    root.addEventListener('keydown', onKey, true);
    root.addEventListener('mousedown', (e) => { if (e.target === root) close(); });
    x.addEventListener('click', close);
    document.addEventListener('vex:game-mode', onState);
    document.addEventListener('vex:play-changed', onState);
    setTimeout(() => { try { x.focus(); } catch { /* closed already */ } }, 0);
    return { root, body, close };
  },

  // ---- Settings -----------------------------------------------------------
  // Adds a group of the feature's own to Settings, once. `build(body)` fills it
  // with rows (VexFun.toggleRow). The heading starts with "Play: " so that
  // Settings files it under the Play category (settings-ui.js CATS).
  group(id, title, build) {
    const root = document.querySelector('#panel-settings .settings-content');
    if (!root) return null;
    let g = document.getElementById(id);
    if (g) return g;
    g = document.createElement('div');
    g.className = 'setting-group';
    g.id = id;
    const label = document.createElement('label');
    label.className = 'setting-label';
    label.textContent = title;
    g.appendChild(label);
    build(g);
    root.appendChild(g);
    return g;
  },

  // One on/off row bound to a Play switch (or to any getter/setter pair).
  toggleRow(host, { label, hint, get, set }) {
    const row = document.createElement('div');
    row.className = 'setting-toggle-row';
    const text = document.createElement('span');
    text.textContent = label;
    if (hint) {
      const h = document.createElement('span');
      h.style.cssText = 'color:var(--text-muted);font-size:11px';
      h.textContent = ' · ' + hint;
      text.appendChild(h);
    }
    const sw = document.createElement('label');
    sw.className = 'toggle';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!get();
    input.setAttribute('aria-label', label);
    input.addEventListener('change', () => set(input.checked));
    const slider = document.createElement('span');
    slider.className = 'toggle-slider';
    sw.append(input, slider);
    row.append(text, sw);
    host.appendChild(row);
    return input;
  },

  switchRow(host, name, label, hint) {
    return this.toggleRow(host, { label, hint, get: () => this.flag(name), set: (on) => this.setFlag(name, on) });
  },

  init() {
    this.group('play-quiet-settings', 'Play: quiet switch', (g) => {
      this.switchRow(g, 'quiet', 'Quiet', 'turns every playful extra off at once: games, Tab Tetris, the daily word and sounds. Your other settings are kept');
      const note = document.createElement('div');
      note.style.cssText = 'color:var(--text-muted);font-size:11px;margin-top:6px';
      note.textContent = 'Everything under Play is off until you switch it on, pauses itself during Game mode, and never counts anything against you.';
      g.appendChild(note);
    });
  },
};

if (typeof window !== 'undefined') {
  window.VexFun = VexFun;
  if (typeof document !== 'undefined' && document.querySelector) {
    try { VexFun.init(); } catch (err) { console.error('[Play] could not add its settings:', err); }
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexFun };
