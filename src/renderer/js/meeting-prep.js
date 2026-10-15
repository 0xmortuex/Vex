// === Meeting prep ==========================================================
//
// About ten minutes before something on your calendar, Vex gets it ready: the
// documents the invitation links to, and the last notes you wrote for that
// meeting, in one card. You walk in with them already open.
//
// It builds on what exists. The events are the subscribed calendars
// (js/ics-calendar.js — their DESCRIPTION and URL now come through) and your
// reminders (js/calendar.js); the notes are the ones in the Notes panel; the
// tabs are opened with TabManager. Nothing is fetched, nothing is sent.
//
// What it will not do on its own: open the call link. A Zoom or Meet address
// is shown, never opened early — that would put you in the room. Documents are
// opened on the card's button, or by themselves when Settings says "Open them
// for me" (off until you choose it).
//
// The matching and the timing are pure functions (extractLinks, findNotes,
// due, prepare) so they are tested without a window; `snapshot()` returns the
// next prepared meeting as data for any surface that wants it.
const MeetingPrep = {
  MODE_KEY: 'vex.meetingPrep.mode',        // 'ask' (default) | 'auto' | 'off'
  LEAD_KEY: 'vex.meetingPrep.leadMinutes',
  SHOWN_KEY: 'vex.meetingPrep.shown',
  DEFAULT_LEAD_MIN: 10,
  GRACE_MS: 5 * 60 * 1000,                 // still worth preparing this long after it starts
  EVERY_MS: 60 * 1000,
  MAX_LINKS: 6,
  MAX_NOTES: 3,

  CALL_HOSTS: /(^|\.)(zoom\.us|zoom\.com|meet\.google\.com|teams\.microsoft\.com|teams\.live\.com|webex\.com|whereby\.com|gotomeeting\.com|discord\.gg|slack\.com)$/i,

  // Web addresses in a piece of text, without the punctuation a sentence puts
  // after them. In order, each once.
  extractLinks(text) {
    const found = [];
    for (const m of String(text || '').matchAll(/https?:\/\/[^\s<>"'\])}]+/gi)) {
      const url = m[0].replace(/[.,;:!?)]+$/, '');
      try { new URL(url); } catch { continue; }
      if (!found.includes(url)) found.push(url);
    }
    return found;
  },

  isCallLink(url) {
    try { return this.CALL_HOSTS.test(new URL(url).hostname); } catch { return false; }
  },

  normalize(s) {
    return String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  },

  // The notes that are about this meeting, newest first: its name in the
  // title, or as a tag, or (weaker) in the body. A note titled only
  // "Meeting — 4 Oct" is found by its tag when the tag is the meeting's name.
  findNotes(notes, summary, { max = this.MAX_NOTES } = {}) {
    const name = this.normalize(summary);
    if (name.length < 3) return [];
    const scored = [];
    for (const n of Array.isArray(notes) ? notes : []) {
      if (!n || !n.id) continue;
      const title = this.normalize(n.title);
      const tags = (Array.isArray(n.tags) ? n.tags : []).map(t => this.normalize(t));
      let s = 0;
      if (title === name) s = 4;
      else if (title.includes(name) || (title.length >= 5 && name.includes(title))) s = 3;
      else if (tags.includes(name)) s = 3;
      else if (this.normalize(n.content).includes(name)) s = 1;
      if (s) scored.push({ n, s, at: Date.parse(n.updatedAt || n.createdAt || '') || 0 });
    }
    scored.sort((a, b) => b.s - a.s || b.at - a.at);
    return scored.slice(0, max).map(x => x.n);
  },

  snippet(content, max = 220) {
    const t = String(content || '').replace(/[#>*`_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    return t.length > max ? t.slice(0, max - 1) + '…' : t;
  },

  // Meetings starting within the lead time (and not long gone), not yet
  // prepared. `shown` holds keys already handled.
  keyOf(e) { return this.normalize(e.summary) + '@' + e.start; },
  due(events, now, { leadMs = this.DEFAULT_LEAD_MIN * 60000, shown = new Set() } = {}) {
    return (Array.isArray(events) ? events : []).filter(e =>
      e && !e.allDay && Number.isFinite(e.start) && e.summary
      && e.start - now <= leadMs && now - e.start <= this.GRACE_MS
      && !shown.has(this.keyOf(e))).sort((a, b) => a.start - b.start);
  },

  // → the card's content for one event.
  prepare(event, notes) {
    const text = [event.url, event.description, event.location, event.summary].filter(Boolean).join('\n');
    const all = this.extractLinks(text);
    const docs = all.filter(u => !this.isCallLink(u)).slice(0, this.MAX_LINKS);
    const calls = all.filter(u => this.isCallLink(u));
    const found = this.findNotes(notes, event.summary);
    return {
      key: this.keyOf(event), title: event.summary, at: event.start, where: event.location || '',
      docs, calls,
      notes: found.map(n => ({ id: n.id, title: n.title || 'Untitled', updatedAt: n.updatedAt || n.createdAt || '', snippet: this.snippet(n.content) })),
    };
  },

  // --- settings --------------------------------------------------------------
  mode() { try { const v = localStorage.getItem(this.MODE_KEY); return v === 'auto' || v === 'off' ? v : 'ask'; } catch { return 'ask'; } },
  setMode(v) {
    if (!['ask', 'auto', 'off'].includes(v)) throw new Error('Unknown meeting prep mode: ' + v);
    localStorage.setItem(this.MODE_KEY, v);
  },
  leadMinutes() {
    try { const n = parseInt(localStorage.getItem(this.LEAD_KEY), 10); return n >= 1 && n <= 120 ? n : this.DEFAULT_LEAD_MIN; } catch { return this.DEFAULT_LEAD_MIN; }
  },
  setLeadMinutes(n) {
    const v = Math.round(Number(n));
    if (!(v >= 1 && v <= 120)) throw new Error('Choose between 1 and 120 minutes');
    localStorage.setItem(this.LEAD_KEY, String(v));
  },

  _shown() {
    try {
      const o = JSON.parse(localStorage.getItem(this.SHOWN_KEY) || '{}');
      const cutoff = Date.now() - 24 * 3600 * 1000;
      return new Map(Object.entries(o).filter(([, t]) => t > cutoff));
    } catch { return new Map(); }
  },
  _markShown(key) {
    const m = this._shown();
    m.set(key, Date.now());
    try { localStorage.setItem(this.SHOWN_KEY, JSON.stringify(Object.fromEntries(m))); } catch (err) { console.warn('[MeetingPrep] could not remember the card:', err.message); }
  },

  // --- the live sources ------------------------------------------------------
  _notes() {
    try { const a = JSON.parse(localStorage.getItem('vex.notes') || '[]'); return Array.isArray(a) ? a : []; }
    catch (err) { throw new Error('Could not read the notes: ' + err.message); }
  },

  // Calendar events and reminders that fall in [from, to), as one list.
  async _events(from, to) {
    const out = [];
    if (typeof IcsCalendar !== 'undefined') out.push(...IcsCalendar.between(from, to));
    if (window.vex && window.vex.reminders && typeof window.vex.reminders.list === 'function' && typeof Calendar !== 'undefined') {
      const reminders = await window.vex.reminders.list();
      for (const r of reminders || []) {
        if (r.kind && r.kind !== 'reminder') continue;
        for (const at of Calendar.occurrences(r, from, to)) out.push({ summary: r.message, start: at, end: at + 30 * 60000, allDay: false, location: '', description: '', url: '', calendar: 'Reminders' });
      }
    }
    return out;
  },

  // The next meeting prepared, whether or not it is due: a hook for surfaces
  // that show "next up". → null when nothing is on in the next day.
  async snapshot(now = Date.now()) {
    const events = (await this._events(now - this.GRACE_MS, now + 24 * 3600 * 1000)).filter(e => !e.allDay && e.start >= now - this.GRACE_MS).sort((a, b) => a.start - b.start);
    const next = events[0];
    return next ? this.prepare(next, this._notes()) : null;
  },

  // --- acting ------------------------------------------------------------------
  openDocs(prep) {
    if (typeof TabManager === 'undefined') throw new Error('Tabs are not available');
    for (const url of prep.docs) TabManager.createTab(url, false);
    return prep.docs.length;
  },

  openNote(id) {
    if (typeof SidebarManager === 'undefined' || typeof NotesPanel === 'undefined') throw new Error('Notes are not available');
    SidebarManager.openPanel('notes');
    NotesPanel.selectNote(id);
  },

  // The card: a toast would be gone before it was read, and has no room for
  // the notes. It sits in a corner, takes no focus, and Escape or Dismiss
  // closes it.
  showCard(prep) {
    document.querySelector('.vex-meetingprep')?.remove();
    const esc = (s) => window.escapeHtml(String(s == null ? '' : s));
    const when = new Date(prep.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    const btn = 'font-size:11.5px;color:var(--text);background:none;border:1px solid var(--border);border-radius:6px;padding:3px 9px;cursor:pointer';
    const card = document.createElement('div');
    card.className = 'vex-meetingprep';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', 'Meeting prep: ' + prep.title);
    card.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:9000;width:min(360px,92vw);background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:12px;box-shadow:0 14px 40px var(--vex-shadow-color,rgba(0,0,0,0.4));padding:12px 14px';
    card.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px">
        <span style="display:inline-flex;color:var(--primary)">${window.VexIcons.svg('calendar', { size: 16 })}</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(prep.title)}</div>
          <div style="font-size:11px;color:var(--text-muted)">${esc(when)}${prep.where ? ' · ' + esc(prep.where) : ''}</div>
        </div>
        <button data-dismiss type="button" aria-label="Dismiss" style="display:inline-flex;background:none;border:none;color:var(--text-muted);cursor:pointer">${window.VexIcons.svg('x', { size: 14 })}</button>
      </div>
      ${prep.notes.length ? `<div style="margin-top:9px;font-size:11px;color:var(--text-muted)">Last notes</div>
        ${prep.notes.map(n => `<button data-note="${esc(n.id)}" type="button" style="display:block;width:100%;text-align:left;font:inherit;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:6px 8px;margin-top:4px;cursor:pointer;color:var(--text)">
          <span style="display:block;font-size:12px;font-weight:600">${esc(n.title)}</span>
          <span style="display:block;font-size:11px;color:var(--text-muted)">${esc(n.snippet)}</span></button>`).join('')}` : '<div style="margin-top:9px;font-size:11.5px;color:var(--text-muted)">No notes from earlier meetings with this name.</div>'}
      ${prep.docs.length ? `<div style="margin-top:9px;font-size:11px;color:var(--text-muted)">${prep.docs.length} linked document${prep.docs.length === 1 ? '' : 's'}</div>
        ${prep.docs.map(u => `<div style="font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(u)}</div>`).join('')}` : ''}
      <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">
        ${prep.docs.length ? `<button data-open type="button" style="${btn}">Open the documents</button>` : ''}
        ${prep.calls.length ? `<button data-call type="button" style="${btn}">Open the call link</button>` : ''}
      </div>`;
    const close = () => { card.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = (e) => { if (e.key === 'Escape' && card.isConnected && !document.querySelector('.vex-dialog-overlay')) close(); };
    card.querySelector('[data-dismiss]').addEventListener('click', close);
    card.querySelector('[data-open]')?.addEventListener('click', () => {
      try { window.showToast?.('Opened ' + this.openDocs(prep) + ' document' + (prep.docs.length === 1 ? '' : 's')); }
      catch (err) { window.showToast?.(err.message, 'error'); }
    });
    card.querySelector('[data-call]')?.addEventListener('click', () => { TabManager.createTab(prep.calls[0], true); close(); });
    card.querySelectorAll('[data-note]').forEach(b => b.addEventListener('click', () => {
      try { this.openNote(b.dataset.note); } catch (err) { window.showToast?.(err.message, 'error'); }
    }));
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(card);
    return card;
  },

  // One pass of the minute job. → the prepared meetings it acted on.
  async tick(now = Date.now()) {
    const mode = this.mode();
    if (mode === 'off') return [];
    if (window.VexTabPolicy && window.VexTabPolicy.isPrivateWindow) return [];
    const lead = this.leadMinutes() * 60000;
    const events = await this._events(now - this.GRACE_MS, now + lead + this.EVERY_MS);
    const shown = new Set(this._shown().keys());
    const notes = this._notes();
    const acted = [];
    for (const e of this.due(events, now, { leadMs: lead, shown })) {
      const prep = this.prepare(e, notes);
      this._markShown(prep.key);
      if (mode === 'auto' && prep.docs.length) this.openDocs(prep);
      this.showCard(prep);
      acted.push(prep);
    }
    return acted;
  },

  start() {
    if (this._job) return;
    if (typeof VexJobs === 'undefined') throw new Error('MeetingPrep needs VexJobs');
    this._job = VexJobs.every('Meeting prep', this.EVERY_MS, () => this.tick().catch(err => window.VexProblems?.note('Meeting prep', 'Could not prepare the next meeting', err)), { when: 'background' });
  },
  stop() { if (this._job) { this._job.stop(); this._job = null; } },
};

if (typeof window !== 'undefined') window.MeetingPrep = MeetingPrep;
if (typeof module !== 'undefined' && module.exports) module.exports = { MeetingPrep };
