// === Clock ==================================================================
//
// Alarms, timers, a stopwatch and a world clock, in one sidebar panel.
//
// Alarms are reminders (src/main/reminders.js) with kind 'alarm', a sound and
// a set of weekdays, so they get everything reminders have: the main-process
// timer, the Windows wake-up when Vex is closed, the in-app card. What this
// module adds is the ringing — an audible alarm that keeps sounding until
// dismissed, with Snooze — and the ticking things that only make sense while
// Vex is open: timers and the stopwatch. Timers also register a main-process
// reminder at their end, so a timer survives an interface reload and still
// produces a desktop toast.
//
// The world clock uses the time-zone database the OS already has, through
// Intl, so there is nothing to maintain. The city table maps names people
// type to IANA zones.
const VexClock = {
  KEY_TIMERS: 'vex.clock.timers',
  KEY_CITIES: 'vex.clock.cities',
  KEY_STOPWATCH: 'vex.clock.stopwatch',
  SNOOZE_MIN: 9,

  // City → IANA zone. Enough for the cities people actually name; anything
  // else can be typed as an IANA zone directly ("Asia/Tokyo").
  CITIES: [
    ['Istanbul', 'Europe/Istanbul'], ['Ankara', 'Europe/Istanbul'], ['London', 'Europe/London'], ['Dublin', 'Europe/Dublin'],
    ['Paris', 'Europe/Paris'], ['Berlin', 'Europe/Berlin'], ['Madrid', 'Europe/Madrid'], ['Rome', 'Europe/Rome'],
    ['Amsterdam', 'Europe/Amsterdam'], ['Brussels', 'Europe/Brussels'], ['Zurich', 'Europe/Zurich'], ['Vienna', 'Europe/Vienna'],
    ['Stockholm', 'Europe/Stockholm'], ['Oslo', 'Europe/Oslo'], ['Copenhagen', 'Europe/Copenhagen'], ['Helsinki', 'Europe/Helsinki'],
    ['Warsaw', 'Europe/Warsaw'], ['Prague', 'Europe/Prague'], ['Athens', 'Europe/Athens'], ['Kyiv', 'Europe/Kyiv'],
    ['Moscow', 'Europe/Moscow'], ['Lisbon', 'Europe/Lisbon'], ['Cairo', 'Africa/Cairo'], ['Lagos', 'Africa/Lagos'],
    ['Nairobi', 'Africa/Nairobi'], ['Johannesburg', 'Africa/Johannesburg'], ['Casablanca', 'Africa/Casablanca'],
    ['Dubai', 'Asia/Dubai'], ['Riyadh', 'Asia/Riyadh'], ['Doha', 'Asia/Qatar'], ['Tehran', 'Asia/Tehran'], ['Baghdad', 'Asia/Baghdad'],
    ['Tel Aviv', 'Asia/Jerusalem'], ['Jerusalem', 'Asia/Jerusalem'], ['Karachi', 'Asia/Karachi'], ['Mumbai', 'Asia/Kolkata'],
    ['Delhi', 'Asia/Kolkata'], ['Bangalore', 'Asia/Kolkata'], ['Kathmandu', 'Asia/Kathmandu'], ['Dhaka', 'Asia/Dhaka'],
    ['Bangkok', 'Asia/Bangkok'], ['Jakarta', 'Asia/Jakarta'], ['Singapore', 'Asia/Singapore'], ['Kuala Lumpur', 'Asia/Kuala_Lumpur'],
    ['Hong Kong', 'Asia/Hong_Kong'], ['Shanghai', 'Asia/Shanghai'], ['Beijing', 'Asia/Shanghai'], ['Taipei', 'Asia/Taipei'],
    ['Seoul', 'Asia/Seoul'], ['Tokyo', 'Asia/Tokyo'], ['Manila', 'Asia/Manila'], ['Perth', 'Australia/Perth'],
    ['Sydney', 'Australia/Sydney'], ['Melbourne', 'Australia/Melbourne'], ['Brisbane', 'Australia/Brisbane'], ['Auckland', 'Pacific/Auckland'],
    ['Honolulu', 'Pacific/Honolulu'], ['Anchorage', 'America/Anchorage'], ['Los Angeles', 'America/Los_Angeles'], ['San Francisco', 'America/Los_Angeles'],
    ['Seattle', 'America/Los_Angeles'], ['Vancouver', 'America/Vancouver'], ['Denver', 'America/Denver'], ['Phoenix', 'America/Phoenix'],
    ['Chicago', 'America/Chicago'], ['Dallas', 'America/Chicago'], ['Houston', 'America/Chicago'], ['Mexico City', 'America/Mexico_City'],
    ['New York', 'America/New_York'], ['Toronto', 'America/Toronto'], ['Miami', 'America/New_York'], ['Boston', 'America/New_York'],
    ['Washington', 'America/New_York'], ['Bogota', 'America/Bogota'], ['Lima', 'America/Lima'], ['Santiago', 'America/Santiago'],
    ['Buenos Aires', 'America/Argentina/Buenos_Aires'], ['Sao Paulo', 'America/Sao_Paulo'], ['Rio de Janeiro', 'America/Sao_Paulo'],
    ['UTC', 'UTC'],
  ],

  // ------------------------------------------------------------- time zones
  zoneFor(text) {
    const s = String(text || '').trim();
    if (!s) return null;
    const hit = this.CITIES.find(([name]) => name.toLowerCase() === s.toLowerCase());
    if (hit) return { name: hit[0], zone: hit[1] };
    // An IANA zone typed directly.
    try { new Intl.DateTimeFormat('en', { timeZone: s }); return { name: s.split('/').pop().replace(/_/g, ' '), zone: s }; }
    catch { return null; }
  },

  // The parts of a moment as seen in a zone.
  partsIn(zone, ms) {
    const f = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hourCycle: 'h23', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const o = {};
    for (const p of f.formatToParts(new Date(ms))) if (p.type !== 'literal') o[p.type] = p.value;
    return { year: +o.year, month: +o.month, day: +o.day, hour: +o.hour, minute: +o.minute, second: +o.second, weekday: o.weekday };
  },

  // Offset of a zone from UTC at a moment, in minutes.
  offsetMinutes(zone, ms) {
    const p = this.partsIn(zone, ms);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
  },

  // The instant when a wall-clock time happens in a zone: "9am New York".
  // Two passes handle a clock change between the guess and the answer.
  instantIn(zone, { year, month, day, hour, minute }) {
    let guess = Date.UTC(year, month - 1, day, hour, minute, 0);
    for (let i = 0; i < 2; i++) guess = Date.UTC(year, month - 1, day, hour, minute, 0) - this.offsetMinutes(zone, guess) * 60000;
    return guess;
  },

  offsetLabel(zone, ms) {
    const mine = -new Date(ms).getTimezoneOffset();
    const diff = this.offsetMinutes(zone, ms) - mine;
    if (!diff) return 'same time as you';
    const h = Math.trunc(Math.abs(diff) / 60), m = Math.abs(diff) % 60;
    return (diff > 0 ? '+' : '−') + h + (m ? ':' + String(m).padStart(2, '0') : '') + 'h';
  },

  // ------------------------------------------------------------------ sound
  _audio: null,
  _ringTimer: null,
  _ringing: null,

  _beep(ctx, at, freq, dur) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.4, at + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(ctx.destination); o.start(at); o.stop(at + dur + 0.02);
  },

  startSound(kind) {
    this.stopSound();
    try { this._audio = this._audio || new (window.AudioContext || window.webkitAudioContext)(); }
    catch (err) { window.showToast?.('Could not play the alarm sound: ' + ((err && err.message) || ''), 'error'); return false; }
    const ctx = this._audio;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const pattern = () => {
      const t = ctx.currentTime;
      if (kind === 'timer') { this._beep(ctx, t, 880, 0.12); this._beep(ctx, t + 0.18, 880, 0.12); this._beep(ctx, t + 0.36, 1175, 0.2); }
      else { this._beep(ctx, t, 988, 0.09); this._beep(ctx, t + 0.14, 988, 0.09); this._beep(ctx, t + 0.28, 988, 0.09); this._beep(ctx, t + 0.42, 988, 0.09); }
    };
    pattern();
    this._ringTimer = setInterval(pattern, kind === 'timer' ? 1200 : 1000);
    return true;
  },

  stopSound() {
    if (this._ringTimer) { clearInterval(this._ringTimer); this._ringTimer = null; }
  },

  // The ringing card: what is ringing, Snooze, Dismiss. Keeps sounding until
  // one of them is pressed.
  ring({ id, title, message, kind, snoozable }) {
    document.getElementById('vex-ringing')?.remove();
    const esc = (s) => (window.escapeHtml ? window.escapeHtml(String(s == null ? '' : s)) : String(s == null ? '' : s));
    const icon = (n, sz) => (window.VexIcons && VexIcons.has(n)) ? VexIcons.svg(n, { size: sz || 15 }) : '';
    const wrap = document.createElement('div');
    wrap.id = 'vex-ringing';
    wrap.className = 'qr-overlay ck-ring-overlay';
    wrap.innerHTML = `
      <div class="qr-dialog ck-ring" role="alertdialog" aria-modal="true" aria-labelledby="ck-ring-title">
        <div class="ck-ring-icon">${icon(kind === 'timer' ? 'timer' : 'alarm', 34)}</div>
        <div class="qr-title" id="ck-ring-title">${esc(title)}</div>
        <div class="ck-ring-text"></div>
        <div class="ck-ring-clock" id="ck-ring-clock"></div>
        <div class="qr-actions ck-ring-actions">
          ${snoozable ? `<button class="qr-btn" id="ck-snooze">Snooze ${this.SNOOZE_MIN} min</button>` : ''}
          <button class="qr-btn qr-primary" id="ck-dismiss" autofocus>Dismiss</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    wrap.querySelector('.ck-ring-text').textContent = message || '';
    const clock = wrap.querySelector('#ck-ring-clock');
    const tick = () => { const d = new Date(); clock.textContent = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
    tick(); const clockTimer = setInterval(tick, 1000);
    this._ringing = { id, kind };
    const sounded = this.startSound(kind);
    if (!sounded) wrap.querySelector('.ck-ring-text').textContent += ' (sound unavailable)';
    const done = async (snooze) => {
      clearInterval(clockTimer);
      this.stopSound();
      this._ringing = null;
      wrap.remove();
      const b = window.vex && window.vex.reminders;
      if (id && b) {
        try { await b.ack(id); } catch (err) { window.showToast?.('Could not record the dismissal: ' + ((err && err.message) || ''), 'error'); }
        if (snooze) {
          try {
            await b.create(message || title, Date.now() + this.SNOOZE_MIN * 60000, { kind: kind === 'timer' ? 'timer' : 'alarm', sound: true, urgent: true });
            window.showToast?.(`Snoozed for ${this.SNOOZE_MIN} minutes`);
          } catch (err) { window.showToast?.('Could not snooze: ' + ((err && err.message) || ''), 'error'); }
        }
      }
    };
    wrap.querySelector('#ck-dismiss').addEventListener('click', () => done(false));
    wrap.querySelector('#ck-snooze')?.addEventListener('click', () => done(true));
    wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(false); } });
    setTimeout(() => wrap.querySelector('#ck-dismiss').focus(), 40);
    try { window.vex && window.vex.focusWindow && window.vex.focusWindow(); } catch { /* best effort */ }
    return wrap;
  },

  // -------------------------------------------------------------- lifecycle
  init() {
    const b = window.vex && window.vex.reminders;
    if (b && typeof b.onFired === 'function') {
      b.onFired((r) => {
        if (!r || !r.sound) return;
        this.ring({ id: r.id, title: r.kind === 'timer' ? 'Timer' : 'Alarm', message: r.message, kind: r.kind, snoozable: r.kind === 'alarm' });
      });
      // A Vex started by Windows for an alarm fires it before this code is
      // listening. Anything with a sound that fired in the last ten minutes
      // and was never dismissed rings now.
      Promise.resolve(b.list()).then(list => {
        const recent = list.filter(r => r.sound && !r.ackedAt && (r.firedAt || r.lastFiredAt) && Date.now() - (r.firedAt || r.lastFiredAt) < 10 * 60000)
          .sort((a, c) => (c.firedAt || c.lastFiredAt) - (a.firedAt || a.lastFiredAt));
        if (recent[0]) this.ring({ id: recent[0].id, title: recent[0].kind === 'timer' ? 'Timer' : 'Alarm', message: recent[0].message, kind: recent[0].kind, snoozable: recent[0].kind === 'alarm' });
      }).catch(() => {});
    }
    this._restoreTimers();
    this._pill();
    setInterval(() => this._tickTimers(), 500);
    return true;
  },

  // ----------------------------------------------------------------- timers
  //
  // A timer is { id, label, endAt, total, reminderId }. The end is also a
  // main-process reminder with a sound, so a reload cannot lose it and the
  // desktop toast still arrives.
  _timers: [],
  _loadTimers() { try { const a = JSON.parse(localStorage.getItem(this.KEY_TIMERS) || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } },
  _saveTimers() { try { localStorage.setItem(this.KEY_TIMERS, JSON.stringify(this._timers)); } catch (err) { window.showToast?.('Could not save the timer: ' + ((err && err.message) || ''), 'error'); } },
  _restoreTimers() { this._timers = this._loadTimers().filter(t => t.endAt > Date.now()); this._saveTimers(); },

  parseDuration(text) {
    const s = String(text || '').trim().toLowerCase();
    if (!s) throw new Error('Say how long — "25 min", "1h 30", "90s", or 10:00.');
    let ms = 0;
    const clock = s.match(/^(\d{1,3}):(\d{2})(?::(\d{2}))?$/);
    if (clock) {
      ms = clock[3] ? (+clock[1] * 3600 + +clock[2] * 60 + +clock[3]) * 1000 : (+clock[1] * 60 + +clock[2]) * 1000;
    } else {
      // A unit ends where the letters end — "1h30m" has no word boundary after the h.
      const re = /(\d+(?:\.\d+)?)\s*(hours|hour|hrs|hr|h|minutes|minute|mins|min|m|seconds|second|secs|sec|s)(?![a-z])/g;
      let m, any = false, last = '';
      while ((m = re.exec(s))) { any = true; const n = +m[1]; last = m[2][0]; ms += last === 'h' ? n * 3600000 : last === 'm' ? n * 60000 : n * 1000; }
      // "1h 30" — a trailing bare number is the next unit down from the last one named.
      const rest = s.replace(re, '').replace(/\band\b/g, '').trim();
      if (any && /^\d+(\.\d+)?$/.test(rest)) ms += +rest * (last === 'h' ? 60000 : last === 'm' ? 1000 : 0);
      else if (any && rest) throw new Error(`Could not read "${rest}" in "${text}".`);
      if (!any) { if (/^\d+(\.\d+)?$/.test(s)) ms = +s * 60000; else throw new Error(`Could not read "${text}" as a length of time.`); }
    }
    if (ms < 1000) throw new Error('A timer needs at least a second.');
    if (ms > 24 * 3600000) throw new Error('A timer can run for at most 24 hours — set an alarm for anything longer.');
    return Math.round(ms);
  },

  fmtLeft(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(sec).padStart(2, '0');
  },

  async addTimer(text, label) {
    const total = this.parseDuration(text);
    const t = { id: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), label: String(label || '').trim() || 'Timer', endAt: Date.now() + total, total, reminderId: null };
    this._timers.push(t);
    this._saveTimers();
    // Anything a minute or longer also lives in the main process, so a
    // reload cannot lose it and a desktop toast arrives regardless.
    const b = window.vex && window.vex.reminders;
    if (b && total >= 60000) {
      try { const r = await b.create(t.label, t.endAt, { kind: 'timer', sound: true, urgent: true }); t.reminderId = r.id; this._saveTimers(); }
      catch (err) { window.showToast?.('The timer runs, but only while Vex is open: ' + ((err && err.message) || ''), 'error'); }
    }
    this._pill(); this._rerender();
    return t;
  },

  async removeTimer(id) {
    const t = this._timers.find(x => x.id === id);
    this._timers = this._timers.filter(x => x.id !== id);
    this._saveTimers();
    const b = window.vex && window.vex.reminders;
    if (t && t.reminderId && b) { try { await b.delete(t.reminderId); } catch { /* already fired or gone */ } }
    this._pill(); this._rerender();
  },

  _tickTimers() {
    const now = Date.now();
    const done = this._timers.filter(t => t.endAt <= now);
    if (done.length) {
      this._timers = this._timers.filter(t => t.endAt > now);
      this._saveTimers();
      for (const t of done) {
        // Short timers never reached the main process; they ring from here.
        // Long ones ring through onFired, so do not ring twice.
        if (!t.reminderId) this.ring({ id: null, title: 'Timer', message: t.label, kind: 'timer', snoozable: false });
      }
      this._pill(); this._rerender();
    }
    const el = document.getElementById('clock-timers');
    if (el) for (const t of this._timers) { const s = el.querySelector(`[data-timer="${t.id}"] .ck-timer-left`); if (s) s.textContent = this.fmtLeft(t.endAt - now); }
    const pill = document.getElementById('timer-pill');
    if (pill && !pill.hidden) { const next = this._timers.slice().sort((a, c) => a.endAt - c.endAt)[0]; if (next) pill.querySelector('span').textContent = this.fmtLeft(next.endAt - now); }
    if (this._sw.running) { const d = document.getElementById('clock-sw-display'); if (d) d.textContent = this.fmtStopwatch(this.swElapsed()); }
  },

  _pill() {
    const pill = document.getElementById('timer-pill');
    if (!pill) return;
    const next = this._timers.slice().sort((a, c) => a.endAt - c.endAt)[0];
    pill.hidden = !next;
    if (next) { pill.title = next.label + ' — click to open the Clock'; pill.querySelector('span').textContent = this.fmtLeft(next.endAt - Date.now()); }
  },

  // -------------------------------------------------------------- stopwatch
  _sw: { running: false, startedAt: 0, elapsed: 0, laps: [] },
  swElapsed() { return this._sw.elapsed + (this._sw.running ? Date.now() - this._sw.startedAt : 0); },
  fmtStopwatch(ms) {
    const cs = Math.floor((ms % 1000) / 10), s = Math.floor(ms / 1000) % 60, m = Math.floor(ms / 60000) % 60, h = Math.floor(ms / 3600000);
    return (h ? h + ':' : '') + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') + '.' + String(cs).padStart(2, '0');
  },
  swToggle() { if (this._sw.running) { this._sw.elapsed = this.swElapsed(); this._sw.running = false; } else { this._sw.startedAt = Date.now(); this._sw.running = true; } this._saveSw(); this._rerender(); },
  swLap() { if (!this._sw.running && !this._sw.elapsed) return; this._sw.laps.unshift(this.swElapsed()); this._saveSw(); this._rerender(); },
  swReset() { this._sw = { running: false, startedAt: 0, elapsed: 0, laps: [] }; this._saveSw(); this._rerender(); },
  _saveSw() { try { localStorage.setItem(this.KEY_STOPWATCH, JSON.stringify(this._sw)); } catch { /* display only */ } },
  _loadSw() { try { const s = JSON.parse(localStorage.getItem(this.KEY_STOPWATCH) || 'null'); if (s && typeof s === 'object') this._sw = { running: !!s.running, startedAt: +s.startedAt || 0, elapsed: +s.elapsed || 0, laps: Array.isArray(s.laps) ? s.laps : [] }; } catch { /* fresh */ } },

  // -------------------------------------------------------------- the panel
  _tab: 'alarms',
  _container: null,
  _clockTimer: null,

  cities() { try { const a = JSON.parse(localStorage.getItem(this.KEY_CITIES) || 'null'); if (Array.isArray(a)) return a; } catch { /* default */ } return [{ name: 'London', zone: 'Europe/London' }, { name: 'New York', zone: 'America/New_York' }, { name: 'Tokyo', zone: 'Asia/Tokyo' }]; },
  saveCities(list) { try { localStorage.setItem(this.KEY_CITIES, JSON.stringify(list)); return true; } catch { return false; } },

  renderPanel(container) {
    if (!container) return;
    this._container = container;
    this._loadSw();
    const icon = (n, sz) => (window.VexIcons && VexIcons.has(n)) ? VexIcons.svg(n, { size: sz || 14 }) : '';
    container.innerHTML = `
      <div class="panel-header"><h2>Clock</h2></div>
      <div class="ck-tabs" role="tablist">
        ${[['alarms', 'Alarms', 'alarm'], ['timers', 'Timer', 'timer'], ['stopwatch', 'Stopwatch', 'clock'], ['world', 'World', 'globe']].map(([id, label, ic]) =>
          `<button class="ck-tab${this._tab === id ? ' on' : ''}" data-tab="${id}" role="tab" aria-selected="${this._tab === id}">${icon(ic, 13)}<span>${label}</span></button>`).join('')}
      </div>
      <div class="ck-body" id="clock-body"></div>`;
    container.querySelectorAll('.ck-tab').forEach(b => b.addEventListener('click', () => { this._tab = b.dataset.tab; this.renderPanel(container); }));
    this._renderTab();
  },

  _rerender() { if (this._container && this._container.isConnected && getComputedStyle(this._container).display !== 'none') this._renderTab(); },

  _renderTab() {
    const body = this._container && this._container.querySelector('#clock-body');
    if (!body) return;
    clearInterval(this._clockTimer); this._clockTimer = null;
    if (this._tab === 'alarms') this._renderAlarms(body);
    else if (this._tab === 'timers') this._renderTimers(body);
    else if (this._tab === 'stopwatch') this._renderStopwatch(body);
    else this._renderWorld(body);
  },

  // ---- alarms
  async _renderAlarms(body) {
    const b = window.vex && window.vex.reminders;
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    body.innerHTML = `
      <form class="ck-form" id="ck-alarm-form">
        <div class="ck-row">
          <input type="time" id="ck-alarm-time" class="ck-input ck-time" value="07:00" required>
          <input type="text" id="ck-alarm-label" class="ck-input" placeholder="Label (optional)" maxlength="120">
        </div>
        <div class="ck-days" id="ck-alarm-days">${days.map((d, i) => `<label class="ck-day"><input type="checkbox" value="${i}" ${i >= 1 && i <= 5 ? 'checked' : ''}><span>${d}</span></label>`).join('')}</div>
        <div class="ck-row ck-row-end"><span class="ck-hint">Rings until dismissed, even if Vex was closed — Windows wakes it.</span><button class="qr-btn qr-primary" type="submit">Add alarm</button></div>
      </form>
      <div class="ck-list" id="ck-alarm-list"></div>`;
    const list = body.querySelector('#ck-alarm-list');
    const paint = async () => {
      if (!b) { list.innerHTML = '<div class="ck-empty">Alarms are not available in this build.</div>'; return; }
      let items;
      try { items = (await b.list()).filter(r => r.kind === 'alarm' && !r.firedAt).sort((x, y) => x.at - y.at); }
      catch (err) { list.innerHTML = ''; window.showToast?.('Could not read alarms: ' + ((err && err.message) || ''), 'error'); return; }
      list.innerHTML = items.length ? '' : '<div class="ck-empty">No alarms yet.</div>';
      for (const r of items) {
        const row = document.createElement('div'); row.className = 'ck-item';
        const d = new Date(r.at);
        const when = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
        const rep = Array.isArray(r.repeat) ? (r.repeat.length === 7 ? 'every day' : r.repeat.map(i => days[i]).join(' ')) : 'once';
        row.innerHTML = `<span class="ck-item-big"></span><span class="ck-item-text"><span class="ck-item-label"></span><span class="ck-item-sub"></span></span><button class="ck-x" title="Remove">✕</button>`;
        row.querySelector('.ck-item-big').textContent = when;
        row.querySelector('.ck-item-label').textContent = r.message;
        row.querySelector('.ck-item-sub').textContent = rep + ' · next ' + (window.VexQuickReminder ? VexQuickReminder.describe(d).split(' — ')[0].toLowerCase() : d.toLocaleString()) + (r.os && r.os.scheduled ? '' : ' · while Vex is open');
        row.querySelector('.ck-x').addEventListener('click', async () => { try { await b.delete(r.id); } catch (err) { window.showToast?.((err && err.message) || 'Could not remove it', 'error'); } paint(); });
        list.appendChild(row);
      }
    };
    body.querySelector('#ck-alarm-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!b) return;
      const [hh, mm] = body.querySelector('#ck-alarm-time').value.split(':').map(Number);
      if (!Number.isInteger(hh) || !Number.isInteger(mm)) { window.showToast?.('Pick a time for the alarm', 'error'); return; }
      const chosen = [...body.querySelectorAll('#ck-alarm-days input:checked')].map(i => +i.value);
      const label = body.querySelector('#ck-alarm-label').value.trim() || 'Alarm';
      const now = new Date();
      const first = (() => { const d = new Date(now); d.setHours(hh, mm, 0, 0); const allowed = chosen.length ? chosen : [0, 1, 2, 3, 4, 5, 6]; if (d.getTime() <= now.getTime() + 60000 || !allowed.includes(d.getDay())) { do { d.setDate(d.getDate() + 1); } while (!allowed.includes(d.getDay())); } return d.getTime(); })();
      try {
        const r = await b.create(label, first, { kind: 'alarm', sound: true, urgent: true, ...(chosen.length ? { repeat: chosen } : {}) });
        window.showToast?.('Alarm set — ' + (window.VexQuickReminder ? VexQuickReminder.describe(new Date(r.at)) : new Date(r.at).toLocaleString()));
        if (!r.os || !r.os.scheduled) window.showToast?.('It will ring while Vex is running' + (r.os && r.os.error ? ' — Windows will not wake Vex for it: ' + r.os.error : ''), 'error');
        body.querySelector('#ck-alarm-label').value = '';
        paint();
      } catch (err) { window.showToast?.((err && err.message) || 'Could not set the alarm', 'error'); }
    });
    paint();
  },

  // ---- timers
  _renderTimers(body) {
    body.innerHTML = `
      <form class="ck-form" id="ck-timer-form">
        <div class="ck-row">
          <input type="text" id="ck-timer-len" class="ck-input" placeholder="25 min, 1h 30, 90s, 10:00" autocomplete="off" required>
          <input type="text" id="ck-timer-label" class="ck-input" placeholder="Label (optional)" maxlength="120">
          <button class="qr-btn qr-primary" type="submit">Start</button>
        </div>
        <div class="qr-chips">${['5 min', '10 min', '15 min', '25 min', '45 min', '1 hour'].map(p => `<button type="button" class="qr-chip" data-len="${p}">${p}</button>`).join('')}</div>
        <div class="ck-hint">A timer of a minute or more keeps running through a reload and ends with a desktop notification.</div>
      </form>
      <div class="ck-list" id="clock-timers"></div>`;
    const paint = () => {
      const list = body.querySelector('#clock-timers'); list.innerHTML = this._timers.length ? '' : '<div class="ck-empty">No timers running.</div>';
      for (const t of this._timers.slice().sort((a, c) => a.endAt - c.endAt)) {
        const row = document.createElement('div'); row.className = 'ck-item'; row.dataset.timer = t.id;
        row.innerHTML = `<span class="ck-item-big ck-timer-left"></span><span class="ck-item-text"><span class="ck-item-label"></span><span class="ck-item-sub"></span></span><button class="ck-x" title="Stop">✕</button>`;
        row.querySelector('.ck-timer-left').textContent = this.fmtLeft(t.endAt - Date.now());
        row.querySelector('.ck-item-label').textContent = t.label;
        row.querySelector('.ck-item-sub').textContent = 'ends ' + new Date(t.endAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' · ' + this.fmtLeft(t.total) + ' total';
        row.querySelector('.ck-x').addEventListener('click', () => this.removeTimer(t.id));
        list.appendChild(row);
      }
    };
    body.querySelectorAll('[data-len]').forEach(c => c.addEventListener('click', () => { body.querySelector('#ck-timer-len').value = c.dataset.len; body.querySelector('#ck-timer-form').requestSubmit(); }));
    body.querySelector('#ck-timer-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await this.addTimer(body.querySelector('#ck-timer-len').value, body.querySelector('#ck-timer-label').value); body.querySelector('#ck-timer-len').value = ''; body.querySelector('#ck-timer-label').value = ''; }
      catch (err) { window.showToast?.((err && err.message) || 'Could not start the timer', 'error'); }
    });
    paint();
  },

  // ---- stopwatch
  _renderStopwatch(body) {
    body.innerHTML = `
      <div class="ck-sw">
        <div class="ck-sw-display" id="clock-sw-display">${this.fmtStopwatch(this.swElapsed())}</div>
        <div class="ck-row ck-row-center">
          <button class="qr-btn qr-primary" id="ck-sw-toggle">${this._sw.running ? 'Pause' : (this._sw.elapsed ? 'Resume' : 'Start')}</button>
          <button class="qr-btn" id="ck-sw-lap" ${this._sw.running ? '' : 'disabled'}>Lap</button>
          <button class="qr-btn" id="ck-sw-reset" ${this._sw.running || this._sw.elapsed ? '' : 'disabled'}>Reset</button>
        </div>
        <div class="ck-laps">${this._sw.laps.map((l, i, arr) => `<div class="ck-lap"><span>Lap ${arr.length - i}</span><span>${this.fmtStopwatch(l - (arr[i + 1] || 0))}</span><span class="ck-lap-total">${this.fmtStopwatch(l)}</span></div>`).join('')}</div>
      </div>`;
    body.querySelector('#ck-sw-toggle').addEventListener('click', () => this.swToggle());
    body.querySelector('#ck-sw-lap').addEventListener('click', () => this.swLap());
    body.querySelector('#ck-sw-reset').addEventListener('click', () => this.swReset());
  },

  // ---- world clock
  _renderWorld(body) {
    const cities = this.cities();
    body.innerHTML = `
      <form class="ck-form ck-row" id="ck-city-form">
        <input type="text" id="ck-city" class="ck-input" list="ck-city-list" placeholder="Add a city — Istanbul, New York, or Asia/Tokyo" autocomplete="off">
        <datalist id="ck-city-list">${this.CITIES.map(([n]) => `<option value="${n}">`).join('')}</datalist>
        <button class="qr-btn" type="submit">Add</button>
      </form>
      <div class="ck-row ck-slider-row">
        <label class="ck-hint" for="ck-slider">When it is <b id="ck-slider-label">now</b> here</label>
        <input type="range" id="ck-slider" min="0" max="1440" step="15" value="-1">
        <button class="qr-btn ck-mini" id="ck-slider-reset" type="button">Now</button>
      </div>
      <div class="ck-list" id="ck-world"></div>`;
    const slider = body.querySelector('#ck-slider');
    let offsetMin = null;   // null = live
    const paint = () => {
      const base = offsetMin == null ? Date.now() : (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() + offsetMin * 60000; })();
      body.querySelector('#ck-slider-label').textContent = offsetMin == null ? 'now' : String(Math.floor(offsetMin / 60)).padStart(2, '0') + ':' + String(offsetMin % 60).padStart(2, '0');
      const list = body.querySelector('#ck-world'); list.innerHTML = '';
      const mine = this.partsIn(Intl.DateTimeFormat().resolvedOptions().timeZone, base);
      for (const c of cities) {
        let p; try { p = this.partsIn(c.zone, base); } catch { continue; }
        const row = document.createElement('div'); row.className = 'ck-item ck-city' + (p.hour >= 7 && p.hour < 19 ? ' day' : ' night');
        const dayDiff = p.day === mine.day ? '' : (Date.UTC(p.year, p.month - 1, p.day) > Date.UTC(mine.year, mine.month - 1, mine.day) ? 'tomorrow' : 'yesterday');
        row.innerHTML = `<span class="ck-item-big"></span><span class="ck-item-text"><span class="ck-item-label"></span><span class="ck-item-sub"></span></span><button class="ck-x" title="Remove">✕</button>`;
        row.querySelector('.ck-item-big').textContent = String(p.hour).padStart(2, '0') + ':' + String(p.minute).padStart(2, '0');
        row.querySelector('.ck-item-label').textContent = c.name;
        row.querySelector('.ck-item-sub').textContent = [p.weekday, dayDiff, this.offsetLabel(c.zone, base), c.zone].filter(Boolean).join(' · ');
        row.querySelector('.ck-x').addEventListener('click', () => { const next = cities.filter(x => x !== c); if (!this.saveCities(next)) { window.showToast?.('Could not save the city list', 'error'); return; } this._renderWorld(body); });
        list.appendChild(row);
      }
    };
    body.querySelector('#ck-city-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const z = this.zoneFor(body.querySelector('#ck-city').value);
      if (!z) { window.showToast?.('Not a city or zone I know — try "New York", or an IANA name like Asia/Tokyo', 'error'); return; }
      if (cities.some(c => c.zone === z.zone && c.name === z.name)) { window.showToast?.(z.name + ' is already listed'); return; }
      if (!this.saveCities([...cities, z])) { window.showToast?.('Could not save the city list', 'error'); return; }
      this._renderWorld(body);
    });
    slider.addEventListener('input', () => { offsetMin = +slider.value; paint(); });
    body.querySelector('#ck-slider-reset').addEventListener('click', () => { offsetMin = null; slider.value = -1; paint(); });
    paint();
    this._clockTimer = setInterval(() => { if (offsetMin == null && body.isConnected) paint(); }, 1000);
  },
};

if (typeof window !== 'undefined') window.VexClock = VexClock;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexClock };
