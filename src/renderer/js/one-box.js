// === One box: more of what you can say to Ctrl+K ============================
//
// js/quick-commands.js already turns "remind me to call Dana tomorrow 9am",
// "timer 25 min" and "alarm 7am weekdays" into the reminders, clock and alarm
// Vex has. This adds the lines it does not read, and one it reads wrongly:
//
//   note: idea for the trip           a new note (never touches an old one)
//   open GitHub PRs / issues / ...    that GitHub page, in a tab
//   I have 20 minutes                 the Read Later links that fit (Reading queue)
//   timeline / what did I do ...      the session timeline
//   are my bookmarks still alive      the living-bookmarks list
//   remind me to call Sam at 5        "5" is the next 5 o'clock, not 5 in the
//                                     morning tomorrow (the existing parser
//                                     reads a bare "5" as 05:00)
//
// Every row says what it understood before anything runs; Enter runs it. It
// only ever ADDS or OPENS: nothing here deletes, clears, closes, overwrites or
// changes a setting, and a sentence that begins with such a word is left to
// the ordinary commands.
//
// How it is attached: install() wraps VexQuickCommands.results once (from
// js/timeline-actions.js), so command.js, the AI panel's "do it directly" and
// the agent's command lookup all see the new rows with no edit to any of them.
const VexOneBox = {
  // A line starting with one of these is never read as an order here.
  DESTRUCTIVE: /^\s*(?:delete|remove|clear|erase|wipe|close|kill|quit|exit|uninstall|reset|forget|empty|purge|disable|turn off|stop|cancel)\b/i,

  GITHUB: {
    pulls: { url: 'https://github.com/pulls', words: 'your pull requests' },
    issues: { url: 'https://github.com/issues', words: 'your issues' },
    notifications: { url: 'https://github.com/notifications', words: 'your notifications' },
    actions: { url: 'https://github.com/actions', words: 'GitHub Actions' },
    stars: { url: 'https://github.com/stars', words: 'your stars' },
    home: { url: 'https://github.com/', words: 'GitHub' },
  },

  // "5" → "17:00" when it is 14:00; "5" → "05:00" tomorrow when it is 23:00 and
  // there is no later 5. `now` is a Date. Only a bare hour 1-12 is touched.
  nextOccurrence(hour, minute, now = new Date()) {
    const cands = hour === 12 ? [0, 12] : [hour, hour + 12];
    const base = new Date(now);
    for (let day = 0; day < 2; day++) {
      for (const h of cands) {
        const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + day, h, minute, 0, 0);
        if (d.getTime() > now.getTime() + 60000) return d;
      }
    }
    return null;
  },

  // → { text, note } or null. `text` is the same sentence with a 24-hour time.
  rewriteBareHour(raw, now = new Date()) {
    const s = String(raw == null ? '' : raw).trim();
    let m = s.match(/^(remind(?:\s+me)?\s+.+?)\s+at\s+(\d{1,2})(?::(\d{2}))?$/i);
    let build;
    if (m) build = (hhmm) => m[1] + ' at ' + hhmm;
    else {
      m = s.match(/^(remind(?:\s+me)?)\s+at\s+(\d{1,2})(?::(\d{2}))?\s+(to\s+.+)$/i);
      if (!m) return null;
      const tail = m[4];
      build = (hhmm) => m[1] + ' ' + tail + ' at ' + hhmm;
    }
    const hour = Number(m[2]), minute = m[3] == null ? 0 : Number(m[3]);
    if (hour < 1 || hour > 12 || minute > 59) return null;
    // "5:00 pm" was not caught above (no am/pm in the pattern), so what is
    // here has no suffix: it is the bare form.
    const when = this.nextOccurrence(hour, minute, now);
    if (!when) return null;
    const hhmm = String(when.getHours()).padStart(2, '0') + ':' + String(when.getMinutes()).padStart(2, '0');
    const spoken = m[2] + (m[3] == null ? '' : ':' + m[3]);
    return { text: build(hhmm), note: 'Read "' + spoken + '" as ' + hhmm + ' (the next ' + spoken + (m[3] == null ? " o'clock" : '') + ')', at: when };
  },

  // The one thing a line means, as plain data, or null. Pure.
  understand(raw, { now = new Date(), githubUser = '' } = {}) {
    const q = String(raw == null ? '' : raw).trim().replace(/\s+/g, ' ');
    if (!q || q.length > 600 || this.DESTRUCTIVE.test(q)) return null;
    let m;

    // note: idea / jot down the thing / add a note that …
    m = q.match(/^(?:note|jot(?: down)?|new note|add (?:a )?note|make (?:a )?note|write down)\s*[:\-]\s*(.+)$/i)
      || q.match(/^(?:jot down|write down|add (?:a )?note(?: that| to)?|make (?:a )?note(?: that| to)?)\s+(.+)$/i);
    if (m) {
      const text = m[1].trim();
      if (text) return { kind: 'note', text, summary: 'A new note: “' + (text.length > 60 ? text.slice(0, 59) + '…' : text) + '”' };
    }

    // open github prs / show my github issues / go to github notifications
    m = q.match(/^(?:open|show|go to|take me to|see)\s+(?:my\s+)?git\s?hub(?:'s)?\s*(.*)$/i)
      || q.match(/^(?:open|show|go to|see)\s+(?:my\s+)?(pull requests?|prs?|issues|notifications)\s+(?:on|in|at)\s+git\s?hub$/i);
    if (m) {
      const w = (m[1] || '').toLowerCase().trim();
      let key = 'home';
      if (/^(?:pull requests?|prs?|pulls?)\b/.test(w)) key = 'pulls';
      else if (/^issues?\b/.test(w)) key = 'issues';
      else if (/^notifications?\b|^inbox\b/.test(w)) key = 'notifications';
      else if (/^actions?\b|^workflows?\b/.test(w)) key = 'actions';
      else if (/^stars?\b|^starred\b/.test(w)) key = 'stars';
      else if (/^(?:repos?|repositories|profile)\b/.test(w)) {
        if (!githubUser) return { kind: 'error', message: 'Set your GitHub username in Settings first to open your repositories' };
        const url = 'https://github.com/' + encodeURIComponent(githubUser) + (/^profile/.test(w) ? '' : '?tab=repositories');
        return { kind: 'open', url, summary: 'Open your GitHub ' + (/^profile/.test(w) ? 'profile' : 'repositories') };
      } else if (w) return null;      // "open github desktop" is not a GitHub page
      return { kind: 'open', url: this.GITHUB[key].url, summary: 'Open ' + this.GITHUB[key].words + ' on GitHub' };
    }

    // I have 20 minutes / I've got half an hour / something to read for 15 min
    if (/^(?:i have|i've got|i got|got|have|spare|something to read(?: for)?|what (?:can|should) i read(?: in)?)\b/i.test(q)) {
      const rq = typeof ReadingQueue !== 'undefined' ? ReadingQueue : (typeof require === 'function' ? require('./reading-queue.js').ReadingQueue : null);
      const minutes = rq ? rq.parseMinutes(q) : 0;
      if (minutes > 0 && minutes <= 600) return { kind: 'minutes', minutes, summary: 'Pick what fits in ' + (rq ? rq.fmt(minutes) : minutes + ' min') + ' from Read Later' };
    }

    // timeline
    m = q.match(/^(?:show |open )?(?:my )?(?:session )?timeline(?: (?:for )?(?:this |last )?(week|day|today))?$/i)
      || q.match(/^what did i do(?: (?:today|yesterday|this week|last week))?\??$/i);
    if (m) {
      const week = /week/i.test(q);
      return { kind: 'timeline', by: week ? 'week' : 'day', summary: 'Open your timeline, by ' + (week ? 'week' : 'day') };
    }

    // living bookmarks
    if (/^(?:are my bookmarks (?:still )?(?:alive|ok|fine|working)|check my bookmarks|(?:show |open )?(?:my )?(?:living|alive|dead|changed) bookmarks)\??$/i.test(q)) {
      return { kind: 'livemarks', summary: 'Open your living bookmarks' };
    }
    return null;
  },

  // ---- doing it ---------------------------------------------------------------
  // A new note, in the format Notes keeps. Never edits an existing note.
  addNote(text) {
    const body = String(text || '').trim();
    if (!body) throw new Error('A note needs some text');
    const KEY = 'vex.notes';
    let notes = [];
    try { notes = JSON.parse(localStorage.getItem(KEY) || '[]') || []; } catch { notes = []; }
    if (!Array.isArray(notes)) notes = [];
    const first = body.split(/\n/)[0];
    const now = new Date().toISOString();
    const id = typeof vexId === 'function' ? vexId('note_') : 'note_' + Date.now().toString(36);
    const note = { id, title: first.length > 60 ? first.slice(0, 59) + '…' : first, content: body, pinned: false, createdAt: now, updatedAt: now };
    notes.unshift(note);
    localStorage.setItem(KEY, JSON.stringify(notes));
    if (typeof NotesPanel !== 'undefined' && Array.isArray(NotesPanel.notes)) {
      NotesPanel.notes = notes;
      try { NotesPanel.renderList?.(); } catch { /* the panel is not drawn */ }
    }
    return note;
  },

  _openUrl(url) {
    const tab = typeof TabManager !== 'undefined' ? TabManager.getActiveTab() : null;
    if (tab && typeof isStartPage === 'function' && isStartPage(tab.url) && typeof WebviewManager !== 'undefined') WebviewManager.navigate(url);
    else TabManager.createTab(url, true);
  },

  // One command-bar row for a thing understood.
  row(u) {
    if (!u) return null;
    if (u.kind === 'error') return { id: 'quick-onebox-error', icon: 'warning', isPrimary: false, label: u.message, hint: 'One box', action: () => {} };
    const understood = 'Understood as: ' + u.summary;
    if (u.kind === 'note') {
      return {
        id: 'quick-onebox-note', icon: 'note', isPrimary: true, label: 'Note: ' + u.text, hint: understood + ' · Enter adds it to Notes',
        action: () => { VexOneBox.addNote(u.text); window.showToast?.('Added to Notes'); return 'Added a note: ' + u.text; },
      };
    }
    if (u.kind === 'open') {
      return {
        id: 'quick-onebox-open', icon: 'globe', isPrimary: true, label: u.summary, hint: understood + ' · ' + u.url,
        action: () => { VexOneBox._openUrl(u.url); return u.summary + '.'; },
      };
    }
    if (u.kind === 'minutes') {
      return {
        id: 'quick-onebox-minutes', icon: 'book', isPrimary: true, label: u.summary, hint: understood + ' · Enter shows the links, nothing opens by itself',
        action: () => {
          if (typeof ReadingQueue === 'undefined') throw new Error('The reading queue is not available in this window');
          ReadingQueue.open({ minutes: u.minutes });
          const r = ReadingQueue.suggest(u.minutes);
          return r.picks.length ? r.picks.length + ' link' + VexPlural.s(r.picks.length) + ' fit in ' + u.minutes + ' minutes (' + r.total + ' min).' : 'Nothing measured fits in ' + u.minutes + ' minutes.';
        },
      };
    }
    if (u.kind === 'timeline') {
      return {
        id: 'quick-onebox-timeline', icon: 'history', isPrimary: true, label: u.summary, hint: understood,
        action: () => { if (typeof VexTimeline === 'undefined') throw new Error('The timeline is not available in this window'); VexTimeline.open({ by: u.by }); return 'Opened the timeline.'; },
      };
    }
    if (u.kind === 'livemarks') {
      return {
        id: 'quick-onebox-livemarks', icon: 'bookmark', isPrimary: true, label: u.summary, hint: understood,
        action: () => { if (typeof SmartBookmarks === 'undefined') throw new Error('Living bookmarks are not available in this window'); SmartBookmarks.open(); return 'Opened your living bookmarks.'; },
      };
    }
    return null;
  },

  results(raw) {
    let user = '';
    try { user = (localStorage.getItem('vex.githubUsername') || '').trim(); } catch { user = ''; }
    const u = this.understand(raw, { githubUser: user });
    const r = this.row(u);
    return r ? [r] : [];
  },

  // Wrap VexQuickCommands.results once.
  install(qc) {
    const target = qc || (typeof VexQuickCommands !== 'undefined' ? VexQuickCommands : null);
    if (!target || target._oneBoxInstalled || typeof target.results !== 'function') return false;
    const original = target.results.bind(target);
    target.results = function (raw) {
      const fixed = VexOneBox.rewriteBareHour(raw);
      let base = original(fixed ? fixed.text : raw);
      if (fixed) {
        base = base.map(r => (r && r.id === 'quick-remind' ? { ...r, hint: (r.hint ? r.hint + ' · ' : '') + fixed.note } : r));
      }
      let mine = [];
      try { mine = VexOneBox.enabled() ? VexOneBox.results(raw) : []; }
      catch (err) { window.VexProblems?.note('One box', 'Could not read that line', err); }
      return [...mine, ...base];
    };
    target._oneBoxInstalled = true;
    return true;
  },

  PREF_KEY: 'vex.oneBox.enabled',
  enabled() { try { return localStorage.getItem(this.PREF_KEY) !== 'false'; } catch { return true; } },
  setEnabled(on) { localStorage.setItem(this.PREF_KEY, on ? 'true' : 'false'); },
};

if (typeof window !== 'undefined') window.VexOneBox = VexOneBox;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexOneBox };
