// === Learner reading aids (T3-034) =================================================
// vex-layer-exempt: a pointer-events:none tip drawn inside the guest page (injected script)
//
// For reading a page in a language you are still learning (English or Turkish):
//
//   Hover          point at a word and see its dictionary form and a short gloss, from a LOCAL word
//                  list (a small starter list ships with Vex; import your own in Settings).
//   Grey-out       words you marked as known are greyed, so the new ones stand out. "I know the
//                  common words" adopts a starter list in one click.
//   Vocabulary     "Save the selected word" keeps it with its sentence, page and gloss in the same
//                  vocabulary store as Study entry points (js/study-entry.js), exported to FlashMind.
//
// Nothing is looked up online and nothing about the page leaves this window: the page's words are
// read here, compared with the local lists here, and the marks are painted with the browser's
// highlight API (no page markup is changed). Off until you switch it on. Never in private, Tor or
// routed tabs. Finding the dictionary form of an inflected word is approximate (English endings and
// Turkish suffixes are stripped by rule), and says so.
//
// Bigger word lists: besides the starter list there is a list of the 3,000 commonest English words
// (js/reading-aids-lists.js, counted from 40 public-domain books; scripts/build-wordlists.js says how),
// adopted as "the first 1,000" or "the first 3,000" in one click. Turkish endings are taken off by the
// harmony-aware rules of js/turkish-lemma.js, on top of the flat suffix list below.
//
//   VexReadingAids.candidates(word, lang)     pure: the forms a word may come from, most likely first
//   VexReadingAids.lookup(word, lang)         { lemma, gloss, source } or null
//   VexReadingAids.parseList(text)            pure: CSV/TSV "word,gloss[,lemma]" lines -> entries
//   VexReadingAids.detectLang(htmlLang, text) 'en' | 'tr' | ''
const VexReadingAids = {
  FEATURE: 'reading-aids',
  ENABLED_KEY: 'vex.readingAids.enabled',   // 'on' only; off otherwise
  KNOWN_KEY: 'vex.readingAids.known',       // { en: [word], tr: [word] }
  LISTS_KEY: 'vex.readingAids.lists',       // { en: [[word, gloss, lemma]], tr: [...] }  (your imported lists)
  PREFS_KEY: 'vex.readingAids.prefs',       // { grey, hover, markNew }
  LANGS: ['en', 'tr'],
  MAX_KNOWN: 20000,
  MAX_LIST: 8000,
  MAX_PAGE_WORDS: 6000,
  MAX_GLOSS_ON_PAGE: 1500,

  // ---- switch and preferences ---------------------------------------------------------------------------------
  enabled() { try { return localStorage.getItem(this.ENABLED_KEY) === 'on'; } catch { return false; } },
  setEnabled(on) {
    try { localStorage.setItem(this.ENABLED_KEY, on ? 'on' : 'off'); }
    catch (err) { throw new Error('Could not save that setting: ' + err.message, { cause: err }); }
    return !!on;
  },
  _need() { if (!this.enabled()) throw new Error('Reading aids are switched off in Settings > Reading aids'); },
  _json(key, fallback, what) {
    let raw = null;
    try { raw = localStorage.getItem(key); } catch (err) { throw new Error('The ' + what + ' could not be read: ' + err.message, { cause: err }); }
    if (!raw) return fallback;
    try { return JSON.parse(raw); } catch (err) { throw new Error('The saved ' + what + ' are damaged: ' + err.message, { cause: err }); }
  },
  _put(key, value, what) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch (err) { throw new Error('The ' + what + ' could not be saved: ' + err.message, { cause: err }); }
  },
  prefs() {
    const p = this._json(this.PREFS_KEY, {}, 'reading aid settings');
    const o = p && typeof p === 'object' ? p : {};
    return { grey: o.grey !== false, hover: o.hover !== false, markNew: o.markNew === true };
  },
  setPrefs(patch) { const next = { ...this.prefs(), ...patch }; this._put(this.PREFS_KEY, next, 'reading aid settings'); return next; },

  // ---- words ----------------------------------------------------------------------------------------------------------
  lower(word, lang) { return String(word == null ? '' : word).normalize('NFC').toLocaleLowerCase(lang === 'tr' ? 'tr' : 'en').replace(/[’]/g, "'"); },

  EN_IRREGULAR: { is: 'be', are: 'be', was: 'be', were: 'be', been: 'be', am: 'be', has: 'have', had: 'have', did: 'do', does: 'do', done: 'do', went: 'go', gone: 'go', made: 'make', said: 'say', got: 'get', took: 'take', taken: 'take', came: 'come', saw: 'see', seen: 'see', knew: 'know', known: 'know', thought: 'think', found: 'find', gave: 'give', given: 'give', told: 'tell', children: 'child', men: 'man', women: 'woman', people: 'person', better: 'good', best: 'good', worse: 'bad', worst: 'bad' },
  TR_SUFFIXES: ['lar', 'ler', 'ları', 'leri', 'nın', 'nin', 'nun', 'nün', 'ın', 'in', 'un', 'ün', 'ı', 'i', 'u', 'ü', 'dan', 'den', 'tan', 'ten', 'da', 'de', 'ta', 'te', 'yla', 'yle', 'ya', 'ye', 'a', 'e', 'la', 'le', 'dır', 'dir', 'dur', 'dür', 'tır', 'tir', 'tur', 'tür', 'ım', 'im', 'um', 'üm', 'sın', 'sin', 'sun', 'sün', 'mış', 'miş', 'muş', 'müş', 'dı', 'di', 'du', 'dü', 'tı', 'ti', 'tu', 'tü', 'yor', 'ıyor', 'iyor', 'uyor', 'üyor', 'acak', 'ecek', 'sa', 'se', 'ki', 'ca', 'ce', 'ça', 'çe', 'lı', 'li', 'lu', 'lü', 'sız', 'siz', 'suz', 'süz', 'lık', 'lik', 'luk', 'lük', 'mak', 'mek', 'ma', 'me', 'ış', 'iş', 'uş', 'üş'],

  // The forms an inflected word may come from, most likely first (the word itself first). Approximate by design.
  candidates(word, lang) {
    const w = this.lower(word, lang).replace(/^'+|'+$/g, '');
    if (!w) return [];
    const out = [w];
    const add = (x) => { if (x && x.length >= 2 && !out.includes(x)) out.push(x); };
    if (lang === 'en') {
      const base = w.replace(/'s$/, '');
      add(base);
      if (this.EN_IRREGULAR[base]) add(this.EN_IRREGULAR[base]);
      const strip = (suffix, ...adds) => { if (base.length > suffix.length + 2 && base.endsWith(suffix)) { const stem = base.slice(0, -suffix.length); for (const a of adds) add(stem + a); const l = stem.length; if (l > 2 && stem[l - 1] === stem[l - 2]) add(stem.slice(0, -1)); } };
      strip('ies', 'y'); strip('ied', 'y'); strip('es', '', 'e'); strip('s', '');
      strip('ing', '', 'e'); strip('ed', '', 'e'); strip('ly', '', 'le'); strip('ier', 'y'); strip('iest', 'y'); strip('er', '', 'e'); strip('est', '', 'e'); strip('ness', ''); strip('ment', ''); strip('ful', '');
      return out;
    }
    if (lang === 'tr') {
      const seen = new Set([w]);
      let frontier = [w];
      for (let pass = 0; pass < 3; pass++) {
        const next = [];
        for (const f of frontier) {
          for (const s of this.TR_SUFFIXES) {
            if (f.length - s.length < 2 || !f.endsWith(s)) continue;
            const stem = f.slice(0, -s.length);
            if (seen.has(stem)) continue;
            seen.add(stem); next.push(stem); out.push(stem);
            // consonant softening at the end of a stem before a vowel suffix: kitab-ı -> kitap
            const soft = { b: 'p', c: 'ç', d: 't', ğ: 'k' }[stem[stem.length - 1]];
            if (soft) add(stem.slice(0, -1) + soft);
          }
        }
        frontier = next.slice(0, 40);
      }
      // verbs: -mak / -mek forms of a stem
      for (const stem of out.slice(0, 12)) { add(stem + 'mak'); add(stem + 'mek'); }
      // the harmony-aware rules (js/turkish-lemma.js): endings that fit, softened consonants, dropped vowels
      if (typeof VexTrLemma !== 'undefined') for (const c of VexTrLemma.candidates(w)) add(c);
      return out;
    }
    return out;
  },

  // ---- lists -----------------------------------------------------------------------------------------------------------
  // One line of comma, semicolon or tab separated text; a field may be in double quotes (and then hold commas).
  _splitLine(line) {
    const cols = [];
    let cur = '', quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else quoted = false; } else cur += ch; }
      else if (ch === '"' && !cur.trim()) { quoted = true; cur = ''; }
      else if (ch === ',' || ch === ';' || ch === '\t') { cols.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    cols.push(cur.trim());
    return cols;
  },
  // "word,gloss[,lemma]" per line (comma, semicolon or tab). A first line "word,gloss" is skipped. -> [[word, gloss, lemma]]
  parseList(text) {
    const lines = String(text == null ? '' : text).replace(/\r/g, '').split('\n');
    const out = [];
    for (const line of lines) {
      if (!line.trim() || line.trim().startsWith('#')) continue;
      const cols = this._splitLine(line);
      if (cols.length < 2 || !cols[0] || !cols[1]) throw new Error('Line "' + line.slice(0, 60) + '" needs a word and a gloss, like  run,koşmak');
      if (cols[0].length > 60 || cols[1].length > 200) throw new Error('Line "' + line.slice(0, 40) + '..." is too long (a word up to 60 characters, a gloss up to 200)');
      if (/^word$/i.test(cols[0]) && out.length === 0 && /^(gloss|meaning|translation)$/i.test(cols[1])) continue;
      out.push([cols[0], cols[1], (cols[2] || '').slice(0, 60)]);
      if (out.length > this.MAX_LIST) throw new Error('That list has more than ' + this.MAX_LIST + ' entries');
    }
    if (!out.length) throw new Error('That list has no entries');
    return out;
  },
  userLists() {
    const v = this._json(this.LISTS_KEY, {}, 'word lists');
    const o = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    return { en: Array.isArray(o.en) ? o.en : [], tr: Array.isArray(o.tr) ? o.tr : [] };
  },
  importList(text, lang) {
    this._need();
    if (!this.LANGS.includes(lang)) throw new Error('Say which language the headwords are in: English or Turkish');
    const entries = this.parseList(text);
    const lists = this.userLists();
    const by = new Map(lists[lang].map(e => [this.lower(e[0], lang), e]));
    for (const e of entries) by.set(this.lower(e[0], lang), e);
    if (by.size > this.MAX_LIST) throw new Error('That would make ' + by.size + ' entries; at most ' + this.MAX_LIST + ' are kept');
    lists[lang] = [...by.values()];
    this._put(this.LISTS_KEY, lists, 'word lists');
    this._index = null;
    return { added: entries.length, total: lists[lang].length };
  },
  clearLists(lang) {
    const lists = this.userLists();
    for (const l of lang ? [lang] : this.LANGS) lists[l] = [];
    this._put(this.LISTS_KEY, lists, 'word lists');
    this._index = null;
  },
  // word -> { gloss, lemma, source } per language; yours first, then the starter list.
  _glossIndex() {
    if (this._index) return this._index;
    const idx = { en: new Map(), tr: new Map() };
    const data = typeof VexReadingAidsData !== 'undefined' ? VexReadingAidsData : null;
    if (data) for (const lang of this.LANGS) for (const pair of data.GLOSS[lang]) { const i = pair.indexOf('='); idx[lang].set(this.lower(pair.slice(0, i), lang), { gloss: pair.slice(i + 1), lemma: pair.slice(0, i), source: 'starter list' }); }
    const lists = this.userLists();
    for (const lang of this.LANGS) for (const [w, g, l] of lists[lang]) idx[lang].set(this.lower(w, lang), { gloss: g, lemma: l || w, source: 'your list' });
    this._index = idx;
    return idx;
  },
  // -> { lemma, gloss, source, exact } or null. `exact` is false when the word was reduced to another form.
  lookup(word, lang) {
    if (!this.LANGS.includes(lang)) return null;
    const idx = this._glossIndex()[lang];
    const cands = this.candidates(word, lang);
    for (let i = 0; i < cands.length; i++) {
      const hit = idx.get(cands[i]);
      if (hit) return { lemma: hit.lemma, gloss: hit.gloss, source: hit.source, exact: i === 0 };
    }
    return null;
  },

  // ---- known words -----------------------------------------------------------------------------------------------------
  knownSet(lang) {
    const v = this._json(this.KNOWN_KEY, {}, 'known words');
    const list = v && Array.isArray(v[lang]) ? v[lang] : [];
    return new Set(list);
  },
  _saveKnown(lang, set) {
    if (set.size > this.MAX_KNOWN) throw new Error('That is more than ' + this.MAX_KNOWN + ' known words');
    const v = this._json(this.KNOWN_KEY, {}, 'known words');
    const o = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    o[lang] = [...set];
    this._put(this.KNOWN_KEY, o, 'known words');
  },
  isKnown(word, lang, set = this.knownSet(lang)) { return this.candidates(word, lang).some(c => set.has(c)); },
  markKnown(word, lang) {
    this._need();
    if (!this.LANGS.includes(lang)) throw new Error('Reading aids know English and Turkish');
    const w = this.lower(word, lang);
    if (!/^\p{L}[\p{L}'-]{0,58}$/u.test(w)) throw new Error('Select one word');
    const set = this.knownSet(lang);
    const hit = this.lookup(w, lang);
    set.add(hit ? this.lower(hit.lemma, lang) : w);
    set.add(w);
    this._saveKnown(lang, set);
    return w;
  },
  unmarkKnown(word, lang) {
    const set = this.knownSet(lang);
    let removed = false;
    for (const c of this.candidates(word, lang)) removed = set.delete(c) || removed;
    this._saveKnown(lang, set);
    return removed;
  },
  // level: 'starter' (the few hundred of reading-aids-data.js) or a number of the commonest words of the large list
  // (English only, see LARGE_LEVELS).
  LARGE_LEVELS: [1000, 3000],
  adoptCommon(lang, level = 'starter') {
    this._need();
    if (!this.LANGS.includes(lang) || typeof VexReadingAidsData === 'undefined') throw new Error('The starter list is not available');
    let words = VexReadingAidsData.COMMON[lang];
    if (level !== 'starter') {
      if (lang !== 'en' || !this.LARGE_LEVELS.includes(level)) throw new Error('There is a list of the commonest ' + this.LARGE_LEVELS.join(' or ') + ' English words, and no larger list for ' + lang);
      if (typeof VexReadingAidsLists === 'undefined') throw new Error('The large English list is not loaded');
      words = VexReadingAidsLists.EN.slice(0, level);
    }
    const set = this.knownSet(lang);
    for (const w of words) set.add(this.lower(w, lang));
    this._saveKnown(lang, set);
    return set.size;
  },
  knownCount(lang) { return this.knownSet(lang).size; },
  exportKnown(lang) { return [...this.knownSet(lang)].sort((a, b) => a.localeCompare(b, lang)).join('\n'); },
  clearKnown(lang) { const set = new Set(); this._saveKnown(lang, set); },

  // 'en' | 'tr' | ''. The page's own lang wins when it names one of ours; else Turkish letters decide.
  detectLang(htmlLang, text) {
    const l = String(htmlLang || '').toLowerCase().slice(0, 2);
    if (l === 'en' || l === 'tr') return l;
    const t = String(text || '').slice(0, 4000).toLowerCase();
    const trLetters = (t.match(/[çğıöşü]/g) || []).length;
    const letters = (t.match(/\p{L}/gu) || []).length;
    if (letters < 40) return '';
    if (trLetters / letters > 0.03) return 'tr';
    const en = (t.match(/\b(the|and|of|to|is|in|that|it|was|for)\b/g) || []).length;
    return en >= 6 ? 'en' : '';
  },

  // ---- the page ----------------------------------------------------------------------------------------------------------
  // Runs INSIDE the page. Returns { lang, words: [..unique lowercase..] }. Reads text only; changes nothing.
  collectScript(maxWords) {
    return '(' + function (max) {
      var out = { lang: document.documentElement.lang || '', words: [], sample: '' };
      var seen = {};
      var walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT, { acceptNode: function (n) {
        var p = n.parentElement;
        return p && !/^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA|INPUT|SELECT|OPTION)$/.test(p.tagName) && !p.isContentEditable ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      } });
      var nodes = 0;
      while (walker.nextNode() && nodes++ < 6000) {
        var t = walker.currentNode.nodeValue;
        if (out.sample.length < 3000) out.sample += ' ' + t.slice(0, 200);
        var m = t.match(/[\p{L}][\p{L}'’-]*/gu);
        if (!m) continue;
        for (var i = 0; i < m.length; i++) {
          var w = m[i].replace(/’/g, "'");
          if (w.length < 2 || w.length > 40) continue;
          var k = w.toLocaleLowerCase();
          if (!seen[k]) { seen[k] = 1; out.words.push(k); if (out.words.length >= max) return out; }
        }
      }
      return out;
    }.toString() + ')(' + Number(maxWords) + ')';
  },
  // Runs INSIDE the page. `known`: words to grey; `gloss`: { word: 'text' } for the hover; `opts`: { grey, hover, markNew }.
  markScript(known, gloss, opts) {
    return '(' + function (known, gloss, opts) {
      if (window.__vexRaClear) window.__vexRaClear();
      if (!window.Highlight || !window.CSS || !CSS.highlights) return { error: 'This page cannot be marked: the highlight feature is missing' };
      var knownSet = {}; for (var i = 0; i < known.length; i++) knownSet[known[i]] = 1;
      var hKnown = new window.Highlight(), hNew = new window.Highlight();
      var style = document.createElement('style');
      style.setAttribute('data-vex-ra', '1');
      style.textContent = '::highlight(vex-ra-known){color:#9aa0a6;}::highlight(vex-ra-new){text-decoration:underline dotted;text-decoration-color:#d4a574;}';
      (document.head || document.documentElement).appendChild(style);
      var walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT, { acceptNode: function (n) {
        var p = n.parentElement;
        return p && !/^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA|INPUT|SELECT|OPTION)$/.test(p.tagName) && !p.isContentEditable ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      } });
      var nodes = 0, nKnown = 0, nNew = 0, re = /[\p{L}][\p{L}'’-]*/gu;
      while (walker.nextNode() && nodes++ < 6000) {
        var node = walker.currentNode, text = node.nodeValue, m;
        re.lastIndex = 0;
        while ((m = re.exec(text)) !== null) {
          var w = m[0].replace(/’/g, "'").toLocaleLowerCase();
          if (opts.grey && knownSet[w]) { var r = document.createRange(); r.setStart(node, m.index); r.setEnd(node, m.index + m[0].length); hKnown.add(r); nKnown++; }
          else if (opts.markNew && gloss[w]) { var r2 = document.createRange(); r2.setStart(node, m.index); r2.setEnd(node, m.index + m[0].length); hNew.add(r2); nNew++; }
        }
      }
      CSS.highlights.set('vex-ra-known', hKnown);
      CSS.highlights.set('vex-ra-new', hNew);
      var tip = null, last = 0;
      function wordAt(x, y) {
        var pos = null;
        if (document.caretPositionFromPoint) { var c = document.caretPositionFromPoint(x, y); if (c) pos = { node: c.offsetNode, offset: c.offset }; }
        else if (document.caretRangeFromPoint) { var rr = document.caretRangeFromPoint(x, y); if (rr) pos = { node: rr.startContainer, offset: rr.startOffset }; }
        if (!pos || !pos.node || pos.node.nodeType !== 3) return '';
        var s = pos.node.nodeValue, a = pos.offset, b = pos.offset, isL = /[\p{L}'’-]/u;
        while (a > 0 && isL.test(s[a - 1])) a--;
        while (b < s.length && isL.test(s[b])) b++;
        return s.slice(a, b).replace(/’/g, "'").toLocaleLowerCase();
      }
      function onMove(e) {
        var now = Date.now(); if (now - last < 80) return; last = now;
        var w = wordAt(e.clientX, e.clientY);
        var g = w && gloss[w];
        if (!g) { if (tip) tip.style.display = 'none'; return; }
        if (!tip) { tip = document.createElement('div'); tip.setAttribute('data-vex-ra', '1'); tip.style.cssText = 'position:fixed;z-index:2147483647;max-width:280px;padding:5px 9px;border-radius:7px;background:#1d1f24;color:#f2f2f2;font:13px/1.35 system-ui,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.35);pointer-events:none'; document.documentElement.appendChild(tip); }
        tip.textContent = g;
        tip.style.display = 'block';
        tip.style.left = Math.min(window.innerWidth - 290, e.clientX + 12) + 'px';
        tip.style.top = Math.min(window.innerHeight - 50, e.clientY + 18) + 'px';
      }
      function hide() { if (tip) tip.style.display = 'none'; }
      if (opts.hover) { document.addEventListener('mousemove', onMove, true); document.addEventListener('scroll', hide, true); document.addEventListener('mouseleave', hide, true); }
      window.__vexRaClear = function () {
        document.removeEventListener('mousemove', onMove, true); document.removeEventListener('scroll', hide, true); document.removeEventListener('mouseleave', hide, true);
        CSS.highlights.delete('vex-ra-known'); CSS.highlights.delete('vex-ra-new');
        var els = document.querySelectorAll('[data-vex-ra]'); for (var j = 0; j < els.length; j++) els[j].remove();
        window.__vexRaClear = null;
      };
      return { known: nKnown, marked: nNew, glossed: Object.keys(gloss).length };
    }.toString() + ')(' + JSON.stringify(known) + ',' + JSON.stringify(gloss) + ',' + JSON.stringify(opts) + ')';
  },

  _active() {
    if (typeof WebviewManager === 'undefined' || typeof TabManager === 'undefined') throw new Error('Tabs are not loaded');
    const wv = WebviewManager.getActiveWebview?.();
    const tab = TabManager.getActiveTab?.();
    if (!wv || !tab) throw new Error('There is no page in front');
    if (window.VexTabPolicy && !window.VexTabPolicy.canRestore(tab)) throw new Error('Reading aids are not used in private, Tor or routed tabs');
    if (!/^https?:\/\//i.test(String(tab.url || ''))) throw new Error('Reading aids work on web pages');
    return { wv, tab };
  },
  // Pure: from the page's words, what to grey and what to explain. -> { known: [..], gloss: { word: text }, lang }
  plan(words, lang, { known, prefs }) {
    const p = prefs || { grey: true, hover: true, markNew: false };
    const knownOut = [];
    const gloss = {};
    let n = 0;
    for (const w of words) {
      if (p.grey && this.isKnown(w, lang, known)) knownOut.push(w);
      if (p.hover || p.markNew) {
        const hit = this.lookup(w, lang);
        if (hit && n < this.MAX_GLOSS_ON_PAGE) { gloss[w] = (hit.exact ? '' : hit.lemma + ': ') + hit.gloss; n++; }
      }
    }
    return { known: knownOut, gloss, lang };
  },

  async markUpPage() {
    this._need();
    const { wv } = this._active();
    const got = await window.vexGuestEval(wv, this.collectScript(this.MAX_PAGE_WORDS), false, 6000);
    if (!got || !Array.isArray(got.words)) throw new Error('The page did not give its text');
    const lang = this.detectLang(got.lang, got.sample);
    if (!lang) throw new Error('Reading aids know English and Turkish pages, and could not tell which language this one is in');
    const plan = this.plan(got.words, lang, { known: this.knownSet(lang), prefs: this.prefs() });
    const res = await window.vexGuestEval(wv, this.markScript(plan.known, plan.gloss, this.prefs()), false, 6000);
    if (res && res.error) throw new Error(res.error);
    if (typeof VexUsage !== 'undefined') VexUsage.touch(this.FEATURE);
    return { lang, ...res, words: got.words.length };
  },
  async clearPage() {
    const { wv } = this._active();
    await window.vexGuestEval(wv, 'window.__vexRaClear && window.__vexRaClear()', false, 3000);
  },

  async _selection() {
    this._need();
    if (typeof VexStudyEntry === 'undefined') throw new Error('Study entry points are not loaded');
    const { tab, wv } = this._active();
    const got = await window.vexGuestEval(wv, VexStudyEntry._SELECTION_CODE, false, 4000);
    if (!got || typeof got.word !== 'string' || !got.word) throw new Error('Select a word on the page first');
    const lang = this.detectLang('', got.context) || this.detectLang(document.documentElement.lang, got.context) || (/[çğıöşü]/i.test(got.word) ? 'tr' : 'en');
    return { tab, got, lang };
  },
  // The selected word -> the shared vocabulary (js/study-entry.js), with its dictionary form and gloss when the lists have it.
  async saveSelectedWord() {
    const { tab, got, lang } = await this._selection();
    const sentence = VexStudyEntry.sentenceAround(got.context, got.word);
    const hit = this.lookup(got.word, lang);
    const r = VexStudyEntry.addWord({ word: got.word, sentence, url: tab.url, title: tab.title, lang, lemma: hit ? hit.lemma : '', gloss: hit ? hit.gloss : '' });
    window.showToast?.(r.added ? 'Saved "' + r.entry.word + '"' + (hit ? ' (' + hit.gloss + ')' : ' (no gloss in your lists)') : 'You already saved that word from this sentence', r.added ? 'success' : 'info');
    if (typeof VexUsage !== 'undefined') VexUsage.touch(this.FEATURE);
    return r;
  },
  async markSelectedKnown() {
    const { got, lang } = await this._selection();
    const w = this.markKnown(got.word, lang);
    window.showToast?.('"' + w + '" is marked as known. Mark up the page again to grey it.', 'success');
    return w;
  },

  // ---- settings --------------------------------------------------------------------------------------------------------------
  pickFile() {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = '.csv,.tsv,.txt,text/plain,text/csv';
      input.addEventListener('change', () => {
        const f = input.files && input.files[0];
        if (!f) { resolve(null); return; }
        if (f.size > 1024 * 1024) { reject(new Error('That list is larger than 1 MB')); return; }
        f.text().then(resolve, reject);
      });
      input.click();
    });
  },
  group(el) {
    const G = VexSettingsGroups;
    const fail = (e) => window.showToast?.((e && e.message) || String(e), 'error');
    el.appendChild(G.note('For reading a page in English or Turkish while you learn it. Hover a word for its dictionary form and a short gloss, grey out the words you already know so the new ones stand out, and save a word with its sentence to the vocabulary Study entry points export to FlashMind. All of it runs on this computer from local word lists; nothing is looked up online and no page text leaves the window. Forms are found by rule, so a hover can be approximate.'));
    const on = document.createElement('label'); on.className = 'vexsr-rule';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = this.enabled();
    cb.addEventListener('change', () => { try { this.setEnabled(cb.checked); } catch (e) { cb.checked = !cb.checked; fail(e); } });
    on.append(cb, document.createTextNode(' Reading aids'));
    el.appendChild(on);
    let p = { grey: true, hover: true, markNew: false };
    try { p = this.prefs(); } catch (e) { fail(e); }
    for (const [key, label] of [['grey', 'Grey out the words I marked as known'], ['hover', 'Show the dictionary form and gloss when I point at a word'], ['markNew', 'Underline the words that have a gloss and are not known yet']]) {
      const row = document.createElement('label'); row.className = 'vexsr-rule';
      const c = document.createElement('input'); c.type = 'checkbox'; c.checked = p[key];
      c.addEventListener('change', () => { try { this.setPrefs({ [key]: c.checked }); } catch (e) { c.checked = !c.checked; fail(e); } });
      row.append(c, document.createTextNode(' ' + label));
      el.appendChild(row);
    }
    el.appendChild(G.button('Mark up the page in front', () => { this.markUpPage().then(r => window.showToast?.('Marked up (' + r.lang + '): ' + r.known + ' known words greyed, ' + r.glossed + ' with a gloss')).catch(fail); }, { primary: true }));
    el.appendChild(G.button('Clear the marks', () => { this.clearPage().catch(fail); }));
    for (const lang of this.LANGS) {
      const name = lang === 'en' ? 'English' : 'Turkish';
      let n = 0; try { n = this.knownCount(lang); } catch (e) { fail(e); }
      el.appendChild(G.note(name + ': ' + n + ' known word' + (n === 1 ? '' : 's')));
      el.appendChild(G.button('I know the common ' + name + ' words', () => { try { const total = this.adoptCommon(lang); window.showToast?.(total + ' ' + name + ' words are marked as known', 'success'); } catch (e) { fail(e); } }));
      if (lang === 'en') for (const level of this.LARGE_LEVELS) {
        el.appendChild(G.button('I know the ' + level.toLocaleString('en') + ' commonest English words', () => { try { const total = this.adoptCommon(lang, level); window.showToast?.(total + ' English words are marked as known', 'success'); } catch (e) { fail(e); } }));
      }
      el.appendChild(G.button('Import a ' + name + ' word list...', async () => {
        try { const t = await this.pickFile(); if (t == null) return; const r = this.importList(t, lang); window.showToast?.(r.added + ' entries added (' + r.total + ' in your ' + name + ' list)', 'success'); } catch (e) { fail(e); }
      }));
      el.appendChild(G.button('Copy my known ' + name + ' words', async () => { try { await navigator.clipboard.writeText(this.exportKnown(lang)); window.showToast?.('Copied', 'success'); } catch (e) { fail(e); } }));
      el.appendChild(G.button('Forget my known ' + name + ' words', async () => {
        try { if (await window.vexConfirm({ title: 'Forget the known ' + name + ' words?', message: 'The words you marked as known are cleared. Your saved vocabulary stays.', okLabel: 'Forget them', danger: true })) this.clearKnown(lang); } catch (e) { fail(e); }
      }, { danger: true }));
    }
  },
};

if (typeof window !== 'undefined') {
  window.VexReadingAids = VexReadingAids;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'reading-aids', title: 'Reading aids', keywords: 'reading aids learner vocabulary gloss lemma known words grey language learning english turkish wordlist hover dictionary', before: 'about', build: (el) => VexReadingAids.group(el) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    const run = (fn) => () => { Promise.resolve().then(fn).catch(err => window.showToast?.((err && err.message) || String(err), 'error')); };
    VexExtras.registerCommand({ id: 'reading-aids', label: 'Reading aids: mark up this page', hint: 'Hover glosses and grey out the words you know', icon: 'book', action: run(() => VexReadingAids.markUpPage().then(r => window.showToast?.('Marked up (' + r.lang + ')'))) });
    VexExtras.registerCommand({ id: 'reading-aids-save-word', label: 'Reading aids: save the selected word', hint: 'With its sentence, page and gloss, for FlashMind', icon: 'plus', action: run(() => VexReadingAids.saveSelectedWord()) });
    VexExtras.registerCommand({ id: 'reading-aids-known', label: 'Reading aids: I know the selected word', hint: 'Greys it on the pages you mark up', icon: 'check', action: run(() => VexReadingAids.markSelectedKnown()) });
    VexExtras.registerCommand({ id: 'reading-aids-clear', label: 'Reading aids: clear the marks', hint: 'Takes the greying and hover off the page', icon: 'trash', action: run(() => VexReadingAids.clearPage()) });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexReadingAids };
