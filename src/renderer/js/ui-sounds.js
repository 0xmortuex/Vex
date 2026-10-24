// === Interface sounds (like Opera GX) ========================================
//
// Short sounds for Vex's OWN controls, on by default:
//   Typing   a soft key click while you type in the address bar and in Ctrl+K
//   Hover    a clear tick when the pointer enters one of the browser's buttons
//            (toolbar, sidebar icons, tab strip, bookmarks bar). Never page content.
//   Tabs     two notes going up when a tab opens, two going down when one closes
//
// This is feedback for the browser's controls, not playful decoration, so it is not
// under the Play level (js/vex-playfulness.js lists it as functional audio) and its
// switches default to ON. Nothing is downloaded: every sound is made with WebAudio
// when it is asked for.
//
// A sound is made only when VexUiSounds.decide() says so: the master switch and the
// kind's own switch are on, the volume is above zero, it is not quiet hours (shared
// with js/vex-sounds.js), Game mode / a meeting / a Focus session (and the other
// quiet modes of AttentionState) are not on, the window is visible and focused, no
// mouse button is held (a drag), and the kind's rate limit has passed. decide() is
// pure and tested.
const VexUiSounds = {
  KEYS: {
    master: 'vex.uiSounds.master',     // '0' = off; anything else (or nothing saved) = on
    typing: 'vex.uiSounds.typing',
    hover: 'vex.uiSounds.hover',
    tabs: 'vex.uiSounds.tabs',
    volume: 'vex.uiSounds.volume',     // 0..1, default 0.5
  },
  DEFAULT_VOLUME: 0.5,

  // Which switch each sound belongs to, and the least time between two of the same sound (ms).
  KINDS: {
    key: { flag: 'typing', gap: 40 },
    tick: { flag: 'hover', gap: 130 },
    tabOpen: { flag: 'tabs', gap: 250 },
    tabClose: { flag: 'tabs', gap: 700 },
  },
  // AttentionState sources that silence interface sounds.
  QUIET_SOURCES: ['game', 'meeting', 'focus', 'exam', 'study', 'sharing', 'quiet-switch'],
  // A tab that opens within this long of the window settling is session restore, not the person.
  SETTLE_MS: 2000,

  // The pointer entering any of these makes a tick. Browser chrome only: page content lives in
  // webviews, whose events never reach this document.
  HOVER_SELECTOR: [
    '#top-bar button', '#icon-sidebar button', '#top-tab-bar button', '#top-tabs-list .tab-item',
    '#tabs-sidebar .tab-item', '#tabs-sidebar button', '#gui-shortcuts-bar button', '#gui-shortcuts-bar .gsc',
  ].join(', '),
  TYPING_IDS: ['url-input', 'command-input'],

  // Notes: f = start Hz, f2 = end Hz (a quick glide), t = start (s), d = length (s), g = relative loudness.
  RECIPES: {
    key: [{ wave: 'triangle', f: 1500, f2: 700, t: 0, d: 0.035, g: 0.5 }],
    tick: [{ wave: 'sine', f: 2000, f2: 1600, t: 0, d: 0.06, g: 0.8 }, { wave: 'triangle', f: 4000, f2: 3200, t: 0, d: 0.03, g: 0.18 }],
    tabOpen: [{ wave: 'sine', f: 523.25, t: 0, d: 0.12, g: 0.7 }, { wave: 'sine', f: 783.99, t: 0.08, d: 0.18, g: 0.7 }],
    tabClose: [{ wave: 'sine', f: 783.99, t: 0, d: 0.1, g: 0.6 }, { wave: 'sine', f: 523.25, t: 0.07, d: 0.16, g: 0.6 }],
  },

  // ---- the decision (pure) ------------------------------------------------------
  // enabled: { master, typing, hover, tabs }; sources: ids from AttentionState; last: ms of the
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
  notesFor(kind, jitter = 1) {
    const r = this.RECIPES[kind];
    if (!r) throw new Error('Unknown interface sound ' + kind);
    return r.map(n => ({ ...n, f: n.f * jitter, f2: (n.f2 || n.f) * jitter }));
  },

  // ---- saved settings -------------------------------------------------------------
  _read(key) { try { return localStorage.getItem(key); } catch { return null; } },
  _write(key, value) {
    try { localStorage.setItem(key, value); }
    catch (err) { throw new Error('The sound setting could not be saved: ' + err.message, { cause: err }); }
  },
  flag(name) {
    if (!this.KEYS[name] || name === 'volume') throw new Error('Unknown sound switch ' + name);
    return this._read(this.KEYS[name]) !== '0';
  },
  setFlag(name, on) {
    if (!this.KEYS[name] || name === 'volume') throw new Error('Unknown sound switch ' + name);
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
  // True when the tab open/close sounds are switched on (js/vex-sounds.js then leaves tab close to this file).
  tabsOn() { return this.flag('master') && this.flag('tabs'); },

  _enabled() { return { master: this.flag('master'), typing: this.flag('typing'), hover: this.flag('hover'), tabs: this.flag('tabs') }; },

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
  why(kind, opts = {}) {
    const now = Date.now();
    return this.decide({
      kind,
      enabled: this._enabled(),
      volume: this.volume(),
      quietHours: this._quietHours(now),
      sources: this._sources(),
      hidden: typeof document !== 'undefined' && document.hidden,
      unfocused: typeof document !== 'undefined' && typeof document.hasFocus === 'function' && !document.hasFocus(),
      buttonsDown: this._down,
      last: this._last[kind] || 0,
      now,
      settled: kind === 'tabOpen' ? this.settledFor(typeof VexBoot !== 'undefined' ? VexBoot.marks : null, performance.now()) : undefined,
      preview: !!opts.preview,
    });
  },

  _ctx: null,
  _context() {
    if (this._ctx) return this._ctx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) throw new Error('This window has no WebAudio');
    this._ctx = new Ctx();
    return this._ctx;
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
    const notes = this.notesFor(kind, jitter);
    const peak = 0.5 * this.volume();
    try {
      const ctx = this._context();
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume().catch((err) => console.warn('[UiSounds] could not resume audio:', err && err.message));
      const t0 = ctx.currentTime;
      for (const n of notes) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = n.wave;
        const start = t0 + n.t;
        osc.frequency.setValueAtTime(n.f, start);
        if (n.f2 && n.f2 !== n.f) osc.frequency.exponentialRampToValueAtTime(n.f2, start + n.d);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.linearRampToValueAtTime(Math.max(0.0002, peak * n.g), start + 0.004);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + n.d);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.onended = () => { try { osc.disconnect(); gain.disconnect(); } catch { /* vex-allow-empty-catch: nodes already gone */ } };
        osc.start(start);
        osc.stop(start + n.d + 0.03);
      }
      return true;
    } catch (err) {
      console.error('[UiSounds] could not play ' + kind + ':', err);
      window.showToast?.('Could not play the sound: ' + ((err && err.message) || err), 'error');
      return false;
    }
  },

  // ---- wiring ---------------------------------------------------------------------
  _onKey(e) {
    const t = e.target;
    if (!t || !this.TYPING_IDS.includes(t.id)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (!(k.length === 1 || k === 'Backspace' || k === 'Delete' || k === 'Enter')) return;
    this.play('key');
  },
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

  init() {
    if (this._wired || typeof document === 'undefined') return this;
    this._wired = true;
    document.addEventListener('keydown', (e) => this._onKey(e), true);
    document.addEventListener('mouseover', (e) => this._onOver(e), true);
    const down = () => { this._down = true; };
    const up = () => { this._down = false; };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    window.addEventListener('dragend', up, true);
    window.addEventListener('blur', up);
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

  group(el) {
    el.appendChild(VexSettingsGroups.note('Short sounds for Vex\'s own buttons, like Opera GX. They are made on the spot; nothing is downloaded. They stay silent in Game mode, in a meeting, in a Focus session, in quiet hours and while the window is in the background.'));
    this._row(el, 'Interface sounds', '', () => this.flag('master'), (on) => this.setFlag('master', on));
    this._row(el, 'Typing', 'a soft key click in the address bar and in Ctrl+K', () => this.flag('typing'), (on) => this.setFlag('typing', on));
    this._row(el, 'Hover', 'a clear tick when the pointer enters one of Vex\'s own buttons', () => this.flag('hover'), (on) => this.setFlag('hover', on));
    this._row(el, 'Tabs', 'two notes going up when a tab opens, going down when it closes', () => this.flag('tabs'), (on) => this.setFlag('tabs', on));
    const volRow = document.createElement('div');
    volRow.className = 'setting-toggle-row';
    const volLabel = document.createElement('span');
    volLabel.textContent = 'Volume';
    const vol = document.createElement('input');
    vol.type = 'range'; vol.min = '0'; vol.max = '100'; vol.step = '5';
    vol.value = String(Math.round(this.volume() * 100));
    vol.setAttribute('aria-label', 'Volume');
    vol.addEventListener('change', () => {
      try { this.setVolume(Number(vol.value) / 100); }
      catch (err) { window.showToast?.((err && err.message) || String(err), 'error'); }
    });
    volRow.append(volLabel, vol);
    el.appendChild(volRow);
    const prev = VexSettingsGroups.button('Play a sample', () => {
      const ok = this.play('tabOpen', { preview: true });
      if (!ok && this.lastReason) window.showToast?.('No sample: ' + this.lastReason);
    });
    prev.style.marginTop = '8px';
    el.appendChild(prev);
  },
};

if (typeof window !== 'undefined') {
  window.VexUiSounds = VexUiSounds;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'ui-sounds', title: 'Sounds', keywords: 'sound audio click tick hover typing key tab open close volume opera gx interface noise', build: (el) => VexUiSounds.group(el) });
  }
  if (typeof document !== 'undefined') {
    try { VexUiSounds.init(); } catch (err) { console.error('[UiSounds] could not start:', err); }
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexUiSounds };
