// === One "when" box for everything that can be put off (T2-039) ===============
//
// Snoozing grew one parser per object: tabs ("In an hour"), snooze-anything
// ("tomorrow morning"), reminders ("tomorrow at 9"), tasks (@date), the inbox.
// Each understood a slightly different set of words, and none understood a day
// of the week WITH a time ("fri 17:00") or a place ("at school") or a condition
// ("after the game"). This is the ONE parser, and one box that applies what it
// understood to whichever object is in front of you.
//
//   fri 17:00 at school     Friday 17:00, with the place "school" kept as a note
//   tomorrow 9              tomorrow at 9:00
//   in 45 min / in 2h       relative
//   next week / weekend     Monday 9:00 / Saturday 10:00
//   2026-10-20 / oct 20     a day (9:00 unless a time is given)
//   after the game          when Game mode ends (plus 10 minutes), not a clock time
//
//   VexWhen.parse(text, now)        pure: { at, label, place, cond, timeGiven }
//                                   or throws, saying what was not understood
//   VexWhen.apply(target, text)     puts the object off. Targets:
//       { kind:'tab', tabId }                   closed now, brought back by TabSnooze
//       { kind:'page'|'story', title, url }     kept and shown in the brief when due
//       { kind:'reminder', id, message }        moved (made again first, then the old one removed)
//       { kind:'task', task }                   its date moves; a reminder only when a time was given
//       { kind:'clip', text }                   becomes a reminder with its text
//       { kind:'mail', title, ref }             hidden from mail triage until due
//   VexWhen.ask(target)             the box: type, see how it was read, press Apply
//
// It reuses the handlers that already own each kind (VexSnooze, TabSnooze,
// reminders, tasks); it replaces none of them. "After the game" is held in
// 'vex.when.pending' and resolved when Game mode ends. Nothing is sent anywhere.

const VexWhen = {
  PREF: 'vex.when.enabled',
  PENDING: 'vex.when.pending',    // [{ id, cond, target, text, place, at }]
  FEATURE: 'snooze-syntax',
  GAME_DELAY_MS: 10 * 60 * 1000,
  MAX_PENDING: 50,
  DAYS: { sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3, thursday: 4, thu: 4, thur: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6 },
  MONTHS: { jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11 },
  NUM: { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20, thirty: 30 },
  PART: { morning: 9, noon: 12, midday: 12, afternoon: 14, evening: 19, tonight: 19, night: 21, midnight: 0 },
  KINDS: ['tab', 'page', 'story', 'reminder', 'task', 'clip', 'mail'],

  enabled() { return VexPlanKit.flag(this.PREF); },
  setEnabled(on) { return VexPlanKit.setFlag(this.PREF, on); },

  // ---- the parser (pure) --------------------------------------------------------------
  _at(base, h, m = 0) { const d = new Date(base); d.setHours(h, m, 0, 0); return d; },
  _fmt(ms) {
    try { return new Date(ms).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
    catch { return new Date(ms).toString(); }
  },

  parse(text, now = Date.now()) {
    let s = ' ' + String(text == null ? '' : text).toLowerCase().replace(/[,!?]/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
    if (!s.trim()) throw new Error('Say when: "fri 17:00 at school", "tomorrow 9", "in 2h", "after the game"');
    const out = { at: 0, label: '', place: '', cond: '', timeGiven: false };
    const cut = (re) => { const m = re.exec(s); if (m) s = (s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length)).replace(/\s+/g, ' '); return m; };

    // A condition instead of a clock.
    if (cut(/\b(?:after|when|once)\s+(?:the|my|i(?:'m| am)? done with)?\s*(?:game|games|gaming|match|raid|round)(?:\s+(?:ends|is over|finishes|is done))?\b/)) {
      out.cond = 'game-end';
      out.label = 'after the game (about ' + this.GAME_DELAY_MS / 60000 + ' minutes after Game mode ends)';
      const pl = / (?:at|@) ([a-z][a-z' -]{0,28}) $/.exec(s);
      if (pl) out.place = pl[1].trim();
      return out;
    }

    // A place: "at school". Not a time: "at 5", "at noon", "at morning".
    const pm = / (?:at|@) (?!\d)([a-z][a-z' -]{0,28}) $/.exec(s);
    if (pm && !this.PART[pm[1].trim()] && !this.DAYS[pm[1].trim()] && !/^(tomorrow|today|tonight|next|the)\b/.test(pm[1].trim())) {
      out.place = pm[1].trim();
      s = s.slice(0, pm.index) + ' ';
    }

    // Relative: "in 45 min", "in 2h", "in three days".
    let m = /^ in (\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty) ?(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|wk|week|weeks) $/.exec(s);
    if (m) {
      const n = /^\d+$/.test(m[1]) ? Number(m[1]) : this.NUM[m[1]];
      const unit = /^m/.test(m[2]) ? 60000 : /^h/.test(m[2]) ? 3600000 : /^d/.test(m[2]) ? 86400000 : 7 * 86400000;
      if (!(n > 0) || n > 1000) throw new Error('"in ' + m[1] + ' ' + m[2] + '" is not a time I can use');
      out.at = now + n * unit;
      out.label = this._fmt(out.at);
      return out;
    }

    // A clock time.
    let hour = null, min = 0;
    const setClock = (h, mi, ap) => {
      h = Number(h); mi = mi == null ? 0 : Number(mi);
      if (ap === 'pm' && h < 12) h += 12;
      if (ap === 'am' && h === 12) h = 0;
      if (h > 23 || mi > 59) throw new Error('"' + h + ':' + String(mi).padStart(2, '0') + '" is not a time of day');
      hour = h; min = mi; out.timeGiven = true;
    };
    if ((m = cut(/ (\d{1,2})[:.](\d{2}) ?(am|pm)? /))) setClock(m[1], m[2], m[3]);
    else if ((m = cut(/ (\d{1,2}) ?(am|pm) /))) setClock(m[1], 0, m[2]);
    else if ((m = cut(/ at (\d{1,2}) /))) { const h = Number(m[1]); setClock(h < 7 && /evening|afternoon|night|tonight/.test(s) ? h + 12 : h, 0); }
    else if ((m = cut(/ (today|tonight|tomorrow|tmrw|tmr|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday) (\d{1,2}) $/))) {
      s += m[1] + ' '; setClock(m[2], 0);
    }
    let part = null;
    for (const w of Object.keys(this.PART)) if (new RegExp(' ' + w + ' ').test(s)) { part = w; break; }
    if (part && hour == null) { hour = this.PART[part]; min = 0; out.timeGiven = true; }

    // A day.
    const todayStart = VexPlanKit.startOfDay(now);
    let day = null;
    const nextWeekday = (wd, skipToday = false) => {
      const base = new Date(todayStart);
      for (let i = skipToday ? 1 : 0; i < 8; i++) {
        const d = new Date(base); d.setDate(base.getDate() + i);
        if (d.getDay() !== wd) continue;
        // The same weekday today only counts while its time is still ahead.
        if (i === 0) { const at = this._at(d, hour == null ? 9 : hour, min); if (at.getTime() <= now) continue; }
        return d.getTime();
      }
      return null;
    };
    if (/ (day after tomorrow) /.test(s)) day = VexPlanKit.addDays(todayStart, 2);
    else if (/ (tomorrow|tmrw|tmr) /.test(s)) day = VexPlanKit.addDays(todayStart, 1);
    else if (/ (today|tonight|this evening|this afternoon|this morning) /.test(s)) day = todayStart;
    else if (/ next week /.test(s)) { day = nextWeekday(1, true); if (hour == null) { hour = 9; min = 0; } }
    else if (/ next month /.test(s)) { const d = new Date(todayStart); d.setMonth(d.getMonth() + 1, 1); day = d.getTime(); }
    else if (/ (weekend|this weekend) /.test(s)) { day = nextWeekday(6); if (hour == null) { hour = 10; min = 0; } }
    else if ((m = / (\d{4}-\d{2}-\d{2}) /.exec(s))) { day = VexPlanKit.parseIso(m[1]); if (Number.isNaN(day)) throw new Error('"' + m[1] + '" is not a real day'); }
    else if ((m = new RegExp(' (' + Object.keys(this.MONTHS).join('|') + ') (\\d{1,2})(?:st|nd|rd|th)? ').exec(s) || null) || (m = new RegExp(' (\\d{1,2})(?:st|nd|rd|th)? (' + Object.keys(this.MONTHS).join('|') + ') ').exec(s))) {
      const monthWord = this.MONTHS[m[1]] != null ? m[1] : m[2];
      const dayNum = Number(this.MONTHS[m[1]] != null ? m[2] : m[1]);
      const nowD = new Date(now);
      let d = new Date(nowD.getFullYear(), this.MONTHS[monthWord], dayNum);
      if (d.getMonth() !== this.MONTHS[monthWord]) throw new Error('That date does not exist');
      if (d.getTime() < todayStart) d = new Date(nowD.getFullYear() + 1, this.MONTHS[monthWord], dayNum);
      day = d.getTime();
    } else {
      const wk = Object.keys(this.DAYS).find(w => new RegExp(' (?:next )?' + w + ' ').test(s));
      if (wk) {
        day = nextWeekday(this.DAYS[wk]);
        if (day == null) throw new Error('Could not place "' + wk + '"');
      }
    }

    if (day == null) {
      if (hour == null) throw new Error('"' + String(text).trim() + '" has no day or time I understand. Try "fri 17:00", "tomorrow 9", "in 2h" or "after the game".');
      const t = this._at(todayStart, hour, min);
      if (t.getTime() <= now) t.setDate(t.getDate() + 1);
      out.at = t.getTime();
    } else {
      if (hour == null) { hour = 9; min = 0; }
      out.at = this._at(day, hour, min).getTime();
    }
    if (out.at <= now) throw new Error('That time has already passed: ' + this._fmt(out.at));
    out.label = this._fmt(out.at);
    return out;
  },

  // ---- applying ----------------------------------------------------------------------------
  async apply(target, text, now = Date.now()) {
    if (!this.enabled()) throw new Error('The when box is switched off in Settings');
    if (!target || !this.KINDS.includes(target.kind)) throw new Error('Cannot put this off: choose a tab, page, reminder, task, clip or mail');
    const w = this.parse(text, now);
    w.raw = String(text);
    if (w.cond) return this._hold(target, text, w, now);
    return this._do(target, w.at, w, now);
  },

  async _do(target, at, w, now = Date.now()) {
    if (typeof VexSnooze === 'undefined') throw new Error('Snooze is not loaded');
    const note = w.place ? 'at ' + w.place : '';
    const k = target.kind;
    let done;
    if (k === 'tab') {
      if (typeof TabSnooze === 'undefined') throw new Error('Tab snooze is not loaded');
      done = VexSnooze.snoozeTab(target.tabId, at, now);
      if (note) { const list = VexSnooze._read(); const e = list.find(x => x.id === done.id); if (e) { e.note = note; VexSnooze._write(list); } }
    } else if (k === 'page' || k === 'story') {
      done = VexSnooze.add(k, { title: target.title, url: target.url, ref: target.url, note }, at, now);
    } else if (k === 'reminder') {
      done = await VexSnooze.snoozeReminder({ id: target.id, message: target.message + (note ? ' (' + note + ')' : '') }, at, now);
    } else if (k === 'mail') {
      done = VexSnooze.add('mail', { title: target.title, ref: target.ref, note }, at, now);
    } else if (k === 'task') {
      const before = VexPlanKit.setTaskDate(target.task, VexPlanKit.isoDay(at));
      done = { id: 'task', before };
      if (w.timeGiven) await this._remind(target.task.plain + (note ? ' (' + note + ')' : ''), at);
    } else {
      done = await this._remind(String(target.text || '').slice(0, 500) + (note ? ' (' + note + ')' : ''), at);
    }
    if (typeof VexLedger !== 'undefined') {
      VexLedger.note({
        feature: this.FEATURE, what: 'Put off a ' + k + ' until ' + this._fmt(at) + (note ? ', ' + note : ''),
        why: 'You typed "' + String(w.raw || '').slice(0, 60) + '" in the when box.',
        undo: k === 'task' ? { kind: 'when-task', noteId: target.task.noteId, index: target.task.index, plain: target.task.plain.slice(0, 160), was: done.before || '', now: VexPlanKit.isoDay(at) } : null,
        stop: { kind: 'when-off' },
      });
    }
    return { at, label: this._fmt(at), place: w.place, done };
  },

  async _remind(message, at) {
    if (typeof window === 'undefined' || !window.VexQuickReminder || typeof window.VexQuickReminder.create !== 'function') throw new Error('Reminders are not available here');
    return window.VexQuickReminder.create(message, new Date(at));
  },

  // "After the game": kept until Game mode ends.
  _hold(target, text, w, now) {
    const snap = this._snapshot(target);
    const list = VexPlanKit.readJson(this.PENDING, []);
    if (!Array.isArray(list)) throw new Error('The list of things waiting for the game could not be read');
    if (list.length >= this.MAX_PENDING) throw new Error('Too many things are waiting for the game already (' + this.MAX_PENDING + ')');
    list.push({ id: 'wh_' + now.toString(36) + Math.random().toString(36).slice(2, 6), cond: w.cond, target: snap, place: w.place, text: String(text).slice(0, 80), at: now });
    VexPlanKit.writeJson(this.PENDING, list);
    if (typeof VexLedger !== 'undefined') {
      VexLedger.note({ feature: this.FEATURE, what: 'Kept a ' + target.kind + ' for after the game', why: 'You typed "' + String(text).slice(0, 60) + '" in the when box.', undo: { kind: 'when-unhold', id: list[list.length - 1].id }, stop: { kind: 'when-off' } });
    }
    return { at: 0, label: w.label, place: w.place, held: true };
  },
  // Only what is needed later, as plain data. An open tab cannot be kept as a tab: it becomes the page.
  _snapshot(t) {
    if (t.kind === 'tab') {
      if (typeof TabManager === 'undefined') throw new Error('Tabs are not loaded');
      const tab = TabManager.tabs.find(x => x.id === t.tabId);
      if (!tab) throw new Error('That tab is not open any more');
      if (!/^https?:/i.test(tab.url || '')) throw new Error('Only a web page can be put off');
      return { kind: 'page', title: tab.title || tab.url, url: tab.url };
    }
    if (t.kind === 'task') return { kind: 'task', task: { noteId: t.task.noteId, index: t.task.index, plain: t.task.plain } };
    if (t.kind === 'page' || t.kind === 'story') return { kind: t.kind, title: String(t.title || t.url || '').slice(0, 200), url: String(t.url || '') };
    if (t.kind === 'reminder') return { kind: 'reminder', id: t.id, message: String(t.message || '').slice(0, 300) };
    if (t.kind === 'mail') return { kind: 'mail', title: String(t.title || '').slice(0, 200), ref: String(t.ref || '') };
    return { kind: 'clip', text: String(t.text || '').slice(0, 500) };
  },
  pending() {
    const l = VexPlanKit.readJson(this.PENDING, []);
    return Array.isArray(l) ? l : [];
  },
  unhold(id) {
    const list = this.pending();
    const next = list.filter(x => x.id !== id);
    if (next.length === list.length) throw new Error('That is no longer waiting for the game');
    VexPlanKit.writeJson(this.PENDING, next);
  },
  // Game mode ended: everything waiting for it comes back in GAME_DELAY_MS.
  async release(now = Date.now()) {
    const list = this.pending().filter(x => x.cond === 'game-end');
    if (!list.length) return 0;
    const at = now + this.GAME_DELAY_MS;
    const failed = [];
    for (const item of list) {
      try { await this._do(item.target, at, { place: item.place, timeGiven: false, raw: item.text }, now); this.unhold(item.id); }
      catch (err) { failed.push(item.id); window.VexProblems?.note('When box', 'Could not bring back something that waited for the game', err); }
    }
    return list.length - failed.length;
  },

  // ---- the box ------------------------------------------------------------------------------------
  // The thing in front of you: the active tab.
  currentTarget() {
    if (typeof TabManager === 'undefined' || typeof TabManager.getActiveTab !== 'function') throw new Error('Tabs are not loaded');
    const tab = TabManager.getActiveTab();
    if (!tab) throw new Error('Open a page first');
    return { kind: 'tab', tabId: tab.id };
  },
  // A row of the Wave 1 inbox (js/inbox.js) -> a target.
  fromInboxItem(it) {
    if (!it || !it.id) throw new Error('Choose an inbox row first');
    if (it.url) return { kind: it.source === 'read-later' ? 'story' : 'page', title: it.text, url: it.url };
    return { kind: 'clip', text: (it.source === 'note' ? 'Look at the note: ' : '') + (it.text || '') };
  },

  ask(target) {
    if (!this.enabled()) { window.showToast?.('The when box is switched off in Settings', 'info'); return; }
    if (typeof VexUsage !== 'undefined') VexUsage.touch('snooze-syntax');
    let tgt = target;
    try { tgt = tgt || this.currentTarget(); } catch (err) { window.showToast?.(err.message, 'error'); return; }
    const { body, close } = VexSettingsGroups.dialog({ id: 'vex-when', title: 'Put this off until...', sub: 'Examples: fri 17:00 at school · tomorrow 9 · in 2h · next week · oct 20 · after the game' });
    const input = document.createElement('input');
    input.type = 'text'; input.className = 'set-input'; input.style.width = '100%'; input.placeholder = 'fri 17:00 at school';
    input.setAttribute('aria-label', 'When');
    const read = document.createElement('div');
    read.className = 'vex-platform-note';
    read.setAttribute('aria-live', 'polite');
    read.textContent = 'Type a day, a time, a place or "after the game".';
    const go = VexSettingsGroups.button('Put off', async () => {
      go.disabled = true;
      try { const r = await this.apply(tgt, input.value); window.showToast?.(r.held ? 'Kept for ' + r.label : 'Back ' + r.label, 'info'); close(); }
      catch (err) { read.textContent = err.message; go.disabled = false; }
    }, { primary: true });
    input.addEventListener('input', () => {
      if (!input.value.trim()) { read.textContent = 'Type a day, a time, a place or "after the game".'; return; }
      try { const w = this.parse(input.value); read.textContent = 'Read as: ' + w.label + (w.place ? ' · at ' + w.place : ''); }
      catch (err) { read.textContent = err.message; }
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go.click(); } });
    body.append(input, read, go);
    input.focus();
  },

  // ---- wiring -----------------------------------------------------------------------------------------
  init() {
    if (this._wired) return true;
    this._wired = true;
    if (typeof VexLedger !== 'undefined') {
      VexLedger.registerUndo('when-task', async (t) => { VexPlanKit.setTaskDate({ noteId: t.noteId, index: t.index, plain: t.plain }, t.was || ''); });
      VexLedger.registerUndo('when-unhold', async (t) => { this.unhold(t.id); });
      VexLedger.registerStop('when-off', () => { this.setEnabled(false); });
    }
    document.addEventListener('vex:game-mode', (e) => {
      if (e && e.detail && e.detail.active === false && this.enabled()) {
        this.release().catch(err => window.VexProblems?.note('When box', 'Could not bring back what waited for the game', err));
      }
    });
    return true;
  },

  group(el) {
    el.appendChild(VexSettingsGroups.note('One box that understands "fri 17:00 at school", "tomorrow 9", "in 2h", "next week" and "after the game", and puts off the tab in front of you (or a task, reminder, saved page or mail you point it at). Ctrl+K › Put this off.'));
    el.appendChild(VexSettingsGroups.button('Put the current page off', () => this.ask(), { primary: true }));
  },
};

if (typeof window !== 'undefined') {
  window.VexWhen = VexWhen;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'snooze-syntax', title: 'Put things off (when box)', keywords: 'snooze when tomorrow friday after the game later postpone defer', before: 'about', build: (el) => VexWhen.group(el) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'when-snooze', label: 'Put this off until...', hint: 'One box for tabs, tasks, reminders and mail: "fri 17:00 at school", "after the game"', icon: 'alarm', action: () => VexWhen.ask() });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexWhen };
