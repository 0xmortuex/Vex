// === Meeting copilot =======================================================
//
// Before, during and after a meeting, built on what Vex already keeps.
//
//   BEFORE   the agenda, the documents the invitation links to and the last
//            notes you wrote for it. This is js/meeting-prep.js; nothing is
//            fetched again here.
//   DURING   a notes panel that stamps every line with the time, and marks a
//            line as a decision, an action or a question with one key. It
//            types and stores text. It NEVER records sound or the screen: no
//            microphone, no capture, no camera is asked for anywhere in this
//            file (a test reads the source to keep it that way).
//   AFTER    your OWN local model (Ollama) turns the timestamped lines into a
//            summary, decisions and action items. Nothing leaves this PC, and
//            nothing is created until you tick the items and confirm: the
//            ticked ones become tasks in the To-do note and, when they carry
//            a date, a reminder. The result is saved as a note that is linked
//            to the calendar event and is found again by Meeting prep next
//            time.
//
// Pure parts (parseLine, parseDue, buildPrompt, parseModel, merge, markdown)
// take plain data so they are tested without a window or a model. The model is
// reached through one injected function: (system, prompt) => Promise<string>.

const MeetingCopilot = {
  SESSION_KEY: 'vex.meetingCopilot.session',
  KINDS: ['note', 'decision', 'action', 'question'],
  MAX_LINES: 2000,
  MAX_LINE_CHARS: 1000,
  MAX_PROMPT_CHARS: 12000,
  MAX_ITEMS: 40,

  // --- one line -------------------------------------------------------------
  // "d: ship Friday" / "decision: ..." -> decision; "a:" / "action:" / "todo:"
  // -> action; "q:" / "question:" -> question. "[ ] x" is an action too. The
  // tag is removed from the text; anything else is a plain note.
  TAGS: [
    { kind: 'decision', re: /^\s*(?:decision|decided|dec|d)\s*[:：]\s*/i },
    { kind: 'action', re: /^\s*(?:action|todo|to-do|task|a)\s*[:：]\s*/i },
    { kind: 'question', re: /^\s*(?:question|ques|q)\s*[:：]\s*/i },
    { kind: 'action', re: /^\s*[-*]?\s*\[\s\]\s+/ },
  ],

  parseLine(raw) {
    let text = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
    for (const t of this.TAGS) {
      const m = t.re.exec(text);
      if (m) return { kind: t.kind, text: text.slice(m[0].length).trim() };
    }
    return { kind: 'note', text };
  },

  _iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); },
  _validIso(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) return '';
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    return d.getFullYear() === +m[1] && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3] ? m[0] : '';
  },

  // A due date in an action's words: "@2026-10-30", "by 2026-10-30", "due
  // today", "by tomorrow", "by friday" (the next Friday after today). → an
  // ISO local date, or ''.
  parseDue(text, now = new Date()) {
    const s = String(text || '');
    const iso = /(?:@|\b(?:by|due|until|before|on)\s+)(\d{4}-\d{2}-\d{2})\b/i.exec(s);
    if (iso) return this._validIso(iso[1]);
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const w = /(?:@|\b(?:by|due|until|before|on)\s+)(today|tomorrow|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i.exec(s);
    if (!w) {
      // A Turkish due date: "son tarih 15.03.2026", "15 Mart'a kadar", "yarına kadar",
      // "cumaya kadar" (js/vex-tr.js). A day word with Turkish suffixes is read by its stem.
      const tr = globalThis.VexTr || (typeof require === 'function' ? require('./vex-tr.js').VexTr : null);
      if (!tr) return '';
      const m = /(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{1,2}\s+[A-Za-zÇĞİÖŞÜçğıöşü]{3,9}(?:\s+\d{4})?|yarın|yarin|bugün|bugun|pazartesi|salı|sali|çarşamba|carsamba|perşembe|persembe|cuma|cumartesi|pazar)(?:['’]?\w{0,3})?\s+(?:kadar|günü|gunu|itibarıyla|itibariyla)\b|(?:son tarih|teslim)[:\s]+(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{1,2}\s+[A-Za-zÇĞİÖŞÜçğıöşü]{3,9}(?:\s+\d{4})?)/iu.exec(s);
      if (!m) return '';
      let day = null;
      // An impossible date in the words ("31 Şubat'a kadar") is no due date: none is set.
      try { day = tr.parseDay((m[1] || m[2]).replace(/\s+/g, ' '), now); }
      catch { /* vex-allow-empty-catch: the text named a day that does not exist, so it names no due date */ return ''; }
      return day ? this._iso(day.date) : '';
    }
    const v = w[1].toLowerCase();
    if (v === 'today') return this._iso(day);
    if (v === 'tomorrow') { day.setDate(day.getDate() + 1); return this._iso(day); }
    const want = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].indexOf(v);
    let add = (want - day.getDay() + 7) % 7;
    if (add === 0) add = 7;
    day.setDate(day.getDate() + add);
    return this._iso(day);
  },

  // "call Sam @sam by friday" -> { text: 'call Sam', owner: 'sam', due }
  actionMeta(text, now = new Date()) {
    const due = this.parseDue(text, now);
    const owner = (/(?:^|\s)@([\p{L}][\p{L}\p{N}_.-]*)/u.exec(text) || [])[1] || '';
    return { due, owner };
  },

  // --- the session ----------------------------------------------------------
  newSession({ title = '', event = null, now = Date.now() } = {}) {
    const name = String(title || (event && event.summary) || '').trim();
    return {
      id: 'mtg_' + now.toString(36) + Math.random().toString(36).slice(2, 6),
      title: name || 'Meeting',
      event: event && event.summary ? { summary: String(event.summary), start: Number(event.start) || null, key: event.key || '' } : null,
      startedAt: now, endedAt: null, lines: [],
    };
  },

  // Adds a line (mutates). `kind` overrides what the text's own tag says.
  addLine(session, raw, { kind = null, now = Date.now() } = {}) {
    if (!session || !Array.isArray(session.lines)) throw new Error('There is no meeting session');
    if (session.endedAt) throw new Error('This meeting has ended');
    if (kind != null && !this.KINDS.includes(kind)) throw new Error('Unknown line kind: ' + kind);
    const parsed = this.parseLine(raw);
    const text = parsed.text.slice(0, this.MAX_LINE_CHARS);
    if (!text) throw new Error('Write something first');
    if (session.lines.length >= this.MAX_LINES) throw new Error('This meeting has the most lines a session keeps (' + this.MAX_LINES + ')');
    const line = { at: now, kind: kind || parsed.kind, text };
    session.lines.push(line);
    return line;
  },

  setKind(session, index, kind) {
    if (!this.KINDS.includes(kind)) throw new Error('Unknown line kind: ' + kind);
    const line = session.lines[index];
    if (!line) throw new Error('No such line');
    line.kind = line.kind === kind ? 'note' : kind;      // pressing the same mark again clears it
    return line;
  },

  // "+12:05" from the start of the meeting.
  offset(session, line) {
    const s = Math.max(0, Math.floor((line.at - session.startedAt) / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    return '+' + (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(r).padStart(2, '0');
  },

  // --- the model's part -----------------------------------------------------
  SYSTEM_PROMPT: 'You turn a person\'s own typed meeting notes into a short record. '
    + 'Use only what the notes say; do not invent names, dates or decisions. '
    + 'Lines marked (decision), (action) and (question) were marked by the person and are certain. '
    + 'Reply with JSON only, in this shape: {"summary": string (at most 5 sentences), "decisions": string[], '
    + '"actions": [{"text": string, "owner": string, "due": string}], "questions": string[]}. '
    + 'due is YYYY-MM-DD when the notes state a date, otherwise "". owner is "" when not stated. Do the work; no preface.',

  // → { system, prompt, truncated, lines }. Marked lines are kept first when
  // the notes are longer than the model should be given: the plain notes
  // that are dropped are the oldest.
  buildPrompt(session, { maxChars = this.MAX_PROMPT_CHARS } = {}) {
    const when = new Date(session.startedAt);
    const head = 'Meeting: ' + session.title + '\nDate: ' + this._iso(when) + '\nNotes, each with minutes from the start:\n';
    const render = (l) => '[' + this.offset(session, l) + '] ' + (l.kind === 'note' ? '' : '(' + l.kind + ') ') + l.text;
    const keep = session.lines.map((l, i) => ({ l, i, on: true }));
    const size = () => head.length + keep.filter(k => k.on).reduce((n, k) => n + render(k.l).length + 1, 0);
    let truncated = false;
    for (const k of keep) {                                     // oldest plain lines go first
      if (size() <= maxChars) break;
      if (k.l.kind === 'note') { k.on = false; truncated = true; }
    }
    for (const k of keep) {                                     // still too long: oldest of anything
      if (size() <= maxChars) break;
      k.on = false; truncated = true;
    }
    const used = keep.filter(k => k.on).map(k => k.l);
    return {
      system: this.SYSTEM_PROMPT,
      prompt: head + used.map(render).join('\n') + (truncated ? '\n(Some older plain notes were left out to fit.)' : ''),
      truncated, lines: used.length,
    };
  },

  // The model's reply -> { summary, decisions[], actions[{text,owner,due}], questions[] }.
  // Throws when there is no JSON object in it: a half-understood reply must
  // not become tasks.
  parseModel(reply) {
    const s = String(reply == null ? '' : reply).replace(/```(?:json)?/gi, '');
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a < 0 || b <= a) throw new Error('The local model did not answer in the expected form. Nothing was changed.');
    let o;
    try { o = JSON.parse(s.slice(a, b + 1)); }
    catch (err) { throw new Error('The local model\'s answer could not be read (' + err.message + '). Nothing was changed.'); }
    const strs = (v) => (Array.isArray(v) ? v : []).map(x => typeof x === 'string' ? x : (x && typeof x.text === 'string' ? x.text : '')).map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, this.MAX_ITEMS);
    const actions = (Array.isArray(o.actions) ? o.actions : []).map(x => {
      if (typeof x === 'string') return { text: x.replace(/\s+/g, ' ').trim(), owner: '', due: '' };
      if (!x || typeof x.text !== 'string') return null;
      return { text: x.text.replace(/\s+/g, ' ').trim(), owner: typeof x.owner === 'string' ? x.owner.trim() : '', due: this._validIso(x.due) };
    }).filter(x => x && x.text).slice(0, this.MAX_ITEMS);
    return { summary: typeof o.summary === 'string' ? o.summary.replace(/\s+/g, ' ').trim() : '', decisions: strs(o.decisions), actions, questions: strs(o.questions) };
  },

  _norm(s) { return String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); },

  // What you marked is always in the result, whatever the model said; the
  // model's items are added when they are not the same thing in other words.
  merge(session, model, now = new Date()) {
    const out = { summary: model ? model.summary : '', decisions: [], actions: [], questions: [] };
    const seen = { decisions: new Set(), actions: new Set(), questions: new Set() };
    const put = (bucket, text, extra) => {
      const key = this._norm(text);
      if (!key || seen[bucket].has(key)) return;
      seen[bucket].add(key);
      out[bucket].push(extra ? { text, ...extra } : text);
    };
    for (const l of session.lines) {
      if (l.kind === 'decision') put('decisions', l.text);
      else if (l.kind === 'question') put('questions', l.text);
      else if (l.kind === 'action') { const m = this.actionMeta(l.text, new Date(l.at || now)); put('actions', l.text, { owner: m.owner, due: m.due, marked: true }); }
    }
    if (model) {
      for (const d of model.decisions) put('decisions', d);
      for (const q of model.questions) put('questions', q);
      for (const a of model.actions) put('actions', a.text, { owner: a.owner || '', due: a.due || this.parseDue(a.text, now), marked: false });
    }
    return out;
  },

  // The note that is kept: readable on its own, in plain markdown.
  markdown(session, result) {
    const L = [];
    const when = new Date(session.startedAt);
    L.push('Meeting: ' + session.title + ' · ' + when.toLocaleString());
    if (result.summary) L.push('', '## Summary', result.summary);
    if (result.decisions.length) L.push('', '## Decisions', ...result.decisions.map(d => '- ' + d));
    if (result.actions.length) L.push('', '## Action items', ...result.actions.map(a => '- [ ] ' + a.text + (a.owner && !a.text.includes('@' + a.owner) ? ' (' + a.owner + ')' : '') + (a.due && !a.text.includes(a.due) ? ' @' + a.due : '')));
    if (result.questions.length) L.push('', '## Open questions', ...result.questions.map(q => '- ' + q));
    if (session.lines.length) L.push('', '## Notes, with times', ...session.lines.map(l => '- ' + this.offset(session, l) + (l.kind === 'note' ? '' : ' **' + l.kind + '**') + ' ' + l.text));
    return L.join('\n');
  },

  // Tags make the note findable by Meeting prep (it matches a note's tag to
  // the meeting's name) the next time this meeting comes round.
  noteFor(session, result, now = Date.now()) {
    const iso = new Date(session.startedAt).toISOString();
    const title = session.title + ' — ' + this._iso(new Date(session.startedAt));
    const tags = ['meeting'];
    const name = this._norm(session.title);
    if (name.length >= 3) tags.push(name);
    return {
      id: 'note_' + now + '_' + Math.random().toString(36).slice(2, 7),
      title: title.slice(0, 200), content: this.markdown(session, result), pinned: false, tags,
      sourceUrl: '', sourceTitle: '', createdAt: iso, updatedAt: new Date(now).toISOString(),
      meetingEvent: session.event ? { summary: session.event.summary, start: session.event.start, key: session.event.key } : null,
    };
  },

  // --- the model ------------------------------------------------------------
  // The one place a model is reached. Local Ollama only, whatever the AI
  // settings say about the cloud.
  localGenerate() {
    if (typeof Ollama === 'undefined' || typeof AIRouter === 'undefined') throw new Error('Local AI is not available in this window');
    const st = AIRouter.getOllamaStatus();
    if (!st || !st.available || !st.model) throw new Error('Local AI (Ollama) is not set up, so the notes cannot be summarised on this PC. Your notes are kept.');
    return (system, prompt) => Ollama.generate(st.model, prompt, { systemPrompt: system, temperature: 0.2, maxTokens: 1500, format: 'json' });
  },

  async summarise(session, generate = this.localGenerate(), now = new Date()) {
    if (typeof generate !== 'function') throw new Error('No model to summarise with');
    if (!session.lines.length) throw new Error('There are no notes to summarise');
    const p = this.buildPrompt(session);
    const reply = await generate(p.system, p.prompt);
    const result = this.merge(session, this.parseModel(reply), now);
    result.truncated = p.truncated;
    return result;
  },

  // Without a model: what you marked, as it is. Used when you choose to save
  // without summarising.
  plain(session, now = new Date()) { return this.merge(session, null, now); },

  // --- keeping --------------------------------------------------------------
  _notes() {
    try { const a = JSON.parse(localStorage.getItem('vex.notes') || '[]'); return Array.isArray(a) ? a : []; }
    catch (err) { throw new Error('Could not read the notes: ' + err.message); }
  },

  saveNote(session, result) {
    const note = this.noteFor(session, result);
    const notes = this._notes();
    notes.unshift(note);
    localStorage.setItem('vex.notes', JSON.stringify(notes));
    try { if (typeof NotesPanel !== 'undefined' && NotesPanel.reloadSyncedState) NotesPanel.reloadSyncedState(); }
    catch (err) { console.warn('[MeetingCopilot] the Notes panel did not refresh:', err.message); }
    return note;
  },

  // The confirmed action items -> tasks in the To-do note, and a reminder at
  // 09:00 on the due day for those with a date (now + a minute if that time
  // has passed today). → { tasks, reminders, failed: [{ text, error }] }.
  async createFollowUps(items, { reminders = true, now = new Date() } = {}) {
    if (typeof OpenTasks === 'undefined') throw new Error('Open tasks are not available');
    const out = { tasks: 0, reminders: 0, failed: [] };
    for (const it of items) {
      const text = String(it.text || '').trim();
      try {
        const due = this._validIso(it.due);
        OpenTasks.add(text + (due && !text.includes(due) ? ' @' + due : ''));
        out.tasks++;
        if (reminders && due) {
          if (typeof VexQuickReminder === 'undefined') throw new Error('Reminders are not available');
          const [y, m, d] = due.split('-').map(Number);
          let at = new Date(y, m - 1, d, 9, 0, 0);
          if (at.getTime() <= now.getTime()) {
            if (this._iso(at) < this._iso(now)) continue;        // a past day gets a task, not a reminder
            at = new Date(now.getTime() + 60000);
          }
          await VexQuickReminder.create(text.slice(0, 500), at);
          out.reminders++;
        }
      } catch (err) { out.failed.push({ text, error: err.message }); }
    }
    return out;
  },

  // --- the live session (one at a time, kept across a reload) ---------------
  current() {
    let raw;
    try { raw = localStorage.getItem(this.SESSION_KEY); } catch (err) { throw new Error('Could not read the meeting session: ' + err.message); }
    if (!raw) return null;
    try { const s = JSON.parse(raw); return s && Array.isArray(s.lines) ? s : null; }
    catch (err) { throw new Error('The saved meeting session is not valid JSON: ' + err.message); }
  },
  _store(session) { localStorage.setItem(this.SESSION_KEY, JSON.stringify(session)); },
  begin(opts) { const existing = this.current(); if (existing && !existing.endedAt) return existing; const s = this.newSession(opts); this._store(s); return s; },
  note(raw, opts) { const s = this.current(); if (!s) throw new Error('Start the meeting notes first'); const l = this.addLine(s, raw, opts); this._store(s); return l; },
  mark(index, kind) { const s = this.current(); if (!s) throw new Error('No meeting is running'); const l = this.setKind(s, index, kind); this._store(s); return l; },
  discard() { localStorage.removeItem(this.SESSION_KEY); },

  // Data hook for the brief: what a running meeting looks like. Draws nothing.
  snapshot() {
    let s = null;
    try { s = this.current(); } catch { return null; }
    if (!s) return null;
    const count = (k) => s.lines.filter(l => l.kind === k).length;
    return { id: s.id, title: s.title, startedAt: s.startedAt, ended: !!s.endedAt, lines: s.lines.length, decisions: count('decision'), actions: count('action'), questions: count('question') };
  },

  // --- BEFORE ---------------------------------------------------------------
  // The agenda is the invitation's own words with the web addresses taken
  // out (those are the linked documents).
  agendaOf(event) {
    return String(event && event.description || '').replace(/https?:\/\/\S+/gi, '').split(/\r?\n/).map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 12);
  },

  async before(now = Date.now()) {
    if (typeof MeetingPrep === 'undefined') return null;
    const events = await MeetingPrep._events(now - MeetingPrep.GRACE_MS, now + 24 * 3600 * 1000);
    const next = events.filter(e => !e.allDay && Number.isFinite(e.start) && e.start >= now - MeetingPrep.GRACE_MS).sort((a, b) => a.start - b.start)[0];
    if (!next) return null;
    const prep = MeetingPrep.prepare(next, MeetingPrep._notes());
    return { ...prep, agenda: this.agendaOf(next), event: { summary: next.summary, start: next.start, key: prep.key } };
  },

  // --- the panel ------------------------------------------------------------
  KEYS: { '1': 'decision', '2': 'action', '3': 'question' },    // with Alt, in the notes box

  async open() {
    if (!window.PageExport || typeof window.PageExport._sheet !== 'function') throw new Error('The meeting panel is not available');
    const esc = (s) => window.escapeHtml(String(s == null ? '' : s));
    const { head, body, close } = window.PageExport._sheet('Meeting copilot', 'vex-meetingcopilot-overlay');
    const btn = 'font-size:12px;color:var(--text);background:none;border:1px solid var(--border);border-radius:6px;padding:4px 10px;cursor:pointer';
    const KIND_LABEL = { note: 'Note', decision: 'Decision', action: 'Action', question: 'Question' };
    const KIND_ICON = { decision: 'check', action: 'flag', question: 'info' };
    const fail = (err) => window.showToast?.(err.message, 'error');

    const drawBefore = async () => {
      let prep = null;
      try { prep = await this.before(); } catch (err) { fail(err); }
      body.innerHTML = `<div style="padding:14px">
        ${prep ? `<div style="font-size:13px;font-weight:650">${esc(prep.title)}</div>
          <div style="font-size:11.5px;color:var(--text-muted)">${esc(new Date(prep.at).toLocaleString())}${prep.where ? ' · ' + esc(prep.where) : ''}</div>
          ${prep.agenda.length ? `<div style="margin-top:10px;font-size:11px;color:var(--text-muted)">Agenda</div>${prep.agenda.map(l => `<div style="font-size:12.5px">${esc(l)}</div>`).join('')}` : ''}
          ${prep.docs.length ? `<div style="margin-top:10px;font-size:11px;color:var(--text-muted)">Linked documents</div>${prep.docs.map(u => `<div style="font-size:12px;overflow-wrap:anywhere">${esc(u)}</div>`).join('')}` : ''}
          <div style="margin-top:10px;font-size:11px;color:var(--text-muted)">Last notes</div>
          ${prep.notes.length ? prep.notes.map(n => `<div style="margin-top:4px"><div style="font-size:12.5px;font-weight:600">${esc(n.title)}</div><div style="font-size:11.5px;color:var(--text-muted)">${esc(n.snippet)}</div></div>`).join('') : '<div style="font-size:12px;color:var(--text-muted)">None yet for a meeting with this name.</div>'}`
          : '<div style="font-size:12.5px;color:var(--text-muted)">Nothing on your calendar in the next day.</div>'}
        <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
          ${prep ? '<button data-start-event type="button" class="btn-primary">Start notes for this meeting</button>' : ''}
          <button data-start type="button" class="btn-secondary">Start notes without a meeting</button>
        </div>
        <div style="margin-top:10px;font-size:11px;color:var(--text-muted)">The notes are typed text only. Vex does not listen to or record the meeting.</div>
      </div>`;
      body.querySelector('[data-start-event]')?.addEventListener('click', () => { try { this.begin({ event: prep.event }); drawLive(); } catch (err) { fail(err); } });
      body.querySelector('[data-start]')?.addEventListener('click', async () => {
        const title = await window.vexPrompt({ title: 'Name this meeting', label: 'Name', value: '', okLabel: 'Start' });
        if (title == null) return;
        try { this.begin({ title }); drawLive(); } catch (err) { fail(err); }
      });
    };

    const drawLive = () => {
      let s;
      try { s = this.current(); } catch (err) { fail(err); return; }
      if (!s) return drawBefore();
      const lines = s.lines.map((l, i) => `<div data-line="${i}" style="display:flex;gap:8px;align-items:flex-start;padding:5px 14px;${l.kind !== 'note' ? 'background:var(--vex-hover-fill)' : ''}">
          <span style="flex:none;font-size:10.5px;color:var(--text-muted);min-width:44px;font-variant-numeric:tabular-nums">${esc(this.offset(s, l))}</span>
          <span style="flex:none;display:inline-flex;width:14px;color:var(--primary)">${KIND_ICON[l.kind] ? window.VexIcons.svg(KIND_ICON[l.kind], { size: 13 }) : ''}</span>
          <span style="flex:1;font-size:12.5px;white-space:pre-wrap;overflow-wrap:anywhere">${esc(l.text)}</span>
          <span style="flex:none;display:flex;gap:3px">${['decision', 'action', 'question'].map(k => `<button type="button" data-mark="${k}" aria-label="Mark as ${k}" title="${KIND_LABEL[k]}" style="display:inline-flex;background:none;border:none;cursor:pointer;color:${l.kind === k ? 'var(--primary)' : 'var(--text-muted)'}">${window.VexIcons.svg(KIND_ICON[k], { size: 13 })}</button>`).join('')}</span>
        </div>`).join('');
      body.innerHTML = `<div style="padding:10px 14px;border-bottom:1px solid var(--border);font-size:12px;color:var(--text-muted)">${esc(s.title)} · ${s.lines.length} line${s.lines.length === 1 ? '' : 's'}</div>
        <div data-lines style="max-height:42vh;overflow:auto">${lines || '<div style="padding:14px;font-size:12px;color:var(--text-muted)">Type a line and press Enter. Alt+1 marks a decision, Alt+2 an action, Alt+3 a question; or start the line with d: a: q:.</div>'}</div>
        <div style="padding:10px 14px;display:flex;gap:8px;flex-wrap:wrap;border-top:1px solid var(--border)">
          <input data-input class="set-input" style="flex:1;min-width:200px" placeholder="A note…  (d: decision · a: action · q: question)" aria-label="Meeting note">
          <button data-add type="button" style="${btn}">Add</button>
        </div>
        <div style="padding:0 14px 12px;display:flex;gap:8px;flex-wrap:wrap">
          <button data-end type="button" class="btn-primary">End and summarise</button>
          <button data-save-plain type="button" class="btn-secondary">End and save without a summary</button>
          <button data-discard type="button" class="btn-secondary">Discard</button>
        </div>`;
      const input = body.querySelector('[data-input]');
      const lineBox = body.querySelector('[data-lines]');
      if (lineBox) lineBox.scrollTop = lineBox.scrollHeight;
      const add = (kind) => {
        if (!input.value.trim()) return;
        try { this.note(input.value, { kind }); drawLive(); }
        catch (err) { fail(err); }
      };
      input.addEventListener('keydown', (e) => {
        if (e.altKey && !e.ctrlKey && !e.metaKey && this.KEYS[e.key]) { e.preventDefault(); e.stopPropagation(); add(this.KEYS[e.key]); }
        else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); add(null); }
      });
      body.querySelector('[data-add]').addEventListener('click', () => add(null));
      body.querySelectorAll('[data-line] [data-mark]').forEach(b => b.addEventListener('click', () => {
        try { this.mark(+b.closest('[data-line]').dataset.line, b.dataset.mark); drawLive(); } catch (err) { fail(err); }
      }));
      body.querySelector('[data-discard]').addEventListener('click', async () => {
        const ok = await window.vexConfirm({ title: 'Discard these notes?', message: 'The ' + s.lines.length + ' lines of this meeting are deleted. This cannot be undone.', okLabel: 'Discard', danger: true });
        if (ok) { this.discard(); drawBefore(); }
      });
      const finish = async (withModel) => {
        let session;
        try {
          session = this.current();
          if (!session.lines.length) throw new Error('There are no notes to save');
          session.endedAt = Date.now();
          this._store(session);
        } catch (err) { fail(err); return; }
        let result;
        if (withModel) {
          body.innerHTML = '<div style="padding:18px;font-size:12.5px;color:var(--text-muted)">Your local model is reading the notes. They do not leave this PC.</div>';
          try { result = await this.summarise(session); }
          catch (err) { fail(err); result = null; }
        }
        if (!result) result = this.plain(session);
        drawReview(session, result);
      };
      body.querySelector('[data-end]').addEventListener('click', () => finish(true));
      body.querySelector('[data-save-plain]').addEventListener('click', () => finish(false));
      input.focus();
    };

    // The result, for you to check before anything is created.
    const drawReview = (session, result) => {
      const dueIn = (a, i) => `<input type="date" data-due="${i}" value="${esc(a.due || '')}" class="set-input" style="width:140px" aria-label="Due date">`;
      body.innerHTML = `<div style="padding:14px">
        ${result.truncated ? '<div style="font-size:11.5px;color:var(--text-muted);margin-bottom:8px">The notes were long, so some older plain lines were not given to the model.</div>' : ''}
        <div style="font-size:11px;color:var(--text-muted)">Summary</div>
        <textarea data-summary class="set-input" rows="4" style="width:100%;box-sizing:border-box" aria-label="Summary">${esc(result.summary)}</textarea>
        ${result.decisions.length ? `<div style="margin-top:10px;font-size:11px;color:var(--text-muted)">Decisions</div>${result.decisions.map(d => `<div style="font-size:12.5px">- ${esc(d)}</div>`).join('')}` : ''}
        ${result.questions.length ? `<div style="margin-top:10px;font-size:11px;color:var(--text-muted)">Open questions</div>${result.questions.map(q => `<div style="font-size:12.5px">- ${esc(q)}</div>`).join('')}` : ''}
        <div style="margin-top:10px;font-size:11px;color:var(--text-muted)">Action items — tick the ones to create</div>
        ${result.actions.length ? result.actions.map((a, i) => `<div style="display:flex;gap:8px;align-items:center;margin-top:5px">
            <input type="checkbox" data-pick="${i}" checked aria-label="Create this task">
            <input data-text="${i}" class="set-input" style="flex:1;min-width:0" value="${esc(a.text)}" aria-label="Task">
            ${dueIn(a, i)}</div>`).join('') : '<div style="font-size:12px;color:var(--text-muted)">No action items found.</div>'}
        <label style="display:flex;gap:6px;align-items:center;margin-top:10px;font-size:12px"><input type="checkbox" data-remind checked> Set a reminder at 09:00 on the due day</label>
        <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
          <button data-confirm type="button" class="btn-primary">Save the meeting note${result.actions.length ? ' and create the tasks' : ''}</button>
          <button data-back type="button" class="btn-secondary">Close without saving</button>
        </div>
      </div>`;
      body.querySelector('[data-back]').addEventListener('click', close);
      body.querySelector('[data-confirm]').addEventListener('click', async () => {
        const chosen = [];
        result.actions.forEach((a, i) => {
          if (!body.querySelector(`[data-pick="${i}"]`).checked) return;
          const text = body.querySelector(`[data-text="${i}"]`).value.trim();
          if (text) chosen.push({ text, due: body.querySelector(`[data-due="${i}"]`).value });
        });
        const remind = body.querySelector('[data-remind]').checked;
        const final = { ...result, summary: body.querySelector('[data-summary]').value.trim(), actions: chosen.map(c => ({ text: c.text, owner: '', due: c.due })) };
        const dated = chosen.filter(c => c.due).length;
        const ok = await window.vexConfirm({
          title: 'Save this meeting?',
          message: 'A note is saved' + (session.event ? ' for "' + session.event.summary + '"' : '') + '. '
            + chosen.length + ' task' + (chosen.length === 1 ? '' : 's') + ' go to your To-do note'
            + (remind && dated ? ', and ' + dated + ' reminder' + (dated === 1 ? '' : 's') + ' are set' : '') + '.',
          okLabel: 'Save',
        });
        if (!ok) return;
        try {
          this.saveNote(session, final);
          const r = await this.createFollowUps(chosen, { reminders: remind });
          this.discard();
          if (r.failed.length) fail(new Error(r.failed.length + ' task' + (r.failed.length === 1 ? '' : 's') + ' could not be created: ' + r.failed[0].error));
          window.showToast?.('Saved the meeting note · ' + r.tasks + ' task' + (r.tasks === 1 ? '' : 's') + (r.reminders ? ' · ' + r.reminders + ' reminder' + (r.reminders === 1 ? '' : 's') : ''));
          close();
        } catch (err) { fail(err); }
      });
    };

    head.insertAdjacentHTML('beforeend', `<button data-close type="button" aria-label="Close" style="display:inline-flex;background:none;border:none;cursor:pointer;color:var(--text-muted)">${window.VexIcons.svg('x', { size: 15 })}</button>`);
    head.querySelector('[data-close]').addEventListener('click', close);
    let running = null;
    try { running = this.current(); } catch (err) { fail(err); }
    if (running && !running.endedAt) drawLive(); else await drawBefore();
    return close;
  },

  // --- command bar and Settings, added at runtime ----------------------------
  registerCommands() {
    if (typeof CommandBar === 'undefined' || !Array.isArray(CommandBar.commands)) return false;
    CommandBar.commands = CommandBar.commands.filter(c => !String(c.id || '').startsWith('meeting-copilot'));
    CommandBar.commands.push(
      { id: 'meeting-copilot', label: 'Meeting Copilot (notes with decisions and actions)', hint: 'Agenda and last notes before, timestamped notes during, summary and tasks after', icon: 'calendar', action: () => this.open().catch(err => window.showToast?.(err.message, 'error')) },
    );
    return true;
  },

  injectSettings() {
    const content = typeof document !== 'undefined' ? document.querySelector('#panel-settings .settings-content') : null;
    if (!content || content.querySelector('#setting-meeting-copilot')) return false;
    const group = document.createElement('div');
    group.className = 'setting-group';
    group.id = 'setting-meeting-copilot';
    group.dataset.keywords = 'meeting notes decision action item summary minutes calendar';
    group.innerHTML = `<label class="setting-label">Meeting copilot</label>
      <div class="setting-info muted">Typed notes with the time on each line, marked as decision, action or question with one key. When the meeting ends your local model writes the summary and action items, and you confirm before any task or reminder is made. Vex never records audio or the screen.</div>
      <div style="margin-top:8px"><button type="button" class="btn-secondary" data-open>Open the meeting copilot</button></div>`;
    group.querySelector('[data-open]').addEventListener('click', () => this.open().catch(err => window.showToast?.(err.message, 'error')));
    content.appendChild(group);
    return true;
  },

  init() {
    if (this._inited) return;
    this._inited = true;
    this.registerCommands();
    this.injectSettings();
  },
};

if (typeof window !== 'undefined') window.MeetingCopilot = MeetingCopilot;
if (typeof module !== 'undefined' && module.exports) module.exports = { MeetingCopilot };
