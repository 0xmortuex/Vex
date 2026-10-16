// === Light and dark (automatic theme switching) ===
//
// The user keeps one LIGHT theme and one DARK theme, and Vex wears whichever
// fits right now:
//   'system'    Windows' app mode. The main process watches nativeTheme and
//               tells every Vex window when it changes (src/main/system-theme.js).
//   'schedule'  fixed times, dark from `from` to `to` (it may wrap midnight).
//   'sun'       sunset to sunrise, worked out on this machine from a location
//               the user already gave Vex: Settings › Location's manual
//               coordinates first, else the weather city picked in Settings.
//               No location means no sun times; the option says so and is
//               not offered. Nothing is looked up on the network.
//   'off'       one theme, as before.
//
// A theme picked by hand while this is on fills the slot that matches its own
// lightness (a light theme is the light theme, whatever the hour) and is shown
// at once. A light theme picked in the dark hours is held on screen until the
// next switch, which then wears it anyway as the light theme (state.held:
// { theme, dark } - dropped at that switch). The browser looks that come in a light and a dark version (Firefox,
// Chrome, Fluent) switch with it, so their chrome changes too.
//
// Stored as one JSON value under 'vex.themeAuto' (synced, and cleared by Reset).
//
// WIND-DOWN (bottom of this file): independent of the above, off by default.
// After a set hour a warm, dimming veil fades in over the whole Vex window
// (every look, every theme, and the New Tab page, which is a webview under
// that veil) over N minutes, and fades out at the end hour. Optionally it
// also wears the dark variant for the evening and puts the theme back exactly.
// Stored under 'vex.windDown' (this device only). See windLevel().

const ThemeAuto = {
  KEY: 'vex.themeAuto',
  MODES: ['off', 'system', 'schedule', 'sun'],
  DEFAULT_FROM: '19:00',
  DEFAULT_TO: '07:00',
  TICK_MS: 20000,
  // The looks that have a light and a dark version of themselves.
  LOOK_PAIRS: { firefox: 'firefox-dark', chrome: 'chrome-dark', fluent: 'fluent-dark' },

  // Replaced by tests and the live probe to stand in for the clock.
  _clock: () => new Date(),
  _systemDark: null,
  _lastDark: null,
  _started: false,

  // --- pure helpers ---------------------------------------------------------

  // 'HH:MM' -> minutes after midnight, or null.
  parseHM(s) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || ''));
    if (!m) return null;
    const h = Number(m[1]), min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  },
  formatHM(minutes) {
    const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
    return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  },

  // Dark between `from` and `to` (minutes); a span that passes midnight wraps.
  isDarkBySchedule(minutes, from, to) {
    if (from === to) return false;
    return from < to ? (minutes >= from && minutes < to) : (minutes >= from || minutes < to);
  },

  // Sunrise and sunset for the local calendar day of `date` at lat/lon (the
  // NOAA / SunCalc formulas, sun's centre 0.833 degrees below the horizon).
  // { sunrise: Date, sunset: Date } or { polar: 'day' | 'night' } when the sun
  // does not rise or set that day.
  sunTimes(date, lat, lon) {
    const rad = Math.PI / 180, dayMs = 86400000, J1970 = 2440588, J2000 = 2451545, J0 = 0.0009;
    const noon = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0);
    const d = noon.valueOf() / dayMs - 0.5 + J1970 - J2000;
    const lw = rad * -lon, phi = rad * lat;
    const n = Math.round(d - J0 - lw / (2 * Math.PI));
    const ds = J0 + lw / (2 * Math.PI) + n;
    const M = rad * (357.5291 + 0.98560028 * ds);
    const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
    const L = M + C + rad * 102.9372 + Math.PI;
    const dec = Math.asin(Math.sin(rad * 23.4397) * Math.sin(L));
    const jNoon = J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
    const cosW = (Math.sin(rad * -0.833) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
    if (cosW < -1) return { polar: 'day' };
    if (cosW > 1) return { polar: 'night' };
    const w = Math.acos(cosW);
    const a = J0 + (w + lw) / (2 * Math.PI) + n;
    const jSet = J2000 + a + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
    const jRise = jNoon - (jSet - jNoon);
    const fromJ = j => new Date((j + 0.5 - J1970) * dayMs);
    return { sunrise: fromJ(jRise), sunset: fromJ(jSet) };
  },

  isDarkBySun(now, coords) {
    const t = this.sunTimes(now, coords.lat, coords.lon);
    if (t.polar) return t.polar === 'night';
    return now < t.sunrise || now >= t.sunset;
  },

  // Relative luminance of '#rrggbb'.
  _luminance(hex) {
    const m = /^#([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return null;
    const v = parseInt(m[1], 16);
    const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return 0.2126 * lin((v >> 16) & 255) + 0.7152 * lin((v >> 8) & 255) + 0.0722 * lin(v & 255);
  },
  // Light or dark, from the theme's page colour. The first eight themes carry
  // no `mock` palette; of them only Oxford is light.
  isLightTheme(meta) {
    if (!meta) return false;
    if (meta.id === 'oxford') return true;
    const l = meta.mock ? this._luminance(meta.mock.bg) : null;
    return l != null && l > 0.4;
  },

  // The slots to start from when the feature is first turned on: the theme in
  // use keeps its own slot; the other gets its partner (Firefox Light <-> Firefox
  // Dark) or Vex's default for that side.
  defaultSlots(currentId, themes) {
    const meta = themes.find(t => t.id === currentId);
    const partner = { 'firefox-light': 'firefox-dark', 'firefox-dark': 'firefox-light', 'mica-light': 'mica-dark', 'mica-dark': 'mica-light', 'contrast-light': 'contrast-dark', 'contrast-dark': 'contrast-light' };
    if (this.isLightTheme(meta)) return { light: currentId, dark: partner[currentId] || 'firefox-dark' };
    if (meta) return { light: partner[currentId] || 'oxford', dark: currentId };
    return { light: 'oxford', dark: 'firefox-dark' };
  },

  // Whether it is dark now: true/false, or null when it cannot be known (no
  // location for 'sun', the Windows mode not yet heard).
  resolveDark(state, ctx) {
    if (!state || state.mode === 'off') return null;
    if (state.mode === 'system') return typeof ctx.systemDark === 'boolean' ? ctx.systemDark : null;
    const now = ctx.now;
    if (state.mode === 'schedule') {
      const from = this.parseHM(state.from), to = this.parseHM(state.to);
      if (from == null || to == null) return null;
      return this.isDarkBySchedule(now.getHours() * 60 + now.getMinutes(), from, to);
    }
    if (state.mode === 'sun') return ctx.coords ? this.isDarkBySun(now, ctx.coords) : null;
    return null;
  },

  // When the next switch is due ('schedule' and 'sun'), as a Date, or null.
  nextChange(state, now, coords) {
    if (state.mode === 'schedule') {
      const from = this.parseHM(state.from), to = this.parseHM(state.to);
      if (from == null || to == null || from === to) return null;
      const cur = now.getHours() * 60 + now.getMinutes();
      const at = this.isDarkBySchedule(cur, from, to) ? to : from;
      const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), Math.floor(at / 60), at % 60, 0, 0);
      if (next <= now) next.setDate(next.getDate() + 1);
      return next;
    }
    if (state.mode === 'sun' && coords) {
      for (let i = 0; i < 3; i++) {
        const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i, 12);
        const t = this.sunTimes(day, coords.lat, coords.lon);
        if (t.polar) continue;
        for (const x of [t.sunrise, t.sunset]) if (x > now) return x;
      }
    }
    return null;
  },

  // --- stored state ---------------------------------------------------------

  state() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(this.KEY) || 'null'); }
    catch (err) { console.error('[ThemeAuto] stored value unreadable, treating as off:', err.message); }
    if (!s || typeof s !== 'object' || !this.MODES.includes(s.mode)) return { mode: 'off' };
    return s;
  },
  save(next) {
    if (!this.MODES.includes(next.mode)) throw new Error('Unknown light-and-dark mode: ' + next.mode);
    localStorage.setItem(this.KEY, JSON.stringify(next));
  },
  isOn() { return this.state().mode !== 'off'; },

  // A location the user gave Vex: Settings › Location's manual coordinates,
  // else the weather city chosen in Settings. Not an IP guess.
  coords() {
    const num = v => (typeof v === 'number' || typeof v === 'string') && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null;
    const ok = (lat, lon) => lat != null && lon != null && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
    try {
      const m = JSON.parse(localStorage.getItem('vex.manualLocation') || 'null');
      if (m && ok(num(m.latitude), num(m.longitude))) return { lat: num(m.latitude), lon: num(m.longitude), label: m.label || 'your saved location' };
    } catch (err) { console.error('[ThemeAuto] vex.manualLocation unreadable:', err.message); }
    try {
      const w = JSON.parse(localStorage.getItem('vex.weatherLoc') || 'null');
      if (w && !w.approx && ok(num(w.lat), num(w.lon))) return { lat: num(w.lat), lon: num(w.lon), label: w.city || 'your weather city' };
    } catch (err) { console.error('[ThemeAuto] vex.weatherLoc unreadable:', err.message); }
    return null;
  },

  _themes() { return (typeof ThemeManager !== 'undefined' && ThemeManager.THEMES) || []; },
  _valid(id) { return this._themes().some(t => t.id === id); },
  _label(id) { const t = this._themes().find(x => x.id === id); return t ? t.label : id; },

  _ctx() {
    return { systemDark: this._systemDark, now: this._clock(), coords: this.coords() };
  },

  // --- applying -------------------------------------------------------------

  // The theme to start with, before first paint (ThemeManager.init asks).
  async bootTheme() {
    const st = this.state();
    if (st.mode === 'off') return null;
    if (st.mode === 'system') await this._readSystem();
    const dark = this.resolveDark(st, this._ctx());
    if (dark == null) return null;
    const id = this._heldFor(st, dark) || (dark ? st.dark : st.light);
    return this._valid(id) ? id : null;
  },

  // The theme picked by hand against the hour, while that hour lasts.
  _heldFor(st, dark) {
    const h = st.held;
    if (!h || typeof h !== 'object' || h.dark !== dark || !this._valid(h.theme)) return null;
    return h.theme;
  },

  async _readSystem() {
    if (!window.vex || typeof window.vex.getSystemDark !== 'function') throw new Error('The Windows light/dark mode cannot be read here');
    const r = await window.vex.getSystemDark();
    this._systemDark = !!(r && r.dark);
    return this._systemDark;
  },

  // Put the right theme on. `force` also re-applies the look's light/dark
  // version; otherwise that only happens when it turns light or dark, so a
  // look picked by hand stays until the next switch.
  evaluate({ force = false } = {}) {
    // While the theme editor is open its preview is on screen; a switch now
    // would throw it away. It runs again when the editor closes.
    if (typeof ThemeStudio !== 'undefined' && ThemeStudio.isEditing()) return null;
    const st = this.state();
    if (st.mode === 'off') { this._lastDark = null; this.renderSettings(); return null; }
    const dark = this.resolveDark(st, this._ctx());
    if (dark == null) { this.renderSettings(); return null; }
    const changed = dark !== this._lastDark;
    this._lastDark = dark;
    // A hand pick held against the hour ends at the switch.
    if (st.held && !this._heldFor(st, dark)) { const rest = { ...st }; delete rest.held; this.save(rest); }
    let want = this._heldFor(st, dark) || (dark ? st.dark : st.light);
    // Wind-down wearing the dark variant: that stays until the wind-down ends.
    const windForced = this._windForced();
    if (windForced) want = windForced.dark;
    let applied = false;
    if (this._valid(want) && typeof ThemeManager !== 'undefined' && ThemeManager.currentTheme !== want) {
      ThemeManager.applyTheme(want, { auto: true });
      applied = true;
    }
    if (changed || force) this._applyLook(dark);
    if ((changed || force || applied) && this._valid(want)) this._applyColours(want);
    this.renderSettings();
    return dark;
  },

  _applyLook(dark) {
    const G = window.VexGuiStyle;
    if (!G || typeof G.get !== 'function') return;
    const cur = G.get();
    const lightOf = Object.keys(this.LOOK_PAIRS).find(k => this.LOOK_PAIRS[k] === cur);
    const base = this.LOOK_PAIRS[cur] ? cur : lightOf;
    if (!base) return;
    const want = dark ? this.LOOK_PAIRS[base] : base;
    if (want === cur) return;
    Promise.resolve(G.set(want)).catch(err => console.error('[ThemeAuto] look switch failed:', err));
  },

  // The themes that ARE a browser look's own colours: under that look, its own
  // colours show them as they are.
  LOOK_PALETTES: { 'firefox-light': ['firefox', 'firefox-dark'], 'firefox-dark': ['firefox', 'firefox-dark'] },

  // A browser look showing its own colours ignored a theme switched in by this
  // feature: with AMOLED as the dark theme the Firefox look stayed Firefox Dark
  // grey (a hand pick moves the look to the theme's colours - gui-style.js -
  // but an automatic switch is not a pick). So a switch to a theme that is not
  // the look's own palette moves the look to the theme's colours, and a later
  // switch to one that is (Firefox Light/Dark under the Firefox look) gives the
  // look its own colours back - only if it was this feature that took them.
  _applyColours(themeId) {
    const G = window.VexGuiStyle;
    if (!G || typeof G.isBrowserLook !== 'function' || !G.isBrowserLook()) return;
    const st = this.state();
    const own = (this.LOOK_PALETTES[themeId] || []).includes(G.get());
    if (own) {
      if (!st.coloursByAuto) return;
      if (G.getColors() === 'theme') G.setColors('look');
      this.save({ ...st, coloursByAuto: false });
      return;
    }
    if (G.getColors() !== 'look') return;
    G.setColors('theme');
    this.save({ ...st, coloursByAuto: true });
  },

  // A theme picked by hand while this is on fills the slot that matches its
  // own lightness and stays on screen now. Picking Catppuccin Latte at night
  // used to make it the DARK theme (final review, 2026-10-09).
  _onThemeChanged(e) {
    const d = e && e.detail;
    if (!d || !d.userChoice || d.auto) return;
    // A theme picked by hand while the wind-down wears the dark variant is the
    // user's explicit choice: it stays, and nothing is restored over it.
    if (this.windState().forced) this._windSave({ ...this.windState(), forced: null });
    // A hand pick decides the look's colours itself (gui-style.js); a later
    // automatic switch must not undo that as if this feature had made it.
    if (this.state().coloursByAuto) this.save({ ...this.state(), coloursByAuto: false });
    const st = this.state();
    if (st.mode === 'off') return;
    const meta = this._themes().find(t => t.id === d.theme);
    if (!meta) return;
    const light = this.isLightTheme(meta);
    const slot = light ? 'light' : 'dark';
    const next = { ...st, [slot]: d.theme };
    const dark = this._lastDark != null ? this._lastDark : this.resolveDark(st, this._ctx());
    // Against the hour (a light theme at night): held until the next switch.
    const against = dark != null && dark === light;
    if (against) next.held = { theme: d.theme, dark };
    else delete next.held;
    this.save(next);
    this.renderSettings();
    window.showToast?.(this.pickToast(d.theme, slot, against, dark, next), 'info', 6000);
  },

  // What a hand pick did and what happens at the next switch.
  pickToast(id, slot, against, dark, st) {
    const name = this._label(id);
    const other = slot === 'light' ? 'dark' : 'light';
    const otherName = this._label(st[other]);
    const when = (toDark, withTime) => {
      const word = toDark ? 'dark' : 'light';
      if (st.mode === 'system') return `when Windows turns ${word}`;
      const next = withTime ? this.nextChange(st, this._clock(), this.coords()) : null;
      return next ? `when it turns ${word} at ${this.formatHM(next.getHours() * 60 + next.getMinutes())}` : `when it turns ${word}`;
    };
    if (dark == null) return `${name} is now your ${slot} theme — ${otherName} stays your ${other} theme`;
    if (against) return `${name} is now your ${slot} theme, shown now and kept ${when(!dark, true)}. ${otherName} comes back ${when(dark, false)}.`;
    return `${name} is now your ${slot} theme — ${otherName} comes back ${when(!dark, true)}`;
  },

  // For the theme picker: which slot a theme holds, and what a pick does.
  slotOf(id) {
    const st = this.state();
    if (st.mode === 'off') return '';
    if (st.light === id) return 'light';
    if (st.dark === id) return 'dark';
    return '';
  },
  pickerNote() {
    const st = this.state();
    if (st.mode === 'off') return '';
    const dark = this._lastDark != null ? this._lastDark : this.resolveDark(st, this._ctx());
    if (dark == null) return 'Light and dark is on. A light theme you pick becomes your light theme, a dark one your dark theme.';
    return `Light and dark is on and it is ${dark ? 'dark' : 'light'} now. A light theme you pick becomes your light theme and a dark one your dark theme, and either shows now. Light: ${this._label(st.light)}. Dark: ${this._label(st.dark)}.`;
  },

  async start() {
    if (this._started) return;
    this._started = true;
    if (window.vex && typeof window.vex.onSystemThemeChanged === 'function') {
      this._unsub = window.vex.onSystemThemeChanged((p) => {
        this._systemDark = !!(p && p.dark);
        if (this.state().mode === 'system') this.evaluate();
        else this.renderSettings();
      });
    }
    this._abort = new AbortController();
    document.addEventListener('theme-changed', (e) => this._onThemeChanged(e), { signal: this._abort.signal });
    // A 'ui' job: held while Vex is hidden, and run as soon as it is back, so
    // a laptop that slept through sunset wakes up in the right theme.
    VexJobs.every('Light and dark', this.TICK_MS, () => { this.evaluate(); this.windTick(); });
    if (this._systemDark == null) {
      try { await this._readSystem(); }
      catch (err) { console.error('[ThemeAuto] Windows light/dark mode:', err.message); }
    }
    this.wireSettings();
    this.wireWind();
    this.evaluate({ force: true });
    this.windTick({ instant: true });
  },

  // Stops listening (tests load a fresh copy each time).
  stop() {
    if (this._abort) this._abort.abort();
    if (typeof this._unsub === 'function') this._unsub();
    if (typeof VexJobs !== 'undefined') VexJobs.stop?.('Light and dark');
    const veil = typeof document !== 'undefined' && document.getElementById(this.WIND_VEIL_ID);
    if (veil) veil.remove();
    this._started = false;
  },

  // Turn it on, off, or change it, from Settings.
  set(patch) {
    const before = this.state();
    const next = { ...before, ...patch };
    // Settings decides the slots now: a theme held from a hand pick lets go.
    delete next.held;
    if (next.mode !== 'off') {
      const cur = typeof ThemeManager !== 'undefined' ? ThemeManager.currentTheme : 'oxford';
      const slots = this.defaultSlots(cur, this._themes());
      if (!this._valid(next.light)) next.light = slots.light;
      if (!this._valid(next.dark)) next.dark = slots.dark;
      if (this.parseHM(next.from) == null) next.from = this.DEFAULT_FROM;
      if (this.parseHM(next.to) == null) next.to = this.DEFAULT_TO;
    }
    this.save(next);
    this._lastDark = null;
    return this.evaluate({ force: true });
  },

  // --- Settings › Appearance ------------------------------------------------

  _el(id) { return document.getElementById(id); },

  wireSettings() {
    const mode = this._el('setting-theme-auto-mode');
    if (!mode || mode.dataset.wired) return;
    mode.dataset.wired = '1';
    const light = this._el('setting-theme-light'), dark = this._el('setting-theme-dark');
    const from = this._el('setting-theme-dark-from'), to = this._el('setting-theme-dark-to');
    this.refreshThemeLists();
    mode.addEventListener('change', () => {
      if (mode.value === 'sun' && !this.coords()) { mode.value = this.state().mode; return; }
      this.set({ mode: mode.value });
      const words = { off: 'Light and dark: off', system: 'Light and dark: following Windows', schedule: 'Light and dark: on a schedule', sun: 'Light and dark: sunset to sunrise' };
      window.showToast?.(words[mode.value], 'info', 2000);
    });
    light.addEventListener('change', () => this.set({ light: light.value }));
    dark.addEventListener('change', () => this.set({ dark: dark.value }));
    const times = () => {
      const f = this.parseHM(from.value), t = this.parseHM(to.value);
      if (f == null || t == null) return;
      if (f === t) { window.showToast?.('The dark hours need a start and an end that differ', 'error'); this.renderSettings(); return; }
      this.set({ from: from.value, to: to.value });
    };
    from.addEventListener('change', times);
    to.addEventListener('change', times);
    this.renderSettings();
  },

  // The two theme lists, sorted light and dark. Filled again when your own
  // themes change (js/theme-studio.js), so a new one can take a slot.
  refreshThemeLists() {
    const fill = (sel) => {
      if (!sel) return;
      const group = (label, list) => {
        const g = document.createElement('optgroup');
        g.label = label;
        for (const t of list) { const o = document.createElement('option'); o.value = t.id; o.textContent = t.label; g.appendChild(o); }
        sel.appendChild(g);
      };
      sel.innerHTML = '';
      const themes = this._themes();
      group('Light themes', themes.filter(t => this.isLightTheme(t)));
      group('Dark themes', themes.filter(t => !this.isLightTheme(t)));
    };
    fill(this._el('setting-theme-light'));
    fill(this._el('setting-theme-dark'));
    this.renderSettings();
  },

  renderSettings() {
    const mode = this._el('setting-theme-auto-mode');
    if (!mode) return;
    const st = this.state();
    const coords = this.coords();
    const sunOpt = mode.querySelector('option[value="sun"]');
    if (sunOpt) {
      sunOpt.disabled = !coords && st.mode !== 'sun';
      sunOpt.textContent = coords ? 'Sunset to sunrise' : 'Sunset to sunrise — needs a location';
    }
    mode.value = st.mode;
    const on = st.mode !== 'off';
    // style.display, not [hidden]: .setting-toggle-row's display:flex beats it.
    const details = this._el('theme-auto-details');
    if (details) details.style.display = on ? '' : 'none';
    const sched = this._el('theme-auto-schedule-row');
    if (sched) sched.style.display = st.mode === 'schedule' ? '' : 'none';
    const light = this._el('setting-theme-light'), dark = this._el('setting-theme-dark');
    if (on && light && st.light) light.value = st.light;
    if (on && dark && st.dark) dark.value = st.dark;
    const from = this._el('setting-theme-dark-from'), to = this._el('setting-theme-dark-to');
    if (from) from.value = st.from || this.DEFAULT_FROM;
    if (to) to.value = st.to || this.DEFAULT_TO;
    const status = this._el('theme-auto-status');
    if (status) status.textContent = this.statusText(st, coords);
    const hint = this._el('theme-auto-hint');
    if (hint) hint.textContent = coords
      ? 'Wear a light theme by day and a dark one at night, by Windows’ own setting or by the clock.'
      : 'Wear a light theme by day and a dark one at night, by Windows’ own setting or by the clock. Sunset to sunrise needs a location: set one under Location or pick a weather city.';
  },

  statusText(st, coords) {
    if (st.mode === 'off') return '';
    const ctx = { systemDark: this._systemDark, now: this._clock(), coords };
    const dark = this.resolveDark(st, ctx);
    if (st.mode === 'sun' && !coords) return 'No location set, so the sun times are unknown and the theme stays as it is. Set one under Location.';
    if (dark == null) return 'Waiting to hear whether Windows is in light or dark mode.';
    const held = this._heldFor(st, dark);
    const now = held
      ? `Now ${dark ? 'dark' : 'light'}, showing ${this._label(held)} (picked by hand).`
      : `Now ${dark ? 'dark' : 'light'}: ${this._label(dark ? st.dark : st.light)}.`;
    const pickNote = ' A theme you pick by hand becomes your light or dark theme, whichever it is.';
    if (st.mode === 'system') return `${now} Windows is in ${dark ? 'dark' : 'light'} mode.` + pickNote;
    const next = this.nextChange(st, ctx.now, coords);
    const at = next ? ` until ${this.formatHM(next.getHours() * 60 + next.getMinutes())}` : '';
    const where = st.mode === 'sun' ? ` Sun times for ${coords.label}.` : '';
    return `${now.slice(0, -1)}${at}.${where}` + pickNote;
  },
};

// --- Wind-down ---------------------------------------------------------------

Object.assign(ThemeAuto, {
  WIND_KEY: 'vex.windDown',
  WIND_VEIL_ID: 'wind-down-veil',
  WIND_DEFAULTS: { on: false, start: '22:00', end: '06:00', rampMin: 30, intensity: 60, forceDark: false, snoozeUntil: 0, forced: null },
  WIND_RAMPS: [15, 30, 60, 90],
  WIND_MAX_DIM: 0.45,
  WIND_MAX_WARM: 0.30,
  WIND_WARM_RGB: '255,140,40',

  // --- pure -----------------------------------------------------------------

  // How far into the wind-down it is, 0..1. `minutes` is minutes after
  // midnight and may be fractional. It ramps up over rampMin from `start`,
  // holds, and ramps down over the same time before `end`; a span shorter
  // than two ramps peaks at its middle. 0 outside the span.
  windLevel(minutes, start, end, rampMin) {
    if (start == null || end == null || start === end) return 0;
    const span = ((end - start) % 1440 + 1440) % 1440;
    const m = (((minutes - start) % 1440) + 1440) % 1440;
    if (m >= span) return 0;
    const r = Math.max(1, rampMin);
    return Math.max(0, Math.min(1, m / r, (span - m) / r));
  },

  // The veil's two alphas for a level and an intensity (1..100).
  windAlphas(level, intensity) {
    const k = Math.max(0, Math.min(1, level)) * Math.max(0, Math.min(100, intensity)) / 100;
    return { dim: +(this.WIND_MAX_DIM * k).toFixed(4), warm: +(this.WIND_MAX_WARM * k).toFixed(4) };
  },

  // The end (ms) of the wind-down that is running, or of the next one when
  // none is: what "not tonight" skips up to.
  windEndMs(now, start, end) {
    const next = (from, minutes) => {
      const d = new Date(from.getFullYear(), from.getMonth(), from.getDate(), Math.floor(minutes / 60), minutes % 60, 0, 0);
      if (d.getTime() <= from.getTime()) d.setDate(d.getDate() + 1);
      return d;
    };
    const cur = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
    const span = ((end - start) % 1440 + 1440) % 1440;
    const m = (((cur - start) % 1440) + 1440) % 1440;
    if (m < span) return next(now, end).getTime();
    return next(next(now, start), end).getTime();
  },

  // --- stored state ---------------------------------------------------------

  windState() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(this.WIND_KEY) || 'null'); }
    catch (err) { console.error('[ThemeAuto] wind-down value unreadable, treating as off:', err.message); }
    const d = this.WIND_DEFAULTS;
    if (!s || typeof s !== 'object') return { ...d };
    const out = { ...d, ...s, on: s.on === true };
    if (this.parseHM(out.start) == null) out.start = d.start;
    if (this.parseHM(out.end) == null) out.end = d.end;
    out.rampMin = Number(out.rampMin);
    if (!this.WIND_RAMPS.includes(out.rampMin)) out.rampMin = d.rampMin;
    const iv = Number(out.intensity);
    out.intensity = Number.isFinite(iv) ? Math.max(1, Math.min(100, iv)) : d.intensity;
    out.forceDark = out.forceDark === true;
    out.snoozeUntil = Number(out.snoozeUntil) || 0;
    return out;
  },
  _windSave(next) { localStorage.setItem(this.WIND_KEY, JSON.stringify(next)); },
  windSet(patch) {
    this._windSave({ ...this.windState(), ...patch });
    this.windTick({ instant: true });
    this.renderWind();
  },
  windSnooze() {
    const st = this.windState();
    this.windSet({ snoozeUntil: this.windEndMs(this._clock(), this.parseHM(st.start), this.parseHM(st.end)) });
    window.showToast?.('Wind-down is off for tonight', 'info', 3000);
  },
  windResume() { this.windSet({ snoozeUntil: 0 }); },

  // The level now, 0..1 (the switch and "not tonight" included).
  windNow() {
    const st = this.windState();
    if (!st.on) return 0;
    const now = this._clock();
    if (st.snoozeUntil && now.getTime() < st.snoozeUntil) return 0;
    const cur = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
    return this.windLevel(cur, this.parseHM(st.start), this.parseHM(st.end), st.rampMin);
  },

  // --- applying -------------------------------------------------------------

  _windVeil() {
    let el = document.getElementById(this.WIND_VEIL_ID);
    if (el) return el;
    el = document.createElement('div');
    el.id = this.WIND_VEIL_ID;
    el.setAttribute('aria-hidden', 'true');
    el.style.cssText = 'position:fixed;inset:0;z-index:2147483646;pointer-events:none;opacity:0;background:transparent;';
    document.body.appendChild(el);
    return el;
  },

  _windForced() {
    const f = this.windState().forced;
    if (!f || typeof f !== 'object' || !this._valid(f.dark) || !this._valid(f.restore)) return null;
    return f;
  },

  // Every tick and on any change. instant: no fade (start-up, a setting).
  windTick({ instant = false } = {}) {
    if (typeof document === 'undefined' || !document.body) return 0;
    const st = this.windState();
    const level = this.windNow();
    const veil = this._windVeil();
    const a = this.windAlphas(level, st.intensity);
    // Two flat layers on one element: the shade, then the warm tint.
    veil.style.background = `linear-gradient(rgba(0,0,0,${a.dim}),rgba(0,0,0,${a.dim})),linear-gradient(rgba(${this.WIND_WARM_RGB},${a.warm}),rgba(${this.WIND_WARM_RGB},${a.warm}))`;
    veil.style.opacity = level > 0 ? '1' : '0';
    // Ticks are TICK_MS apart: a fade as long keeps a long ramp smooth.
    veil.style.transition = instant ? 'none' : `background ${Math.round(this.TICK_MS / 1000)}s linear, opacity 1s linear`;
    veil.dataset.level = String(+level.toFixed(3));
    if (typeof AttentionState !== 'undefined') AttentionState.changed();
    this._windTheme(st, level);
    this.renderWind();
    return level;
  },

  // Wear the dark variant during the wind-down, and give the theme back
  // exactly at its end (or when snoozed or switched off). A theme picked by
  // hand meanwhile is left alone (_onThemeChanged drops `forced`).
  _windTheme(st, level) {
    if (typeof ThemeManager === 'undefined') return;
    if (typeof ThemeStudio !== 'undefined' && ThemeStudio.isEditing()) return;
    const f = this._windForced();
    if (st.forced && !f) {
      this._windSave({ ...st, forced: null });
      return this._windTheme(this.windState(), level);
    }
    const cur = ThemeManager.currentTheme;
    const want = st.on && st.forceDark && level > 0;
    if (want && !f) {
      const meta = this._themes().find(t => t.id === cur);
      if (!meta || !this.isLightTheme(meta)) return; // already dark
      const a = this.state();
      const dark = this._valid(a.dark) ? a.dark : this.defaultSlots(cur, this._themes()).dark;
      if (!this._valid(dark)) return;
      this._windSave({ ...st, forced: { restore: cur, dark } });
      // persist:false keeps the real theme in storage; a crash comes back to it.
      ThemeManager.applyTheme(dark, { auto: true, persist: false });
      return;
    }
    if (!want && f) {
      this._windSave({ ...st, forced: null });
      // Only when the forced theme is still the one worn.
      if (cur === f.dark) ThemeManager.applyTheme(f.restore, { auto: true });
      this.evaluate({ force: true });
      return;
    }
    // After a restart the saved theme is back already: put the dark one on again.
    if (want && f && cur !== f.dark) {
      if (cur === f.restore) ThemeManager.applyTheme(f.dark, { auto: true, persist: false });
      else this._windSave({ ...st, forced: null });
    }
  },

  // --- Settings › Appearance ------------------------------------------------

  wireWind() {
    const on = this._el('setting-wind-down');
    if (!on || on.dataset.wired) return;
    on.dataset.wired = '1';
    const q = id => this._el(id);
    on.addEventListener('change', () => {
      this.windSet({ on: on.checked, snoozeUntil: 0 });
      window.showToast?.(on.checked ? 'Wind-down is on' : 'Wind-down is off', 'info', 2000);
    });
    const times = () => {
      const s = q('setting-wind-down-start'), e = q('setting-wind-down-end');
      const a = this.parseHM(s.value), b = this.parseHM(e.value);
      if (a == null || b == null) return;
      if (a === b) { window.showToast?.('The wind-down needs a start and an end that differ', 'error'); this.renderWind(); return; }
      this.windSet({ start: s.value, end: e.value, snoozeUntil: 0 });
    };
    q('setting-wind-down-start').addEventListener('change', times);
    q('setting-wind-down-end').addEventListener('change', times);
    q('setting-wind-down-ramp').addEventListener('change', ev => this.windSet({ rampMin: Number(ev.target.value) }));
    q('setting-wind-down-intensity').addEventListener('input', ev => this.windSet({ intensity: Number(ev.target.value) }));
    q('setting-wind-down-dark').addEventListener('change', ev => this.windSet({ forceDark: ev.target.checked }));
    q('wind-down-snooze').addEventListener('click', () => {
      if (this.windState().snoozeUntil > this._clock().getTime()) this.windResume(); else this.windSnooze();
    });
    this.renderWind();
  },

  renderWind() {
    const on = this._el('setting-wind-down');
    if (!on) return;
    const st = this.windState();
    on.checked = st.on;
    const details = this._el('wind-down-details');
    if (details) details.style.display = st.on ? '' : 'none';
    const set = (id, v) => { const e = this._el(id); if (e && e.value !== String(v)) e.value = String(v); };
    set('setting-wind-down-start', st.start);
    set('setting-wind-down-end', st.end);
    set('setting-wind-down-ramp', st.rampMin);
    set('setting-wind-down-intensity', st.intensity);
    const dark = this._el('setting-wind-down-dark');
    if (dark) dark.checked = st.forceDark;
    const snoozed = st.snoozeUntil > this._clock().getTime();
    const btn = this._el('wind-down-snooze');
    if (btn) btn.textContent = snoozed ? 'Turn tonight back on' : 'Not tonight';
    const status = this._el('wind-down-status');
    if (status) {
      const lvl = this.windNow();
      status.textContent = !st.on ? ''
        : snoozed ? 'Skipped for tonight. It comes back tomorrow.'
        : lvl > 0 ? `Winding down now (${Math.round(lvl * 100)}%). It ends at ${st.end}.`
        : `Starts at ${st.start}, fading in over ${st.rampMin} minutes.`;
    }
  },
});

if (typeof window !== 'undefined') window.ThemeAuto = ThemeAuto;
if (typeof module !== 'undefined' && module.exports) module.exports = { ThemeAuto };
