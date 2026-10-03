// === Vex page extras: Read Aloud (TTS) + cookie-banner auto-dismiss ===

// ---- Read Aloud — speaks the article (or the selection) of a tab ----
//
// It used to hand the voice one utterance of the first 12,000 characters of
// the page's text: menus included, the rest of a long article dropped, no way
// to pause, skip or change speed, nothing to show where it was, and it kept
// talking after the tab was closed (found 2026-10-03). Now the page is split
// into sentences in the page itself, each sentence is its own utterance (so
// the ~15 s cut-off some Chromium voices have never bites, and nothing is
// dropped), the sentence being read is highlighted with the CSS Custom
// Highlight API (no change to the page's markup) and kept in view, and the
// reading stops when its tab closes or goes somewhere else. It is spoken by
// this window, not the page, so it carries on while you are in another tab.

// Runs INSIDE the page (stringified). `lib` is vexReaderPageLib() from
// reading-mode.js, for finding the article; mode is 'auto' (the selection if
// there is one, else the article), 'selection' or 'article'.
function vexTtsPage(lib, mode) {
  const W = window;
  if (W.__vexTTS && W.__vexTTS.clear) { try { W.__vexTTS.clear(); } catch { /* a page that broke it */ } }
  const L = lib || { findRoot: (d) => d.querySelector('article, [role="main"], main') || d.body, skip: () => false };
  const SPOKEN = 'h1,h2,h3,h4,h5,h6,p,li,blockquote,dd,dt,figcaption,caption,summary';
  const MAX = 220;

  // The highlight colour, as a constructed sheet: a page's CSP that refuses
  // inline <style> does not apply to it.
  try {
    if (!W.__vexTTSSheet && typeof CSSStyleSheet === 'function' && 'adoptedStyleSheets' in document) {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync('::highlight(vex-tts){background-color:var(--vr-hl,rgba(255,200,40,.5));color:inherit}');
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
      W.__vexTTSSheet = sheet;
    }
  } catch { /* no highlight colour; reading still works */ }

  const skipCache = new Map();
  const skipped = (el, stop) => {
    for (let p = el; p && p !== stop; p = p.parentElement) {
      if (skipCache.has(p)) { if (skipCache.get(p)) return true; continue; }
      const t = String(p.tagName || '').toUpperCase();
      const s = t === 'SCRIPT' || t === 'STYLE' || t === 'NOSCRIPT' || t === 'PRE' || t === 'SUP' || (p.classList && p.classList.contains('vr-meta')) || L.skip(p);
      skipCache.set(p, s);
      if (s) return true;
    }
    return false;
  };

  const units = [];
  // One unit per block; each text node belongs to the nearest block above it,
  // so a list item's own words and its nested list are not read twice.
  function addUnit(el, stop, range) {
    const nodes = [];
    let text = '';
    const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = tw.nextNode())) {
      const owner = n.parentElement && n.parentElement.closest(SPOKEN);
      if (owner && owner !== el && el.contains(owner) && !range) continue;
      if (n.parentElement && skipped(n.parentElement, stop)) continue;
      if (range && !range.intersectsNode(n)) continue;
      let from = 0, to = n.data.length;
      if (range) { if (n === range.startContainer) from = range.startOffset; if (n === range.endContainer) to = range.endOffset; }
      if (to <= from) continue;
      nodes.push({ n, base: text.length, from, len: to - from });
      text += n.data.slice(from, to);
    }
    if (text.trim()) units.push({ el, nodes, text });
  }

  let used = 'article';
  const sel = W.getSelection && W.getSelection();
  if (mode !== 'article' && sel && !sel.isCollapsed && String(sel).trim().length > 1) {
    used = 'selection';
    const range = sel.getRangeAt(0);
    const anc = range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
    const blocks = [...anc.querySelectorAll(SPOKEN)].filter(b => range.intersectsNode(b) && !b.querySelector(SPOKEN));
    if (blocks.length) for (const b of blocks) addUnit(b, document.body, range);
    else addUnit((anc.closest && anc.closest(SPOKEN)) || anc, document.body, range);
  } else if (mode !== 'selection') {
    const reader = document.querySelector('meta[name="vex-reading-source"]') && document.querySelector('main article');
    const root = reader || L.findRoot(document) || document.body;
    for (const b of root.querySelectorAll(SPOKEN)) {
      if (units.length >= 4000) break;
      if (skipped(b, root)) continue;
      addUnit(b, root, null);
    }
    if (!units.length) addUnit(root, root.parentElement, null);
  }

  // Sentences, then long sentences cut at a comma or a space so no utterance
  // runs past what every voice will say in one go.
  let seg = null;
  try { seg = new Intl.Segmenter(document.documentElement.lang || undefined, { granularity: 'sentence' }); }
  catch { try { seg = new Intl.Segmenter(undefined, { granularity: 'sentence' }); } catch { seg = null; } }
  const clean = (s) => s.replace(/\[(?:\d+|edit|citation needed)\]/gi, ' ').replace(/\s+/g, ' ').trim();
  const segs = [];
  units.forEach((u, ui) => {
    const parts = seg ? [...seg.segment(u.text)].map(s => [s.index, s.index + s.segment.length]) : [[0, u.text.length]];
    for (const [a0, b0] of parts) {
      let a = a0;
      while (a < b0) {
        while (a < b0 && /\s/.test(u.text[a])) a++;
        if (a >= b0) break;
        let b = b0;
        if (b - a > MAX) {
          const chunk = u.text.slice(a, a + MAX);
          const cut = Math.max(chunk.lastIndexOf(', '), chunk.lastIndexOf('; '), chunk.lastIndexOf(': '));
          const sp = chunk.lastIndexOf(' ');
          b = a + (cut > MAX * 0.4 ? cut + 1 : (sp > MAX * 0.4 ? sp : MAX));
        }
        const text = clean(u.text.slice(a, b));
        if (text && /[\p{L}\p{N}]/u.test(text)) segs.push({ u: ui, a, b, text });
        a = b;
      }
    }
  });

  function at(u, p, end) {
    for (let j = 0; j < u.nodes.length; j++) {
      const nd = u.nodes[j];
      if (end ? (p > nd.base && p <= nd.base + nd.len) : (p >= nd.base && p < nd.base + nd.len)) return [nd.n, nd.from + (p - nd.base)];
    }
    const last = u.nodes[u.nodes.length - 1];
    return [last.n, last.from + last.len];
  }

  W.__vexTTS = {
    segs,
    mark(i) {
      const s = segs[i];
      if (!s) return false;
      const u = units[s.u];
      try {
        const r = document.createRange();
        r.setStart(...at(u, s.a, false));
        r.setEnd(...at(u, s.b, true));
        if (W.CSS && CSS.highlights && typeof Highlight === 'function') CSS.highlights.set('vex-tts', new Highlight(r));
        const rect = r.getBoundingClientRect();
        const vh = W.innerHeight || 0;
        if ((rect.width || rect.height) && (rect.top < 70 || rect.bottom > vh - 50)) {
          const se = document.scrollingElement;
          if (se && se.scrollHeight > vh + 4) W.scrollBy({ top: rect.top - vh * 0.33, behavior: 'smooth' });
          else u.el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
        return true;
      } catch { return false; }       // the page rebuilt that part of itself
    },
    clear() { try { if (W.CSS && CSS.highlights) CSS.highlights.delete('vex-tts'); } catch { /* nothing to clear */ } },
  };
  return {
    mode: used,
    units: units.length,
    // Which units are headings, so the bar counts paragraphs, not titles.
    heads: units.map(u => /^H[1-6]$/i.test(u.el.tagName || '')),
    segs: segs.map(s => ({ u: s.u, text: s.text })),
    title: String(document.title || '').slice(0, 200),
    lang: (document.documentElement.getAttribute('lang') || '').slice(0, 20),
  };
}

// ---- What language is this text in? ----
// A page that declares no <html lang> was read with the system's default
// voice, whatever it was: on a PC set up in Turkish, English pages came out
// in a Turkish voice (found 2026-10-03). Chromium's own detector is not
// reachable here (no LanguageDetector, Translator or chrome.i18n in a Vex
// window, Chromium 148), so this is a small local guess: the writing system
// first, then, for Latin script, counts of each language's commonest words.
// It answers '' when it cannot tell, and the caller then keeps the default.
const VexTextLang = {
  // The commonest short words of each language, chosen to tell them apart.
  // Words several languages share ("de", "la", "en") count for all of them;
  // the words they do not share decide.
  WORDS: {
    en: 'the and of to is in that it was for with are this on as be have not you by from they which at or but has were will would can their an its been there what about more when who into than them these also only our after could should because how',
    tr: 've bir bu da de için ile çok ama olarak daha gibi ne en o var yok değil sonra kadar her şey ben sen biz onun olan oldu şu mi mı ya ki veya ise göre nasıl neden çünkü bunu diye tüm ilk yeni büyük önce şimdi zaman bile artık',
    de: 'der die und das ist nicht ein eine zu den mit sich des auf für im dem von auch es an werden wird sind wie oder aber nach bei noch wir ich sie er nur kann hat war über dass einen einem durch zum zur sehr schon wenn',
    fr: 'le la les et des est une un du que qui dans pour pas sur au avec ce il elle sont ne se plus par mais nous vous ont été cette aux son sa leur comme ou très je être fait aussi tout bien',
    es: 'el la los las y que de en es un una por con para no se del al lo como más pero sus su está son este esta ya muy también fue ha hay cuando sobre entre todo porque yo ser puede desde hasta',
    it: 'il la di che e è un una per non sono del della con si le gli da nel alla ma anche come più questo questa ha ho dei delle lo ci nella molto perché essere stato quando io sul anni dopo',
    pt: 'o a os as e de que do da em um uma para com não é se no na por mais dos das ao mas foi como ele ela são está também muito já isso seu sua quando eu você pelo pela foram tem',
    nl: 'de het een en van is dat op te in zijn niet met voor die er aan ook als maar om bij door wordt naar was worden dan nog wat kan hij ze we ik hebben heeft deze uit zo wel geen',
  },
  // Letters only one of those languages uses: each word holding one counts
  // twice more for it.
  MARKS: { tr: /[ğış]/, de: /ß/, es: /[ñ¿¡]/, pt: /[ãõ]/, fr: /œ|^(?:qu|j)'/, nl: /ij/ },
  _sets: null,

  // The language of `text` as a BCP-47 primary tag ('en', 'tr', 'ru', 'zh'),
  // or '' when it cannot tell.
  detect(text) {
    const t = String(text || '').slice(0, 6000);
    if (!t.trim()) return '';
    const count = (re) => (t.match(re) || []).length;
    const letters = count(/\p{L}/gu);
    if (letters < 12) return '';
    const kana = count(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu);
    const scripts = [
      ['ja', kana],
      ['ko', count(/\p{Script=Hangul}/gu)],
      ['zh', count(/\p{Script=Han}/gu)],
      ['ru', count(/\p{Script=Cyrillic}/gu)],
      ['ar', count(/\p{Script=Arabic}/gu)],
      ['he', count(/\p{Script=Hebrew}/gu)],
      ['el', count(/\p{Script=Greek}/gu)],
      ['th', count(/\p{Script=Thai}/gu)],
      ['hi', count(/\p{Script=Devanagari}/gu)],
      ['ka', count(/\p{Script=Georgian}/gu)],
      ['hy', count(/\p{Script=Armenian}/gu)],
      ['la', count(/\p{Script=Latin}/gu)],
    ];
    // Japanese mixes kana with kanji (Han): any real share of kana is Japanese.
    if (kana >= letters * 0.1) return 'ja';
    scripts.sort((a, b) => b[1] - a[1]);
    const [script, n] = scripts[0];
    if (n < letters * 0.5) return '';
    if (script === 'ru') {
      if (/[їєґ]/i.test(t) || count(/і/gi) > 2) return 'uk';
      return 'ru';
    }
    if (script === 'ar') {
      if (/[ٹڈڑںے]/.test(t)) return 'ur';
      if (/[پچژگک]/.test(t) && !/[ة]/.test(t)) return 'fa';
      return 'ar';
    }
    if (script !== 'la') return script;
    return this._latin(t);
  },

  _latin(t) {
    if (!this._sets) {
      this._sets = {};
      for (const [k, v] of Object.entries(this.WORDS)) this._sets[k] = new Set(v.split(' '));
    }
    // Turkish capital 'İ' lowercases to 'i' plus a combining dot, which would
    // split the word; it is just 'i'.
    const words = t.replace(/İ/g, 'i').toLowerCase().replace(/[’ʼ]/g, "'").match(/\p{L}+(?:'\p{L}+)?/gu) || [];
    if (words.length < 4) return '';
    const score = {};
    for (const k of Object.keys(this._sets)) score[k] = 0;
    for (const w of words.slice(0, 1500)) {
      for (const k in this._sets) {
        if (this._sets[k].has(w)) score[k]++;
        else if (w.includes("'")) { const head = w.split("'")[0]; if (this._sets[k].has(head)) score[k] += 0.5; }
        if (this.MARKS[k] && this.MARKS[k].test(w)) score[k] += 2;
      }
    }
    const ranked = Object.entries(score).sort((a, b) => b[1] - a[1]);
    const [best, top] = ranked[0];
    const second = ranked[1][1];
    // Too little to go on, or two languages neck and neck: no guess.
    if (top < 3 || top < words.length * 0.08 || top < second * 1.25) return '';
    return best;
  },
};

const ReadAloud = {
  KEY: 'vex.readAloud',
  RATES: [0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2],
  speaking: false,
  volume: 1,
  _s: null,        // the reading in progress
  _bar: null,

  settings() {
    let o = null;
    try { o = JSON.parse(localStorage.getItem(this.KEY) || 'null'); } catch { o = null; }
    o = (o && typeof o === 'object') ? o : {};
    const rate = Number(o.rate);
    const voices = (o.voices && typeof o.voices === 'object') ? o.voices : {};
    const cleanVoices = {};
    for (const k of Object.keys(voices).slice(0, 40)) if (/^[a-z]{2,3}$/.test(k) && typeof voices[k] === 'string') cleanVoices[k] = voices[k].slice(0, 200);
    return {
      rate: Number.isFinite(rate) ? Math.min(3, Math.max(0.5, rate)) : 1,
      voice: typeof o.voice === 'string' ? o.voice.slice(0, 200) : '',
      voices: cleanVoices,
    };
  },
  _save(patch) {
    const next = { ...this.settings(), ...patch };
    try { localStorage.setItem(this.KEY, JSON.stringify(next)); }
    catch (err) { window.showToast?.('Read aloud settings could not be saved: ' + (err && err.message), 'error'); }
    return next;
  },

  _prepareScript(mode) {
    const lib = (typeof window !== 'undefined' && typeof window.vexReaderPageLib === 'function') ? '(' + window.vexReaderPageLib.toString() + ')()' : 'null';
    return '(' + vexTtsPage.toString() + ')(' + lib + ',' + JSON.stringify(mode) + ')';
  },

  // The command and the reader's Listen button: a second press stops.
  async toggle(opts) {
    const o = opts || {};
    if (this._s && (!o.wv || o.wv === this._s.wv)) { this.stop(); return false; }
    return this.start(o);
  },

  async start(opts) {
    const o = opts || {};
    if (typeof speechSynthesis === 'undefined' || typeof SpeechSynthesisUtterance === 'undefined') {
      window.showToast?.('Text-to-speech is not available here', 'error');
      return false;
    }
    const wv = o.wv || (typeof WebviewManager !== 'undefined' ? WebviewManager.getActiveWebview() : null);
    if (!wv) { window.showToast?.('Open a page first'); return false; }
    const tabId = o.tabId || (wv.dataset && wv.dataset.tabId) || (typeof TabManager !== 'undefined' ? TabManager.activeTabId : null);
    // One voice at a time: the Read Later playlist talks through the same
    // speech engine.
    if (typeof QueuePodcast !== 'undefined' && QueuePodcast._bar && typeof QueuePodcast.stop === 'function') QueuePodcast.stop();
    this.stop(true);

    let info;
    try { info = await wv.executeJavaScript(this._prepareScript(o.selection ? 'selection' : (o.mode || 'auto'))); }
    catch (err) {
      window.showToast?.('Read aloud could not read this page: ' + ((err && err.message) || 'no answer'), 'error');
      return false;
    }
    if (!info || !Array.isArray(info.segs) || !info.segs.length) {
      window.showToast?.(o.selection ? 'Nothing to read in that selection' : 'Nothing readable on this page');
      return false;
    }
    let url = '';
    try { url = wv.getURL(); } catch { url = ''; }
    // The page's declared language, or a guess from its text when it has none.
    const lang = this._langTag(info.lang);
    const detected = lang ? '' : VexTextLang.detect(info.segs.slice(0, 150).map(x => x && x.text).join(' '));
    const s = { wv, tabId, url, segs: info.segs, units: info.units, heads: Array.isArray(info.heads) ? info.heads : [], mode: info.mode, title: info.title, lang, detected, picked: '', note: '', noted: false, idx: 0, token: 0, paused: false, fails: 0, watchdog: null, utterance: null, unwatch: null };
    this._s = s;
    this._watch(s);
    this._showBar();
    this._speak(0);
    return true;
  },

  // A language tag, lower-cased with '-' ('en-gb'), or '' for nothing usable
  // ('und', 'x-default', junk). Old and alternative codes map to the ones
  // voices use.
  ALIASES: { iw: 'he', in: 'id', ji: 'yi', no: 'nb', tl: 'fil' },
  _langTag(raw) {
    const t = String(raw || '').trim().replace(/_/g, '-').toLowerCase();
    if (!/^[a-z]{2,3}(-[a-z0-9]{1,8})*$/.test(t)) return '';
    const parts = t.split('-');
    if (['und', 'zxx', 'mul', 'mis'].includes(parts[0])) return '';
    if (this.ALIASES[parts[0]]) parts[0] = this.ALIASES[parts[0]];
    return parts.join('-');
  },
  _langName(tag) {
    try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(tag.split('-')[0]) || tag; } catch { return tag; }
  },

  // The voice for the reading in progress: the voice you picked for its
  // language; else the one you used last if it speaks that language; else an
  // installed voice for it, the exact locale (en-GB) before the same language
  // (en-US), the system default and local voices first. The language is the
  // page's own <html lang>, or, when it declares none, a guess from the text.
  // With no voice for it installed, `missing` names the language and the
  // reading goes on in your last voice or the system default.
  _pickVoice() {
    const s = this._s;
    let voices = [];
    try { voices = speechSynthesis.getVoices() || []; } catch { voices = []; }
    if (!voices.length) return { voice: null, missing: '' };
    const st = this.settings();
    const byName = (n) => (n ? voices.find(v => v.name === n) || null : null);
    // Picked in the bar during this reading: that is the voice, whatever the
    // page's language seems to be.
    const picked = s && byName(s.picked);
    if (picked) return { voice: picked, missing: '' };
    const tag = (s && (s.lang || s.detected)) || '';
    if (!tag) return { voice: byName(st.voice), missing: '' };
    const primary = tag.split('-')[0];
    const chosen = byName(st.voices[primary]);
    if (chosen) return { voice: chosen, missing: '' };
    const same = voices.filter(v => this._langTag(v.lang).split('-')[0] === primary);
    if (!same.length) return { voice: byName(st.voice), missing: tag };
    const last = byName(st.voice);
    if (last && same.includes(last)) return { voice: last, missing: '' };
    const exact = same.filter(v => this._langTag(v.lang) === tag);
    const pool = exact.length ? exact : same;
    return { voice: pool.find(v => v.default) || pool.find(v => v.localService) || pool[0], missing: '' };
  },
  _voice() { return this._pickVoice().voice; },

  // Said once per reading, in the bar: no installed voice speaks the page's
  // language, so what you hear is another language's voice.
  _noteMissing(s, tag, voice) {
    if (s.noted) return;
    s.noted = true;
    let using = voice;
    if (!using) { try { using = (speechSynthesis.getVoices() || []).find(v => v.default) || null; } catch { using = null; } }
    const lang = this._langName(tag);
    const who = using ? ' Reading with ' + this._voiceLabel(using) + '.' : '';
    s.note = (s.lang ? 'This page is in ' + lang : 'This page looks like ' + lang) + ', but no ' + lang + ' voice is installed.' + who;
    this._updateBar();
  },
  _voiceLabel(v) {
    return String(v.name || '').replace(/^Microsoft\s+/, '').replace(/\s+-\s+.*$/, '') + ' (' + v.lang + ')';
  },

  _speak(i) {
    const s = this._s;
    if (!s) return;
    if (i >= s.segs.length) { this._finish(); return; }
    s.idx = Math.max(0, i);
    s.paused = false;
    const token = ++s.token;
    const seg = s.segs[s.idx];
    const st = this.settings();
    const u = new SpeechSynthesisUtterance(seg.text);
    u.rate = st.rate;
    u.volume = this.volume;
    const pick = this._pickVoice();
    const v = pick.voice;
    if (v) { u.voice = v; u.lang = v.lang; } else if (s.lang || s.detected) u.lang = s.lang || s.detected;
    if (pick.missing) this._noteMissing(s, pick.missing, v);
    const live = () => this._s === s && s.token === token;
    u.onend = () => { if (!live()) return; clearTimeout(s.watchdog); s.fails = 0; this._speak(s.idx + 1); };
    u.onerror = (e) => {
      if (!live()) return;
      clearTimeout(s.watchdog);
      const why = e && e.error;
      if (why === 'interrupted' || why === 'canceled') return;
      s.fails++;
      console.warn('[ReadAloud] a sentence could not be spoken:', why);
      if (s.fails >= 3) {
        this.stop(true);
        window.showToast?.('Read aloud stopped: the voice failed (' + (why || 'unknown error') + ')', 'error');
        return;
      }
      this._speak(s.idx + 1);
    };
    // A voice that never reports the end (Chromium has had several) would
    // stall the reading for good; give each sentence a generous allowance.
    clearTimeout(s.watchdog);
    s.watchdog = setTimeout(() => {
      if (!live()) return;
      console.warn('[ReadAloud] the voice never finished a sentence; moving on');
      try { speechSynthesis.cancel(); } catch { /* nothing speaking */ }
      this._speak(s.idx + 1);
    }, 8000 + seg.text.length * 110 / st.rate);
    s.utterance = u;   // held, or Chromium can collect it before 'end' fires
    this.speaking = true;
    this._mark(s, s.idx);
    this._updateBar();
    speechSynthesis.speak(u);
  },

  _mark(s, i) {
    try { Promise.resolve(s.wv.executeJavaScript('window.__vexTTS&&window.__vexTTS.mark(' + Number(i) + ')')).catch(() => {}); }
    catch { /* the tab is gone; _watch stops the reading */ }
  },
  _clearMark(s) {
    try { Promise.resolve(s.wv.executeJavaScript('window.__vexTTS&&window.__vexTTS.clear()')).catch(() => {}); }
    catch { /* the tab is gone */ }
  },

  pause() {
    const s = this._s;
    if (!s || s.paused) return;
    s.paused = true;
    s.token++;
    clearTimeout(s.watchdog);
    // cancel, not speechSynthesis.pause(): pause leaves some voices silent for
    // good. The sentence starts again on resume.
    try { speechSynthesis.cancel(); } catch { /* nothing speaking */ }
    this._updateBar();
  },
  resume() { const s = this._s; if (s && s.paused) this._speak(s.idx); },
  playPause() { const s = this._s; if (!s) return; if (s.paused) this.resume(); else this.pause(); },

  _jump(i) {
    const s = this._s;
    if (!s) return;
    s.token++;
    clearTimeout(s.watchdog);
    try { speechSynthesis.cancel(); } catch { /* nothing speaking */ }
    this._speak(Math.min(Math.max(0, i), s.segs.length - 1));
  },
  // Next paragraph; at the last one, the end.
  nextParagraph() {
    const s = this._s;
    if (!s) return;
    const cur = s.segs[s.idx].u;
    let j = s.idx;
    while (j < s.segs.length && s.segs[j].u === cur) j++;
    if (j >= s.segs.length) { this._finish(); return; }
    this._jump(j);
  },
  // The start of this paragraph, or the one before if already at its start.
  previousParagraph() {
    const s = this._s;
    if (!s) return;
    const cur = s.segs[s.idx].u;
    let start = s.idx;
    while (start > 0 && s.segs[start - 1].u === cur) start--;
    if (s.idx > start) { this._jump(start); return; }
    if (start === 0) { this._jump(0); return; }
    const prev = s.segs[start - 1].u;
    let p = start - 1;
    while (p > 0 && s.segs[p - 1].u === prev) p--;
    this._jump(p);
  },

  setRate(rate) {
    const r = Number(rate);
    if (!Number.isFinite(r)) throw new Error('Speed must be a number');
    this._save({ rate: Math.min(3, Math.max(0.5, r)) });
    const s = this._s;
    if (s && !s.paused) this._jump(s.idx);
  },
  setVoice(name) {
    let voices = [];
    try { voices = speechSynthesis.getVoices() || []; } catch { voices = []; }
    const v = voices.find(x => x.name === name);
    if (!v) throw new Error('That voice is not installed');
    const st = this.settings();
    const lang = String(v.lang || '').toLowerCase().split('-')[0];
    this._save({ voice: v.name, voices: lang ? { ...st.voices, [lang]: v.name } : st.voices });
    const s = this._s;
    if (s) s.picked = v.name;
    if (s && !s.paused) this._jump(s.idx);
  },

  stop(silent) {
    const s = this._s;
    this._s = null;
    this.speaking = false;
    if (s) {
      s.token++;
      clearTimeout(s.watchdog);
      if (s.unwatch) s.unwatch();
      this._clearMark(s);
    }
    try { speechSynthesis.cancel(); } catch { /* nothing speaking */ }
    this._hideBar();
    if (!silent && s) window.showToast?.('Stopped reading');
  },
  _finish() { this.stop(true); window.showToast?.('Finished reading'); },

  // Stop when the tab closes or goes to another page. A tab put to sleep is
  // navigated to about:blank, so that is covered too.
  _watch(s) {
    const wv = s.wv;
    const end = (msg) => { if (this._s !== s) return; this.stop(true); if (msg) window.showToast?.(msg); };
    const path = (u) => String(u || '').replace(/[?#].*$/, '');
    const onNav = () => end('Reading stopped: the page changed');
    const onInPage = (e) => { if (e && e.isMainFrame !== false && path(e.url) !== path(s.url)) end('Reading stopped: the page changed'); };
    const onGone = () => end(null);
    const onClosed = (e) => { if (e && e.detail && String(e.detail.tabId) === String(s.tabId)) end(null); };
    if (typeof wv.addEventListener === 'function') {
      wv.addEventListener('did-navigate', onNav);
      wv.addEventListener('did-navigate-in-page', onInPage);
      wv.addEventListener('destroyed', onGone);
      wv.addEventListener('render-process-gone', onGone);
    }
    document.addEventListener('vex:tab-closed', onClosed);
    s.unwatch = () => {
      if (typeof wv.removeEventListener === 'function') {
        wv.removeEventListener('did-navigate', onNav);
        wv.removeEventListener('did-navigate-in-page', onInPage);
        wv.removeEventListener('destroyed', onGone);
        wv.removeEventListener('render-process-gone', onGone);
      }
      document.removeEventListener('vex:tab-closed', onClosed);
    };
  },

  // ---- the control bar ----
  _icon(name) { return (typeof VexIcons !== 'undefined' && VexIcons.svg) ? VexIcons.svg(name, { size: 15 }) : ''; },
  _showBar() {
    this._hideBar();
    const bar = document.createElement('div');
    bar.className = 'vex-tts-bar';
    bar.id = 'vex-tts-bar';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Read aloud');
    const rates = this.RATES.map(r => `<option value="${r}">${r}×</option>`).join('');
    bar.innerHTML = `<span class="vex-tts-icon" aria-hidden="true">${this._icon('volume')}</span>`
      + `<button type="button" class="vex-tts-where" data-act="tab" title="Go to the tab being read"><span class="vex-tts-title"></span><span class="vex-tts-pos"></span></button>`
      + `<span class="vex-tts-buttons">`
      + `<button type="button" class="vex-tts-btn vex-tts-prev" data-act="prev" aria-label="Previous paragraph" title="Previous paragraph">${this._icon('skip')}</button>`
      + `<button type="button" class="vex-tts-btn vex-tts-play" data-act="play" aria-label="Pause" title="Pause">${this._icon('pause')}</button>`
      + `<button type="button" class="vex-tts-btn" data-act="next" aria-label="Next paragraph" title="Next paragraph">${this._icon('skip')}</button>`
      + `<button type="button" class="vex-tts-btn" data-act="stop" aria-label="Stop reading" title="Stop reading">${this._icon('stop')}</button>`
      + `</span>`
      + `<label class="vex-tts-field">Speed <select data-act="rate" aria-label="Reading speed">${rates}</select></label>`
      + `<label class="vex-tts-field">Voice <select data-act="voice" aria-label="Voice"></select></label>`
      + `<span class="vex-tts-note" role="status" hidden></span>`;
    document.body.appendChild(bar);
    this._bar = bar;
    bar.addEventListener('click', (e) => {
      const b = e.target.closest && e.target.closest('button[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'play') this.playPause();
      else if (act === 'prev') this.previousParagraph();
      else if (act === 'next') this.nextParagraph();
      else if (act === 'stop') this.stop(true);
      else if (act === 'tab') { const s = this._s; if (s && typeof TabManager !== 'undefined' && TabManager.tabs.some(t => String(t.id) === String(s.tabId))) TabManager.switchTab(s.tabId); }
    });
    bar.querySelector('[data-act="rate"]').addEventListener('change', (e) => {
      try { this.setRate(e.target.value); } catch (err) { window.showToast?.(err.message, 'error'); }
    });
    bar.querySelector('[data-act="voice"]').addEventListener('change', (e) => {
      try { this.setVoice(e.target.value); } catch (err) { window.showToast?.(err.message, 'error'); }
    });
    this._fillVoices();
    // Chromium hands the voice list over late, the first time.
    this._onVoices = () => this._fillVoices();
    try { speechSynthesis.addEventListener('voiceschanged', this._onVoices); } catch { /* no event; the list stays as it is */ }
    this._updateBar();
  },
  _fillVoices() {
    const sel = this._bar && this._bar.querySelector('[data-act="voice"]');
    if (!sel) return;
    let voices = [];
    try { voices = speechSynthesis.getVoices() || []; } catch { voices = []; }
    const cur = this._voice();
    sel.textContent = '';
    if (!voices.length) { const o = document.createElement('option'); o.value = ''; o.textContent = 'System default'; sel.appendChild(o); sel.disabled = true; return; }
    sel.disabled = false;
    for (const v of voices) {
      const o = document.createElement('option');
      o.value = v.name;
      o.textContent = this._voiceLabel(v) + (v.localService ? '' : ' · online');
      // Nothing chosen: the system's default voice is the one speaking.
      if (cur ? v.name === cur.name : v.default) o.selected = true;
      sel.appendChild(o);
    }
  },
  _updateBar() {
    const bar = this._bar, s = this._s;
    if (!bar || !s) return;
    bar.querySelector('.vex-tts-title').textContent = s.mode === 'selection' ? 'Selection' : (s.title || 'This page');
    const unit = s.segs[s.idx] ? s.segs[s.idx].u : 0;
    const paras = s.units - s.heads.filter(Boolean).length;
    let at = 0;
    for (let k = 0; k <= unit && k < s.units; k++) if (!s.heads[k]) at++;
    bar.querySelector('.vex-tts-pos').textContent = s.mode === 'selection'
      ? `Sentence ${s.idx + 1} of ${s.segs.length}`
      : (s.heads[unit] ? 'Heading' : `Paragraph ${Math.max(1, at)} of ${Math.max(1, paras)}`);
    const note = bar.querySelector('.vex-tts-note');
    if (note.textContent !== s.note) note.textContent = s.note;
    note.hidden = !s.note;
    const play = bar.querySelector('[data-act="play"]');
    play.innerHTML = this._icon(s.paused ? 'play' : 'pause');
    play.setAttribute('aria-label', s.paused ? 'Resume' : 'Pause');
    play.title = s.paused ? 'Resume' : 'Pause';
    const rate = bar.querySelector('[data-act="rate"]');
    const want = this.settings().rate;
    if (![...rate.options].some(o => Number(o.value) === want)) { const o = document.createElement('option'); o.value = String(want); o.textContent = want + '×'; rate.appendChild(o); }
    rate.value = String([...rate.options].find(o => Number(o.value) === want).value);
  },
  _hideBar() {
    if (this._onVoices) { try { speechSynthesis.removeEventListener('voiceschanged', this._onVoices); } catch { /* gone */ } this._onVoices = null; }
    if (this._bar) { this._bar.remove(); this._bar = null; }
  },
};

// ---- Cookie-banner auto-dismiss ----
// Hides the major consent-platform containers and unlocks page scroll, and
// clicks the CMP's own "reject all" control where it can find one, so the
// choice is recorded and the banner stays gone next visit. It never accepts
// anything — only reject/decline/necessary-only controls, and only inside a
// known consent container. Toggle in Settings → Privacy; default ON.
const ConsentBlock = {
  KEY: 'vex.consentBlock',
  enabled() { try { return localStorage.getItem(this.KEY) !== 'off'; } catch { return true; } },

  // Turning the feature off has to take effect on the pages that are already
  // open: the hide rule is injected into every guest, so simply not injecting
  // it any more left every open tab with its banners still hidden until the
  // next reload. Returns false when the preference could not be stored.
  setEnabled(on) {
    let saved = true;
    try { localStorage.setItem(this.KEY, on ? 'on' : 'off'); } catch { saved = false; }
    this.reapplyAll();
    return saved;
  },

  // Re-run (or undo) the injection across every live guest.
  reapplyAll() {
    if (typeof WebviewManager === 'undefined' || !WebviewManager.webviews) return 0;
    let n = 0;
    WebviewManager.webviews.forEach((wv) => {
      try { if (this.enabled()) this.applyTo(wv); else this.removeFrom(wv); n++; } catch {}
    });
    return n;
  },

  // Undo the CSS half. Anything already auto-rejected stays rejected — that was
  // a real click on the site's own button and is not ours to take back.
  removeFrom(webview) {
    // Stop the watcher FIRST, then blank the rules — see the note in the
    // injected script about the clear waking the watcher that repaints it.
    const js = "(function(){try{"
      + "if(window.__vexConsentOff){window.__vexConsentOff();return;}"
      + "var e=document.getElementById('vex-consent-style');if(e)e.textContent='';"
      + "}catch(e){}})();";
    try { webview.executeJavaScript(js).catch(() => {}); } catch {}
  },

  SELECTORS: [
    '#onetrust-consent-sdk', '#onetrust-banner-sdk', '.onetrust-pc-dark-filter',
    '#CybotCookiebotDialog', '#CybotCookiebotDialogBodyUnderlay',
    '#didomi-host', '.didomi-popup-backdrop',
    '#usercentrics-root', '#usercentrics-cmp-ui',
    '.qc-cmp2-container', '#qc-cmp2-container',
    '#sp_message_container_', 'div[id^="sp_message_container"]',
    '.fc-consent-root', '.cmp-banner', '#cmpbox', '#cmpbox2',
    '.truste_overlay', '.truste_box_overlay',
    '#cookie-banner', '#cookieBanner', '#cookie-notice', '.cookie-notice',
    '.cookie-banner', '.cookie-consent', '#cookieConsent', '.cc-window.cc-banner',
    '#gdpr-banner', '.gdpr-banner', '#consent-banner', '.consent-banner',
  ],

  applyTo(webview) {
    if (!this.enabled()) return;
    const sel = this.SELECTORS.join(',');
    const hideCss = sel + '{display:none!important;visibility:hidden!important}';
    // Scroll/position un-lock that undoes a banner's body scroll-lock. This must
    // NOT be applied blanket: forcing html,body to position:static + overflow:auto
    // overrides sites that legitimately position/scroll on body and wrecks their
    // layout (Roblox anchored its global footer to <body>, so position:static
    // dropped it into the middle of the page). We add it ONLY once a consent
    // element is actually present, re-checking briefly for banners that mount
    // after dom-ready. The hide rule is safe everywhere — the selectors are
    // specific CMP/cookie-banner IDs that don't match ordinary markup.
    const unlockCss = 'html,body{overflow:auto!important;position:static!important}';
    // Known "reject all" buttons across the major CMPs, plus a scoped text match
    // inside consent containers — so we record a real opt-out (banner stays gone
    // next visit) instead of only hiding it. Text matching is confined to the
    // consent containers above so we never click a stray "reject" elsewhere.
    const rejectIds = JSON.stringify([
      '#onetrust-reject-all-handler', '.ot-pc-refuse-all-handler',
      '#CybotCookiebotDialogBodyButtonDecline', '#CybotCookiebotDialogBodyLevelButtonLevelOptinDeclineAll',
      '#didomi-notice-disagree-button', '.didomi-continue-without-agreeing',
      'button[mode="primary"].qc-cmp2-summary-button', '[data-testid="uc-deny-all-button"]',
      '.fc-cta-do-not-consent', '.fc-button.fc-cta-do-not-consent',
      '[data-testid="reject-all"]', '[aria-label="Reject all"]', '[title="Reject all"]',
    ]);
    const js = `(function(){try{
      var sel=${JSON.stringify(sel)};
      var REJECT_IDS=${rejectIds};
      var RX=/(^\\s*(reject|decline|refuse|deny|disagree)\\b)|reject all|decline all|only necessary|necessary only|essential( cookies)? only|continue without accepting|do not (sell|share|accept)/i;
      var clicked=false;
      function vis(el){if(!el)return false;var r=el.getBoundingClientRect();if(r.width<2||r.height<2)return false;var cs=getComputedStyle(el);return cs.visibility!=='hidden'&&cs.display!=='none';}
      function tryReject(){
        if(clicked)return true;
        for(var i=0;i<REJECT_IDS.length;i++){var b=document.querySelector(REJECT_IDS[i]);if(b&&vis(b)){try{b.click();clicked=true;return true;}catch(e){}}}
        var cs=document.querySelectorAll(sel);
        for(var c=0;c<cs.length;c++){var bs=cs[c].querySelectorAll('button,a,[role=button],input[type=button],input[type=submit]');
          for(var j=0;j<bs.length;j++){var t=(bs[j].textContent||bs[j].value||'').trim();if(t&&t.length<40&&RX.test(t)&&vis(bs[j])){try{bs[j].click();clicked=true;return true;}catch(e){}}}}
        return false;
      }
      var id='vex-consent-style';
      function ensure(){var el=document.getElementById(id);if(!el){el=document.createElement('style');el.id=id;document.documentElement.appendChild(el);}return el;}
      function paint(){var has=!!document.querySelector(sel);if(has)tryReject();ensure().textContent=${JSON.stringify(hideCss)}+(has?${JSON.stringify(unlockCss)}:'');return has;}
      // The watcher and the teardown hang off window.__vexConsentOff. Without a
      // way to stop the watcher, clearing the stylesheet when the feature is
      // switched off is itself a DOM mutation that wakes the watcher, which
      // immediately paints the rules back — the "off" switch undid itself.
      if(window.__vexConsentOff)window.__vexConsentOff(true);
      var mo=null,timer=null;
      window.__vexConsentOff=function(keepStyle){
        try{if(mo)mo.disconnect();}catch(e){}
        try{if(timer)clearTimeout(timer);}catch(e){}
        mo=null;timer=null;
        if(!keepStyle){var el=document.getElementById(id);if(el)el.textContent='';}
        if(!keepStyle)window.__vexConsentOff=null;
      };
      if(!paint() && typeof MutationObserver==='function'){
        var n=0;mo=new MutationObserver(function(){if((paint()&&clicked)||++n>40){try{mo.disconnect();}catch(e){}mo=null;}});
        try{mo.observe(document.documentElement,{childList:true,subtree:true});}catch(e){}
        timer=setTimeout(function(){try{if(mo)mo.disconnect();}catch(e){}mo=null;},10000);
      }
    }catch(e){}})();`;
    try { webview.executeJavaScript(js).catch(() => {}); } catch {}
  },
};

// ---- Copy & right-click unlock — bypass sites that block selection/copy ----
// Re-enables text selection, right-click, and copy/cut on pages that disable
// them via JS or CSS (the common "you can't copy this" walls). It does NOT
// crack DRM or read canvas-rendered editors (e.g. Google Docs has no selectable
// DOM text). Two entry points:
//   • applyTo(webview)       — auto-applied on every page load when the global
//                              toggle (Settings → Browsing extras) is ON.
//   • applyNow()             — on-demand from the command bar; unlocks just the
//                              current page regardless of the global toggle.
// Default is OFF so it never interferes with legit copy handlers in web apps
// (spreadsheets, code editors). The injected script:
//   1. stops the site's capture-phase block handlers (stopPropagation, NOT
//      stopImmediatePropagation — so Vex's own gesture handler still runs and
//      we never call preventDefault, letting the native copy/menu proceed);
//   2. nulls the inline on* blockers sites re-assign (re-cleared for ~10s);
//   3. forces user-select back on via injected CSS.
const CopyUnlock = {
  KEY: 'vex.copyUnlock',
  enabled() { try { return localStorage.getItem(this.KEY) === 'on'; } catch { return false; } },

  // Returns false when the preference could not be stored. Turning it ON takes
  // effect on every open page at once; turning it OFF removes the CSS half
  // everywhere, and says plainly that the event handlers already installed in
  // those pages only go away on reload — see removeFrom().
  setEnabled(on) {
    let saved = true;
    try { localStorage.setItem(this.KEY, on ? 'on' : 'off'); } catch { saved = false; }
    return saved;
  },

  // Undo what can be undone in a page that is already unlocked. The capture
  // listeners and the cleared inline handlers cannot be restored — the honest
  // answer is a reload, which reapplyAll() reports rather than hiding.
  removeFrom(webview) {
    const js = "(function(){try{var e=document.getElementById('vex-copy-unlock-style');if(e)e.remove();}catch(e){}})();";
    try { webview.executeJavaScript(js).catch(() => {}); } catch {}
  },

  // Apply or partially undo across every live guest. Returns how many pages are
  // still carrying listeners that only a reload clears.
  reapplyAll() {
    if (typeof WebviewManager === 'undefined' || !WebviewManager.webviews) return 0;
    const on = this.enabled();
    let stillUnlocked = 0;
    WebviewManager.webviews.forEach((wv) => {
      try {
        if (on) { this.applyTo(wv); return; }
        this.removeFrom(wv);
        stillUnlocked++;
      } catch {}
    });
    return on ? 0 : stillUnlocked;
  },

  _script() {
    return `(function(){try{
      if (window.__vexCopyUnlock) return; window.__vexCopyUnlock = true;
      // Block only copy/selection-related events at capture; stopPropagation
      // (not Immediate, not preventDefault) bypasses the site's own blockers
      // on inner nodes while leaving the native copy/menu and Vex gestures.
      var STOP = ['contextmenu','copy','cut','selectstart','dragstart','beforecopy'];
      STOP.forEach(function(type){
        try { document.addEventListener(type, function(e){ e.stopPropagation(); }, true); } catch(_){}
      });
      // Sites re-assign inline on* handlers; clear the copy/selection ones for a
      // short window after load.
      var PROPS = ['oncontextmenu','oncopy','oncut','onselectstart','ondragstart','onbeforecopy'];
      function clearOn(){
        var nodes = [document, document.documentElement, document.body];
        for (var n=0;n<nodes.length;n++){ if(!nodes[n]) continue;
          for (var p=0;p<PROPS.length;p++){ try{ nodes[n][PROPS[p]] = null; }catch(_){} } }
      }
      clearOn();
      var ticks=0; var iv=setInterval(function(){ clearOn(); if(++ticks>20){ try{clearInterval(iv);}catch(_){} } }, 500);
      // Force selection back on (overrides user-select:none).
      var id='vex-copy-unlock-style';
      if(!document.getElementById(id)){
        var st=document.createElement('style'); st.id=id;
        st.textContent='*,*::before,*::after{-webkit-user-select:auto!important;-moz-user-select:auto!important;-ms-user-select:auto!important;user-select:auto!important;-webkit-touch-callout:default!important;}html,body{-webkit-user-select:auto!important;user-select:auto!important;}';
        (document.head||document.documentElement).appendChild(st);
      }
    }catch(e){}})();`;
  },

  applyTo(webview, force) {
    if (!force && !this.enabled()) return;
    try { webview.executeJavaScript(this._script()).catch(() => {}); } catch {}
  },

  // On-demand: unlock the active page now, regardless of the global toggle.
  applyNow() {
    const wv = (typeof WebviewManager !== 'undefined') ? WebviewManager.getActiveWebview() : null;
    if (!wv) { window.showToast?.('Open a page first'); return; }
    this.applyTo(wv, true);
    window.showToast?.('Copy & right-click unlocked on this page');
  },
};

if (typeof window !== 'undefined') { window.ReadAloud = ReadAloud; window.ConsentBlock = ConsentBlock; window.CopyUnlock = CopyUnlock; }
if (typeof module !== 'undefined' && module.exports) module.exports = { ReadAloud, ConsentBlock, CopyUnlock, vexTtsPage, VexTextLang };
