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
// A theme picked by hand while this is on becomes the slot for the mode Vex is
// in right now (picked at night = the dark theme), so what you pick is what you
// see. The browser looks that come in a light and a dark version (Firefox,
// Chrome, Fluent) switch with it, so their chrome changes too.
//
// Stored as one JSON value under 'vex.themeAuto' (synced, and cleared by Reset).

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
    const partner = { 'firefox-light': 'firefox-dark', 'firefox-dark': 'firefox-light', 'mica-light': 'mica-dark', 'mica-dark': 'mica-light' };
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
    const id = dark ? st.dark : st.light;
    return this._valid(id) ? id : null;
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
    const st = this.state();
    if (st.mode === 'off') { this._lastDark = null; this.renderSettings(); return null; }
    const dark = this.resolveDark(st, this._ctx());
    if (dark == null) { this.renderSettings(); return null; }
    const changed = dark !== this._lastDark;
    this._lastDark = dark;
    const want = dark ? st.dark : st.light;
    if (this._valid(want) && typeof ThemeManager !== 'undefined' && ThemeManager.currentTheme !== want) {
      ThemeManager.applyTheme(want, { auto: true });
    }
    if (changed || force) this._applyLook(dark);
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

  // A theme picked by hand while this is on fills the slot for now.
  _onThemeChanged(e) {
    const d = e && e.detail;
    if (!d || !d.userChoice || d.auto) return;
    const st = this.state();
    if (st.mode === 'off') return;
    const dark = this._lastDark != null ? this._lastDark : this.resolveDark(st, this._ctx());
    if (dark == null) return;
    const slot = dark ? 'dark' : 'light';
    const other = dark ? st.light : st.dark;
    if (st[slot] !== d.theme) { this.save({ ...st, [slot]: d.theme }); this.renderSettings(); }
    window.showToast?.(`${this._label(d.theme)} is now your ${slot} theme — ${this._label(other)} comes back when it turns ${dark ? 'light' : 'dark'}`, 'info', 4500);
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
    if (dark == null) return 'Light and dark is on. Settings › Appearance sets your light and dark themes.';
    return `Light and dark is on and it is ${dark ? 'dark' : 'light'} now, so the theme you pick becomes your ${dark ? 'dark' : 'light'} theme. Your ${dark ? 'light' : 'dark'} theme stays ${this._label(dark ? st.light : st.dark)}.`;
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
    VexJobs.every('Light and dark', this.TICK_MS, () => this.evaluate());
    if (this._systemDark == null) {
      try { await this._readSystem(); }
      catch (err) { console.error('[ThemeAuto] Windows light/dark mode:', err.message); }
    }
    this.wireSettings();
    this.evaluate({ force: true });
  },

  // Stops listening (tests load a fresh copy each time).
  stop() {
    if (this._abort) this._abort.abort();
    if (typeof this._unsub === 'function') this._unsub();
    if (typeof VexJobs !== 'undefined') VexJobs.stop?.('Light and dark');
    this._started = false;
  },

  // Turn it on, off, or change it, from Settings.
  set(patch) {
    const before = this.state();
    const next = { ...before, ...patch };
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
    const fill = (sel) => {
      const themes = this._themes().filter(t => !t.upload);
      const group = (label, list) => {
        const g = document.createElement('optgroup');
        g.label = label;
        for (const t of list) { const o = document.createElement('option'); o.value = t.id; o.textContent = t.label; g.appendChild(o); }
        sel.appendChild(g);
      };
      sel.innerHTML = '';
      group('Light themes', themes.filter(t => this.isLightTheme(t)));
      group('Dark themes', themes.filter(t => !this.isLightTheme(t)));
    };
    fill(light); fill(dark);
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
    const now = `Now ${dark ? 'dark' : 'light'}: ${this._label(dark ? st.dark : st.light)}.`;
    const pickNote = ` A theme you pick by hand becomes your ${dark ? 'dark' : 'light'} theme.`;
    if (st.mode === 'system') return `${now} Windows is in ${dark ? 'dark' : 'light'} mode.` + pickNote;
    const next = this.nextChange(st, ctx.now, coords);
    const at = next ? ` until ${this.formatHM(next.getHours() * 60 + next.getMinutes())}` : '';
    const where = st.mode === 'sun' ? ` Sun times for ${coords.label}.` : '';
    return `${now.slice(0, -1)}${at}.${where}` + pickNote;
  },
};

if (typeof window !== 'undefined') window.ThemeAuto = ThemeAuto;
if (typeof module !== 'undefined' && module.exports) module.exports = { ThemeAuto };
