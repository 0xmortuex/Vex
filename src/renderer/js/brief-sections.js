// === Morning Brief: the sections ============================================
//
// Each section reads something Vex already holds and answers a small display
// payload (see js/brief.js). Nothing here makes a new kind of request:
//   AI news       the stories the AI-news poller already fetched
//   Mail          the read-only inbox bridge the Mail sheet uses; opt-in, and
//                 the optional summary only ever goes to the LOCAL model
//   GitHub        watched runs and releases (js/github-watch.js)
//   Schedule      reminders, scheduled tasks and subscribed calendars
//   Watched       page watches that changed
//   Release radar patch notes for the games in Game mode
//   Resume        the last saved session, one click to open
//   Saved         Read Later and the clips folder, if one is chosen
//   Numbers       yesterday: pages, sites, blocked trackers, reminders
//   Focus         the longest free stretch left in today
// There is no weather section: the New Tab page already has its own weather
// card with its own opt-in location, and a second one would ask twice.
const BriefSections = {
  GH_LOG_KEY: 'vex.brief.ghEvents',
  DAY: 24 * 3600 * 1000,

  // ---- small helpers (pure) ----------------------------------------------
  hhmm(ms) { const d = new Date(ms); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); },
  dayKey(ms) { const d = new Date(ms); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); },
  startOfDay(ms) { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); },
  plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); },
  // "today 09:30", "yesterday 21:10", or a short date.
  when(ms, now) {
    if (!ms) return '';
    const day = this.startOfDay(now);
    if (ms >= day) return this.hhmm(ms);
    if (ms >= day - this.DAY) return 'yesterday ' + this.hhmm(ms);
    return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  },
  minutesLabel(m) {
    const h = Math.floor(m / 60), r = m % 60;
    return h ? (r ? h + ' h ' + r + ' min' : h + ' h') : m + ' min';
  },

  // The longest free stretch between now and `endHour`, around what is on.
  // busy: [{ at, end?, minutes? }]. An item with no end holds `minutes`
  // (default 30) from its start. Returns null when the day is over.
  focusSuggestion(busy, now, { endHour = 18, minGap = 45, defaultMinutes = 30 } = {}) {
    const MIN = 60000;
    const end = new Date(now); end.setHours(endHour, 0, 0, 0);
    if (now >= end.getTime() - 15 * MIN) return null;
    const start = Math.ceil(now / (5 * MIN)) * 5 * MIN;
    const spans = (busy || [])
      .filter(b => b && Number.isFinite(b.at))
      .map(b => ({ from: b.at, to: Number.isFinite(b.end) && b.end > b.at ? b.end : b.at + (b.minutes || defaultMinutes) * MIN, text: b.text || '' }))
      .filter(s => s.to > start && s.from < end.getTime())
      .sort((a, c) => a.from - c.from);
    let cursor = start;
    let best = null;
    for (const s of spans) {
      if (s.from - cursor >= minGap * MIN && (!best || s.from - cursor > best.to - best.from)) best = { from: cursor, to: s.from };
      cursor = Math.max(cursor, s.to);
    }
    if (end.getTime() - cursor >= minGap * MIN && (!best || end.getTime() - cursor > best.to - best.from)) best = { from: cursor, to: end.getTime() };
    const next = spans.find(s => s.to > start) || null;
    return { best, next: next ? { at: next.from, text: next.text } : null, empty: spans.length === 0, minutes: best ? Math.round((best.to - best.from) / MIN) : 0 };
  },

  // Mail, summarised by counts: unread, who, what. Pure.
  mailDigest(account, inbox, triage) {
    const sorted = triage.sort(inbox.messages || [], { unreadOnly: true });
    const people = [...sorted.needs, ...sorted.look];
    const bySender = new Map();
    for (const m of people) {
      const f = m.from || {};
      const who = f.name || f.address || 'Someone';
      bySender.set(who, (bySender.get(who) || 0) + 1);
    }
    const senders = [...bySender.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => n);
    return {
      label: account.email || account.name || 'Mail',
      unseen: inbox.unseen || 0,
      needs: sorted.needs.length, look: sorted.look.length, bulk: sorted.bulk.length,
      senders,
      subjects: people.slice(0, 3).map(m => ({ text: m.subject || '(no subject)', sub: (m.from || {}).name || (m.from || {}).address || '' })),
    };
  },

  // What a local model is given: counts, sender names and subjects. No bodies.
  mailPrompt(digests) {
    const lines = digests.map(d => d.label + ': ' + d.unseen + ' unread, ' + d.needs + ' need a reply. From ' + (d.senders.join(', ') || 'no one in particular') + '. Subjects: ' + (d.subjects.map(s => s.text).join(' | ') || 'none'));
    return 'Summarise my unread mail in one or two plain sentences, saying what needs me first. Use only these facts and invent nothing:\n\n' + lines.join('\n');
  },

  // A model's reply: plain text, or {"reply": "..."} / {"summary": "..."}.
  plainReply(raw) {
    let s = String(raw == null ? '' : raw).trim();
    if (s.startsWith('{')) { try { const o = JSON.parse(s); s = String(o.reply || o.summary || o.text || o.message || '').trim(); } catch { /* it was prose that starts with a brace */ } }
    return s.slice(0, 500);
  },

  // GitHub announcements of the last day, kept as they are told (the watch
  // that told them removes itself once a run completes, so nothing else
  // remembers "that build failed").
  ghEvents(now = Date.now()) {
    try {
      const a = JSON.parse(localStorage.getItem(this.GH_LOG_KEY) || '[]');
      return (Array.isArray(a) ? a : []).filter(e => e && e.at && now - e.at < this.DAY);
    } catch { return []; }
  },
  recordGh(detail, now = Date.now()) {
    if (!detail || !detail.text) return;
    const text = String(detail.text).slice(0, 200);
    const keep = this.ghEvents(now).filter(e => e.text !== text);
    keep.unshift({ text, url: /^https?:\/\//i.test(String(detail.url || '')) ? String(detail.url) : '', at: now, failed: /\b(failed|timed out)\b/i.test(text) });
    try { localStorage.setItem(this.GH_LOG_KEY, JSON.stringify(keep.slice(0, 20))); } catch { /* storage unavailable: the brief just will not remember it */ }
  },

  // ---- registration ------------------------------------------------------
  registerAll(brief) {
    const B = this;
    const snapOf = (ctx) => ctx.snap || {};

    brief.register({
      id: 'ai-news', title: 'AI news', icon: 'newspaper', order: 10, maxItems: 5,
      build(ctx) {
        if (typeof AINews === 'undefined') return { hint: 'AI news is not loaded in this window.' };
        if (!AINews.prefs().enabled) return { hint: 'AI news is off. Turn it on in Settings › AI news to see the top stories here.' };
        const fresh = AINews.list().filter(i => !i.read && (i.publishedAt || i.firstSeenAt || 0) > ctx.now - 36 * 3600 * 1000);
        fresh.sort((a, c) => (c.breaking ? 1 : 0) - (a.breaking ? 1 : 0) || (c.importance || 0) - (a.importance || 0));
        return {
          summary: fresh.length ? B.plural(fresh.length, 'new story', 'new stories') + ' since yesterday' : '',
          items: fresh.slice(0, 5).map(i => ({ text: i.title, sub: i.source || '', url: i.url, badge: i.breaking ? 'Breaking' : '', when: B.when(i.publishedAt || i.firstSeenAt, ctx.now) })),
        };
      },
    });

    brief.register({
      id: 'mail', title: 'Mail', icon: 'mail', order: 20, optIn: true, defaultOn: false, ttlMs: 15 * 60000, maxItems: 8,
      async build(ctx) {
        if (!(window.vex && window.vex.mail)) return { hint: 'Mail is not available in this window.' };
        const picked = ctx.prefs.mailAccounts;
        if (!picked.length) return { hint: 'Choose which mail accounts to summarise in Settings › Morning Brief. Nothing is read until you do.' };
        const triage = (typeof InboxTriage !== 'undefined') ? InboxTriage : null;
        if (!triage) return { hint: 'The inbox sorter is not loaded in this window.' };
        const call = async (p) => { const r = await p; if (!r || !r.ok) throw new Error((r && r.error) || 'Mail did not answer'); return r.value; };
        const accounts = (await call(window.vex.mail.accounts())).filter(a => picked.includes(a.id));
        if (!accounts.length) return { hint: 'The accounts chosen for the brief are no longer connected. Choose again in Settings › Morning Brief.' };
        const digests = [];
        const failed = [];
        for (const a of accounts) {
          try { digests.push(B.mailDigest(a, await call(window.vex.mail.inbox(a.id, 50)), triage)); }
          catch (err) { failed.push((a.email || a.name) + ': ' + ((err && err.message) || 'failed')); }
        }
        const items = [];
        for (const d of digests) {
          items.push({ text: d.label + ' — ' + B.plural(d.unseen, 'unread message') , sub: d.senders.length ? 'From ' + d.senders.join(', ') : (d.bulk ? 'Only bulk mail' : ''), badge: d.needs ? d.needs + ' to answer' : '' });
          for (const s of d.subjects) items.push({ text: s.text, sub: s.sub });
        }
        let summary = '';
        // The model summary is the one place mail text could travel, so it is
        // asked only when the person allowed it and the feature resolves to a
        // model on this PC (Ollama or on-device).
        if (ctx.prefs.mailAi && digests.length && typeof AIRouter !== 'undefined') {
          try {
            const backend = await AIRouter.resolveBackend('digest');
            if (backend === 'local' || backend === 'ondevice') {
              const res = await AIRouter.callAI('digest', { message: B.mailPrompt(digests) });
              summary = B.plainReply(res && (res.result || res.text || res.message));
            }
          } catch (err) { failed.push('summary: ' + ((err && err.message) || 'unavailable')); }
        }
        if (!summary && digests.length) {
          const total = digests.reduce((n, d) => n + d.unseen, 0);
          summary = B.plural(total, 'unread message') + ' across ' + B.plural(digests.length, 'account');
        }
        if (failed.length && !digests.length) throw new Error(failed.join('; '));
        return { summary, items, note: failed.length ? 'Could not read: ' + failed.join('; ') : '' };
      },
    });

    brief.register({
      id: 'github', title: 'GitHub', icon: 'git', order: 30, maxItems: 6,
      build(ctx) {
        const events = B.ghEvents(ctx.now);
        const watches = (typeof GitHubWatch !== 'undefined') ? GitHubWatch.list() : [];
        if (!events.length && !watches.length) {
          return { hint: 'Nothing is watched. Watch a GitHub Actions run or a repository\'s releases and what happens to them appears here. Notifications and review requests need a GitHub sign-in, which Vex does not have.' };
        }
        const items = events.slice(0, 4).map(e => ({ text: e.text, url: e.url, badge: e.failed ? 'Failed' : '', when: B.when(e.at, ctx.now) }));
        for (const w of watches) {
          if (items.length >= 6) break;
          const name = w.owner + '/' + w.repo;
          if (w.error) items.push({ text: name, sub: w.error, badge: 'Problem' });
          else if (w.kind === 'release' && w.last) items.push({ text: name + ' ' + w.last, sub: 'latest release', url: 'https://github.com/' + name + '/releases' });
          else if (w.kind === 'run') items.push({ text: name + ' run ' + w.id, sub: w.last ? String(w.last) : 'waiting', url: w.url });
        }
        const failed = events.filter(e => e.failed).length;
        return { summary: failed ? B.plural(failed, 'failed run') + ' in the last day' : '', items };
      },
    });

    brief.register({
      id: 'schedule', title: 'Today\'s schedule', icon: 'calendar', order: 40, maxItems: 8,
      build(ctx) {
        const s = snapOf(ctx);
        const rows = [];
        for (const e of s.events || []) rows.push({ key: e.allDay ? -1 : e.at, text: e.text, sub: e.where || 'Calendar', when: e.allDay ? 'All day' : B.hhmm(e.at) });
        for (const r of s.reminders || []) rows.push({ key: r.at == null ? Infinity : r.at, text: r.text, sub: r.site ? 'when you are on ' + r.site : (r.forWork ? 'Work' : 'Reminder'), when: r.at == null ? '' : B.hhmm(r.at), badge: r.overdue ? 'Overdue' : '', url: r.url || '' });
        for (const t of s.tasks || []) rows.push({ key: t.at, text: t.text, sub: 'Scheduled' + (t.action ? ' — ' + t.action : ''), when: B.hhmm(t.at) });
        rows.sort((a, c) => a.key - c.key);
        const over = rows.filter(r => r.badge).length;
        return { summary: rows.length ? B.plural(rows.length, 'thing') + ' today' + (over ? ', ' + over + ' overdue' : '') : '', items: rows.map(({ key, ...r }) => r) };
      },
    });

    brief.register({
      id: 'watched', title: 'Watched pages', icon: 'eye', order: 50, maxItems: 5,
      build(ctx) {
        const s = snapOf(ctx);
        const rows = (s.changed || []).filter(c => !c.radar);
        const items = rows.slice(0, 5).map(c => {
          let sub = '';
          try {
            if (typeof PageWatch !== 'undefined' && typeof PageWatchDiff !== 'undefined') {
              const h = PageWatch.history(c.id);
              if (h.length >= 2) sub = PageWatchDiff.summarize(PageWatchDiff.lineDiff(String(h[h.length - 2].text).split('\n'), String(h[h.length - 1].text).split('\n')), { maxLines: 0 }).headline;
            }
          } catch { sub = ''; }
          return { text: c.text, sub, url: c.url, when: B.when(c.at, ctx.now) };
        });
        return { summary: rows.length ? B.plural(rows.length, 'page') + ' changed since yesterday' : '', items };
      },
    });

    brief.register({
      id: 'radar', title: 'Release radar', icon: 'rocket', order: 60, maxItems: 5,
      build(ctx) {
        if (typeof PatchRadar === 'undefined') return null;
        const all = PatchRadar._all();
        const items = [];
        for (const gameId of Object.keys(all)) {
          let name = gameId;
          try { name = PatchRadar._gameName(gameId) || gameId; } catch { name = gameId; }
          for (const p of PatchRadar.pages(gameId)) {
            if (!p.changedAt || ctx.now - p.changedAt > 3 * B.DAY) continue;
            items.push({ text: name + (p.latest ? ': ' + String(p.latest).slice(0, 120) : ' has new patch notes'), url: p.url, badge: p.unseen ? 'New' : '', when: B.when(p.changedAt, ctx.now), at: p.changedAt });
          }
        }
        items.sort((a, c) => c.at - a.at);
        return { summary: items.length ? B.plural(items.length, 'new patch note') + ' in the last 3 days' : '', items: items.slice(0, 5).map(({ at, ...r }) => r) };
      },
    });

    brief.register({
      id: 'resume', title: 'Resume yesterday', icon: 'history', order: 70, maxItems: 3,
      build(ctx) {
        if (typeof SessionManager === 'undefined' || !Array.isArray(SessionManager.sessions)) return null;
        const recent = SessionManager.sessions
          .filter(x => x && Array.isArray(x.tabs) && x.tabs.length && Date.parse(x.createdAt) > ctx.now - 3 * B.DAY)
          .sort((a, c) => Date.parse(c.createdAt) - Date.parse(a.createdAt));
        const sess = recent.find(x => Date.parse(x.createdAt) < B.startOfDay(ctx.now)) || recent[0];
        if (!sess) return null;
        const titles = sess.tabs.map(t => t.title || t.url || '').filter(Boolean).slice(0, 3).join(' · ');
        return {
          summary: B.plural(sess.tabs.length, 'tab') + ' from ' + B.when(Date.parse(sess.createdAt), ctx.now),
          items: [{ text: sess.auto ? 'Your last open tabs' : sess.name, sub: titles, cmd: { type: 'brief-resume', id: sess.id }, badge: 'Open' }],
        };
      },
    });

    brief.register({
      id: 'saved', title: 'Saved for later', icon: 'bookmark', order: 80, maxItems: 6, ttlMs: 5 * 60000,
      async build(ctx) {
        const items = [];
        let unread = 0;
        if (typeof ReadLater !== 'undefined' && Array.isArray(ReadLater.items)) {
          const list = ReadLater.items.filter(i => !i.read).sort((a, c) => (c.at || 0) - (a.at || 0));
          unread = list.length;
          for (const i of list.slice(0, 4)) items.push({ text: i.title || i.url, sub: 'Read later', url: i.url, when: B.when(i.at, ctx.now) });
        }
        let clips = 0;
        try {
          if (window.vex && typeof window.vex.clipsFolder === 'function' && typeof window.vex.clipsList === 'function') {
            const f = await window.vex.clipsFolder(false);
            if (f && f.ok && f.dir) {
              const res = await window.vex.clipsList(f.dir);
              const fresh = (res && res.ok && Array.isArray(res.clips) ? res.clips : []).filter(c => c.at && ctx.now - c.at < 36 * 3600 * 1000);
              clips = fresh.length;
              for (const c of fresh.slice(0, 2)) items.push({ text: String(c.name || '').replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim(), sub: 'Clip', when: B.when(c.at, ctx.now), cmd: { type: 'brief-open-file', path: c.path } });
            }
          }
        } catch { /* the clips folder is optional: the reading list still shows */ }
        const bits = [];
        if (unread) bits.push(B.plural(unread, 'unread page'));
        if (clips) bits.push(B.plural(clips, 'new clip'));
        return { summary: bits.join(' · '), items };
      },
    });

    brief.register({
      id: 'numbers', title: 'Yesterday in numbers', icon: 'chart-bar', order: 90, ttlMs: 10 * 60000,
      async build(ctx) {
        const y = B.startOfDay(ctx.now) - B.DAY;
        const yEnd = B.startOfDay(ctx.now);
        const stats = [];
        try {
          if (typeof HistoryPanel !== 'undefined' && typeof HistoryPanel.list === 'function') {
            const hosts = new Set();
            let pages = 0;
            for (const e of HistoryPanel.list()) {
              const at = Date.parse(e.visitedAt || '') || e.timestamp || 0;
              if (at < y || at >= yEnd) continue;
              pages++;
              try { hosts.add(new URL(e.url).hostname); } catch { /* not a URL */ }
            }
            if (pages) { stats.push({ label: 'pages visited', value: String(pages) }); stats.push({ label: 'sites', value: String(hosts.size) }); }
          }
        } catch { /* history unreadable: leave the figure out */ }
        try {
          const log = JSON.parse(localStorage.getItem('vex.trackerReceipts') || 'null') || {};
          const day = log[B.dayKey(y)];
          if (day && day.blocked) stats.push({ label: 'trackers blocked', value: String(day.blocked) });
        } catch { /* no receipts */ }
        try {
          const b = window.vex && window.vex.reminders;
          if (b && typeof b.list === 'function') {
            const fired = (await b.list()).filter(r => { const t = r.firedAt || r.lastFiredAt; return t && t >= y && t < yEnd && r.kind !== 'review'; }).length;
            if (fired) stats.push({ label: 'reminders fired', value: String(fired) });
          }
        } catch { /* reminders unreadable */ }
        return { stats };
      },
    });

    brief.register({
      id: 'focus', title: 'Focus today', icon: 'target', order: 100,
      build(ctx) {
        const s = snapOf(ctx);
        const busy = [];
        for (const e of s.events || []) if (!e.allDay) busy.push({ at: e.at, end: e.end, text: e.text, minutes: 45 });
        for (const r of s.reminders || []) if (r.at != null && !r.overdue) busy.push({ at: r.at, text: r.text, minutes: 15 });
        for (const t of s.tasks || []) busy.push({ at: t.at, text: t.text, minutes: 15 });
        const f = B.focusSuggestion(busy, ctx.now);
        if (!f) return { note: 'The working day is over. Nothing more to plan.' };
        const lines = [];
        if (f.best) lines.push('Your best stretch for focused work is ' + B.hhmm(f.best.from) + ' to ' + B.hhmm(f.best.to) + ' (' + B.minutesLabel(f.minutes) + ').');
        else lines.push('There is no stretch of 45 minutes or more left before 18:00. Use the gaps for small things.');
        if (f.next) lines.push('Next up: ' + f.next.text + ' at ' + B.hhmm(f.next.at) + '.');
        else if (f.empty) lines.push('Nothing is scheduled.');
        return { summary: lines.join(' ') };
      },
    });
  },
};

if (typeof window !== 'undefined') {
  window.BriefSections = BriefSections;
  // Remember GitHub announcements, so "that build failed" outlives its toast.
  document.addEventListener('vex:github-watch', (e) => { try { BriefSections.recordGh(e.detail); } catch { /* never break the watch */ } });
  if (typeof VexBrief !== 'undefined') BriefSections.registerAll(VexBrief);
}
if (typeof module !== 'undefined' && module.exports) module.exports = { BriefSections };
