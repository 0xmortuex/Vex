// === Reading with listening =================================================
//
// Any article becomes a clean read (the existing reading mode) or something to
// listen to, in the system voice. The page is read the way reading mode reads
// it, split into chapters at its headings, and played one sentence at a time
// through speechSynthesis: play/pause, previous/next chapter, speed, and the
// keyboard's media keys while it plays.
//
//   Full         every paragraph of every chapter
//   Brief        the lead sentences of each chapter: an audio brief
//   What is new  only what was added to the page since you last read it,
//                from a stored snapshot of its text (the page watcher's diff,
//                js/page-watch-diff.js)
//
// It is opt-in (Settings, or the first time you use it), it never starts by
// itself (opening the panel is silent until you press play), it is silent
// while a game is running, and it never reads or remembers a private, Tor or
// routed tab. The snapshots live on this computer and are bounded: two per
// page and a total size cap.
//
// The top half is pure and unit-tested (tests/renderer/listenReader.test.js).

const ListenReader = {
  ENABLED_KEY: 'vex.listen.enabled',
  RATE_KEY: 'vex.listen.rate',
  SNAP_KEY: 'vex.listenSnapshots',

  // Snapshots: two per page (the one you read last, and the one before), and
  // 500,000 characters in all, oldest dropped first.
  SNAP_LIMITS: { perWatch: 2, snapChars: 30000, totalChars: 500000, lineChars: 400 },
  MAX_PAGES: 150,
  WORDS_PER_MINUTE: 165,
  CHUNK_CHARS: 240,
  BRIEF_SENTENCES: 2,
  RATES: [0.75, 1, 1.25, 1.5, 1.75, 2],

  // ---- the article -------------------------------------------------------
  // Plain text of a run list: [{t}, {b:[...]}, {a:href, c:[...]}, {code}, {br}].
  runsText(runs) {
    const parts = [];
    const walk = (list) => {
      for (const r of (Array.isArray(list) ? list : [])) {
        if (!r || typeof r !== 'object') continue;
        if (typeof r.t === 'string') parts.push(r.t);
        else if (typeof r.code === 'string') parts.push(r.code);
        else if (r.br) parts.push(' ');
        else for (const k of ['c', 'b', 'i', 'sup', 'sub']) if (Array.isArray(r[k])) { walk(r[k]); break; }
      }
    };
    walk(runs);
    return parts.join('').replace(/\s+/g, ' ').trim();
  },

  // Reading-mode blocks -> [{ title, level, paras: [text] }]. The text before
  // the first heading is the first chapter, named for the article. Code,
  // tables and pictures are not read aloud; `skipped` counts them.
  blocksToSections(blocks, articleTitle) {
    const sections = [];
    let skipped = 0;
    let cur = { title: String(articleTitle || '').trim() || 'Start', level: 1, paras: [] };
    const push = () => { if (cur.paras.length) sections.push(cur); };
    const para = (text) => { const t = String(text || '').replace(/\s+/g, ' ').trim(); if (t) cur.paras.push(t); };
    const walk = (list) => {
      for (const b of (Array.isArray(list) ? list : [])) {
        if (!b || typeof b !== 'object') continue;
        const tag = String(b.tag || '');
        if (/^H[1-6]$/.test(tag)) {
          const title = this.runsText(b.runs);
          if (!title) continue;
          push();
          cur = { title, level: Number(tag[1]), paras: [] };
        } else if (tag === 'P') {
          para(this.runsText(b.runs));
        } else if (tag === 'UL' || tag === 'OL') {
          for (const item of (b.items || [])) walk(Array.isArray(item) ? item : (item && item.c));
        } else if (tag === 'DL') {
          for (const item of (b.items || [])) walk(item && item.c);
        } else if (tag === 'BLOCKQUOTE') {
          walk(b.children);
        } else if (tag === 'PRE' || tag === 'TABLE' || tag === 'FIGURE') {
          skipped++;
        }
      }
    };
    walk(blocks);
    push();
    return { sections, skipped };
  },

  wordCount(text) {
    const m = String(text || '').trim().match(/\S+/g);
    return m ? m.length : 0;
  },

  // [{ index, title, level, words, seconds }] at the given speed.
  chapters(sections, rate = 1) {
    const r = Number(rate) > 0 ? Number(rate) : 1;
    return sections.map((s, index) => {
      const words = s.paras.reduce((n, p) => n + this.wordCount(p), 0);
      return { index, title: s.title, level: s.level, words, seconds: Math.round(words / (this.WORDS_PER_MINUTE * r) * 60) };
    });
  },

  // "4 min", "45 s": for the chapter list.
  duration(seconds) {
    const s = Math.max(0, Math.round(seconds));
    return s < 60 ? s + ' s' : Math.round(s / 60) + ' min';
  },

  // Sentences, then packed into pieces a voice can take in one go. A very long
  // sentence is cut at its commas, and failing that at a space.
  sentences(text) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t) return [];
    return t.split(/(?<=[.!?…])["')\]]*\s+(?=[A-Z0-9"'(À-ɏ])/).map(s => s.trim()).filter(Boolean);
  },

  chunks(text, max = this.CHUNK_CHARS) {
    const out = [];
    for (const sentence of this.sentences(text)) {
      if (sentence.length <= max) { out.push(sentence); continue; }
      let rest = sentence;
      while (rest.length > max) {
        const head = rest.slice(0, max);
        let at = Math.max(head.lastIndexOf(', '), head.lastIndexOf('; '), head.lastIndexOf(': '));
        if (at < max * 0.4) at = head.lastIndexOf(' ');
        if (at < 1) at = max;
        out.push(rest.slice(0, at + 1).trim());
        rest = rest.slice(at + 1).trim();
      }
      if (rest) out.push(rest);
    }
    return out;
  },

  // What is spoken: [{ title, chunks }]. Each chapter is announced by its
  // heading. `brief` keeps only the lead sentences of each chapter.
  speechPlan(sections, mode = 'full') {
    const plan = [];
    for (const s of sections) {
      let chunks;
      if (mode === 'brief') {
        const lead = [];
        for (const p of s.paras) {
          for (const sentence of this.sentences(p)) { lead.push(sentence); if (lead.length >= this.BRIEF_SENTENCES) break; }
          if (lead.length >= this.BRIEF_SENTENCES) break;
        }
        chunks = this.chunks(lead.join(' '));
      } else {
        chunks = [];
        for (const p of s.paras) chunks.push(...this.chunks(p));
      }
      if (!chunks.length) continue;
      plan.push({ title: s.title, chunks: [s.title.replace(/[.!?]*$/, '') + '.'].concat(chunks) });
    }
    return plan;
  },

  // ---- what is new since you last read it --------------------------------
  // One key for "this page": no fragment, no tracking parameters.
  snapshotKey(url) {
    let u;
    try { u = new URL(String(url)); } catch { return ''; }
    if (!/^https?:$/.test(u.protocol)) return '';
    const drop = /^(utm_|fbclid$|gclid$|mc_|ref$|ref_src$)/i;
    const keep = [...u.searchParams.entries()].filter(([k]) => !drop.test(k)).sort(([a], [b]) => a.localeCompare(b));
    const q = keep.length ? '?' + keep.map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&') : '';
    return u.hostname.toLowerCase().replace(/^www\./, '') + (u.pathname.replace(/\/+$/, '') || '/') + q;
  },

  _diff() {
    if (typeof PageWatchDiff !== 'undefined') return PageWatchDiff;
    if (typeof require === 'function') return require('./page-watch-diff.js').PageWatchDiff;
    throw new Error('The page watcher is not loaded');
  },

  // The steady lines of an article: its title and each paragraph.
  linesOf(title, sections) {
    const raw = [String(title || '')];
    for (const s of sections) { raw.push(s.title); raw.push(...s.paras); }
    return this._diff().normalizeText(raw.join('\n'));
  },

  // `previous` is { at, text } or null; `lines` the page now. -> {
  //   first, since, changed, added, removed, summary }.
  whatsNew(previous, lines) {
    const D = this._diff();
    if (!previous || typeof previous.text !== 'string') return { first: true, since: 0, changed: false, added: [], removed: [], summary: '' };
    const before = previous.text.split('\n').filter(Boolean);
    const { added, removed, significant } = D.change(before, lines, { sensitivity: 'normal' });
    return {
      first: false,
      since: Number(previous.at) || 0,
      changed: significant,
      added,
      removed,
      summary: significant ? D.summarize({ added, removed }).text : '',
    };
  },

  // Adds the text just read as this page's newest snapshot, and returns the
  // store. A page that did not change keeps one snapshot, with the new time.
  remember(store, key, lines, now) {
    if (!key) return store;
    const D = this._diff();
    const hash = D.fingerprint(lines);
    D.pushSnapshot(store, key, { at: now, text: lines.join('\n'), hash }, this.SNAP_LIMITS);
    const list = store[key];
    if (list && list.length && list[list.length - 1].hash === hash) list[list.length - 1].at = now;
    // pushSnapshot never drops a page's newest snapshot, so a long run of
    // different pages would grow the store without limit: the pages read
    // longest ago go, never the one just written.
    while (Object.keys(store).length > 1 && (D.sizeOf(store) > this.SNAP_LIMITS.totalChars || Object.keys(store).length > this.MAX_PAGES)) {
      let oldest = null;
      for (const [k, l] of Object.entries(store)) {
        if (k === key || !l.length) continue;
        const at = l[l.length - 1].at;
        if (!oldest || at < oldest.at) oldest = { k, at };
      }
      if (!oldest) break;
      delete store[oldest.k];
    }
    return store;
  },

  // ---- settings and storage ----------------------------------------------
  enabled() { try { return localStorage.getItem(this.ENABLED_KEY) === 'on'; } catch { return false; } },
  setEnabled(on) {
    try { localStorage.setItem(this.ENABLED_KEY, on ? 'on' : 'off'); }
    catch (err) { throw new Error('The setting could not be saved: ' + err.message); }
    if (!on) this.stop();
    return !!on;
  },
  rate() {
    let r = 1;
    try { r = Number(localStorage.getItem(this.RATE_KEY)); } catch { r = 1; }
    return this.RATES.includes(r) ? r : 1;
  },
  setRate(r) {
    const n = Number(r);
    if (!this.RATES.includes(n)) throw new Error('Choose one of these speeds: ' + this.RATES.join(', '));
    try { localStorage.setItem(this.RATE_KEY, String(n)); } catch (err) { throw new Error('The speed could not be saved: ' + err.message); }
    if (this._s) { this._s.rate = n; this._jump(this._s.chunk); }
    return n;
  },
  _store() {
    try { const o = JSON.parse(localStorage.getItem(this.SNAP_KEY) || '{}'); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch { return {}; }
  },
  _saveStore(store) {
    try { localStorage.setItem(this.SNAP_KEY, JSON.stringify(store)); }
    catch (err) { throw new Error('What you read could not be remembered: ' + err.message); }
  },
  forget() {
    try { localStorage.removeItem(this.SNAP_KEY); } catch { /* nothing kept */ }
  },
  remembered() { return Object.keys(this._store()).length; },

  // ---- the page ----------------------------------------------------------
  _gaming() {
    return (typeof GameMode !== 'undefined' && !!GameMode.gaming) || (typeof GameSession !== 'undefined' && !!GameSession.active);
  },

  async _read() {
    const tab = (typeof TabManager !== 'undefined' && TabManager.getActiveTab) ? TabManager.getActiveTab() : null;
    const wv = (typeof WebviewManager !== 'undefined' && WebviewManager.getActiveWebview) ? WebviewManager.getActiveWebview() : null;
    if (!tab || !wv) throw new Error('Open an article first');
    const pol = window.VexTabPolicy;
    if (pol && (!pol.canReadWebview(wv) || (pol.canPersist && !pol.canPersist(tab)))) throw new Error('Private, Tor and routed tabs are never read');
    if (!/^https?:/i.test(tab.url || '')) throw new Error('Only web pages can be read');
    if (typeof ReadingMode === 'undefined' || typeof ReadingMode._extractScript !== 'function') throw new Error('Reading mode is not available');
    const article = await wv.executeJavaScript(ReadingMode._extractScript());
    if (!article || !Array.isArray(article.blocks)) throw new Error('This page has no article to read');
    return { tab, article };
  },

  // ---- playback ----------------------------------------------------------
  _s: null,   // { plan, chapter, chunk, token, paused, rate, mode, title, lang, utterance, watchdog }

  _stopOthers() {
    if (typeof ReadAloud !== 'undefined' && ReadAloud._s && typeof ReadAloud.stop === 'function') ReadAloud.stop(true);
    if (typeof QueuePodcast !== 'undefined' && QueuePodcast._bar && typeof QueuePodcast.stop === 'function') QueuePodcast.stop();
  },

  _voice(lang) {
    let voices = [];
    try { voices = speechSynthesis.getVoices() || []; } catch { voices = []; }
    if (!voices.length) return null;
    const want = String(lang || '').toLowerCase();
    let saved = '';
    if (typeof ReadAloud !== 'undefined' && typeof ReadAloud.settings === 'function') {
      const st = ReadAloud.settings();
      saved = (want && st.voices && st.voices[want.split('-')[0]]) || st.voice || '';
    }
    const byName = saved && voices.find(v => v.name === saved && (!want || v.lang.toLowerCase().startsWith(want.split('-')[0])));
    if (byName) return byName;
    if (want) {
      const exact = voices.find(v => v.lang.toLowerCase() === want);
      if (exact) return exact;
      const same = voices.find(v => v.lang.toLowerCase().startsWith(want.split('-')[0]));
      if (same) return same;
    }
    return voices.find(v => v.default) || voices[0];
  },

  play() {
    const s = this._s;
    if (!s) return false;
    if (this._gaming()) { this._quiet('A game is running, so Listen stays silent'); return false; }
    this._stopOthers();
    s.paused = false;
    this._mediaOn();
    this._speak();
    return true;
  },

  pause() {
    const s = this._s;
    if (!s || s.paused) return;
    s.paused = true;
    s.token++;
    clearTimeout(s.watchdog);
    // cancel, not pause: pause leaves some voices silent for good. The chunk
    // starts again on resume.
    try { speechSynthesis.cancel(); } catch { /* nothing speaking */ }
    this._draw();
  },
  playPause() { const s = this._s; if (!s) return; if (s.paused || !s.utterance) this.play(); else this.pause(); },

  _jump(chunk) {
    const s = this._s;
    if (!s) return;
    s.chunk = Math.max(0, chunk);
    s.token++;
    clearTimeout(s.watchdog);
    try { speechSynthesis.cancel(); } catch { /* nothing speaking */ }
    if (!s.paused && s.utterance) this._speak(); else this._draw();
  },

  goChapter(i) {
    const s = this._s;
    if (!s) return;
    const n = Math.min(Math.max(0, i), s.plan.length - 1);
    s.chapter = n;
    s.chunk = 0;
    s.token++;
    clearTimeout(s.watchdog);
    try { speechSynthesis.cancel(); } catch { /* nothing speaking */ }
    if (!s.paused && s.utterance) this._speak(); else this._draw();
  },
  nextChapter() { const s = this._s; if (s) this.goChapter(s.chapter + 1); },
  prevChapter() {
    const s = this._s;
    if (!s) return;
    // A few sentences in, "previous" restarts the chapter; at its start, goes back.
    this.goChapter(s.chunk > 2 ? s.chapter : s.chapter - 1);
  },

  _quiet(why) {
    this.stop();
    window.showToast?.(why);
  },

  _speak() {
    const s = this._s;
    if (!s) return;
    if (this._gaming()) { this._quiet('A game started, so Listen stopped'); return; }
    const ch = s.plan[s.chapter];
    if (!ch) { this._finish(); return; }
    if (s.chunk >= ch.chunks.length) {
      if (s.chapter + 1 >= s.plan.length) { this._finish(); return; }
      s.chapter++; s.chunk = 0;
      this._speak();
      return;
    }
    const token = ++s.token;
    const text = ch.chunks[s.chunk];
    const u = new SpeechSynthesisUtterance(text);
    u.rate = s.rate;
    const v = this._voice(s.lang);
    if (v) { u.voice = v; u.lang = v.lang; } else if (s.lang) u.lang = s.lang;
    const live = () => this._s === s && s.token === token;
    u.onend = () => { if (!live()) return; clearTimeout(s.watchdog); s.fails = 0; s.chunk++; this._speak(); };
    u.onerror = (e) => {
      if (!live()) return;
      clearTimeout(s.watchdog);
      const why = e && e.error;
      // Something else took the speech engine (Read aloud, the playlist): this
      // one steps aside rather than fighting for it.
      if (why === 'interrupted' || why === 'canceled') { s.paused = true; s.utterance = null; this._draw(); return; }
      s.fails = (s.fails || 0) + 1;
      if (s.fails >= 3) { this.stop(); window.showToast?.('Listen stopped: the voice failed (' + (why || 'unknown error') + ')', 'error'); return; }
      s.chunk++;
      this._speak();
    };
    clearTimeout(s.watchdog);
    s.watchdog = setTimeout(() => {
      if (!live()) return;
      try { speechSynthesis.cancel(); } catch { /* nothing speaking */ }
      s.chunk++;
      this._speak();
    }, 8000 + text.length * 110 / s.rate);
    s.utterance = u;   // held, or Chromium can collect it before 'end' fires
    this._draw();
    speechSynthesis.speak(u);
  },

  _finish() {
    const s = this._s;
    if (!s) return;
    s.token++;
    clearTimeout(s.watchdog);
    s.utterance = null;
    s.paused = true;
    s.chapter = 0; s.chunk = 0;
    this._mediaOff();
    this._draw();
  },

  stop() {
    const s = this._s;
    this._s = null;
    if (s) { s.token++; clearTimeout(s.watchdog); }
    try { if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel(); } catch { /* nothing speaking */ }
    this._mediaOff();
    document.querySelector('.vex-listen-panel')?.remove();
  },

  // ---- media keys --------------------------------------------------------
  // The keyboard's media keys go to a page's media session, and the speech
  // engine alone does not make one. A silent, looping audio element holds the
  // session while a reading plays; it is released when it stops.
  _silentWav() {
    const rate = 8000, n = 800;
    const buf = new Uint8Array(44 + n);
    const dv = new DataView(buf.buffer);
    const w = (o, str) => { for (let i = 0; i < str.length; i++) buf[o + i] = str.charCodeAt(i); };
    w(0, 'RIFF'); dv.setUint32(4, 36 + n, true); w(8, 'WAVE'); w(12, 'fmt ');
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, rate, true); dv.setUint32(28, rate, true); dv.setUint16(32, 1, true); dv.setUint16(34, 8, true);
    w(36, 'data'); dv.setUint32(40, n, true);
    buf.fill(128, 44);
    return buf;
  },

  _mediaOn() {
    if (this._mediaHeld || typeof navigator === 'undefined' || !navigator.mediaSession) return;
    this._mediaHeld = true;
    const ms = navigator.mediaSession;
    const set = (name, fn) => { try { ms.setActionHandler(name, fn); } catch { /* an action this build lacks */ } };
    try {
      if (this._s && window.MediaMetadata) ms.metadata = new window.MediaMetadata({ title: this._s.title || 'Article', artist: 'Vex Listen' });
    } catch { /* metadata is a nicety */ }
    set('play', () => this.play());
    set('pause', () => this.pause());
    set('nexttrack', () => this.nextChapter());
    set('previoustrack', () => this.prevChapter());
    set('stop', () => this.stop());
    try {
      const url = URL.createObjectURL(new Blob([this._silentWav()], { type: 'audio/wav' }));
      const a = new Audio(url);
      a.loop = true;
      a.volume = 0.01;
      this._holder = { a, url };
      const p = a.play();
      if (p && typeof p.catch === 'function') p.catch(() => { /* no session: the buttons in the panel still work */ });
    } catch { /* same */ }
  },

  _mediaOff() {
    if (!this._mediaHeld) return;
    this._mediaHeld = false;
    const ms = (typeof navigator !== 'undefined') ? navigator.mediaSession : null;
    if (ms) for (const name of ['play', 'pause', 'nexttrack', 'previoustrack', 'stop']) { try { ms.setActionHandler(name, null); } catch { /* none set */ } }
    if (this._holder) {
      try { this._holder.a.pause(); } catch { /* already stopped */ }
      try { URL.revokeObjectURL(this._holder.url); } catch { /* already gone */ }
      this._holder = null;
    }
  },

  // ---- the panel ---------------------------------------------------------
  async load({ mode = 'full' } = {}) {
    const { tab, article } = await this._read();
    const { sections, skipped } = this.blocksToSections(article.blocks, article.title || tab.title);
    if (!sections.length) throw new Error('There is no text on this page to read aloud');
    const title = String(article.title || tab.title || tab.url);
    const lines = this.linesOf(title, sections);
    const key = this.snapshotKey(tab.url);
    const store = this._store();
    const list = key ? store[key] : null;
    const previous = list && list.length ? list[list.length - 1] : null;
    const news = this.whatsNew(previous, lines);
    // Remembered only because Listen is switched on and the tab may be
    // persisted (checked in _read): the page as read now is next time's "before".
    if (key) { this.remember(store, key, lines, Date.now()); this._saveStore(store); }
    let lang = String(article.lang || '').toLowerCase().replace(/_/g, '-');
    if (!/^[a-z]{2,3}(-[a-z0-9]{1,8})*$/.test(lang)) lang = '';
    if (!lang && typeof VexTextLang !== 'undefined' && typeof VexTextLang.detect === 'function') {
      try { lang = VexTextLang.detect(sections.slice(0, 3).map(x => x.paras.join(' ')).join(' ')) || ''; } catch { lang = ''; }
    }
    return { tab, title, sections, skipped, news, lang, mode, previous };
  },

  async open(opts = {}) {
    if (typeof speechSynthesis === 'undefined' || typeof SpeechSynthesisUtterance === 'undefined') {
      throw new Error('Text-to-speech is not available here');
    }
    if (!this.enabled()) {
      const ok = await window.vexConfirm({
        title: 'Turn on Listen?',
        message: 'Listen reads the page aloud in your system voice and remembers the text of pages you open it on, on this computer, to tell you what is new next time. It never starts by itself and is silent while a game runs. You can switch it off in Settings.',
        okLabel: 'Turn on',
      });
      if (!ok) return null;
      this.setEnabled(true);
    }
    this.stop();
    const data = await this.load(opts);
    const mode = opts.mode === 'brief' ? 'brief' : 'full';
    this._s = {
      sections: data.sections, plan: this.speechPlan(data.sections, mode), chapter: 0, chunk: 0, token: 0,
      paused: true, rate: this.rate(), mode, title: data.title, lang: data.lang, utterance: null, watchdog: null, fails: 0, news: data.news,
    };
    this._draw();
    return this._s;   // nothing is spoken until play()
  },

  // Reads text that is not a page aloud: an AI answer with its sources summarised
  // (js/library-links.js). sections: [{ title, level, paras }]. Same switch, same
  // game rule, same panel as a page; it starts because the person pressed the button.
  async speakText({ title, sections, lang = '' } = {}) {
    if (typeof speechSynthesis === 'undefined' || typeof SpeechSynthesisUtterance === 'undefined') {
      throw new Error('Text-to-speech is not available here');
    }
    const secs = (Array.isArray(sections) ? sections : [])
      .map(s => ({ title: String(s && s.title || '').trim() || 'Text', level: 1, paras: (s && Array.isArray(s.paras) ? s.paras : []).map(p => String(p || '').replace(/\s+/g, ' ').trim()).filter(Boolean) }))
      .filter(s => s.paras.length);
    if (!secs.length) throw new Error('There is nothing to read aloud');
    if (!this.enabled()) {
      const ok = await window.vexConfirm({
        title: 'Turn on Listen?',
        message: 'Listen reads text aloud in your system voice. It never starts by itself and is silent while a game runs. You can switch it off in Settings.',
        okLabel: 'Turn on',
      });
      if (!ok) return null;
      this.setEnabled(true);
    }
    this.stop();
    let l = String(lang || '').toLowerCase();
    if (!l && typeof VexTextLang !== 'undefined' && typeof VexTextLang.detect === 'function') {
      try { l = VexTextLang.detect(secs.map(s => s.paras.join(' ')).join(' ')) || ''; } catch { l = ''; }
    }
    this._s = {
      sections: secs, plan: this.speechPlan(secs, 'full'), chapter: 0, chunk: 0, token: 0,
      paused: true, rate: this.rate(), mode: 'full', title: String(title || 'Text'), lang: l, utterance: null, watchdog: null, fails: 0, news: null,
    };
    this._draw();
    this.play();
    return this._s;
  },

  // Re-plan in another mode, or as "what is new". Keeps the panel, not the place.
  setMode(mode) {
    const s = this._s;
    if (!s) return;
    const was = !s.paused && !!s.utterance;
    s.token++;
    clearTimeout(s.watchdog);
    try { speechSynthesis.cancel(); } catch { /* nothing speaking */ }
    if (mode === 'new') {
      const added = (s.news && s.news.added) || [];
      s.plan = added.length ? [{ title: 'New since you last read this page', chunks: ['New since you last read this page.'].concat(...added.map(l => this.chunks(l))) }] : [];
    } else {
      s.plan = this.speechPlan(s.sections, mode === 'brief' ? 'brief' : 'full');
    }
    s.mode = mode; s.chapter = 0; s.chunk = 0; s.utterance = null; s.paused = true;
    this._draw();
    if (was && s.plan.length) this.play();
  },

  _draw() {
    const s = this._s;
    document.querySelector('.vex-listen-panel')?.remove();
    if (!s || typeof document === 'undefined') return;
    const esc = (t) => window.escapeHtml(String(t == null ? '' : t));
    const ico = (n, size = 15) => (window.VexIcons ? VexIcons.svg(n, { size }) : '');
    const btn = 'display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;color:var(--text);background:none;border:1px solid var(--border);border-radius:6px;cursor:pointer';
    const chapters = this.chapters(s.sections, s.rate);
    const playing = !s.paused && !!s.utterance;
    const cur = s.plan[s.chapter];
    const panel = document.createElement('div');
    panel.className = 'vex-listen-panel';
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', 'Listen');
    panel.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:9000;width:min(340px,92vw);display:flex;flex-direction:column;gap:8px;padding:12px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:12px;box-shadow:0 12px 36px var(--vex-shadow-color,rgba(0,0,0,0.4));font-size:12.5px';
    const news = s.news;
    let newsLine = '';
    if (news && news.first) newsLine = 'First time here - next time Listen can tell you what is new.';
    else if (news && news.changed) newsLine = 'Changed since ' + new Date(news.since).toLocaleDateString() + ': ' + (news.summary.split('\n')[0] || '');
    else if (news) newsLine = 'Nothing new since ' + new Date(news.since).toLocaleDateString() + '.';
    panel.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px">
        <strong style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(s.title)}">${esc(s.title)}</strong>
        <button type="button" data-l="close" aria-label="Close Listen" style="${btn}">${ico('x', 14)}</button>
      </div>
      <div data-l="now" style="color:var(--text-muted);min-height:16px">${cur ? esc(cur.title) + ' - ' + (s.chunk + 1) + ' of ' + cur.chunks.length : (s.mode === 'new' ? 'Nothing new to read.' : 'Press play to start.')}</div>
      <div style="display:flex;gap:6px;align-items:center">
        <button type="button" data-l="prev" aria-label="Previous chapter" style="${btn}">${ico('skip', 14)}</button>
        <button type="button" data-l="play" aria-label="${playing ? 'Pause' : 'Play'}" style="${btn}">${ico(playing ? 'pause' : 'play')}</button>
        <button type="button" data-l="next" aria-label="Next chapter" style="${btn}">${ico('fast-forward', 14)}</button>
        <select data-l="rate" class="set-input" aria-label="Speed" style="margin-left:auto">${this.RATES.map(r => '<option value="' + r + '"' + (r === s.rate ? ' selected' : '') + '>' + r + 'x</option>').join('')}</select>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button type="button" data-l="m-full" class="btn-secondary" aria-pressed="${s.mode === 'full'}">Full</button>
        <button type="button" data-l="m-brief" class="btn-secondary" aria-pressed="${s.mode === 'brief'}">Brief</button>
        <button type="button" data-l="m-new" class="btn-secondary" aria-pressed="${s.mode === 'new'}" ${news && news.changed ? '' : 'disabled'}>What is new</button>
        <button type="button" data-l="read" class="btn-secondary" title="Open this page in reading mode">Clean read</button>
      </div>
      ${newsLine ? '<div style="color:var(--text-muted);font-size:11.5px">' + esc(newsLine) + '</div>' : ''}
      <div data-l="chapters" role="list" style="max-height:140px;overflow:auto;border-top:1px solid var(--border);padding-top:6px"></div>`;
    const list = panel.querySelector('[data-l="chapters"]');
    s.plan.forEach((ch, i) => {
      const meta = chapters.find(c => c.title === ch.title);
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'listitem');
      b.style.cssText = 'display:flex;width:100%;justify-content:space-between;gap:8px;text-align:left;padding:3px 4px;background:' + (i === s.chapter ? 'var(--vex-hover-fill,rgba(127,127,127,.15))' : 'none') + ';border:none;border-radius:4px;color:var(--text);cursor:pointer;font-size:12px';
      const name = document.createElement('span'); name.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap'; name.textContent = ch.title;
      const dur = document.createElement('span'); dur.style.color = 'var(--text-muted)'; dur.textContent = meta ? this.duration(meta.seconds) : '';
      b.append(name, dur);
      b.addEventListener('click', () => this.goChapter(i));
      list.appendChild(b);
    });
    const on = (sel, fn) => panel.querySelector('[data-l="' + sel + '"]').addEventListener('click', fn);
    on('close', () => this.stop());
    on('play', () => this.playPause());
    on('prev', () => this.prevChapter());
    on('next', () => this.nextChapter());
    on('m-full', () => this.setMode('full'));
    on('m-brief', () => this.setMode('brief'));
    on('m-new', () => this.setMode('new'));
    on('read', () => {
      if (typeof ReadingMode !== 'undefined' && typeof ReadingMode.activate === 'function') {
        Promise.resolve(ReadingMode.activate()).catch(err => window.showToast?.(err.message, 'error'));
      }
    });
    panel.querySelector('[data-l="rate"]').addEventListener('change', (e) => {
      try { this.setRate(e.target.value); } catch (err) { window.showToast?.(err.message, 'error'); }
    });
    document.body.appendChild(panel);
    if (typeof VexLayer !== 'undefined') VexLayer.track(panel, { tier: 'panel', id: 'listen-reader', keep: true });
  },

  // ---- Settings and the command bar -------------------------------------
  injectSettings() {
    if (typeof document === 'undefined') return null;
    const root = document.querySelector('.settings-content');
    if (!root || root.querySelector('[data-vex-mod="listen-reader"]')) return null;
    const g = document.createElement('div');
    g.className = 'setting-group';
    g.setAttribute('data-vex-mod', 'listen-reader');
    g.innerHTML = `
      <label class="setting-label">Listen to articles</label>
      <p class="setting-info muted" style="margin-bottom:8px">Read any article aloud in your system voice, by chapter, as a full read or a short audio brief, and hear what is new since you last read a page. It never starts by itself, stays silent while a game is running, and never reads private or Tor tabs. The text of pages you open it on is kept on this computer to find what is new.</p>
      <div class="setting-toggle-row">
        <span>Turn Listen on</span>
        <label class="toggle"><input type="checkbox" data-listen-on aria-label="Turn Listen on"><span class="toggle-slider"></span></label>
      </div>
      <div style="display:flex;gap:10px;align-items:center;margin-top:8px">
        <button type="button" class="btn-secondary" data-listen-forget>Forget the pages I read</button>
        <span data-listen-count style="font-size:11px;color:var(--text-muted)"></span>
      </div>`;
    const cb = g.querySelector('[data-listen-on]');
    const count = g.querySelector('[data-listen-count]');
    const upd = () => { const n = this.remembered(); count.textContent = n + ' page' + VexPlural.s(n) + ' remembered'; };
    cb.checked = this.enabled();
    cb.addEventListener('change', () => {
      try { this.setEnabled(cb.checked); } catch (err) { cb.checked = !cb.checked; window.showToast?.(err.message, 'error'); }
    });
    g.querySelector('[data-listen-forget]').addEventListener('click', () => { this.forget(); upd(); window.showToast?.('Listen has forgotten the pages you read'); });
    upd();
    root.appendChild(g);
    return g;
  },

  registerCommands() {
    if (typeof CommandBar === 'undefined' || !Array.isArray(CommandBar.commands)) return;
    const have = new Set(CommandBar.commands.map(c => c.id));
    const fail = (err) => window.showToast?.((err && err.message) || String(err), 'error');
    const add = (c) => { if (!have.has(c.id)) CommandBar.commands.push(c); };
    add({ id: 'listen-open', label: 'Listen to This Page', hint: 'Chapters, speed, media keys; nothing plays until you press play', icon: 'headphones', action: () => { this.open().catch(fail); } });
    add({ id: 'listen-brief', label: 'Audio Brief of This Page', hint: 'The lead sentences of each chapter, in your system voice', icon: 'headphones', action: () => { this.open({ mode: 'brief' }).catch(fail); } });
    add({ id: 'listen-stop', label: 'Stop Listening', hint: 'Close the Listen panel and stop the voice', icon: 'stop', when: () => !!this._s, action: () => this.stop() });
  },

  init() {
    if (this._wired) return this;
    this._wired = true;
    this.registerCommands();
    this.injectSettings();
    return this;
  },
};

if (typeof window !== 'undefined') {
  window.ListenReader = ListenReader;
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => ListenReader.init());
    else ListenReader.init();
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { ListenReader };
