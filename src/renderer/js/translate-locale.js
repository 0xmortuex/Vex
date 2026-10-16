// === Turkish <-> English that knows which language it is reading =============
//
// What the translator (js/translate-side.js, js/translate-glossary.js) did not
// know, this adds, around it and without replacing it:
//
//   skip text already in the target   a Turkish page translated "into Turkish"
//                                     no longer prints its own paragraphs again
//   never translate these sites       "Always translate" and the automatic run
//                                     leave them alone (a manual run still works)
//   hover gloss                       English terms from your glossary on a page
//                                     show their Turkish (or your word) on hover
//   language profile                  per context (summaries, mail, chat): reply
//                                     language and formality, with the names that
//                                     must never be translated. Turkish-first
//                                     summaries are one setting here.
//   bilingual compose                 write in one language, see the other beside
//                                     it, copy either side
//
// The translator is the same one the page translation uses (the main process's
// 'translate:text'); the text of a compose box goes to it only when you press
// Translate. Nothing is sent by itself. Language detection is local and plain:
// Turkish letters and common Turkish words against common English ones.
//
// The pure parts (detect, skips, instruction, shapeRequest) are unit-tested.
const VexLocaleTranslate = {
  PREF: 'vex.localeTranslate.enabled',
  KEY: 'vex.localeTranslate',   // { skipSame, never: [host], profile: {summary,mail,chat}, keepNames: [string], gloss }
  CONTEXTS: { summary: 'Summaries', mail: 'Mail replies', chat: 'Chat replies' },
  LANGS: { auto: 'Same as the text', tr: 'Turkish', en: 'English' },
  FORMALITY: { neutral: 'No preference', formal: 'Formal (siz)', informal: 'Informal (sen)' },
  MAX_NAMES: 60,

  _TR_WORDS: ['ve', 'bir', 'bu', 'için', 'icin', 'ile', 'da', 'de', 'çok', 'cok', 'gibi', 'olarak', 'daha', 'ama', 'ancak', 'değil', 'degil', 'var', 'yok', 'ne', 'ben', 'sen', 'biz', 'siz', 'şu', 'o', 'mi', 'mı', 'mu', 'mü', 'kadar', 'sonra', 'önce', 'once', 'her', 'olan', 'ise', 'veya', 'hangi', 'nasıl', 'nasil'],
  _EN_WORDS: ['the', 'and', 'of', 'to', 'in', 'is', 'that', 'for', 'it', 'with', 'as', 'was', 'on', 'are', 'this', 'be', 'by', 'at', 'or', 'from', 'have', 'not', 'but', 'you', 'your', 'we', 'they', 'will', 'can', 'which'],

  // ---- state -------------------------------------------------------------------
  defaults() {
    return { skipSame: true, never: [], profile: { summary: { lang: 'auto', formality: 'neutral' }, mail: { lang: 'auto', formality: 'neutral' }, chat: { lang: 'auto', formality: 'neutral' } }, keepNames: [], gloss: false };
  },
  state() {
    let raw = null;
    try { raw = localStorage.getItem(this.KEY); }
    catch (err) { throw new Error('The translation settings could not be read: ' + err.message); }
    const d = this.defaults();
    if (!raw) return d;
    let o;
    try { o = JSON.parse(raw); } catch (err) { throw new Error('The saved translation settings are damaged: ' + err.message); }
    if (!o || typeof o !== 'object') return d;
    if (typeof o.skipSame === 'boolean') d.skipSame = o.skipSame;
    if (typeof o.gloss === 'boolean') d.gloss = o.gloss;
    if (Array.isArray(o.never)) d.never = o.never.filter(h => typeof h === 'string' && h);
    if (Array.isArray(o.keepNames)) d.keepNames = o.keepNames.filter(h => typeof h === 'string' && h.trim()).slice(0, this.MAX_NAMES);
    for (const c of Object.keys(d.profile)) {
      const p = o.profile && o.profile[c];
      if (p && this.LANGS[p.lang]) d.profile[c].lang = p.lang;
      if (p && this.FORMALITY[p.formality]) d.profile[c].formality = p.formality;
    }
    return d;
  },
  save(patch) {
    const s = { ...this.state(), ...patch };
    try { localStorage.setItem(this.KEY, JSON.stringify(s)); }
    catch (err) { throw new Error('The translation settings could not be saved: ' + err.message); }
    return s;
  },
  enabled() { try { return localStorage.getItem(this.PREF) !== 'off'; } catch { return true; } },
  setEnabled(on) { localStorage.setItem(this.PREF, on ? 'on' : 'off'); },

  // ---- detecting the language (pure) -----------------------------------------------
  // -> { lang: 'tr' | 'en' | '', confidence: 0..1 }. '' = cannot tell (too short, numbers, code).
  detect(text) {
    const s = String(text == null ? '' : text);
    const words = (s.toLowerCase().match(/[a-zçğıöşüâîû]+/g) || []);
    if (words.length < 3) return { lang: '', confidence: 0 };
    const trChars = (s.match(/[çğışöüÇĞİŞÖÜ]/g) || []).length;
    let tr = 0, en = 0;
    const trSet = new Set(this._TR_WORDS), enSet = new Set(this._EN_WORDS);
    for (const w of words) { if (trSet.has(w)) tr++; if (enSet.has(w)) en++; }
    // Turkish suffix shapes: -lar/-ler, -yor, -mış, -dır ... a weak signal, counted once per word.
    for (const w of words) if (w.length > 5 && /(lar|ler|yor|muş|miş|dır|dir|ında|inde|ları|leri)$/.test(w)) tr += 0.5;
    const trScore = tr + trChars * 0.7, enScore = en;
    const total = trScore + enScore;
    if (total < 1.5) return { lang: '', confidence: 0 };
    const lang = trScore > enScore ? 'tr' : (enScore > trScore ? 'en' : '');
    return { lang, confidence: lang ? Math.round((Math.max(trScore, enScore) / total) * 100) / 100 : 0 };
  },

  // Is this paragraph already in the language it would be translated into? (pure)
  alreadyIn(text, target) {
    const t = String(target || '').toLowerCase();
    if (t !== 'tr' && t !== 'en') return false;
    const d = this.detect(text);
    return d.lang === t && d.confidence >= 0.75;
  },

  // Called by the page translation for every paragraph: true = leave it, nothing to add.
  skips(text, target) {
    if (!this.enabled()) return false;
    return this.state().skipSame && this.alreadyIn(text, target);
  },

  // ---- never translate these sites ---------------------------------------------------
  neverHosts() { return this.state().never; },
  isNever(url) {
    if (!this.enabled()) return false;
    const h = this._host(url);
    return !!h && this.state().never.includes(h);
  },
  _host(url) { try { return /^https?:/i.test(url) ? new URL(url).hostname.replace(/^www\./, '').toLowerCase() : ''; } catch { return ''; } },
  setNever(url, on) {
    const h = this._host(url);
    if (!h) throw new Error('That is not a web page');
    const set = new Set(this.state().never);
    if (on) set.add(h); else set.delete(h);
    this.save({ never: [...set] });
    return !!on;
  },

  // ---- the language profile -> an instruction (pure) ------------------------------------
  instruction(context, s) {
    const st = s || this.state();
    const p = st.profile[context];
    if (!p) throw new Error('Unknown context "' + context + '"');
    const parts = [];
    if (p.lang === 'tr') parts.push('Write the answer in Turkish.');
    else if (p.lang === 'en') parts.push('Write the answer in English.');
    if (p.formality === 'formal') parts.push(p.lang === 'en' ? 'Use a formal register.' : 'Use the formal "siz" form and a polite register.');
    else if (p.formality === 'informal') parts.push(p.lang === 'en' ? 'Use a friendly, informal register.' : 'Use the informal "sen" form.');
    if (parts.length && st.keepNames.length) parts.push('Keep these names exactly as written, never translate them: ' + st.keepNames.join(', ') + '.');
    return parts.join(' ');
  },

  // A copy of an AI request with the profile's instruction appended to its message. Used for
  // summaries; a request that already carries the same instruction, or a profile that says
  // nothing, comes back unchanged.
  shapeRequest(feature, request) {
    const ctx = feature === 'summarize' ? 'summary' : (feature === 'chat' ? 'chat' : null);
    if (!ctx || !this.enabled()) return request;
    const line = this.instruction(ctx);
    if (!line) return request;
    const msg = String((request && request.message) || '');
    if (msg.includes(line)) return request;
    return { ...request, message: (msg ? msg + '\n\n' : '') + line };
  },

  // ---- hover gloss ---------------------------------------------------------------------
  // The page-side script: wraps glossary terms that have a replacement in a span whose title is the
  // replacement. Idempotent; clearGlossScript() puts the text back.
  glossScript(terms) {
    const list = (terms || []).filter(t => t && t.term && t.to).slice(0, 80).map(t => [t.term, t.to]);
    return `(() => {
      const terms = ${JSON.stringify(list)};
      if (!terms.length) return 0;
      const esc = (s) => s.replace(/[.*+?^$\\{\\}()|[\\]\\\\]/g, '\\\\$&');
      const re = new RegExp('(?<![\\\\p{L}\\\\p{N}])(' + terms.map(t => esc(t[0])).join('|') + ')(?![\\\\p{L}\\\\p{N}])', 'giu');
      const map = new Map(terms.map(t => [t[0].toLowerCase(), t[1]]));
      let n = 0;
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: (node) => {
        const p = node.parentElement;
        if (!p || p.closest('script,style,textarea,input,code,pre,[data-vex-gloss],[contenteditable]')) return NodeFilter.FILTER_REJECT;
        return re.test(node.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      } });
      const nodes = [];
      while (walker.nextNode() && nodes.length < 400) nodes.push(walker.currentNode);
      for (const node of nodes) {
        re.lastIndex = 0;
        const frag = document.createDocumentFragment();
        let last = 0, m;
        const text = node.nodeValue;
        while ((m = re.exec(text))) {
          frag.appendChild(document.createTextNode(text.slice(last, m.index)));
          const span = document.createElement('span');
          span.setAttribute('data-vex-gloss', '1');
          span.title = map.get(m[1].toLowerCase()) || '';
          span.style.cssText = 'text-decoration:underline dotted;text-underline-offset:2px;cursor:help';
          span.textContent = m[1];
          frag.appendChild(span);
          last = m.index + m[1].length; n++;
        }
        frag.appendChild(document.createTextNode(text.slice(last)));
        node.parentNode.replaceChild(frag, node);
      }
      return n;
    })()`;
  },
  clearGlossScript() {
    return `(() => { let n = 0; for (const s of document.querySelectorAll('[data-vex-gloss]')) { s.replaceWith(document.createTextNode(s.textContent)); n++; } document.body.normalize(); return n; })()`;
  },
  async glossActive(on) {
    if (typeof WebviewManager === 'undefined' || typeof GlossaryTranslate === 'undefined') throw new Error('The page glossary is not available');
    const wv = WebviewManager.getActiveWebview();
    const url = wv && wv.getURL ? wv.getURL() : '';
    if (!wv || !/^https?:/i.test(url)) throw new Error('Open a web page first');
    if (!on) return window.vexGuestEval(wv, this.clearGlossScript(), false, 6000);
    const terms = GlossaryTranslate.termsFor(GlossaryTranslate.hostOf(url)).filter(t => t.to);
    if (!terms.length) throw new Error('No glossary term on this site has a word of yours to show. Add one with a replacement first (Ctrl+K, "Add Glossary Term for This Site").');
    return window.vexGuestEval(wv, this.glossScript(terms), false, 8000);
  },

  // ---- bilingual compose ---------------------------------------------------------------------
  // Translates one text to `tl`, keeping the glossary and the names. Throws when the translator gave nothing.
  async translateText(text, tl, host) {
    const t = String(text == null ? '' : text).trim();
    if (!t) throw new Error('Write something first');
    if (!window.vex || typeof window.vex.translateText !== 'function') throw new Error('The translator is not available');
    const keep = this.state().keepNames.map(term => ({ term, to: '' }));
    const terms = (typeof GlossaryTranslate !== 'undefined' ? GlossaryTranslate.termsFor(host || '') : []).concat(keep);
    const parts = t.split(/\n{2,}/);   // one paragraph per call: the translator takes 400 characters
    const out = [];
    for (const para of parts) {
      for (const chunk of this._chunks(para, 380)) {
        let res;
        if (terms.length && typeof GlossaryTranslate !== 'undefined') {
          const p = GlossaryTranslate.protect(chunk, terms);
          const raw = await window.vex.translateText(p.text, tl);
          if (raw == null) throw new Error('The translator did not answer: check your connection and try again');
          const back = p.found.length ? GlossaryTranslate.restore(raw, p.found) : raw;
          res = back !== null ? back : GlossaryTranslate.NOT_APPLIED + GlossaryTranslate.restorePartial(raw, p.found);
        } else {
          res = await window.vex.translateText(chunk, tl);
          if (res == null) throw new Error('The translator did not answer: check your connection and try again');
        }
        out.push(res);
      }
      out.push('\n\n');
    }
    return out.join(' ').replace(/ ?\n\n ?/g, '\n\n').trim();
  },
  // Splits at sentence ends so no piece is longer than max.
  _chunks(text, max) {
    if (text.length <= max) return [text];
    const out = [];
    let cur = '';
    for (const s of text.split(/(?<=[.!?])\s+/)) {
      if (s.length > max) { if (cur) out.push(cur); cur = ''; for (let i = 0; i < s.length; i += max) out.push(s.slice(i, i + max)); continue; }
      if ((cur + ' ' + s).trim().length > max) { out.push(cur); cur = s; } else cur = (cur + ' ' + s).trim();
    }
    if (cur) out.push(cur);
    return out;
  },

  open() {
    if (typeof VexUsage !== 'undefined') VexUsage.touch('locale-translate');
    const { body } = VexSettingsGroups.dialog({ id: 'vex-compose-bilingual', title: 'Write in two languages', sub: 'Write on the left; press Translate to see the other language beside it. The text goes to the translator only when you press the button.' });
    const row = document.createElement('div');
    row.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:12px';
    const mk = (label) => {
      const wrap = document.createElement('div');
      const lab = document.createElement('label');
      lab.className = 'vexsr-sub';
      lab.textContent = label;
      const ta = document.createElement('textarea');
      ta.rows = 12;
      ta.style.cssText = 'width:100%;box-sizing:border-box';
      ta.setAttribute('aria-label', label);
      wrap.append(lab, ta);
      return { wrap, ta, lab };
    };
    const left = mk('You write');
    const right = mk('Other language');
    right.ta.readOnly = true;
    row.append(left.wrap, right.wrap);
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:10px;margin:10px 0;flex-wrap:wrap;align-items:center';
    const dir = document.createElement('select');
    dir.setAttribute('aria-label', 'Direction');
    for (const [v, t] of [['auto', 'Detect the language of what I write'], ['tr', 'I write Turkish, show English'], ['en', 'I write English, show Turkish']]) { const o = document.createElement('option'); o.value = v; o.textContent = t; dir.appendChild(o); }
    const status = VexSettingsGroups.note('');
    const go = VexSettingsGroups.button('Translate', async () => {
      try {
        let from = dir.value;
        if (from === 'auto') from = this.detect(left.ta.value).lang;
        if (!from) throw new Error('Could not tell which language that is: choose a direction');
        const tl = from === 'tr' ? 'en' : 'tr';
        status.textContent = 'Translating...';
        right.ta.value = await this.translateText(left.ta.value, tl, '');
        right.lab.textContent = tl === 'en' ? 'English' : 'Turkish';
        left.lab.textContent = from === 'tr' ? 'Turkish (you write)' : 'English (you write)';
        status.textContent = 'Done. Names from your glossary and the keep-names list were left as written.';
      } catch (err) { status.textContent = ''; window.showToast?.(err.message, 'error'); }
    }, { primary: true });
    const copy = (ta, name) => VexSettingsGroups.button('Copy ' + name, async () => {
      try { await navigator.clipboard.writeText(ta.value); window.showToast?.('Copied'); } catch (err) { window.showToast?.('Could not copy: ' + err.message, 'error'); }
    });
    bar.append(dir, go, copy(left.ta, 'mine'), copy(right.ta, 'the other'));
    body.append(row, bar, status);
  },

  // ---- Settings section ---------------------------------------------------------------------------
  group(el) {
    const add = (n) => el.appendChild(n);
    add(VexSettingsGroups.note('Page translation skips text already in the language you translate into, leaves sites you list alone, and the profile below shapes Vex AI answers. Detection is on this computer.'));
    const st = this.state();
    const check = (label, checked, onChange) => {
      const l = document.createElement('label');
      l.style.cssText = 'display:flex;gap:8px;align-items:center;margin:6px 0';
      const c = document.createElement('input');
      c.type = 'checkbox'; c.checked = checked;
      c.addEventListener('change', () => { try { onChange(c.checked); } catch (err) { c.checked = !c.checked; window.showToast?.(err.message, 'error'); } });
      l.append(c, document.createTextNode(label));
      return l;
    };
    add(check('Skip paragraphs that are already in the language I translate into', st.skipSame, (v) => this.save({ skipSame: v })));
    for (const [ctx, label] of Object.entries(this.CONTEXTS)) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:8px;align-items:center;margin:6px 0;flex-wrap:wrap';
      const name = document.createElement('span');
      name.textContent = label;
      name.style.minWidth = '110px';
      const mkSel = (opts, cur, aria, set) => {
        const s = document.createElement('select');
        s.setAttribute('aria-label', label + ': ' + aria);
        for (const [v, t] of Object.entries(opts)) { const o = document.createElement('option'); o.value = v; o.textContent = t; s.appendChild(o); }
        s.value = cur;
        s.addEventListener('change', () => { try { const prof = this.state().profile; set(prof[ctx], s.value); this.save({ profile: prof }); } catch (err) { window.showToast?.(err.message, 'error'); } });
        return s;
      };
      row.append(name, mkSel(this.LANGS, st.profile[ctx].lang, 'language', (p, v) => { p.lang = v; }), mkSel(this.FORMALITY, st.profile[ctx].formality, 'formality', (p, v) => { p.formality = v; }));
      add(row);
    }
    add(VexSettingsGroups.button('Names to keep exactly as written', async () => {
      const v = await window.vexPrompt({ title: 'Names to keep', message: 'Separate with commas. They are kept when writing in two languages and in answers shaped by the profile.', value: this.state().keepNames.join(', '), okLabel: 'Save' });
      if (v == null) return;
      try { this.save({ keepNames: v.split(',').map(x => x.trim()).filter(Boolean).slice(0, this.MAX_NAMES) }); window.showToast?.('Saved'); } catch (err) { window.showToast?.(err.message, 'error'); }
    }));
    add(VexSettingsGroups.button('Write in two languages', () => this.open(), { primary: true }));
    add(VexSettingsGroups.button('Show hover gloss on this page', () => this.glossActive(true).then(n => window.showToast?.(n + ' terms marked')).catch(e => window.showToast?.(e.message, 'error'))));
    add(VexSettingsGroups.button('Remove hover gloss', () => this.glossActive(false).then(() => window.showToast?.('Removed')).catch(e => window.showToast?.(e.message, 'error'))));
    add(VexSettingsGroups.button('Never translate this site', () => {
      try {
        const wv = WebviewManager.getActiveWebview();
        const url = wv && wv.getURL ? wv.getURL() : '';
        const on = !this.isNever(url);
        this.setNever(url, on);
        window.showToast?.(on ? 'This site will not be translated by itself' : 'This site can be translated by itself again');
      } catch (err) { window.showToast?.(err.message, 'error'); }
    }));
  },
};

if (typeof window !== 'undefined') {
  window.VexLocaleTranslate = VexLocaleTranslate;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({
      id: 'locale-translate',
      title: 'Turkish and English',
      keywords: 'translate turkish english bilingual compose gloss never translate formality siz sen language',
      build: (el) => VexLocaleTranslate.group(el),
    });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'compose-bilingual', label: 'Write in Two Languages', hint: 'Turkish and English side by side', icon: 'globe', action: () => VexLocaleTranslate.open() });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexLocaleTranslate };
