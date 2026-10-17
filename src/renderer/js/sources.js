// === Sources: capture bundles, DOI lookup, citation styles and BibTeX ==========
//
// T3-002 + T3-011. A copy, a highlight, a clip or a screenshot is worth little
// a month later without WHERE it came from. This keeps one source record per
// page (title, authors, date, journal, DOI/ISBN/arXiv, address, accessed-on)
// and, under it, the passages you took from it: the capture bundle. Any record
// can then be written as APA 7, MLA 9, Chicago, the Turkish Kaynakca form or a
// BibTeX entry (js/cite-styles.js).
//
//   Stamp this page     reads the page in front, when you ask (or when you copy with source /
//                       highlight a passage, which is already you asking): the meta tags the
//                       publisher wrote for citation managers (citation_*, Dublin Core, Open
//                       Graph, schema.org JSON-LD), with a fixed script that touches nothing.
//   Look up the DOI     one request to Crossref for that one DOI, only when you press the button
//                       (main/doi-resolve.js; on the "What left this computer" list). Nothing
//                       else here ever goes anywhere. An arXiv id is looked up at export.arxiv.org and an
//                       ISBN at openlibrary.org the same way (main/source-lookup.js), one request each, only
//                       when you press the button on a source that has one.
//   Auto-stamp          opt in: a clipped selection (Clip to Notes) or a screenshot is kept under the page's
//                       source as well, like a copy or a highlight (ledger line with Undo).
//   Cite                copies the record in the style picked in Settings; "bundle" adds the quotes.
//
// Never from a private, Tor or routed tab, and never from a banking, payment, sign-in, mail or
// health page. Records live on this computer (vex.sources), are not synced, and are not sent.
// Stamping that Vex does after a copy or a highlight is written to the Ledger with an Undo.

const VexSources = {
  KEY: 'vex.sources',
  PREF: 'vex.sources.prefs',           // { enabled, style }
  MAX: 400,
  MAX_ITEMS: 30,                        // passages kept under one source
  MAX_TEXT: 2000,

  // ---- switch and style ---------------------------------------------------------------
  prefs() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(this.PREF) || 'null'); } catch (err) { throw new Error('The sources settings could not be read: ' + err.message, { cause: err }); }
    const style = raw && VexCiteStyles.STYLES.some(s => s.id === raw.style) ? raw.style : 'apa';
    return { enabled: !raw || raw.enabled !== false, style, autoStamp: !!(raw && raw.autoStamp === true) };
  },
  enabled() { try { return this.prefs().enabled; } catch (err) { console.error('[Sources]', err.message); return false; } },
  setPrefs(patch) {
    const next = { ...this.prefs(), ...patch };
    if (!VexCiteStyles.STYLES.some(s => s.id === next.style)) throw new Error('Unknown citation style ' + next.style);
    try { localStorage.setItem(this.PREF, JSON.stringify({ enabled: !!next.enabled, style: next.style, autoStamp: !!next.autoStamp })); }
    catch (err) { throw new Error('Could not save that setting: ' + err.message, { cause: err }); }
    return this.prefs();
  },
  setEnabled(on) { return this.setPrefs({ enabled: !!on }).enabled; },
  style() { return this.prefs().style; },

  // ---- pure: records ------------------------------------------------------------------
  _clean(s, max = 500) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, max); },
  _ymd(ms) { const d = new Date(ms); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); },

  // "2020/03/05", "2020-03", "March 5, 2020", "2020-03-05T10:00:00Z" -> "YYYY[-MM[-DD]]" or ''
  isoDate(s) {
    const t = this._clean(s, 60);
    let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(t);
    if (m) return m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
    m = /^(\d{4})[-/.](\d{1,2})$/.exec(t);
    if (m) return m[1] + '-' + m[2].padStart(2, '0');
    if (/^\d{4}$/.test(t)) return t;
    const ms = Date.parse(t);
    if (Number.isFinite(ms)) { const d = new Date(ms); if (d.getFullYear() > 1000 && d.getFullYear() < 3000) return this._ymd(ms); }
    return '';
  },

  // "Smith, John" / "John Ronald Smith" / "Ankara University" -> { family, given } or null
  parseName(s) {
    const t = this._clean(s, 160).replace(/^by\s+/i, '');
    if (!t || /^https?:/i.test(t)) return null;
    if (t.includes(',')) {
      const bits = t.split(',');
      return { family: bits[0].trim(), given: bits.slice(1).join(' ').trim() };
    }
    const parts = t.split(' ');
    if (parts.length === 1 || /\b(inc|llc|ltd|corp|university|universit[a-zé]+|institute|team|staff|press|foundation|organi[sz]ation|association|agency|news|times|journal|ministry)\b/i.test(t)) return { family: t, given: '' };
    return { family: parts[parts.length - 1], given: parts.slice(0, -1).join(' ') };
  },
  parseNames(list) {
    const out = [];
    for (const raw of list) {
      const pieces = this._clean(raw, 400).split(/\s*;\s*|\s+and\s+|\s+&\s+|\s*\|\s*/i);
      for (const p of pieces) { const n = this.parseName(p); if (n && n.family) out.push(n); }
    }
    const seen = new Set();
    return out.filter(a => { const k = (a.family + '|' + a.given).toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 50);
  },

  _urlKey(url) {
    try {
      const u = new URL(url);
      for (const k of Array.from(u.searchParams.keys())) if (/^(utm_|fbclid|gclid|mc_|ref$|ref_)/i.test(k)) u.searchParams.delete(k);
      return (u.origin + u.pathname).replace(/\/$/, '') + u.search;
    } catch { return String(url || ''); }
  },
  _doiIn(text) { const m = /\b(10\.\d{4,9}\/[^\s"<>?#]{2,150})/i.exec(String(text || '')); return m ? m[1].replace(/[.,;)\]]+$/, '') : ''; },

  // The page's raw metadata (PAGE_SCRIPT's answer) -> a normalised record. Nothing is invented: a
  // field the page did not state stays empty.
  fromPage(raw, { url, title, now = Date.now() } = {}) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const metas = r.metas && typeof r.metas === 'object' ? r.metas : {};
    const first = (...keys) => { for (const k of keys) { const v = metas[k]; if (Array.isArray(v) && v.length && this._clean(v[0])) return this._clean(v[0]); } return ''; };
    const all = (...keys) => keys.flatMap(k => (Array.isArray(metas[k]) ? metas[k] : []));
    const ld = (Array.isArray(r.ld) ? r.ld : []).find(x => x && (x.headline || x.name)) || {};
    const pageUrl = String(url || r.url || '');
    let canonical = String(r.canonical || '');
    try { if (canonical && new URL(canonical, pageUrl).origin !== new URL(pageUrl).origin) canonical = ''; else if (canonical) canonical = new URL(canonical, pageUrl).href; } catch { canonical = ''; }
    const doi = this._doiIn(first('citation_doi', 'prism.doi', 'dc.identifier', 'dc.identifier.doi')) || this._doiIn(pageUrl);
    const arxiv = first('citation_arxiv_id') || ((/arxiv\.org\/(?:abs|pdf)\/([\w./-]+?)(?:v\d+)?(?:\.pdf)?$/i.exec(pageUrl) || [])[1] || '');
    const isbn = first('citation_isbn', 'book:isbn', 'prism.isbn');
    const journal = first('citation_journal_title', 'prism.publicationname', 'citation_conference_title');
    const authors = this.parseNames(all('citation_author', 'dc.creator', 'dcterms.creator').length
      ? all('citation_author', 'dc.creator', 'dcterms.creator')
      : [...all('author', 'article:author', 'parsely-author').filter(v => !/^https?:/i.test(v)), ...(ld.author ? [].concat(ld.author) : [])]);
    const date = this.isoDate(first('citation_publication_date', 'citation_date', 'citation_online_date', 'article:published_time', 'dc.date', 'dcterms.created', 'dc.date.issued', 'prism.publicationdate', 'date') || ld.datePublished || (r.times && r.times[0]) || '');
    const first1 = first('citation_firstpage', 'prism.startingpage');
    const last1 = first('citation_lastpage', 'prism.endingpage');
    const kind = journal ? 'article' : (arxiv ? 'preprint' : (isbn ? 'book' : 'webpage'));
    let host = '';
    try { host = new URL(pageUrl).hostname.replace(/^www\./, ''); } catch { host = ''; }
    return this.normalize({
      kind,
      title: first('citation_title', 'dc.title', 'og:title', 'twitter:title') || ld.headline || ld.name || r.title || title || pageUrl,
      authors,
      date,
      site: first('og:site_name', 'application-name', 'citation_publisher') || (ld.publisher && ld.publisher.name) || host,
      container: journal,
      publisher: first('citation_publisher', 'dc.publisher', 'prism.publisher') || (ld.publisher && ld.publisher.name) || '',
      volume: first('citation_volume', 'prism.volume'),
      issue: first('citation_issue', 'prism.number'),
      pages: first1 && last1 ? first1 + '-' + last1 : first1,
      doi, isbn, arxiv,
      url: canonical || pageUrl,
      accessed: this._ymd(now),
      lang: this._clean(r.lang, 12),
    });
  },

  normalize(rec) {
    const r = rec && typeof rec === 'object' ? rec : {};
    const authors = (Array.isArray(r.authors) ? r.authors : []).filter(a => a && (a.family || a.given))
      .map(a => ({ family: this._clean(a.family, 120), given: this._clean(a.given, 120) })).slice(0, 50);
    const kind = ['webpage', 'article', 'book', 'preprint'].includes(r.kind) ? r.kind : 'webpage';
    const items = (Array.isArray(r.items) ? r.items : []).filter(i => i && typeof i.text === 'string')
      .map(i => ({ id: typeof i.id === 'string' ? i.id : this._id('q'), kind: ['quote', 'highlight', 'clip', 'screenshot'].includes(i.kind) ? i.kind : 'quote', text: this._clean(i.text, this.MAX_TEXT), at: Number.isFinite(i.at) ? i.at : 0 }))
      .slice(0, this.MAX_ITEMS);
    return {
      id: typeof r.id === 'string' && r.id ? r.id : this._id('src'),
      kind,
      title: this._clean(r.title, 500),
      authors,
      date: this.isoDate(r.date),
      site: this._clean(r.site, 200),
      container: this._clean(r.container, 300),
      publisher: this._clean(r.publisher, 200),
      volume: this._clean(r.volume, 40),
      issue: this._clean(r.issue, 40),
      pages: this._clean(r.pages, 40),
      doi: this._clean(r.doi, 200).replace(/^https?:\/\/(dx\.)?doi\.org\//i, ''),
      isbn: this._clean(r.isbn, 40),
      arxiv: this._clean(r.arxiv, 60),
      url: /^https?:\/\//i.test(String(r.url || '')) ? String(r.url).slice(0, 2048) : '',
      oaUrl: /^https?:\/\//i.test(String(r.oaUrl || '')) ? String(r.oaUrl).slice(0, 2048) : '',
      accessed: this.isoDate(r.accessed),
      lang: this._clean(r.lang, 12),
      edited: !!r.edited,
      looked: !!r.looked,
      at: Number.isFinite(r.at) ? r.at : Date.now(),
      items,
    };
  },

  _id(p) { return p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); },

  // The one already kept for this page: same DOI, else same address (tracking parameters ignored).
  find(list, rec) {
    const doi = String(rec.doi || '').toLowerCase();
    const key = rec.url ? this._urlKey(rec.url) : '';
    return list.find(x => (doi && String(x.doi || '').toLowerCase() === doi) || (key && x.url && this._urlKey(x.url) === key)) || null;
  },

  // A re-read of a page updates a record, but never over what the person typed.
  merge(old, fresh) {
    const out = { ...old };
    for (const k of ['title', 'authors', 'date', 'site', 'container', 'publisher', 'volume', 'issue', 'pages', 'doi', 'isbn', 'arxiv', 'url', 'kind', 'lang']) {
      const has = Array.isArray(old[k]) ? old[k].length > 0 : !!old[k];
      const got = Array.isArray(fresh[k]) ? fresh[k].length > 0 : !!fresh[k];
      if (got && (!has || !old.edited)) out[k] = fresh[k];
    }
    out.accessed = fresh.accessed || old.accessed;
    return out;
  },

  // ---- storage ------------------------------------------------------------------------
  list() {
    const raw = localStorage.getItem(this.KEY);
    if (raw == null) return [];
    let v;
    try { v = JSON.parse(raw); } catch (err) { throw new Error('The sources list could not be read: ' + err.message, { cause: err }); }
    return Array.isArray(v) ? v.filter(x => x && typeof x.id === 'string').map(x => this.normalize(x)) : [];
  },
  _save(list) {
    const kept = list.slice().sort((a, b) => b.at - a.at).slice(0, this.MAX);
    localStorage.setItem(this.KEY, JSON.stringify(kept));
    return kept;
  },
  get(id) { return this.list().find(x => x.id === id) || null; },
  update(id, patch) {
    const list = this.list();
    const i = list.findIndex(x => x.id === id);
    if (i < 0) throw new Error('That source is gone');
    list[i] = this.normalize({ ...list[i], ...patch, id });
    this._save(list);
    return list[i];
  },
  remove(id) {
    const list = this.list();
    const rec = list.find(x => x.id === id);
    if (!rec) return null;
    this._save(list.filter(x => x.id !== id));
    return rec;
  },
  // Put a removed record back (the Undo of a removal).
  restore(rec) {
    const list = this.list();
    if (list.some(x => x.id === rec.id)) return rec;
    this._save([this.normalize(rec), ...list]);
    return rec;
  },

  // Add a passage to a source's bundle. Returns the item, or null when that exact text is already there.
  attach(id, { kind = 'quote', text } = {}) {
    const t = this._clean(text, this.MAX_TEXT);
    if (!t) throw new Error('There is nothing to attach');
    const list = this.list();
    const rec = list.find(x => x.id === id);
    if (!rec) throw new Error('That source is gone');
    if (rec.items.some(i => i.text === t)) return null;
    const item = { id: this._id('q'), kind, text: t, at: Date.now() };
    rec.items = [item, ...rec.items].slice(0, this.MAX_ITEMS);
    this._save(list);
    return item;
  },
  detach(id, itemId) {
    const list = this.list();
    const rec = list.find(x => x.id === id);
    if (!rec) throw new Error('That source is gone');
    rec.items = rec.items.filter(i => i.id !== itemId);
    this._save(list);
  },

  // ---- the page in front ----------------------------------------------------------------
  // A fixed script. It reads meta tags and a little JSON-LD and returns plain data; it changes nothing.
  PAGE_SCRIPT: '(() => {'
    + 'const metas = {}; const want = /^(citation_|dc[.]|dcterms[.]|prism[.]|og:|article:|book:|twitter:title|parsely-author|author$|application-name$|date$)/i;'
    + 'for (const m of document.querySelectorAll("meta[name],meta[property]")) {'
    + ' const k = (m.getAttribute("name") || m.getAttribute("property") || "").toLowerCase(); const v = (m.getAttribute("content") || "").trim();'
    + ' if (!k || !v || !want.test(k)) continue; const a = (metas[k] = metas[k] || []); if (a.length < 40) a.push(v.slice(0, 300)); }'
    + 'const ld = []; const bad = [];'
    + 'for (const s of Array.from(document.querySelectorAll(\'script[type="application/ld+json"]\')).slice(0, 5)) {'
    + ' if ((s.textContent || "").length > 40000) continue;'
    + ' try { const j = JSON.parse(s.textContent); for (const n of [].concat(j && j["@graph"] ? j["@graph"] : j)) {'
    + '  if (!n || typeof n !== "object") continue;'
    + '  const au = [].concat(n.author || []).map(x => (typeof x === "string" ? x : (x && x.name) || "")).filter(Boolean);'
    + '  ld.push({ headline: String(n.headline || "").slice(0, 300), name: String(typeof n.name === "string" ? n.name : "").slice(0, 300), author: au.slice(0, 20), datePublished: String(n.datePublished || "").slice(0, 40), publisher: n.publisher && typeof n.publisher === "object" ? { name: String(n.publisher.name || "").slice(0, 200) } : null }); } }'
    + ' catch (e) { bad.push(String(e && e.message || e).slice(0, 80)); } }'
    + 'const link = document.querySelector(\'link[rel="canonical"]\');'
    + 'const times = Array.from(document.querySelectorAll("time[datetime]")).slice(0, 3).map(t => t.getAttribute("datetime"));'
    + 'return { title: document.title, url: location.href, canonical: link ? link.href : "", lang: document.documentElement.lang || "", metas, ld: ld.slice(0, 5), times, bad };'
    + '})()',

  async _active() {
    if (typeof WebviewManager === 'undefined' || typeof TabManager === 'undefined') throw new Error('Tabs are not loaded');
    const wv = WebviewManager.getActiveWebview?.();
    const tab = TabManager.getActiveTab?.();
    if (!wv || !tab) throw new Error('There is no page in front');
    if (window.VexTabPolicy && !window.VexTabPolicy.canRestore(tab)) throw new Error('Sources are not kept from private and Tor tabs');
    let url = tab.url, title = tab.title;
    try { url = wv.getURL() || url; title = wv.getTitle() || title; } catch (err) { window.VexProblems?.note('Sources', 'Could not ask the page for its address; using the tab record', err); }
    if (!/^https?:\/\//i.test(String(url || ''))) throw new Error('Only a web page can be kept as a source');
    const why = typeof VexPageSensitivity !== 'undefined' ? VexPageSensitivity.reason(url) : null;
    if (why) throw new Error(why);
    return { wv, tab, url, title };
  },

  // The page in front as a source for something just kept, WITHOUT reading the page: its address and title,
  // when it is an ordinary web page (never private, Tor, routed, banking, mail or sign-in). -> { url, title } or { reason }.
  async sourceTab() {
    try { const { url, title } = await this._active(); return { url, title }; }
    catch (err) { return { reason: (err && err.message) || String(err) }; }
  },

  // Reads the page in front and keeps (or updates) its record. -> { record, created }
  async stampActive() {
    const { wv, url, title } = await this._active();
    let raw = null;
    try { raw = await window.vexGuestEval(wv, this.PAGE_SCRIPT, false, 3000); }
    catch (err) { window.VexProblems?.note('Sources', 'Could not read the page\'s details; kept its address and title only', err); }
    const fresh = this.fromPage(raw, { url, title });
    if (!fresh.title) throw new Error('This page has no title to cite');
    const list = this.list();
    const old = this.find(list, fresh);
    let record, created;
    if (old) { record = this.normalize({ ...this.merge(old, fresh), items: old.items }); created = false; list[list.indexOf(old)] = record; }
    else { record = fresh; created = true; list.unshift(record); }
    this._save(list);
    if (typeof VexUsage !== 'undefined') VexUsage.touch('sources');
    document.dispatchEvent(new CustomEvent('vex:source-stamped', { detail: { id: record.id, url: record.url, created } }));
    return { record, created };
  },

  // After a copy with source or a highlight: keep the passage under its page's source. A problem is
  // reported, never thrown into the copy or the highlight that caused it.
  async keepPassage({ text, kind }) {
    if (!this.enabled()) return null;
    try {
      const { record, created } = await this.stampActive();
      const item = this.attach(record.id, { kind, text });
      if (typeof VexLedger !== 'undefined') {
        VexLedger.note({ feature: 'sources', what: (created ? 'Kept a source for ' : 'Added a passage to ') + '"' + record.title.slice(0, 80) + '"', why: 'You ' + ({ highlight: 'highlighted text from', clip: 'clipped from', screenshot: 'took a screenshot of' }[kind] || 'copied text from') + ' that page and ' + (kind === 'clip' || kind === 'screenshot' ? 'Auto-stamp is on in Sources' : 'Sources is on'),
          undo: created ? { kind: 'source-remove', id: record.id } : (item ? { kind: 'source-detach', id: record.id, item: item.id } : undefined) });
      }
      return { record, item, created };
    } catch (err) {
      window.VexProblems?.note('Sources', 'Could not keep that passage under its source', err);
      return null;
    }
  },

  // ---- DOI lookup -------------------------------------------------------------------------
  _applyLookup(id, rec, f) {
    const next = { ...rec, looked: true };
    for (const k of ['kind', 'title', 'authors', 'container', 'publisher', 'volume', 'issue', 'pages', 'date', 'oaUrl', 'doi']) {
      const got = Array.isArray(f[k]) ? f[k].length > 0 : !!f[k];
      if (got) next[k] = f[k];
    }
    if (!next.url) next.url = f.url;
    return this.update(id, next);
  },
  async lookupDoi(id) {
    const rec = this.get(id);
    if (!rec) throw new Error('That source is gone');
    if (!rec.doi) throw new Error('This source has no DOI. Edit it and type one first');
    if (!window.vex || typeof window.vex.sourcesResolveDoi !== 'function') throw new Error('The DOI lookup is not available here');
    const res = await window.vex.sourcesResolveDoi(rec.doi);
    if (!res || !res.ok) throw new Error((res && res.error) || 'The DOI lookup failed');
    return this._applyLookup(id, rec, res.record);
  },
  // which: 'arxiv' | 'isbn'. One request to arxiv.org or openlibrary.org for the id the source already carries.
  async lookupId(id, which) {
    if (which !== 'arxiv' && which !== 'isbn') throw new Error('Unknown lookup ' + which);
    const rec = this.get(id);
    if (!rec) throw new Error('That source is gone');
    if (!rec[which]) throw new Error('This source has no ' + (which === 'arxiv' ? 'arXiv id' : 'ISBN') + '. Edit it and type one first');
    if (!window.vex || typeof window.vex.sourcesResolveId !== 'function') throw new Error('The ' + (which === 'arxiv' ? 'arXiv' : 'ISBN') + ' lookup is not available here');
    const res = await window.vex.sourcesResolveId(which, rec[which]);
    if (!res || !res.ok) throw new Error((res && res.error) || 'The lookup failed');
    return this._applyLookup(id, rec, res.record);
  },

  // ---- writing a citation --------------------------------------------------------------------
  cite(id, style, { md = false } = {}) {
    const rec = this.get(id);
    if (!rec) throw new Error('That source is gone');
    return VexCiteStyles.format(style || this.style(), rec, { md });
  },
  bundleText(id, style) {
    const rec = this.get(id);
    if (!rec) throw new Error('That source is gone');
    const st = style || this.style();
    const cite = VexCiteStyles.format(st, rec, { md: true });
    if (st === 'bibtex') return cite;
    const quotes = rec.items.map(i => i.text.split('\n').map(l => '> ' + l).join('\n'));
    return (quotes.length ? quotes.join('\n\n') + '\n\n' : '') + cite;
  },
  async copyText(text, message) {
    if (!navigator.clipboard) throw new Error('The clipboard is not available');
    await navigator.clipboard.writeText(text);
    window.showToast?.(message || 'Copied', 'info', 3000);
    return text;
  },
  async copyCitation(id, style) {
    const text = this.cite(id, style);
    await this.copyText(text, 'Copied as ' + VexCiteStyles.STYLES.find(s => s.id === (style || this.style())).label);
    const rec = this.get(id);
    if (rec && rec.url) document.dispatchEvent(new CustomEvent('vex:source-cited', { detail: { url: rec.url, title: rec.title, via: 'sources' } }));
    return text;
  },
  allText(style) {
    return VexCiteStyles.bibliography(style || this.style(), this.list(), { md: false });
  },

  // ---- the list ----------------------------------------------------------------------------
  EDIT_FIELDS: [
    ['title', 'Title'], ['authors', 'Authors (Last, First; Last, First)'], ['date', 'Date (YYYY-MM-DD)'], ['site', 'Website'],
    ['container', 'Journal or book'], ['publisher', 'Publisher'], ['volume', 'Volume'], ['issue', 'Issue'], ['pages', 'Pages'],
    ['doi', 'DOI'], ['isbn', 'ISBN'], ['arxiv', 'arXiv id'], ['url', 'Address'], ['accessed', 'Accessed (YYYY-MM-DD)'],
  ],
  _authorsText(a) { return a.map(x => (x.given ? x.family + ', ' + x.given : x.family)).join('; '); },

  edit(id, onDone) {
    const rec = this.get(id);
    if (!rec) { window.showToast?.('That source is gone', 'error'); return; }
    const { body, close } = VexSettingsGroups.dialog({ id: 'vex-source-edit', title: 'Edit source', sub: 'What you change here is kept when the page is read again.' });
    const inputs = {};
    for (const [key, label] of this.EDIT_FIELDS) {
      const wrap = document.createElement('label');
      wrap.style.cssText = 'display:block;margin:0 0 8px;font-size:11.5px;color:var(--text-muted)';
      wrap.textContent = label;
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'vexsr-input';
      input.style.cssText = 'display:block;width:100%;box-sizing:border-box;margin-top:2px';
      input.value = key === 'authors' ? this._authorsText(rec.authors) : String(rec[key] || '');
      inputs[key] = input;
      wrap.appendChild(input);
      body.appendChild(wrap);
    }
    body.appendChild(VexSettingsGroups.button('Save', () => {
      try {
        const patch = { edited: true };
        for (const key of Object.keys(inputs)) patch[key] = inputs[key].value;
        patch.authors = this.parseNames([inputs.authors.value]);
        if (!this._clean(inputs.title.value)) throw new Error('A source needs a title');
        this.update(id, patch);
        close();
        if (onDone) onDone();
      } catch (err) { window.showToast?.(err.message, 'error'); }
    }, { primary: true }));
  },

  open() {
    const { body } = VexSettingsGroups.dialog({ id: 'vex-sources', title: 'Sources', sub: 'One record per page you took something from, with the passages you kept. Cited in the style picked in Settings.' });
    const draw = () => {
      body.textContent = '';
      let list;
      try { list = this.list(); } catch (err) { body.appendChild(VexSettingsGroups.note(err.message)); return; }
      const bar = document.createElement('div');
      bar.className = 'vexsr-row';
      bar.append(
        VexSettingsGroups.button('Keep this page as a source', async () => {
          try { const r = await this.stampActive(); window.showToast?.((r.created ? 'Kept: ' : 'Updated: ') + r.record.title.slice(0, 70)); draw(); }
          catch (err) { window.showToast?.(err.message, 'error'); }
        }, { primary: true }),
        VexSettingsGroups.button('Copy all', async () => {
          try { const r = this.allText(); if (!r.count) throw new Error('There are no sources to copy'); await this.copyText(r.text, 'Copied ' + r.count + ' source' + (r.count === 1 ? '' : 's') + (r.skipped ? ' (' + r.skipped + ' without a title left out)' : '')); }
          catch (err) { window.showToast?.(err.message, 'error'); }
        }, { label: 'Copy every source in the chosen style' }),
      );
      body.appendChild(bar);
      if (!list.length) body.appendChild(VexSettingsGroups.note('Nothing is kept yet. Open a page and press Keep this page as a source, or copy a passage with its source.'));
      for (const rec of list.sort((a, b) => b.at - a.at)) {
        const row = document.createElement('div');
        row.className = 'vexsr-rule';
        row.style.flexWrap = 'wrap';
        const text = document.createElement('span');
        text.className = 'vexsr-host';
        text.style.wordBreak = 'normal';
        text.textContent = rec.title + '  (' + [rec.authors[0] ? rec.authors[0].family : '', rec.date.slice(0, 4), rec.items.length ? rec.items.length + ' passage' + (rec.items.length === 1 ? '' : 's') : ''].filter(Boolean).join(', ') + ')';
        row.appendChild(text);
        const act = (label, fn, opts) => row.appendChild(VexSettingsGroups.button(label, async () => { try { await fn(); } catch (err) { window.showToast?.(err.message, 'error'); } }, opts));
        act('Cite', () => this.copyCitation(rec.id), { label: 'Copy the citation for ' + rec.title });
        act('Bundle', () => this.copyText(this.bundleText(rec.id), 'Copied the citation with ' + rec.items.length + ' passage' + (rec.items.length === 1 ? '' : 's')), { label: 'Copy the passages and citation for ' + rec.title });
        act('BibTeX', () => this.copyText(this.cite(rec.id, 'bibtex'), 'Copied as BibTeX'), { label: 'Copy BibTeX for ' + rec.title });
        if (rec.doi) act(rec.looked ? 'Look up again' : 'Look up DOI', async () => { window.showToast?.('Asking Crossref about ' + rec.doi + '...'); await this.lookupDoi(rec.id); window.showToast?.('Filled in from Crossref'); draw(); }, { label: 'Look up the DOI of ' + rec.title + ' on Crossref' });
        if (rec.arxiv) act('Look up arXiv', async () => { window.showToast?.('Asking arXiv about ' + rec.arxiv + '...'); await this.lookupId(rec.id, 'arxiv'); window.showToast?.('Filled in from arXiv', 'success'); draw(); }, { label: 'Look up ' + rec.title + ' at arXiv' });
        if (rec.isbn) act('Look up ISBN', async () => { window.showToast?.('Asking Open Library about ' + rec.isbn + '...'); await this.lookupId(rec.id, 'isbn'); window.showToast?.('Filled in from Open Library', 'success'); draw(); }, { label: 'Look up ' + rec.title + ' at Open Library' });
        act('Edit', () => this.edit(rec.id, draw), { label: 'Edit ' + rec.title });
        act('Remove', () => {
          const gone = this.remove(rec.id);
          draw();
          if (gone) window.VexUndo.offer({ message: 'Removed the source "' + gone.title.slice(0, 60) + '"', undo: () => { this.restore(gone); if (body.isConnected) draw(); } });
        }, { danger: true, label: 'Remove ' + rec.title });
        body.appendChild(row);
      }
    };
    draw();
  },

  group(el) {
    el.appendChild(VexSettingsGroups.note('Keeps where a copied passage or highlight came from (title, authors, date, DOI, address) and writes it as APA, MLA, Chicago, Kaynakça or BibTeX. Looking up a DOI sends that one DOI to Crossref, only when you press the button, and shows on the "What left this computer" list. Nothing else here goes anywhere.'));
    const label = document.createElement('label');
    label.textContent = 'Citation style ';
    const select = document.createElement('select');
    select.className = 'vexsr-input';
    select.setAttribute('aria-label', 'Citation style');
    let current = 'apa';
    try { current = this.style(); } catch (err) { window.VexProblems?.note('Sources', 'The style setting could not be read', err); }
    for (const s of VexCiteStyles.STYLES) { const o = document.createElement('option'); o.value = s.id; o.textContent = s.label; o.selected = s.id === current; select.appendChild(o); }
    select.addEventListener('change', () => { try { this.setPrefs({ style: select.value }); } catch (err) { window.showToast?.(err.message, 'error'); } });
    label.appendChild(select);
    el.appendChild(label);
    const auto = document.createElement('label'); auto.className = 'vexsr-rule';
    const acb = document.createElement('input'); acb.type = 'checkbox';
    try { acb.checked = this.prefs().autoStamp; } catch (err) { window.VexProblems?.note('Sources', 'The auto-stamp setting could not be read', err); }
    acb.addEventListener('change', () => { try { this.setPrefs({ autoStamp: acb.checked }); } catch (err) { acb.checked = !acb.checked; window.showToast?.(err.message, 'error'); } });
    auto.append(acb, document.createTextNode(' Also keep a clipped selection (Clip to Notes) and a screenshot under their page\'s source'));
    el.appendChild(auto);
    el.appendChild(VexSettingsGroups.button('Open sources', () => this.open(), { primary: true }));
    el.appendChild(VexSettingsGroups.button('Keep this page as a source', async () => {
      try { const r = await this.stampActive(); window.showToast?.((r.created ? 'Kept: ' : 'Updated: ') + r.record.title.slice(0, 70)); }
      catch (err) { window.showToast?.(err.message, 'error'); }
    }));
  },

  init() {
    if (this._wired) return true;
    this._wired = true;
    if (typeof VexLedger !== 'undefined') {
      VexLedger.registerUndo('source-remove', async (token) => { if (!this.remove(token.id)) throw new Error('That source is already gone'); });
      VexLedger.registerUndo('source-detach', async (token) => { this.detach(token.id, token.item); });
    }
    document.addEventListener('vex:capture-taken', (e) => {
      const d = e.detail || {};
      let on = false;
      try { on = this.enabled() && this.prefs().autoStamp; } catch (err) { window.VexProblems?.note('Sources', 'The auto-stamp setting could not be read', err); }
      if (on && d.text && (d.kind === 'clip' || d.kind === 'screenshot')) this.keepPassage({ text: d.text, kind: d.kind });
    });
    document.addEventListener('vex:highlight-added', (e) => {
      const d = e.detail || {};
      if (this.enabled() && d.text) this.keepPassage({ text: d.text, kind: 'highlight' });
    });
    return true;
  },
};

if (typeof window !== 'undefined') {
  window.VexSources = VexSources;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'sources', title: 'Sources and citations', keywords: 'sources citation cite apa mla chicago bibtex doi crossref kaynakca bibliography reference', before: 'about', build: (el) => VexSources.group(el) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'sources-open', label: 'Sources and citations', hint: 'Pages you took passages from, cited as APA, MLA, Chicago, Kaynakça or BibTeX', icon: 'book', action: () => VexSources.open() });
    VexExtras.registerCommand({ id: 'sources-keep', label: 'Keep this page as a source', hint: 'Read its title, authors, date and DOI for citing', icon: 'book', action: async () => {
      try { const r = await VexSources.stampActive(); window.showToast?.((r.created ? 'Kept: ' : 'Updated: ') + r.record.title.slice(0, 70)); }
      catch (err) { window.showToast?.(err.message, 'error'); }
    } });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexSources };
