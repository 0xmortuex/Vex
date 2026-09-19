// === Natural language in the command bar ===================================
//
// "remind me to call Dana tomorrow 9am", "timer 25 min", "alarm 7am weekdays",
// "what time is it in Tokyo", "stopwatch" — typed straight into Ctrl+K, no
// panel. Each returns a result in the command bar's own shape; Enter runs it.
//
// The parsers already exist (quick-reminder.js, clock-panel.js); this only
// recognises the sentence shapes and hands the pieces over. Anything it does
// not understand returns nothing, so the ordinary results are untouched.
const VexQuickCommands = {
  DAY_WORDS: { sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, wednesday: 3, wed: 3, thursday: 4, thu: 4, friday: 5, fri: 5, saturday: 6, sat: 6 },

  results(raw) {
    const q = String(raw || '').trim();
    if (!q) return [];
    const out = [];
    for (const fn of [this._remind, this._watch, this._timer, this._alarm, this._timeIn, this._stopwatch, this._freeMemory]) {
      try { const r = fn.call(this, q); if (r) out.push(r); } catch (err) { /* a parse that failed part-way says so as a result, below */ out.push(this._unreadable(q, err)); }
    }
    return out;
  },

  // tell me when this drops under 300 / watch this page for changes / tell me
  // when it goes down — a page watch on the tab in front (js/page-watch.js).
  _watch(q) {
    const m = q.match(/^(?:tell me|let me know|notify me|alert me|ping me)\s+(?:when|if)\s+(.+)$/i) || q.match(/^watch\s+(?:this|this page|the page|it)\s*(?:for|until|till|when)?\s*(.*)$/i);
    if (!m || typeof PageWatch === 'undefined') return null;
    const rule = PageWatch.parseWhen(m[1] || 'changes');
    return {
      id: 'quick-watch', icon: 'eye', isPrimary: true,
      label: 'Watch this page: ' + PageWatch.describeRule(rule),
      hint: 'Checks every 15 minutes in the background and tells you',
      action: () => {
        try { const r = PageWatch.watchCurrent(m[1] || 'changes'); window.showToast?.('Watching ' + r.said); }
        catch (err) { window.showToast?.((err && err.message) || 'Could not watch this page', 'error'); }
      },
    };
  },

  // free memory / free up memory / free ram — the Memory panel's button, from anywhere.
  _freeMemory(q) {
    if (!/^free(?:\s+up)?\s+(?:memory|ram)$/i.test(q)) return null;
    return {
      id: 'quick-free-memory', icon: 'cpu', isPrimary: true, label: 'Free memory now',
      hint: 'Sleep idle tabs (pinned ones idle over 30 min too), sleep hidden panels, unload idle extensions',
      action: () => {
        if (typeof MemoryPanel === 'undefined' || typeof MemoryPanel.freeNow !== 'function') throw new Error('The Memory panel is not loaded');
        MemoryPanel.freeNow().catch(err => window.showToast?.(err.message, 'error'));
      },
    };
  },

  _unreadable(q, err) {
    return { id: 'quick-error', icon: 'warning', isPrimary: false, label: (err && err.message) || 'Could not read that', hint: q, action: () => {} };
  },

  // remind me to X tomorrow 9am / remind me tomorrow 9am to X / remind me X in 2 hours
  _remind(q) {
    const m = q.match(/^remind(?:\s+me)?\s+(.+)$/i);
    if (!m || typeof VexQuickReminder === 'undefined') return null;
    let body = m[1].trim();
    // "at/on/when …" phrasing that opens a site reminder is handled by the parser.
    // Find the split: try the longest tail that parses as a trigger.
    const words = body.replace(/^to\s+/i, '').split(/\s+/);
    let best = null;
    for (let k = Math.min(6, words.length - 1); k >= 1; k--) {
      const tail = words.slice(-k).join(' ');
      try {
        const t = VexQuickReminder.parseTrigger(tail);
        best = { trigger: t, message: words.slice(0, -k).join(' ').replace(/[\s,]+(?:at|on|in|by)$/i, '').trim(), tail };
        break;
      } catch { /* not a trigger; try a shorter tail */ }
    }
    // "remind me tomorrow 9am to call Dana": time first, then "to …".
    if (!best) {
      const alt = body.match(/^(.+?)\s+to\s+(.+)$/i);
      if (alt) { try { best = { trigger: VexQuickReminder.parseTrigger(alt[1]), message: alt[2].trim(), tail: alt[1] }; } catch { /* no */ } }
    }
    if (!best) throw new Error('Say when — "remind me to call Dana tomorrow 9am", or "… in 2 hours", or "… when I open github.com"');
    if (!best.message) throw new Error('Say what to remind you of — "remind me to call Dana tomorrow 9am"');
    const when = VexQuickReminder.describeTrigger(best.trigger);
    return {
      id: 'quick-remind', icon: 'bell', isPrimary: true,
      label: 'Remind me: ' + best.message,
      hint: when,
      action: async () => {
        try {
          const r = await VexQuickReminder.create(best.message, best.trigger.site ? { site: best.trigger.site } : best.trigger.at, {});
          window.showToast?.('Reminder set — ' + when);
          if (!best.trigger.site && (!r || !r.os || !r.os.scheduled)) window.showToast?.('It will fire while Vex is running' + (r && r.os && r.os.error ? ' — ' + r.os.error : ''), 'error');
          if (best.trigger.site && VexQuickReminder._hostsChanged) VexQuickReminder._hostsChanged();
        } catch (err) { window.showToast?.((err && err.message) || 'Could not set the reminder', 'error'); }
      },
    };
  },

  // timer 25 min / countdown 1h 30 / timer 10:00 tea
  _timer(q) {
    const m = q.match(/^(?:timer|countdown)\s+(.+)$/i);
    if (!m || typeof VexClock === 'undefined') return null;
    // The duration is the leading part; anything after it is the label.
    const words = m[1].trim().split(/\s+/);
    let ms = null, label = '';
    for (let k = Math.min(4, words.length); k >= 1; k--) {
      try { ms = VexClock.parseDuration(words.slice(0, k).join(' ')); label = words.slice(k).join(' '); break; } catch { /* shorter */ }
    }
    if (ms == null) throw new Error('Say how long — "timer 25 min", "timer 1h 30", "timer 90s"');
    return {
      id: 'quick-timer', icon: 'timer', isPrimary: true,
      label: 'Timer: ' + VexClock.fmtLeft(ms) + (label ? ' — ' + label : ''),
      hint: 'Ends at ' + new Date(Date.now() + ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      action: async () => {
        try { await VexClock.addTimer(words.slice(0, words.length - (label ? label.split(/\s+/).length : 0)).join(' '), label); window.showToast?.('Timer started — ' + VexClock.fmtLeft(ms)); }
        catch (err) { window.showToast?.((err && err.message) || 'Could not start the timer', 'error'); }
      },
    };
  },

  // alarm 7am / alarm 7:30 weekdays / alarm 6am mon wed fri wake up
  _alarm(q) {
    const m = q.match(/^alarm\s+(.+)$/i);
    if (!m || typeof VexQuickReminder === 'undefined') return null;
    const words = m[1].trim().replace(/\bevery\s+day\b/i, 'daily').split(/\s+/);
    const time = VexQuickReminder._parseTime(words[0]);
    if (!time) throw new Error('Say a time — "alarm 7am", "alarm 7:30 weekdays", "alarm 6am mon wed fri"');
    let days = [];
    const labelWords = [];
    for (const w of words.slice(1)) {
      const lw = w.toLowerCase().replace(/,$/, '');
      if (lw === 'weekdays') days.push(1, 2, 3, 4, 5);
      else if (lw === 'weekends') days.push(0, 6);
      else if (lw === 'daily' || lw === 'everyday') days.push(0, 1, 2, 3, 4, 5, 6);
      else if (lw === 'every' || lw === 'day' || lw === 'on') continue;
      else if (this.DAY_WORDS[lw] != null) days.push(this.DAY_WORDS[lw]);
      else labelWords.push(w);
    }
    days = [...new Set(days)].sort();
    const label = labelWords.join(' ') || 'Alarm';
    const now = new Date();
    const first = (() => { const d = new Date(now); d.setHours(time.hour, time.minute, 0, 0); const allowed = days.length ? days : [0, 1, 2, 3, 4, 5, 6]; if (d.getTime() <= now.getTime() + 60000 || !allowed.includes(d.getDay())) { do { d.setDate(d.getDate() + 1); } while (!allowed.includes(d.getDay())); } return d; })();
    const hhmm = String(time.hour).padStart(2, '0') + ':' + String(time.minute).padStart(2, '0');
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return {
      id: 'quick-alarm', icon: 'alarm', isPrimary: true,
      label: 'Alarm ' + hhmm + (days.length ? ' ' + (days.length === 7 ? 'every day' : days.map(d => dayNames[d]).join(' ')) : ' once') + (label !== 'Alarm' ? ' — ' + label : ''),
      hint: 'First rings ' + VexQuickReminder.describe(first),
      action: async () => {
        const b = window.vex && window.vex.reminders;
        if (!b) { window.showToast?.('Alarms are not available in this build', 'error'); return; }
        try {
          const job = (typeof JobProfiles !== 'undefined' && JobProfiles.current) ? JobProfiles.current() : null;
          const r = await b.create(label, first.getTime(), { kind: 'alarm', sound: true, urgent: true, ...(days.length ? { repeat: days } : {}), ...(job ? { job } : {}) });
          window.showToast?.('Alarm set — ' + VexQuickReminder.describe(new Date(r.at)));
          if (!r.os || !r.os.scheduled) window.showToast?.('It will ring while Vex is running' + (r.os && r.os.error ? ' — ' + r.os.error : ''), 'error');
        } catch (err) { window.showToast?.((err && err.message) || 'Could not set the alarm', 'error'); }
      },
    };
  },

  // what time is it in Tokyo / time in new york / tokyo time
  _timeIn(q) {
    const m = q.match(/^(?:what(?:'s| is) the time in|what time is it in|time in|time at)\s+(.+?)\??$/i) || q.match(/^(.+?)\s+time\??$/i);
    if (!m || typeof VexClock === 'undefined') return null;
    const z = VexClock.zoneFor(m[1].trim());
    if (!z) return null;   // "9am New York time" is a reminder phrasing, not this
    const now = Date.now();
    const p = VexClock.partsIn(z.zone, now);
    const text = String(p.hour).padStart(2, '0') + ':' + String(p.minute).padStart(2, '0') + ' in ' + z.name;
    return {
      id: 'quick-time', icon: 'globe', isPrimary: true,
      label: text,
      hint: p.weekday + ' · ' + VexClock.offsetLabel(z.zone, now) + ' · ' + z.zone + ' — Enter adds it to the world clock',
      action: () => {
        const cities = VexClock.cities();
        if (!cities.some(c => c.zone === z.zone)) { if (!VexClock.saveCities([...cities, z])) { window.showToast?.('Could not save the city', 'error'); return; } }
        VexClock._tab = 'world';
        if (typeof SidebarManager !== 'undefined') SidebarManager.openPanel('clock');
      },
    };
  },

  _stopwatch(q) {
    if (!/^stopwatch$/i.test(q) || typeof VexClock === 'undefined') return null;
    return { id: 'quick-stopwatch', icon: 'clock', isPrimary: true, label: 'Stopwatch', hint: 'Open the stopwatch',
      action: () => { VexClock._tab = 'stopwatch'; if (typeof SidebarManager !== 'undefined') SidebarManager.openPanel('clock'); } };
  },
};

if (typeof window !== 'undefined') window.VexQuickCommands = VexQuickCommands;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexQuickCommands };
