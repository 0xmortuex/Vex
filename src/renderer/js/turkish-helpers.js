// === Turkish dictionary and typing helpers (T3-049) ===============================
//
// Small helpers for writing Turkish, all on this computer:
//
//   TDK'de ara          right-click a word: open it in the Turkish Language Association's
//                       dictionary (sozluk.gov.tr). That is the one thing here that goes to
//                       the web, and only because you clicked it.
//   Turkish letters     "guzel yagmur" -> "güzel yağmur". Where a word typed without Turkish
//                       letters can be read as exactly ONE known Turkish word (c/ç g/ğ i/ı
//                       o/ö s/ş u/ü), the letters are put back. A word that fits two readings
//                       or none is left alone and listed. You see a before/after diff and
//                       confirm; in a text box the selection is replaced only after that.
//   Unknown words       the words the bundled list (js/turkish-wordlist.js, about 900 common
//                       words) and your own dictionary do not know, with near suggestions. The
//                       list is small, so most of what it flags is simply not in it: it is an
//                       assist, not a spell checker, and it never changes your text.
//   Your dictionary     words you add. Adding "kitaplarımız" offers the stem "kitap" so the
//                       endings (-lar, -ımız, -da ...) are covered; consonant changes such as
//                       kitap -> kitabı are not (add that form too).
//   Letters             ç ğ ı İ ö ş ü as buttons to copy, for a keyboard without them.
//   Formal letters      a petition (dilekçe), a consumer complaint and an absence note to fill
//                       in, with the addresses of CİMER and the Ministry of Trade's consumer
//                       page. They are templates, not legal advice.
//
//   VexTurkishHelpers.deasciify(text, opts)   pure -> { text, changed:[{from,to}], ambiguous:[word] }
//   VexTurkishHelpers.unknown(text)           -> [{word, count, suggestions:[]}]
//   VexTurkishHelpers.known(word)             stem + ending aware
const VexTurkishHelpers = {
  KEY: 'vex.turkishHelpers',
  PREF: 'vex.turkishHelpers.enabled',
  TDK_URL: 'https://sozluk.gov.tr/?kelime=%s',
  CIMER_URL: 'https://www.cimer.gov.tr',
  CONSUMER_URL: 'https://tuketici.ticaret.gov.tr',
  MAP: { c: 'ç', g: 'ğ', i: 'ı', o: 'ö', s: 'ş', u: 'ü' },
  MAX_AMBIGUOUS: 8,
  MAX_DICT: 2000,

  _flag: null,
  _f() { return this._flag || (this._flag = VexStudyKit.flag(this.PREF)); },
  enabled() { return this._f().enabled(); },
  setEnabled(on) { this._f().set(on); },

  lower(s) { return String(s).replace(/I/g, 'ı').replace(/İ/g, 'i').toLowerCase(); },
  upper(s) { return String(s).replace(/i/g, 'İ').replace(/ı/g, 'I').toUpperCase(); },

  // ---- endings ----------------------------------------------------------------------------
  _suffixes: null,
  suffixes() {
    if (this._suffixes) return this._suffixes;
    const P = ['', 'lar', 'ler'];
    const POSS = ['', 'im', 'ım', 'um', 'üm', 'in', 'ın', 'un', 'ün', 'i', 'ı', 'u', 'ü', 'imiz', 'ımız', 'umuz', 'ümüz', 'iniz', 'ınız', 'unuz', 'ünüz', 'leri', 'ları', 'si', 'sı', 'su', 'sü', 'm', 'n'];
    const CASE = ['', 'i', 'ı', 'u', 'ü', 'e', 'a', 'de', 'da', 'te', 'ta', 'den', 'dan', 'ten', 'tan', 'in', 'ın', 'un', 'ün', 'nin', 'nın', 'nun', 'nün', 'le', 'la', 'yle', 'yla', 'ce', 'ca', 'çe', 'ça', 'dir', 'dır', 'dur', 'dür', 'tir', 'tır', 'tur', 'tür', 'ki', 'yi', 'yı', 'yu', 'yü', 'ye', 'ya', 'ni', 'nı', 'nu', 'nü', 'ne', 'na', 'nde', 'nda', 'nden', 'ndan', 'lik', 'lık', 'luk', 'lük', 'li', 'lı', 'lu', 'lü', 'siz', 'sız', 'suz', 'süz', 'ci', 'cı', 'cu', 'cü', 'çi', 'çı', 'çu', 'çü'];
    const PERSON = ['', 'um', 'üm', 'ım', 'im', 'sun', 'sün', 'sın', 'sin', 'uz', 'üz', 'ız', 'iz', 'sunuz', 'sünüz', 'sınız', 'siniz', 'lar', 'ler'];
    const TENSE = ['ıyor', 'iyor', 'uyor', 'üyor', 'dı', 'di', 'du', 'dü', 'tı', 'ti', 'tu', 'tü', 'acak', 'ecek', 'ır', 'ir', 'ur', 'ür', 'ar', 'er', 'mak', 'mek', 'ma', 'me', 'an', 'en', 'ış', 'iş', 'mış', 'miş', 'muş', 'müş'];
    const set = new Set();
    for (const p of P) for (const q of POSS) for (const c of CASE) set.add(p + q + c);
    for (const t of TENSE) for (const p of PERSON) set.add(t + p);
    set.delete('');
    this._suffixes = set;
    return set;
  },

  // ---- your dictionary ------------------------------------------------------------------------
  _st() { return VexStudyKit.store(this.KEY, { v: 1, dict: [] }); },
  dictionary() { const d = this._st().get(); return Array.isArray(d.dict) ? d.dict : []; },
  addWord(word) {
    const w = this.lower(String(word || '').trim());
    if (!/^[a-zçğıöşüâîû]{2,40}$/.test(w)) throw new Error('A dictionary word is 2 to 40 letters, with no spaces or digits');
    const d = this._st();
    const list = this.dictionary();
    if (list.includes(w)) return false;
    if (list.length >= this.MAX_DICT) throw new Error('Your dictionary is full (' + this.MAX_DICT + ' words)');
    list.push(w);
    d.set({ v: 1, dict: list });
    this._personal = null;
    return true;
  },
  removeWord(word) {
    const w = this.lower(word);
    const list = this.dictionary();
    if (!list.includes(w)) return false;
    this._st().set({ v: 1, dict: list.filter(x => x !== w) });
    this._personal = null;
    return true;
  },
  // Possible stems of an inflected word: the word minus an ending, never shorter than three
  // letters, longest ending first. The caller chooses; nothing is stripped by itself.
  stemCandidates(word) {
    const w = this.lower(word);
    const out = [];
    const sf = this.suffixes();
    for (let k = w.length - 3; k >= 3; k--) if (sf.has(w.slice(k))) out.push(w.slice(0, k));
    return out;
  },

  _personal: null,
  _dictSet() { return this._personal || (this._personal = new Set(this.dictionary())); },
  _words() { return typeof VexTurkishWords !== 'undefined' ? VexTurkishWords.set() : new Set(); },

  known(word, extra) {
    const w = this.lower(word);
    if (!w) return false;
    const base = this._words(), mine = this._dictSet();
    const has = (x) => base.has(x) || mine.has(x) || (extra && extra.has(x));
    if (has(w)) return true;
    const sf = this.suffixes();
    for (let k = w.length - 1; k >= 2; k--) if (sf.has(w.slice(k)) && has(w.slice(0, k))) return true;
    return false;
  },

  // ---- Turkish letters back -------------------------------------------------------------------
  _variants(lowerWord) {
    const pos = [];
    for (let i = 0; i < lowerWord.length; i++) if (this.MAP[lowerWord[i]]) pos.push(i);
    if (pos.length === 0 || pos.length > this.MAX_AMBIGUOUS) return pos.length ? null : [];
    const out = [];
    for (let m = 1; m < (1 << pos.length); m++) {
      const ch = lowerWord.split('');
      for (let b = 0; b < pos.length; b++) if (m & (1 << b)) ch[pos[b]] = this.MAP[lowerWord[pos[b]]];
      out.push(ch.join(''));
    }
    return out;
  },
  _withCase(original, variantLower) {
    let out = '';
    for (let i = 0; i < original.length; i++) {
      const o = original[i];
      const isUp = o !== o.toLowerCase();
      out += isUp ? this.upper(variantLower[i]) : variantLower[i];
    }
    return out;
  },
  // Do all the vowels of the word belong to one family: a, ı, o, u (back) or e, i, ö, ü (front)?
  _harmonic(word) {
    let family = '';
    for (const ch of String(word)) {
      const f = 'aıou'.includes(ch) ? 'b' : 'eiöü'.includes(ch) ? 'f' : '';
      if (!f) continue;
      if (family && family !== f) return false;
      family = f;
    }
    return true;
  },
  deasciify(text, opts) {
    const extra = opts && opts.extra ? new Set([].concat(opts.extra).map(x => this.lower(x))) : null;
    const changed = [], ambiguous = [];
    const out = String(text == null ? '' : text).replace(/[A-Za-zÇĞİÖŞÜçğıöşü]+/g, (tok) => {
      if (/[ÇĞİÖŞÜçğıöşü]/.test(tok) || !/[cgiosuCGIOSU]/.test(tok)) return tok;
      const low = tok.toLowerCase();
      if (this.known(low, extra)) return tok;
      const vs = this._variants(low);
      if (vs === null || !vs.length) return tok;
      const hits = vs.filter(v => this.known(v, extra));
      // A word that is on the list as it stands beats one that is only a stem plus an ending
      // ("öğrenci" over "öğrençi" = öğren + çi).
      const whole = hits.filter(v => this._words().has(v) || this._dictSet().has(v) || (extra && extra.has(v)));
      let pick = whole.length === 1 ? whole : hits;
      // "çalışıyorum" and "çalışiyorum" both split into a stem and an ending that are on the list; only the first
      // keeps its vowels in one family (back or front), which is how Turkish endings follow their stem.
      if (pick.length > 1) {
        const harmonic = pick.filter(v => this._harmonic(v));
        if (harmonic.length >= 1 && harmonic.length < pick.length) pick = harmonic;
      }
      if (pick.length === 1) {
        const fixed = this._withCase(tok, pick[0]);
        changed.push({ from: tok, to: fixed });
        return fixed;
      }
      if (pick.length > 1) ambiguous.push(tok);
      return tok;
    });
    return { text: out, changed, ambiguous: [...new Set(ambiguous)] };
  },

  // ---- unknown words, with near suggestions ----------------------------------------------------
  _lev1(a, b) {
    if (Math.abs(a.length - b.length) > 1) return false;
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
    return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
  },
  suggest(word) {
    const w = this.lower(word);
    const out = [];
    const vs = this._variants(w);
    for (const v of vs || []) if (this.known(v)) out.push(v);
    if (out.length < 5) for (const k of this._words()) { if (k.length >= 3 && this._lev1(w, k) && !out.includes(k)) out.push(k); if (out.length >= 5) break; }
    return out.slice(0, 5);
  },
  unknown(text) {
    const counts = new Map();
    for (const m of String(text == null ? '' : text).matchAll(/[A-Za-zÇĞİÖŞÜçğıöşüÂâÎîÛû]{3,}/g)) {
      const w = this.lower(m[0]);
      if (this.known(w)) continue;
      counts.set(w, (counts.get(w) || 0) + 1);
    }
    return [...counts.entries()].map(([word, count]) => ({ word, count, suggestions: this.suggest(word) })).sort((a, b) => b.count - a.count || a.word.localeCompare(b.word, 'tr'));
  },

  tdkUrl(word) {
    const w = String(word || '').trim();
    if (!w || w.length > 60 || /\s/.test(w)) throw new Error('Select a single word');
    return this.TDK_URL.replace('%s', encodeURIComponent(w));
  },

  // ---- formal letters --------------------------------------------------------------------------
  TEMPLATES: {
    dilekce: { title: 'Dilekçe', text: '[İL / İLÇE] [KURUM ADI] MÜDÜRLÜĞÜNE\n\nKonu: [Başvurunun konusu]\n\nAçıklama:\n1. [Olayı ve tarihini yazın]\n2. [Talebinizin dayanağını yazın]\n\nYukarıda açıkladığım nedenlerle, [talebiniz] hususunda gereğinin yapılmasını saygılarımla arz ederim.\n\n[Tarih]\n\n[Ad Soyad]\n[İmza]\n\nT.C. Kimlik No: [___]\nAdres: [___]\nTelefon: [___]\n\nEkler:\n1) [___]\n' },
    tuketici: { title: 'Tüketici şikâyeti', text: '[FİRMA / SATICI ADI]\'na\n\nKonu: Ayıplı ürün / hizmet hakkında\n\n[Tarih] tarihinde [ürün / hizmet adı] için [tutar] TL ödeyerek [satış yeri veya internet sitesi] üzerinden satın aldım. (Sipariş / fatura no: [___])\n\n[Sorunu açıkça yazın: ne zaman fark ettiniz, ne bozuk ya da eksik.]\n\n6502 sayılı Tüketicinin Korunması Hakkında Kanun kapsamındaki haklarım uyarınca [ücretsiz onarım / değişim / bedel iadesi / bedelden indirim] talep ediyorum. [___] gün içinde yanıt verilmemesi hâlinde Tüketici Hakem Heyeti\'ne başvuracağım.\n\nSaygılarımla,\n[Ad Soyad]   [Telefon / e-posta]\n\nEkler: fatura / fiş, fotoğraflar, yazışmalar\n' },
    mazeret: { title: 'Devamsızlık mazeret yazısı', text: '[OKUL ADI] MÜDÜRLÜĞÜNE\n\n[Sınıf] sınıfı [okul no] numaralı öğrencisi [Ad Soyad], [başlangıç tarihi] - [bitiş tarihi] tarihleri arasında [sebep: hastalık / ailevi neden / ...] nedeniyle okula devam edememiştir.\n\nDevamsızlığımın mazeretli sayılmasını arz ederim.\n\n[Tarih]\n\nVeli / Öğrenci: [Ad Soyad]\n[İmza]\n\nEk: [Sağlık raporu / belge, varsa]\n' },
  },

  // ---- screens ---------------------------------------------------------------------------------
  _showDiff(before, result, onUse) {
    const K = VexStudyKit, G = VexSettingsGroups;
    const { body, close } = G.dialog({ id: 'vex-tr-diff', title: 'Put the Turkish letters back', sub: result.changed.length + ' word' + VexPlural.s(result.changed.length) + ' changed. Nothing is replaced until you press the button.' });
    body.appendChild(K.diffHtml(K.diffWords(before, result.text)));
    if (result.ambiguous.length) body.appendChild(G.note('Left as typed because two readings fit: ' + result.ambiguous.join(', ')));
    body.appendChild(K.el('div', { style: 'display:flex;gap:8px;margin-top:10px' },
      G.button(onUse.label, K.guard(async () => { await onUse.run(result.text); close(); }), { primary: true }),
      G.button('Cancel', () => close())));
  },
  async fixSelection(webview, sel, editable) {
    const r = this.deasciify(sel, { extra: this.dictionary() });
    if (!r.changed.length) { window.showToast?.(r.ambiguous.length ? 'Nothing was certain: ' + r.ambiguous.join(', ') + ' fit two readings' : 'No word here needs its Turkish letters back'); return; }
    this._showDiff(sel, r, editable && webview && webview.executeJavaScript
      ? { label: 'Replace the selection', run: async (t) => { const ok = await webview.executeJavaScript('document.execCommand("insertText", false, ' + JSON.stringify(t) + ')'); if (!ok) throw new Error('The page did not accept the new text. It is not copied; use Copy instead.'); } }
      : { label: 'Copy the new text', run: async (t) => { await VexStudyKit.copy(t); window.showToast?.('Copied'); } });
  },
  // Right-click rows for a selection (js/webview.js asks for them).
  textItems(selection, webview, { editable = false } = {}) {
    if (!this.enabled()) return [];
    const sel = String(selection == null ? '' : selection).trim();
    if (!sel) return [];
    const items = [];
    const safe = (fn) => () => { Promise.resolve().then(fn).catch((e) => window.showToast?.((e && e.message) || 'That did not work', 'error')); };
    if (sel.length <= 40 && !/\s/.test(sel) && /^[\p{L}'-]+$/u.test(sel)) items.push({ label: 'TDK\'de ara', action: safe(() => { if (typeof TabManager === 'undefined') throw new Error('Tabs are not available'); TabManager.createTab(this.tdkUrl(sel), true); }) });
    if (sel.length <= 6000 && this.deasciify(sel, { extra: this.dictionary() }).changed.length) items.push({ label: 'Put Turkish letters back...', action: safe(() => this.fixSelection(webview, sel, editable)) });
    return items;
  },

  open() {
    if (typeof VexUsage !== 'undefined') VexUsage.touch('turkish-helpers');
    const K = VexStudyKit, G = VexSettingsGroups;
    const { body } = G.dialog({ id: 'vex-tr-helpers', title: 'Turkish helpers', sub: 'Typing, a small dictionary, and formal letters to fill in. On this computer.' });
    const ta = K.el('textarea', { rows: '7', style: 'width:100%', 'aria-label': 'Turkish text', placeholder: 'Yazın veya yapıştırın... (type or paste)' });
    const out = K.el('div', { style: 'margin-top:10px' });
    const letters = K.el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin:8px 0' }, ['ç', 'Ç', 'ğ', 'Ğ', 'ı', 'I', 'İ', 'i', 'ö', 'Ö', 'ş', 'Ş', 'ü', 'Ü'].map(ch => G.button(ch, K.guard(async () => { await K.copy(ch); window.showToast?.(ch + ' copied'); }), { label: 'Copy ' + ch })));
    const draw = () => {
      out.textContent = '';
      const list = this.unknown(ta.value);
      if (!list.length) { out.appendChild(G.note('Every word is in the bundled list or your dictionary.')); return; }
      out.appendChild(G.note(list.length + ' word' + VexPlural.s(list.length) + ' not in the small bundled list or your dictionary. Most are probably fine.'));
      for (const u of list.slice(0, 60)) {
        out.appendChild(K.el('div', { style: 'display:flex;gap:8px;align-items:center;margin:4px 0;flex-wrap:wrap' }, K.el('strong', { text: u.word + (u.count > 1 ? ' x' + u.count : '') }),
          u.suggestions.length ? K.el('span', { class: 'vex-platform-note', text: 'maybe: ' + u.suggestions.join(', ') }) : null,
          G.button('Add to my dictionary', K.guard(async () => { await this._addDialog(u.word); draw(); }))));
      }
    };
    body.append(ta, letters, K.el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' },
      G.button('Put Turkish letters back', K.guard(() => { const r = this.deasciify(ta.value, { extra: this.dictionary() }); if (!r.changed.length) { window.showToast?.('No word here needs its Turkish letters back'); return; } this._showDiff(ta.value, r, { label: 'Use the new text', run: async (t) => { ta.value = t; draw(); } }); }), { primary: true }),
      G.button('Find unknown words', K.guard(draw)),
      G.button('My dictionary (' + this.dictionary().length + ')', K.guard(() => this.openDictionary())),
      G.button('Formal letters', K.guard(() => this.openTemplates()))), out);
  },
  async _addDialog(word) {
    const cands = this.stemCandidates(word);
    let use = this.lower(word);
    if (cands.length) {
      const stem = cands[cands.length - 1];
      const yes = await window.vexConfirm({ title: 'Add "' + word + '" or its stem?', message: 'Adding the stem "' + stem + '" also covers its endings (' + stem + 'lar, ' + stem + 'da ...). Consonant changes such as kitap -> kitabı are not covered; add those forms yourself.', okLabel: 'Add "' + stem + '"', cancelLabel: 'Add exactly "' + use + '"' });
      if (yes) use = stem;
    }
    this.addWord(use);
    window.showToast?.('Added "' + use + '"');
  },
  openDictionary() {
    const K = VexStudyKit, G = VexSettingsGroups;
    const { body } = G.dialog({ id: 'vex-tr-dict', title: 'My Turkish dictionary', sub: 'Words the helpers should know. Endings are covered.' });
    const draw = () => {
      body.textContent = '';
      const input = K.el('input', { type: 'text', placeholder: 'A word', 'aria-label': 'A word to add' });
      body.appendChild(K.el('div', { style: 'display:flex;gap:8px;margin-bottom:8px' }, input, G.button('Add', K.guard(async () => { await this._addDialog(input.value); draw(); }), { primary: true })));
      const list = this.dictionary();
      if (!list.length) body.appendChild(G.note('Empty.'));
      for (const w of list) body.appendChild(K.el('div', { style: 'display:flex;gap:8px;align-items:center;margin:2px 0' }, K.el('span', { text: w, style: 'flex:1' }), G.button('Remove', K.guard(() => { this.removeWord(w); draw(); }), { danger: true })));
    };
    draw();
  },
  openTemplates() {
    const K = VexStudyKit, G = VexSettingsGroups;
    const { body } = G.dialog({ id: 'vex-tr-letters', title: 'Resmi yazılar (formal letters)', sub: 'Templates to fill in. Not legal advice.' });
    const pick = K.el('select', { 'aria-label': 'Letter' }, Object.entries(this.TEMPLATES).map(([id, t]) => K.el('option', { value: id, text: t.title })));
    const ta = K.el('textarea', { rows: '16', style: 'width:100%;margin-top:8px', 'aria-label': 'Letter text' });
    const load = () => { ta.value = this.TEMPLATES[pick.value].text; };
    pick.addEventListener('change', load);
    const open = (url) => K.guard(() => { if (typeof TabManager === 'undefined') throw new Error('Tabs are not available'); TabManager.createTab(url, true); });
    body.append(pick, ta, K.el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:8px' },
      G.button('Copy', K.guard(async () => { await K.copy(ta.value); window.showToast?.('Copied'); }), { primary: true }),
      G.button('Save as a note', K.guard(() => { K.saveNote(this.TEMPLATES[pick.value].title, ta.value); window.showToast?.('Saved as a note'); })),
      G.button('Open CİMER', open(this.CIMER_URL)),
      G.button('Open the consumer page (Ticaret Bakanlığı)', open(this.CONSUMER_URL))),
      G.note('Fill in the [brackets]. For a consumer complaint, write to the seller first and keep the proof; if there is no answer, the Tüketici Hakem Heyeti is the next step. CİMER takes petitions to public bodies. Check the current rules and amounts yourself.'));
    load();
  },

  group(el) {
    const G = VexSettingsGroups;
    el.appendChild(G.note('Right-click a word: "TDK\'de ara" (opens the dictionary site, only when you click). Right-click Turkish typed without ç ğ ı ö ş ü: put the letters back after a before/after view. A small word list and your own dictionary; formal letters to fill in.'));
    el.appendChild(G.button('Open the Turkish helpers', () => this.open(), { primary: true }));
  },
};

if (typeof window !== 'undefined') window.VexTurkishHelpers = VexTurkishHelpers;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexTurkishHelpers };
