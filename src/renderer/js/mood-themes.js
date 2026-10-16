// === Mood themes ============================================================
//
// Two small, optional ways for the look to follow the day. Neither is a theme
// engine of its own: both put a theme on through ThemeManager.applyTheme
// (flagged `auto`, so a switch is not mistaken for a hand pick) and use
// ThemeAuto (js/theme-auto.js) for what it already knows: whether a theme is
// light, where the sun is for the saved location, how a browser look follows
// light and dark. The New Tab page is recoloured by ThemeManager itself, as
// for any theme change.
//
//   timeOfDay  a theme for the morning, the day, the evening and the night.
//              The hours are yours, or follow the sun when a location was
//              already given to Vex (Settings > Location or the weather city).
//   season     "wear this for a week": a seasonal theme, then the theme you
//              had comes back by itself. Started by you, never automatic.
//
// Weather is NOT used. The only thing Vex has that is weather-shaped is the
// New Tab page's own opt-in weather card, in another document; a second
// request for it from here would ask the network again, so this does not.
//
// While Light and dark (ThemeAuto) is on, this stays out of the way and says
// so: two features deciding the same theme would fight. A theme you pick by
// hand wins until the next change of band, or ends the seasonal week.
//
// Stored under 'vex.moodTheme' (this device). Off until switched on in
// Settings > Little surprises (js/delights.js).
const VexMoodTheme = {
  KEY: 'vex.moodTheme',
  BANDS: ['morning', 'day', 'evening', 'night'],
  BAND_LABEL: { morning: 'Morning', day: 'Daytime', evening: 'Evening', night: 'Night' },
  DEFAULT_STARTS: { morning: '06:00', day: '10:00', evening: '17:00', night: '21:00' },
  DEFAULT_THEMES: { morning: 'sakura', day: 'oxford', evening: 'sunset', night: 'midnight' },
  SEASONS: { spring: 'sakura', summer: 'honey', autumn: 'mocha', winter: 'arctic' },
  SEASON_DAYS: 7,
  TICK_MS: 60000,
  DAY: 24 * 3600 * 1000,

  _clock: () => new Date(),
  _started: false,

  // ---- pure helpers ---------------------------------------------------------
  _toMin(hm) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hm || ''));
    if (!m) return null;
    const h = Number(m[1]), mi = Number(m[2]);
    return h > 23 || mi > 59 ? null : h * 60 + mi;
  },

  // starts: { morning, day, evening, night } as minutes. The band whose start
  // is the latest at or before `minutes`; before the first start of the day it
  // is whichever band began last (the night, wrapping midnight).
  bandAt(minutes, starts) {
    const list = this.BANDS.map(b => ({ b, at: starts[b] })).sort((x, y) => x.at - y.at);
    let cur = list[list.length - 1].b;
    for (const e of list) if (minutes >= e.at) cur = e.b;
    return cur;
  },

  // Band starts that follow the sun: morning at sunrise, the day three hours
  // later, evening an hour and a half before sunset, night an hour after it.
  sunStarts(date, coords, auto) {
    const t = auto.sunTimes(date, coords.lat, coords.lon);
    if (t.polar) return null;
    const mins = (d) => d.getHours() * 60 + d.getMinutes();
    const rise = mins(t.sunrise), set = mins(t.sunset);
    return { morning: rise, day: (rise + 180) % 1440, evening: ((set - 90) + 1440) % 1440, night: (set + 60) % 1440 };
  },

  seasonFor(date, southern = false) {
    const m = date.getMonth();
    const north = m === 11 || m <= 1 ? 'winter' : m <= 4 ? 'spring' : m <= 7 ? 'summer' : 'autumn';
    if (!southern) return north;
    return { winter: 'summer', spring: 'autumn', summer: 'winter', autumn: 'spring' }[north];
  },

  // ---- state ----------------------------------------------------------------
  state() {
    const raw = localStorage.getItem(this.KEY);
    const base = { mode: 'off', themes: { ...this.DEFAULT_THEMES }, starts: { ...this.DEFAULT_STARTS }, sun: false, season: null, held: null };
    if (raw == null) return base;
    let s;
    try { s = JSON.parse(raw); } catch (err) { throw new Error('The mood theme settings could not be read', { cause: err }); }
    if (!s || typeof s !== 'object') return base;
    return {
      mode: s.mode === 'timeOfDay' ? 'timeOfDay' : 'off',
      themes: { ...base.themes, ...(s.themes && typeof s.themes === 'object' ? s.themes : {}) },
      starts: { ...base.starts, ...(s.starts && typeof s.starts === 'object' ? s.starts : {}) },
      sun: !!s.sun,
      season: s.season && typeof s.season === 'object' && typeof s.season.theme === 'string' ? s.season : null,
      held: s.held && typeof s.held === 'object' ? s.held : null,
    };
  },
  save(next) { localStorage.setItem(this.KEY, JSON.stringify(next)); },
  isOn() { const s = this.state(); return s.mode !== 'off' || !!(s.season && s.season.until > this._clock().getTime()); },

  // ---- plumbing to what exists ----------------------------------------------
  _auto() { return typeof ThemeAuto !== 'undefined' ? ThemeAuto : null; },
  _tm() { return typeof ThemeManager !== 'undefined' ? ThemeManager : null; },
  _valid(id) { const tm = this._tm(); return !!tm && Array.isArray(tm.availableThemes) && tm.availableThemes.includes(id); },
  _blockedByLightDark() { const a = this._auto(); return !!a && typeof a.isOn === 'function' && a.isOn(); },
  _quiet() {
    if (typeof GameSession !== 'undefined' && !!GameSession.active) return true;
    // The master level (js/vex-playfulness.js): no automatic theme change in Simple mode, Focus, a meeting or while Playfulness is Off.
    return typeof VexPlayfulness !== 'undefined' && !VexPlayfulness.allowed('delight');
  },
  _southern() { const a = this._auto(); const c = a && typeof a.coords === 'function' ? a.coords() : null; return !!c && c.lat < 0; },

  // The band right now, honouring "follow the sun" when a location exists.
  currentBand(now = this._clock()) {
    const st = this.state();
    const a = this._auto();
    let starts = null;
    if (st.sun && a) {
      const c = a.coords();
      if (c) starts = this.sunStarts(now, c, a);
    }
    if (!starts) {
      starts = {};
      for (const b of this.BANDS) {
        const m = this._toMin(st.starts[b]);
        starts[b] = m == null ? this._toMin(this.DEFAULT_STARTS[b]) : m;
      }
    }
    return this.bandAt(now.getHours() * 60 + now.getMinutes(), starts);
  },

  _wear(id) {
    const tm = this._tm();
    if (!this._valid(id)) throw new Error('Unknown theme: ' + id);
    if (tm.currentTheme !== id) tm.applyTheme(id, { auto: true });
    // The browser look's light/dark version and colours follow, as they do
    // for Light and dark.
    const a = this._auto();
    if (a) {
      const meta = typeof tm.THEMES !== 'undefined' ? tm.THEMES.find(t => t.id === id) : null;
      const dark = meta ? !a.isLightTheme(meta) : true;
      if (typeof a._applyLook === 'function') a._applyLook(dark);
      if (typeof a._applyColours === 'function') a._applyColours(id);
    }
  },

  // Put the right theme on now. Returns the theme worn, or null when nothing
  // applies (off, Light and dark is on, Game mode, theme editor open).
  evaluate() {
    if (this._quiet()) return null;
    if (typeof ThemeStudio !== 'undefined' && ThemeStudio.isEditing && ThemeStudio.isEditing()) return null;
    const st = this.state();
    const now = this._clock();
    if (st.season && st.season.until <= now.getTime()) { this.endSeason({ restore: true, now }); return this.evaluate(); }
    if (this._blockedByLightDark()) return null;
    if (st.season) { this._wear(st.season.theme); return st.season.theme; }
    if (st.mode !== 'timeOfDay') return null;
    const band = this.currentBand(now);
    if (st.held && st.held.band !== band) { st.held = null; this.save(st); }
    if (st.held) return null;
    const want = st.themes[band];
    if (!this._valid(want)) return null;
    this._wear(want);
    return want;
  },

  set(patch) {
    const next = { ...this.state(), ...patch };
    if (patch.mode === 'timeOfDay' || patch.themes || patch.starts || 'sun' in patch) next.held = null;
    // Turning it off needs no valid bands; anything else is checked.
    if (next.mode === 'timeOfDay') {
      for (const b of this.BANDS) {
        if (this._toMin(next.starts[b]) == null) throw new Error('The ' + b + ' start must be a time like 06:00');
        if (!this._valid(next.themes[b])) throw new Error('Pick a theme for the ' + b);
      }
    }
    this.save(next);
    const worn = this.evaluate();
    if (next.mode === 'timeOfDay') this._signal('mood-theme-on');
    return worn;
  },

  // ---- the seasonal week ----------------------------------------------------
  startSeason(themeId, now = this._clock()) {
    if (!this._valid(themeId)) throw new Error('Unknown theme: ' + themeId);
    if (this._blockedByLightDark()) throw new Error('Light and dark is on and decides the theme. Turn it off in Settings > Appearance to wear a seasonal look.');
    const st = this.state();
    const tm = this._tm();
    // An ongoing week keeps the theme it started from.
    const prev = st.season ? st.season.prev : tm.currentTheme;
    st.season = { theme: themeId, from: now.getTime(), until: now.getTime() + this.SEASON_DAYS * this.DAY, prev };
    st.held = null;
    this.save(st);
    this._wear(themeId);
    this._signal('seasonal-week-started');
    return st.season;
  },

  // restore: put the earlier theme back, but only if the seasonal one is still
  // what is worn (a hand pick since then is respected).
  endSeason({ restore = true } = {}) {
    const st = this.state();
    const s = st.season;
    if (!s) return false;
    st.season = null;
    this.save(st);
    const tm = this._tm();
    if (restore && tm && tm.currentTheme === s.theme && this._valid(s.prev) && !this._blockedByLightDark()) this._wear(s.prev);
    return true;
  },

  _signal(id) {
    try { document.dispatchEvent(new CustomEvent('vex:medal-signal', { detail: { id } })); } catch (err) { console.error('[MoodTheme] medal signal failed:', err.message); }
  },

  // A theme chosen by hand: it wins for now.
  _onThemeChanged(e) {
    const d = e && e.detail;
    if (!d || !d.userChoice || d.auto) return;
    const st = this.state();
    if (st.season && st.season.theme !== d.theme) { st.season = null; this.save(st); return; }
    if (st.mode === 'timeOfDay') { st.held = { band: this.currentBand() }; this.save(st); }
  },

  start() {
    if (this._started) return;
    this._started = true;
    this._abort = new AbortController();
    document.addEventListener('theme-changed', (e) => this._onThemeChanged(e), { signal: this._abort.signal });
    // Back from a game, catch up with the hour.
    document.addEventListener('vex:game-mode', (e) => { if (e && e.detail && e.detail.active === false) this._safeEvaluate(); }, { signal: this._abort.signal });
    if (typeof VexJobs !== 'undefined') VexJobs.every('Mood theme', this.TICK_MS, () => this._safeEvaluate());
    this._safeEvaluate();
  },
  stop() {
    if (this._abort) this._abort.abort();
    if (typeof VexJobs !== 'undefined' && VexJobs.stop) VexJobs.stop('Mood theme');
    this._started = false;
  },
  _safeEvaluate() {
    try { this.evaluate(); } catch (err) { window.VexProblems?.note('Mood theme', 'Could not apply the mood theme', err); console.error('[MoodTheme]', err); }
  },

  // ---- Settings -------------------------------------------------------------
  renderSettings(container) {
    if (!container) return;
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const wrap = el('div', 'vex-delight-mood');
    wrap.setAttribute('data-mood', '');
    const st = this.state();
    const tm = this._tm();
    const themes = (tm && tm.THEMES) || [];
    const a = this._auto();
    if (this._blockedByLightDark()) wrap.appendChild(el('div', 'setting-info', 'Light and dark is on in Appearance and decides the theme, so mood themes wait. Turn it off there to use them.'));
    const select = (value, onChange, label) => {
      const s = document.createElement('select');
      s.className = 'set-input';
      s.setAttribute('aria-label', label);
      for (const t of themes) { const o = document.createElement('option'); o.value = t.id; o.textContent = t.label; if (t.id === value) o.selected = true; s.appendChild(o); }
      s.addEventListener('change', () => onChange(s.value));
      return s;
    };
    const guard = (fn) => { try { fn(); } catch (err) { window.showToast?.(err.message, 'error'); } this.renderSettings(container); };

    const tod = el('label', 'setting-toggle-row');
    tod.appendChild(el('span', '', 'A theme for each part of the day'));
    const lab = el('span', 'toggle');
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = st.mode === 'timeOfDay'; cb.setAttribute('aria-label', 'A theme for each part of the day');
    cb.addEventListener('change', () => guard(() => this.set({ mode: cb.checked ? 'timeOfDay' : 'off' })));
    lab.append(cb, el('span', 'toggle-slider'));
    tod.appendChild(lab);
    wrap.appendChild(tod);
    if (st.mode === 'timeOfDay') {
      for (const b of this.BANDS) {
        const row = el('div', 'setting-toggle-row');
        row.appendChild(el('span', '', this.BAND_LABEL[b] + (st.sun ? '' : ' from')));
        const right = el('span', 'vex-delight-inline');
        if (!st.sun) {
          const t = document.createElement('input'); t.type = 'time'; t.className = 'set-input'; t.value = st.starts[b]; t.setAttribute('aria-label', this.BAND_LABEL[b] + ' starts');
          t.addEventListener('change', () => guard(() => this.set({ starts: { ...st.starts, [b]: t.value } })));
          right.appendChild(t);
        }
        right.appendChild(select(st.themes[b], (v) => guard(() => this.set({ themes: { ...st.themes, [b]: v } })), this.BAND_LABEL[b] + ' theme'));
        row.appendChild(right);
        wrap.appendChild(row);
      }
      const coords = a && typeof a.coords === 'function' ? a.coords() : null;
      const sunRow = el('label', 'setting-toggle-row');
      sunRow.appendChild(el('span', '', coords ? 'Follow the sun for ' + coords.label : 'Follow the sun (needs a location in Settings > Location)'));
      const sl = el('span', 'toggle');
      const sc = document.createElement('input'); sc.type = 'checkbox'; sc.checked = st.sun && !!coords; sc.disabled = !coords; sc.setAttribute('aria-label', 'Follow the sun');
      sc.addEventListener('change', () => guard(() => this.set({ sun: sc.checked })));
      sl.append(sc, el('span', 'toggle-slider'));
      sunRow.appendChild(sl);
      wrap.appendChild(sunRow);
      wrap.appendChild(el('div', 'setting-info', 'Now: ' + this.BAND_LABEL[this.currentBand()] + '. A theme you pick by hand stays until the next part of the day.'));
    }

    // The seasonal week.
    const now = this._clock();
    const season = st.season && st.season.until > now.getTime() ? st.season : null;
    const seasonName = this.seasonFor(now, this._southern());
    const sRow = el('div', 'setting-toggle-row');
    if (season) {
      sRow.appendChild(el('span', '', 'Seasonal look until ' + new Date(season.until).toLocaleDateString()));
      const end = el('button', 'btn-secondary', 'Put my theme back');
      end.type = 'button';
      end.addEventListener('click', () => guard(() => this.endSeason({ restore: true })));
      sRow.appendChild(end);
    } else {
      const label = this.SEASONS[seasonName] ? (themes.find(t => t.id === this.SEASONS[seasonName]) || { label: this.SEASONS[seasonName] }).label : '';
      sRow.appendChild(el('span', '', 'A ' + seasonName + ' look for a week (' + label + ')'));
      const go = el('button', 'btn-secondary', 'Wear it for 7 days');
      go.type = 'button';
      go.addEventListener('click', () => guard(() => this.startSeason(this.SEASONS[seasonName])));
      sRow.appendChild(go);
    }
    wrap.appendChild(sRow);
    wrap.appendChild(el('div', 'setting-info', 'The week ends by itself and your theme comes back. Weather is not used.'));

    container.querySelector('[data-mood]')?.remove();
    container.appendChild(wrap);
  },
};

if (typeof window !== 'undefined') window.VexMoodTheme = VexMoodTheme;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexMoodTheme };
