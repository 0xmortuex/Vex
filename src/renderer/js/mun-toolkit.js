// === MUN toolkit: procedure card, templates, clause diff, checklists (T3-028) ======
//
// What a delegate keeps open during a Model UN conference, in English and Turkish. It sits
// beside the delegation dossier (js/mun-dossier.js), which holds the research.
//
//   Procedure card   a one-page cheat card of the usual motions and points. GENERIC: every
//                    conference writes its own Rules of Procedure, and where they differ
//                    yours win. The card says so at the top and the voting thresholds are
//                    left out on purpose.
//   Motions          the usual wording of each motion with blanks filled in from your
//                    country, topic and times, to copy, or to add to your Snippets (Tab
//                    expansion in any box) after you confirm.
//   Templates        a position paper and a draft resolution skeleton, with a clause counter
//                    (preambulatory and operative clauses counted, the numbering checked).
//   Clause diff      two versions of a clause compared word by word; every change can be
//                    accepted or rejected and the result copied. Nothing is merged unseen.
//   Checklists       position paper, ID and badge, and travel/transfer, each item a number of
//                    days before the conference date you set, with ticks.
//   Stat pad         a number you plan to quote, with its source and year. Without both it is
//                    refused, and a figure older than three years is marked stale.
//   Stance notes     one line of notes per delegate you will negotiate with.
//
// Local only: vex.munToolkit. Not legal or procedural advice for any one conference.
//
//   VexMunToolkit.countClauses(text)          pure -> { preamb, operative, numbering:[problems] }
//   VexMunToolkit.motion(id, vars, lang)      pure -> the filled-in sentence
//   VexMunToolkit.changes(ops) / merge(ops, accept)   pure: the clause diff and its result
//   VexMunToolkit.checklistDates(date, ...)   pure
const VexMunToolkit = {
  KEY: 'vex.munToolkit',
  PREF: 'vex.munToolkit.enabled',
  STALE_YEARS: 3,

  _flag: null,
  _f() { return this._flag || (this._flag = VexStudyKit.flag(this.PREF)); },
  enabled() { return this._f().enabled(); },
  setEnabled(on) { this._f().set(on); },

  // -- the generic procedure card ----------------------------------------------------------
  CARD: {
    en: {
      title: 'Procedure card (generic)',
      warn: 'Generic. Your conference\'s Rules of Procedure decide; where they differ, they win. Thresholds for votes are left out on purpose: look them up in your rules.',
      rows: [
        ['Point of Order', 'The Chair or a delegate broke a rule of procedure. Raise it at once.'],
        ['Point of Personal Privilege', 'Something stops you taking part: you cannot hear, the room is too cold, a speaker is not audible.'],
        ['Point of Parliamentary Inquiry', 'A question to the Chair about the rules or what happens next.'],
        ['Point of Information', 'A question to the speaker who has just finished, if they accepted questions.'],
        ['Motion to set the agenda', 'Choose which topic the committee takes first.'],
        ['Motion to open / close the speakers\' list', 'Start or end the list of speakers for the topic.'],
        ['Motion to set the speaking time', 'Change how long each speaker has.'],
        ['Motion for a moderated caucus', 'A guided debate on one sub-topic. State the topic, the total time and the speaking time.'],
        ['Motion for an unmoderated caucus', 'Free time to talk and write with other delegates. State the time.'],
        ['Motion to introduce a draft resolution', 'Put a sponsored draft in front of the committee.'],
        ['Right of Reply', 'Answer a remark that insulted your country or its honour. Granted by the Chair only.'],
        ['Motion to table / adjourn', 'Set aside a topic, or end the meeting for the session.'],
        ['Motion to close debate / move to voting procedure', 'End discussion and vote on the draft(s) on the floor.'],
        ['Amendment', 'A change to a draft resolution: friendly (the sponsors agree) or unfriendly (they do not).'],
        ['Division of the question', 'Ask for parts of a draft to be voted on separately.'],
      ],
    },
    tr: {
      title: 'Prosedür kartı (genel)',
      warn: 'Genel bilgidir. Konferansınızın İç Tüzüğü esastır; farklıysa o geçerlidir. Oylama eşikleri bilerek yazılmadı: kendi tüzüğünüzden bakın.',
      rows: [
        ['Usul hakkında söz (Point of Order)', 'Başkan ya da bir delege usul kuralını çiğnedi. Hemen dile getirin.'],
        ['Kişisel ayrıcalık hakkında söz (Point of Personal Privilege)', 'Katılımınızı engelleyen bir durum var: konuşmacı duyulmuyor, oda çok soğuk gibi.'],
        ['Prosedür sorusu (Point of Parliamentary Inquiry)', 'Başkana tüzük ya da sıradaki adım hakkında soru.'],
        ['Bilgi sorusu (Point of Information)', 'Soru kabul eden konuşmacıya, konuşması bitince soru.'],
        ['Gündemi belirleme önergesi', 'Komitenin önce hangi konuyu ele alacağını seçer.'],
        ['Konuşmacı listesini açma / kapama önergesi', 'Konu için konuşmacı listesini başlatır ya da bitirir.'],
        ['Konuşma süresini belirleme önergesi', 'Her konuşmacının süresini değiştirir.'],
        ['Yönetimli oturum önergesi (Moderated Caucus)', 'Tek bir alt konuda yönetilen tartışma. Konuyu, toplam süreyi ve konuşma süresini söyleyin.'],
        ['Serbest oturum önergesi (Unmoderated Caucus)', 'Diğer delegelerle konuşmak ve yazmak için serbest zaman. Süreyi söyleyin.'],
        ['Karar taslağı sunma önergesi', 'Sponsorlu bir taslağı komiteye sunar.'],
        ['Cevap hakkı (Right of Reply)', 'Ülkenizi ya da onurunu aşağılayan bir söze cevap. Yalnızca Başkan verir.'],
        ['Erteleme / oturumu kapatma önergesi', 'Bir konuyu bir kenara bırakır ya da oturumu bitirir.'],
        ['Görüşmeyi kapatma / oylamaya geçme önergesi', 'Tartışmayı bitirir ve masadaki taslakları oylar.'],
        ['Değişiklik önergesi (Amendment)', 'Karar taslağında değişiklik: dostane (sponsorlar kabul eder) ya da dostane olmayan.'],
        ['Maddelerin ayrı oylanması (Division of the Question)', 'Taslağın bölümlerinin ayrı oylanmasını ister.'],
      ],
    },
  },

  // -- motion wording ----------------------------------------------------------------------
  MOTIONS: [
    { id: 'mod', abbr: ';motion-mod', name: 'Moderated caucus',
      en: 'Honourable Chair, the delegate of {country} moves for a moderated caucus on the topic of "{topic}" for a total of {minutes} minutes with a speaking time of {seconds} seconds.',
      tr: 'Sayın Başkan, {country} delegesi, "{topic}" konulu, toplam {minutes} dakika sürecek ve konuşma süresi {seconds} saniye olacak bir yönetimli oturum önerir.' },
    { id: 'unmod', abbr: ';motion-unmod', name: 'Unmoderated caucus',
      en: 'Honourable Chair, the delegate of {country} moves for an unmoderated caucus for {minutes} minutes.',
      tr: 'Sayın Başkan, {country} delegesi, {minutes} dakikalık bir serbest oturum önerir.' },
    { id: 'order', abbr: ';point-order', name: 'Point of order',
      en: 'Honourable Chair, the delegate of {country} rises to a point of order.',
      tr: 'Sayın Başkan, {country} delegesi usul hakkında söz istiyor.' },
    { id: 'info', abbr: ';point-info', name: 'Point of information',
      en: 'Honourable Chair, the delegate of {country} has a point of information to the speaker.',
      tr: 'Sayın Başkan, {country} delegesinin konuşmacıya bir bilgi sorusu var.' },
    { id: 'time', abbr: ';motion-time', name: 'Set the speaking time',
      en: 'Honourable Chair, the delegate of {country} moves to set the speaking time to {seconds} seconds.',
      tr: 'Sayın Başkan, {country} delegesi, konuşma süresinin {seconds} saniye olarak belirlenmesini önerir.' },
    { id: 'close', abbr: ';motion-close', name: 'Close debate',
      en: 'Honourable Chair, the delegate of {country} moves to close debate and move into voting procedure.',
      tr: 'Sayın Başkan, {country} delegesi, görüşmenin kapatılmasını ve oylamaya geçilmesini önerir.' },
    { id: 'reply', abbr: ';right-reply', name: 'Right of reply',
      en: 'Honourable Chair, the delegate of {country} requests a right of reply.',
      tr: 'Sayın Başkan, {country} delegesi cevap hakkı talep eder.' },
  ],
  motion(id, vars, lang = 'en') {
    const m = this.MOTIONS.find(x => x.id === id);
    if (!m) throw new Error('Unknown motion "' + id + '"');
    const v = { country: '___', topic: '___', minutes: '___', seconds: '___', ...(vars || {}) };
    return m[lang === 'tr' ? 'tr' : 'en'].replace(/\{(\w+)\}/g, (all, k) => (v[k] != null && String(v[k]).trim() ? String(v[k]).trim() : '___'));
  },

  // -- templates ---------------------------------------------------------------------------
  TEMPLATES: {
    position: {
      en: '# Position paper\n\nCommittee: \nCountry: \nTopic: \nDelegate: \n\n## 1. The topic and why it matters\n(Two or three sentences, with a source.)\n\n## 2. Background\n(What the UN and others have already done. Each fact with a source and a year.)\n\n## 3. My country\'s position\n(What it supports, what it opposes, and why.)\n\n## 4. Past actions by my country\n(Votes, treaties, statements, with sources.)\n\n## 5. Proposed solutions\n(Three concrete steps my country will argue for.)\n\n## Sources\n',
      tr: '# Pozisyon belgesi\n\nKomite: \nÜlke: \nKonu: \nDelege: \n\n## 1. Konu ve önemi\n(İki üç cümle, kaynakla.)\n\n## 2. Arka plan\n(BM ve diğerlerinin şimdiye kadar yaptıkları. Her bilgi kaynak ve yılıyla.)\n\n## 3. Ülkemin pozisyonu\n(Neyi destekliyor, neye karşı, neden.)\n\n## 4. Ülkemin geçmiş adımları\n(Oylar, anlaşmalar, açıklamalar, kaynaklarıyla.)\n\n## 5. Çözüm önerileri\n(Ülkemin savunacağı üç somut adım.)\n\n## Kaynakça\n',
    },
    resolution: {
      en: 'Committee: \nTopic: \nSponsors: \nSignatories: \n\nThe committee,\n\nRecalling ...,\n\nDeeply concerned by ...,\n\nNoting with appreciation ...,\n\n1. Calls upon ...;\n\n2. Encourages ...;\n\n3. Requests ...;\n\n4. Decides to remain actively seized of the matter.\n',
      tr: 'Komite: \nKonu: \nSponsorlar: \nİmzacılar: \n\nKomite,\n\n... hatırlayarak,\n\n... konusunda derin endişe duyarak,\n\n... takdirle karşılayarak,\n\n1. ... çağrıda bulunur;\n\n2. ... teşvik eder;\n\n3. ... talep eder;\n\n4. Konunun aktif olarak gündemde kalmasına karar verir.\n',
    },
  },
  // Preambulatory lines end in a comma, operative ones are numbered "1." and end in ";" (the
  // last in "."). Counts both and reports numbering that skips or repeats, and punctuation.
  countClauses(text) {
    const lines = String(text == null ? '' : text).replace(/\r/g, '').split('\n');
    let preamb = 0, operative = 0;
    const problems = [];
    let expect = 1, lastOp = null;
    for (const raw of lines) {
      const line = raw.trim();
      const op = /^(\d{1,3})[.)]\s+\S/.exec(line);
      if (op) {
        operative++;
        const n = Number(op[1]);
        if (n !== expect) problems.push('Clause ' + op[1] + ' comes where ' + expect + ' was expected');
        expect = n + 1;
        lastOp = { n, line };
        if (!/[;.]$/.test(line)) problems.push('Clause ' + op[1] + ' does not end in ; or .');
      } else if (/^[A-ZÇĞİÖŞÜ][^\n]{8,},$/.test(line) && !/^(Committee|Topic|Sponsors|Signatories|Komite|Konu|Sponsorlar|İmzacılar)\b/.test(line) && !/^(The committee|Komite),$/i.test(line)) {
        preamb++;
      }
    }
    if (lastOp && !/\.$/.test(lastOp.line)) problems.push('The last clause (' + lastOp.n + ') should end in a full stop');
    return { preamb, operative, numbering: problems };
  },

  // -- clause diff -------------------------------------------------------------------------
  // The diff ops of VexStudyKit.diffWords, grouped: each change is a run of removed and added
  // words between two stretches that stayed. accept[i] true takes the new words, false keeps
  // the old ones.
  changes(ops) {
    const out = [];
    let cur = null;
    for (const o of ops) {
      if (o.op === 'same') { cur = null; continue; }
      if (!cur) { cur = { del: '', add: '' }; out.push(cur); }
      cur[o.op === 'del' ? 'del' : 'add'] += o.text;
    }
    return out;
  },
  merge(ops, accept) {
    let i = -1, inChange = false, out = '';
    for (const o of ops) {
      if (o.op === 'same') { inChange = false; out += o.text; continue; }
      if (!inChange) { inChange = true; i++; }
      const take = accept[i] !== false;
      if (o.op === 'add' && take) out += o.text;
      if (o.op === 'del' && !take) out += o.text;
    }
    return out;
  },

  // -- checklists --------------------------------------------------------------------------
  LISTS: {
    paper: { en: 'Position paper', tr: 'Pozisyon belgesi', items: [
      [-30, 'Read the background guide', 'Hazırlık rehberini oku'], [-21, 'Research your country\'s past votes and statements', 'Ülkenin geçmiş oy ve açıklamalarını araştır'],
      [-14, 'First draft of the position paper', 'Pozisyon belgesinin ilk taslağı'], [-10, 'Check every fact has a source and a year', 'Her bilginin kaynağı ve yılı var mı kontrol et'],
      [-7, 'Send the paper by the conference deadline', 'Belgeyi konferans son tarihine kadar gönder'], [-3, 'Print two copies', 'İki kopya yazdır'] ] },
    id: { en: 'ID and badge', tr: 'Kimlik ve yaka kartı', items: [
      [-14, 'Check the name and country on your registration', 'Kayıttaki ad ve ülkeyi kontrol et'], [-7, 'Photo and school ID ready', 'Fotoğraf ve okul kimliği hazır'],
      [-2, 'Put ID, placard and badge in your bag', 'Kimlik, ülke kartı ve yaka kartını çantaya koy'], [0, 'Wear the badge at the entrance', 'Girişte yaka kartını tak'] ] },
    transfer: { en: 'Travel and transfer', tr: 'Yolculuk ve transfer', items: [
      [-21, 'Book tickets', 'Biletleri al'], [-14, 'Book the room, if you need one', 'Gerekirse oda ayır'],
      [-3, 'Write down the venue address and the transfer time', 'Mekân adresini ve transfer saatini yaz'], [-1, 'Pack: laptop, charger, formal clothes, water', 'Çantayı hazırla: dizüstü, şarj aleti, resmi kıyafet, su'],
      [0, 'Leave early; keep the organisers\' number at hand', 'Erken çık; organizatörlerin numarasını yanında tut'] ] },
  },
  checklistDates(dateMs, listId) {
    const l = this.LISTS[listId];
    if (!l) throw new Error('Unknown checklist "' + listId + '"');
    if (!Number.isFinite(dateMs)) throw new Error('Set the conference date first');
    return l.items.map(([off, en, tr], i) => {
      const d = new Date(dateMs); d.setDate(d.getDate() + off);
      return { key: listId + ':' + i, offset: off, date: d.getTime(), en, tr };
    });
  },

  // -- stat pad ----------------------------------------------------------------------------
  isStale(year, now = new Date()) { return Number(year) < now.getFullYear() - this.STALE_YEARS; },

  _st() { return VexStudyKit.store(this.KEY, { v: 1, date: 0, checks: {}, stats: [], stances: [] }); },
  _read() { const d = this._st().get(); d.checks = d.checks || {}; d.stats = Array.isArray(d.stats) ? d.stats : []; d.stances = Array.isArray(d.stances) ? d.stances : []; return d; },
  setDate(ms) { const d = this._read(); d.date = Number(ms) || 0; this._st().set(d); },
  tick(key, on) { const d = this._read(); if (on) d.checks[key] = 1; else delete d.checks[key]; this._st().set(d); },
  addStat({ text, source, year }) {
    const t = String(text || '').trim(), s = String(source || '').trim(), y = Number(year);
    if (!t) throw new Error('Write the statistic first');
    if (s.length < 4) throw new Error('A statistic needs its source (a name or an address)');
    if (!Number.isInteger(y) || y < 1950 || y > new Date().getFullYear() + 1) throw new Error('A statistic needs the year it is from (four digits)');
    const d = this._read();
    const st = { id: vexId('st'), text: t.slice(0, 300), source: s.slice(0, 300), year: y };
    d.stats.push(st);
    if (d.stats.length > 200) d.stats.shift();
    this._st().set(d);
    return st;
  },
  removeStat(id) { const d = this._read(); d.stats = d.stats.filter(s => s.id !== id); this._st().set(d); },
  setStance(country, note) {
    const c = String(country || '').trim();
    if (!c) throw new Error('Write the country first');
    const d = this._read();
    const i = d.stances.findIndex(s => VexStudyKit.fold(s.country) === VexStudyKit.fold(c));
    const n = String(note || '').trim().slice(0, 600);
    if (!n) { if (i >= 0) d.stances.splice(i, 1); } else if (i >= 0) d.stances[i].note = n; else d.stances.push({ country: c.slice(0, 60), note: n });
    this._st().set(d);
  },

  // -- snippets ----------------------------------------------------------------------------
  async addSnippets(lang = 'en') {
    if (typeof Snippets === 'undefined') throw new Error('Snippets are not available');
    if (!await window.vexConfirm({ title: 'Add ' + this.MOTIONS.length + ' motion snippets?', message: 'They become abbreviations such as ;motion-mod that expand when you press Tab in any box. Blanks (___) are left for you. You can remove them in Snippets.', okLabel: 'Add them' })) return 0;
    let n = 0;
    for (const m of this.MOTIONS) {
      if (Snippets.items.some(s => s.abbr === m.abbr)) continue;
      Snippets.add(m.abbr, this.motion(m.id, {}, lang), m.name);
      n++;
    }
    return n;
  },

  // -- screens -----------------------------------------------------------------------------
  open(tab = 'card') {
    if (typeof VexUsage !== 'undefined') VexUsage.touch('mun-toolkit');
    const K = VexStudyKit, G = VexSettingsGroups;
    const { body } = G.dialog({ id: 'vex-mun-toolkit', title: 'MUN toolkit', sub: 'Generic Model UN helpers, English and Turkish. Your conference\'s own rules come first.' });
    const state = { tab, lang: (typeof VexI18nUI !== 'undefined' && VexI18nUI.locale() === 'tr') ? 'tr' : 'en' };
    const TABS = [['card', 'Procedure card'], ['motions', 'Motions'], ['templates', 'Templates'], ['diff', 'Clause diff'], ['lists', 'Checklists'], ['stats', 'Stats and stances']];
    const draw = () => {
      body.textContent = '';
      const bar = K.el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px' });
      for (const [id, label] of TABS) bar.appendChild(G.button(label, () => { state.tab = id; draw(); }, { primary: state.tab === id }));
      bar.appendChild(G.button(state.lang === 'tr' ? 'Türkçe' : 'English', () => { state.lang = state.lang === 'tr' ? 'en' : 'tr'; draw(); }));
      body.appendChild(bar);
      this['_tab_' + state.tab](body, state, draw);
    };
    draw();
  },
  _tab_card(body, st) {
    const K = VexStudyKit, c = this.CARD[st.lang];
    body.appendChild(K.el('h3', { text: c.title }));
    body.appendChild(VexSettingsGroups.note(c.warn));
    for (const [a, b] of c.rows) body.appendChild(K.el('div', { style: 'margin:6px 0' }, K.el('strong', { text: a }), K.el('div', { text: b })));
  },
  _tab_motions(body, st) {
    const K = VexStudyKit, G = VexSettingsGroups;
    const country = K.el('input', { type: 'text', placeholder: 'Your country', 'aria-label': 'Your country' });
    const topic = K.el('input', { type: 'text', placeholder: 'Topic', 'aria-label': 'Topic' });
    const minutes = K.el('input', { type: 'number', placeholder: 'Minutes', 'aria-label': 'Minutes', style: 'width:90px' });
    const seconds = K.el('input', { type: 'number', placeholder: 'Seconds', 'aria-label': 'Speaking seconds', style: 'width:90px' });
    const list = K.el('div');
    const fill = () => {
      list.textContent = '';
      const v = { country: country.value, topic: topic.value, minutes: minutes.value, seconds: seconds.value };
      for (const m of this.MOTIONS) {
        const text = this.motion(m.id, v, st.lang);
        list.appendChild(K.el('div', { style: 'margin:8px 0' }, K.el('strong', { text: m.name }), K.el('div', { text }), G.button('Copy', K.guard(async () => { await K.copy(text); window.showToast?.('Copied'); }))));
      }
    };
    for (const e of [country, topic, minutes, seconds]) e.addEventListener('input', fill);
    body.append(K.el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, country, topic, minutes, seconds),
      G.button('Add these as Snippets (type ;motion-mod then Tab)', K.guard(async () => { const n = await this.addSnippets(st.lang); window.showToast?.(n + ' snippet' + VexPlural.s(n) + ' added'); })), list);
    fill();
  },
  _tab_templates(body, st) {
    const K = VexStudyKit, G = VexSettingsGroups;
    const pick = K.el('select', { 'aria-label': 'Template' }, K.el('option', { value: 'position', text: 'Position paper' }), K.el('option', { value: 'resolution', text: 'Draft resolution' }));
    const ta = K.el('textarea', { rows: '14', style: 'width:100%;margin-top:8px', 'aria-label': 'Template text' });
    const count = K.el('div', { class: 'vex-platform-note' });
    const load = () => { ta.value = this.TEMPLATES[pick.value][st.lang]; upd(); };
    const upd = () => {
      if (pick.value !== 'resolution') { count.textContent = ''; return; }
      const r = this.countClauses(ta.value);
      count.textContent = r.preamb + ' preambulatory, ' + r.operative + ' operative clauses' + (r.numbering.length ? '. Check: ' + r.numbering.join('; ') : '. Numbering looks right.');
    };
    pick.addEventListener('change', load); ta.addEventListener('input', upd);
    body.append(pick, ta, count, K.el('div', { style: 'display:flex;gap:8px;margin-top:8px' },
      G.button('Save as a note', K.guard(() => { K.saveNote(pick.value === 'position' ? 'Position paper' : 'Draft resolution', ta.value); window.showToast?.('Saved as a note'); }), { primary: true }),
      G.button('Copy', K.guard(async () => { await K.copy(ta.value); window.showToast?.('Copied'); }))));
    load();
  },
  _tab_diff(body) {
    const K = VexStudyKit, G = VexSettingsGroups;
    const a = K.el('textarea', { rows: '5', style: 'width:100%', 'aria-label': 'Old clause', placeholder: 'Old clause' });
    const b = K.el('textarea', { rows: '5', style: 'width:100%;margin-top:6px', 'aria-label': 'New clause', placeholder: 'New clause' });
    const out = K.el('div', { style: 'margin-top:10px' });
    body.append(a, b, G.button('Compare', K.guard(() => {
      const ops = K.diffWords(a.value, b.value);
      const ch = this.changes(ops);
      const accept = ch.map(() => true);
      out.textContent = '';
      const result = K.el('textarea', { rows: '5', style: 'width:100%;margin-top:8px', 'aria-label': 'Result', readonly: true });
      const sync = () => { result.value = this.merge(ops, accept); };
      out.appendChild(K.diffHtml(ops));
      out.appendChild(K.el('div', { class: 'vex-platform-note', text: ch.length ? ch.length + ' change' + VexPlural.s(ch.length) + '. Untick one to keep the old words.' : 'No difference.' }));
      ch.forEach((c, i) => {
        const cb = K.el('input', { type: 'checkbox', checked: true, 'aria-label': 'Accept change ' + (i + 1) });
        cb.addEventListener('change', () => { accept[i] = cb.checked; sync(); });
        out.appendChild(K.el('label', { style: 'display:flex;gap:8px;margin:4px 0' }, cb, K.el('span', { text: (c.del.trim() ? '"' + c.del.trim() + '"' : '(nothing)') + '  ->  ' + (c.add.trim() ? '"' + c.add.trim() + '"' : '(removed)') })));
      });
      out.append(result, G.button('Copy the result', K.guard(async () => { await K.copy(result.value); window.showToast?.('Copied'); })));
      sync();
    }), { primary: true }), out);
  },
  _tab_lists(body, st, redraw) {
    const K = VexStudyKit, G = VexSettingsGroups;
    const d = this._read();
    const date = K.el('input', { type: 'date', 'aria-label': 'Conference date', value: d.date ? new Date(d.date).toISOString().slice(0, 10) : '' });
    date.addEventListener('change', K.guard(() => { this.setDate(date.value ? Date.parse(date.value + 'T09:00:00') : 0); redraw(); }));
    body.appendChild(K.el('div', {}, 'Conference date: ', date));
    if (!d.date) { body.appendChild(G.note('Set the date to see when each item is due.')); return; }
    for (const id of Object.keys(this.LISTS)) {
      body.appendChild(K.el('h3', { text: this.LISTS[id][st.lang] }));
      for (const it of this.checklistDates(d.date, id)) {
        const cb = K.el('input', { type: 'checkbox', 'aria-label': it[st.lang] });
        cb.checked = !!d.checks[it.key];
        cb.addEventListener('change', K.guard(() => this.tick(it.key, cb.checked)));
        const late = !d.checks[it.key] && it.date < Date.now();
        body.appendChild(K.el('label', { style: 'display:flex;gap:8px;margin:4px 0' + (late ? ';color:#ef4444' : '') }, cb, K.el('span', { text: new Date(it.date).toLocaleDateString() + '  ' + it[st.lang] })));
      }
    }
  },
  _tab_stats(body, st, redraw) {
    const K = VexStudyKit, G = VexSettingsGroups;
    const d = this._read();
    body.appendChild(K.el('h3', { text: 'Stat pad' }));
    body.appendChild(G.note('Every figure needs its source and year. A figure older than ' + this.STALE_YEARS + ' years is marked stale.'));
    for (const s of d.stats) {
      const stale = this.isStale(s.year);
      body.appendChild(K.el('div', { style: 'margin:6px 0' }, K.el('span', { text: s.text + ' (' + s.source + ', ' + s.year + ')' + (stale ? ' STALE' : '') , style: stale ? 'color:#eab308' : '' }), ' ',
        G.button('Remove', K.guard(() => { this.removeStat(s.id); redraw(); }), { danger: true })));
    }
    const t = K.el('input', { type: 'text', placeholder: 'The figure', 'aria-label': 'The figure' });
    const so = K.el('input', { type: 'text', placeholder: 'Source', 'aria-label': 'Source' });
    const y = K.el('input', { type: 'number', placeholder: 'Year', 'aria-label': 'Year', style: 'width:90px' });
    body.append(K.el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin:8px 0' }, t, so, y, G.button('Add', K.guard(() => { this.addStat({ text: t.value, source: so.value, year: y.value }); redraw(); }), { primary: true })));
    body.appendChild(K.el('h3', { text: 'Stance notes' }));
    for (const s of d.stances) body.appendChild(K.el('div', { style: 'margin:4px 0' }, K.el('strong', { text: s.country + ': ' }), s.note));
    const c = K.el('input', { type: 'text', placeholder: 'Country', 'aria-label': 'Delegate country' });
    const n = K.el('input', { type: 'text', placeholder: 'One line (empty removes)', 'aria-label': 'Stance note', style: 'flex:1' });
    body.appendChild(K.el('div', { style: 'display:flex;gap:8px;margin-top:8px' }, c, n, G.button('Save', K.guard(() => { this.setStance(c.value, n.value); redraw(); }))));
  },

  group(el) {
    const G = VexSettingsGroups;
    el.appendChild(G.note('A generic procedure card, motion wording, position-paper and resolution templates with a clause counter, a clause diff and date checklists, in English and Turkish. Your conference\'s rules come first.'));
    el.appendChild(G.button('Open the MUN toolkit', () => this.open(), { primary: true }));
  },
};

if (typeof window !== 'undefined') window.VexMunToolkit = VexMunToolkit;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexMunToolkit };
