// === Vex agent tools that are not page actions ===
//
// The agent could only act on the page in front: click, type, navigate. So
// "research X" meant driving a search engine's page one click at a time, and
// anything about Vex itself — a note, a reminder, a bookmark, a tab group —
// was out of reach. These tools work without touching the visible page:
//
//   research   webSearch(query)      results from a keyless HTML endpoint
//              readUrl(url)          a page's readable text, no tab opened
//   Vex        saveNote, createReminder, addBookmark, searchHistory, groupTabs
//
// Fetching goes through main's bounded, CORS-free window.vex.apiRequest.
// Everything a tool returns is DATA for the model, never instructions — the
// agent's guidance says so, because a page can say anything.
// Public API: AgentTools. Depends on window.vex.apiRequest, TabManager,
// VexQuickReminder, Bookmarks, NotesPanel (each only by the tool that uses it).

const AgentTools = {
  UA: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
  MAX_TEXT: 12000,

  // ------------------------------------------------------------- fetching --
  // The agent is steered by text it reads, so it must not be talked into
  // fetching the user's router or a service on this machine.
  isPrivateHost(host) {
    const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
    if (!h || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.lan')) return true;
    if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.)/.test(h)) return true;
    const m = h.match(/^172\.(\d+)\./);
    if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
    if (h === '::1' || /^f[cd][0-9a-f]{2}:/.test(h) || /^fe80:/.test(h)) return true;
    return false;
  },

  _checkUrl(url) {
    let u;
    try { u = new URL(String(url || '')); } catch { throw new Error('Not a valid URL: ' + url); }
    if (!/^https?:$/.test(u.protocol)) throw new Error('Only http and https pages can be read');
    if (this.isPrivateHost(u.hostname)) throw new Error('Pages on this machine or the local network are not read by the agent');
    return u;
  },

  async _get(url) {
    if (!window.vex || typeof window.vex.apiRequest !== 'function') throw new Error('Web access is not available in this build');
    const r = await window.vex.apiRequest({ url, headers: { 'User-Agent': this.UA, 'Accept-Language': 'en-US,en;q=0.9' } });
    if (!r || !r.ok) throw new Error((r && r.error) || 'The request failed');
    if (r.status >= 400) throw new Error('HTTP ' + r.status + ' from ' + new URL(url).hostname);
    return r;
  },

  // --------------------------------------------------------------- search --
  parseDuckDuckGo(html) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    const out = [];
    for (const node of doc.querySelectorAll('.result')) {
      if (node.classList.contains('result--ad')) continue;
      const a = node.querySelector('a.result__a');
      if (!a) continue;
      let href = a.getAttribute('href') || '';
      // Results are wrapped: //duckduckgo.com/l/?uddg=<the real url>&rut=…
      try {
        const wrapped = new URL(href, 'https://duckduckgo.com');
        const real = wrapped.searchParams.get('uddg');
        href = real || wrapped.href;
      } catch { continue; }
      if (!/^https?:\/\//i.test(href) || /duckduckgo\.com\/y\.js/.test(href)) continue;
      out.push({ title: a.textContent.trim(), url: href, snippet: (node.querySelector('.result__snippet')?.textContent || '').trim() });
    }
    return out;
  },

  parseBing(html) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    const out = [];
    for (const node of doc.querySelectorAll('li.b_algo')) {
      const a = node.querySelector('h2 a');
      const href = a && a.getAttribute('href');
      if (!href || !/^https?:\/\//i.test(href)) continue;
      out.push({ title: a.textContent.trim(), url: href, snippet: (node.querySelector('.b_caption p, p')?.textContent || '').trim() });
    }
    return out;
  },

  async webSearch(query, count) {
    const q = String(query || '').trim();
    if (!q) throw new Error('web_search needs a query');
    const n = Math.max(1, Math.min(Number(count) || 8, 10));
    const engines = [
      ['DuckDuckGo', 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q), (h) => this.parseDuckDuckGo(h)],
      ['Bing', 'https://www.bing.com/search?q=' + encodeURIComponent(q), (h) => this.parseBing(h)],
    ];
    const failures = [];
    for (const [name, url, parse] of engines) {
      try {
        const results = parse((await this._get(url)).body);
        if (results.length) return { query: q, engine: name, results: results.slice(0, n) };
        failures.push(name + ': no results parsed');
      } catch (err) { failures.push(name + ': ' + err.message); }
    }
    throw new Error('Search failed — ' + failures.join('; '));
  },

  // -------------------------------------------------------------- reading --
  htmlToText(html) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    const title = (doc.querySelector('title')?.textContent || '').trim();
    doc.querySelectorAll('script, style, noscript, svg, iframe, template, nav, header, footer, aside, form, [role="navigation"], [role="banner"], [role="contentinfo"], [aria-hidden="true"]').forEach(n => n.remove());
    // A parsed document has no layout, so textContent runs every block
    // together; a line break after each block keeps paragraphs apart.
    doc.querySelectorAll('p, br, li, h1, h2, h3, h4, h5, h6, tr, div, section, article, blockquote, pre').forEach(n => n.after(doc.createTextNode('\n')));
    const candidates = [...doc.querySelectorAll('article, main, [role="main"]')];
    const best = candidates.sort((a, b) => b.textContent.length - a.textContent.length)[0];
    const root = (best && best.textContent.trim().length > 400) ? best : (doc.body || doc.documentElement);
    const text = (root ? root.textContent : '').replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    return { title, text };
  },

  async readUrl(url) {
    const u = this._checkUrl(url);
    const r = await this._get(u.href);
    const type = String((r.headers && (r.headers['content-type'] || r.headers['Content-Type'])) || '').toLowerCase();
    if (/pdf|octet-stream|image\/|video\/|audio\/|zip/.test(type)) throw new Error('That address is a ' + (type.split(';')[0] || 'file') + ', not a page — open it in a tab instead');
    const body = String(r.body || '');
    if (/html|xml/.test(type) || /^\s*</.test(body)) {
      const { title, text } = this.htmlToText(body);
      if (text.length < 200) return { url: u.href, title, text, note: 'Very little readable text — the page probably builds itself with JavaScript. Open it with new_tab and use extract_text.' };
      return { url: u.href, title, text: text.slice(0, this.MAX_TEXT), truncated: text.length > this.MAX_TEXT };
    }
    return { url: u.href, title: '', text: body.slice(0, this.MAX_TEXT), truncated: body.length > this.MAX_TEXT };
  },

  // ---------------------------------------------------------- Vex features --
  saveNote(title, content, sourceUrl) {
    const body = String(content || '').trim();
    const name = String(title || '').trim();
    if (!body && !name) throw new Error('A note needs a title or some content');
    const now = new Date().toISOString();
    const note = { id: 'note_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7), title: name.slice(0, 200), content: body, pinned: false, tags: ['agent'], sourceUrl: String(sourceUrl || ''), sourceTitle: '', createdAt: now, updatedAt: now };
    let notes = [];
    try { const a = JSON.parse(localStorage.getItem('vex.notes') || '[]'); if (Array.isArray(a)) notes = a; } catch { notes = []; }
    notes.unshift(note);
    localStorage.setItem('vex.notes', JSON.stringify(notes));
    try { if (typeof NotesPanel !== 'undefined' && NotesPanel.reloadSyncedState) NotesPanel.reloadSyncedState(); } catch {}
    return note;
  },

  async createReminder(message, when) {
    if (typeof VexQuickReminder === 'undefined') throw new Error('Reminders are not available');
    const trigger = VexQuickReminder.parseTrigger(String(when || '').trim());
    const at = trigger && trigger.at instanceof Date ? trigger.at : trigger;
    const made = await VexQuickReminder.create(message, (trigger && trigger.site) ? { site: trigger.site } : at, (trigger && trigger.repeat) ? { repeat: trigger.repeat } : undefined);
    return { id: made && made.id, message: String(message), when: (trigger && trigger.site) ? 'next visit to ' + trigger.site : (at instanceof Date ? at.toLocaleString() : String(when)) };
  },

  addBookmark(url, title) {
    if (typeof Bookmarks === 'undefined') throw new Error('Bookmarks are not available');
    const u = this._checkUrlLoose(url);
    if (Bookmarks.has(u)) return { url: u, already: true };
    Bookmarks.items.unshift({ id: (typeof vexId === 'function' ? vexId('bm') : 'bm_' + Date.now()), url: u, title: String(title || u).slice(0, 200), folder: '', at: Date.now() });
    Bookmarks.save();
    return { url: u, already: false };
  },

  _checkUrlLoose(url) {
    try { const u = new URL(String(url || '')); if (/^https?:$/.test(u.protocol)) return u.href; } catch {}
    throw new Error('Not a web address: ' + url);
  },

  searchHistory(query, limit) {
    const q = String(query || '').toLowerCase().trim();
    if (!q) throw new Error('search_history needs a query');
    let hist = [];
    try { const a = JSON.parse(localStorage.getItem('vex.history') || '[]'); hist = Array.isArray(a) ? a : (a && Array.isArray(a.entries) ? a.entries : []); } catch { hist = []; }
    const words = q.split(/\s+/).filter(Boolean);
    const hits = hist.filter(h => h && h.url).filter(h => { const hay = ((h.title || '') + ' ' + h.url + ' ' + (h.summary || '')).toLowerCase(); return words.every(w => hay.includes(w)); });
    return hits.slice(0, Math.max(1, Math.min(Number(limit) || 10, 25))).map(h => ({ title: h.title || h.url, url: h.url, visited: h.time ? new Date(h.time).toLocaleString() : '' }));
  },

  groupTabs(name, tabIds, color) {
    const clean = String(name || '').trim();
    if (!clean) throw new Error('A group needs a name');
    const ids = (Array.isArray(tabIds) ? tabIds : []).filter(id => TabManager.tabs.some(t => t.id === id));
    if (!ids.length) throw new Error('None of those tab ids exist — list_tabs gives the ids');
    const id = 'grp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const palette = (typeof TabManager._themeGroupPalette === 'function' ? TabManager._themeGroupPalette() : []) || [];
    TabManager.groups.push({ id, name: clean.slice(0, 60), color: String(color || (palette[0] && palette[0].ref) || '#5b8def'), collapsed: false });
    for (const tabId of ids) TabManager._setTabGroup(tabId, id);
    VexStorage.saveGroups(TabManager.groups);
    TabManager.rebuildAllTabs();
    TabManager.persistTabs();
    return { id, name: clean, tabs: ids.length };
  },
};

if (typeof window !== 'undefined') window.AgentTools = AgentTools;
if (typeof module !== 'undefined' && module.exports) module.exports = { AgentTools };
