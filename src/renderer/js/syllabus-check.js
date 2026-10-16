// === Syllabus coverage check (T3-106) ===============================================
//
// Paste the topic list of a course (one topic per line, bullets and numbers are fine). Each
// topic is matched against your notes, your highlights and, if you paste it, the topic list
// of your flashcard deck, and comes back as
//
//   covered   two or more of your items mention it, or one long one does
//   thin      one short item mentions it, or its words only partly match
//   missing   nothing you keep mentions it
//
// So before an exam you see the gaps. It is a word match (folded, so "Işık" finds "ışık" and
// "integrals" finds "integral"); read "covered" as "you have something on it", not "you know
// it". Nothing is looked up online and nothing is changed. The syllabi you paste are kept
// (vex.syllabi), up to 20, so the check can be run again after you add notes.
//
//   VexSyllabusCheck.parseTopics(text)            pure
//   VexSyllabusCheck.check(topics, items)         pure: [{topic, status, matches:[{title, kind}]}]
//   VexSyllabusCheck.items(deckText)              gathers notes + highlights (+ deck lines)
const VexSyllabusCheck = {
  KEY: 'vex.syllabi',
  PREF: 'vex.syllabusCheck.enabled',
  MAX_TOPICS: 200,
  MAX_SAVED: 20,

  _flag: null,
  _f() { return this._flag || (this._flag = VexStudyKit.flag(this.PREF)); },
  enabled() { return this._f().enabled(); },
  setEnabled(on) { this._f().set(on); },

  parseTopics(text) {
    const out = [];
    const seen = new Set();
    for (const raw of String(text == null ? '' : text).replace(/\r/g, '').split(/\n|;/)) {
      const t = raw.replace(/^\s*(?:[-*•–]|\d+(?:\.\d+)*[.)]?|week\s*\d+\s*[:.-]|hafta\s*\d+\s*[:.-])\s*/i, '').trim();
      if (t.length < 3) continue;
      const k = VexStudyKit.fold(t);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(t.slice(0, 160));
      if (out.length >= this.MAX_TOPICS) break;
    }
    return out;
  },

  _keys(s) {
    const K = VexStudyKit;
    return [...new Set(K.words(s).map(w => K.stem(w)))].filter(w => w.length >= 3);
  },

  check(topics, items) {
    const prepared = (items || []).map(it => {
      const set = new Set(this._keys(it.title + ' ' + it.text));
      return { it, set, len: String(it.text || '').length };
    });
    return (topics || []).map(topic => {
      const keys = this._keys(topic);
      if (!keys.length) return { topic, status: 'missing', matches: [] };
      const strong = [], weak = [];
      for (const p of prepared) {
        const hit = keys.filter(k => p.set.has(k) || [...p.set].some(x => x.length > 4 && k.length > 4 && (x.startsWith(k) || k.startsWith(x)))).length;
        const ratio = hit / keys.length;
        const m = { title: p.it.title, kind: p.it.kind, len: p.len };
        if (ratio >= 0.6 || (keys.length === 1 && hit === 1)) strong.push(m);
        else if (ratio >= 0.34) weak.push(m);
      }
      let status = 'missing';
      if (strong.length >= 2 || (strong.length === 1 && strong[0].len >= 600)) status = 'covered';
      else if (strong.length === 1 || weak.length) status = 'thin';
      return { topic, status, matches: strong.concat(weak).slice(0, 5).map(m => ({ title: m.title, kind: m.kind })) };
    });
  },

  items(deckText) {
    const K = VexStudyKit;
    const out = [];
    for (const n of K.notes()) out.push({ kind: 'note', title: String(n.title || 'Untitled note'), text: String(n.content || '') });
    const ann = (typeof Annotations !== 'undefined' && Annotations.store) ? Annotations.store : K.store('vex.annotations', {}).get();
    for (const [url, list] of Object.entries(ann || {})) {
      const arr = (Array.isArray(list) ? list : []).filter(h => h && h.text);
      if (arr.length) out.push({ kind: 'highlights', title: String(arr[0].title || url), text: arr.map(h => h.text + ' ' + (h.note || '')).join('\n') });
    }
    // Each line of a pasted deck topic list is one flashcard topic: a short item of its own.
    for (const line of String(deckText || '').split(/\n/)) if (line.trim().length >= 3) out.push({ kind: 'deck', title: line.trim().slice(0, 100), text: line.trim() });
    return out;
  },

  summary(results) {
    const n = (s) => results.filter(r => r.status === s).length;
    return { covered: n('covered'), thin: n('thin'), missing: n('missing'), total: results.length };
  },

  checklist(results, name) {
    const gap = results.filter(r => r.status !== 'covered');
    return '# Gaps: ' + (name || 'syllabus') + '\n\n' + (gap.length ? gap.map(r => '- [ ] ' + r.topic + ' (' + r.status + ')').join('\n') : 'Every topic has something.') + '\n';
  },

  _saved() { return VexStudyKit.store(this.KEY, { v: 1, list: [] }); },
  saved() { const d = this._saved().get(); return Array.isArray(d.list) ? d.list : []; },
  save(name, text, deck) {
    const nm = String(name || '').trim().slice(0, 60);
    if (!nm) throw new Error('Name the course first');
    const st = this._saved();
    const d = st.get();
    const list = (Array.isArray(d.list) ? d.list : []).filter(x => x.name !== nm);
    list.unshift({ name: nm, text: String(text || '').slice(0, 20000), deck: String(deck || '').slice(0, 20000), at: Date.now() });
    st.set({ v: 1, list: list.slice(0, this.MAX_SAVED) });
  },

  open() {
    if (typeof VexUsage !== 'undefined') VexUsage.touch('syllabus-check');
    const K = VexStudyKit, G = VexSettingsGroups;
    const { body } = G.dialog({ id: 'vex-syllabus', title: 'Syllabus coverage', sub: 'Paste the topics, one per line. Each is matched against your notes and highlights.' });
    const saved = this.saved();
    const course = K.el('input', { type: 'text', placeholder: 'Course name', 'aria-label': 'Course name', value: (typeof VexCourseSpaces !== 'undefined' && VexCourseSpaces.current && VexCourseSpaces.current() ? VexCourseSpaces.current().name : '') });
    const pick = K.el('select', { 'aria-label': 'Saved syllabus' }, K.el('option', { value: '', text: 'Saved syllabi...' }), saved.map(s => K.el('option', { value: s.name, text: s.name })));
    const topics = K.el('textarea', { rows: '8', 'aria-label': 'Syllabus topics', style: 'width:100%;margin-top:8px', placeholder: '1. Limits and continuity\n2. Derivatives\n3. Integration by parts' });
    const deck = K.el('textarea', { rows: '3', 'aria-label': 'Deck topics (optional)', style: 'width:100%;margin-top:8px', placeholder: 'Optional: the topics or tags of your flashcard deck, one per line' });
    const out = K.el('div', { style: 'margin-top:12px' });
    pick.addEventListener('change', () => { const s = saved.find(x => x.name === pick.value); if (s) { course.value = s.name; topics.value = s.text; deck.value = s.deck; } });
    let last = [];
    body.append(K.el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, course, pick), topics, deck,
      K.el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:8px' },
        G.button('Check coverage', K.guard(() => {
          const list = this.parseTopics(topics.value);
          if (!list.length) throw new Error('Paste the topics first');
          last = this.check(list, this.items(deck.value));
          if (course.value.trim()) this.save(course.value, topics.value, deck.value);
          const s = this.summary(last);
          out.textContent = '';
          out.appendChild(K.el('h3', { text: s.covered + ' covered, ' + s.thin + ' thin, ' + s.missing + ' missing (of ' + s.total + ')' }));
          for (const r of last) {
            out.appendChild(K.el('div', { style: 'margin:6px 0;padding-left:8px;border-left:3px solid ' + (r.status === 'covered' ? '#22c55e' : (r.status === 'thin' ? '#eab308' : '#ef4444')) },
              K.el('strong', { text: r.topic }), ' ', K.el('span', { class: 'vex-platform-note', text: r.status + (r.matches.length ? ': ' + r.matches.map(m => m.title + ' (' + m.kind + ')').join(', ') : '') })));
          }
        }), { primary: true }),
        G.button('Save the gaps as a note', K.guard(() => { if (!last.length) throw new Error('Run the check first'); K.saveNote('Gaps: ' + (course.value.trim() || 'syllabus'), this.checklist(last, course.value.trim())); window.showToast?.('Saved as a note'); }))), out);
  },

  group(el) {
    const G = VexSettingsGroups;
    el.appendChild(G.note('Paste a course\'s topic list and see which topics your notes and highlights cover, which are thin and which are missing. A word match, run on this computer.'));
    el.appendChild(G.button('Check a syllabus', () => this.open(), { primary: true }));
  },
};

if (typeof window !== 'undefined') window.VexSyllabusCheck = VexSyllabusCheck;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexSyllabusCheck };
