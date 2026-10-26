// === Interface sounds (like Opera GX) ========================================
//
// Short sounds for Vex's OWN controls, on by default:
//   Typing   a soft key click while you type in the address bar, in Ctrl+K, in the search boxes of Vex and in the New Tab page's search
//   Hover    a clear tick when the pointer enters one of the browser's buttons
//            (toolbar, sidebar icons, tab strip, bookmarks bar). Never page content.
//   Tabs     two notes going up when a tab opens, two going down when one closes
//   Presses  a small click when one of those buttons is pressed (off until you switch it on)
//
// This is feedback for the browser's controls, not playful decoration, so it is not
// under the Play level (js/vex-playfulness.js lists it as functional audio) and its
// switches default to ON (presses excepted). Nothing is downloaded: every sound is made with WebAudio
// when it is asked for. Settings > Sounds has five styles (Soft, Mechanical, Bubble, Arcade, Glass), a pitch and a volume.
//
// A sound is made only when VexUiSounds.decide() says so: the master switch and the
// kind's own switch are on, the volume is above zero, it is not quiet hours (shared
// with js/vex-sounds.js), Game mode / a meeting / a Focus session (and the other
// quiet modes of AttentionState) are not on, the window is visible and focused, no
// mouse button is held (a drag), and the kind's rate limit has passed. decide() is
// pure and tested.
//
// Why a click could go missing (found 2026-10-26): a mouse button released over a page (a separate webview, whose events never reach this window)
// left "a mouse button is held" on until the next click on Vex itself, and a key typed in the window was refused as "not focused" while the
// webview still held focus. The first sound after the audio engine started was scheduled before the engine ran, so its volume had already
// ended: silent. A held button now counts for three seconds at most, a typed key proves the focus, and a sound waits until the engine runs.
const VexUiSounds = {
  KEYS: {
    master: 'vex.uiSounds.master',     // '0' = off; anything else (or nothing saved) = on
    typing: 'vex.uiSounds.typing',
    hover: 'vex.uiSounds.hover',
    tabs: 'vex.uiSounds.tabs',
    press: 'vex.uiSounds.press',       // '1' = on; off until chosen
    volume: 'vex.uiSounds.volume',     // 0..1, default 0.5
    style: 'vex.uiSounds.style',       // a key of STYLES, default 'soft'
    pitch: 'vex.uiSounds.pitch',       // 0.6..1.6, default 1
  },
  DEFAULT_VOLUME: 0.5,
  DEFAULT_STYLE: 'soft',
  DEFAULT_PITCH: 1,
  PITCH_MIN: 0.6,
  PITCH_MAX: 1.6,
  // The switches, and what each is without a saved choice.
  FLAG_DEFAULTS: { master: true, typing: true, hover: true, tabs: true, press: false },

  // Which switch each sound belongs to, and the least time between two of the same sound (ms).
  KINDS: {
    key: { flag: 'typing', gap: 40 },
    tick: { flag: 'hover', gap: 130 },
    tabOpen: { flag: 'tabs', gap: 250 },
    tabClose: { flag: 'tabs', gap: 700 },
    press: { flag: 'press', gap: 90 },
  },
  // AttentionState sources that silence interface sounds.
  QUIET_SOURCES: ['game', 'meeting', 'focus', 'exam', 'study', 'sharing', 'quiet-switch'],
  // A tab that opens within this long of the window settling is session restore, not the person.
  SETTLE_MS: 2000,
  // A mouse button counts as held for this long at most: its release may have happened over a page, where this window cannot see it.
  HELD_MAX_MS: 3000,

  // The pointer entering any of these makes a tick. Browser chrome only: page content lives in
  // webviews, whose events never reach this document.
  HOVER_SELECTOR: [
    '#top-bar button', '#icon-sidebar button', '#top-tab-bar button', '#top-tabs-list .tab-item',
    '#tabs-sidebar .tab-item', '#tabs-sidebar button', '#gui-shortcuts-bar button', '#gui-shortcuts-bar .gsc',
  ].join(', '),
  TYPING_IDS: ['url-input', 'command-input'],
  // Search boxes with a class and no id.
  TYPING_CLASSES: ['set-search'],

  // Notes: f = start Hz, f2 = end Hz (a quick glide), t = start (s), d = length (s), g = relative loudness.
  // noise: true makes a burst of filtered noise instead of a tone (f = the centre of the band, q = how narrow).
  STYLES: {
    soft: {
      name: 'Soft',
      recipes: {
        key: [{ wave: 'triangle', f: 1500, f2: 700, t: 0, d: 0.035, g: 0.5 }],
        tick: [{ wave: 'sine', f: 2000, f2: 1600, t: 0, d: 0.06, g: 0.8 }, { wave: 'triangle', f: 4000, f2: 3200, t: 0, d: 0.03, g: 0.18 }],
        tabOpen: [{ wave: 'sine', f: 523.25, t: 0, d: 0.12, g: 0.7 }, { wave: 'sine', f: 783.99, t: 0.08, d: 0.18, g: 0.7 }],
        tabClose: [{ wave: 'sine', f: 783.99, t: 0, d: 0.1, g: 0.6 }, { wave: 'sine', f: 523.25, t: 0.07, d: 0.16, g: 0.6 }],
        press: [{ wave: 'sine', f: 900, f2: 600, t: 0, d: 0.05, g: 0.6 }],
      },
    },
    mechanical: {
      name: 'Mechanical',
      recipes: {
        key: [{ noise: true, f: 2800, q: 1.5, t: 0, d: 0.022, g: 0.9 }, { wave: 'square', f: 180, f2: 90, t: 0, d: 0.03, g: 0.3 }],
        tick: [{ noise: true, f: 5200, q: 2, t: 0, d: 0.018, g: 0.55 }],
        tabOpen: [{ noise: true, f: 1800, q: 1, t: 0, d: 0.03, g: 0.8 }, { wave: 'square', f: 260, f2: 200, t: 0.02, d: 0.06, g: 0.35 }, { wave: 'square', f: 390, t: 0.07, d: 0.08, g: 0.3 }],
        tabClose: [{ noise: true, f: 1800, q: 1, t: 0, d: 0.03, g: 0.8 }, { wave: 'square', f: 390, f2: 300, t: 0.02, d: 0.06, g: 0.3 }, { wave: 'square', f: 260, t: 0.07, d: 0.08, g: 0.35 }],
        press: [{ noise: true, f: 2200, q: 1.2, t: 0, d: 0.03, g: 0.9 }, { wave: 'square', f: 140, f2: 80, t: 0, d: 0.04, g: 0.35 }],
      },
    },
    bubble: {
      name: 'Bubble',
      recipes: {
        key: [{ wave: 'sine', f: 500, f2: 1100, t: 0, d: 0.05, g: 0.55 }],
        tick: [{ wave: 'sine', f: 900, f2: 1500, t: 0, d: 0.05, g: 0.5 }],
        tabOpen: [{ wave: 'sine', f: 440, f2: 880, t: 0, d: 0.12, g: 0.6 }, { wave: 'sine', f: 660, f2: 1320, t: 0.08, d: 0.14, g: 0.5 }],
        tabClose: [{ wave: 'sine', f: 880, f2: 440, t: 0, d: 0.12, g: 0.6 }, { wave: 'sine', f: 660, f2: 330, t: 0.08, d: 0.14, g: 0.5 }],
        press: [{ wave: 'sine', f: 350, f2: 800, t: 0, d: 0.06, g: 0.6 }],
      },
    },
    arcade: {
      name: 'Arcade',
      recipes: {
        key: [{ wave: 'square', f: 1200, f2: 900, t: 0, d: 0.03, g: 0.25 }],
        tick: [{ wave: 'square', f: 1800, t: 0, d: 0.03, g: 0.2 }],
        tabOpen: [{ wave: 'square', f: 523.25, t: 0, d: 0.07, g: 0.25 }, { wave: 'square', f: 783.99, t: 0.07, d: 0.07, g: 0.25 }, { wave: 'square', f: 1046.5, t: 0.14, d: 0.1, g: 0.25 }],
        tabClose: [{ wave: 'square', f: 1046.5, t: 0, d: 0.07, g: 0.25 }, { wave: 'square', f: 783.99, t: 0.07, d: 0.07, g: 0.25 }, { wave: 'square', f: 523.25, t: 0.14, d: 0.1, g: 0.25 }],
        press: [{ wave: 'square', f: 660, t: 0, d: 0.04, g: 0.25 }, { wave: 'square', f: 990, t: 0.04, d: 0.05, g: 0.22 }],
      },
    },
    glass: {
      name: 'Glass',
      recipes: {
        key: [{ wave: 'sine', f: 2400, f2: 2000, t: 0, d: 0.05, g: 0.35 }, { wave: 'sine', f: 3600, t: 0, d: 0.04, g: 0.15 }],
        tick: [{ wave: 'sine', f: 3200, f2: 3000, t: 0, d: 0.08, g: 0.3 }, { wave: 'sine', f: 4800, t: 0, d: 0.05, g: 0.1 }],
        tabOpen: [{ wave: 'sine', f: 1318.5, t: 0, d: 0.2, g: 0.35 }, { wave: 'sine', f: 1760, t: 0.08, d: 0.26, g: 0.3 }],
        tabClose: [{ wave: 'sine', f: 1760, t: 0, d: 0.2, g: 0.3 }, { wave: 'sine', f: 1318.5, t: 0.08, d: 0.26, g: 0.35 }],
        press: [{ wave: 'sine', f: 2000, f2: 1500, t: 0, d: 0.06, g: 0.4 }],
      },
    },
  },
  // The default style's notes (kept under this name for code and tests that read them).
  get RECIPES() { return this.STYLES.soft.recipes; },

  // ---- the decision (pure) ------------------------------------------------------
  // enabled: { master, typing, hover, tabs, press }; sources: ids from AttentionState; last: ms of the
  // last sound of this kind that played; now: ms. '' when the sound may play, else the reason.
  decide({ kind, enabled, volume, quietHours, sources, hidden, unfocused, buttonsDown, last, now, settled, preview } = {}) {
    const k = this.KINDS[kind];
    if (!k) return 'unknown sound';
    const on = enabled || {};
    if (!preview) {
      if (on.master === false) return 'interface sounds are off';
      if (on[k.flag] === false) return k.flag + ' sounds are off';
    }
    if (!(Number(volume) > 0)) return 'volume is zero';
    if (preview) return '';
    const quiet = (sources || []).find(s => this.QUIET_SOURCES.includes(s));
    if (quiet) return quiet === 'quiet-switch' ? 'quiet switch is on' : quiet + ' is on';
    if (quietHours) return 'quiet hours';
    if (hidden) return 'window is hidden';
    if (unfocused) return 'window is not focused';
    if (buttonsDown) return 'a mouse button is held';
    if (kind === 'tabOpen' && settled === false) return 'the window is still starting';
    if (Number.isFinite(last) && last > 0 && now - last < k.gap) return 'too soon after the last one';
    return '';
  },

  // Pure. Has the window been settled for long enough that a new tab is the person's doing?
  // marks: VexBoot.marks (ms since navigation start); now: performance.now().
  settledFor(marks, now, ms = this.SETTLE_MS) {
    const s = marks && marks.settled;
    return Number.isFinite(s) && now - s >= ms;
  },

  // Pure. The notes of a sound, a little higher or lower for the key click so a run of keys is not a buzz.
  // style: a key of STYLES (the default when it is not one); pitch: a multiplier for every note.
  notesFor(kind, jitter = 1, style = this.DEFAULT_STYLE, pitch = 1) {
    const pack = this.STYLES[style] || this.STYLES[this.DEFAULT_STYLE];
    const r = pack.recipes[kind] || this.STYLES[this.DEFAULT_STYLE].recipes[kind];
    if (!r) throw new Error('Unknown interface sound ' + kind);
    const m = jitter * pitch;
    return r.map(n => ({ ...n, f: n.f * m, f2: (n.f2 || n.f) * m }));
  },

  // ---- saved settings -------------------------------------------------------------
  _read(key) { try { return localStorage.getItem(key); } catch { return null; } },
  _write(key, value) {
    try { localStorage.setItem(key, value); }
    catch (err) { throw new Error('The sound setting could not be saved: ' + err.message, { cause: err }); }
  },
  _isFlag(name) { return Object.prototype.hasOwnProperty.call(this.FLAG_DEFAULTS, name); },
  flag(name) {
    if (!this._isFlag(name)) throw new Error('Unknown sound switch ' + name);
    const raw = this._read(this.KEYS[name]);
    if (raw === null) return this.FLAG_DEFAULTS[name];
    return this.FLAG_DEFAULTS[name] ? raw !== '0' : raw === '1';
  },
  setFlag(name, on) {
    if (!this._isFlag(name)) throw new Error('Unknown sound switch ' + name);
    this._write(this.KEYS[name], on ? '1' : '0');
  },
  volume() {
    const raw = this._read(this.KEYS.volume);
    const v = Number(raw);
    return raw === null || raw === '' || !Number.isFinite(v) ? this.DEFAULT_VOLUME : Math.min(1, Math.max(0, v));
  },
  setVolume(v) {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 1) throw new Error('Volume must be between 0 and 1');
    this._write(this.KEYS.volume, String(n));
  },
  style() {
    const raw = this._read(this.KEYS.style);
    return raw && Object.prototype.hasOwnProperty.call(this.STYLES, raw) ? raw : this.DEFAULT_STYLE;
  },
  setStyle(name) {
    if (!Object.prototype.hasOwnProperty.call(this.STYLES, name)) throw new Error('Unknown sound style ' + name);
    this._write(this.KEYS.style, name);
  },
  pitch() {
    const raw = this._read(this.KEYS.pitch);
    const v = Number(raw);
    return raw === null || raw === '' || !Number.isFinite(v) ? this.DEFAULT_PITCH : Math.min(this.PITCH_MAX, Math.max(this.PITCH_MIN, v));
  },
  setPitch(v) {
    const n = Number(v);
    if (!Number.isFinite(n) || n < this.PITCH_MIN || n > this.PITCH_MAX) throw new Error('Pitch must be between ' + this.PITCH_MIN + ' and ' + this.PITCH_MAX);
    this._write(this.KEYS.pitch, String(n));
  },
  // Back to what a fresh profile has.
  resetAll() {
    for (const key of Object.values(this.KEYS)) { try { localStorage.removeItem(key); } catch (err) { throw new Error('The sound options could not be reset: ' + err.message, { cause: err }); } }
  },
  // True when the tab open/close sounds are switched on (js/vex-sounds.js then leaves tab close to this file).
  tabsOn() { return this.flag('master') && this.flag('tabs'); },

  _enabled() { return { master: this.flag('master'), typing: this.flag('typing'), hover: this.flag('hover'), tabs: this.flag('tabs'), press: this.flag('press') }; },

  _sources() {
    if (typeof AttentionState === 'undefined' || !AttentionState || typeof AttentionState.get !== 'function') return [];
    return (AttentionState.get().sources || []).map(s => s.id);
  },
  _quietHours(now) {
    if (typeof VexSounds === 'undefined' || typeof VexSounds.hours !== 'function') return false;
    // Quiet hours apply only once the person has set them (Settings > Play). The soft-sound pack's default of 22:00 to 08:00 is a default for
    // sounds that are off until chosen; these are on by default (the owner asked), and silent every night they would seem broken.
    let saved = null;
    try { saved = localStorage.getItem(VexSounds.HOURS_KEY); } catch { saved = null; }
    if (saved === null) return false;
    return VexSounds.inQuietHours(new Date(now), VexSounds.hours());
  },

  _last: {},
  _down: false,
  _downAt: 0,
  // A button pressed on Vex and let go over a page is never seen released here: it counts as held for HELD_MAX_MS at most.
  _held(now) { return this._down && now - this._downAt < this.HELD_MAX_MS; },
  // opts.preview: a sample (only the volume matters). opts.fresh: the sound is the answer to a key just typed, which proves the window
  // has focus even while a page (a webview) still holds the document's own focus.
  why(kind, opts = {}) {
    const now = Date.now();
    return this.decide({
      kind,
      enabled: this._enabled(),
      volume: this.volume(),
      quietHours: this._quietHours(now),
      sources: this._sources(),
      hidden: typeof document !== 'undefined' && document.hidden,
      unfocused: !opts.fresh && typeof document !== 'undefined' && typeof document.hasFocus === 'function' && !document.hasFocus(),
      // A press is the mouse button going down: it cannot be a drag.
      buttonsDown: kind === 'press' ? false : this._held(now),
      last: this._last[kind] || 0,
      now,
      settled: kind === 'tabOpen' ? this.settledFor(typeof VexBoot !== 'undefined' ? VexBoot.marks : null, performance.now()) : undefined,
      preview: !!opts.preview,
    });
  },

  _ctx: null,
  _noiseBuffer: null,
  _context() {
    if (this._ctx) return this._ctx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) throw new Error('This window has no WebAudio');
    this._ctx = new Ctx();
    return this._ctx;
  },
  // Made and started on the first click or key, which the browser counts as the person's own action: made later, from a sound that is
  // already due, the engine starts suspended and the first sound is lost.
  warm() {
    try {
      const ctx = this._context();
      if (ctx.state !== 'running' && ctx.resume) ctx.resume().catch((err) => console.warn('[UiSounds] could not start audio:', err && err.message));
    } catch (err) { console.warn('[UiSounds] audio could not be prepared:', err && err.message); }
  },
  _noise(ctx) {
    if (this._noiseBuffer && this._noiseBuffer.sampleRate === ctx.sampleRate) return this._noiseBuffer;
    const length = Math.floor(ctx.sampleRate * 0.25);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    this._noiseBuffer = buffer;
    return buffer;
  },

  // Plays a sound if the rules allow. Returns true when it was started. A refusal is the rules working;
  // a sound that cannot be made at all is an error, and is reported.
  play(kind, opts = {}) {
    if (!this.KINDS[kind]) throw new Error('Unknown interface sound ' + kind);
    const reason = this.why(kind, opts);
    this.lastReason = reason;
    if (reason) return false;
    this._last[kind] = Date.now();
    const jitter = kind === 'key' ? 0.94 + Math.random() * 0.12 : 1;
    const notes = this.notesFor(kind, jitter, this.style(), this.pitch());
    const peak = 0.5 * this.volume();
    try {
      const ctx = this._context();
      const go = () => {
        try { this._schedule(ctx, notes, peak); }
        catch (err) {
          console.error('[UiSounds] could not play ' + kind + ':', err);
          window.showToast?.('Could not play the sound: ' + ((err && err.message) || err), 'error');
        }
      };
      // The notes are placed on the engine's own clock, which does not run while it is suspended: wait until it does.
      if (ctx.state === 'running') go();
      else if (ctx.resume) ctx.resume().then(go, (err) => console.warn('[UiSounds] could not resume audio:', err && err.message));
      else go();
      return true;
    } catch (err) {
      console.error('[UiSounds] could not play ' + kind + ':', err);
      window.showToast?.('Could not play the sound: ' + ((err && err.message) || err), 'error');
      return false;
    }
  },

  _schedule(ctx, notes, peak) {
    const t0 = ctx.currentTime + 0.005;
    for (const n of notes) {
      const gain = ctx.createGain();
      const start = t0 + n.t;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.linearRampToValueAtTime(Math.max(0.0002, peak * n.g), start + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + n.d);
      let source;
      let filter = null;
      if (n.noise) {
        source = ctx.createBufferSource();
        source.buffer = this._noise(ctx);
        filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = n.f;
        filter.Q.value = n.q || 1;
        source.connect(filter);
        filter.connect(gain);
      } else {
        source = ctx.createOscillator();
        source.type = n.wave;
        source.frequency.setValueAtTime(n.f, start);
        if (n.f2 && n.f2 !== n.f) source.frequency.exponentialRampToValueAtTime(n.f2, start + n.d);
        source.connect(gain);
      }
      gain.connect(ctx.destination);
      source.onended = () => { try { source.disconnect(); if (filter) filter.disconnect(); gain.disconnect(); } catch { /* vex-allow-empty-catch: nodes already gone */ } };
      source.start(start);
      source.stop(start + n.d + 0.03);
    }
  },

  // ---- wiring ---------------------------------------------------------------------
  _isTypingTarget(t) {
    if (!t) return false;
    if (t.id && this.TYPING_IDS.includes(t.id)) return true;
    const list = t.classList;
    return !!(list && typeof list.contains === 'function' && this.TYPING_CLASSES.some(c => list.contains(c)));
  },
  _onKey(e) {
    if (!this._isTypingTarget(e.target)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (!(k.length === 1 || k === 'Backspace' || k === 'Delete' || k === 'Enter')) return;
    this.play('key', { fresh: true });
  },
  // The New Tab page's search box lives in a page of its own (a webview): its preload reports each key and js/webview.js calls this.
  onPageKey() { return this.play('key', { fresh: true }); },
  _onOver(e) {
    if (e.buttons) return;
    const t = e.target;
    if (!t || typeof t.closest !== 'function') return;
    const el = t.closest(this.HOVER_SELECTOR);
    if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return;
    // Moving between children of the same button is not entering it again.
    if (e.relatedTarget && el.contains(e.relatedTarget)) return;
    this.play('tick');
  },
  _onPress(e) {
    if (e.button !== undefined && e.button !== 0) return;
    const t = e.target;
    if (!t || typeof t.closest !== 'function') return;
    const el = t.closest(this.HOVER_SELECTOR);
    if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return;
    this.play('press');
  },

  init() {
    if (this._wired || typeof document === 'undefined') return this;
    this._wired = true;
    document.addEventListener('keydown', (e) => this._onKey(e), true);
    document.addEventListener('mouseover', (e) => this._onOver(e), true);
    document.addEventListener('pointerdown', (e) => this._onPress(e), true);
    const down = () => { this._down = true; this._downAt = Date.now(); };
    const up = () => { this._down = false; };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    window.addEventListener('dragend', up, true);
    window.addEventListener('blur', up);
    window.addEventListener('focus', up);
    // A pointer that moves over Vex with no button held says the last release was missed.
    document.addEventListener('pointermove', (e) => { if (this._down && e.buttons === 0) this._down = false; }, true);
    // The audio engine, started by the first thing the person does.
    const warm = () => {
      this.warm();
      if (this._ctx && this._ctx.state === 'running') {
        window.removeEventListener('pointerdown', warm, true);
        window.removeEventListener('keydown', warm, true);
      }
    };
    window.addEventListener('pointerdown', warm, true);
    window.addEventListener('keydown', warm, true);
    document.addEventListener('vex:tab-created', () => { this.play('tabOpen'); });
    document.addEventListener('vex:tab-closed', () => { this.play('tabClose'); });
    return this;
  },

  // ---- the Settings group -----------------------------------------------------------
  _row(host, label, hint, get, set) {
    const row = document.createElement('div');
    row.className = 'setting-toggle-row';
    const text = document.createElement('span');
    text.textContent = label;
    if (hint) {
      const h = document.createElement('span');
      h.style.cssText = 'display:block;color:var(--text-muted);font-size:11px';
      h.textContent = hint;
      text.appendChild(h);
    }
    const sw = document.createElement('label');
    sw.className = 'toggle';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!get();
    input.setAttribute('aria-label', label);
    input.addEventListener('change', () => {
      try { set(input.checked); }
      catch (err) { input.checked = !input.checked; window.showToast?.((err && err.message) || String(err), 'error'); }
    });
    const slider = document.createElement('span');
    slider.className = 'toggle-slider';
    sw.append(input, slider);
    row.append(text, sw);
    host.appendChild(row);
    return input;
  },

  _sliderRow(host, label, hint, { min, max, step, value, format, onInput, onChange }) {
    const row = document.createElement('div');
    row.className = 'setting-toggle-row';
    const text = document.createElement('span');
    text.textContent = label;
    if (hint) {
      const h = document.createElement('span');
      h.style.cssText = 'display:block;color:var(--text-muted);font-size:11px';
      h.textContent = hint;
      text.appendChild(h);
    }
    const box = document.createElement('span');
    box.style.cssText = 'display:inline-flex;align-items:center;gap:8px';
    const input = document.createElement('input');
    input.type = 'range'; input.min = String(min); input.max = String(max); input.step = String(step); input.value = String(value);
    input.setAttribute('aria-label', label);
    const shown = document.createElement('span');
    shown.style.cssText = 'min-width:3em;text-align:right;color:var(--text-muted);font-size:12px';
    shown.textContent = format(Number(input.value));
    input.addEventListener('input', () => {
      shown.textContent = format(Number(input.value));
      try { if (onInput) onInput(Number(input.value)); }
      catch (err) { window.showToast?.((err && err.message) || String(err), 'error'); }
    });
    input.addEventListener('change', () => {
      try { if (onChange) onChange(Number(input.value)); }
      catch (err) { window.showToast?.((err && err.message) || String(err), 'error'); }
    });
    box.append(input, shown);
    row.append(text, box);
    host.appendChild(row);
    return { input, shown };
  },

  // A sample of one sound, whatever the switches say (the volume still applies).
  sample(kind) {
    const ok = this.play(kind, { preview: true, fresh: true });
    if (!ok && this.lastReason) window.showToast?.('No sample: ' + this.lastReason);
    return ok;
  },

  group(el) {
    el.appendChild(VexSettingsGroups.note('Short sounds for Vex\'s own buttons, like Opera GX. They are made on the spot; nothing is downloaded. They stay silent in Game mode, in a meeting, in a Focus session, in quiet hours and while the window is in the background.'));
    this._row(el, 'Interface sounds', '', () => this.flag('master'), (on) => this.setFlag('master', on));
    this._row(el, 'Typing', 'a soft key click in the address bar, in Ctrl+K, in search boxes and in the New Tab page\'s search', () => this.flag('typing'), (on) => this.setFlag('typing', on));
    this._row(el, 'Hover', 'a clear tick when the pointer enters one of Vex\'s own buttons', () => this.flag('hover'), (on) => this.setFlag('hover', on));
    this._row(el, 'Tabs', 'two notes going up when a tab opens, going down when it closes', () => this.flag('tabs'), (on) => this.setFlag('tabs', on));
    this._row(el, 'Button presses', 'a small click when you press one of Vex\'s own buttons', () => this.flag('press'), (on) => this.setFlag('press', on));

    // The style: how every sound feels.
    const styleRow = document.createElement('div');
    styleRow.className = 'setting-toggle-row';
    const styleLabel = document.createElement('span');
    styleLabel.textContent = 'Sound style';
    const styleHint = document.createElement('span');
    styleHint.style.cssText = 'display:block;color:var(--text-muted);font-size:11px';
    styleHint.textContent = 'how every sound feels';
    styleLabel.appendChild(styleHint);
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'Sound style');
    for (const key of Object.keys(this.STYLES)) {
      const o = document.createElement('option');
      o.value = key; o.textContent = this.STYLES[key].name;
      select.appendChild(o);
    }
    select.value = this.style();
    select.addEventListener('change', () => {
      try { this.setStyle(select.value); this.sample('key'); }
      catch (err) { window.showToast?.((err && err.message) || String(err), 'error'); select.value = this.style(); }
    });
    styleRow.append(styleLabel, select);
    el.appendChild(styleRow);

    this._sliderRow(el, 'Volume', '', {
      min: 0, max: 100, step: 5, value: Math.round(this.volume() * 100), format: (v) => v + '%',
      onChange: (v) => { this.setVolume(v / 100); this.sample('tick'); },
    });
    this._sliderRow(el, 'Pitch', 'higher or lower, for every sound', {
      min: Math.round(this.PITCH_MIN * 100), max: Math.round(this.PITCH_MAX * 100), step: 5, value: Math.round(this.pitch() * 100), format: (v) => v + '%',
      onChange: (v) => { this.setPitch(v / 100); this.sample('tick'); },
    });

    // One sample per sound.
    const samples = document.createElement('div');
    samples.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:8px';
    for (const [label, kind] of [['Hear typing', 'key'], ['Hear hover', 'tick'], ['Hear a tab open', 'tabOpen'], ['Hear a tab close', 'tabClose'], ['Hear a button press', 'press']]) {
      samples.appendChild(VexSettingsGroups.button(label, () => this.sample(kind)));
    }
    el.appendChild(samples);
    const reset = VexSettingsGroups.button('Reset the sound options', () => {
      try { this.resetAll(); window.showToast?.('The sound options are back to how they were'); if (el.isConnected) { el.innerHTML = ''; this.group(el); } }
      catch (err) { window.showToast?.((err && err.message) || String(err), 'error'); }
    });
    reset.style.marginTop = '8px';
    el.appendChild(reset);
  },
};

if (typeof window !== 'undefined') {
  window.VexUiSounds = VexUiSounds;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'ui-sounds', title: 'Sounds', keywords: 'sound audio click tick hover typing key tab open close volume pitch style mechanical bubble arcade glass press button opera gx interface noise ses tıklama yazma', build: (el) => VexUiSounds.group(el) });
  }
  if (typeof document !== 'undefined') {
    try { VexUiSounds.init(); } catch (err) { console.error('[UiSounds] could not start:', err); }
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexUiSounds };
