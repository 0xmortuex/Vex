// === Night usage coach (T1-012) ===============================================
//
// After the bedtime you chose, Vex counts the minutes you actually use it (the
// window is visible and the computer is not idle) and, as they add up, says so,
// a little more plainly each time. It never blocks, never dims by itself (the
// evening wind-down does that, js/theme-auto.js) and never says anything twice
// in a night:
//
//    10 min   "Past your bedtime. Save your session and pick it up tomorrow?"   [Save session]
//    40 min   "Still here. Send the social and video tabs to tomorrow morning?"  [Send to later]
//    90 min   "90 minutes past bedtime. Here is how the last week went."        [See the week]
//   every further hour, up to three: one short line.
//
// Bedtime is the setting below, else the start of the wind-down when that is on,
// else 23:30. The night lasts until the wake-up time (06:00), so after midnight
// still counts as the same night. Each line goes through the Attention Budget
// as "asked for": you set this up to be told, so the usual caps do not apply, but
// nothing is said in Game mode or a meeting, and "Never for this" in the Inbox is
// honoured. "Quiet for tonight" (Ctrl+K, or Settings) silences the rest of it.
//
// What is kept: per night, the minutes counted and when you were last active, for
// the last two weeks (vex.nightCoach.log), on this computer only.
const NightCoach = {
  PREFS_KEY: 'vex.nightCoach',
  LOG_KEY: 'vex.nightCoach.log',
  KEEP_NIGHTS: 14,
  DEFAULTS: { on: true, bedtime: '', wake: '06:00' },
  FALLBACK_BEDTIME: '23:30',
  IDLE_SECONDS: 120,
  // [id, minutes of use past bedtime]
  STAGES: [['save', 10], ['later', 40], ['last', 90], ['more1', 150], ['more2', 210], ['more3', 270]],
  FEATURE: 'night-coach',

  _now() { return new Date(); },

  // ---- pure helpers ------------------------------------------------------------------
  minutesOf(hm) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hm || ''));
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new Error('"' + hm + '" is not a time of day (HH:MM)');
    return Number(m[1]) * 60 + Number(m[2]);
  },
  dayKey(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  },
  // The night `now` belongs to (the date the evening began on), or null by day.
  nightOf(now, bedMin, wakeMin) {
    const cur = now.getHours() * 60 + now.getMinutes();
    const wraps = bedMin > wakeMin;
    const inside = wraps ? (cur >= bedMin || cur < wakeMin) : (cur >= bedMin && cur < wakeMin);
    if (!inside) return null;
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (wraps && cur < wakeMin) start.setDate(start.getDate() - 1);
    return this.dayKey(start);
  },
  // The stage to say now: the first one reached and not yet said. At most one a tick.
  nextStage(minutesUsed, fired) {
    for (const [id, at] of this.STAGES) if (minutesUsed >= at && !fired.includes(id)) return id;
    return null;
  },

  // ---- preferences and the log ----------------------------------------------------------
  prefs() {
    const raw = localStorage.getItem(this.PREFS_KEY);
    if (raw === null) return { ...this.DEFAULTS };
    let v;
    try { v = JSON.parse(raw); }
    catch (err) { console.error('[NightCoach] the saved choices are damaged and start again:', err); return { ...this.DEFAULTS }; }
    const out = { ...this.DEFAULTS };
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (typeof v.on === 'boolean') out.on = v.on;
      for (const k of ['bedtime', 'wake']) if (typeof v[k] === 'string' && (v[k] === '' && k === 'bedtime' || /^\d{1,2}:\d{2}$/.test(v[k]))) out[k] = v[k];
    }
    return out;
  },
  savePrefs(patch) {
    const next = { ...this.prefs(), ...patch };
    if (next.bedtime) this.minutesOf(next.bedtime);
    this.minutesOf(next.wake);
    localStorage.setItem(this.PREFS_KEY, JSON.stringify(next));
  },
  enabled() { return this.prefs().on; },
  setEnabled(on) { this.savePrefs({ on: !!on }); },

  // The bedtime in force: the one chosen, else the wind-down's start, else 23:30.
  bedtime() {
    const p = this.prefs();
    if (p.bedtime) return p.bedtime;
    if (typeof ThemeAuto !== 'undefined' && typeof ThemeAuto.windState === 'function') {
      const w = ThemeAuto.windState();
      if (w && w.on && typeof w.start === 'string') return w.start;
    }
    return this.FALLBACK_BEDTIME;
  },

  log() {
    const raw = localStorage.getItem(this.LOG_KEY);
    if (raw === null) return { nights: {} };
    let v;
    try { v = JSON.parse(raw); }
    catch (err) { console.error('[NightCoach] the saved nights are damaged and start again:', err); return { nights: {} }; }
    return v && typeof v === 'object' && v.nights && typeof v.nights === 'object' ? v : { nights: {} };
  },
  _saveLog(log) {
    const keys = Object.keys(log.nights).sort();
    while (keys.length > this.KEEP_NIGHTS) delete log.nights[keys.shift()];
    localStorage.setItem(this.LOG_KEY, JSON.stringify(log));
  },
  _rec(log, night) {
    if (!log.nights[night]) log.nights[night] = { min: 0, last: 0, fired: [], off: false };
    return log.nights[night];
  },

  quietTonight() {
    const now = this._now();
    const night = this.nightOf(now, this.minutesOf(this.bedtime()), this.minutesOf(this.prefs().wake)) || this.dayKey(now);
    const log = this.log();
    this._rec(log, night).off = true;
    this._saveLog(log);
    window.showToast?.('Night coach is quiet for tonight', 'info', 3000);
  },

  // ---- the minute tick ------------------------------------------------------------------
  // Returns what it said (a stage id) or null.
  async tick() {
    if (!this.enabled()) return null;
    const now = this._now();
    const night = this.nightOf(now, this.minutesOf(this.bedtime()), this.minutesOf(this.prefs().wake));
    if (!night) return null;
    if (this._busy()) return null;
    if (document.hidden) return null;
    if (!window.vex || typeof window.vex.idleSeconds !== 'function') throw new Error('The night coach needs the window bridge (idleSeconds)');
    const idle = await window.vex.idleSeconds();
    if (idle >= this.IDLE_SECONDS) return null;
    const log = this.log();
    const rec = this._rec(log, night);
    rec.min += 1;
    rec.last = now.getTime();
    let said = null;
    if (!rec.off) {
      const stage = this.nextStage(rec.min, rec.fired);
      if (stage && this._say(stage, rec, now)) { rec.fired.push(stage); said = stage; }
    }
    this._saveLog(log);
    return said;
  },

  // Game mode or a meeting: nothing is said (and nothing counted).
  _busy() {
    if (typeof GameMode !== 'undefined' && GameMode.gaming) return true;
    if (typeof AttentionState !== 'undefined') {
      const st = AttentionState.get();
      if (st && Array.isArray(st.sources) && st.sources.some(s => s.id === 'game' || s.id === 'meeting')) return true;
    }
    return false;
  },

  _hm(d) { return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); },

  // The tabs that would go to "later": social and video, not the one in front, not pinned.
  laterCandidates() {
    if (typeof DistractionBudget === 'undefined' || typeof TabManager === 'undefined') return [];
    return TabManager.tabs.filter(t => t.id !== TabManager.activeTabId && !t.pinned
      && ['social', 'video'].includes(DistractionBudget.categoryOf(t.url))
      && typeof TabSnooze !== 'undefined' && TabSnooze.canSnooze(t));
  },

  // The next 09:00 from `now`.
  nextMorning(now = this._now()) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0, 0);
    if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
    return d.getTime();
  },

  async saveSession() {
    if (typeof VexWorkday === 'undefined') throw new Error('Resume workday is not available');
    const day = VexWorkday.endOfDay();
    window.showToast?.('Saved ' + day.tabs + ' tab' + VexPlural.s(day.tabs) + '. "Resume yesterday" in Ctrl+K brings them back.', 'info', 6000);
  },
  sendToLater() {
    const list = this.laterCandidates();
    const at = this.nextMorning();
    let n = 0;
    for (const t of list) { TabSnooze.snooze(t.id, at); n++; }
    window.showToast?.(n ? n + ' tab' + VexPlural.s(n) + ' will be back at 09:00' : 'No social or video tabs to send', 'info', 5000);
    return n;
  },

  // → true when the line was shown.
  _say(stage, rec, now) {
    if (typeof VexAttention !== 'undefined') {
      if (VexAttention.isMuted(this.FEATURE)) return false;
      if (!VexAttention.request({ feature: this.FEATURE, urgency: 'asked', id: stage }).allow) return false;
    }
    const bed = this.bedtime();
    const fail = (err) => window.showToast?.('That did not work: ' + ((err && err.message) || err), 'error');
    let text, action = null;
    if (stage === 'save') {
      text = 'It is past your bedtime (' + bed + '). Save your session and pick it up tomorrow?';
      action = { label: 'Save session', run: () => this.saveSession().catch(fail) };
      this._offerWindDown();
    } else if (stage === 'later') {
      const n = this.laterCandidates().length;
      if (n) {
        text = 'Still here at ' + this._hm(now) + '. Send the ' + n + ' social and video tab' + VexPlural.s(n) + ' to tomorrow morning?';
        action = { label: 'Send to later', run: () => { try { this.sendToLater(); } catch (err) { fail(err); } } };
      } else text = 'Still here at ' + this._hm(now) + '. It is a good moment to stop.';
    } else if (stage === 'last') {
      text = rec.min + ' minutes past your bedtime. Here is how the last week went.';
      action = { label: 'See the week', run: () => this.showWeek() };
    } else {
      text = 'Still up at ' + this._hm(now) + ' (' + rec.min + ' minutes past ' + bed + ').';
    }
    window.showToast?.(text, 'info', 15000, action ? { action } : undefined);
    return true;
  },

  // Once a week at most, into the Inbox: dimming the screen after bedtime is the wind-down's job.
  _offerWindDown() {
    if (typeof ThemeAuto === 'undefined' || typeof ThemeAuto.windState !== 'function' || ThemeAuto.windState().on) return;
    if (typeof VexAttention === 'undefined') return;
    VexAttention.suggest({
      feature: this.FEATURE, id: 'wind-offer', label: 'Night coach',
      title: 'Dim the screen in the evening?', body: 'The wind-down warms and dims the screen from ' + this.bedtime() + ' on its own.',
      action: { label: 'Turn it on', key: 'wind-on' },
    });
  },

  // ---- last week -------------------------------------------------------------------------
  // [{ night, min, last }] for the last `count` nights, oldest first.
  week(count = 7, now = this._now()) {
    const log = this.log();
    const out = [];
    for (let i = count - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const key = this.dayKey(d);
      const r = log.nights[key];
      out.push({ night: key, min: r ? r.min : 0, last: r ? r.last : 0 });
    }
    return out;
  },

  // The average clock time you were last active on nights you used Vex past bedtime, "00:40", or ''.
  usualCutoff(rows) {
    const used = rows.filter(r => r.last > 0);
    if (!used.length) return '';
    const bed = this.minutesOf(this.bedtime());
    // Minutes since bedtime, so 23:50 and 00:40 average the right way round.
    const since = used.map(r => { const d = new Date(r.last); return (((d.getHours() * 60 + d.getMinutes()) - bed) % 1440 + 1440) % 1440; });
    const mean = Math.round(since.reduce((a, b) => a + b, 0) / since.length);
    const at = (bed + mean) % 1440;
    return String(Math.floor(at / 60)).padStart(2, '0') + ':' + String(at % 60).padStart(2, '0');
  },

  showWeek() {
    if (typeof VexSettingsGroups === 'undefined') throw new Error('The dialog helpers are not loaded');
    const rows = this.week();
    const cutoff = this.usualCutoff(rows);
    const { body } = VexSettingsGroups.dialog({
      id: 'night-coach-week', title: 'The last week, after ' + this.bedtime(),
      sub: cutoff ? 'You usually stop around ' + cutoff + '.' : 'No use past bedtime was counted in the last week.',
    });
    const max = Math.max(60, ...rows.map(r => r.min));
    for (const r of rows) {
      const line = document.createElement('div');
      line.className = 'nc-row';
      const d = new Date(r.night + 'T12:00:00');
      const name = document.createElement('span'); name.className = 'nc-day'; name.textContent = d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
      const track = document.createElement('span'); track.className = 'nc-track';
      const bar = document.createElement('span'); bar.className = 'nc-bar'; bar.style.width = Math.round(100 * r.min / max) + '%';
      track.appendChild(bar);
      const what = document.createElement('span'); what.className = 'nc-what';
      what.textContent = r.min ? r.min + ' min, last at ' + this._hm(new Date(r.last)) : 'none';
      line.append(name, track, what);
      body.appendChild(line);
    }
  },

  // ---- Settings ----------------------------------------------------------------------------
  render(body) {
    body.textContent = '';
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    body.appendChild(el('p', 'setting-info', 'After your bedtime Vex counts the minutes you really use it and says so, a little more plainly each time. It never blocks anything and says nothing during a game or a meeting.'));
    const row = el('div', 'setting-toggle-row');
    const lab = el('label', 'toggle');
    const input = document.createElement('input');
    input.type = 'checkbox'; input.checked = this.enabled(); input.setAttribute('aria-label', 'Night usage coach');
    input.addEventListener('change', () => { try { this.setEnabled(input.checked); } catch (err) { input.checked = !input.checked; window.showToast?.(err.message, 'error'); } });
    lab.append(input, el('span', 'toggle-slider'));
    row.append(el('span', 'setting-label-text', 'Night usage coach'), lab);
    body.appendChild(row);
    const time = (label, key, placeholder) => {
      const r = el('div', 'setting-row');
      const t = document.createElement('input');
      t.type = 'time'; t.className = 'set-input'; t.value = this.prefs()[key] || '';
      t.setAttribute('aria-label', label);
      if (placeholder) t.title = placeholder;
      t.addEventListener('change', () => { try { this.savePrefs({ [key]: t.value }); } catch (err) { window.showToast?.(err.message, 'error'); t.value = this.prefs()[key] || ''; } });
      r.append(el('span', '', label), t);
      body.appendChild(r);
    };
    time('Bedtime (empty: the wind-down start, else ' + this.FALLBACK_BEDTIME + ')', 'bedtime');
    time('Night ends at', 'wake');
    const btns = el('div', 'setting-row');
    const quiet = el('button', 'btn-secondary', 'Quiet for tonight'); quiet.type = 'button';
    quiet.addEventListener('click', () => this.quietTonight());
    const week = el('button', 'btn-secondary', 'Show the last week'); week.type = 'button';
    week.addEventListener('click', () => { try { this.showWeek(); } catch (err) { window.showToast?.(err.message, 'error'); } });
    btns.append(quiet, week);
    body.appendChild(btns);
  },

  init() {
    if (typeof VexJobs === 'undefined') throw new Error('VexJobs is not loaded: js/jobs.js must come before js/night-coach.js');
    VexJobs.every('Night coach', 60 * 1000, () => this.tick(), { when: 'ui', feature: 'night-coach' });
    if (typeof AttentionInbox !== 'undefined') {
      AttentionInbox.handle(this.FEATURE, (key) => {
        if (key === 'wind-on') ThemeAuto.windSet({ on: true });
      });
    }
    if (typeof VexSettingsGroups !== 'undefined') {
      VexSettingsGroups.register({ id: 'night-coach', title: 'Night usage coach', keywords: 'bedtime sleep night late wind-down', render: (body) => this.render(body) });
    }
    if (typeof CommandBar !== 'undefined' && Array.isArray(CommandBar.commands)) {
      CommandBar.commands.push(
        { id: 'nightcoach-quiet', label: 'Night coach: quiet for tonight', hint: 'Stop the late-night reminders until tomorrow', icon: 'moon', action: () => this.quietTonight() },
        { id: 'nightcoach-week', label: 'Night coach: the last week', hint: 'How long you used Vex after your bedtime on each of the last seven nights', icon: 'chart-bar', action: () => { try { this.showWeek(); } catch (err) { window.showToast?.(err.message, 'error'); } } },
      );
    }
  },
};

if (typeof window !== 'undefined') window.NightCoach = NightCoach;
if (typeof module !== 'undefined' && module.exports) module.exports = { NightCoach };
