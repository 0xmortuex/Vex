// === Knowledge base: what you keep, searchable, and askable ==================
//
// Two linked things, both on this PC:
//
//  1. A knowledge base over what you chose to KEEP: bookmarks, notes, page
//     notes, read-later items, highlights and archived pages. The index lives
//     in main (src/main/knowledge-base.js): stemmed BM25 keyword search always,
//     plus search by meaning when an embedding model is set under Settings ›
//     Recall (your own Ollama on 127.0.0.1; the same model Recall uses). This
//     file feeds it, in small idle slices, only what changed.
//
//  2. "Ask about this page / my tabs / my library": the question, the page's
//     text (and a screenshot, only if your local model can see images) and the
//     best passages from the knowledge base go to your local model through
//     AIRouter.callOn('local', ...). There is no cloud fallback: if Ollama is
//     down the answer says so. The answer is read-only text with numbered
//     sources; it never clicks, fills or opens anything.
//
// Never indexed: private windows, private/Tor/routed/container-routed tabs,
// items saved from a session of their own, sites on Recall's exclusion list,
// sign-in / bank / payment / mail / health pages, and anything you chose
// "Keep out" for. Indexing waits while a game runs or battery-aware mode is
// saving power (VexJobs, deferOnBattery).
//
// Pure helpers (collectItems, buildAskPrompt, parseReply, ...) have no DOM and
// are tested directly (tests/renderer/knowledge.test.js).

const KnowledgeAsk = {
  KINDS: ['bookmark', 'note', 'sticky', 'readlater', 'highlight', 'archive'],
  KIND_LABEL: { bookmark: 'Bookmark', note: 'Note', sticky: 'Page note', readlater: 'Read later', highlight: 'Highlight', archive: 'Archived page' },
  KIND_ICON: { bookmark: 'bookmark', note: 'note', sticky: 'edit', readlater: 'clock', highlight: 'marker', archive: 'archive' },
  MAX_TEXT: 6000,
  MAX_ITEMS: 20000,
  PROMPT_BUDGET: 9000,

  // A fast, stable string hash (FNV-1a), base 36.
  hashOf(text) {
    let h = 0x811c9dc5;
    const s = String(text);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(36);
  },

  _time(v) {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : 0;
  },

  /**
   * Everything kept, as { id, kind, title, url, text, at, h }.
   * sources: { bookmarks:[], notes:[], sticky:{}, readLater:[], annotations:{} }
   * Anything that came from a session of its own (ownSession) or is flagged
   * private is left out here and refused again in main.
   */
  collectItems(sources, { now = Date.now() } = {}) {
    const s = sources || {};
    const out = [];
    const cap = (t) => String(t == null ? '' : t).replace(/\s+/g, ' ').trim().slice(0, this.MAX_TEXT);
    const push = (kind, key, title, url, text, at, extra) => {
      if (key == null || key === '') return;
      const item = { id: kind + ':' + key, kind, title: String(title || '').slice(0, 300), url: url ? String(url).slice(0, 2048) : '', text: cap(text), at: at || now };
      if (extra && extra.partition) item.partition = String(extra.partition);
      if (extra && extra.routed === false) item.routed = false;
      item.h = this.hashOf(item.title + '\n' + item.url + '\n' + item.text + '\n' + item.at);
      out.push(item);
    };
    for (const b of Array.isArray(s.bookmarks) ? s.bookmarks : []) {
      if (!b || !b.url || b.ownSession || b.private) continue;
      push('bookmark', b.id || b.url, b.title || b.url, b.url, b.folder ? 'Bookmark folder: ' + b.folder : '', this._time(b.at));
    }
    for (const n of Array.isArray(s.notes) ? s.notes : []) {
      if (!n || !n.id || n.private || n.locked || n.encrypted) continue;
      push('note', n.id, n.title || 'Untitled note', '', n.content, this._time(n.updatedAt) || this._time(n.createdAt));
    }
    const sticky = s.sticky && typeof s.sticky === 'object' && !Array.isArray(s.sticky) ? s.sticky : {};
    for (const key of Object.keys(sticky)) {
      const v = sticky[key];
      if (!v || typeof v !== 'object' || !v.text) continue;
      push('sticky', key, v.title || key, v.url || key, v.text, this._time(v.updated));
    }
    for (const r of Array.isArray(s.readLater) ? s.readLater : []) {
      if (!r || !r.url || r.ownSession || r.private) continue;
      push('readlater', r.id || r.url, r.title || r.url, r.url, '', this._time(r.at));
    }
    const ann = s.annotations && typeof s.annotations === 'object' && !Array.isArray(s.annotations) ? s.annotations : {};
    for (const pageUrl of Object.keys(ann)) {
      const list = ann[pageUrl];
      if (!Array.isArray(list)) continue;
      for (const a of list) {
        if (!a || a.private) continue;
        const quote = a.text || (a.quote && a.quote.exact) || '';
        if (!quote && !a.note) continue;
        push('highlight', a.id || (pageUrl + '#' + this.hashOf(quote)), a.title || pageUrl, a.url || pageUrl, quote + (a.note ? ' Note: ' + a.note : ''), this._time(a.at));
      }
    }
    out.sort((x, y) => y.at - x.at);
    return out.slice(0, this.MAX_ITEMS);
  },

  /** The stretches of text that share the most words with the question, in page order. */
  pickPassages(text, question, budget) {
    const body = String(text || '').replace(/\s+/g, ' ').trim();
    if (!budget || budget <= 0) return '';
    if (body.length <= budget) return body;
    const want = new Set(String(question || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 2));
    const chunks = [];
    for (let i = 0; i < body.length; i += 400) chunks.push({ i, text: body.slice(i, i + 400) });
    const scored = chunks.map(c => {
      let n = 0;
      for (const w of c.text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) if (want.has(w)) n++;
      return { ...c, n };
    });
    // The first chunk is kept regardless: it usually says what the page is.
    const chosen = new Set([0]);
    let used = chunks[0].text.length;
    for (const c of [...scored].sort((a, b) => b.n - a.n || a.i - b.i)) {
      if (c.i === 0 || c.n === 0) continue;
      if (used + c.text.length > budget) break;
      chosen.add(c.i); used += c.text.length;
    }
    return [...chosen].sort((a, b) => a - b).map(i => body.slice(i, i + 400)).join(' … ');
  },

  /**
   * One message for the local model: numbered sources, the question and a
   * read-only instruction. Returns { message, sources } where sources carries
   * the number, a label, title and address for the citation list.
   * page / tabs: { title, url, text }; library: [{ kind, title, url, at, text }].
   */
  buildAskPrompt({ question, page = null, tabs = [], library = [], budget = this.PROMPT_BUDGET }) {
    const q = String(question || '').trim().slice(0, 512);
    if (!q) throw new Error('Type a question first.');
    const entries = [];
    if (page && (page.text || page.title)) entries.push({ label: 'This page', title: page.title || page.url || 'This page', url: page.url || '', text: page.text || '', weight: 3 });
    for (const t of tabs) if (t && (t.text || t.title)) entries.push({ label: 'Open tab', title: t.title || t.url || 'Tab', url: t.url || '', text: t.text || '', weight: 2 });
    for (const l of library) if (l) entries.push({ label: 'Library: ' + (this.KIND_LABEL[l.kind] || 'item').toLowerCase(), title: l.title || l.url || 'Item', url: l.url || '', text: l.text || '', weight: 1, at: l.at });
    if (!entries.length) throw new Error('There is nothing to answer from: no page text and nothing in your library matched.');
    const totalWeight = entries.reduce((n, e) => n + e.weight, 0);
    const headroom = Math.max(1200, budget - q.length - 900);
    const sources = [];
    let body = '';
    entries.forEach((e, i) => {
      const share = Math.max(300, Math.floor(headroom * e.weight / totalWeight));
      const text = this.pickPassages(e.text, q, share);
      const n = i + 1;
      // passage: the words the model was shown, kept so a quote can be checked against them (js/answer-citations.js).
      sources.push({ n, label: e.label, title: e.title, url: e.url, at: e.at || 0, passage: text || '' });
      const when = e.at ? ' (' + new Date(e.at).toISOString().slice(0, 10) + ')' : '';
      body += '[' + n + '] ' + e.label + ': ' + e.title + when + (e.url ? ' <' + e.url + '>' : '') + '\n' + (text || '(no text)') + '\n\n';
    });
    const message =
      'Answer the question using ONLY the numbered sources below. After each claim put the number of the source it came from, like [1] or [2][3]. ' +
      'If the sources do not answer it, say so plainly and do not guess. This is a read-only answer: do not give commands to run and do not offer to take any action. ' +
      'Reply as JSON: {"reply": "your answer", "quotes": [{"n": 1, "quote": "words copied exactly from source [1] that support a claim"}]}. ' +
      'Give one quote for every source you cite, copied word for word from that source, 12 to 25 words long.\n\n' +
      'Sources:\n' + body + 'Question: ' + q;
    return { message, sources };
  },

  /** The answer text out of whatever the local model returned. */
  parseReply(result) {
    if (result == null) throw new Error('The local model returned nothing.');
    if (typeof result === 'object') return String(result.reply || result.text || result.result || '').trim();
    const raw = String(result).trim();
    if (raw.startsWith('{')) {
      try {
        const o = JSON.parse(raw);
        if (o && typeof o.reply === 'string') return o.reply.trim();
      } catch { /* not JSON after all: the text itself is the answer */ }
    }
    return raw;
  },

  /** Source numbers an answer cites, ascending and unique. */
  citedNumbers(text, max = 99) {
    const seen = new Set();
    for (const m of String(text || '').matchAll(/\[(\d{1,2})\]/g)) { const n = Number(m[1]); if (n >= 1 && n <= max) seen.add(n); }
    return [...seen].sort((a, b) => a - b);
  },

  size(bytes) {
    if (bytes >= 1024 * 1024) return (bytes / 1048576).toFixed(1) + ' MB';
    if (bytes >= 1024) return Math.round(bytes / 1024) + ' KB';
    return bytes + ' bytes';
  },
};

// ---------------------------------------------------------------------------

const Knowledge = {
  ENABLED_KEY: 'vex.kb.enabled',
  TICK_MS: 20000,
  PUT_BATCH: 50,
  PER_TICK: 200,
  JOB: 'Knowledge base',
  _job: null,
  _busy: false,
  _lastStatus: null,

  _api() { return window.vex || null; },
  _unavailable() { return !!(window.VexTabPolicy && window.VexTabPolicy.isPrivateWindow); },

  // OFF until the person turns it on (owner decision 2026-10: indexing what
  // you keep is opt-in). Forget switches it off; Rebuild switches it on.
  enabled() { try { return localStorage.getItem(this.ENABLED_KEY) === 'true'; } catch { return false; } },
  setEnabled(on) {
    try { localStorage.setItem(this.ENABLED_KEY, on ? 'true' : 'false'); } catch (err) { console.error('[Knowledge] could not save the switch:', err); }
    this._sync();
  },

  _read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (err) {
      console.error('[Knowledge] could not read ' + key + ':', err);
      return fallback;
    }
  },

  collect() {
    const bm = (typeof Bookmarks !== 'undefined' && Array.isArray(Bookmarks.items)) ? Bookmarks.items : this._read('vex.bookmarks', []);
    return KnowledgeAsk.collectItems({
      bookmarks: bm,
      notes: this._read('vex.notes', []),
      sticky: this._read('vex.stickyNotes', {}),
      readLater: this._read('vex.readLater', []),
      annotations: this._read('vex.annotations', {}),
    });
  },

  // Recall's settings: the embedding model, the local address, the excluded sites.
  _args(extra) {
    const R = (typeof Recall !== 'undefined') ? Recall : null;
    const model = R && R.meaningModel ? R.meaningModel() : '';
    const base = R && R._meaningArgs ? R._meaningArgs().baseUrl : undefined;
    return { model: model || undefined, baseUrl: base, excluded: R && R.excluded ? R.excluded() : [], ...(extra || {}) };
  },

  _idle() {
    return new Promise(r => (typeof requestIdleCallback === 'function' ? requestIdleCallback(() => r(), { timeout: 2000 }) : setTimeout(r, 50)));
  },

  /** One slice of indexing. VexJobs holds it in Game mode and on battery. */
  async tick() {
    const api = this._api();
    if (this._unavailable() || !this.enabled() || !api || typeof api.kbPlan !== 'function' || this._busy) return null;
    this._busy = true;
    try {
      const items = this.collect();
      const plan = await api.kbPlan(items.map(i => ({ id: i.id, kind: i.kind, h: i.h })), ['bookmark', 'note', 'sticky', 'readlater', 'highlight']);
      if (!plan || plan.ok === false) throw new Error((plan && plan.message) || 'The knowledge base did not answer');
      const byId = new Map(items.map(i => [i.id, i]));
      const need = (plan.need || []).slice(0, this.PER_TICK).map(id => byId.get(id)).filter(Boolean);
      const args = this._args();
      let refused = 0;
      for (let i = 0; i < need.length; i += this.PUT_BATCH) {
        await this._idle();
        const batch = need.slice(i, i + this.PUT_BATCH).map(({ id, kind, title, url, text, at, h, partition, routed }) => ({ id, kind, title, url: url || undefined, text, at, h, partition, routed }));
        const r = await api.kbPut(batch, { excluded: args.excluded });
        if (r && r.ok === false) throw new Error(r.message || 'The knowledge base could not take some items');
        refused += (r && r.refused ? r.refused.length : 0);
      }
      if (typeof api.kbSyncArchive === 'function') {
        await this._idle();
        const r = await api.kbSyncArchive({ excluded: args.excluded });
        if (r && r.ok === false) throw new Error(r.message || 'The archive could not be read');
      }
      let step = null;
      if (args.model && typeof api.kbStep === 'function') {
        await this._idle();
        step = await api.kbStep({ ...args, batch: 5 });
      }
      return { sent: need.length, pendingAfter: Math.max(0, (plan.need || []).length - need.length), refused, step };
    } finally { this._busy = false; }
  },

  _sync() {
    const want = this.enabled() && !this._unavailable() && !!(this._api() && this._api().kbPlan) && typeof VexJobs !== 'undefined';
    if (want && !this._job) {
      // Indexing is heavy work: it waits for a quiet moment and is refused in Game mode or when memory is low (VexJobs.heavy).
      this._job = VexJobs.every(this.JOB, this.TICK_MS, () => VexJobs.heavy(this.JOB, () => this.tick(), { kind: 'index', feature: 'knowledge-base' }), { when: 'ui', deferOnBattery: true, feature: 'knowledge-base' });
    } else if (!want && this._job) {
      this._job.stop();
      this._job = null;
    }
  },

  async status() {
    const api = this._api();
    if (!api || typeof api.kbStatus !== 'function') throw new Error('The knowledge base is not available here.');
    const r = await api.kbStatus(this._args());
    if (!r || r.ok === false) throw new Error((r && r.message) || 'The knowledge base did not answer.');
    this._lastStatus = r;
    return r;
  },

  statusLine(s) {
    if (!s) return '';
    const kinds = KnowledgeAsk.KINDS.filter(k => s.byKind && s.byKind[k]).map(k => s.byKind[k] + ' ' + KnowledgeAsk.KIND_LABEL[k].toLowerCase() + (s.byKind[k] === 1 ? '' : 's'));
    let line = s.items + ' item' + (s.items === 1 ? '' : 's') + (kinds.length ? ' (' + kinds.join(', ') + ')' : '')
      + ' · ' + KnowledgeAsk.size(s.sizeBytes || s.bytes || 0) + ' of ' + KnowledgeAsk.size(s.maxBytes) + ' · ' + (s.mode === 'meaning' ? 'search by meaning on' : 'keyword search');
    if (s.evicted) line += ' · ' + s.evicted + ' oldest not indexed (full)';
    if (s.keptOut) line += ' · ' + s.keptOut + ' kept out';
    if (s.mode === 'meaning' || s.pending) line += ' · ' + s.understood + ' of ' + s.embeddable + ' understood by meaning';
    return line;
  },

  // ---- retrieval --------------------------------------------------------

  async search(question, extra) {
    const api = this._api();
    if (!api || typeof api.kbSearch !== 'function') throw new Error('The knowledge base is not available here.');
    const r = await api.kbSearch(String(question || '').slice(0, 512), this._args({ limit: 20, ...(extra || {}) }));
    if (!r || r.ok === false) throw new Error((r && r.message) || 'The search failed.');
    return r;
  },

  /**
   * "Related to what you are reading": a plain list from the page's own words
   * against what you keep, no model call. Brief-ready: the new tab page's
   * brief can show .items under .heading as is.
   */
  async relatedBlock(page, { limit = 5 } = {}) {
    const api = this._api();
    const heading = 'Related to what you are reading';
    if (this._unavailable() || !api || typeof api.kbRelatedPage !== 'function' || !this.enabled()) return { heading, items: [] };
    const r = await api.kbRelatedPage({ title: String((page && page.title) || '').slice(0, 4000), url: page && page.url ? String(page.url).slice(0, 8000) : undefined, text: String((page && page.text) || '').slice(0, 20000) }, { limit });
    if (!r || r.ok === false) throw new Error((r && r.message) || 'Related items could not be found.');
    return { heading, items: (r.hits || []).map(h => ({ id: h.id, title: h.title, url: h.url, kind: h.kind, kindLabel: KnowledgeAsk.KIND_LABEL[h.kind] || h.kind, at: h.at, snippet: (h.passages && h.passages[0]) || '' })) };
  },

  // ---- asking -----------------------------------------------------------

  _activeWebview() { return (typeof WebviewManager !== 'undefined') ? WebviewManager.getActiveWebview() : null; },

  async _pageText() {
    const wv = this._activeWebview();
    if (!wv) throw new Error('No page is open.');
    if (window.VexTabPolicy && !window.VexTabPolicy.canReadWebview(wv)) throw new Error('This is a private, Tor or routed tab, so Vex does not read it.');
    const ctx = await PageContext.extractPageContext(wv);
    if (!ctx || !ctx.text) throw new Error('This page has no readable text yet.');
    return { title: ctx.title || '', url: ctx.url || (wv.getURL ? wv.getURL() : ''), text: ctx.text };
  },

  async _tabsText() {
    const tabs = (typeof TabManager !== 'undefined' ? TabManager.tabs : []).filter(t => t && t.url && /^https?:/i.test(t.url) && !t.sleeping && !t._lazy);
    const ctx = await MultiTabContext.extractContextFromTabs(tabs.slice(0, 8), { maxCharsPerTab: 3000 });
    return ctx.filter(c => c && c.text && !c.sleeping && !c.unloaded && !c.error);
  },

  /** Whether the local model can see images; false when unknown. Never assumed. */
  async canSee() {
    try {
      if (typeof AIRouter === 'undefined' || typeof AIRouter.localVision !== 'function') return false;
      const m = AIRouter.getModel && AIRouter.getModel();
      return !!m && !!(await AIRouter.localVision(m));
    } catch (err) {
      console.error('[Knowledge] could not tell whether the local model can see images:', err);
      return false;
    }
  },

  async _screenshot() {
    const wv = this._activeWebview();
    if (!wv || typeof wv.capturePage !== 'function') throw new Error('There is no page to take a picture of.');
    if (window.VexTabPolicy && !window.VexTabPolicy.canReadWebview(wv)) throw new Error('This is a private, Tor or routed tab, so Vex does not capture it.');
    const img = await wv.capturePage();
    return img.toDataURL();
  },

  /**
   * scope: 'page' | 'tabs' | 'library'. Returns { answer, sources, cited, mode, notes }.
   * Throws a plain sentence when the local model cannot answer; never calls the cloud.
   */
  async ask(question, { scope = 'library', useLibrary = true, screenshot = false } = {}) {
    if (this._unavailable()) throw new Error('The knowledge base is not available in a private window.');
    if (typeof AIRouter === 'undefined' || typeof AIRouter.callOn !== 'function') throw new Error('The local AI is not available here.');
    const notes = [];
    let page = null, tabs = [], library = [], mode = 'keywords';
    if (scope === 'page') page = await this._pageText();
    if (scope === 'tabs') {
      tabs = await this._tabsText();
      if (!tabs.length) throw new Error('None of your open tabs have readable text Vex may use.');
    }
    if (useLibrary || scope === 'library') {
      const api = this._api();
      if (api && typeof api.kbContext === 'function' && this.enabled()) {
        const r = await api.kbContext(String(question).slice(0, 512), this._args({ limit: 6 }));
        if (r && r.ok === false) throw new Error(r.message || 'Your library could not be searched.');
        library = (r && r.sources) || [];
        mode = (r && r.mode) || mode;
        if (r && r.semanticError) notes.push('Matched by words only. ' + r.semanticError);
        if (r && r.when) notes.push('Looked at items from ' + r.when + '.');
      } else if (scope === 'library') {
        throw new Error('The knowledge base is switched off. Rebuild it in Settings › Knowledge base.');
      }
    }
    const built = KnowledgeAsk.buildAskPrompt({ question, page, tabs, library });
    const request = { message: built.message, conversationHistory: [] };
    if (screenshot && scope === 'page') {
      if (!(await this.canSee())) throw new Error('Your local model cannot see images, so no screenshot was included. Turn the screenshot option off, or choose a model that can see.');
      request.image = await this._screenshot();
      notes.push('A screenshot of the page was included.');
    }
    let res;
    try { res = await AIRouter.callOn('local', 'chat', request); }
    catch (err) { throw new Error('Your local model could not answer: ' + String((err && err.message) || err).replace(/\.$/, '') + '. Nothing was sent to the cloud.', { cause: err }); }
    const answer = KnowledgeAsk.parseReply(res && res.result);
    if (!answer) throw new Error('The local model returned an empty answer. Try asking again.');
    // Each statement is checked against the words of the source it names (T2-023, js/answer-citations.js).
    let claims = null;
    if (typeof VexAnswerCitations !== 'undefined' && VexAnswerCitations.enabled()) {
      claims = VexAnswerCitations.verify(answer, VexAnswerCitations.parseQuotes(res && res.result), built.sources);
    }
    return { answer, claims, sources: built.sources, cited: KnowledgeAsk.citedNumbers(answer, built.sources.length), mode, notes, model: res && res.model };
  },

  // ---- the panel ----------------------------------------------------------

  _openUrl(url) {
    if (typeof TabManager !== 'undefined' && /^https?:/i.test(url)) { TabManager.createTab(url, true); return true; }
    return false;
  },

  open({ scope = 'library', question = '', related = false } = {}) {
    document.getElementById('vex-knowledge')?.remove();
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const ov = el('div', 'vexsr-ov');
    ov.id = 'vex-knowledge';
    const card = el('div', 'vexsr-card');
    card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'true'); card.setAttribute('aria-labelledby', 'kb-title');
    card.style.width = '700px';
    ov.appendChild(card);

    const head = el('div', 'vexsr-head');
    head.appendChild(el('span', 'vexsr-title', 'Knowledge base')).id = 'kb-title';
    const closeBtn = el('button', 'vexsr-x');
    closeBtn.setAttribute('aria-label', 'Close'); closeBtn.title = 'Close';
    closeBtn.innerHTML = VexIcons.svg('x', { size: 13 });
    head.appendChild(closeBtn);
    const sub = el('div', 'vexsr-sub', 'Reading your bookmarks, notes, highlights, read-later list and archived pages…');
    sub.setAttribute('role', 'status');

    const row = el('div', 'vexsr-row');
    row.style.marginTop = '10px';
    const input = el('input', 'vexsr-input');
    input.type = 'search'; input.placeholder = 'What did I read about…? Ask in your own words';
    input.setAttribute('aria-label', 'Search or ask your knowledge base');
    input.value = question;
    const searchBtn = el('button', 'vexsr-go', 'Search');
    const askBtn = el('button', 'vexsr-go', 'Ask');
    askBtn.title = 'Answer with your local model, citing sources. Nothing is sent to the cloud.';
    row.append(input, searchBtn, askBtn);

    const opts = el('div', 'vexsr-row');
    opts.style.cssText = 'margin-top:8px;align-items:center;flex-wrap:wrap';
    const scopeSel = el('select', 'vexsr-input');
    scopeSel.style.flex = '0 0 auto';
    scopeSel.setAttribute('aria-label', 'What to answer from');
    for (const [v, t] of [['library', 'My library'], ['page', 'This page'], ['tabs', 'My open tabs']]) { const o = el('option', null, t); o.value = v; scopeSel.appendChild(o); }
    scopeSel.value = scope;
    const libLabel = el('label', 'vexsr-check');
    const libChk = el('input'); libChk.type = 'checkbox'; libChk.checked = true;
    libLabel.append(libChk, document.createTextNode(' Also use my library'));
    const shotLabel = el('label', 'vexsr-check');
    const shotChk = el('input'); shotChk.type = 'checkbox';
    shotLabel.append(shotChk, document.createTextNode(' Include a screenshot'));
    shotLabel.style.display = 'none';
    opts.append(scopeSel, libLabel, shotLabel);

    const msg = el('div', 'vexsr-msg'); msg.setAttribute('role', 'status'); msg.setAttribute('aria-live', 'polite');
    const answerBox = el('div', 'vexsr-sub'); answerBox.style.cssText = 'white-space:pre-wrap;margin-top:10px;font-size:13px;color:var(--text)';
    answerBox.hidden = true;
    const list = el('div', 'vexsr-list');

    const foot = el('div', 'vexsr-row');
    foot.style.cssText = 'flex-wrap:wrap;margin-top:6px';
    const relBtn = el('button', 'vexsr-x', 'Related to this page');
    const rebuildBtn = el('button', 'vexsr-x', 'Rebuild');
    const forgetBtn = el('button', 'vexsr-x', 'Forget everything');
    const releaseBtn = el('button', 'vexsr-x', 'Let kept-out items back in');
    foot.append(relBtn, rebuildBtn, forgetBtn, releaseBtn);
    const note = el('div', 'vexsr-note', 'Only things you chose to keep are indexed, and only on this PC: nothing is uploaded or synced. Private windows, private, Tor and routed tabs, sites on Recall\'s exclusion list and sign-in, bank, payment, mail and health pages are never indexed. '
      + 'Ask uses your local Ollama model only, with no cloud fallback, and only reads: it never clicks, fills in or opens anything. Indexing pauses while a game runs and on battery saving.');

    card.append(head, sub, row, opts, msg, answerBox, list, foot, note);
    document.body.appendChild(ov);

    const say = (t, bad) => { msg.textContent = t || ''; msg.style.color = bad ? 'var(--danger, #ef4444)' : 'var(--text-muted)'; };
    const onKey = (e) => {
      if (!ov.isConnected) { document.removeEventListener('keydown', onKey, true); return; }
      if (e.key !== 'Escape' || document.querySelector('.vex-dialog-overlay')) return;
      e.preventDefault(); e.stopPropagation(); close();
    };
    const close = () => { document.removeEventListener('keydown', onKey, true); ov.remove(); };
    document.addEventListener('keydown', onKey, true);
    ov.addEventListener('click', e => { if (e.target === ov) close(); });
    closeBtn.addEventListener('click', close);
    input.focus({ preventScroll: true });

    const refreshStatus = async () => {
      try { sub.textContent = this.statusLine(await this.status()); }
      catch (err) { sub.textContent = err.message; }
    };

    const renderHits = (hits, emptyText) => {
      list.textContent = '';
      if (!hits.length) { list.appendChild(el('div', 'vexsr-empty', emptyText)); return; }
      for (const h of hits) list.appendChild(this._row(h, { say, redraw: () => runSearch(), close }));
    };

    let seq = 0;
    const runSearch = async () => {
      const mine = ++seq;
      const q = input.value.trim();
      answerBox.hidden = true;
      if (!q) { list.textContent = ''; say(''); return; }
      say('Searching…');
      try {
        const r = await this.search(q);
        if (mine !== seq || !ov.isConnected) return;
        say((r.when ? 'From ' + r.when + '. ' : '') + (r.mode === 'meaning' ? 'Matched by words and by meaning.' : 'Matched by words.') + (r.semanticError ? ' ' + r.semanticError : ''), false);
        renderHits(r.hits || [], 'Nothing you kept matches that. Try other words.');
      } catch (err) { say(err.message, true); }
    };

    const runAsk = async () => {
      const q = input.value.trim();
      if (!q) { say('Type a question first.', true); return; }
      askBtn.disabled = true; searchBtn.disabled = true;
      say('Asking your local model…');
      answerBox.hidden = true;
      try {
        const r = await this.ask(q, { scope: scopeSel.value, useLibrary: libChk.checked, screenshot: shotChk.checked && shotLabel.style.display !== 'none' });
        if (!ov.isConnected) return;
        answerBox.hidden = false;
        if (r.claims && r.claims.length) {
          VexAnswerCitations.render(answerBox, r.claims, r.sources, { onError: (err) => say(err.message, true) });
          answerBox.appendChild(Object.assign(document.createElement('div'), { className: 'vexsr-mode', textContent: VexAnswerCitations.summaryLine(r.claims) }));
        } else answerBox.textContent = r.answer;
        say([r.model ? 'Answered by ' + r.model + ' on this PC.' : 'Answered on this PC.'].concat(r.notes).join(' '));
        // Check the sources for conflicts, read the answer aloud (js/library-links.js).
        if (typeof VexLibraryLinks !== 'undefined') VexLibraryLinks.decorateAnswer(answerBox, r, { question: q, say });
        list.textContent = '';
        list.appendChild(el('div', 'vexsr-sub', 'Sources'));
        for (const s of r.sources) {
          const rowEl = el('div', 'vexsr-rule');
          rowEl.style.flexWrap = 'wrap';
          const t = el('div'); t.style.cssText = 'flex:1;min-width:200px';
          const cited = r.cited.includes(s.n);
          t.appendChild(el('div', 'vexsr-host', '[' + s.n + '] ' + s.title + (cited ? '' : ' (not cited)')));
          t.appendChild(el('div', 'vexsr-mode', s.label + (s.url ? ' · ' + s.url : '')));
          rowEl.appendChild(t);
          if (s.url && /^https?:/i.test(s.url)) {
            const open = el('button', 'vexsr-x', 'Open');
            open.setAttribute('aria-label', 'Open source ' + s.n + ': ' + s.title);
            open.addEventListener('click', () => { this._openUrl(s.url); close(); });
            rowEl.appendChild(open);
          }
          list.appendChild(rowEl);
        }
      } catch (err) { say(err.message, true); }
      finally { askBtn.disabled = false; searchBtn.disabled = false; }
    };

    const runRelated = async () => {
      say('Looking for what you kept that relates to this page…');
      try {
        const page = await this._pageText();
        const r = await this.relatedBlock(page, { limit: 8 });
        answerBox.hidden = true;
        say(r.heading + ': ' + r.items.length + (r.items.length === 1 ? ' item' : ' items') + '.');
        renderHits(r.items.map(i => ({ id: i.id, kind: i.kind, title: i.title, url: i.url, at: i.at, passages: i.snippet ? [i.snippet] : [] })), 'Nothing you kept relates to this page yet.');
      } catch (err) { say(err.message, true); }
    };

    searchBtn.addEventListener('click', runSearch);
    askBtn.addEventListener('click', runAsk);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); (e.ctrlKey || e.metaKey || scopeSel.value !== 'library' ? runAsk : runSearch)(); } });
    relBtn.addEventListener('click', runRelated);
    scopeSel.addEventListener('change', () => { shotLabel.style.display = scopeSel.value === 'page' && shotLabel.dataset.can === '1' ? '' : 'none'; });
    this.canSee().then(can => { if (!ov.isConnected) return; shotLabel.dataset.can = can ? '1' : '0'; scopeSel.dispatchEvent(new Event('change')); });

    rebuildBtn.addEventListener('click', async () => {
      const ok = await vexConfirm({ title: 'Rebuild the knowledge base?', message: 'The index is emptied and filled again from your bookmarks, notes, highlights, read-later list and archived pages. Nothing you kept is changed.', okLabel: 'Rebuild' });
      if (!ok) return;
      try {
        const r = await this._api().kbForget();
        if (r && r.ok === false) throw new Error(r.message);
        this.setEnabled(true);
        say('Emptied. Rebuilding in the background while Vex is idle.');
        this.tick().catch(err => say(err.message, true)).finally(refreshStatus);
      } catch (err) { say(err.message, true); }
    });
    forgetBtn.addEventListener('click', async () => {
      const ok = await vexConfirm({ title: 'Forget everything in the knowledge base?', message: 'The index and its meaning numbers are deleted and indexing stops until you turn it on again. Your bookmarks, notes and the rest are not touched.', okLabel: 'Forget', danger: true });
      if (!ok) return;
      try {
        const r = await this._api().kbForget();
        if (r && r.ok === false) throw new Error(r.message);
        this.setEnabled(false);
        list.textContent = ''; answerBox.hidden = true;
        say('Forgotten. Indexing is off; press Rebuild to turn it on.');
        refreshStatus();
      } catch (err) { say(err.message, true); }
    });
    releaseBtn.addEventListener('click', async () => {
      try {
        const r = await this._api().kbKeepOutClear();
        if (r && r.ok === false) throw new Error(r.message);
        say(r.released ? r.released + ' item' + (r.released === 1 ? '' : 's') + ' can be indexed again.' : 'Nothing was kept out.');
        refreshStatus();
      } catch (err) { say(err.message, true); }
    });

    refreshStatus();
    if (related) runRelated(); else if (question) (scope === 'library' ? runSearch : runAsk)();
    return ov;
  },

  _row(h, { say, redraw, close }) {
    const row = document.createElement('div');
    row.className = 'vexsr-rule';
    row.dataset.kbId = h.id;
    row.style.flexWrap = 'wrap';
    const text = document.createElement('div');
    text.style.cssText = 'flex:1;min-width:200px';
    const title = document.createElement('div');
    title.className = 'vexsr-host';
    title.style.wordBreak = 'break-word';
    const icon = document.createElement('span');
    icon.innerHTML = VexIcons.svg(KnowledgeAsk.KIND_ICON[h.kind] || 'note', { size: 13 });
    icon.style.cssText = 'margin-right:6px;vertical-align:-2px';
    title.append(icon, document.createTextNode(h.title || h.url || 'Untitled'));
    const meta = document.createElement('div');
    meta.className = 'vexsr-mode';
    meta.style.whiteSpace = 'normal';
    let host = '';
    try { host = h.url ? new URL(h.url).hostname.replace(/^www\./, '') : ''; } catch { host = ''; }
    meta.textContent = [KnowledgeAsk.KIND_LABEL[h.kind] || h.kind, h.at ? new Date(h.at).toLocaleDateString() : '', host, h.byMeaning ? 'matched by meaning' : ''].filter(Boolean).join(' · ');
    text.append(title, meta);
    if (h.passages && h.passages[0]) {
      const p = document.createElement('div');
      p.className = 'vexsr-sub';
      p.textContent = h.passages[0].slice(0, 300);
      text.appendChild(p);
    }
    const related = document.createElement('div');
    related.className = 'vexsr-sub';
    related.hidden = true;
    text.appendChild(related);
    const btn = (label, aria, run) => {
      const b = document.createElement('button');
      b.className = 'vexsr-x';
      b.textContent = label;
      b.setAttribute('aria-label', aria + ': ' + (h.title || h.url));
      b.addEventListener('click', run);
      return b;
    };
    const open = btn('Open', 'Open', () => {
      if (h.url && this._openUrl(h.url)) { close(); return; }
      if (h.kind === 'note' && typeof SidebarManager !== 'undefined') { SidebarManager.openPanel('notes'); close(); return; }
      say('This item has no page to open.', true);
    });
    const rel = btn('Related', 'Show items related to', async () => {
      try {
        const r = await this._api().kbRelated(h.id, this._args({ limit: 4 }));
        if (r && r.ok === false) throw new Error(r.message);
        related.hidden = false;
        related.textContent = (r.hits && r.hits.length)
          ? 'Related (' + (r.how === 'meaning' ? 'by meaning' : 'by shared words') + '): ' + r.hits.map(x => x.title).join(' · ')
          : 'Nothing else you kept is close to this.';
      } catch (err) { say(err.message, true); }
    });
    const out = btn('Keep out', 'Keep out of the knowledge base', async () => {
      const ok = await vexConfirm({ title: 'Keep this out of the knowledge base?', message: '"' + (h.title || h.url) + '" is removed from the index and is not indexed again. The item itself is not changed.', okLabel: 'Keep out' });
      if (!ok) return;
      try {
        const r = await this._api().kbKeepOut(h.id, true);
        if (r && r.ok === false) throw new Error(r.message);
        say('Kept out. It will not be indexed.');
        redraw();
      } catch (err) { say(err.message, true); }
    });
    row.append(text, open, rel, out);
    // Backlinks and "Your copy" (js/library-links.js).
    if (typeof VexLibraryLinks !== 'undefined') VexLibraryLinks.decorateRow(row, h, { say });
    return row;
  },

  // ---- the settings group and the command bar, added at runtime -------------

  _injectSettings() {
    const anchor = document.getElementById('recall-panel-content');
    const group = anchor && anchor.closest('.setting-group');
    if (!group || document.getElementById('kb-settings-group')) return;
    const box = document.createElement('div');
    box.className = 'setting-group';
    box.id = 'kb-settings-group';
    const label = document.createElement('label');
    label.className = 'setting-label';
    label.textContent = 'Knowledge base';
    const info = document.createElement('p');
    info.className = 'setting-info muted';
    info.style.marginBottom = '8px';
    info.textContent = 'A search over what you keep: bookmarks, notes, highlights, read-later and archived pages. Off until you turn it on. Local only; private tabs and the sites Recall ignores are never included.';
    const stat = document.createElement('p');
    stat.className = 'setting-info muted';
    stat.setAttribute('role', 'status');
    stat.textContent = 'Loading…';
    const rowEl = document.createElement('div');
    rowEl.className = 'setting-toggle-row';
    const lab = document.createElement('span');
    lab.textContent = 'Index what I keep';
    const toggle = document.createElement('label');
    toggle.className = 'toggle';
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.setAttribute('aria-label', 'Index what I keep');
    chk.checked = this.enabled();
    const slider = document.createElement('span');
    slider.className = 'toggle-slider';
    toggle.append(chk, slider);
    rowEl.append(lab, toggle);
    const btns = document.createElement('div');
    btns.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-top:8px';
    const mk = (t, run) => { const b = document.createElement('button'); b.className = 'btn'; b.textContent = t; b.addEventListener('click', run); return b; };
    btns.append(
      mk('Open knowledge base', () => this.open()),
      mk('Rebuild', async () => {
        if (!await vexConfirm({ title: 'Rebuild the knowledge base?', message: 'The index is emptied and filled again from what you keep.', okLabel: 'Rebuild' })) return;
        try { await this._api().kbForget(); this.setEnabled(true); chk.checked = true; await this.tick(); } catch (err) { window.showToast?.(err.message, 'error'); }
        refresh();
      }),
      mk('Forget everything', async () => {
        if (!await vexConfirm({ title: 'Forget everything in the knowledge base?', message: 'The index is deleted and indexing stops until you turn it on again. What you keep is not touched.', okLabel: 'Forget', danger: true })) return;
        try { await this._api().kbForget(); this.setEnabled(false); chk.checked = false; } catch (err) { window.showToast?.(err.message, 'error'); }
        refresh();
      }),
    );
    chk.addEventListener('change', () => { this.setEnabled(chk.checked); refresh(); });
    box.append(label, info, stat, rowEl, btns);
    group.after(box);
    const refresh = async () => {
      try { stat.textContent = this.enabled() ? this.statusLine(await this.status()) : 'Off. Nothing is being indexed.'; }
      catch (err) { stat.textContent = err.message; }
    };
    refresh();
    // The size is shown again whenever Settings is looked at.
    const obs = new MutationObserver(() => { if (box.offsetParent) refresh(); });
    obs.observe(group.parentElement, { attributes: true, subtree: true, attributeFilter: ['class', 'style'] });
  },

  _injectCommands() {
    if (typeof CommandBar === 'undefined' || !Array.isArray(CommandBar.commands)) return;
    if (CommandBar.commands.some(c => c.id === 'kb-search')) return;
    const fail = (err) => window.showToast?.((err && err.message) || 'That did not work', 'error');
    const guard = (fn) => () => { try { fn(); } catch (err) { fail(err); } };
    CommandBar.commands.push(
      { id: 'kb-search', label: 'Search My Knowledge Base', hint: 'Find what you kept by meaning, across bookmarks, notes, highlights and archived pages', icon: 'brain', action: guard(() => this.open()) },
      { id: 'kb-ask-library', label: 'Ask My Library (Local AI)', hint: 'Your local model answers from what you kept and cites the sources; nothing leaves this PC', icon: 'sparkles', action: guard(() => this.open({ scope: 'library' })) },
      { id: 'kb-ask-page', label: 'Ask About This Page (Local AI)', hint: 'Your local model answers from this page and your library, with sources; read-only', icon: 'sparkles', action: guard(() => this.open({ scope: 'page' })) },
      { id: 'kb-ask-tabs', label: 'Ask About My Open Tabs (Local AI)', hint: 'Your local model answers from your open tabs and your library, with sources; read-only', icon: 'sparkles', action: guard(() => this.open({ scope: 'tabs' })) },
      { id: 'kb-related', label: 'Related To What I\'m Reading', hint: 'What you kept that relates to this page', icon: 'link', action: guard(() => this.open({ related: true })) },
    );
  },

  // What "Sources into a document" (js/project-compiler.js) can draw on: what
  // is kept, as the knowledge base sees it. Nothing is offered while the base is
  // off (it is opt-in) or in a private window.
  sourceProvider() {
    const self = this;
    return {
      id: 'knowledge',
      kind: 'knowledge',
      label: 'My knowledge base',
      async list() {
        if (self._unavailable() || !self.enabled()) return [];
        return self.collect().filter(i => i.text || i.title).slice(0, 200)
          .map(i => ({ id: i.id, title: i.title || i.url, url: i.url, detail: i.kind }));
      },
      async read(id) {
        if (self._unavailable() || !self.enabled()) throw new Error('The knowledge base is off');
        const hit = self.collect().find(i => i.id === id);
        if (!hit) throw new Error('That item is no longer in the knowledge base');
        return (hit.title ? hit.title + '\n\n' : '') + (hit.text || hit.url || '');
      },
    };
  },

  init() {
    if (this._inited) return;
    this._inited = true;
    window.Knowledge = this;
    if (this._unavailable()) return;
    this._injectCommands();
    this._injectSettings();
    if (typeof ProjectCompiler !== 'undefined' && typeof ProjectCompiler.registerProvider === 'function') {
      ProjectCompiler.registerProvider(this.sourceProvider());
    }
    this._sync();
  },
};

if (typeof window !== 'undefined') {
  window.KnowledgeAsk = KnowledgeAsk;
  window.Knowledge = Knowledge;
  const start = () => setTimeout(() => {
    try { Knowledge.init(); } catch (err) { console.error('[Knowledge] could not start:', err); }
  }, 4000);
  if (document.readyState === 'complete') start(); else window.addEventListener('load', start, { once: true });
}
if (typeof module !== 'undefined' && module.exports) module.exports = { KnowledgeAsk, Knowledge };
