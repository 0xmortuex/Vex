// === Past-paper session recorder ===============================================
//
// For a mock exam or a past paper: a timer, a question log and a score. Press "Wrong" on a
// question you missed and note the topic (and, if text is selected on the page, it is taken
// as the question). When the paper is over the mistakes are a revision list you can send to
// FlashMind as a CSV of cards (front = the question, back = what you should have done,
// category = the topic). FlashMind keeps the cards and the repetition schedule; this keeps
// only the sessions. Nothing leaves this computer.
//
//   VexPaperSession.summarize(session)   pure: score, percent, by topic, pace, mistakes
//   VexPaperSession.mistakeCards(s)      pure: the cards of the wrong questions
//   VexPaperSession.toMarkdown(s)        pure: a note
//
// Not built: a screenshot of the question stored with a mistake (images are too large for
// the local store; the selected text or a typed note is used instead).
const VexPaperSession = {
  KEY: 'vex.paperSessions',
  PREF: 'vex.paperSessions.enabled',
  MAX_SESSIONS: 60,
  MAX_QUESTIONS: 200,
  _tickTimer: null,

  enabled() { try { return localStorage.getItem(this.PREF) !== 'off'; } catch { return true; } },
  setEnabled(on) { localStorage.setItem(this.PREF, on ? 'on' : 'off'); },

  // ---- store -----------------------------------------------------------------------
  _read() {
    let raw = null;
    try { raw = localStorage.getItem(this.KEY); } catch (err) { throw new Error('The paper sessions could not be read: ' + err.message); }
    if (!raw) return { sessions: [], running: null };
    let o;
    try { o = JSON.parse(raw); } catch (err) { throw new Error('The saved paper sessions are damaged: ' + err.message); }
    return { sessions: Array.isArray(o && o.sessions) ? o.sessions.filter(s => s && typeof s.id === 'string') : [], running: o && o.running && typeof o.running === 'object' ? o.running : null };
  },
  _write(d) {
    try { localStorage.setItem(this.KEY, JSON.stringify({ sessions: d.sessions.slice(-this.MAX_SESSIONS), running: d.running })); }
    catch (err) { throw new Error('The paper sessions could not be saved: ' + err.message, { cause: err }); }
  },
  sessions() { return this._read().sessions; },
  running() { return this._read().running; },

  // ---- pure --------------------------------------------------------------------------
  // elapsed ms of a session at `now` (pauses are not counted).
  elapsed(s, now = Date.now()) {
    const end = s.endedAt || (s.pausedAt || now);
    return Math.max(0, end - s.startedAt - (s.pausedMs || 0));
  },
  summarize(s) {
    const qs = s.questions || [];
    const scored = qs.filter(q => Number.isFinite(q.marks) && Number.isFinite(q.got));
    const got = scored.reduce((a, q) => a + q.got, 0);
    const total = Number.isFinite(s.totalMarks) ? s.totalMarks : scored.reduce((a, q) => a + q.marks, 0);
    const gotFinal = Number.isFinite(s.scoreEntered) ? s.scoreEntered : got;
    const byTopic = {};
    for (const q of qs) {
      const t = q.topic || 'No topic';
      const e = byTopic[t] || (byTopic[t] = { topic: t, questions: 0, wrong: 0, lost: 0 });
      e.questions++;
      if (q.wrong) e.wrong++;
      if (Number.isFinite(q.marks) && Number.isFinite(q.got)) e.lost += q.marks - q.got;
    }
    const topics = Object.values(byTopic).sort((a, b) => b.wrong - a.wrong || b.lost - a.lost);
    const ms = s.durationMs != null ? s.durationMs : this.elapsed(s);
    return {
      questions: qs.length, wrong: qs.filter(q => q.wrong).length,
      score: gotFinal, total, percent: total > 0 ? Math.round(gotFinal / total * 1000) / 10 : null,
      minutes: Math.round(ms / 6000) / 10,
      perQuestionMin: qs.length ? Math.round(ms / qs.length / 6000) / 10 : null,
      overTime: Number.isFinite(s.plannedMin) && s.plannedMin > 0 && ms > s.plannedMin * 60000,
      topics,
    };
  },
  mistakeCards(s) {
    return (s.questions || []).filter(q => q.wrong).map(q => ({
      front: (q.text || ('Question ' + q.no + (s.paper ? ' of ' + s.paper : ''))).slice(0, 1500),
      back: (q.note || 'Redo this question and write down where it went wrong.').slice(0, 1500),
      difficulty: 'hard',
      category: q.topic || s.course || 'Past paper',
    }));
  },
  toMarkdown(s) {
    const m = this.summarize(s);
    const lines = ['# ' + (s.paper || 'Past paper') + (s.course ? ' - ' + s.course : ''), '', new Date(s.startedAt).toLocaleString() + ' | ' + m.minutes + ' min' + (s.plannedMin ? ' of ' + s.plannedMin : '') + (m.percent != null ? ' | ' + m.score + '/' + m.total + ' (' + m.percent + '%)' : ''), ''];
    if (m.topics.length) { lines.push('## By topic', ''); for (const t of m.topics) lines.push('- ' + t.topic + ': ' + t.wrong + ' wrong of ' + t.questions + (t.lost ? ', ' + t.lost + ' marks lost' : '')); lines.push(''); }
    const wrong = (s.questions || []).filter(q => q.wrong);
    if (wrong.length) { lines.push('## Revise', ''); for (const q of wrong) lines.push('- Q' + q.no + (q.topic ? ' [' + q.topic + ']' : '') + (q.text ? ': ' + q.text : '') + (q.note ? ' - ' + q.note : '')); }
    return lines.join('\n') + '\n';
  },

  // ---- running a session -------------------------------------------------------------------
  start({ course, paper, plannedMin, totalMarks }) {
    if (!this.enabled()) throw new Error('The paper recorder is switched off in Settings');
    const d = this._read();
    if (d.running) throw new Error('A paper is already being recorded');
    const planned = Number(plannedMin);
    if (plannedMin != null && plannedMin !== '' && !(Number.isFinite(planned) && planned >= 1 && planned <= 600)) throw new Error('Length is 1 to 600 minutes');
    const tm = totalMarks == null || totalMarks === '' ? null : Number(totalMarks);
    if (tm != null && !(Number.isFinite(tm) && tm > 0 && tm <= 10000)) throw new Error('Total marks must be a positive number');
    d.running = { id: vexId('ps'), course: String(course || '').trim().slice(0, 80), paper: String(paper || 'Past paper').trim().slice(0, 100), startedAt: Date.now(), pausedMs: 0, plannedMin: Number.isFinite(planned) && planned > 0 ? planned : null, totalMarks: tm, questions: [] };
    this._write(d);
    return d.running;
  },
  _need() {
    const d = this._read();
    if (!d.running) throw new Error('No paper is being recorded');
    return d;
  },
  pause() { const d = this._need(); if (d.running.pausedAt) throw new Error('Already paused'); d.running.pausedAt = Date.now(); this._write(d); return d.running; },
  resume() { const d = this._need(); if (!d.running.pausedAt) throw new Error('Not paused'); d.running.pausedMs += Date.now() - d.running.pausedAt; delete d.running.pausedAt; this._write(d); return d.running; },
  // q: { topic, marks, got, wrong, text, note }; the number is the next one.
  logQuestion(q) {
    const d = this._need();
    if (d.running.questions.length >= this.MAX_QUESTIONS) throw new Error('At most ' + this.MAX_QUESTIONS + ' questions in one paper');
    const num = (x) => (x === '' || x == null ? null : Number(x));
    const marks = num(q.marks), got = num(q.got);
    if (marks != null && !(Number.isFinite(marks) && marks >= 0)) throw new Error('Marks must be a number');
    if (got != null && !(Number.isFinite(got) && got >= 0)) throw new Error('Marks got must be a number');
    if (marks != null && got != null && got > marks) throw new Error('You cannot get more than the question is worth');
    const item = { no: d.running.questions.length + 1, at: Date.now(), topic: String(q.topic || '').trim().slice(0, 60), marks, got, wrong: q.wrong === true || (marks != null && got != null && got < marks && q.wrong !== false), text: String(q.text || '').replace(/\s+/g, ' ').trim().slice(0, 1500), note: String(q.note || '').trim().slice(0, 1500) };
    d.running.questions.push(item);
    this._write(d);
    return item;
  },
  // Marks the last logged question wrong (the one-press button).
  markLastWrong(extra = {}) {
    const d = this._need();
    const q = d.running.questions[d.running.questions.length - 1];
    if (!q) throw new Error('Log a question first');
    q.wrong = true;
    if (extra.topic) q.topic = String(extra.topic).trim().slice(0, 60);
    if (extra.note) q.note = String(extra.note).trim().slice(0, 1500);
    if (extra.text) q.text = String(extra.text).replace(/\s+/g, ' ').trim().slice(0, 1500);
    this._write(d);
    return q;
  },
  finish({ scoreEntered } = {}) {
    const d = this._need();
    const r = d.running;
    if (r.pausedAt) { r.pausedMs += Date.now() - r.pausedAt; delete r.pausedAt; }
    r.endedAt = Date.now();
    r.durationMs = r.endedAt - r.startedAt - r.pausedMs;
    if (scoreEntered != null && scoreEntered !== '') {
      const v = Number(scoreEntered);
      if (!Number.isFinite(v) || v < 0) throw new Error('The score must be a number');
      r.scoreEntered = v;
    }
    d.sessions.push(r);
    d.running = null;
    this._write(d);
    return r;
  },
  discard() { const d = this._read(); d.running = null; this._write(d); },
  remove(id) { const d = this._read(); d.sessions = d.sessions.filter(s => s.id !== id); this._write(d); },

  // The text selected in the page in front, or ''.
  async selection() {
    if (typeof WebviewManager === 'undefined') return '';
    const wv = WebviewManager.getActiveWebview();
    const url = wv && wv.getURL ? wv.getURL() : '';
    if (!wv || !/^https?:/i.test(url)) return '';
    // A private or Tor page is never read.
    if (window.VexTabPolicy && !window.VexTabPolicy.canReadWebview(wv)) return '';
    return String((await window.vexGuestEval(wv, 'String(getSelection()).slice(0, 1500)', false, 4000)) || '');
  },

  // ---- screens -------------------------------------------------------------------------------
  open() {
    if (typeof VexUsage !== 'undefined') VexUsage.touch('paper-session');
    const G = VexSettingsGroups;
    const { body, overlay } = G.dialog({ id: 'vex-paper', title: 'Past-paper session', sub: 'A timer, a question log and a score. Mistakes become a revision list for FlashMind.' });
    let timer = null;
    const stop = () => clearTimeout(timer);
    const observer = new MutationObserver(() => { if (!overlay.isConnected) { stop(); observer.disconnect(); } });
    observer.observe(document.body, { childList: true });
    const draw = () => {
      stop();
      body.textContent = '';
      const run = this.running();
      if (!run) return drawIdle();
      const clock = G.note('');
      const upd = () => {
        const ms = this.elapsed(run);
        const left = run.plannedMin ? run.plannedMin * 60000 - ms : null;
        const f = (x) => { const s = Math.floor(Math.abs(x) / 1000); return (x < 0 ? '-' : '') + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
        clock.textContent = (run.paper || 'Paper') + ' | ' + f(ms) + (left != null ? ' | ' + (left >= 0 ? f(left) + ' left' : f(left) + ' over time') : '') + (run.pausedAt ? ' | paused' : '') + ' | ' + run.questions.length + ' logged';
        if (overlay.isConnected) timer = setTimeout(upd, 1000);
      };
      upd();
      body.appendChild(clock);
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin:8px 0';
      row.append(
        G.button(run.pausedAt ? 'Resume' : 'Pause', () => { try { if (run.pausedAt) this.resume(); else this.pause(); draw(); } catch (e) { window.showToast?.(e.message, 'error'); } }),
        G.button('Log a question', async () => { try { await this._logDialog(false); draw(); } catch (e) { window.showToast?.(e.message, 'error'); } }, { primary: true }),
        G.button('Wrong', async () => { try { await this._logDialog(true); draw(); } catch (e) { window.showToast?.(e.message, 'error'); } }, { danger: true }),
        G.button('Finish the paper', async () => { try { await this._finishDialog(); draw(); } catch (e) { window.showToast?.(e.message, 'error'); } }),
        G.button('Discard', async () => { if (await window.vexConfirm({ title: 'Discard this recording?', message: 'The log of this paper is deleted.', okLabel: 'Discard', danger: true })) { this.discard(); draw(); } }, { danger: true }),
      );
      body.appendChild(row);
      for (const q of run.questions.slice().reverse()) body.appendChild(G.note('Q' + q.no + (q.topic ? ' [' + q.topic + ']' : '') + (q.marks != null ? ' ' + (q.got != null ? q.got : '?') + '/' + q.marks : '') + (q.wrong ? ' WRONG' : '')));
    };
    const drawIdle = () => {
      body.appendChild(G.button('Start a paper', async () => { try { await this._startDialog(); draw(); } catch (e) { window.showToast?.(e.message, 'error'); } }, { primary: true }));
      const list = this.sessions().slice().reverse();
      if (!list.length) body.appendChild(G.note('No papers recorded yet.'));
      for (const s of list.slice(0, 20)) {
        const m = this.summarize(s);
        const box = document.createElement('div');
        box.className = 'vexsr-rule'; box.style.cssText = 'display:block;margin:10px 0';
        box.appendChild(G.note(new Date(s.startedAt).toLocaleDateString() + ' ' + (s.paper || '') + (s.course ? ' (' + s.course + ')' : '') + ' | ' + m.minutes + ' min' + (m.percent != null ? ' | ' + m.percent + '%' : '') + ' | ' + m.wrong + ' wrong'));
        const r = document.createElement('div'); r.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
        r.append(
          G.button('Mistakes to FlashMind (CSV)', () => this.exportCards(s)),
          G.button('Save as a note', () => { try { AgentTools.saveNote((s.paper || 'Past paper') + ' review', this.toMarkdown(s)); window.showToast?.('Saved to Notes'); } catch (e) { window.showToast?.(e.message, 'error'); } }),
          G.button('Delete', async () => { if (await window.vexConfirm({ title: 'Delete this record?', message: s.paper || '', okLabel: 'Delete', danger: true })) { this.remove(s.id); draw(); } }, { danger: true }),
        );
        box.appendChild(r);
        body.appendChild(box);
      }
    };
    draw();
  },
  exportCards(s) {
    if (typeof FlashMindBridge === 'undefined') throw new Error('The FlashMind bridge is not available');
    const cards = this.mistakeCards(s);
    if (!cards.length) { window.showToast?.('No wrong questions in this paper'); return 0; }
    FlashMindBridge.saveFile(FlashMindBridge.fileName((s.paper || 'paper') + ' mistakes', '.csv'), FlashMindBridge.cardsToCsv(cards), 'text/csv');
    window.showToast?.(cards.length + ' card(s) saved: drop the file into FlashMind');
    return cards.length;
  },
  async _startDialog() {
    const P = (o) => window.vexPrompt(o);
    const course = await P({ title: 'Which course?', label: 'Course', okLabel: 'Next' });
    if (course == null) return;
    const paper = await P({ title: 'Which paper?', label: 'Paper', placeholder: '2024 Paper 1', okLabel: 'Next' });
    if (paper == null) return;
    const mins = await P({ title: 'Time allowed', message: 'Minutes (empty for no limit).', label: 'Minutes', value: '90', okLabel: 'Next' });
    if (mins == null) return;
    const marks = await P({ title: 'Total marks', message: 'Empty to add up the questions you log.', label: 'Marks', okLabel: 'Start' });
    if (marks == null) return;
    this.start({ course, paper, plannedMin: mins, totalMarks: marks });
  },
  async _logDialog(wrong) {
    const P = (o) => window.vexPrompt(o);
    const sel = await this.selection();
    const topic = await P({ title: wrong ? 'Wrong: which topic?' : 'Which topic?', label: 'Topic', okLabel: 'Next' });
    if (topic == null) return;
    const marksText = await P({ title: 'Marks', message: 'What it is worth and what you got, like "5/3". Empty to skip.', label: 'Got/worth', okLabel: 'Next' });
    if (marksText == null) return;
    let marks = null, got = null;
    if (marksText.trim()) { const m = /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/.exec(marksText.trim()); if (!m) throw new Error('Write it as got/worth, like 3/5'); got = Number(m[1]); marks = Number(m[2]); }
    const note = await P({ title: wrong ? 'What should you have done?' : 'A note (optional)', message: sel ? 'The selected text will be kept as the question.' : '', label: 'Note', multiline: true, okLabel: 'Save' });
    if (note == null) return;
    this.logQuestion({ topic, marks, got, wrong: wrong ? true : undefined, text: sel, note });
  },
  async _finishDialog() {
    const v = await window.vexPrompt({ title: 'Your score', message: 'Marks you were given or expect. Leave empty to use the questions you logged.', label: 'Score', okLabel: 'Finish' });
    if (v == null) return;
    const s = this.finish({ scoreEntered: v });
    const m = this.summarize(s);
    window.showToast?.('Saved: ' + m.minutes + ' min' + (m.percent != null ? ', ' + m.percent + '%' : '') + ', ' + m.wrong + ' wrong');
  },

  group(el) {
    const G = VexSettingsGroups;
    el.appendChild(G.note('Time a past paper, log each question, press Wrong on the ones you miss. Mistakes become a CSV of cards for FlashMind. Local only.'));
    el.appendChild(G.button('Open the paper recorder', () => this.open(), { primary: true }));
  },
};

if (typeof window !== 'undefined') {
  window.VexPaperSession = VexPaperSession;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'paper-session', title: 'Past papers', keywords: 'past paper mock exam timer score mistakes wrong flashmind', build: (el) => VexPaperSession.group(el) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'paper-session', label: 'Past-Paper Session', hint: 'Timer, question log and score for a past paper', icon: 'clock', action: () => VexPaperSession.open() });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexPaperSession };
