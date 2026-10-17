// === Study entry points: FlashMind from the page you are reading ===============
//
// FlashMind keeps the cards and the repetition schedule (js/flashmind-bridge.js is the glue to
// it). This file adds only the doors into it from Vex:
//
//   Quiz me from this page   right-click / Ctrl+K: the page or the selection goes to the clipboard
//                            as study text headed with the current course's deck, and that deck
//                            (or the FlashMind panel) opens. FlashMind accepts no deep link, so
//                            "preselected" means: the deck is named and opened, you paste.
//   Mistake journal          the wrong questions of every past-paper session (js/paper-session.js)
//                            as a reading queue: topics with most misses first, unread first.
//                            Read marks are kept here; the sessions themselves are not changed.
//   Vocabulary               a word you select, with the sentence it stood in and the page it came
//                            from, kept on this PC; exported as a FlashMind CSV
//                            (front,back,difficulty,category).
//   Teach-back questions     after reading, your LOCAL model writes questions whose answers each
//                            carry a quote; a quote that is not on the page drops the question.
//                            Nothing is saved until you look at them and confirm.
//
// Nothing here talks to FlashMind or to any server. The model is the local one only.
//
// Pure helpers (sentenceAround, vocabCards, mistakeQueue, parseTeachBack, checkTeachBack ...) have
// no DOM and are tested directly (tests/renderer/studyEntry.test.js).
const VexStudyEntry = {
  FEATURE: 'study-entry',
  PREF: 'vex.studyEntry.enabled',
  KEY_VOCAB: 'vex.studyEntry.vocab',
  KEY_READ: 'vex.studyEntry.mistakesRead',
  MAX_VOCAB: 500,
  MAX_READ: 2000,
  MAX_WORD: 60,
  MAX_QUESTIONS: 5,

  enabled() { try { return localStorage.getItem(this.PREF) !== 'off'; } catch { return true; } },
  setEnabled(on) {
    try { localStorage.setItem(this.PREF, on ? 'on' : 'off'); }
    catch (err) { throw new Error('The setting could not be saved: ' + err.message, { cause: err }); }
    return !!on;
  },
  _need() { if (!this.enabled()) throw new Error('Study entry points are switched off in Settings'); },

  // ---- storage -------------------------------------------------------------------------
  _readJson(key, fallback, what) {
    let raw = null;
    try { raw = localStorage.getItem(key); } catch (err) { throw new Error('The ' + what + ' could not be read: ' + err.message, { cause: err }); }
    if (!raw) return fallback;
    try { return JSON.parse(raw); } catch (err) { throw new Error('The saved ' + what + ' are damaged: ' + err.message, { cause: err }); }
  },
  _writeJson(key, value, what) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch (err) { throw new Error('The ' + what + ' could not be saved: ' + err.message, { cause: err }); }
  },
  vocab() {
    const a = this._readJson(this.KEY_VOCAB, [], 'vocabulary');
    return (Array.isArray(a) ? a : []).filter(v => v && typeof v.id === 'string' && typeof v.word === 'string' && typeof v.sentence === 'string');
  },
  read() {
    const o = this._readJson(this.KEY_READ, {}, 'reading marks');
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  },

  // ---- the deck ---------------------------------------------------------------------------
  // The deck name FlashMind should receive: the current course's deck, else its name.
  deckName(course) {
    if (!course) return '';
    return String(course.deck || course.name || '').trim().slice(0, 100);
  },
  _course() {
    try { return typeof VexCourseSpaces !== 'undefined' && VexCourseSpaces.enabled() ? VexCourseSpaces.current() : null; }
    catch (err) { throw new Error('The current course could not be read: ' + err.message, { cause: err }); }
  },

  // ---- Quiz me from this page ---------------------------------------------------------------
  // item: { title, url, body } -> the text to paste, headed with the deck.
  quizText(item, deck) {
    if (typeof FlashMindBridge === 'undefined') throw new Error('The FlashMind bridge is not available');
    const body = String(item && item.body || '').trim();
    if (!body) throw new Error('There is nothing to quiz you on');
    const head = deck ? 'Deck: ' + deck + ' - ' + String(item.title || '').trim() : String(item.title || '').trim();
    return FlashMindBridge.studyText({ title: head, url: item.url, body });
  },

  // selectionText: what the context menu says is selected ('' for none).
  async quizFromPage(selectionText) {
    this._need();
    if (typeof FlashMindBridge === 'undefined') throw new Error('The FlashMind bridge is not available');
    const sel = String(selectionText || '').trim();
    const item = sel.length >= 20 ? await FlashMindBridge.fromSelection() : await FlashMindBridge.fromPage();
    const course = this._course();
    const deck = this.deckName(course);
    await FlashMindBridge.copy(this.quizText(item, deck));
    if (course && typeof VexCourseSpaces.openDeck === 'function') VexCourseSpaces.openDeck(course.id);
    else FlashMindBridge.openPanel();
    window.showToast?.(deck ? 'Copied for FlashMind. Open the deck "' + deck + '", choose Paste and paste it.' : 'Copied for FlashMind. Choose Paste there and paste it.');
    if (typeof VexUsage !== 'undefined') VexUsage.touch(this.FEATURE);
    return { deck, chars: item.body.length };
  },

  // ---- Vocabulary -----------------------------------------------------------------------------
  // The sentence of `context` that holds `word`, or the context's start when none does.
  sentenceAround(context, word) {
    const ctx = String(context == null ? '' : context).replace(/\s+/g, ' ').trim();
    const w = String(word == null ? '' : word).replace(/\s+/g, ' ').trim();
    if (!w) throw new Error('Select a word first');
    if (w.length > this.MAX_WORD || w.split(' ').length > 4) throw new Error('Select one word or a short phrase, not a sentence');
    if (!ctx) throw new Error('The sentence around the word could not be read');
    const parts = ctx.split(/(?<=[.!?…])["')\]]*\s+/).map(s => s.trim()).filter(Boolean);
    const low = w.toLowerCase();
    const hit = parts.find(p => p.toLowerCase().includes(low));
    if (!hit) throw new Error('The word was not found in the text around it');
    return hit.length > 400 ? hit.slice(0, 400).replace(/\s+\S*$/, '') + '...' : hit;
  },

  addWord({ word, sentence, url, title }, now = Date.now()) {
    const w = String(word || '').replace(/\s+/g, ' ').trim();
    if (!w || w.length > this.MAX_WORD) throw new Error('A word is 1 to ' + this.MAX_WORD + ' characters');
    const s = String(sentence || '').replace(/\s+/g, ' ').trim().slice(0, 500);
    if (!s) throw new Error('A word needs the sentence it stood in');
    const u = /^https?:\/\//i.test(String(url || '')) ? String(url).slice(0, 2048) : '';
    const list = this.vocab();
    const dup = list.find(v => v.word.toLowerCase() === w.toLowerCase() && v.sentence === s);
    if (dup) return { entry: dup, added: false };
    if (list.length >= this.MAX_VOCAB) throw new Error('That is ' + this.MAX_VOCAB + ' words already: export and clear some first');
    const entry = { id: (typeof vexId === 'function' ? vexId('vw') : 'vw_' + now.toString(36) + Math.random().toString(36).slice(2, 6)), word: w, sentence: s, url: u, title: String(title || '').replace(/\s+/g, ' ').trim().slice(0, 200), at: now };
    list.push(entry);
    this._writeJson(this.KEY_VOCAB, list, 'vocabulary');
    return { entry, added: true };
  },
  removeWord(id) { this._writeJson(this.KEY_VOCAB, this.vocab().filter(v => v.id !== id), 'vocabulary'); },
  clearVocab() { this._writeJson(this.KEY_VOCAB, [], 'vocabulary'); },

  // The cards FlashMind's CSV takes: front = the word, back = the sentence and where it came from.
  vocabCards(list, deck) {
    return (Array.isArray(list) ? list : []).filter(v => v && v.word && v.sentence).map(v => {
      const from = [v.title, v.url].filter(Boolean).join(' - ');
      return { front: v.word, back: v.sentence + (from ? '\nSource: ' + from : ''), difficulty: 'medium', category: deck || 'Vocabulary' };
    });
  },
  vocabCsv(list, deck) {
    if (typeof FlashMindBridge === 'undefined') throw new Error('The FlashMind bridge is not available');
    const cards = this.vocabCards(list, deck);
    if (!cards.length) throw new Error('There are no saved words to export');
    return FlashMindBridge.cardsToCsv(cards);
  },

  _SELECTION_CODE: "(function(){try{var s=window.getSelection();if(!s||s.isCollapsed)return null;var w=String(s).trim();var n=s.anchorNode;var el=n&&(n.nodeType===1?n:n.parentElement);var blk=el&&el.closest?el.closest('p,li,blockquote,td,dd,h1,h2,h3,h4,div'):null;return {word:w.slice(0,200),context:String((blk||el||{}).innerText||'').slice(0,4000)};}catch(e){return null;}})()",

  async saveSelectedWord() {
    this._need();
    if (typeof FlashMindBridge === 'undefined') throw new Error('The FlashMind bridge is not available');
    const { tab, wv } = FlashMindBridge._active();   // refuses private, Tor and routed tabs
    const got = await window.vexGuestEval(wv, this._SELECTION_CODE, false, 4000);
    if (!got || typeof got.word !== 'string' || !got.word) throw new Error('Select a word on the page first');
    const sentence = this.sentenceAround(got.context, got.word);
    const r = this.addWord({ word: got.word, sentence, url: tab.url, title: tab.title });
    window.showToast?.(r.added ? 'Saved "' + r.entry.word + '" with its sentence' : 'You already saved that word from this sentence');
    if (typeof VexUsage !== 'undefined') VexUsage.touch(this.FEATURE);
    return r;
  },

  exportVocab() {
    this._need();
    const deck = this.deckName(this._course());
    const csv = this.vocabCsv(this.vocab(), deck);
    FlashMindBridge.saveFile(FlashMindBridge.fileName('vocabulary', '.csv'), csv, 'text/csv');
    window.showToast?.(this.vocab().length + ' word(s) saved as a file: drop it into FlashMind');
    return csv;
  },

  // ---- Mistake journal ---------------------------------------------------------------------------
  // Wrong questions of finished past-paper sessions as a reading queue.
  // -> [{ id, sessionId, paper, course, topic, no, text, note, url, at, read }]
  //    unread first; within them the topics missed most come first, then oldest first.
  mistakeQueue(sessions, read) {
    const done = read && typeof read === 'object' ? read : {};
    const items = [];
    for (const s of (Array.isArray(sessions) ? sessions : [])) {
      if (!s || typeof s.id !== 'string') continue;
      for (const q of (s.questions || [])) {
        if (!q || !q.wrong) continue;
        const id = s.id + ':' + q.no;
        items.push({
          id, sessionId: s.id, paper: s.paper || 'Past paper', course: s.course || '', topic: q.topic || 'No topic', no: q.no,
          text: q.text || '', note: q.note || '', url: /^https?:\/\//i.test(String(q.url || '')) ? q.url : '', at: q.at || s.startedAt || 0,
          read: Object.prototype.hasOwnProperty.call(done, id),
        });
      }
    }
    const misses = new Map();
    for (const i of items) misses.set(i.topic, (misses.get(i.topic) || 0) + 1);
    return items.sort((a, b) => (a.read - b.read) || (misses.get(b.topic) - misses.get(a.topic)) || a.topic.localeCompare(b.topic) || (a.at - b.at));
  },
  markRead(id, on = true) {
    const read = this.read();
    if (on) read[id] = Date.now(); else delete read[id];
    const keys = Object.keys(read);
    if (keys.length > this.MAX_READ) for (const k of keys.sort((a, b) => read[a] - read[b]).slice(0, keys.length - this.MAX_READ)) delete read[k];
    this._writeJson(this.KEY_READ, read, 'reading marks');
  },
  queue() {
    if (typeof VexPaperSession === 'undefined') throw new Error('The past-paper recorder is not available');
    return this.mistakeQueue(VexPaperSession.sessions(), this.read());
  },
  // Cards of the unread items, for FlashMind.
  queueCards(queue) {
    return (queue || []).filter(i => !i.read).map(i => ({
      front: (i.text || ('Question ' + i.no + ' of ' + i.paper)).slice(0, 1500),
      back: (i.note || 'Redo this question and write down where it went wrong.').slice(0, 1500),
      difficulty: 'hard', category: i.topic,
    }));
  },

  openMistakes() {
    this._need();
    if (typeof VexUsage !== 'undefined') VexUsage.touch(this.FEATURE);
    const G = VexSettingsGroups;
    const { body } = G.dialog({ id: 'vex-mistakes', title: 'Mistake journal', sub: 'The questions you got wrong in past papers, as a reading queue: topics you miss most come first.' });
    const fail = (e) => window.showToast?.(e.message, 'error');
    const draw = () => {
      body.textContent = '';
      let q;
      try { q = this.queue(); } catch (e) { body.appendChild(G.note(e.message)); return; }
      if (!q.length) { body.appendChild(G.note('No wrong questions yet. Press Wrong while recording a past paper.')); return; }
      const unread = q.filter(i => !i.read).length;
      body.appendChild(G.note(unread + ' to read again, ' + (q.length - unread) + ' read.'));
      const top = document.createElement('div'); top.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin:8px 0';
      top.appendChild(G.button('Unread as FlashMind cards (CSV)', () => {
        try {
          const cards = this.queueCards(q);
          if (!cards.length) throw new Error('Everything is marked read');
          FlashMindBridge.saveFile(FlashMindBridge.fileName('mistake journal', '.csv'), FlashMindBridge.cardsToCsv(cards), 'text/csv');
          window.showToast?.(cards.length + ' card(s) saved: drop the file into FlashMind');
        } catch (e) { fail(e); }
      }));
      body.appendChild(top);
      let topic = null;
      for (const i of q) {
        if (i.topic !== topic) { topic = i.topic; const h = G.note(i.topic); h.style.fontWeight = '600'; body.appendChild(h); }
        const box = document.createElement('div');
        box.className = 'vexsr-rule'; box.style.cssText = 'display:block;margin:6px 0' + (i.read ? ';opacity:.6' : '');
        box.appendChild(G.note('Q' + i.no + ' of ' + i.paper + (i.course ? ' (' + i.course + ')' : '') + (i.text ? ': ' + i.text : '') + (i.note ? ' - ' + i.note : '')));
        const r = document.createElement('div'); r.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
        if (i.url) r.appendChild(G.button('Open the page', () => { if (typeof TabManager !== 'undefined') TabManager.createTab(i.url, true); }));
        r.appendChild(G.button(i.read ? 'Mark unread' : 'Mark read', () => { try { this.markRead(i.id, !i.read); draw(); } catch (e) { fail(e); } }));
        box.appendChild(r);
        body.appendChild(box);
      }
    };
    draw();
  },

  // ---- Teach-back questions -------------------------------------------------------------------
  teachBackPrompt(title, body) {
    const text = String(body || '').replace(/\s+/g, ' ').trim().slice(0, 9000);
    if (!text) throw new Error('There is no page text to ask about');
    return 'Write up to ' + this.MAX_QUESTIONS + ' questions that test whether a reader understood the text below. Use ONLY the text. ' +
      'Reply as JSON: {"cards": [{"question": "...", "answer": "...", "quote": "words copied exactly from the text that prove the answer, 12 to 30 words"}]}. ' +
      'Every card needs a quote copied word for word from the text.\n\nTitle: ' + String(title || '').slice(0, 200) + '\nText: ' + text;
  },

  // The model's reply -> [{ question, answer, quote }]. Throws when it holds no cards at all.
  parseTeachBack(result) {
    let o = result && typeof result === 'object' && result.result !== undefined && !Array.isArray(result.cards) ? result.result : result;
    if (typeof o === 'string') {
      const raw = o.trim();
      const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
      if (a < 0 || b <= a) throw new Error('The local model did not answer in the form asked for. Try again.');
      try { o = JSON.parse(raw.slice(a, b + 1)); }
      catch (err) { throw new Error('The local model\'s answer could not be read: ' + err.message, { cause: err }); }
    }
    if (!o || typeof o !== 'object' || !Array.isArray(o.cards)) throw new Error('The local model returned no questions. Try again.');
    return o.cards.slice(0, this.MAX_QUESTIONS * 2)
      .filter(c => c && typeof c.question === 'string' && typeof c.answer === 'string')
      .map(c => ({ question: c.question.trim().slice(0, 400), answer: c.answer.trim().slice(0, 800), quote: String(c.quote || '').trim().slice(0, 600) }));
  },

  // Keeps only the questions whose quote is really on the page and whose answer shares words with it.
  checkTeachBack(cards, pageText) {
    if (typeof VexAnswerCitations === 'undefined') throw new Error('The citation checker is not loaded, so no question can be checked');
    const kept = [], dropped = [];
    for (const c of cards) {
      let why = '';
      if (!c.question || !c.answer) why = 'Empty question or answer.';
      else if (!c.quote) why = 'No quote given.';
      else if (VexAnswerCitations.find(pageText, c.quote) < 0) why = 'The quote is not on the page.';
      else if (VexAnswerCitations.shared(c.answer, c.quote) < 1) why = 'The answer has nothing in common with its quote.';
      if (why) dropped.push({ question: c.question, reason: why }); else kept.push(c);
      if (kept.length >= this.MAX_QUESTIONS) break;
    }
    return { kept, dropped };
  },

  teachBackCards(kept, deck, title) {
    return kept.map(c => ({ front: c.question, back: c.answer + '\nFrom the page: "' + c.quote + '"', difficulty: 'medium', category: deck || String(title || '').slice(0, 60) || 'Teach-back' }));
  },

  async teachBack() {
    this._need();
    if (typeof FlashMindBridge === 'undefined') throw new Error('The FlashMind bridge is not available');
    if (typeof AIRouter === 'undefined' || typeof AIRouter.callOn !== 'function') throw new Error('The local AI is not available here');
    const item = await FlashMindBridge.fromPage();   // refuses private, Tor and routed tabs
    window.showToast?.('Asking your local model for questions...');
    let res;
    try { res = await AIRouter.callOn('local', 'chat', { message: this.teachBackPrompt(item.title, item.body), conversationHistory: [] }); }
    catch (err) { throw new Error('Your local model could not answer: ' + String((err && err.message) || err).replace(/\.$/, '') + '. Nothing was sent to the cloud.', { cause: err }); }
    const { kept, dropped } = this.checkTeachBack(this.parseTeachBack(res && res.result), item.body);
    if (!kept.length) throw new Error('None of the questions could be checked against the page' + (dropped.length ? ' (' + dropped[0].reason + ')' : '') + '. Nothing was kept.');
    if (typeof VexUsage !== 'undefined') VexUsage.touch(this.FEATURE);
    return this._teachBackDialog(item, kept, dropped, res && res.model);
  },

  _teachBackDialog(item, kept, dropped, model) {
    const G = VexSettingsGroups;
    const { body, close } = G.dialog({ id: 'vex-teachback', title: 'Teach-back questions', sub: 'Each answer carries a quote that was found on the page. Nothing is saved until you confirm.' });
    if (typeof VexProvenance !== 'undefined') body.appendChild(VexProvenance.chip({ kind: 'local', model, read: 'the page you were on' }));
    const boxes = [];
    kept.forEach((c, i) => {
      const box = document.createElement('div');
      box.className = 'vexsr-rule'; box.style.cssText = 'display:block;margin:8px 0';
      const label = document.createElement('label'); label.style.cssText = 'display:flex;gap:8px;align-items:flex-start';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = true; cb.setAttribute('aria-label', 'Keep question ' + (i + 1));
      boxes.push(cb);
      const t = document.createElement('div');
      const q = document.createElement('div'); q.style.fontWeight = '600'; q.textContent = c.question;
      const a = document.createElement('div'); a.textContent = c.answer;
      const qt = document.createElement('div'); qt.className = 'vexsr-mode'; qt.textContent = 'On the page: "' + c.quote + '"';
      t.append(q, a, qt);
      label.append(cb, t);
      box.appendChild(label);
      body.appendChild(box);
    });
    if (dropped.length) body.appendChild(G.note(dropped.length + ' question(s) were dropped because their quote could not be found on the page.'));
    body.appendChild(G.button('Save the checked questions as a FlashMind file', async () => {
      try {
        const chosen = kept.filter((_, i) => boxes[i].checked);
        if (!chosen.length) throw new Error('Check at least one question');
        const ok = await window.vexConfirm({ title: 'Save ' + chosen.length + ' question' + (chosen.length === 1 ? '' : 's') + '?', message: 'They are saved as a CSV file in your downloads. Drop it into FlashMind.', okLabel: 'Save' });
        if (!ok) return;
        const deck = this.deckName(this._course());
        FlashMindBridge.saveFile(FlashMindBridge.fileName(item.title + ' teach-back', '.csv'), FlashMindBridge.cardsToCsv(this.teachBackCards(chosen, deck, item.title)), 'text/csv');
        window.showToast?.(chosen.length + ' question(s) saved');
        close();
      } catch (e) { window.showToast?.(e.message, 'error'); }
    }, { primary: true }));
    return { kept, dropped };
  },

  // ---- the page's right-click menu ----------------------------------------------------------------
  pageItems(selectionText) {
    if (!this.enabled() || typeof FlashMindBridge === 'undefined') return [];
    const fail = (err) => window.showToast?.((err && err.message) || String(err), 'error');
    const items = [{ label: 'Quiz me from this page', action: () => { this.quizFromPage(selectionText).catch(fail); } }];
    const sel = String(selectionText || '').trim();
    if (sel && sel.length <= this.MAX_WORD) items.push({ label: 'Save "' + sel.slice(0, 24) + '" with its sentence', action: () => { this.saveSelectedWord().catch(fail); } });
    return items;
  },

  // ---- Settings ------------------------------------------------------------------------------------------
  group(el) {
    const G = VexSettingsGroups;
    el.appendChild(G.note('Doors into FlashMind from what you read: quiz me from a page (the course deck is named and opened), a mistake journal from your past papers, words saved with their sentence and source as a FlashMind CSV, and teach-back questions your local model writes and the page proves. Nothing is saved without your confirm.'));
    const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-top:8px';
    const fail = (e) => window.showToast?.((e && e.message) || String(e), 'error');
    row.append(
      G.button('Mistake journal', () => { try { this.openMistakes(); } catch (e) { fail(e); } }, { primary: true }),
      G.button('Export saved words (CSV)', () => { try { this.exportVocab(); } catch (e) { fail(e); } }),
      G.button('Forget saved words', async () => { if (await window.vexConfirm({ title: 'Forget every saved word?', message: 'Your saved words and their sentences are deleted. Exported files are not touched.', okLabel: 'Forget', danger: true })) { try { this.clearVocab(); } catch (e) { fail(e); } } }, { danger: true }),
    );
    el.appendChild(row);
    let n = 0;
    try { n = this.vocab().length; } catch (e) { el.appendChild(G.note(e.message)); }
    el.appendChild(G.note(n + ' saved word' + (n === 1 ? '' : 's') + '.'));
  },
};

if (typeof window !== 'undefined') {
  window.VexStudyEntry = VexStudyEntry;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'study-entry', title: 'Study entry points', keywords: 'flashmind quiz page mistake journal yanlis defteri vocabulary words csv teach back questions', build: (el) => VexStudyEntry.group(el) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    const fail = (err) => window.showToast?.((err && err.message) || String(err), 'error');
    VexExtras.registerCommand({ id: 'study-quiz-page', label: 'Quiz Me From This Page', hint: 'Copies the page for FlashMind and opens the current course deck', icon: 'graduation', action: () => { VexStudyEntry.quizFromPage('').catch(fail); } });
    VexExtras.registerCommand({ id: 'study-mistakes', label: 'Mistake Journal', hint: 'Your wrong past-paper questions as a reading queue', icon: 'book', action: () => { try { VexStudyEntry.openMistakes(); } catch (e) { fail(e); } } });
    VexExtras.registerCommand({ id: 'study-save-word', label: 'Save Selected Word With Its Sentence', hint: 'Keeps the word, its sentence and the page for a FlashMind CSV', icon: 'bookmark', action: () => { VexStudyEntry.saveSelectedWord().catch(fail); } });
    VexExtras.registerCommand({ id: 'study-vocab-export', label: 'Export Saved Words for FlashMind', hint: 'A CSV of word, sentence and source', icon: 'graduation', action: () => { try { VexStudyEntry.exportVocab(); } catch (e) { fail(e); } } });
    VexExtras.registerCommand({ id: 'study-teach-back', label: 'Teach-Back Questions From This Page', hint: 'Your local model asks; each answer must quote the page', icon: 'graduation', action: () => { VexStudyEntry.teachBack().catch(fail); } });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexStudyEntry };
