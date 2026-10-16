// === Glossary harvest and hover cards (T3-027) ==================================
//
// Collect the terms a page or a note defines into one glossary per subject, with the
// definition YOU confirm, and show them as small cards when the same words turn up on a
// later page.
//
//   1. harvest: the text of the page (or your selection) is read for definitions written the
//      usual ways ("Term: definition", "Term - definition", "X is defined as ...", "X refers
//      to ..."). Nothing is added by itself: you see the candidates, can change each
//      definition, and only the ones you tick are kept, each with the page it came from.
//   2. subject: the glossary is per subject (the current course when js/course-spaces.js is
//      there, else "General").
//   3. hover cards: on a page that contains a term of the glossary, its first occurrence is
//      underlined with dots; pointing at it shows the definition and its source. Off per
//      switch ("Show cards on pages"), never on private windows and never on Vex's own pages.
//   4. translate: "Keep these terms as written" hands the subject's terms to the translate
//      glossary (js/translate-glossary.js), so a translation leaves them alone.
//
// Local only. Stored in vex.studyGlossary. No lookup leaves the computer.
//
//   VexStudyGlossary.harvest(text)      pure: [{term, def}] candidates
//   VexStudyGlossary.cardTerms(subject) the [{term, def, source}] a page is searched for
//   vexGlossaryPageLib(terms)           runs INSIDE the page (injected as source)
function vexGlossaryPageLib(terms) {
  var SKIP = /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA|INPUT|SELECT|CODE|PRE|BUTTON|A)$/;
  if (document.documentElement.getAttribute('data-vex-gloss')) return 0;
  document.documentElement.setAttribute('data-vex-gloss', '1');
  var card = null;
  function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function show(span, t) {
    if (!card) {
      card = document.createElement('div');
      card.setAttribute('role', 'tooltip');
      card.style.cssText = 'position:fixed;z-index:2147483600;max-width:320px;padding:8px 10px;border-radius:8px;background:#1b1d26;color:#f3f4f8;font:13px/1.45 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.35);pointer-events:none';
      document.documentElement.appendChild(card);
    }
    card.textContent = '';
    var h = document.createElement('div'); h.style.cssText = 'font-weight:600;margin-bottom:2px'; h.textContent = t.term;
    var d = document.createElement('div'); d.textContent = t.def;
    card.appendChild(h); card.appendChild(d);
    if (t.src) { var s = document.createElement('div'); s.style.cssText = 'opacity:.65;font-size:11px;margin-top:4px'; s.textContent = t.src; card.appendChild(s); }
    var r = span.getBoundingClientRect();
    card.style.display = 'block';
    card.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 336)) + 'px';
    card.style.top = (r.bottom + 6 + 120 > window.innerHeight ? Math.max(8, r.top - card.offsetHeight - 6) : r.bottom + 6) + 'px';
  }
  function hide() { if (card) card.style.display = 'none'; }
  var done = 0;
  var list = terms.slice().sort(function (a, b) { return b.term.length - a.term.length; });
  for (var i = 0; i < list.length; i++) {
    var t = list[i];
    var re;
    try { re = new RegExp('(?<![\\p{L}\\p{N}])' + esc(t.term) + '(?![\\p{L}\\p{N}])', 'iu'); } catch (e) { continue; }
    var w = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT, { acceptNode: function (n) {
      var p = n.parentNode;
      if (!p || SKIP.test(p.nodeName) || (p.closest && p.closest('[data-vex-gl],[contenteditable=""],[contenteditable="true"]'))) return 2;
      return 1;
    } });
    var n, hit = null;
    while ((n = w.nextNode())) { var m = re.exec(n.nodeValue); if (m) { hit = { node: n, at: m.index, len: m[0].length }; break; } }
    if (!hit) continue;
    var tail = hit.node.splitText(hit.at);
    tail.splitText(hit.len);
    var span = document.createElement('span');
    span.setAttribute('data-vex-gl', '1');
    span.tabIndex = 0;
    span.style.cssText = 'border-bottom:1px dotted currentColor;cursor:help';
    tail.parentNode.replaceChild(span, tail);
    span.appendChild(tail);
    (function (sp, tt) {
      sp.addEventListener('mouseenter', function () { show(sp, tt); });
      sp.addEventListener('focus', function () { show(sp, tt); });
      sp.addEventListener('mouseleave', hide);
      sp.addEventListener('blur', hide);
    })(span, t);
    if (++done >= 40) break;
  }
  return done;
}

const VexStudyGlossary = {
  KEY: 'vex.studyGlossary',
  PREF: 'vex.studyGlossary.enabled',
  CARDS_PREF: 'vex.studyGlossary.cards',
  MAX_PER_SUBJECT: 300,
  MAX_CANDIDATES: 60,

  _flag: null,
  _f() { return this._flag || (this._flag = VexStudyKit.flag(this.PREF)); },
  enabled() { return this._f().enabled(); },
  setEnabled(on) { this._f().set(on); },
  cardsOn() { try { return localStorage.getItem(this.CARDS_PREF) !== 'off'; } catch (err) { console.error('[Glossary] cards switch unreadable:', err); return false; } },
  setCards(on) { localStorage.setItem(this.CARDS_PREF, on ? 'on' : 'off'); },

  _st() { return VexStudyKit.store(this.KEY, { v: 1, subjects: {} }); },
  _read() {
    const d = this._st().get();
    if (!d || typeof d !== 'object' || typeof d.subjects !== 'object' || !d.subjects) throw new Error('The glossary is damaged and was left as it is');
    return d;
  },

  currentSubject() {
    try {
      const c = typeof VexCourseSpaces !== 'undefined' && VexCourseSpaces.current ? VexCourseSpaces.current() : null;
      if (c && c.name) return String(c.name);
    } catch (err) { console.error('[Glossary] the current course could not be read:', err); }
    return 'General';
  },
  subjects() { return Object.keys(this._read().subjects); },
  list(subject) { return (this._read().subjects[subject || this.currentSubject()] || []).slice(); },

  // ---- harvesting (pure) -------------------------------------------------------------
  harvest(text) {
    const src = String(text == null ? '' : text).replace(/\r/g, '').slice(0, 120000);
    const found = new Map();
    const add = (term, def) => {
      term = term.replace(/^[\s*_"'`(]+|[\s*_"'`):,;.]+$/g, '').trim();
      def = def.replace(/\s+/g, ' ').replace(/^[\s:–—-]+/, '').trim();
      if (term.length < 2 || term.length > 60 || term.split(/\s+/).length > 5) return;
      if (def.length < 12) return;
      if (/^(the|a|an|this|that|it|he|she|they|we|you|i|there|here)$/i.test(term)) return;
      if (def.length > 280) def = def.slice(0, 277).replace(/\s+\S*$/, '') + '...';
      const k = VexStudyKit.fold(term);
      if (!found.has(k) && found.size < this.MAX_CANDIDATES) found.set(k, { term, def });
    };
    // "Term: definition"  "Term - definition"  "**Term** - definition"
    const listy = /^[ \t]*(?:[-*•]\s+)?(\*\*[^*\n]{2,60}\*\*|[A-ZÇĞİÖŞÜ][^\n:–—]{1,50}?)[ \t]*(?::|\s[-–—]\s)[ \t]*([^\n]{12,})$/gm;
    for (const m of src.matchAll(listy)) add(m[1].replace(/\*\*/g, ''), m[2]);
    // "X is defined as ...", "X refers to ...", "X means ..."
    const sent = /(?:^|[.!?]\s+)(?:The\s+|A\s+|An\s+)?([A-ZÇĞİÖŞÜa-zçğıöşü][\p{L}\p{N}' -]{1,50}?)\s+(?:is defined as|are defined as|refers to|is known as|is called|means|denotes|çıkarılır|olarak tanımlanır)\s+([^.!?\n]{12,}[.!?]?)/gu;
    for (const m of src.matchAll(sent)) add(m[1], m[2]);
    // "Term (TT) is a ..." -> definitions that start "X is a/an/the ..." at a sentence start, capitalised terms only
    const isA = /(?:^|\n|[.!?]\s+)([A-Z][\p{L}\p{N}-]+(?:\s[A-Z]?[\p{L}\p{N}-]+){0,3})\s+is\s+(?:a|an|the)\s+([^.!?\n]{14,}[.!?]?)/gu;
    for (const m of src.matchAll(isA)) add(m[1], 'A ' + m[2].replace(/^(a|an|the)\s+/i, ''));
    return [...found.values()];
  },

  // ---- storage ------------------------------------------------------------------------
  add({ term, def, source, subject } = {}) {
    const t = String(term == null ? '' : term).trim();
    const d = String(def == null ? '' : def).trim();
    if (!t) throw new Error('Write the term first');
    if (t.length > 80) throw new Error('That term is too long (80 letters at most)');
    if (!d) throw new Error('A glossary entry needs a definition you have read and agree with');
    if (d.length > 600) throw new Error('That definition is too long (600 letters at most)');
    const sub = String(subject || this.currentSubject()).slice(0, 60);
    const data = this._read();
    const list = data.subjects[sub] || [];
    const entry = {
      id: 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      term: t, def: d,
      source: source && /^https?:\/\//i.test(source.url || '') ? { url: String(source.url).slice(0, 500), title: String(source.title || '').slice(0, 120) } : null,
      at: Date.now(),
    };
    const i = list.findIndex(e => VexStudyKit.fold(e.term) === VexStudyKit.fold(t));
    if (i >= 0) { entry.id = list[i].id; list[i] = entry; }
    else {
      if (list.length >= this.MAX_PER_SUBJECT) throw new Error('This glossary is full (' + this.MAX_PER_SUBJECT + ' terms)');
      list.push(entry);
    }
    data.subjects[sub] = list;
    this._st().set(data);
    try { document.dispatchEvent(new CustomEvent('vex:study-glossary')); } catch (err) { console.error('[Glossary] event failed:', err); }
    return entry;
  },
  remove(subject, id) {
    const data = this._read();
    const list = data.subjects[subject] || [];
    const next = list.filter(e => e.id !== id);
    if (next.length === list.length) return false;
    if (next.length) data.subjects[subject] = next; else delete data.subjects[subject];
    this._st().set(data);
    return true;
  },

  cardTerms(subject) {
    const data = this._read();
    const names = subject ? [subject] : Object.keys(data.subjects);
    const out = [];
    const seen = new Set();
    for (const s of names) {
      for (const e of data.subjects[s] || []) {
        const k = VexStudyKit.fold(e.term);
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ term: e.term, def: e.def.slice(0, 300), src: e.source ? (e.source.title || e.source.url) : '' });
      }
    }
    return out.slice(0, 120);
  },

  toMarkdown(subject) {
    const list = this.list(subject).sort((a, b) => VexStudyKit.fold(a.term).localeCompare(VexStudyKit.fold(b.term)));
    return '# Glossary: ' + subject + '\n\n' + list.map(e => '**' + e.term + '**: ' + e.def + (e.source ? ' (' + (e.source.title || e.source.url) + ', ' + e.source.url + ')' : '')).join('\n\n') + '\n';
  },

  toTranslateGlossary(subject) {
    if (typeof GlossaryTranslate === 'undefined') throw new Error('The translate glossary is not loaded');
    let n = 0;
    for (const e of this.list(subject)) { GlossaryTranslate.addTerm('*', e.term, ''); n++; }
    return n;
  },

  // ---- on a page ----------------------------------------------------------------------
  // Called on dom-ready by webview.js. Nothing is injected when there is no term or the
  // page is not an ordinary web page.
  applyTo(webview, url) {
    if (!this.enabled() || !this.cardsOn() || !/^https?:\/\//i.test(String(url || ''))) return false;
    if (typeof VexTabPolicy !== 'undefined' && VexTabPolicy.isPrivateWindow) return false;
    if (typeof VexTabPolicy !== 'undefined' && VexTabPolicy.canFillWebview && !VexTabPolicy.canFillWebview(webview)) return false;
    let terms;
    try { terms = this.cardTerms(); }
    catch (err) {
      if (typeof VexProblems !== 'undefined') VexProblems.note('Glossary', 'The glossary could not be read, so no cards were shown', err);
      else console.error('[Glossary] not read:', err);
      return false;
    }
    if (!terms.length) return false;
    const js = '(' + vexGlossaryPageLib.toString() + ')(' + JSON.stringify(terms) + ')';
    Promise.resolve(webview.executeJavaScript(js)).catch(err => {
      if (typeof VexProblems !== 'undefined') VexProblems.note('Glossary', 'The hover cards could not be put on a page', err);
      else console.error('[Glossary] cards not applied:', err);
    });
    return true;
  },

  async _pageText(webview, selectionOnly) {
    if (!webview || typeof webview.executeJavaScript !== 'function') throw new Error('Open a web page first');
    const js = selectionOnly
      ? 'String(getSelection()||"").slice(0,120000)'
      : '(function(){var r=document.querySelector("article,main,[role=main]")||document.body;return String(r?r.innerText:"").slice(0,120000)})()';
    return String(await webview.executeJavaScript(js) || '');
  },

  // Page or selection -> candidates -> you confirm.
  async harvestFromPage(webview) {
    const url = String((webview.getURL && webview.getURL()) || '');
    const title = String((webview.getTitle && webview.getTitle()) || url);
    let text = await this._pageText(webview, true);
    const fromSel = !!text.trim();
    if (!fromSel) text = await this._pageText(webview, false);
    const cands = this.harvest(text);
    if (!cands.length) {
      window.showToast?.(fromSel ? 'No definitions found in the selection' : 'No definitions found on this page. Select a passage, or use "Add the selected word".');
      return 0;
    }
    return this._confirmDialog(cands, { url, title });
  },

  _confirmDialog(cands, source) {
    const K = VexStudyKit;
    return new Promise((resolve) => {
      const { body, close, overlay } = VexSettingsGroups.dialog({ id: 'vex-gloss-harvest', title: 'Terms found', sub: 'Tick the ones to keep. Read each definition and change it so it says what you mean.' });
      const subject = this.currentSubject();
      const rows = cands.map(c => {
        const cb = K.el('input', { type: 'checkbox', 'aria-label': 'Keep ' + c.term });
        const term = K.el('input', { type: 'text', value: c.term, 'aria-label': 'Term', style: 'width:100%;margin:4px 0' });
        const def = K.el('textarea', { rows: '3', 'aria-label': 'Definition of ' + c.term, style: 'width:100%' });
        def.value = c.def;
        const box = K.el('div', { style: 'display:grid;grid-template-columns:24px 1fr;gap:8px;margin:10px 0' }, cb, K.el('div', {}, term, def));
        body.appendChild(box);
        return { cb, term, def };
      });
      const done = K.el('div', { style: 'display:flex;gap:8px;margin-top:12px' },
        VexSettingsGroups.button('Keep the ticked terms in "' + subject + '"', K.guard(() => {
          let n = 0;
          for (const r of rows) if (r.cb.checked) { this.add({ term: r.term.value, def: r.def.value, source, subject }); n++; }
          close(); window.showToast?.(n ? n + ' term' + (n === 1 ? '' : 's') + ' added' : 'Nothing ticked');
          resolve(n);
        }), { primary: true }),
        VexSettingsGroups.button('Cancel', () => { close(); resolve(0); }));
      body.appendChild(done);
      // Closing with the X or Escape resolves nothing was kept.
      const watch = new MutationObserver(() => { if (!overlay.isConnected) { watch.disconnect(); resolve(0); } });
      watch.observe(document.body, { childList: true });
    });
  },

  async addSelection(webview, selection) {
    const sel = String(selection || '').trim();
    if (!sel || sel.length > 80) throw new Error('Select one term (up to 80 letters)');
    const def = await window.vexPrompt({ title: 'Define "' + sel + '"', message: 'Write the definition in your own words, or paste it from the source. Subject: ' + this.currentSubject(), label: 'Definition', multiline: true, okLabel: 'Add' });
    if (def == null) return null;
    const url = String((webview && webview.getURL && webview.getURL()) || '');
    const title = String((webview && webview.getTitle && webview.getTitle()) || '');
    const e = this.add({ term: sel, def, source: { url, title } });
    window.showToast?.('Added to the glossary');
    return e;
  },

  // ---- screens ------------------------------------------------------------------------
  openScreen() {
    if (typeof VexUsage !== 'undefined') VexUsage.touch('study-glossary');
    const K = VexStudyKit, G = VexSettingsGroups;
    const { body } = G.dialog({ id: 'vex-gloss', title: 'Glossary', sub: 'Terms you confirmed, per subject. Local only.' });
    const draw = () => {
      body.textContent = '';
      const subs = this.subjects();
      if (!subs.length) body.appendChild(G.note('Nothing yet. On a page: Ctrl+K "Find terms on this page", or select a word and use the right-click menu.'));
      for (const s of subs) {
        body.appendChild(K.el('h3', { text: s + ' (' + this.list(s).length + ')', style: 'margin:14px 0 4px' }));
        const bar = K.el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px' },
          G.button('Copy as a note text', K.guard(async () => { await K.copy(this.toMarkdown(s)); window.showToast?.('Copied'); })),
          G.button('Save as a note', K.guard(() => { K.saveNote('Glossary: ' + s, this.toMarkdown(s)); window.showToast?.('Saved as a note'); })),
          G.button('Keep these terms as written when translating', K.guard(() => { const n = this.toTranslateGlossary(s); window.showToast?.(n + ' terms handed to the translate glossary'); })));
        body.appendChild(bar);
        for (const e of this.list(s)) {
          body.appendChild(K.el('div', { style: 'display:flex;gap:8px;align-items:flex-start;margin:6px 0' },
            K.el('div', { style: 'flex:1' }, K.el('strong', { text: e.term }), ' ', e.def, e.source ? K.el('div', { class: 'vex-platform-note', text: e.source.title || e.source.url }) : null),
            G.button('Remove', K.guard(async () => { if (await window.vexConfirm({ title: 'Remove "' + e.term + '"?', okLabel: 'Remove', danger: true })) { this.remove(s, e.id); draw(); } }), { danger: true })));
        }
      }
    };
    draw();
  },

  group(el) {
    const G = VexSettingsGroups;
    el.appendChild(G.note('Terms you confirmed from pages and notes, with their sources. Points at a term on a later page to see its card.'));
    const cards = VexStudyKit.el('label', { style: 'display:flex;gap:8px;align-items:center;margin:6px 0' }, VexStudyKit.el('input', { type: 'checkbox', 'aria-label': 'Show glossary cards on pages' }), 'Show glossary cards on pages');
    cards.firstChild.checked = this.cardsOn();
    cards.firstChild.addEventListener('change', (e) => this.setCards(e.target.checked));
    el.appendChild(cards);
    el.appendChild(G.button('Open the glossary', () => this.openScreen(), { primary: true }));
  },
};

if (typeof window !== 'undefined') {
  window.VexStudyGlossary = VexStudyGlossary;
  window.vexGlossaryPageLib = vexGlossaryPageLib;
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexStudyGlossary, vexGlossaryPageLib };
