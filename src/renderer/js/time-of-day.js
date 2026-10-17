// === Which New Tab fits the time of day =====================================
//
// A morning wants the brief, working hours want the project you are on, the
// evening is for reading, and late at night the page should wind down. This
// file decides which of those four fits NOW, from times the user sets, and
// says so; it does not draw the start page. Whoever draws it (the New Tab
// page) reads the choice two ways, and neither needs this file to know about
// the page:
//
//   VexTimeOfDay.pick(now, prefs)   a pure function: 'brief' | 'project' |
//                                   'reading' | 'winddown'
//   VexTimeOfDay.snapshot()         { enabled, profile, label, reason, since,
//                                     next: { profile, at }, weekend, at }
//   window event 'vex:newtab-profile', detail = a snapshot, fired when the
//                                   profile changes (checked every minute and
//                                   whenever the settings change)
//
// Switched off by default: it changes what the New Tab page shows.
const VexTimeOfDay = {
  KEY: 'vex.timeOfDay',
  PROFILES: ['brief', 'project', 'reading', 'winddown'],
  LABELS: { brief: 'Morning brief', project: 'Project', reading: 'Reading', winddown: 'Wind-down' },
  DEFAULTS: {
    enabled: false,
    // When each one starts. The one that started last before now is the one;
    // the first of the day carries over from the last of yesterday.
    starts: { brief: '05:00', project: '09:00', reading: '17:00', winddown: '21:00' },
    // What the project hours become on a Saturday or Sunday.
    weekendProject: 'reading',
    // Always this one, whatever the time ('' = follow the clock).
    pinned: '',
  },
  EVENT: 'vex:newtab-profile',
  TICK_MS: 60000,

  _minutes(hhmm) {
    const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(hhmm || '').trim());
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  },
  _hhmm(minutes) {
    const m = ((minutes % 1440) + 1440) % 1440;
    return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  },

  cleanPrefs(p) {
    const d = this.DEFAULTS;
    const o = (p && typeof p === 'object') ? p : {};
    const starts = {};
    for (const k of this.PROFILES) {
      const m = this._minutes(o.starts && o.starts[k]);
      starts[k] = m == null ? d.starts[k] : this._hhmm(m);
    }
    return {
      enabled: o.enabled === true,
      starts,
      weekendProject: this.PROFILES.includes(o.weekendProject) ? o.weekendProject : d.weekendProject,
      pinned: this.PROFILES.includes(o.pinned) ? o.pinned : '',
    };
  },

  // The profile that fits `now`. Pure: it reads nothing but its arguments.
  // `now` is a Date or a timestamp, in the local time of whoever made it.
  pick(now, prefs) {
    return this._resolve(now, prefs).profile;
  },

  _resolve(now, prefs) {
    const p = this.cleanPrefs(prefs);
    const d = now instanceof Date ? now : new Date(now);
    if (Number.isNaN(d.getTime())) throw new Error('VexTimeOfDay.pick needs a date or a timestamp');
    const weekend = d.getDay() === 0 || d.getDay() === 6;
    const minutes = d.getHours() * 60 + d.getMinutes();
    // The day's starts in order; ties keep the order of PROFILES.
    const order = this.PROFILES.map((k, i) => ({ k, at: this._minutes(p.starts[k]), i }))
      .sort((a, b) => a.at - b.at || a.i - b.i);
    let cur = order[order.length - 1];                       // before the first start: yesterday's last
    for (const o of order) if (o.at <= minutes) cur = o;
    const idx = order.indexOf(cur);
    const next = order[(idx + 1) % order.length];
    let profile = cur.k;
    let reason = 'clock';
    if (p.pinned) { profile = p.pinned; reason = 'pinned'; }
    else if (weekend && profile === 'project') { profile = p.weekendProject; reason = 'weekend'; }
    return { profile, reason, weekend, since: this._hhmm(cur.at), next: { profile: next.k, at: this._hhmm(next.at) }, prefs: p };
  },

  // ---- saved choices ----
  prefs() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(this.KEY) || 'null'); } catch { raw = null; }
    return this.cleanPrefs(raw);
  },
  savePrefs(patch) {
    const cur = this.prefs();
    const next = this.cleanPrefs({ ...cur, ...patch, starts: { ...cur.starts, ...((patch && patch.starts) || {}) } });
    localStorage.setItem(this.KEY, JSON.stringify(next));
    this.tick(true);
    return next;
  },

  // What the New Tab page should read. Always answers; `enabled` says whether
  // the user asked for the clock to choose.
  snapshot(now) {
    const when = now == null ? new Date() : (now instanceof Date ? now : new Date(now));
    const r = this._resolve(when, this.prefs());
    return {
      enabled: r.prefs.enabled,
      profile: r.profile,
      label: this.LABELS[r.profile],
      reason: r.reason,
      weekend: r.weekend,
      since: r.since,
      next: r.next,
      at: when.toISOString(),
    };
  },

  // ---- the event ----
  _last: null,
  tick(force) {
    if (typeof window === 'undefined') return null;
    const s = this.snapshot();
    // What changed is what the page cares about: which profile, and whether
    // the clock is choosing at all.
    const sig = s.enabled ? s.profile : 'off';
    if (!force && sig === this._last) return null;
    this._last = sig;
    window.dispatchEvent(new CustomEvent('vex:newtab-profile', { detail: s }));   // literal, so the static contract test sees the sender (EVENT is the same name)
    return s;
  },
  start() {
    if (this._timer) return;
    this.tick(true);
    this._timer = VexJobs.every('Time of day', this.TICK_MS, () => this.tick(false));
  },
  stop() { if (this._timer) this._timer.stop(); this._timer = null; this._last = null; },

  // ---- Settings and the command bar ----
  buildSettings(body) {
    const G = window.VexSettingsGroup;
    const p = this.prefs();
    const save = (patch) => { try { this.savePrefs(patch); G.refresh('settings-timeofday'); } catch (err) { window.showToast?.(err.message, 'error'); } };
    body.append(G.toggle('Choose the New Tab by the time of day', p.enabled, (on) => save({ enabled: on })));
    for (const k of this.PROFILES) {
      const t = document.createElement('input');
      t.type = 'time';
      t.value = p.starts[k];
      t.className = 'set-input';
      t.style.maxWidth = '130px';
      t.addEventListener('change', () => { if (t.value) save({ starts: { [k]: t.value } }); });
      body.append(G.field(this.LABELS[k] + ' starts', t));
    }
    const wk = document.createElement('select');
    wk.className = 'set-input';
    for (const k of this.PROFILES.filter(x => x !== 'project')) {
      const o = document.createElement('option');
      o.value = k; o.textContent = this.LABELS[k]; o.selected = k === p.weekendProject;
      wk.append(o);
    }
    wk.addEventListener('change', () => save({ weekendProject: wk.value }));
    body.append(G.field('At the weekend, project hours show', wk));
    const pin = document.createElement('select');
    pin.className = 'set-input';
    for (const [v, l] of [['', 'Follow the clock']].concat(this.PROFILES.map(k => [k, this.LABELS[k]]))) {
      const o = document.createElement('option');
      o.value = v; o.textContent = l; o.selected = v === p.pinned;
      pin.append(o);
    }
    pin.addEventListener('change', () => save({ pinned: pin.value }));
    body.append(G.field('Always show', pin));
    const s = this.snapshot();
    body.append(G.note('Right now it fits: ' + s.label + (s.reason === 'pinned' ? ' (pinned)' : s.reason === 'weekend' ? ' (weekend)' : '') + '. Next: ' + this.LABELS[s.next.profile] + ' at ' + s.next.at + '.'
      + (p.enabled ? '' : ' It is off, so the New Tab page keeps its own layout.')));
  },

  mount() {
    if (window.VexSettingsGroup) {
      window.VexSettingsGroup.add({ id: 'settings-timeofday', title: 'New tab by time of day', info: 'Morning brief, project, reading or wind-down — chosen by the clock, from the times you set.', build: (body) => this.buildSettings(body) });
    }
    if (typeof CommandBar !== 'undefined' && CommandBar.commands && !CommandBar.commands.some(c => c.id === 'newtab-time')) {
      CommandBar.commands.push({ id: 'newtab-time', label: 'New Tab by Time of Day', hint: 'Which New Tab layout fits the hour: brief, project, reading or wind-down — the times are yours to set', icon: 'clock',
        action: () => { if (typeof SettingsUI !== 'undefined' && SettingsUI.openSection) SettingsUI.openSection('settings-timeofday'); } });
    }
    this.start();
  },
};

if (typeof window !== 'undefined') {
  window.VexTimeOfDay = VexTimeOfDay;
  if (typeof document !== 'undefined' && document.getElementById('command-overlay')) VexTimeOfDay.mount();
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexTimeOfDay };
