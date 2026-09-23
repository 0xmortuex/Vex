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
    for (const fn of [this._remind, this._watch, this._timer, this._alarm, this._timeIn, this._stopwatch, this._freeMemory, this._setting, this._guide]) {
      try { const r = fn.call(this, q); if (r) out.push(r); } catch (err) { /* a parse that failed part-way says so as a result, below */ out.push(this._unreadable(q, err)); }
    }
    return out;
  },

  // === The same sentences, said the way people say them ====================
  //
  // The parsers above expect command-bar shorthand: "timer 25 min". Nobody
  // says that to an assistant. They say "make me a timer for 10 minutes" —
  // and asked that, Vex replied with three paragraphs on how the user could
  // do it themselves, including steps for a button that does not exist. It
  // had the clock, the duration parser and the Windows wake-up all along.
  //
  // The first attempt at this matched sentence TEMPLATES, and templates break
  // on the next sentence: it understood "make a timer for 10 minutes" and not
  // "make ME a timer for 10 minutes", which is the same request with one word
  // in it. So this does not match shapes. It looks for the three things that
  // have to be there — a thing Vex owns, something asking for it, and (for a
  // countdown) a length — anywhere in the sentence, and rebuilds the
  // shorthand from them.
  //
  // It runs before any model is consulted: instant, works with no model
  // loaded, and incapable of inventing a user interface. Anything it does not
  // recognise returns the sentence untouched and the request goes on to the
  // model exactly as before.
  POLITE: /^(hey|hi|hello|ok|okay|please|pls|vex|can you|could you|would you|will you|i want you to|i need you to|i'd like you to|go ahead and|just|for me|now)\b[\s,]*/i,

  // The things Vex owns. `remind` is handled by its own parser, which already
  // understands whole sentences.
  THINGS: /\b(timers?|countdowns?|stopwatch(?:es)?|alarms?|reminders?)\b/i,

  // Something that asks for one. Without one of these, "the timer is wrong" is
  // a remark, not an instruction.
  ASKS: /\b(make|set|start|create|add|put|begin|run|give|do|want|need|launch|open|new)\b/i,

  // A question is not an order, whatever verbs it contains: "how do I make a
  // timer" wants the guide, not a timer.
  QUESTION: /^(how|what|what's|whats|why|where|when|which|who|is|are|does|do i|can i|could i|should i|tell me (?:about|how)|explain)\b/i,

  // "10 minutes", "1h 30", "90s", "25 min", "10:00".
  LENGTH: /\b\d{1,3}:\d{2}(?::\d{2})?\b|\b\d+(?:\.\d+)?\s*(?:hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/gi,

  // The length, as the duration parser wants it. Several parts are kept in
  // order, so "1 hour 30 minutes" survives as one length.
  lengthIn(text) {
    const t = String(text || '');
    const found = t.match(this.LENGTH);
    if (!found || !found.length) return '';
    let out = found.join(' ').replace(/\s+/g, ' ').trim();
    // "1h 30": the duration parser reads a trailing bare number as the next
    // unit down from the last one named, and it has no unit of its own to
    // match on, so it has to be picked up here or half the length is lost.
    const last = found[found.length - 1];
    const after = t.slice(t.lastIndexOf(last) + last.length);
    const bare = after.match(/^\s+(\d+)\s*$/);
    if (bare) out += ' ' + bare[1];
    return out;
  },

  plainly(raw) {
    let t = String(raw || '').trim();
    if (!t) return '';
    let before;
    do { before = t; t = t.replace(this.POLITE, ''); } while (t !== before);
    t = t.replace(/[?!.]+$/, '').trim();
    if (!t) return '';

    // Already shorthand, or a sentence the other parsers read whole.
    if (/^(timer|countdown|alarm|stopwatch|remind me|watch|tell me|let me know|notify me|alert me|ping me|what time)/i.test(t)) {
      return /^countdown\b/i.test(t) ? t.replace(/^countdown/i, 'timer') : t;
    }
    if (this.QUESTION.test(t)) return t;

    const thing = t.match(this.THINGS);
    if (!thing || !this.ASKS.test(t)) return t;
    const noun = thing[1].toLowerCase().replace(/(es|s)$/, '');

    if (noun === 'stopwatch') return 'stopwatch';
    if (noun === 'reminder') {
      // Its own parser reads "remind me …" sentences; hand it everything
      // after the noun, which is where the what and the when live.
      const rest = t.slice(thing.index + thing[1].length).replace(/^\s*(?:for|to|about|at|in|that)\s+/i, '').trim();
      return rest ? 'remind me ' + rest : t;
    }
    if (noun === 'timer' || noun === 'countdown') {
      const length = this.lengthIn(t);
      // No length is not something to guess at: it goes on to the model,
      // which can ask.
      return length ? 'timer ' + length : t;
    }
    // An alarm is a time of day, which its own parser reads: give it
    // everything except the asking and the noun.
    const rest = (t.slice(0, thing.index) + ' ' + t.slice(thing.index + thing[1].length))
      .replace(this.ASKS, ' ')
      .replace(/\b(an?|the|my|me|for|at|to|on|please)\b/gi, ' ')
      .replace(/\s+/g, ' ').trim();
    return rest ? 'alarm ' + rest : t;
  },

  // The one thing Vex can do for this sentence with no model at all, or null.
  // Only a confident result counts: a parser that threw, or one that offered
  // a non-primary suggestion, is not certain enough to act on by itself.
  intent(raw) {
    const plain = this.plainly(raw);
    if (!plain) return null;
    let found = [];
    try { found = this.results(plain) || []; }
    catch (err) { console.warn('[QuickCommands] could not read that:', err.message); return null; }
    // Only things Vex DOES. 'quick-guide' answers "how do I…?" with directions,
    // which is an explanation, not an action — and treating it as one meant a
    // question never reached the guide card, so the "Do it" button on that
    // card, and "you do it" after it, had nothing to act on.
    const SAYS = new Set(['quick-unreadable', 'quick-guide']);
    const hit = found.find(r => r && r.isPrimary && typeof r.action === 'function' && !SAYS.has(r.id));
    return hit || null;
  },

  // tell me when this drops under 300 / watch this page for changes / tell me
  // when it goes down — a page watch on the tab in front (js/page-watch.js).
  _watch(q) {
    const m = q.match(/^(?:tell me|let me know|notify me|alert me|ping me)\s+(?:when|if)\s+(.+)$/i) || q.match(/^watch\s+(?:this|this page|the page|it)\s*(?:for|until|till|when)?\s*(.*)$/i);
    if (!m || typeof PageWatch === 'undefined') return null;
    // On a GitHub run or repository, "when it finishes" / "when there is a
    // new release" is asked of GitHub rather than read off the page.
    const tab = typeof TabManager !== 'undefined' ? TabManager.tabs.find(t => t.id === TabManager.activeTabId) : null;
    const gh = tab && GitHubWatch.parse(tab.url);
    if (gh && /\b(finish|done|complete|pass|fail|build|release|version|out)/i.test(m[1] || '')) {
      return {
        id: 'quick-watch-github', icon: 'eye', isPrimary: true,
        label: gh.kind === 'run' ? 'Tell me when this run finishes' : 'Tell me when ' + gh.owner + '/' + gh.repo + ' has a new release',
        hint: 'Asked of GitHub every ' + (gh.kind === 'run' ? '2 minutes' : '30 minutes') + ', told on your desktop',
        action: () => {
          try { const w = GitHubWatch.add(tab.url); window.showToast?.('Watching the ' + GitHubWatch.describe(w)); GitHubWatch.checkDue(); }
          catch (err) { window.showToast?.((err && err.message) || 'Could not watch it', 'error'); throw err; }
        },
      };
    }
    const rule = PageWatch.parseWhen(m[1] || 'changes');
    return {
      id: 'quick-watch', icon: 'eye', isPrimary: true,
      label: 'Watch this page: ' + PageWatch.describeRule(rule),
      hint: 'Checks every 15 minutes in the background and tells you',
      action: () => {
        try { const r = PageWatch.watchCurrent(m[1] || 'changes'); window.showToast?.('Watching ' + r.said); }
        catch (err) { window.showToast?.((err && err.message) || 'Could not watch this page', 'error'); throw err; }
      },
    };
  },

  // turn on streamer mode / turn off mouse gestures / set search engine to bing
  // — any switch or dropdown in Settings, found by its label, and always
  // asked about before it changes (js/settings-control.js).
  _setting(q) {
    const req = VexSettingsControl.parseRequest(q);
    if (!req) return null;
    let plan;
    try { plan = VexSettingsControl.plan(req); }
    catch (err) {
      // Words that name no setting are some other command, not a mistake.
      if (/^No setting called/.test(err.message)) return null;
      throw err;
    }
    return {
      id: 'quick-setting', icon: 'settings', isPrimary: true,
      label: plan.same ? plan.sentence : plan.sentence.replace(/\?$/, ''),
      hint: plan.same ? 'Nothing to change' : 'Asks before changing it · Settings',
      action: async () => {
        if (plan.same) return;
        try { const r = await VexSettingsControl.apply(req); window.showToast?.(r.message); }
        catch (err) { window.showToast?.((err && err.message) || 'Could not change that setting', 'error'); throw err; }
      },
    };
  },

  // "how do i save a page for later", "can vex block ads", "is there a way to
  // record my screen" — answered from Vex's own feature list (js/vex-guide.js),
  // with the thing itself one press away.
  _guide(q) {
    if (typeof VexGuide === 'undefined' || !VexGuide.isAbout(q)) return null;
    const a = VexGuide.answer(q);
    if (!a.found) {
      return { id: 'quick-guide-none', icon: 'info', isPrimary: false, label: 'Vex has nothing for that yet', hint: a.headline, action: () => {} };
    }
    return {
      id: 'quick-guide', icon: 'sparkles', isPrimary: true,
      label: VexFeatures.nameOf(a.entry),
      hint: a.steps.join(' · ') + (a.others.length ? ' · also: ' + a.others.join(', ') : ''),
      action: () => { VexGuide.run(a.entry); },
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
        } catch (err) { window.showToast?.((err && err.message) || 'Could not set the reminder', 'error'); throw err; }
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
        catch (err) { window.showToast?.((err && err.message) || 'Could not start the timer', 'error'); throw err; }
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
        } catch (err) { window.showToast?.((err && err.message) || 'Could not set the alarm', 'error'); throw err; }
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
