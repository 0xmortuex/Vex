// === Study kit: the small shared helpers of the Wave 3 study tools ==============
//
// Eleven small tools (glossary, ledger, cheat sheet, draft check, syllabus check, source
// badge, MUN toolkit, speech timer, Turkish helpers) read the same few things: a JSON value
// in localStorage that must fail loudly when it is damaged, a switch, the notes, words
// folded so "Işık" matches "isik", and a word-level diff. They live here once.
//
//   VexStudyKit.store(key, fallback)      { get(), set(v) }; a damaged value THROWS (it is not replaced)
//   VexStudyKit.flag(prefKey)             { enabled(), set(on) }; on unless the value is 'off'
//   VexStudyKit.fold(s)                   case/accents/dotted-dotless I removed (VexTr when it is loaded)
//   VexStudyKit.words(s)                  folded words of 2+ letters, no stop words
//   VexStudyKit.notes()                   the notes of vex.notes, [{id,title,content,tags,...}]
//   VexStudyKit.diffWords(a, b)           [{op:'same'|'add'|'del', text}] by words (LCS)
//   VexStudyKit.diffHtml(ops, doc)        the diff as nodes: del struck through, add underlined
//
// Pure functions work without a document so tests can run them.
const VexStudyKit = {
  store(key, fallback) {
    const clone = () => JSON.parse(JSON.stringify(fallback));
    return {
      key,
      get() {
        let raw = null;
        try { raw = localStorage.getItem(key); } catch (err) { throw new Error(key + ' could not be read: ' + err.message); }
        if (raw == null || raw === '') return clone();
        try { return JSON.parse(raw); }
        catch (err) { throw new Error(key + ' is damaged and was left as it is: ' + err.message); }
      },
      set(v) {
        try { localStorage.setItem(key, JSON.stringify(v)); }
        catch (err) { throw new Error(key + ' could not be saved: ' + err.message); }
        return v;
      },
    };
  },

  flag(prefKey) {
    return {
      enabled() { try { return localStorage.getItem(prefKey) !== 'off'; } catch (err) { console.error('[StudyKit] ' + prefKey + ' unreadable:', err); return true; } },
      set(on) { localStorage.setItem(prefKey, on ? 'on' : 'off'); },
    };
  },

  STOP: new Set(('the a an and or of to in on at for with by from as is are was were be been it its this that these those not no but if then than so such into over under about which who whom what when where how why also can could may might will would shall should have has had do does did their there they them he she we you your our his her i me my one two more most some any each other ' +
    've ile bir bu şu o ve veya de da mi mu için gibi ama fakat ya çok daha en her hiç kadar sonra önce ise olan olarak bir').split(/\s+/)),

  fold(s) {
    const t = String(s == null ? '' : s);
    if (typeof VexTr !== 'undefined' && typeof VexTr.fold === 'function') return VexTr.fold(t);
    return t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i');
  },

  words(s) {
    const out = [];
    for (const w of this.fold(s).split(/[^\p{L}\p{N}]+/u)) if (w.length >= 2 && !this.STOP.has(w)) out.push(w);
    return out;
  },

  // A word without its commonest English / Turkish endings, so "hormones" ~ "hormone" and
  // "denklemler" ~ "denklem". Rough on purpose: it is only used to match, never to show.
  stem(w) {
    let x = String(w);
    for (const suf of ['lerin', 'larin', 'ler', 'lar', 'ing', 'ed', 'es', 's', 'in', 'un', 'nin', 'nun']) {
      if (x.length > suf.length + 3 && x.endsWith(suf)) { x = x.slice(0, -suf.length); break; }
    }
    // "hormone" and "hormones" must meet: a final e goes too.
    if (x.length > 4 && x.endsWith('e')) x = x.slice(0, -1);
    return x;
  },

  notes() {
    let raw = null;
    try { raw = localStorage.getItem('vex.notes'); } catch (err) { throw new Error('The notes could not be read: ' + err.message); }
    if (!raw) return [];
    let a;
    try { a = JSON.parse(raw); } catch (err) { throw new Error('The notes are damaged: ' + err.message); }
    return Array.isArray(a) ? a.filter(n => n && typeof n === 'object') : [];
  },

  diffWords(a, b) {
    const x = String(a == null ? '' : a).split(/(\s+)/).filter(t => t !== '');
    const y = String(b == null ? '' : b).split(/(\s+)/).filter(t => t !== '');
    // Cap: an LCS table is n*m. Past 4000 tokens a side the clause texts are not clauses.
    if (x.length > 4000 || y.length > 4000) throw new Error('These texts are too long to compare word by word (over 4000 words)');
    const n = x.length, m = y.length;
    const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    const ops = [];
    const push = (op, text) => { const last = ops[ops.length - 1]; if (last && last.op === op) last.text += text; else ops.push({ op, text }); };
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (x[i] === y[j]) { push('same', x[i]); i++; j++; }
      else if (L[i + 1][j] >= L[i][j + 1]) { push('del', x[i]); i++; }
      else { push('add', y[j]); j++; }
    }
    while (i < n) push('del', x[i++]);
    while (j < m) push('add', y[j++]);
    return ops;
  },

  diffHtml(ops, doc) {
    const d = doc || document;
    const box = d.createElement('div');
    box.style.cssText = 'white-space:pre-wrap;line-height:1.6';
    for (const o of ops) {
      const s = d.createElement(o.op === 'same' ? 'span' : (o.op === 'del' ? 'del' : 'ins'));
      s.textContent = o.text;
      if (o.op === 'del') s.style.cssText = 'background:rgba(239,68,68,.18);color:inherit';
      if (o.op === 'add') s.style.cssText = 'background:rgba(34,197,94,.2);color:inherit;text-decoration:underline';
      box.appendChild(s);
    }
    return box;
  },

  // Saves a note the way the rest of Vex does (AgentTools.saveNote), or says why it cannot.
  saveNote(title, content, tag) {
    if (typeof AgentTools === 'undefined' || typeof AgentTools.saveNote !== 'function') throw new Error('Notes are not available here');
    const n = AgentTools.saveNote(title, content, undefined, { origin: 'study' });
    if (tag && n && Array.isArray(n.tags)) {
      let all = this.notes();
      all = all.map(x => (x.id === n.id ? { ...x, tags: [tag, 'from:study'] } : x));
      localStorage.setItem('vex.notes', JSON.stringify(all));
      if (typeof NotesPanel !== 'undefined' && NotesPanel.reloadSyncedState) NotesPanel.reloadSyncedState();
    }
    return n;
  },

  // The local model, and only the local one: the text of a draft is never sent to a cloud model.
  localModel() {
    if (typeof Ollama === 'undefined' || typeof AIRouter === 'undefined') return '';
    return AIRouter.isOllamaAvailable() ? String(AIRouter.getModel() || '') : '';
  },
  async generateLocal(system, prompt, { maxTokens = 600 } = {}) {
    const model = this.localModel();
    if (!model) throw new Error('No local model is set up (Ollama). This text is never sent to a cloud model.');
    return String(await Ollama.generate(model, prompt, { systemPrompt: system, temperature: 0.1, maxTokens }) || '').trim();
  },

  // A DOM element in one call. Text goes in with textContent, never as markup.
  el(tag, props, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === 'text') e.textContent = v;
      else if (k === 'style') e.style.cssText = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (v === true) e.setAttribute(k, '');
      else if (v !== false && v != null) e.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid != null) e.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
    return e;
  },

  // Runs a click handler and shows what went wrong instead of dropping it.
  guard(fn) {
    return (...a) => Promise.resolve().then(() => fn(...a)).catch(err => {
      console.error('[Study]', err);
      if (typeof window !== 'undefined' && window.showToast) window.showToast((err && err.message) || 'That did not work', 'error');
    });
  },

  copy(text) {
    if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error('The clipboard is not available');
    return navigator.clipboard.writeText(String(text));
  },
};

if (typeof window !== 'undefined') window.VexStudyKit = VexStudyKit;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexStudyKit };
